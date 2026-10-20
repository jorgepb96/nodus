"""Phonon (gradium-ai/xn-ptts) backend: the `ptts` Rust runtime, no PyTorch.

Phonon runs far faster than real time on a CPU, so fragments are synthesized whole and
written as WAV like the other backends; the host streams them fragment by fragment.
Voices are speaker embeddings (`.safetensors`) registered by path; the sidecar never
reaches the network (the catalogue is downloaded and verified by Nodus). `lang` only
chooses how numbers, symbols and abbreviations are spelled out, and is fixed when a
`ptts.TTS` is built, so one instance is kept per language over the same checkpoint.
"""
from __future__ import annotations

import os

LANGUAGES = ("en", "fr", "de", "es", "pt")


class PhononBackend:
    name = "phonon"
    device = "cpu"
    sample_rate = 24000

    def __init__(self):
        import ptts

        self._ptts = ptts
        # Leave two cores for the app, as the torch backend does.
        threads = max(1, (os.cpu_count() or 2) - 2)
        try:
            ptts.set_num_threads(threads)
        except Exception:  # noqa: BLE001 - older runtimes size their own pool
            pass
        self.device_name = f"CPU · {threads} threads · q8"
        self.model_path = None
        self.instances = {}
        self.voices = {}

    @property
    def loaded(self) -> bool:
        return self.model_path is not None

    def load(self, model_path):
        self.model_path = str(model_path)
        self.instances = {}
        self.voices = {}
        self._tts("en")  # validate the checkpoint now rather than at the first request

    def unload(self):
        self.model_path = None
        self.instances = {}
        self.voices = {}

    def release_memory(self):
        pass

    def _tts(self, lang):
        lang = lang if lang in LANGUAGES else "none"
        tts = self.instances.get(lang)
        if tts is None:
            tts = self._ptts.TTS(self.model_path, lang=lang, quant="q8")
            for name, path in self.voices.items():
                tts.add_voice(name, path)
            self.instances[lang] = tts
            self.sample_rate = tts.sample_rate
        return tts

    def supports_cloning(self) -> bool:
        return bool(self._tts("en").supports_voice_cloning)

    def register_voice(self, name: str, path: str) -> None:
        if self.voices.get(name) == path:
            return
        self.voices[name] = path
        for tts in self.instances.values():
            tts.add_voice(name, path)

    def clone_voice(self, name: str, pcm) -> None:
        """Local cloning, only on checkpoints that support it (none of the public ones yet)."""
        for tts in [self._tts("en"), *self.instances.values()]:
            tts.clone_voice(name, pcm)
        self.voices.pop(name, None)

    def load_audio(self, path, sample_rate):
        import wave

        import numpy as np

        with wave.open(path, "rb") as handle:
            if handle.getsampwidth() != 2:
                raise ValueError("reference audio must be 16-bit PCM WAV")
            channels, rate = handle.getnchannels(), handle.getframerate()
            data = np.frombuffer(handle.readframes(handle.getnframes()), dtype="<i2").astype(np.float32) / 32768.0
        if channels > 1:
            data = data.reshape(-1, channels).mean(axis=1)
        if rate != sample_rate:
            positions = np.linspace(0, len(data) - 1, int(len(data) * sample_rate / rate))
            data = np.interp(positions, np.arange(len(data)), data).astype(np.float32)
        return data

    def synth_fragment(self, text, prompt=None, *, lang="en", voice=None, check_cancel=None, **_):
        if check_cancel is not None:
            check_cancel()
        tts = self._tts(lang)
        audio = tts.synth(text, voice=voice) if voice else tts.synth(text)
        return audio, {"steps": 0, "truncated": False}
