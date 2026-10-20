# Vendored: official Ming-3.0-tts inference code

| | |
| --- | --- |
| Upstream | https://github.com/inclusionAI/Ming-3.0-tts |
| Commit | `e999c39fa676722aaa9ea29b5aa19a90525b271f` (2026-10-19) |
| Licence | MIT, `LICENSE` (Copyright (c) 2025 inclusionAI); `LEGAL.md` is upstream's notice on comment languages |

Unmodified copies of the files the 0.5B model needs at inference time:

- `modeling_bailingmm.py`, `configuration_bailingmm.py`, `prompt_contract.py`
- `fm/` (DiT flow-matching head and its sampler)
- `audio_tokenizer/` (the audio VAE)
- `spkemb_extractor.py` (kept as the reference the NumPy fbank in `../speaker.py` is
  checked against; the sidecar itself does not import it)

`configuration_bailingmm.py` carries upstream's Apache-2.0 header (Ant Group and the
Hugging Face team); Apache-2.0 is compatible with Nodus' AGPL-3.0.

Left out on purpose: `ming_tts.py` (its text frontend needs `inflect` and `pynini`; the
sidecar splits text with `../ming_text.py` and ports the silence trim into
`../backend_torch.py`), `tts_tasks.py`, `frontend/`, `ming_tiny/` (a different
architecture), `infer*.py`, `tools/`, `docker/`, `cookbooks/`, `data/` and `figures/`.

The files import each other as top-level modules (`import prompt_contract`,
`from fm.dit import ...`), so `backend_torch.py` puts this directory on `sys.path`.
