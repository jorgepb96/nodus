"""Kokoro-82M backend: one quantized ONNX checkpoint plus the published voice pack.

`kokoro-onnx` runs the model on the CPU through ONNX Runtime and phonemizes English and
Spanish with espeak-ng (packaged by `espeakng-loader`), so no PyTorch or system espeak is
needed. The model is one 82M graph and every voice is a style vector in `voices-v1.0.bin`;
there is no per-voice download. Kokoro is fast enough that each fragment is synthesized
whole and written as WAV, like Phonon.
"""
from __future__ import annotations

import gc
import os
import pathlib
import re
import shutil
import tempfile

# espeak-ng's bundled dylib has a build-time data path. Point it at the wheel's data
# before phonemizer (or any library constructor) initializes the native library.
try:
    import espeakng_loader

    def espeak_data_path():
        """A short copy of espeak-ng's data.

        The bundled dylib refuses a very long data path (the userData environment path
        easily exceeds its internal buffer), so point it at a short copy in the system
        temporary directory. The copy is created once; 19 MB is small next to the model.
        """
        source = pathlib.Path(espeakng_loader.get_data_path())
        target = pathlib.Path(tempfile.gettempdir()) / "nodus-espeak-ng-data"
        if not (target / "phontab").is_file():
            if target.exists():
                shutil.rmtree(target, ignore_errors=True)
            shutil.copytree(source, target)
        return str(target)

    os.environ["ESPEAK_DATA_PATH"] = espeak_data_path()
except Exception:  # noqa: BLE001 - the self-check reports a missing espeak install
    def espeak_data_path():
        return None

LANGUAGES = ("es", "en")
MAX_CHUNK_CHARS = 360
DEFAULT_VOICE = "af_heart"


def _sentences(text):
    return [part.strip() for part in re.findall(r"[^.!?…]+[.!?…]+(?:[\"'”’)\]]+)?|[^.!?…]+$", text) if part.strip()]


def _hard_wrap(sentence, limit):
    if len(sentence) <= limit:
        return [sentence]
    out, line = [], ""
    for word in re.split(r"\s+", sentence):
        if not word:
            continue
        if len(word) > limit:
            if line:
                out.append(line)
                line = ""
            out.extend(word[i:i + limit] for i in range(0, len(word), limit))
            continue
        if line and len(line) + 1 + len(word) > limit:
            out.append(line)
            line = ""
        line = f"{line} {word}".strip()
    if line:
        out.append(line)
    return out


def chunk_text(text, limit=MAX_CHUNK_CHARS):
    """Sentence-aligned chunks under Kokoro's 509-token ceiling; never drops text."""
    clean = re.sub(r"\s+", " ", text).strip()
    if not clean:
        return []
    if len(clean) <= limit:
        return [clean]
    chunks, current = [], ""
    for sentence in _sentences(clean):
        for piece in _hard_wrap(sentence, limit):
            if current and len(current) + 1 + len(piece) > limit:
                chunks.append(current)
                current = ""
            current = f"{current} {piece}".strip()
    if current:
        chunks.append(current)
    return chunks


class KokoroBackend:
    name = "kokoro"
    device = "cpu"
    sample_rate = 24000

    def __init__(self):
        from kokoro_onnx import Kokoro  # noqa: F401  (fail at construction, not first synth)

        self._kokoro_cls = Kokoro
        self._kokoro = None
        self.model_path = None
        self.voices = set()
        self.device_name = "CPU · ONNX Runtime · int8"

    @property
    def loaded(self) -> bool:
        return self._kokoro is not None

    def load(self, model_path):
        directory = pathlib.Path(model_path)
        onnx = sorted(directory.glob("*.onnx"))
        pack = sorted(directory.glob("voices*.bin"))
        if not onnx:
            raise RuntimeError(f"no Kokoro ONNX model at {directory}")
        if not pack:
            raise RuntimeError(f"no Kokoro voice pack at {directory}")
        from kokoro_onnx.config import EspeakConfig

        data_path = espeak_data_path()
        self._kokoro = self._kokoro_cls(str(onnx[0]), str(pack[0]), espeak_config=EspeakConfig(
            data_path=data_path, lib_path=espeakng_loader.get_library_path()))
        self.voices = set(self._kokoro.get_voices())
        self.model_path = str(directory)
        self.sample_rate = 24000
        if DEFAULT_VOICE not in self.voices:
            raise RuntimeError("the Kokoro voice pack has no default voice")

    def unload(self):
        self._kokoro = None
        self.model_path = None
        self.voices = set()

    def release_memory(self):
        gc.collect()

    def supports_cloning(self) -> bool:
        return False

    def register_voice(self, name: str, path: str) -> None:
        raise RuntimeError("Kokoro voices are built into the voice pack")

    def clone_voice(self, name: str, pcm) -> None:
        raise RuntimeError("Kokoro cannot clone voices from a recording")

    def load_audio(self, path, sample_rate):
        raise RuntimeError("Kokoro does not use reference audio")

    def synth_fragment(self, text, prompt=None, *, lang="en", voice=None, check_cancel=None, **_):
        if self._kokoro is None:
            raise RuntimeError("no Kokoro model loaded")
        if check_cancel is not None:
            check_cancel()
        chosen = voice if voice in self.voices else DEFAULT_VOICE
        language = "es" if lang == "es" else ("en-gb" if chosen.startswith(("bf_", "bm_")) else "en-us")
        pieces = chunk_text(text)
        if not pieces:
            return [], {"steps": 0, "truncated": False}

        import numpy as np

        rendered = []
        rate = self.sample_rate
        for piece in pieces:
            if check_cancel is not None:
                check_cancel()
            audio, rate = self._kokoro.create(piece, voice=chosen, speed=1.0, lang=language)
            rendered.append(np.asarray(audio, dtype=np.float32))
        if not rendered:
            return np.zeros(0, dtype=np.float32), {"steps": 0, "truncated": False}
        gap = np.zeros(int(rate * 0.06), dtype=np.float32)
        joined = rendered[0]
        for part in rendered[1:]:
            joined = np.concatenate((joined, gap, part))
        return joined, {"steps": 0, "truncated": False}
