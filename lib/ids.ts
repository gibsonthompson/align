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
