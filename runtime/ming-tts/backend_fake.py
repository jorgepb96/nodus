"""A stand-in backend for protocol tests: no model, standard library only.

It produces a quiet tone whose length follows the fragment's word count, and
sleeps briefly per decode step so cancellation can be exercised mid-fragment.
"""
from __future__ import annotations

import math
import time


class FakeBackend:
    name = "fake"
    device = "cpu"
    sample_rate = 16000
    STEP_S = 0.002

    def __init__(self):
        self.loaded = False

    def load(self, model_path):
        self.loaded = True

    def unload(self):
        self.loaded = False

    def release_memory(self):
        pass

    def load_audio(self, path, sample_rate):
        import wave

        import numpy as np

        with wave.open(path, "rb") as handle:
            frames = handle.readframes(handle.getnframes())
        return np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0

    def encode_prompt(self, audio):
        import numpy as np

        return np.zeros((1, 4, 64), dtype=np.float32), "float32"

    def to_latent(self, latent, dtype):
        return latent

    def synth_fragment(self, text, prompt, *, max_steps, check_cancel=None, **_):
        steps = min(max_steps, 5 * max(1, len(text.split())))
        for _step in range(steps):
            time.sleep(self.STEP_S)
            if check_cancel is not None:
                check_cancel()
        samples = int(self.sample_rate * 0.08 * steps)
        audio = [0.1 * math.sin(2 * math.pi * 220 * i / self.sample_rate) for i in range(samples)]
        return audio, {"steps": steps, "truncated": False}
