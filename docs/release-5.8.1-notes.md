# Nodus 5.8.1

## New features

- Nodus Scriptor, in Tools, lets you write and organize documents with rich text, tables, images and formulas. Insert sources and ideas with [[, add citations, bibliographies and notes, assemble chapters and export to Word, PDF or LaTeX. It includes version history, fullscreen writing and AI text improvements that you can cancel or undo. Available on Desktop and Server web.

## Enhancements

- Chemistry Studio templates take each scheme’s reagents into account. Index preparation validates atom mapping and lets you exclude schemes with mechanism or stereochemistry problems.

- Research Chat adjusts response length to the available context space and the model’s limits. Supported models can produce longer answers and synthesis routes with fewer interruptions caused by the output limit.

## Fixes

- Synthesis route checks use the substances declared in the text and retain repeated salt components. They identify steps that could not be checked and show where structures came from. A route diagram is generated only when the route passes its checks.

- Results saved by plugins record the version of the content that produced them. Replacing an installed package no longer makes a result report an older plugin version.

- Research Chat retrieves passages correctly in large libraries and with lengthy instructions. Saved citations keep resolving and new citations are no longer blocked by the previous limit. The context includes works that contributed to the query without adding unrelated titles.

- The Nodus add-on for Zotero can save API keys and connection credentials in Zotero 10 again. It uses Zotero’s password manager and confirms that credentials have been saved before continuing.

- Installation packages include only files from the current build. Copies from earlier builds are removed to reduce the application’s size.
