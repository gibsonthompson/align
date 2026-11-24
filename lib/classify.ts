import 'server-only';
import { db } from '@/lib/db';
import { brainModel } from '@/lib/brain';
import { normalise, scoreAreas } from '@/lib/classify-rules';
import type { Sector } from '@/lib/types';

export interface SectorGuess {
  sectorId: string;
  name: string; // "Business & Career · Business Growth"
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'for', 'with', 'to', 'of', 'on', 'in', 'at', 'my', 'me', 'i', 'call', 'time', 'block', 'session', 'do', 'get', 'go', 'up', 'new']);

function words(text: string): string[] {
  return normalise(text)
    .split(' ')
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
}

function label(all: Sector[], s: Sector): string {
  const p = s.parent_id ? all.find((x) => x.id === s.parent_id) : null;
  return p ? `${p.name} · ${s.name}` : s.name;
}

// Picks the sector or area a calendar block most likely belongs to, from its title
// and notes. Learns from Gibson's own past blocks first, then his pages, then word
// rules, and asks the model only when none of those is confident.
export async function guessSector(title: string, notes = '', opts: { allowAi?: boolean } = {}): Promise<SectorGuess | null> {
  const text = `${title} ${notes}`.trim();
  if (text.length < 2) return null;
  const { data: secs } = await db().from('align_sectors').select('id, slug, name, parent_id, colour, archived').eq('archived', false);
  const all = (secs ?? []) as Sector[];
  const bySlug = new Map(all.map((s) => [s.slug, s]));
  const titleWords = words(title);

  // 1. His own history: blocks with the same or a very similar title.
  if (titleWords.length) {
    const { data: past } = await db()
      .from('align_blocks')
      .select('title, sector_id, sector_auto, node_id')
      .not('sector_id', 'is', null)
      .is('node_id', null)
      .order('created_at', { ascending: false })
      .limit(400);
    const votes = new Map<string, { n: number; title: string }>();
    for (const b of (past ?? []) as { title: string; sector_id: string; sector_auto: boolean }[]) {
      const bw = words(b.title);
      if (!bw.length) continue;
      const shared = titleWords.filter((w) => bw.includes(w)).length;
      const exact = normalise(b.title) === normalise(title);
      const strong = exact || (shared >= 2 && shared / Math.min(bw.length, titleWords.length) >= 0.6) || (shared >= 1 && bw.length === 1 && titleWords.length === 1);
      if (!strong) continue;
      // His own picks count more than earlier guesses.
      const weight = (exact ? 3 : 1) * (b.sector_auto ? 1 : 2);
      const v = votes.get(b.sector_id) ?? { n: 0, title: b.title };
      v.n += weight;
      votes.set(b.sector_id, v);
    }
    const best = [...votes].sort((a, b) => b[1].n - a[1].n)[0];
    if (best && best[1].n >= 2) {
      const s = all.find((x) => x.id === best[0]);
      if (s) return { sectorId: s.id, name: label(all, s), confidence: best[1].n >= 4 ? 'high' : 'medium', reason: `Like your earlier "${best[1].title}"` };
    }
  }

  // 2. A page whose title it names.
  if (titleWords.length) {
    const { data: hits } = await db().rpc('align_search', { p_q: title.slice(0, 120), p_limit: 6, p_types: ['node'] });
    for (const h of (hits ?? []) as { title: string; sector_id: string | null }[]) {
      if (!h.sector_id) continue;
      const hw = words(h.title);
      const shared = titleWords.filter((w) => hw.includes(w)).length;
      if (shared >= 2 || (shared >= 1 && Math.min(hw.length, titleWords.length) === 1)) {
        const s = all.find((x) => x.id === h.sector_id);
        if (s) return { sectorId: s.id, name: label(all, s), confidence: 'medium', reason: `Matches your page "${h.title}"` };
      }
    }
  }

  // 3. Word rules.
  const scored = scoreAreas(title, notes).filter((r) => bySlug.has(r.slug));
  const top = scored[0];
  const runnerUp = scored[1];
  if (top) {
    const s = bySlug.get(top.slug)!;
    const clear = !runnerUp || top.score >= runnerUp.score * 1.5;
    const confidence = top.score >= 4.5 && clear ? 'high' : top.score >= 3 ? 'medium' : 'low';
    if (confidence !== 'low' || !opts.allowAi || !process.env.OPENAI_API_KEY) {
      return { sectorId: s.id, name: label(all, s), confidence, reason: `Mentions "${top.hits.slice(0, 2).join('", "')}"` };
    }
  }

  // 4. Ask the model, only when allowed and nothing above was sure.
  if (opts.allowAi && process.env.OPENAI_API_KEY) {
    const ai = await askModel(title, notes, all).catch(() => null);
    if (ai) return ai;
  }
  if (top) {
    const s = bySlug.get(top.slug)!;
    return { sectorId: s.id, name: label(all, s), confidence: 'low', reason: `Mentions "${top.hits[0]}"` };
  }
  return null;
}

async function askModel(title: string, notes: string, all: Sector[]): Promise<SectorGuess | null> {
  const areas = all
    .filter((s) => s.parent_id)
    .map((s) => `${s.slug}: ${label(all, s)}`)
    .join('\n');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
      body: JSON.stringify({
        model: brainModel(),
        messages: [
          {
            role: 'system',
            content:
              "You file calendar entries for Gibson, a solo founder in North Georgia (VoiceAI Connect, CallBird, ScopeBook, Haul It All, GTC Group; employed at RSA). Pick the single life area the entry belongs to. Answer with the slug only from the list, or 'none' if nothing fits.",
          },
          { role: 'user', content: `Areas:\n${areas}\n\nEntry title: ${title}\nNotes: ${notes || '(none)'}` },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'area',
            strict: true,
            schema: { type: 'object', additionalProperties: false, required: ['slug', 'sure'], properties: { slug: { type: 'string' }, sure: { type: 'boolean' } } },
          },
        },
      }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const parsed = JSON.parse(j.choices?.[0]?.message?.content ?? '{}') as { slug?: string; sure?: boolean };
    const s = all.find((x) => x.slug === parsed.slug);
    if (!s) return null;
    return { sectorId: s.id, name: label(all, s), confidence: parsed.sure ? 'medium' : 'low', reason: 'Read from the title and notes' };
  } finally {
    clearTimeout(timer);
  }
}
