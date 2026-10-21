# Vendored: mlx-audio's Ming-3.0 module

| | |
| --- | --- |
| Upstream | https://github.com/Blaizzy/mlx-audio |
| Commit | `b8b59855eaca16a417f89bf9ab335fd0c0a06fad` (2026-10-19, "Keep long Ming utterances intact and restore bf16 model links") |
| Path | `mlx_audio/tts/models/bailingmm/` |
| Licence | MIT, `LICENSE` (Copyright (c) 2024 Prince Canuma) |

`bailingmm.py`, `convert.py` and `LICENSE` are byte-for-byte copies. `__init__.py` is
Nodus' own: it exports what mlx-audio's loader looks for, because `backend_mlx.py`
registers this package as `mlx_audio.tts.models.bailingmm` before loading a model.

## Why it is vendored

The newest release on PyPI, mlx-audio 0.6.0, ships a `bailingmm` module that predates
Ming-3.0-tts-0.5B: it builds the MoE-era `<role>HUMAN</role>` prompt instead of the dense
chat layout, has no speaker-embedding slot, ends captions with `<|endoftext|>` instead of
`<|im_end|>`, back-pads the reference audio and does not split text into fragments. The
model loads and speaks, but conditioned on a sequence it was never trained on. The fixes
landed on mlx-audio's main branch in `d409f301`, `e7541da4` and `b8b59855`, after 0.6.0.

Every other module this file imports (`mlx_audio.lm.models.{qwen2,bailing_moe,base,cache}`,
`mlx_audio.tts.models.base`, `mlx_audio.utils`, `mlx_audio.audio_io`, `mlx_audio.tts.utils`)
was compared against the 0.6.0 wheel when the commit was pinned and is identical.

Drop this directory, and the `sys.modules` swap in `backend_mlx.py`, once an mlx-audio
release contains these commits.
