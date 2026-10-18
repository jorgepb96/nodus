/** Closed native transport contract. It constrains structure, never truth:
 * runtime source/quote binding and independent semantic review still decide. */
const object = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const string = { type: 'string' };
const boolean = { type: 'boolean' };
const array = (items: Record<string, unknown>, maxItems: number) => ({ type: 'array', items, maxItems });
const indices = array({ type: 'integer', minimum: 0 }, 64);
const issues = array(string, 20);
const premise = object({ text: string, type: { type: 'string', enum: ['fact', 'attribution', 'absence', 'relation', 'inference'] }, entailed: boolean,
  evidence: array(object({ id: string, quote: string }), 6), from: indices, fromParagraphs: indices });
export const RESEARCH_DOCUMENT_PROOF_SCHEMA = object({ parts: array(object({ id: string, claims: array(object({
  index: { type: 'integer', minimum: 0 }, kind: { type: 'string', enum: ['fact', 'attributed', 'inference', 'nonfactual'] },
  premises: array(premise, 12), unsupportedParts: issues, explicitInference: boolean, supported: boolean, reason: string,
}), 64), coherent: boolean, relevant: boolean, complete: boolean, issues }), 8) });
export const RESEARCH_DOCUMENT_SEMANTIC_SCHEMA = object({ parts: array(object({ id: string, supported: boolean, issues: array(string, 3) }), 8) });
export const RESEARCH_DOCUMENT_REVISION_SCHEMA = object({ parts: array(object({ id: string, text: string }), 8) });
