/* global __NODUS_SUPPORT_SOURCE_SHA256__ */
import { assert } from './files.mjs';
export const compiledSupportSource=typeof __NODUS_SUPPORT_SOURCE_SHA256__==='string'?__NODUS_SUPPORT_SOURCE_SHA256__:null;
export function qualifiedRepairsFor(catalog,platform,arch,source=compiledSupportSource) {
  if(catalog?.format!=='nodus.support-qualified-repairs/2'||catalog.protocol!==1||!/^[a-f0-9]{64}$/.test(source??'')||catalog.sourceSha256!==source)return [];
  const actions=catalog.platforms?.[`${platform}-${arch}`];return Array.isArray(actions)?actions:[];
}
export function requireQualified(catalog,platform,arch,repair,source=compiledSupportSource) {
  assert(qualifiedRepairsFor(catalog,platform,arch,source).includes(repair),'REPAIR_NOT_QUALIFIED');
}
