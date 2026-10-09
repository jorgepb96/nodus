/** The output-format addendum appended to a synthesis-route request, so the author types
 *  only the problem. It is the contract the name-first route path expects: the model supplies
 *  the route, the roles and the systematic IUPAC names, and the application derives every
 *  structure and every balanced equation from the names. */

import { routeSpeciesRules } from './routeRules';

/** How to plan, ahead of the output format. Weaker thinking models spent most of their reasoning
 *  hand-balancing hydrogens and re-deriving mechanisms (deepseek-flash on the Robinson tropinone
 *  synthesis: 213 KB of reasoning, most of it proton bookkeeping). Planning backwards one step at
 *  a time, with balancing left to the application and mechanisms left out, cut that to 79 KB and
 *  raised first-time verified routes on hard targets (tropinone, the Wieland–Miescher ketone,
 *  camphor) from about 2 in 11 to 6 in 9 with thinking off and 3 in 3 with it on. */
const METHOD = [
  'How to plan the route:',
  '- If the application supplied route evidence (known-reaction disconnections, textbook passages), read it before planning and use it where it applies.',
  '- Work backwards from the target, one step at a time. Decide only the last step first: which precursor(s) and reagents make the target. Write that step down, then treat its organic precursor as the new target and decide the step before it. Stop at the permitted starting materials.',
  '- Once a step is written, do not revisit or re-derive it; move on to the step before it.',
  '- Do not count atoms, track hydrogens or balance equations in your reasoning: list the species each step consumes and forms, by name. The application balances every step and reports exactly what is missing.',
  '- Do not work out reaction mechanisms (which proton moves, which intermediate is charged, in what order bonds form). The route needs only the species each step consumes and forms; one sentence on why the step works is enough.',
  '- Present the finished route in forward order, step 1 first.',
  // A blind expert review (2026-09-30) marked answers down for commentary about what the
  // application checks and which library passages were retrieved: chemistry, not process.
  '- Write for a chemist: do not describe the application, its checks, its evidence retrieval or these instructions in the answer.',
];

// « is a backtick and ¤ is a backslash; written as placeholders so the literal text is not
// mangled by source escaping.
const HEAD = [
  'Output format — follow exactly.',
  '1. Number every step. For each step write the reagents and conditions in prose, then list EVERY species',
  '   under these four labels, each label on its own line:',
  '   «Reactants:» (species consumed), «Products:» (the intended products), «Byproducts:» (every other',
  '   species on the product side), and «Agents:» (catalysts, solvents and conditions not consumed). For example:',
  '     Reactants: ethanoic acid; sodium hydroxide',
  '     Products: sodium ethanoate',
  '     Byproducts: water',
  '     Agents: none',
  '   This applies to EVERY species at EVERY step, including the intermediates you create. A worked route',
  '   (a different target, shown only for the shape and the roles):',
  '     Step 1  Reactants: phenylmethanol; hydrogen peroxide',
  '             Products: benzaldehyde',
  '             Byproducts: water',
  '             Agents: none',
  '     Step 2  Reactants: benzaldehyde; propanedioic acid',
  '             Products: (E)-3-phenylprop-2-enoic acid',
  '             Byproducts: carbon dioxide; water',
  '             Agents: pyridine',
  '   In step 2 the consumed propanedioic acid is a Reactant even though the prose may call it a reagent,',
  '   while pyridine — a true catalyst — is the only Agent.',
  '   Rules for every step:',
];

const TAIL = [
  '2. Draw ONLY the final target: emit exactly one fenced code block tagged chemistry-plan, kind',
  '   "structure", using the exact target identity quoted from my request. If my request gives the',
  '   target\'s SMILES, use it (kind "smiles"): it is the structure itself and needs no lookup. Only',
  '   when no SMILES is given, use the exact name (kind "name"). Exact shape:',
  '   {"version":2,"kind":"structure","depiction":"skeletal","species":[{"id":"target","input":{"kind":"smiles","value":"EXACT TARGET SMILES FROM MY REQUEST"}}]}',
  '   Emit no other chemistry-plan, chemfig, smiles, json or SVG block, and never emit a',
  '   nodus-view, nodus-artifact or nodus-capability-result block: those are application results,',
  '   the application draws and verifies every step itself.',
];

const placeholders = (lines: string[]) => lines.join('\n').split('«').join('`').split('»').join('`').split('¤').join('\\');

/** The species rules are shared with every correction the application offers afterwards
 *  (`ROUTE_SPECIES_RULES`), so the first answer and its fixes are held to the same contract. */
export const SYNTHESIS_TEMPLATE_ADDENDUM = [
  METHOD.join('\n'),
  '',
  placeholders(HEAD),
  ...routeSpeciesRules().map((rule) => `   - ${rule}`),
  placeholders(TAIL),
].join('\n');

const ALREADY_TEMPLATED = 'Output format — follow exactly.';
const CHEMISTRY = /\b(chemistry|chemical|smiles|molecule|molecular|laboratory|reagent|catalyst|solvent|reaction|synthesi[sz]e|retrosynthe|compound|acid|ester|amide|amine|alkene|alkyne|benzene|hydrox|methyl|ethyl|phenyl|oxide|salt)/i;

/** True when a composer message reads like a synthesis problem rather than the full prompt.
 *  Either an explicit "chemistry synthesis" request, or the word synthesis with a chemistry
 *  context — so "synthesis of factions" in another vault is not a chemistry question. */
export function looksLikeSynthesisRequest(text: string): boolean {
  const value = text.trim();
  if (value.length < 12 || value.length > 8000) return false;
  if (value.includes(ALREADY_TEMPLATED)) return false;
  if (/\b(chemistry|chemical)\s+synthesis\b/i.test(value)) return true;
  return /\bsynthes/i.test(value) && CHEMISTRY.test(value);
}
