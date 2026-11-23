const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isId(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}

export function cleanText(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

// Keeps line breaks, trims the ends.
export function cleanBody(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, max) : '';
}

export function slugify(v: string): string {
  return v
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

// A web link: '' clears it, a bare domain gets https://, anything else invalid is null.
export function cleanLink(v: unknown): string | null {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'string') return null;
  let s = v.trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) {
    if (/\s/.test(s) || !/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$|\?|#)/i.test(s)) return null;
    s = `https://${s}`;
  }
  if (s.length > 2000) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}
