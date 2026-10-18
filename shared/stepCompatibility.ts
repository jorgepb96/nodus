import { formatTextbookCitation, TEXTBOOK_ID, type TextbookCitation } from './textbookSchemes';

/**
 * Functional-group compatibility of a route's steps (Chemistry Studio's check-compatibility tool):
 * a group that survives from substrate to product although a reagent named in the step's
 * conditions attacks it (an ester through LiAlH4, a free OH beside a Grignard, a Cbz through H2/Pd),
 * and a protecting group that vanishes with no reagent that removes it. Each hazard says how to keep
 * the group, as in Greene's Protective Groups, and may carry textbook examples of putting that
 * protecting group on. A heuristic: a flag is a question to check, not a verdict.
 */

export interface CompatibilityHazard {
  group: string;
  groupLabel: string;
  reagentClass: string | null;
  reagentLabel: string | null;
  severity: 'high' | 'medium';
  why: string;
  suggestion: string | null;
  protectedForms: string[];
  /** Textbook records ("tb-…") that put a protected form on. */
  examples: Array<{ form: string; records: string[] }>;
}

export interface StepCompatibility {
  /** 1-based route step. */
  step: number;
  reagentClasses: Array<{ id: string; label: string }>;
  hazards: CompatibilityHazard[];
}

const MAX_HAZARDS_PER_STEP = 6;
const MAX_TEXT = 400;

function text(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** The tool's artifact data, validated; anything malformed is dropped rather than shown. */
export function normalizeCompatibility(data: unknown): StepCompatibility[] {
  const list = (data as { compatibility?: unknown } | null)?.compatibility;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry): StepCompatibility[] => {
    const step = (entry as { step?: unknown })?.step;
    if (!Number.isInteger(step) || (step as number) < 1) return [];
    const classes = Array.isArray((entry as { reagentClasses?: unknown }).reagentClasses) ? (entry as { reagentClasses: unknown[] }).reagentClasses : [];
    const hazards = Array.isArray((entry as { hazards?: unknown }).hazards) ? (entry as { hazards: unknown[] }).hazards : [];
    return [{
      step: step as number,
      reagentClasses: classes.flatMap((value) => {
        const id = text((value as { id?: unknown })?.id, 60);
        const label = text((value as { label?: unknown })?.label, 120);
        return id && label ? [{ id, label }] : [];
      }),
      hazards: hazards.flatMap((value): CompatibilityHazard[] => {
        const hazard = value as Record<string, unknown> | null;
        const group = text(hazard?.group, 60);
        const why = text(hazard?.why);
        const severity = hazard?.severity === 'high' || hazard?.severity === 'medium' ? hazard.severity : null;
        if (!group || !why || !severity) return [];
        const examples = Array.isArray(hazard?.examples) ? hazard.examples : [];
        return [{
          group,
          groupLabel: text(hazard?.groupLabel, 80) ?? group,
          reagentClass: text(hazard?.reagentClass, 60),
          reagentLabel: text(hazard?.reagentLabel, 120),
          severity,
          why,
          suggestion: text(hazard?.suggestion),
          protectedForms: (Array.isArray(hazard?.protectedForms) ? hazard.protectedForms : []).flatMap((form) => (text(form, 80) ? [text(form, 80)!] : [])).slice(0, 4),
          examples: examples.flatMap((example) => {
            const form = text((example as { form?: unknown })?.form, 80);
            const records = Array.isArray((example as { records?: unknown })?.records) ? (example as { records: unknown[] }).records : [];
            const ids = records.filter((id): id is string => typeof id === 'string' && TEXTBOOK_ID.test(id)).slice(0, 2);
            return form && ids.length ? [{ form, records: ids }] : [];
          }).slice(0, 2),
        }];
      }).slice(0, MAX_HAZARDS_PER_STEP),
    }];
  });
}

const COMPATIBILITY_FOOTNOTE = '_A heuristic check: the reagents are read from each step\'s conditions and matched to reagent classes, the groups found by substructure. A flag is a question to check, not a verdict — temperature, equivalents and order of addition often decide. Protecting groups as in Greene\'s Protective Groups in Organic Synthesis._';

function hazardLine(hazard: CompatibilityHazard, cite: (ids: string[]) => TextbookCitation[]): string {
  const severity = hazard.severity === 'high' ? '⚠ **High**' : 'Medium';
  const keep = hazard.suggestion ? ` To keep it: ${hazard.suggestion}.` : '';
  const examples = hazard.examples.flatMap((example) => {
    const citations = cite(example.records).slice(0, 1);
    return citations.length ? [`${example.form}: ${formatTextbookCitation(citations[0])}`] : [];
  });
  const shown = examples.length ? ` Textbook example${examples.length > 1 ? 's' : ''} of putting it on — ${examples.join('; ')}.` : '';
  const why = hazard.why.charAt(0).toUpperCase() + hazard.why.slice(1);
  return `- ${severity} — ${why}.${keep}${shown}`;
}

/** "### Functional-group compatibility": the steps that have a hazard, high ones first. Empty when
 *  no step has one, so a clean route adds nothing. */
export function formatCompatibility(steps: StepCompatibility[], cite: (ids: string[]) => TextbookCitation[] = () => []): string {
  const flagged = steps.filter((step) => step.hazards.length);
  if (!flagged.length) return '';
  const lines = ['### Functional-group compatibility',
    'This block is generated by the application, not by the model, from the reagents named in each step and the groups in its structures.', ''];
  for (const step of flagged) {
    const classes = step.reagentClasses.map((entry) => entry.label).join(', ');
    lines.push(`**Step ${step.step}**${classes ? ` — ${classes}` : ''}:`);
    const ordered = [...step.hazards].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1));
    for (const hazard of ordered) lines.push(hazardLine(hazard, cite));
    lines.push('');
  }
  lines.push(COMPATIBILITY_FOOTNOTE);
  return `\n${lines.join('\n').trimEnd()}\n`;
}

/** What one step was run WITH, as text, for the reagent classifier: its conditions line, then the
 *  names of its agents, then the names of its reactants.
 *
 *  The reactants are the part that was missing. A reagent the step CONSUMES belongs under
 *  Reactants — the route rules say so in as many words, "if a coupling reagent is used up, list it
 *  as a reactant and name what it becomes" — and the classifier reads text, so a reagent filed
 *  there was invisible to it. Measured on a seven-residue SPPS route whose steps carried no
 *  `Conditions:` line at all: the piperidine of a deprotection and the DIC of a coupling were both
 *  reactants, every step's text was its agent names alone, and the two hazards those steps carry
 *  (a diketopiperazine that takes the peptide off the resin, an arginine closing its own lactam)
 *  were never raised. The structures had always been sent; it was the step's own words that were
 *  being dropped.
 *
 *  Byproducts and products are deliberately excluded: they are what the step MADE, not what it was
 *  run with, and reading them back as reagents would invent conditions the step never had. */
export function compatibilityReagentText(
  conditions: string | undefined,
  entries: { role: string; name?: string; byproduct?: boolean }[],
): string {
  const named = (role: string) => entries
    .filter((entry) => entry.role === role && !entry.byproduct && entry.name?.trim())
    .map((entry) => entry.name!.trim());
  return [conditions ?? '', ...named('agent'), ...named('reactant')]
    .filter(Boolean).join('; ').slice(0, 2000);
}

/** The high-severity hazards of one step, one compact line each, for a fix prompt. */
export function compatibilityFixLines(step: StepCompatibility | undefined): string[] {
  return (step?.hazards ?? []).filter((hazard) => hazard.severity === 'high')
    .map((hazard) => `${hazard.why}${hazard.suggestion ? ` (to keep it: ${hazard.suggestion})` : ''}`)
    .slice(0, 3);
}
