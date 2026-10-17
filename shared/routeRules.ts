/** The rules every names-first synthesis-route prompt shares: the output contract appended to the
 *  first request and every correction the application offers afterwards. One copy, so the first
 *  answer and its corrections can never ask for different things. */

/** The four labelled lines each step ends with, as the model is asked to write them. */
export const ROUTE_LABEL_LINES = [
  'Reactants: <systematic IUPAC name>; <systematic IUPAC name>',
  'Products: <systematic IUPAC name>',
  'Byproducts: <systematic IUPAC name>',
  'Agents: <catalyst, solvent or other condition the step does not consume, or none>',
];

/** How species are named and assigned to roles, how a step is shaped, and when prose may change. */
export const ROUTE_SPECIES_RULES = [
  'Give each species as its systematic IUPAC name ONLY, separated by semicolons. Do not write SMILES, a formula, backticks, a reaction string or a `reactants>agents>products` line anywhere, except in the single structure fallback below: the application derives every structure from your names and solves every balanced equation itself.',
  'If, and only if, you cannot give a systematic name a reference service will resolve — an exotic fused cage or a named literature intermediate — write that species as its name followed by its isomeric SMILES in backticks, for example `the photodimer — `C1=CC2(C=C1)OCCO2``. The application takes the SMILES as the structure and checks it with RDKit. Never use this fallback for a species you can name. A common salt — a hydrochloride, a sodium or potassium salt, an ammonium salt — resolves by name, so name it (for example `aniline hydrochloride`, `sodium phenoxide`) rather than using the SMILES fallback.',
  'A species attached to a solid support (a resin, in a solid-phase synthesis) has no systematic name: write it with the structure fallback, the support as one `*` at its attachment atom — the `*` stands for the resin with its linker — for example `glycine on the resin — `*OC(=O)CN``. Keep the same `*` through every step. The support is never made or consumed: a loading step lists the free support (for example `the resin — `*Cl``) under Reactants, and a cleavage step lists the released support (for example `the resin — `*O``) under Byproducts. Write the free support as `*O`, never `*OH`: an `H` outside brackets is not valid SMILES and the structure is refused.',
  'A trivial or trade name will not resolve: give the systematic name wherever one exists. A catalyst or solvent with no systematic name may be written as prose in the Agents line.',
  'Keep stereodescriptors ((2R), (3Z), …) whenever a species is stereodefined. If a step\'s outcome is racemic or meso, or a centre it forms is genuinely not controlled, say so in that step\'s own prose (a note elsewhere does not count); never drop a descriptor silently. An achiral species needs no statement. A target the request gives without stereochemistry is taken as racemic.',
  'If a step rearranges the carbon skeleton — a Wagner–Meerwein shift, a pinacol, benzilic acid or Favorskii rearrangement, a ring expansion or contraction — name the rearrangement in that step\'s own prose; if a step forms a bond at an unactivated C–H by a radical (light, NBS, a peroxide initiator), say so there. The application checks which bonds each step makes and breaks, and refuses an undeclared skeletal shift, or a new bond at a carbon nothing activates (an enolate or enol reacts only at its α-carbon).',
  'List every species that is consumed or produced exactly once per side, under one role: Reactants (consumed), Products (the intended products), Byproducts (every other species on the product side — never repeat a product there) and Agents (catalysts, solvents and other conditions the step does not consume). A species the step consumes is a Reactant, never an Agent, even when the prose calls it a catalyst or says it is derived from another reagent before it reacts. A solvent the step also forms — water in an aqueous oxidation, ethanol from sodium ethoxide in ethanol — goes under Agents as the solvent and under Byproducts as the amount formed, never under Reactants.',
  'A multi-component step lists every consumed species under Reactants and every released species under Byproducts — a condensation often releases water, carbon dioxide, or both.',
  'A metal that enters as a reagent leaves as a salt: name the metal-containing product or byproduct (for example `sodium salicylate`, `sodium bromide`); never leave a metal on one side only.',
  'A catalyst or mediator that is regenerated and not consumed — a Lewis acid such as iron(III) bromide or aluminium chloride in an electrophilic substitution, palladium, an acid catalyst — goes under Agents and does not appear in the balanced equation. Put a metal under Reactants, leaving as a salt, only when it is stoichiometrically consumed.',
  'For a metal-oxo oxidation (dichromate, permanganate, chromium trioxide), name the reduced metal as its salt with the acid anion (for example `chromium(III) sulfate`, `manganese(II) sulfate`) and list the water it releases. Name each salt whole (sodium sulfate, chromium(III) sulfate) even when two salts share an ion, and do not list an acid and a free anion of the same acid separately.',
  'A rearrangement or isomerisation that gains and loses no atoms (a Beckmann or Claisen rearrangement) is written as substrate → product: put the acid or catalyst under Agents, and do not invent salt byproducts for it. A pinacol rearrangement is not one of these: it releases water, which goes under Byproducts.',
  'You never choose coefficients: the application solves them from the species you list. What you must get right is which species are present. When a step does not balance, a species is missing (a consumed reagent under Reactants, or a released species under Byproducts) or a product or byproduct is listed that is not formed: add or remove that species by name rather than adjusting any numbers. A species listed under Reactants that takes no part fails the step, even when the equation then balances: move it to Agents, or name under Products or Byproducts what it becomes. A reagent given as a salt brings its counter-ion with it, and the counter-ion has to end up somewhere: name the species it leaves in, or give the reagent as the ion that reacts. A reagent whose atoms are only partly accounted for comes out at zero and fails the step just as an unused one does.',
  'One net transformation per step, balanced as a single equation. If a step cannot balance as one equation, split it into consecutive steps. Combine two consecutive steps into one only when together they are one net transformation that balances as a single equation (a one-pot cascade); never combine two distinct transformations. A workup — an acidification, basification or quench that turns a step\'s product into another form (freeing an acid from its salt) — is always its own step, never folded into the step before it: a step folds a workup when it lists the workup\'s acid or base together with the transformation\'s reagents. Which form a product is written in (an amine or its hydrochloride, an acid or its salt) is your choice: name that form, and carry exactly that name into the next step.',
  'Carry an intermediate from one step into the next with exactly the same systematic IUPAC name, including its stereodescriptors.',
  'The step prose is the reference for what each step does: every name must describe the structure the prose describes, and you never change the prose just to make a name fit. Prose changes only to state a racemic or uncontrolled outcome, or where a step is rewritten, split, combined or inserted — then write that step\'s prose and names together.',
  'Every step ends with the four labelled lines. A step that gives its product only in prose cannot be checked.',
];

/** RETIRED 2026-10-06. This offered a solid-support route the option of one wide equation instead
 *  of one step per cycle. Withholding it is what finally carried the hardest target end to end:
 *  with the affordance the model wrote a single equation that never balanced across four runs and
 *  roughly fifteen fix rounds, and without it the same model decomposed into 29 steps that all
 *  balanced, reaching the requested structure exactly, in one fix round. A wide step is also the
 *  only shape that trips the coefficient search's dimension limit, so retiring this removes the
 *  trigger as well as the symptom.
 *
 *  The sentence below is unchanged from the rule that was in force, and is spliced back at its
 *  original position when restored. It is NOT the whole of the old rule: the structure-fallback
 *  guidance that used to share this one string is now an always-active rule of its own, because it
 *  is needed whether or not a route is written wide. So restoring this reinstates the affordance and
 *  the guidance is still present, but as two list entries rather than the original single one.
 *  To restore for a run: NODUS_ROUTE_MEGA_STEP=on (the harness suite field `megaStep: true`). */
const RETIRED_SINGLE_EQUATION_RULE =
  'A solid-phase peptide synthesis may be written as one mega-step (assemble the whole chain in a single balanced equation) rather than one step per residue — the coupling/deprotection cycle is the same recipe repeated. If you do, that step must still balance: list every protected amino acid consumed under Reactants, and every aggregate byproduct under Byproducts — one water for each amide bond formed, and for Fmoc removal one dibenzofulvene (`C=C1c2ccccc2-c2ccccc21`) and one carbon dioxide per deprotection, plus the activator byproducts.';

/** Where it sat in ROUTE_SPECIES_RULES, so a restored run reads the original order. */
const RETIRED_RULE_POSITION = 8;

/** Whether the retired single-equation affordance is restored for this run. Setting NODUS_ROUTE_MEGA_STEP=off
 *  withholds that one rule so a route is expected to decompose instead, which is the controlled
 *  comparison; the rule's own text is never altered. Read defensively, because these rules are
 *  assembled in the renderer as well as in the main process. */
function singleEquationRestored(): boolean {
  try {
    const host = globalThis as { process?: { env?: Record<string, string | undefined> } };
    return host.process?.env?.NODUS_ROUTE_MEGA_STEP === 'on';
  } catch {
    return false;
  }
}

/** The step rules in force for this run. The retired affordance is absent unless a run restores
 *  it, and then it is spliced back where it used to sit. Both the first request and every
 *  correction read this, so a run cannot offer it in one and withhold it in the other. */
export function routeSpeciesRules(): string[] {
  // Program mode replaces the names-first contract outright: the model writes operations, never
  // species lists, so none of the species rules apply. Switching HERE rather than in each caller
  // keeps this file's whole point intact — the first request and every correction read one source,
  // so a run cannot hold the answer to one contract and its fixes to another.
  if (routeProgramMode()) return routeProgramRules();
  if (!singleEquationRestored()) return ROUTE_SPECIES_RULES;
  const restored = ROUTE_SPECIES_RULES.slice();
  restored.splice(RETIRED_RULE_POSITION, 0, RETIRED_SINGLE_EQUATION_RULE);
  return restored;
}

/** Program mode: the model writes a short route PROGRAM of references and operations, and the
 *  application executes it in RDKit instead of reading structures out of prose.
 *
 *  Why: measured on chainL-3, 2026-10-13. The model got all ten assembly steps right and then
 *  mis-declared ONE formula — a metal salt written with the acid's hydrogens and its metal — which
 *  failed two steps and survived three fix rounds unchanged, the failure text byte-identical on
 *  every turn. In program mode it never writes a formula at all: it names an operation and the
 *  application computes the structure, so that whole class of error cannot occur. It also removes
 *  the O(N^2) naming cost that killed a 40-unit chain on the output-token limit, because an
 *  intermediate is a reference rather than a spelled-out systematic name.
 *
 *  The vocabulary here stays generic — `start`, `apply`, `site` — and must stay generic in diffs,
 *  commit messages and pull-request text.
 *
 *  OFF by default. For a run: NODUS_ROUTE_PROGRAM=on (the harness suite field `program: true`).
 *  The transformations themselves are the plugin's, not this file's: it ships the list and the
 *  application offers it, so a transformation is never named in two places. */
const ROUTE_PROGRAM_RULES = [
  'Write the route as a PROGRAM, one statement per line, and nothing else between the program fences. Do not write equations, systematic names, formulae or structures for the intermediates: the application computes each one and checks it.',
  'A reference is M1 to M999 and never a structure. The first statement is `M1 = start("<the starting material, as its systematic IUPAC name>")`, or `M1 = start(smiles="<SMILES>")` to give it as a structure.',
  'Every later transformation is `M2 = apply(M1, named="<transformation id>", reagents=["<reagent>"], site="<site phrase>")`. The first argument is the reference it acts on; EVERY argument after it is written as key=value, and the id, the reagents and a site PHRASE are quoted. A site HANDLE is the one value written bare, with no quotation marks around it: `site=@last`. Put one in quotation marks and it is read as the name of a functional group, and no group is named that way.',
  'The last statement is `target = M<n>`, naming the reference that is the target. A program without it is refused. `target` is only ever assigned a reference an earlier line produced, never an operation: write `M6 = apply(M5, named="...")` and then `target = M6`, not `target = apply(M5, named="...")`. The final transformation of a route is a line like any other.',
  'Use only the transformation ids the application offers you, exactly as written. If none performs the step you want, say so in prose and stop; do not invent an id, and do not fall back to writing an equation.',
  'Omit `site=` when the molecule has only one place the transformation can act. If a site phrase matches more than one place, the application says so and names every phrase that molecule does have — give a more specific one from that list, and never guess.',
  'When you mean ALL of them, say so: `site="every ester"` acts at every place the phrase matches, once each, and the application accounts for every equivalent consumed and released. That is the form for a step that frees two protected side chains at once — one operation, not one per group. A step that cuts the molecule needs `carry=` with it, as any cutting step does.',
  'When no phrase is specific enough, point at where an earlier line acted. `site=@last` is the place the previous line changed, and `site=@M3` is the place the line that assigned M3 changed. Write a handle WITHOUT quotes. That is what a growing chain needs: after a few couplings a peptide holds one amide per residue, so `site="amide"` cannot pick one out and no phrase can, however it is worded — but `@M5` names the amide that step M5 just made. Never write an atom number; the application keeps track for you.',
  'A step that CUTS the molecule in two — a deprotection, a hydrolysis — has to say which piece the route follows, because both pieces are made of atoms that went in and only you know which one you are building. The curated deprotections already know and need nothing. Everywhere else write `carry="largest"`, or name the piece as a structure, `carry=[smiles="<the fragment>"]`. Naming it is worth preferring: if the step does not form that fragment the application says so at once and lists what it does form, rather than carrying the wrong molecule into every later line.',
  'A reagent is given EITHER as a quoted systematic IUPAC name, `reagents=["methanol"]`, OR as a structure, `reagents=[smiles="CO"]`. A bare quoted string is always read as a NAME, so a SMILES string written without `smiles=` is looked up as a name and the line fails. The application supplies the coupling agents, solvents and conditions a transformation implies; you give only what becomes part of the product.',
  'A line beginning with # is a comment and is ignored.',
];

/** Subject-naming rules for program mode: which FORM to write a species of a particular
 *  research domain in, appended after the generic grammar by routeProgramRules(). Empty here,
 *  as ROUTE_SPECIES_RULES carries no domain rule either; a deployment that needs one adds it. */
export const ROUTE_PROGRAM_DOMAIN_RULES: string[] = [];

/** Whether this run answers with a route program instead of names-first equations. Read
 *  defensively: these rules are assembled in the renderer as well as in the main process. */
export function routeProgramMode(): boolean {
  try {
    const host = globalThis as { process?: { env?: Record<string, string | undefined> } };
    return host.process?.env?.NODUS_ROUTE_PROGRAM === 'on';
  } catch {
    return false;
  }
}

/** Whether this turn must carry the output-format contract with it.
 *
 *  The first request always does. A CORRECTION does too in program mode — and only in program
 *  mode, which is the opposite of the names-first rule and deliberately so. A names-first
 *  correction restates the rules it needs in its own text, so adding the first-request contract on
 *  top would send them twice. A program correction cannot: it asks for the COMPLETE program back,
 *  and the grammar and the transformation ids live only in the system prompt, never in the
 *  conversation, so a correction sent without them asks the model to rewrite a program in a
 *  language it can no longer see — while the contract it cannot see tells it to use only the ids
 *  the application offers and never to invent one.
 *
 *  Measured 2026-10-14 on chainQ-2, chainQ-4 and chainQ-8: each spent a fix round and came back
 *  with a program the application would not have accepted. It is the same defect as the one that
 *  made program mode write nothing at all before the ids were ever offered — unfollowable rather
 *  than ignored — reappearing one turn later. */
export function routeContractTurn(routeRequest: boolean, correction: boolean): boolean {
  return routeRequest || (correction && routeProgramMode());
}

/** The program-mode contract, with whatever subject rules the author has written appended. */
export function routeProgramRules(): string[] {
  return [...ROUTE_PROGRAM_RULES, ...ROUTE_PROGRAM_DOMAIN_RULES];
}

/** What a correction says about the target and about drawing. A route turn strips every
 *  chemistry-plan fence from the answer and draws the route only in the final report, once every
 *  step passes, so a correction asks for no drawing. The target is still quoted exactly as the
 *  original request gave it, so the model knows which compound the route must reach. */
export function correctionTargetPlanRule(target: string | null | undefined): string {
  const never = 'Do not emit a chemistry-plan block, and never a nodus-view, nodus-artifact or nodus-capability-result block: the application draws the route itself once every step passes.';
  if (!target) return never;
  return [`The requested target, exactly as the original request gave it: \`${target}\`.`, never].join('\n');
}
