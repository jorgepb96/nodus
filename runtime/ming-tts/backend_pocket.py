"""Kyutai's official pocket-tts CPU backend, using its six-layer language models.

Only local files are passed to the library. Electron downloads and verifies weights,
tokenizers and official voice states; this adapter rewrites the pinned package's configs
to those paths. One language model is resident at a time. User references are encoded
with Pocket's own audio-prompt API and cached as safetensors beside the saved recording.
"""
from __future__ import annotations

import gc
import hashlib
import json
import os
from pathlib import Path
import threading
from uuid import uuid4

LANGUAGES = {"es": "spanish", "en": "english", "fr": "french", "de": "german",
             "it": "italian", "pt": "portuguese", "nl": "dutch"}
DEFAULT_VOICES = {"es": "lola", "en": "alba", "fr": "estelle", "de": "juergen",
                  "it": "giovanni", "pt": "rafael", "nl": "daan"}
CACHE_VERSION = "pocket-tts-4.0.1-v2"
MAX_REFERENCE_SECONDS = 12


class _CancellationEvent(threading.Event):
    """Let Pocket poll the host's cancellation flag during latent generation too."""
    def __init__(self, check):
        super().__init__()
        self.check = check
        self.error = None

    def is_set(self):
        if self.check and not super().is_set():
            try:
                self.check()
            except Exception as error:
                self.error = error
                self.set()
        return super().is_set()


class PocketBackend:
    name = "pocket"
    device = "cpu"
    sample_rate = 24000
    device_name = "CPU · Kyutai Pocket TTS · 6 layers"

    def __init__(self):
        import torch
        from pocket_tts import TTSModel

        self._torch = torch
        self._model_cls = TTSModel
        # The official implementation uses a single torch thread plus its decoder worker.
        torch.set_num_threads(1)
        self.model_path = None
        self._model = None
        self._language = None
        self._voice_key = self._voice_state = None

    @property
    def loaded(self):
        return self._model is not None

    def load(self, model_path):
        self.unload()
        self.model_path = Path(model_path).resolve()
        self._select_language("en")

    def unload(self):
        self._model = self._language = self.model_path = None
        self._voice_key = self._voice_state = None
        gc.collect()

    def release_memory(self):
        pass

    def _select_language(self, language):
        if language not in LANGUAGES:
            raise ValueError(f"unsupported Pocket language: {language}")
        if self._language == language and self._model is not None:
            return
        if self.model_path is None:
            raise RuntimeError("no Pocket model selected")
        import yaml
        from pocket_tts.utils.config import CONFIGS_DIR

        directory = self.model_path / "languages" / LANGUAGES[language]
        weights, tokenizer = directory / "model.safetensors", directory / "tokenizer.json"
        default = directory / "embeddings" / f"{DEFAULT_VOICES[language]}.safetensors"
        for file in (weights, tokenizer, default):
            if not file.is_file():
                raise FileNotFoundError(f"Pocket asset missing: {file}")
        config = yaml.safe_load((CONFIGS_DIR / f"{LANGUAGES[language]}.yaml").read_text(encoding="utf-8"))
        if config["flow_lm"]["transformer"]["num_layers"] != 6:
            raise RuntimeError("Pocket requires the official six-layer checkpoint")
        config["weights_path"] = str(weights)
        # Never silently substitute the non-cloning model or download through HF's cache.
        config["weights_path_without_voice_cloning"] = None
        config["flow_lm"]["lookup_table"]["tokenizer_path"] = str(tokenizer)
        local_config = directory / "nodus-local.yaml"
        local_config.write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")
        self._model = self._voice_key = self._voice_state = None
        self._language = None
        gc.collect()
        model = self._model_cls.load_model(config=local_config)
        model.to(device="cpu").eval()
        if not model.has_voice_cloning:
            raise RuntimeError("the Pocket checkpoint does not support voice cloning")
        self._model, self._language = model, language
        self.sample_rate = model.sample_rate

    def _voice(self, reference, language):
        if reference is None:
            reference = {"kind": "embedding", "path": str(self.model_path / "languages" /
                         LANGUAGES[language] / "embeddings" / f"{DEFAULT_VOICES[language]}.safetensors")}
        kind = reference.get("kind")
        if kind == "embedding":
            source = Path(reference["path"])
            if source.suffix != ".safetensors" or not source.is_file():
                raise ValueError("Pocket requires a local official voice state")
            key = (language, str(source), source.stat().st_mtime_ns)
            if key != self._voice_key:
                self._voice_state = self._model.get_state_for_audio_prompt(source)
                self._voice_key = key
            return self._voice_state
        if kind != "clone":
            raise ValueError("Pocket voice.kind must be 'embedding' or 'clone'")
        source = Path(reference["wav_path"])
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        weights = self.model_path / "languages" / LANGUAGES[language] / "model.safetensors"
        stamp = weights.stat()
        identity = f"{CACHE_VERSION}:{language}:{stamp.st_size}:{stamp.st_mtime_ns}:{digest}"
        key = hashlib.sha256(identity.encode()).hexdigest()
        cache = Path(reference["cache_dir"]) / f"pocket-{language}-{key}.safetensors"
        if self._voice_key == key:
            return self._voice_state
        state = None
        if cache.is_file():
            try:
                state = self._model.get_state_for_audio_prompt(cache)
            except Exception:  # a damaged derived cache is rebuilt from the saved WAV
                pass
        if state is None:
            from pocket_tts.models.model_state import export_model_state
            from pocket_tts.data.audio import audio_read
            from pocket_tts.data.audio_utils import convert_audio

            # Long prompts can make the six-layer model omit or garble the requested
            # words. Keep the user's original recording and bound only the conditioning.
            audio, rate = audio_read(source)
            audio = convert_audio(audio, rate, self.sample_rate, 1)
            audio = audio[..., :int(MAX_REFERENCE_SECONDS * self.sample_rate)]
            state = self._model.get_state_for_audio_prompt(audio, truncate=True)
            cache.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            staging = cache.with_name(f"{cache.stem}-{uuid4()}.safetensors")
            try:
                export_model_state(state, staging)
                os.chmod(staging, 0o600)
                os.replace(staging, cache)
            finally:
                staging.unlink(missing_ok=True)
        self._voice_key, self._voice_state = key, state
        return state

    def synth_fragment(self, text, prompt=None, *, lang="en", reference=None, check_cancel=None, **_):
        import numpy as np

        if check_cancel:
            check_cancel()
        self._select_language(lang)
        state = self._voice(reference, lang)
        stop = _CancellationEvent(check_cancel)
        stream = self._model.generate_audio_stream(state, text, copy_state=True, stop=stop)
        chunks = []
        try:
            for chunk in stream:
                if check_cancel:
                    check_cancel()
                chunks.append(chunk.detach().cpu().numpy().reshape(-1))
        finally:
            stop.set()
            stream.close()
        if stop.error:
            raise stop.error
        if check_cancel:
            check_cancel()
        return (np.concatenate(chunks).astype(np.float32) if chunks else np.zeros(0, dtype=np.float32),
                {"steps": 0, "truncated": False})
