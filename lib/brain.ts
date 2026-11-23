import 'server-only';
import { db } from '@/lib/db';
import { NODE_KINDS } from '@/lib/kinds';
import { isISODate, todayISO } from '@/lib/format';
import type { AlignNode, BrainMessage, BrainReply, Fact, NodeType, ObjectType, Sector } from '@/lib/types';

// The planning brain. Reads the whole path above a page, what is already under
// it and what it knows about Gibson, then either asks what only he can answer
// or proposes the next, more specific layer, until a step is truly actionable.

export const BRAIN_MODEL_DEFAULT = 'gpt-5.6';

export function brainModel(): string {
  return (process.env.ALIGN_BRAIN_MODEL || BRAIN_MODEL_DEFAULT).trim();
}

export function brainConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

// What may sit directly under each kind of page.
export function nextTypes(objectType: ObjectType, nodeType?: NodeType): NodeType[] {
  if (objectType === 'sector') return ['vision', 'milestone', 'objective', 'project', 'micro_goal'];
  switch (nodeType) {
    case 'vision':
      return ['milestone', 'project'];
    case 'milestone':
      return ['objective', 'month', 'project'];
    case 'objective':
      return ['month', 'week', 'commitment', 'action', 'project'];
    case 'month':
      return ['week', 'commitment', 'action'];
    case 'week':
      return ['action', 'task'];
    case 'commitment':
      return ['action'];
    case 'action':
      return ['task'];
    case 'project':
      return ['phase', 'month', 'week', 'task'];
    case 'phase':
      return ['week', 'task'];
    case 'micro_goal':
      return ['action', 'task'];
    default:
      return ['task'];
  }
}

const SYSTEM = `You are the planning brain inside Align, Gibson's personal life operating system.

Your job is to reverse-engineer what he wants out of life into a chain of pages that ends in actions he can do today without having to think. The structure is:
Five-Year Vision, then 12-Month Milestone, then 90-Day Objective, then Month, then Week, then Daily Action, then Task.
Projects split into Phases (or Months and Weeks), then Tasks. Micro Goals split into Actions or Tasks.
A Month and a Week are specific stretches of the calendar inside a plan ("Month 2: build to 20 miles a week", "Week of Dec 7: 3 runs, 14 miles"). They carry start_date (a Monday for weeks, the 1st or the plan's start for months) and the end date fills in. A Weekly Commitment is different: a recurring habit with a cadence ("run 3 times a week") that holds week after week. Use Months and Weeks when a goal has a date and needs to build progressively toward it (a race, an exam, a launch, a savings target). Use Weekly Commitments for steady habits with no finish date.
Any page can also be a real event: event_date (the day it happens), location, cost in dollars, and link_url (the sign-up or info page).

How you work, every time:
1. Read the whole path from the sector down to the current page. Every layer you propose must be strictly more specific than the current page and must clearly serve everything above it.
2. Narrow by choosing. Each step down picks one concrete thing: which skill, which song, which section of it, which tool, which number, which day. Example chain: "Get good at guitar" leads to "Learn songs I love, start to finish", which leads to "Learn Wonderwall by Oasis", which leads to "Practice the verse strumming pattern 4 times a week", which leads to "Play bars 1 to 8 of the Wonderwall verse with a metronome at 60 BPM until 3 clean run-throughs in a row, then raise it to 66 BPM".
3. Never invent his preferences, level, equipment, budget, schedule or constraints. If the right next layer depends on a choice only he can make (for example which songs he actually likes, what he can already play, whether he owns a metronome app, how many minutes he has on weekdays), ask before proposing. Ask at most 3 questions per turn, and only questions whose answers would change what you propose. Give 2 to 6 short concrete options for each when that makes answering fast, and always allow his own answer.
4. Use the known facts. Never ask something the facts or the conversation already answer.
5. The actionable test for a Daily Action or Task: it fits in one sitting (90 minutes or less), starts with a verb, names the exact object (the specific song, section, page, person, file, exercise, amount), names the method or tool when it matters, and has a measurable done criterion (reps, tempo, count, minutes, a finished artifact, a sent message). Something like "Focus on the G to C transition" fails: no exact object, no method, no finish line.
6. If the current page already passes the actionable test (or is a Weekly Commitment whose actions already pass it), set actionable to true and say so. Only propose more if splitting it would genuinely help.
7. Otherwise propose 2 to 7 pages for the NEXT layer only, using only the allowed types you are given. Each needs a short title (no trailing period), a one or two sentence body describing what it looks like when it is real, a done criterion, effort_minutes for actions and tasks (null otherwise), and a cadence for weekly commitments (for example "4 times a week, 20 minutes", empty otherwise). Do not repeat pages that already exist under the current page.
8. If the current page is vague, mixes several goals, or has an unrealistic timeline, say so plainly in the assessment and propose the split or the fix.
9. Put any durable fact you learned from his answers in facts_learned, written as a plain statement about him ("Likes Oasis and Tom Petty", "Owns an acoustic guitar, no amp", "Has 30 minutes on weekday evenings"). Leave it empty when there is nothing new.
10. Dates. Work backward from any event_date or due_date above this page. When you propose Months or Weeks, give every one a start_date and due_date that fit inside the parent and lead up to the deadline without gaps, and title them by what changes that period ("Week 6: first 8 mile long run"). When you propose Daily Actions inside a Week, date each one (due_date) on a sensible day of that week. Leave dates empty when there is no deadline to work back from.
11. gap: one sentence on what still stands between this page and something he can do today. Empty when actionable.

Style: plain, direct, specific. No hype, no motivational filler. Never use the words "tackle" or "tackling". Never use em dashes. Titles in sentence case.`;

function schema(allowed: NodeType[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['assessment', 'actionable', 'gap', 'questions', 'proposals', 'facts_learned'],
    properties: {
      assessment: { type: 'string', description: 'Two to four sentences: where this page stands and what you are doing this turn.' },
      actionable: { type: 'boolean' },
      gap: { type: 'string' },
      questions: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['question', 'why', 'options'],
          properties: {
            question: { type: 'string' },
            why: { type: 'string', description: 'One short line on how the answer changes the plan.' },
            options: { type: 'array', maxItems: 6, items: { type: 'string' } },
          },
        },
      },
      proposals: {
        type: 'array',
        maxItems: 7,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'title', 'body', 'done_criteria', 'effort_minutes', 'cadence', 'start_date', 'due_date', 'why'],
          properties: {
            type: { type: 'string', enum: allowed },
            title: { type: 'string' },
            body: { type: 'string' },
            done_criteria: { type: 'string' },
            effort_minutes: { type: ['integer', 'null'] },
            cadence: { type: 'string' },
            start_date: { type: ['string', 'null'], description: 'YYYY-MM-DD or null' },
            due_date: { type: ['string', 'null'], description: 'YYYY-MM-DD or null' },
            why: { type: 'string', description: 'One short line on how this serves the page above it.' },
          },
        },
      },
      facts_learned: { type: 'array', maxItems: 8, items: { type: 'string' } },
    },
  };
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

type LineNode = Pick<AlignNode, 'type' | 'title' | 'body' | 'done_criteria' | 'cadence' | 'effort_minutes' | 'status' | 'due_date'> &
  Partial<Pick<AlignNode, 'start_date' | 'event_date' | 'location' | 'cost' | 'link_url'>>;

function line(n: LineNode): string {
  const bits = [`[${NODE_KINDS[n.type]?.label ?? n.type}] ${n.title}`];
  if (n.status && n.status !== 'active') bits.push(`(status: ${n.status})`);
  if (n.start_date) bits.push(`(starts ${n.start_date})`);
  if (n.due_date) bits.push(`(due ${n.due_date})`);
  if (n.event_date) bits.push(`(event on ${n.event_date})`);
  if (n.location) bits.push(`(at ${n.location})`);
  if (n.cost !== null && n.cost !== undefined) bits.push(`(costs $${n.cost})`);
  if (n.link_url) bits.push(`(link ${n.link_url})`);
  let out = bits.join(' ');
  if (n.body?.trim()) out += `\n   Description: ${n.body.trim().slice(0, 800)}`;
  if (n.done_criteria?.trim()) out += `\n   Done when: ${n.done_criteria.trim()}`;
  if (n.cadence?.trim()) out += `\n   Cadence: ${n.cadence.trim()}`;
  if (n.effort_minutes) out += `\n   Effort: ${n.effort_minutes} min`;
  return out;
}

export interface BrainTarget {
  objectType: ObjectType;
  id: string;
  sector: Sector | null; // the sector or area the page sits in
  topSector: Sector | null;
  node: AlignNode | null;
}

export async function loadFacts(target: BrainTarget): Promise<Fact[]> {
  const sectorIds = [target.sector?.id, target.topSector?.id].filter(Boolean) as string[];
  const ors = ['and(sector_id.is.null,node_id.is.null)'];
  if (sectorIds.length) ors.push(`sector_id.in.(${sectorIds.join(',')})`);
  if (target.objectType === 'node') ors.push(`node_id.eq.${target.id}`);
  const { data } = await db()
    .from('align_facts')
    .select('id, fact, source, sector_id, node_id, created_at')
    .eq('archived', false)
    .or(ors.join(','))
    .order('created_at')
    .limit(200);
  return (data ?? []) as Fact[];
}

async function buildContext(target: BrainTarget, facts: Fact[]): Promise<string> {
  const parts: string[] = [`Today is ${todayISO()}.`];
  const s = target.sector;
  const top = target.topSector;
  if (top) {
    parts.push(
      `LIFE SECTOR: ${top.name}${s && s.id !== top.id ? `, area: ${s.name}` : ''}` +
        (top.summary?.trim() ? `\nWhat it means to him: ${top.summary.trim()}` : '') +
        (top.importance || top.satisfaction || top.attention_needed
          ? `\nRatings (1 to 10): importance ${top.importance ?? '?'}, satisfaction ${top.satisfaction ?? '?'}, attention needed ${top.attention_needed ?? '?'}`
          : '') +
        (top.mode ? `\nRight now this sector is: ${top.mode === 'priority' ? 'a current priority' : 'in maintain mode'}` : ''),
    );
  }

  let children: AlignNode[] = [];
  if (target.objectType === 'node' && target.node) {
    // The chain from the top of the tree down to this page.
    const chain: AlignNode[] = [];
    let cur: AlignNode | null = target.node;
    let guard = 0;
    while (cur?.parent_id && guard++ < 64) {
      const { data } = await db()
        .from('align_nodes')
        .select('id, type, title, body, done_criteria, cadence, effort_minutes, status, start_date, due_date, event_date, location, cost, link_url, parent_id')
        .eq('id', cur.parent_id)
        .maybeSingle();
      if (!data) break;
      chain.unshift(data as AlignNode);
      cur = data as AlignNode;
    }
    if (chain.length) parts.push(`PATH ABOVE THIS PAGE (top first):\n${chain.map((n, i) => `${i + 1}. ${line(n)}`).join('\n')}`);
    parts.push(`THIS PAGE:\n${line(target.node)}`);

    const [{ data: kids }, { data: sibs }] = await Promise.all([
      db().from('align_nodes').select('type, title, body, done_criteria, cadence, effort_minutes, status, start_date, due_date, event_date, location, cost').eq('parent_id', target.id).eq('archived', false).order('sort').limit(60),
      target.node.parent_id
        ? db().from('align_nodes').select('type, title, status').eq('parent_id', target.node.parent_id).eq('archived', false).neq('id', target.id).limit(30)
        : target.node.sector_id
          ? db().from('align_nodes').select('type, title, status').is('parent_id', null).eq('sector_id', target.node.sector_id).eq('archived', false).neq('id', target.id).limit(30)
          : db().from('align_nodes').select('type, title, status').is('parent_id', null).is('sector_id', null).eq('archived', false).neq('id', target.id).limit(30),
    ]);
    children = (kids ?? []) as AlignNode[];
    const siblings = (sibs ?? []) as AlignNode[];
    if (siblings.length) parts.push(`ALONGSIDE THIS PAGE (same parent):\n${siblings.map((n) => `- [${NODE_KINDS[n.type]?.label}] ${n.title}${n.status === 'done' ? ' (done)' : ''}`).join('\n')}`);
  } else if (s) {
    const [{ data: roots }, { data: areas }] = await Promise.all([
      db().from('align_nodes').select('type, title, body, done_criteria, cadence, effort_minutes, status, start_date, due_date, event_date, location, cost').is('parent_id', null).eq('sector_id', s.id).eq('archived', false).limit(60),
      db().from('align_sectors').select('name').eq('parent_id', s.id).eq('archived', false),
    ]);
    children = (roots ?? []) as AlignNode[];
    parts.push(`THIS PAGE: the ${s.parent_id ? 'area' : 'sector'} itself, "${s.name}".${s.summary?.trim() ? ` ${s.summary.trim()}` : ''}`);
    if (areas?.length) parts.push(`AREAS IN IT: ${(areas as { name: string }[]).map((a) => a.name).join(', ')}`);
  }

  parts.push(
    children.length
      ? `ALREADY UNDER THIS PAGE:\n${children.map((n) => `- ${line(n).replace(/\n/g, '\n  ')}`).join('\n')}`
      : 'ALREADY UNDER THIS PAGE: nothing yet.',
  );
  parts.push(facts.length ? `KNOWN FACTS ABOUT GIBSON:\n${facts.map((f) => `- ${f.fact}`).join('\n')}` : 'KNOWN FACTS ABOUT GIBSON: none yet.');
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// One turn
// ---------------------------------------------------------------------------

export class BrainError extends Error {}

export async function runBrain(target: BrainTarget, history: BrainMessage[], userTurn: string): Promise<BrainReply> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new BrainError('The brain is not connected yet. Add OPENAI_API_KEY in Vercel, then redeploy.');

  const allowed = nextTypes(target.objectType, target.node?.type);
  const facts = await loadFacts(target);
  const context = await buildContext(target, facts);
  const allowedLine = `Allowed types for proposals on this page: ${allowed.map((t) => `${t} (${NODE_KINDS[t].label})`).join(', ')}.`;

  // Earlier turns on this page, oldest first, kept short.
  const convo = history.slice(-12).map((m) =>
    m.role === 'user'
      ? { role: 'user' as const, content: m.content.slice(0, 4000) }
      : { role: 'assistant' as const, content: JSON.stringify(compact(m.data as BrainReply)).slice(0, 6000) },
  );

  const messages = [
    { role: 'system' as const, content: SYSTEM },
    { role: 'user' as const, content: `${context}\n\n${allowedLine}` },
    { role: 'assistant' as const, content: 'Understood. I have the full context for this page.' },
    ...convo,
    { role: 'user' as const, content: userTurn },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 110_000);
  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: brainModel(),
        messages,
        response_format: { type: 'json_schema', json_schema: { name: 'brain_step', strict: true, schema: schema(allowed) } },
      }),
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch (e) {
    throw new BrainError((e as Error).name === 'AbortError' ? 'The brain took too long to answer. Try again.' : 'Could not reach OpenAI. Try again in a moment.');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let detail = '';
    try {
      const j = (await res.json()) as { error?: { message?: string; code?: string } };
      detail = j.error?.code === 'model_not_found' ? `The model "${brainModel()}" is not available on this OpenAI key. Set ALIGN_BRAIN_MODEL in Vercel.` : j.error?.message ?? '';
    } catch {}
    if (res.status === 401) throw new BrainError('OpenAI rejected the key. Check OPENAI_API_KEY in Vercel.');
    if (res.status === 429) throw new BrainError('OpenAI is rate limiting or the account is out of credit. Try again shortly.');
    throw new BrainError(detail ? `OpenAI error: ${detail.slice(0, 240)}` : `OpenAI error (${res.status}). Try again.`);
  }

  const json = (await res.json()) as { choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[] };
  const choice = json.choices?.[0];
  if (choice?.message?.refusal) throw new BrainError('The brain declined this one. Reword the page or your message and try again.');
  if (choice?.finish_reason === 'length') throw new BrainError('The answer was cut off. Try again.');
  const content = choice?.message?.content;
  if (!content) throw new BrainError('The brain sent back nothing. Try again.');
  let reply: BrainReply;
  try {
    reply = JSON.parse(content) as BrainReply;
  } catch {
    throw new BrainError('The brain sent back something unreadable. Try again.');
  }
  return clean(reply, allowed);
}

function compact(r: BrainReply) {
  if (!r || typeof r !== 'object') return {};
  return {
    assessment: r.assessment,
    actionable: r.actionable,
    questions: (r.questions ?? []).map((q) => q.question),
    proposals: (r.proposals ?? []).map((p) => ({ type: p.type, title: p.title, status: p.status ?? 'open' })),
  };
}

const noDash = (s: string) => String(s ?? '').replace(/—/g, ', ').replace(/\s+,/g, ',').trim();

// Keeps the reply inside the rules even if the model drifts.
function clean(r: BrainReply, allowed: NodeType[]): BrainReply {
  return {
    assessment: noDash(r.assessment).slice(0, 2000),
    actionable: Boolean(r.actionable),
    gap: noDash(r.gap).slice(0, 600),
    questions: (r.questions ?? []).slice(0, 3).map((q) => ({
      question: noDash(q.question).slice(0, 400),
      why: noDash(q.why).slice(0, 300),
      options: (q.options ?? []).slice(0, 6).map((o) => noDash(o).slice(0, 120)).filter(Boolean),
    })),
    proposals: (r.proposals ?? [])
      .filter((p) => allowed.includes(p.type) && p.title?.trim())
      .slice(0, 7)
      .map((p) => ({
        type: p.type,
        title: noDash(p.title).replace(/\.$/, '').slice(0, 300),
        body: noDash(p.body).slice(0, 2000),
        done_criteria: noDash(p.done_criteria).slice(0, 600),
        effort_minutes: Number.isInteger(p.effort_minutes) && (p.effort_minutes as number) > 0 ? Math.min(p.effort_minutes as number, 100000) : null,
        cadence: noDash(p.cadence).slice(0, 120),
        start_date: isISODate(p.start_date) ? p.start_date : null,
        due_date: isISODate(p.due_date) && !(isISODate(p.start_date) && p.start_date > p.due_date) ? p.due_date : null,
        why: noDash(p.why).slice(0, 400),
        status: 'open' as const,
        created_id: null,
      })),
    facts_learned: (r.facts_learned ?? []).map((f) => noDash(f).slice(0, 500)).filter(Boolean).slice(0, 8),
  };
}
