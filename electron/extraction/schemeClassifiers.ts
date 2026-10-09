import * as layout2 from './schemeLayout2';
import * as current from './schemeLayout';

/**
 * Every scheme classifier a decluttered work can be bound to. A work keeps the classifier its
 * text was first extracted with, so changing the rules for new works never changes the text
 * (and so the passages and analysis) of a work already in use. Older classifiers are frozen
 * copies; only the current one is ever edited.
 */
export type SchemeClassifier = typeof layout2.SCHEME_LAYOUT_CLASSIFIER | typeof current.SCHEME_LAYOUT_CLASSIFIER;

export const CURRENT_SCHEME_CLASSIFIER: SchemeClassifier = current.SCHEME_LAYOUT_CLASSIFIER;

/** What extraction uses from a classifier; both modules provide it. */
type Classifier = Pick<typeof current, 'pageSchemeLayout' | 'typeSizeWeights' | 'bodySizeOf'>;

const BY_ID: Record<SchemeClassifier, Classifier> = {
  [layout2.SCHEME_LAYOUT_CLASSIFIER]: layout2,
  [current.SCHEME_LAYOUT_CLASSIFIER]: current,
};

export function isSchemeClassifier(id: unknown): id is SchemeClassifier {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(BY_ID, id);
}

export function schemeClassifier(id: SchemeClassifier = CURRENT_SCHEME_CLASSIFIER): Classifier {
  return BY_ID[id];
}
