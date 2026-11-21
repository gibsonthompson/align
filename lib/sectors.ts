import type { Sector } from '@/lib/types';
import type { SectorLookup } from '@/components/ObjectRow';

// Name and colour for every sector and area, so any row can show where it lives.
export function sectorLookup(sectors: Sector[]): SectorLookup {
  const out: SectorLookup = {};
  for (const s of sectors) {
    const parent = s.parent_id ? sectors.find((p) => p.id === s.parent_id) : null;
    out[s.id] = { name: parent ? `${parent.name} · ${s.name}` : s.name, colour: s.colour };
  }
  return out;
}
