# Fixed-80 rank-independent passage annotation workflow

This workflow prepares passage-level annotations for the complete preregistered set of 80 research questions: 60 answerable questions and 20 planned insufficient-evidence questions. The corrected extraction pipeline is `nodus-clean-markdown/12`. Do not select or replace questions, and do not inspect new campaign rankings or answers until the annotations are frozen.

## Bind the source and fixed query set

1. Use the exact 80 query IDs, question texts, and answerability labels in the preregistration. Do not select a subset, change wording, or reorder the plan to suit results.
2. Wait until the fresh source campaign closes and its source identity audit is complete. Work from the immutable current source snapshot and exported passage inventory; never query the live database for annotation or scoring.
3. Export the entire current passage inventory with stable passage and document IDs, source SHA-256, text fingerprint, canonical locator, and text. Record the inventory and preregistration hashes. The scorer rejects mismatched hashes and annotations tied to another extraction version.
4. Review the full corpus in stable document-ID and passage-ordinal order. This is post-index annotation, not a blinded holdout. Include passages in all searchable translations.

## Annotate before revealing rankings

5. For each answerable question, record only the minimum atomic facts needed to answer its exact wording. Treat format instructions separately. Do not add details from older acceptance notes when the question does not ask for them.
   Keep calculations and conclusions in separate answer requirements, with their literal source premises linked to the retrieval facts. A derived percentage-point difference or a limitation on what a mean and median establish is not an additional literal passage fact. This separation preserves the answer requirement while avoiding impossible source-text labels.
6. For each fact, record every passage that clearly supports it, with its exact literal quote, passage ID, source hash, text fingerprint, and canonical locator. A matching document title or ID alone is not evidence. Keep OCR-damaged or polarity-uncertain spans ambiguous; they do not count as positive support.
7. For each planned insufficient-evidence question, an empty source-ID list is not proof of absence. Mark the case unverified unless the full scoped corpus was checked for that exact fact and an independent reviewer confirmed its absence. Unknown cases remain visible in the fixed denominator.
8. Have a second reviewer check the fact decomposition and passage labels without access to rankings. Resolve disagreements or leave the relevant fact pending.
9. Save the annotations and a freeze record bound to the exact annotation, inventory, and preregistration SHA-256 values. Freeze before opening ranking artifacts. Use 64-character lowercase SHA-256 values.

## Score after the freeze

```sh
node scripts/score-research-passage-retrieval.mjs \
  --annotations=annotations.json \
  --freeze=annotations.freeze.json \
  --inventory=current-passages.json \
  --preregistration=preregistration.json \
  --rankings=rankings.json \
  --output=score-v1.json
```

The ranking file uses `nodus.research-passage-rankings/1`. It must bind the annotation, inventory, and preregistration hashes and contain all 80 exact query IDs for each arm. Every ranked passage ID and every annotation quote must resolve to the hash-bound inventory. Each retrieval arm is scored separately.

Export a completed, source-authorized live trace with `node scripts/rank-research-live-evidence.mjs --sources=FILE --inventory=FILE --preregistration=FILE --annotations=FILE --freeze=FILE --output=NEW_FILE`. All files must be inside the marked campaign artifacts. This preserves the saved semantic, lexical and product-selection array order without sorting or filling gaps. These arrays diagnose lanes from one product search; they are not independently executed ablations. `hybrid-selected` includes the actual context budget and diversity filters. Never call its top ten an unrestricted hybrid ranking.

EvidenceHit@10 and FactCoverage@10 have two distinct views. Complete-gold scores require exhaustive annotations. Planned-denominator lower bounds also credit an unambiguous retrieved passage that supports a known required fact in a partial annotation; unresolved facts remain in the fact denominator and contribute zero. An OCR-ambiguous passage never establishes a hit. Exhaustive Recall@10, MRR@10, and nDCG@10 require complete exhaustive passage gold; pending cases remain listed and contribute zero to conservative planned-denominator bounds. No metric substitutes document identity for passage support.

## Errata for earlier annotation freezes

Keep an existing freeze immutable when review finds a query-scope or polarity error. Publish a separately versioned corrected annotation and freeze, and require rankings to bind to the corrected annotation hash. The prior v1 R001 annotation includes a separate event-retention fact although its question asks which items Linde can restore and what is excluded. It also includes an OCR-damaged Portuguese span (“mas no contas”) whose exclusion polarity is uncertain. Do not score that frozen v1 R001 gold as complete until a versioned correction removes the surplus fact and adjudicates or leaves the OCR span ambiguous. The scorer excludes evidence with non-empty `ambiguity` from positive relevance and treats its fact as incomplete for exhaustive metrics.
