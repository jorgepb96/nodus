import type { SignPlacement } from '@shared/signTypes';

export type SignPageTarget = { mode: 'current' | 'all' | 'custom'; range: string };

/** Strict page ranges: reject mistakes rather than silently signing the wrong pages. */
export function resolveSignPages(target: SignPageTarget, current: number, count: number): number[] {
  if (!Number.isInteger(count) || count < 1) return [];
  if (target.mode === 'current') return Number.isInteger(current) && current >= 1 && current <= count ? [current] : [];
  if (target.mode === 'all') return Array.from({ length: count }, (_, i) => i + 1);
  const pages = new Set<number>();
  for (const part of target.range.split(',')) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!match) return [];
    const first = Number(match[1]), last = Number(match[2] ?? match[1]);
    if (first < 1 || last < first || last > count) return [];
    for (let page = first; page <= last; page++) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

/** Reapplying a group replaces its copies, leaving unrelated signatures intact. */
export function applyPlacementPages(placements: SignPlacement[], selected: SignPlacement, pages: number[], id = () => crypto.randomUUID()): SignPlacement[] {
  const groupId = selected.groupId ?? selected.id;
  const copies = pages.map((page, index) => ({ ...selected, page, groupId, id: index === 0 ? selected.id : id() }));
  return [...placements.filter(p => (p.groupId ?? p.id) !== groupId), ...copies];
}
