import { assert } from './files.mjs';

export function requireQualified(catalog, platform, arch, repair) {
  assert(catalog?.format === 'nodus.support-qualified-repairs/1' && catalog.protocol === 1 && catalog.platforms?.[`${platform}-${arch}`]?.includes(repair), 'REPAIR_NOT_QUALIFIED');
}
