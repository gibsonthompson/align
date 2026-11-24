import 'server-only';
import { db } from '@/lib/db';
import { NODE_KINDS } from '@/lib/kinds';
import { isISODate, todayISO } from '@/lib/format';
import type { AlignNode, BrainMessage, BrainReply, Fact, NodeType, ObjectType, Sector } from '@/lib/types';
import { FACT_COLS, factLine, factState, getLifestyle } from '@/lib/profile';
import { healthLines, planHealth } from '@/lib/capacity';
import { getHabits, getMeasures } from '@/lib/progress';
import { fmtValue, MODEL_STATUS_LABEL } from '@/lib/habits';
import { reviewEvidence } from '@/lib/review';

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
  if (objectType === 'sector') return ['vision', 'milestone', 'objective', 'project', 'micro_goal', 'experiment'];
  switch (nodeType) {
    case 'vision':
      return ['milestone', 'project'];
    case 'milestone':
      return ['objective', 'strategy', 'month', 'project'];
    case 'objective':
      return ['strategy', 'experiment', 'month', 'week', 'commitment', 'action', 'project'];
    case 'strategy':
      return ['experiment', 'month', 'week', 'commitment', 'action', 'project', 'task'];
    case 'experiment':
      return ['week', 'commitment', 'action', 'task'];
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

const SYSTEM = `You are the planning brain inside Align, Gibson's personal life operating system. You are a strategic life architect, not a task generator. The point of Align is a fulfilling life: productivity, money and goals are means, not the measure of him. Protect time for leisure, relationships, exploration, rest and unstructured enjoyment.

THE STRUCTURE
Five-Year Vision, then 12-Month Milestone, then 90-Day Objective, then Strategy, then the work (Months and Weeks, Weekly Commitments, Daily Actions, Tasks). Projects split into Phases (or Months and Weeks) and Tasks. Micro Goals split into Actions or Tasks. Not every goal needs every level.
- A Strategy is one way of reaching the goal above it, with a rationale: why it should work. A goal can hold several; any one can be replaced without restructuring the rest.
- An Experiment is a strategy on trial when the best route is uncertain: a hypothesis, a fixed window (start_date to due_date, usually 2 to 6 weeks), success_criteria it is judged by, and a review_date.
- A Month and a Week are dated stretches of a plan that builds toward a deadline. A Weekly Commitment is a recurring routine with a cadence and no end. Prefer a Weekly Commitment or routine over a pile of Daily Actions when the work repeats.
- Any page can be a real event: event_date, location, cost and link_url.

HOW YOU THINK, EVERY TURN
1. Understand. Read the whole path above this page, what is already under it, the profile facts, the lifestyle vision, the capacity picture, the measures and what is planned in other sectors. Facts marked ASSUMED or possibly out of date are not settled: confirm them before building on them when they matter.
2. Diagnose. Name the real underlying objective behind the page. Ask whether the proposed route attacks the root problem, whether a simpler or more enjoyable route exists, what it costs in time, money and energy, what it depends on, and what will get in the way. Put this in critique. Challenge his assumptions constructively and plainly; do not simply accept the strategy implied by the page.
3. Strategize. When there are genuinely different routes, propose two or three Strategies (or an Experiment when the best one is unclear) with a rationale for each, instead of jumping straight to tasks. Favor environmental design and routines that make the behavior part of his normal life over plans that rely on motivation and discipline.
4. Calculate. For a goal with a number, reverse-engineer it: baseline, target, the variables that drive it, the required rate, and realistic allowances for attrition, uncertainty, compounding and nonlinear growth. Never just divide an annual number into equal weeks. State the assumptions. Give conservative, realistic and ambitious scenarios when useful. For qualitative goals, plan controllable behaviors and periodic evaluation instead.
5. Validate against capacity. Check the capacity picture and everything already planned. Do not propose work that is reasonable alone but impossible together, and keep unplanned buffer intact. If the plan does not fit, say so in capacity_note and propose the trade-off (what to drop, defer or shrink), not more workload.
6. Cross-sector. Look for one activity that serves several sectors (a run club serves fitness, friendship and community). Never propose a page that duplicates something already planned elsewhere; say to link the existing one instead. Name real conflicts between sectors.
7. Ask what only he can answer. If the right next layer depends on his preferences, level, gear, budget, schedule or constraints and the facts do not cover it, ask first. At most 3 questions per turn, only ones whose answers change the plan, with 2 to 6 short concrete options when that speeds answering. Include discovery: when it would help, ask one adaptive question that could surface an overlooked goal, problem or opportunity, or the gap between how he lives now and how he wants to live.
8. Propose the next layer only, 2 to 7 pages of the allowed types, never repeating what exists.

QUALITY OF WHAT YOU PROPOSE
- Every Daily Action or Task: starts with a verb, names the exact object, names the method or tool when it matters, fits one sitting (90 minutes or less), has a measurable done criterion, effort_minutes, a sensible date, and serves the page above. "Work on business" or "get better at networking" never pass. Example: "Play bars 1 to 8 of the Wonderwall verse with a metronome at 60 BPM until 3 clean run-throughs, then raise it to 66".
- Strategy: title names the approach, rationale says why it should move the goal, done_criteria says what success looks like, review_date when to judge it (usually 2 to 6 weeks out).
- Experiment: hypothesis ("If I do X for N weeks, Y will improve by Z"), start_date and due_date for the window, success_criteria to judge it, review_date (the day after it ends).
- Weekly Commitment: cadence like "3 times a week, 45 minutes".
- Dates: work backward from any event_date or due_date above. Months and Weeks get start_date and due_date that fit inside the parent with no gaps, titled by what changes that period. Actions inside a Week get a due_date on a sensible day. No deadline above means no invented dates.
- Never invent venues, events, prices, schedules or facts. When something real is needed (a race, a class, a price), propose an action to look it up, or ask.

REPORTING
- assessment: two to four sentences on where this page stands and what you are doing this turn.
- critique: the honest read on the approach (real objective, root problem, better or simpler routes, risks). Empty only when there is nothing worth challenging.
- capacity_note: whether this fits the time, money and energy he has. Empty when capacity is not relevant to this page.
- actionable: true when the page already passes the test above (or is a commitment whose actions do); then propose more only if splitting genuinely helps.
- gap: one sentence on what still stands between this page and something he can do today. Empty when actionable.
- facts_learned: durable facts from his answers, as plain statements ("Has 30 minutes on weekday evenings"). Temporary circumstances only when they matter, saying they are temporary. Empty when nothing new.

Style: plain, direct, specific. No hype or motivational filler. Never use the words "tackle" or "tackling". Never use em dashes. Titles in sentence case.`;

function schema(allowed: NodeType[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['assessment', 'critique', 'capacity_note', 'actionable', 'gap', 'questions', 'proposals', 'facts_learned'],
    properties: {
      assessment: { type: 'string', description: 'Two to four sentences: where this page stands and what you are doing this turn.' },
      critique: { type: 'string', description: 'The honest read on the approach: real objective, root problem, better or simpler routes, risks. Empty if nothing to challenge.' },
      capacity_note: { type: 'string', description: 'Whether this fits his time, money and energy, and the trade-off if not. Empty if not relevant.' },
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
          required: ['type', 'title', 'body', 'done_criteria', 'effort_minutes', 'cadence', 'start_date', 'due_date', 'rationale', 'hypothesis', 'success_criteria', 'review_date', 'why'],
          properties: {
            type: { type: 'string', enum: allowed },
            title: { type: 'string' },
            body: { type: 'string' },
            done_criteria: { type: 'string' },
            effort_minutes: { type: ['integer', 'null'] },
            cadence: { type: 'string' },
            start_date: { type: ['string', 'null'], description: 'YYYY-MM-DD or null' },
            due_date: { type: ['string', 'null'], description: 'YYYY-MM-DD or null' },
            rationale: { type: 'string', description: 'Strategy: why this should move the goal. Empty otherwise.' },
            hypothesis: { type: 'string', description: 'Experiment: if I do X for N weeks, Y will change by Z. Empty otherwise.' },
            success_criteria: { type: 'string', description: 'Experiment: how it is judged. Empty otherwise.' },
            review_date: { type: ['string', 'null'], description: 'Strategy or experiment: YYYY-MM-DD to judge it. Null otherwise.' },
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
  Partial<Pick<AlignNode, 'start_date' | 'event_date' | 'location' | 'cost' | 'link_url' | 'rationale' | 'hypothesis' | 'success_criteria' | 'review_date' | 'verdict' | 'verdict_note'>>;

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
  if (n.rationale?.trim()) out += `\n   Why it should work: ${n.rationale.trim().slice(0, 600)}`;
  if (n.hypothesis?.trim()) out += `\n   Hypothesis: ${n.hypothesis.trim().slice(0, 400)}`;
  if (n.success_criteria?.trim()) out += `\n   Judged by: ${n.success_criteria.trim().slice(0, 400)}`;
  if (n.review_date) out += `\n   Review on: ${n.review_date}`;
  if (n.verdict) out += `\n   Last verdict: ${n.verdict}${n.verdict_note?.trim() ? ` (${n.verdict_note.trim().slice(0, 300)})` : ''}`;
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
    .select(FACT_COLS)
    .eq('archived', false)
    .eq('sensitive', false)
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
        (top.mode ? `\nRight now this sector is: ${top.mode === 'priority' ? 'a current priority' : 'in maintain mode'}` : '') +
        (top.current_state?.trim() ? `\nWhere it is now: ${top.current_state.trim().slice(0, 1200)}` : '') +
        (top.desired_state?.trim() ? `\nWhere he wants it: ${top.desired_state.trim().slice(0, 1200)}` : '') +
        (top.weekly_hours !== null && top.weekly_hours !== undefined ? `\nTime budget: ${top.weekly_hours} hours a week` : '') +
        (top.monthly_budget !== null && top.monthly_budget !== undefined ? `\nMoney budget: $${top.monthly_budget} a month` : ''),
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
        .select('id, type, title, body, done_criteria, cadence, effort_minutes, status, start_date, due_date, event_date, location, cost, link_url, parent_id, rationale, hypothesis, success_criteria, review_date, verdict, verdict_note')
        .eq('id', cur.parent_id)
        .maybeSingle();
      if (!data) break;
      chain.unshift(data as AlignNode);
      cur = data as AlignNode;
    }
    if (chain.length) parts.push(`PATH ABOVE THIS PAGE (top first):\n${chain.map((n, i) => `${i + 1}. ${line(n)}`).join('\n')}`);
    parts.push(`THIS PAGE:\n${line(target.node)}`);

    const [{ data: kids }, { data: sibs }] = await Promise.all([
      db().from('align_nodes').select('type, title, body, done_criteria, cadence, effort_minutes, status, start_date, due_date, event_date, location, cost, rationale, hypothesis, success_criteria, review_date, verdict').eq('parent_id', target.id).eq('archived', false).order('sort').limit(60),
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
  parts.push(facts.length ? `PROFILE FACTS ABOUT GIBSON:\n${facts.filter((f) => factState(f) !== 'expired').map((f) => `- ${factLine(f)}`).join('\n')}` : 'PROFILE FACTS ABOUT GIBSON: none yet.');
  parts.push(...(await wideContext(target)));
  return parts.join('\n\n');
}

// Everything outside this page that should shape it: the lifestyle he is
// building, his real capacity, the numbers, and what other sectors already hold.
async function wideContext(target: BrainTarget): Promise<string[]> {
  const out: string[] = [];
  const safe = async <T,>(f: () => Promise<T>): Promise<T | null> => {
    try {
      return await f();
    } catch {
      return null;
    }
  };
  const [life, health, measures, habits, others, evidence] = await Promise.all([
    safe(getLifestyle),
    safe(() => planHealth()),
    safe(getMeasures),
    safe(getHabits),
    safe(async () => {
      const { data } = await db()
        .from('align_nodes')
        .select('id, type, title, sector_id, cadence')
        .eq('archived', false)
        .in('status', ['active', 'planned'])
        .in('type', ['objective', 'strategy', 'experiment', 'commitment', 'project'])
        .order('updated_at', { ascending: false })
        .limit(80);
      const { data: secs } = await db().from('align_sectors').select('id, name, parent_id');
      const sec = new Map(((secs ?? []) as { id: string; name: string; parent_id: string | null }[]).map((x) => [x.id, x]));
      const topName = (id: string | null) => {
        let x = id ? sec.get(id) : undefined;
        while (x?.parent_id) x = sec.get(x.parent_id);
        return x?.name ?? 'Unfiled';
      };
      return ((data ?? []) as { id: string; type: NodeType; title: string; sector_id: string | null; cadence: string }[])
        .filter((n) => n.id !== target.id)
        .map((n) => `- [${NODE_KINDS[n.type]?.label}] ${n.title}${n.cadence ? ` (${n.cadence})` : ''}, in ${topName(n.sector_id)}`);
    }),
    target.node && (target.node.type === 'strategy' || target.node.type === 'experiment' || target.node.type === 'objective') ? safe(() => reviewEvidence(target.id)) : Promise.resolve(null),
  ]);
  if (life && (life.vision || life.non_negotiables.length)) {
    out.push(
      `THE LIFE HE IS BUILDING:${life.vision ? `\n${life.vision.slice(0, 2000)}` : ''}${life.non_negotiables.length ? `\nNon-negotiables: ${life.non_negotiables.join('; ')}` : ''}`,
    );
  }
  if (health) out.push(`CAPACITY:\n${healthLines(health)}`);
  if (measures?.length) {
    const ids = new Set([target.id]);
    const rel = measures.filter((m) => (m.node_id && ids.has(m.node_id)) || (!m.node_id && m.sector_id && m.sector_id === target.topSector?.id));
    const show = (rel.length ? rel : measures).slice(0, 12);
    out.push(
      `${rel.length ? 'NUMBERS FOR THIS PAGE' : 'NUMBERS HE TRACKS'}:\n` +
        show
          .map((m) => {
            const md = m.model;
            const bits = [`- ${m.name}: ${fmtValue(m.stat.current, m.unit)} (${m.stat.periodLabel.toLowerCase()})`];
            if (m.target_value !== null) bits.push(`target ${fmtValue(m.target_value, m.unit)}${m.target_date ? ` by ${m.target_date}` : ''}`);
            if (md && md.status !== 'no_target') bits.push(MODEL_STATUS_LABEL[md.status].toLowerCase());
            if (md?.ratePerWeek !== null && md?.ratePerWeek !== undefined) bits.push(`recent pace ${md.ratePerWeek.toFixed(2)}/week`);
            if (md?.requiredPerWeek !== null && md?.requiredPerWeek !== undefined) bits.push(`needs ${md.requiredPerWeek.toFixed(2)}/week from here`);
            if (md?.needsRecalc) bits.push('PLAN NEEDS RECALCULATING');
            if (m.assumptions?.length) bits.push(`assumes: ${m.assumptions.map((a) => `${a.text}${a.confirmed ? '' : ' (unconfirmed)'}`).join('; ')}`);
            return bits.join(', ');
          })
          .join('\n'),
    );
  }
  if (habits?.length) out.push(`HABITS RUNNING:\n${habits.filter((h) => !h.paused).slice(0, 20).map((h) => `- ${h.node.title}: ${h.stat.weekDone} of ${h.stat.weekTarget} this week, streak ${h.stat.streak}`).join('\n')}`);
  if (others?.length) out.push(`ALREADY PLANNED ELSEWHERE (do not duplicate; link instead):\n${others.slice(0, 60).join('\n')}`);
  if (evidence)
    out.push(
      `HOW THIS IS GOING (${evidence.period.from} to ${evidence.period.to}): ${evidence.diagnosis}` +
        (evidence.execution !== null ? ` Execution ${Math.round(evidence.execution * 100)}%.` : '') +
        (evidence.previous_reviews.length ? ` Earlier verdicts: ${evidence.previous_reviews.map((r) => `${r.created_at.slice(0, 10)} ${r.verdict}`).join(', ')}.` : ''),
    );
  return out;
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
    critique: noDash(r.critique ?? '').slice(0, 3000),
    capacity_note: noDash(r.capacity_note ?? '').slice(0, 1500),
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
        rationale: noDash(p.rationale ?? '').slice(0, 3000),
        hypothesis: noDash(p.hypothesis ?? '').slice(0, 1500),
        success_criteria: noDash(p.success_criteria ?? '').slice(0, 1500),
        review_date: isISODate(p.review_date) ? p.review_date : null,
        why: noDash(p.why).slice(0, 400),
        status: 'open' as const,
        created_id: null,
      })),
    facts_learned: (r.facts_learned ?? []).map((f) => noDash(f).slice(0, 500)).filter(Boolean).slice(0, 8),
  };
}
