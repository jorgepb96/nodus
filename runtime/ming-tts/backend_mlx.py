"""Ming-3.0 TTS on Apple Silicon through MLX (mlx-audio 0.6.0).

mlx-audio 0.6.0 is the release on PyPI, but its ``bailingmm`` module predates
Ming-3.0 (wrong chat layout, no speaker slot, back-padded prompt). The fixed
module from mlx-audio's main branch is vendored in ``mlx_ming3/`` and
registered in place of the packaged one before the model loads; everything it
imports (the Qwen2/Bailing backbones, the KV cache, audio I/O) is identical in
0.6.0, checked file by file when the commit was pinned.

Synthesis follows ``Model.generate`` fragment by fragment, with two changes
that only remove repeated work: the prompt latent comes from the voice cache
instead of being re-encoded on every call, and the speaker embedding is
projected once per job. Fragments are split by the caller (``ming_text``).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np

CACHE_LIMIT_BYTES = int(os.environ.get("NODUS_MING_MLX_CACHE_MB", "1024")) * (1 << 20)


def _install_vendored_model() -> None:
    import mlx_audio.tts.models  # noqa: F401  (parent package must exist first)
    import mlx_ming3

    sys.modules["mlx_audio.tts.models.bailingmm"] = mlx_ming3
    sys.modules["mlx_audio.tts.models.bailingmm.bailingmm"] = mlx_ming3.bailingmm


class MlxBackend:
    name = "mlx"

    def __init__(self):
        import mlx.core as mx

        self.mx = mx
        mx.set_cache_limit(CACHE_LIMIT_BYTES)
        _install_vendored_model()
        try:
            info = mx.device_info()
        except AttributeError:  # older MLX
            info = mx.metal.device_info()
        self.device = "metal" if mx.metal.is_available() else "cpu"
        self.device_name = str(info.get("device_name", "Apple GPU"))
        self.model = None

    @property
    def loaded(self) -> bool:
        return self.model is not None

    @property
    def sample_rate(self) -> int:
        return int(self.model.sample_rate)

    def load(self, model_path: str) -> None:
        from mlx_audio.tts.utils import load_model

        from mlx_ming3 import bailingmm

        model = load_model(Path(model_path), model_type="bailingmm")
        if not isinstance(model, bailingmm.Model) or not model.ming3:
            raise ValueError(f"{model_path} is not a Ming-3.0-tts-0.5B checkpoint")
        self.model = model

    def unload(self) -> None:
        self.model = None
        import gc

        gc.collect()
        self.mx.clear_cache()

    def release_memory(self) -> None:
        self.mx.clear_cache()

    # -- prompts ----------------------------------------------------------
    def load_audio(self, path: str, sample_rate: int) -> np.ndarray:
        from mlx_audio.utils import load_audio

        return np.array(load_audio(path, sample_rate=sample_rate), dtype=np.float32)

    def encode_prompt(self, audio: np.ndarray):
        """The prompt latent (float32) of a mono clip at the model's rate, plus
        the dtype the model produced it in."""
        mx = self.mx
        waveform = mx.array(np.asarray(audio, dtype=np.float32))
        latent = self.model._encode_prompt_latent(waveform)
        mx.eval(latent)
        dtype = str(latent.dtype).replace("mlx.core.", "")
        return np.array(latent.astype(mx.float32)), dtype

    def to_latent(self, latent: np.ndarray, dtype: str | None):
        mx = self.mx
        value = mx.array(np.asarray(latent, dtype=np.float32))
        return value.astype(getattr(mx, dtype)) if dtype and hasattr(mx, dtype) else value

    # -- synthesis --------------------------------------------------------
    def decode_budget(self, text, prompt, *, prompt_latent=None, prompt_text=None,
                      spk_emb=None, instruction=None, use_zero_spk_emb=False):
        from mlx_ming3.bailingmm import MING3_MAX_CACHE_LEN

        model = self.model
        speaker = model._speaker_embeddings(spk_emb, bool(use_zero_spk_emb))
        ids, _ = model._prepare_input_embed(prompt=prompt, text=text, instruction=instruction,
                                           prompt_latent=prompt_latent, prompt_text=prompt_text,
                                           spk_emb=speaker)
        return (MING3_MAX_CACHE_LEN - ids.shape[1]) // model.patch_size

    def synth_fragment(self, text, prompt, *, max_steps, cfg, flow_steps, sigma, temperature,
                       prompt_latent=None, prompt_text=None, spk_emb=None, instruction=None,
                       use_zero_spk_emb=False, check_cancel=None):
        from mlx_ming3.bailingmm import _trim_trailing_silence

        mx, model = self.mx, self.model
        speaker = model._speaker_embeddings(spk_emb, bool(use_zero_spk_emb))
        sampler = model.sample(
            prompt=prompt,
            text=text,
            instruction=instruction,
            prompt_text=prompt_text if prompt_latent is not None else None,
            max_decode_steps=max_steps,
            cfg=cfg,
            sigma=sigma,
            temperature=temperature,
            flow_steps=flow_steps,
            prompt_latent=prompt_latent,
            spk_emb=speaker,
        )
        latents, finished = [], False
        for tokens, is_last in sampler:
            latents.append(tokens)
            if check_cancel is not None:
                check_cancel()  # raises between decode steps
            if is_last:
                finished = True
        if not latents:
            raise RuntimeError("no audio latents were generated for a text fragment")
        part, _, _ = model.audio.decode(mx.concatenate(latents, axis=1), use_cache=False, last_chunk=True)
        audio = _trim_trailing_silence(part[0], model.sample_rate)
        mx.eval(audio)
        out = np.array(audio.astype(mx.float32), dtype=np.float32)
        return out, {"steps": len(latents), "truncated": not finished}
