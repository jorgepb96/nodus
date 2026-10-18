/** Reading and presenting the transformations program mode may use.
 *
 *  The list belongs to the chemistry package, which ships it and executes it; this only parses and
 *  presents what the package shipped. Restating any of it here would mean a transformation named in
 *  two places, and the prompt could then offer one the package does not have.
 *
 *  Pure on purpose: finding the installed package is the application's job (it needs the user's
 *  data directory), while parsing and wording are the same everywhere and are testable without it.
 */
export interface RouteTransform {
  id: string;
  summary: string;
  /** What the transformation acts at, as the package words it. */
  site?: string;
}

/** The transformations in a package's `route_transforms.json`, ignoring anything malformed.
 *
 *  Defensive rather than strict: a package is separately versioned and may add fields or ship an
 *  entry this build does not understand. One unreadable entry must not cost the whole list, because
 *  an empty list silently turns program mode into a contract the model cannot follow. */
export function parseRouteTransforms(data: unknown): RouteTransform[] {
  const transforms = (data as { transforms?: unknown })?.transforms;
  if (!Array.isArray(transforms)) return [];
  const seen = new Set<string>();
  const out: RouteTransform[] = [];
  for (const entry of transforms) {
    const { id, summary, site } = (entry ?? {}) as { id?: unknown; summary?: unknown; site?: unknown };
    if (typeof id !== 'string' || !id.trim() || typeof summary !== 'string' || !summary.trim()) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, summary: summary.trim(), ...(typeof site === 'string' && site.trim() ? { site: site.trim() } : {}) });
  }
  return out;
}

/** The block appended to a program-mode request, or '' when the list is empty.
 *
 *  Each line carries the site the transformation acts at, because the contract lets the model omit
 *  `site:` only when the molecule offers one such place — which it cannot judge without knowing
 *  what the transformation looks for. */
export function routeProgramTransformsBlock(transforms: RouteTransform[]): string {
  if (!transforms.length) return '';
  return [
    'The transformations you may use, and nothing else. Use the id exactly as written:',
    ...transforms.map((entry) => `  ${entry.id}${entry.site ? ` (acts at: ${entry.site})` : ''} — ${entry.summary}`),
  ].join('\n');
}
