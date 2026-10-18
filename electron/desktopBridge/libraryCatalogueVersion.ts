import {createHash} from 'node:crypto';
import {canonicalJson} from '../../shared/canonicalJson';

/** A refresh timestamp is not a new catalogue version. Retain the existing
 * wire stamp while the scoped immutable metadata stays exactly the same. */
export function retainLibraryCatalogueVersion<T extends {generatedAt: string}>(previous: T | undefined, next: T): T {
  if (!previous) return next;
  const fingerprint = (value: T) => createHash('sha256').update(canonicalJson({...value, generatedAt: null})).digest('hex');
  if (fingerprint(previous) === fingerprint(next)) next.generatedAt = previous.generatedAt;
  return next;
}
