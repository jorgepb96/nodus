"""Ming-3.0 TTS through PyTorch, on CUDA or on the CPU.

The model code is the official inclusionAI/Ming-3.0-tts inference code,
vendored unmodified in ``ming_official/`` (commit in its NODUS_VENDOR.md).
This module only replaces the parts of the official ``ming_tts.MingTTS``
wrapper that Nodus does differently: text is split by ``ming_text`` (same
fragments as the MLX backend, no pynini normalization), prompts come from the
voice cache, and the CPU path runs in float32, optionally with int8 dynamic
quantization of every ``nn.Linear`` (``--cpu-quant int8``; see serve.py for
why it is not the default).

CUDA uses bfloat16 where the GPU supports it and float16 otherwise, under the
official code's own CUDA autocast.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
OFFICIAL = ROOT / "ming_official"
SPEAKER_DIM = 192


def _physical_cores() -> int:
    try:
        import psutil

        count = psutil.cpu_count(logical=False)
        if count:
            return int(count)
    except Exception:  # noqa: BLE001
        pass
    return max(1, (os.cpu_count() or 2) // 2)


THREADS = max(1, _physical_cores() - 2)
# Set before torch loads so OpenMP/MKL size their pools to match.
for _var in ("OMP_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ[_var] = str(THREADS)


def trim_trailing_silence(speech: np.ndarray, sample_rate: int, threshold: float = 1e-3, tail_seconds: float = 0.3) -> np.ndarray:
    """NumPy port of the official ``ming_tts.trim_trailing_silence`` (mono)."""
    if speech.size == 0:
        return speech
    frame = int(sample_rate * 0.1)
    tail = int(sample_rate * tail_seconds)
    if frame <= 0 or speech.shape[-1] < frame:
        return speech[:tail]
    num_frames = (speech.shape[-1] - frame) // frame + 1
    speech = speech[: num_frames * frame]
    scores = np.abs(speech.reshape(num_frames, frame)).mean(axis=-1)
    loud = np.nonzero(scores > threshold)[0]
    if loud.size == 0:
        return speech[:tail]
    return speech[: int(loud[-1]) * frame + frame + tail]


class TorchBackend:
    name = "torch"

    def __init__(self, device: str = "auto", cpu_quant: str = "none"):
        import torch

        self.torch = torch
        torch.set_num_threads(THREADS)
        try:
            torch.set_num_interop_threads(1)
        except RuntimeError:
            pass
        cuda = torch.cuda.is_available()
        if device == "cuda" and not cuda:
            raise RuntimeError("CUDA was requested but torch sees no CUDA device")
        if device != "cpu" and cuda:
            self.dev = torch.device("cuda:0")
            self.dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
            self.device = f"cuda:0 ({torch.cuda.get_device_name(0)}, {str(self.dtype).replace('torch.', '')})"
        else:
            self.dev = torch.device("cpu")
            self.dtype = torch.float32
            self.device = f"cpu ({THREADS} threads, {'int8 dynamic' if cpu_quant == 'int8' else 'fp32'})"
        self.cpu_quant = cpu_quant
        if str(OFFICIAL) not in sys.path:
            sys.path.insert(0, str(OFFICIAL))
        try:
            from loguru import logger

            logger.remove()
            logger.add(sys.stderr, level="WARNING")
        except ImportError:
            pass
        self.model = None
        self._resamplers = {}

    @property
    def loaded(self) -> bool:
        return self.model is not None

    @property
    def sample_rate(self) -> int:
        return int(self.model.config.audio_tokenizer_config.sample_rate)

    def load(self, model_path: str) -> None:
        torch = self.torch
        from transformers import AutoTokenizer

        from modeling_bailingmm import BailingMMNativeForConditionalGeneration

        model = BailingMMNativeForConditionalGeneration.from_pretrained(
            model_path, torch_dtype=self.dtype, low_cpu_mem_usage=True,
        ).eval().to(self.dtype)
        if self.dev.type == "cpu" and self.cpu_quant == "int8":
            engines = torch.backends.quantized.supported_engines
            for engine in ("x86", "fbgemm", "qnnpack"):
                if engine in engines:
                    torch.backends.quantized.engine = engine
                    break
            model = torch.ao.quantization.quantize_dynamic(model, {torch.nn.Linear}, dtype=torch.qint8)
        else:
            model = model.to(self.dev)
        # The setter validates the tokenizer against the trained token layout.
        model.tokenizer = AutoTokenizer.from_pretrained(model_path)
        self.model = model

    def unload(self) -> None:
        self.model = None
        import gc

        gc.collect()
        self.release_memory()

    def release_memory(self) -> None:
        if self.dev.type == "cuda":
            self.torch.cuda.empty_cache()

    # -- prompts ----------------------------------------------------------
    def _load(self, path: str):
        import torchaudio

        waveform, sample_rate = torchaudio.load(path, backend="soundfile")
        if waveform.numel() == 0:
            raise ValueError(f"prompt audio is empty: {path}")
        if waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)
        return waveform, sample_rate

    def _resample(self, waveform, source: int, target: int):
        if source == target:
            return waveform
        import torchaudio

        key = (source, target)
        if key not in self._resamplers:
            self._resamplers[key] = torchaudio.transforms.Resample(source, target)
        return self._resamplers[key](waveform)

    def load_audio(self, path: str, sample_rate: int) -> np.ndarray:
        waveform, source = self._load(path)
        return self._resample(waveform, source, sample_rate)[0].numpy().astype(np.float32)

    def encode_prompt(self, audio: np.ndarray):
        torch, model = self.torch, self.model
        waveform = torch.from_numpy(np.asarray(audio, dtype=np.float32).reshape(1, -1))
        # Pad at the front, as the official prepare_prompt: the prompt's tail
        # seeds the latent history.
        encoder = model.audio.encoder
        align = encoder.hop_size * max(1, encoder.patch_size) * model.patch_size
        remainder = waveform.shape[-1] % align
        if remainder:
            waveform = torch.nn.functional.pad(waveform, (align - remainder, 0))
        with torch.inference_mode():
            waveform = waveform.to(device=self.dev, dtype=self.dtype)
            length = torch.tensor([waveform.size(1)], dtype=torch.long, device=self.dev)
            latent, _ = model.audio.encode_latent(waveform, length)
        dtype = str(latent.dtype).replace("torch.", "")
        return latent.float().cpu().numpy(), dtype

    def to_latent(self, latent: np.ndarray, dtype: str | None):
        return self.torch.from_numpy(np.asarray(latent, dtype=np.float32)).to(device=self.dev, dtype=self.dtype)

    # -- synthesis --------------------------------------------------------
    def synth_fragment(self, text, prompt, *, max_steps, cfg, flow_steps, sigma, temperature,
                       prompt_latent=None, prompt_text=None, spk_emb=None, instruction=None,
                       use_zero_spk_emb=False, check_cancel=None):
        torch, model = self.torch, self.model
        if flow_steps != 10:
            raise ValueError("the official sampler runs 10 flow steps")  # FlowLoss.sample's default
        speaker = None
        if use_zero_spk_emb:
            speaker = [torch.zeros(1, SPEAKER_DIM, dtype=self.dtype)]
        elif spk_emb is not None:
            speaker = [torch.from_numpy(np.asarray(spk_emb, dtype=np.float32).reshape(1, -1)).to(self.dtype)]
        latents, finished = [], False
        with torch.inference_mode():
            sampler = model.sample(
                prompt=prompt,
                text=text,
                spk_emb=speaker,
                instruction=instruction,
                prompt_text=prompt_text if prompt_latent is not None else None,
                max_decode_steps=max_steps,
                cfg=cfg,
                sigma=sigma,
                temperature=temperature,
                use_zero_spk_emb=bool(use_zero_spk_emb),
                prompt_latent=prompt_latent,
            )
            with torch.autocast(device_type="cuda", dtype=self.dtype, enabled=self.dev.type == "cuda"):
                for tokens, is_last in sampler:
                    latents.append(tokens)
                    if check_cancel is not None:
                        check_cancel()  # raises between decode steps
                    if is_last:
                        finished = True
                if not latents:
                    raise RuntimeError("no audio latents were generated for a text fragment")
                speech = model.audio.decode(torch.cat(latents, dim=1), past_key_values=None,
                                            use_cache=False, last_chunk=True)[0]
        audio = speech.float().cpu().numpy().reshape(-1)
        audio = trim_trailing_silence(audio, self.sample_rate)
        return audio.astype(np.float32), {"steps": len(latents), "truncated": not finished}
