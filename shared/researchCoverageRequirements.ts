import { validResearchAnswerQuotes } from './researchChatGrounding';

export interface ResearchCoverageRequirement {
  id: string;
  complaint: string;
  kind: 'available-fact' | 'unaddressed-limit';
  requiredFact: string;
  sourceId: string | null;
  quote: string | null;
}

export interface ResearchCoverageRequirementClaim {
  id: string;
  sentence: string;
  kind: 'fact' | 'attributed' | 'inference' | 'nonfactual';
  evidence: Array<{ id: string; quote: string }>;
}

export interface ResearchCoverageRequirementProof {
  addressed: Array<{ requirementId: string; claimIds: string[]; answerQuotes: string[] }>;
  omissions: Array<{ requirementId: string }>;
}

export interface ResearchCoverageComplaintAddressed {
  complaint: string;
  kind: 'available-fact' | 'unaddressed-limit';
  requiredFact: string;
  sourceId: string | null;
  quote: string | null;
  claimIds: string[];
  answerQuotes: string[];
}

const plainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const validText = (value: unknown, min = 8, max = 1200): value is string =>
  typeof value === 'string' && value.trim().length >= min && value.length <= max;
const normalized = (value: string) => value.normalize('NFC').replace(/\s+/gu, ' ').trim();

/**
 * Compare source quotations without weakening their factual content. Only
 * terminal sentence punctuation is optional; punctuation inside quantities,
 * decimals, abbreviations, or the quoted text remains significant.
 */
function sameSourceQuote(required: string, cited: string): boolean {
  const stripTerminalPunctuation = (value: string) => normalized(value).replace(/[.!?。！？…]+$/u, '').trim();
  const a = stripTerminalPunctuation(required), b = normalized(cited);
  if (a.length < 8) return false;
  let offset = b.indexOf(a);
  while (offset >= 0) {
    const before = offset ? b[offset - 1] : '';
    const after = b[offset + a.length] ?? '';
    const word = (char: string) => Boolean(char) && /[\p{L}\p{N}_]/u.test(char);
    if (!word(before) && !word(after)) return true;
    offset = b.indexOf(a, offset + 1);
  }
  return false;
}

/** Join literal evidence from supported premises without skipping source text.
 * Every selected claim must contribute evidence from the required source;
 * only whitespace may remain between the covered spans. */
function sameSourceEvidenceUnion(
  required: string,
  sourceId: string,
  chosen: readonly ResearchCoverageRequirementClaim[],
): boolean {
  const target = normalized(required).replace(/[.!?。！？…]+$/u, '').trim();
  if (target.length < 8) return false;
  const covered = new Uint8Array(target.length);
  const word = (char: string) => Boolean(char) && /[\p{L}\p{N}_]/u.test(char);
  for (const claim of chosen) {
    let contributed = false;
    for (const evidence of claim.evidence) {
      if (evidence.id !== sourceId) continue;
      // Preserve acceptance of a single wider quotation containing the target.
      if (sameSourceQuote(required, evidence.quote)) {
        covered.fill(1);
        contributed = true;
        continue;
      }
      const cited = normalized(evidence.quote);
      // Prefer exact punctuation; optional terminal punctuation cannot bridge
      // a missing decimal, negation, connective, or sentence delimiter.
      const span = target.includes(cited) ? cited : cited.replace(/[.!?。！？…]+$/u, '').trim();
      if (span.length < 8) continue;
      let start = target.indexOf(span);
      while (start >= 0) {
        const end = start + span.length;
        if (!word(target[start - 1] ?? '') && !word(target[end] ?? '')) {
          covered.fill(1, start, end);
          contributed = true;
        }
        start = target.indexOf(span, start + 1);
      }
    }
    if (!contributed) return false;
  }
  return covered.every((value, index) => value === 1 || /\s/u.test(target[index]));
}

function validRequirement(requirement: ResearchCoverageRequirement): boolean {
  if (!plainObject(requirement) || !validText(requirement.id, 1, 160)
    || !validText(requirement.complaint, 2, 600) || !validText(requirement.requiredFact, 8, 600)) return false;
  if (requirement.kind === 'available-fact') {
    return validText(requirement.sourceId, 1, 512) && validText(requirement.quote, 8, 1500);
  }
  return requirement.kind === 'unaddressed-limit' && requirement.sourceId === null && requirement.quote === null;
}

function validClaim(claim: ResearchCoverageRequirementClaim): boolean {
  if (!plainObject(claim) || !validText(claim.id, 1, 160) || !validText(claim.sentence, 1, 4000)
    || !['fact', 'attributed', 'inference', 'nonfactual'].includes(claim.kind)
    // The prose auditor allows up to 12 premises, each with up to 6 quotes.
    || !Array.isArray(claim.evidence) || claim.evidence.length > 72) return false;
  // Callers pass supported claims only. If the backend record is passed through
  // with its status field, fail closed unless it is explicitly supported.
  if ('status' in claim && claim.status !== 'supported') return false;
  return claim.evidence.every(item => plainObject(item) && validText(item.id, 1, 512) && validText(item.quote, 8, 1500));
}

/** Validate that each carried coverage obligation is either independently
 * discharged by currently supported prose or remains an explicit omission. */
export function validateResearchCoverageRequirementProof(
  input: unknown,
  requirements: readonly ResearchCoverageRequirement[],
  answer: string,
  claims: readonly ResearchCoverageRequirementClaim[],
): input is ResearchCoverageRequirementProof {
  if (!plainObject(input) || Object.keys(input).some(key => key !== 'addressed' && key !== 'omissions')
    || !Array.isArray(input.addressed) || !Array.isArray(input.omissions)
    || !Array.isArray(requirements) || requirements.length > 12
    || !validText(answer, 1, 100_000) || !Array.isArray(claims) || claims.length > 200) return false;
  if (!requirements.every(validRequirement) || new Set(requirements.map(row => row.id)).size !== requirements.length
    || !claims.every(validClaim) || new Set(claims.map(claim => claim.id)).size !== claims.length) return false;
  if (input.addressed.length + input.omissions.length !== requirements.length) return false;

  const requirementById = new Map(requirements.map(row => [row.id, row]));
  const claimById = new Map(claims.map(claim => [claim.id, claim]));
  const seen = new Set<string>();

  for (const row of input.addressed) {
    if (!plainObject(row) || Object.keys(row).some(key => !['requirementId', 'claimIds', 'answerQuotes'].includes(key))
      || typeof row.requirementId !== 'string' || !requirementById.has(row.requirementId) || seen.has(row.requirementId)
      || !Array.isArray(row.claimIds) || row.claimIds.length < 1 || row.claimIds.length > 6
      || !Array.isArray(row.answerQuotes) || row.answerQuotes.length < 1 || row.answerQuotes.length > 6
      || !row.claimIds.every(id => typeof id === 'string')) return false;
    const requirement = requirementById.get(row.requirementId)!;
    const selectedClaims = row.claimIds.map(id => claimById.get(id));
    if (selectedClaims.some(claim => !claim) || new Set(row.claimIds).size !== row.claimIds.length) return false;
    const chosen = selectedClaims as ResearchCoverageRequirementClaim[];
    const maxChars = 4000;
    if (!validResearchAnswerQuotes(answer, { answerQuotes: row.answerQuotes as string[] }, maxChars)) return false;
    if (row.answerQuotes.some(quote => !chosen.some(claim => validResearchAnswerQuotes(claim.sentence,
      { answerQuotes: [quote] }, maxChars)))) return false;

    if (requirement.kind === 'available-fact') {
      if (!sameSourceEvidenceUnion(requirement.quote!, requirement.sourceId!, chosen)) return false;
    } else if (chosen.some(claim => claim.kind !== 'nonfactual' && claim.kind !== 'inference')) return false;
    seen.add(row.requirementId);
  }

  for (const row of input.omissions) {
    if (!plainObject(row) || Object.keys(row).some(key => key !== 'requirementId')
      || typeof row.requirementId !== 'string' || !requirementById.has(row.requirementId) || seen.has(row.requirementId)) return false;
    seen.add(row.requirementId);
  }
  return seen.size === requirements.length;
}

/** Validate a negative-critic complaint that an independent adjudicator says is
 * already addressed. Literal answer presence alone is insufficient: available
 * facts need supported claims with same-source quote evidence; limit complaints
 * need supported nonfactual or inference claims. Semantic relevance of the claim
 * to the complaint remains the adjudicator's judgment. */
export function validateResearchCoverageComplaintAddressed(
  input: unknown,
  answer: string,
  claims: readonly ResearchCoverageRequirementClaim[],
): input is ResearchCoverageComplaintAddressed {
  if (!plainObject(input) || Object.keys(input).some(key => ![
    'complaint', 'kind', 'requiredFact', 'sourceId', 'quote', 'claimIds', 'answerQuotes',
  ].includes(key))) return false;
  const row = input as unknown as ResearchCoverageComplaintAddressed;
  if (!validText(row.complaint, 2, 600) || !validText(row.requiredFact, 8, 600)
    || !Array.isArray(row.claimIds) || row.claimIds.length < 1 || row.claimIds.length > 6
    || !row.claimIds.every(id => typeof id === 'string') || new Set(row.claimIds).size !== row.claimIds.length
    || !Array.isArray(row.answerQuotes) || row.answerQuotes.length < 1 || row.answerQuotes.length > 6) return false;
  const requirement: ResearchCoverageRequirement = {
    id: 'complaint', complaint: row.complaint, kind: row.kind, requiredFact: row.requiredFact,
    sourceId: row.sourceId, quote: row.quote,
  };
  return validateResearchCoverageRequirementProof({
    addressed: [{ requirementId: requirement.id, claimIds: row.claimIds, answerQuotes: row.answerQuotes }], omissions: [],
  }, [requirement], answer, claims);
}
