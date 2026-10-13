# Reaction index tools

Builds and updates the local Open Reaction Database (ORD) index that Chemistry Studio reads for
known-reaction precedent, similar reactions and retro disconnections. The app reads the index
directory named by `NODUS_REACTION_INDEX_DIR`; nothing here runs inside the app.

The data is ORD's (`open-reaction-database/ord-data`, CC BY-SA 4.0; Kearnes et al., JACS 2021,
doi:10.1021/jacs.1c09820). The index (≈2 GB) and the data (≈1.2 GB) are not kept in git.

## Setup

    uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt

## Build from scratch (~3.5 h)

    ./fetch-ord.sh ord-data                       # the pinned snapshot from Hugging Face
    .venv/bin/python build_index.py --root ord-data --out index-v3

    .venv/bin/python conditions.py --index index-v3 --root ord-data   # ~2 min

`conditions.py` adds `conditions.tsv.zst`: for every ORD id the index cites as a sample, the
reagents, catalysts and solvents (USPTO inputs that give no atom to a product count as reagents),
temperature, time, atmosphere, yield and reference (DOI, or the patent for USPTO data). The worker
attaches them to precedents so a step can be cited with what it was run with.

Extraction checkpoints include the data SHA-256, row group, extractor version, template threshold,
external mapping file SHA-256 and confidence floor. Rebuilds reuse only matching inputs.
`progress.py` / `reaction_progress.py` report a running build.

`retro-templates.tsv.zst` retains its three-column format for installed Chemistry Studio plugins.
The additive `template-radii.tsv.zst` stores the radii of retained retro/forward templates;
the manifest names its file and columns. Forward templates have their own four-column format.
Decomposition is optional: packages without `decompose-target` keep whole-target searches.

Run the builder regression suite with the CI dependencies:

    python -m unittest discover -s tools/reaction-index -p 'test_builder_regressions.py' -v
    python tools/reaction-index/test_template_radius.py

## Keep it current

    .venv/bin/python update_ord.py --check        # exit 0 current, 10 update available
    .venv/bin/python update_ord.py --apply        # close Nodus first
    .venv/bin/python update_ord.py --rollback     # restore the previous index

`--check` compares the latest Hugging Face revision's parquet files (LFS SHA-256) with the local
copy, and notes when ORD's GitHub `main` (what the website shows) has data newer than the Hugging
Face copy. `--apply` downloads only new and changed files, rebuilds into a clone of the current
index (reusing every checkpoint), rebuilds the conditions table, checks the new manifest and swaps
it in, keeping `<index>.prev`.
`--apply --force` rebuilds even when nothing changed (after an extractor change).
Paths: `--index` / `NODUS_REACTION_INDEX_DIR`, `--data` / `ORD_DATA_DIR`.

## Other files

- `template_fast.py` — reaction-template extraction used by the builder; `validate_templates.py` checks it.
- `query.py`, `probe.py` — ad-hoc lookups against an index or the raw data.
- `benchmarks/` — disconnection, route and three-source evaluations; `proto/` — an early graph prototype.
