"""Run with Pocket's private interpreter: python scripts/test_pocket_tts_backend.py.

No network or weights are needed. The real backend, official config parser and official
safetensors voice-state IO are exercised with a small observable inference boundary.
"""
from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest
import wave

import torch
from pocket_tts.models.model_state import _import_model_state, export_model_state
from pocket_tts.utils.config import load_config

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "runtime" / "ming-tts"))
from backend_pocket import PocketBackend  # noqa: E402


class ObservableModel:
    sample_rate = 24000
    has_voice_cloning = True

    def __init__(self, owner):
        self.owner = owner

    def to(self, *, device):
        assert device == "cpu"
        return self

    def eval(self):
        return self

    def get_state_for_audio_prompt(self, source, truncate=False):
        if isinstance(source, Path) and source.suffix == ".safetensors":
            return _import_model_state(source, torch.device("cpu"))
        assert isinstance(source, torch.Tensor) and truncate
        assert source.shape == (1, 12 * 24000), 'long references are bounded before encoding'
        self.owner.encoded += 1
        return {"fixture": {"cache": torch.tensor([float(self.owner.encoded)])}}

    def generate_audio_stream(self, state, text, *, copy_state, stop):
        assert copy_state
        self.owner.texts.append(text)
        try:
            for _ in range(4):
                if stop.is_set():
                    break
                yield torch.ones(240, dtype=torch.float32) * 0.1
        finally:
            self.owner.closed += 1


class PocketBackendTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="nodus-pocket-backend-")
        self.root = Path(self.temporary.name)
        self.encoded = self.closed = 0
        self.configs, self.texts = [], []
        for language, voice in (("english", "alba"), ("spanish", "lola")):
            directory = self.root / "models" / "languages" / language
            (directory / "embeddings").mkdir(parents=True)
            (directory / "model.safetensors").write_bytes(b"observable weights")
            (directory / "tokenizer.json").write_text("{}")
            export_model_state({"fixture": {"cache": torch.ones(1)}}, directory / "embeddings" / f"{voice}.safetensors")
        self.reference = self.root / "reference.wav"
        self.write_reference(1)
        self.voice = {"kind": "clone", "wav_path": str(self.reference), "cache_dir": str(self.root / "cache")}
        self.backend = PocketBackend()
        self.backend._model_cls = self
        self.backend.load(self.root / "models")

    def write_reference(self, value):
        with wave.open(str(self.reference), "wb") as handle:
            handle.setparams((1, 2, 24000, 0, "NONE", "not compressed"))
            handle.writeframes(int(value).to_bytes(2, 'little') * (27 * 24000))

    def load_model(self, *, config):
        parsed = load_config(config)
        self.assertEqual(parsed.flow_lm.transformer.num_layers, 6)
        self.assertIsNone(parsed.weights_path_without_voice_cloning)
        self.assertTrue(Path(parsed.weights_path).is_file())
        self.assertTrue(Path(parsed.flow_lm.lookup_table.tokenizer_path).is_file())
        self.assertNotIn("hf://", config.read_text())
        self.configs.append(json.loads(config.read_text()))
        return ObservableModel(self)

    def tearDown(self):
        self.backend.unload()
        self.temporary.cleanup()

    def test_official_defaults_and_language_switch_use_local_cpu_configs(self):
        pcm, info = self.backend.synth_fragment("Hola.", lang="es")
        self.assertEqual(len(pcm), 960)
        self.assertFalse(info["truncated"])
        self.assertEqual(len(self.configs), 2)
        self.assertEqual(self.backend._language, "es")
        self.assertEqual(self.encoded, 0, "official states need no reference encoding")
        self.assertEqual(self.backend.device, "cpu")

    def test_cloned_voice_reuses_disk_state_after_restart(self):
        self.backend.synth_fragment("Primera frase.", lang="es", reference=self.voice)
        self.backend.synth_fragment("Segunda frase.", lang="es", reference=self.voice)
        self.assertEqual(self.encoded, 1)
        self.backend.load(self.root / "models")
        self.backend.synth_fragment("Tras reiniciar.", lang="es", reference=self.voice)
        self.assertEqual(self.encoded, 1)
        self.assertEqual(len(list((self.root / "cache").glob("*.safetensors"))), 1)
        self.write_reference(2)
        self.backend.synth_fragment("Otra voz.", lang="es", reference=self.voice)
        self.assertEqual(self.encoded, 2, "changed reference invalidates the state")

    def test_languages_and_damaged_caches_do_not_reuse_incompatible_states(self):
        self.backend.synth_fragment("Hola.", lang="es", reference=self.voice)
        self.backend.synth_fragment("Hello.", lang="en", reference=self.voice)
        self.assertEqual(self.encoded, 2)
        for cache in (self.root / "cache").glob("pocket-es-*.safetensors"):
            cache.write_bytes(b"damaged derived cache")
        self.backend.synth_fragment("Hola de nuevo.", lang="es", reference=self.voice)
        self.assertEqual(self.encoded, 3)
        with self.assertRaisesRegex(ValueError, "unsupported Pocket language"):
            self.backend.synth_fragment("Unsupported.", lang="zh")

    def test_cancellation_closes_the_official_stream(self):
        checks = 0

        def cancel():
            nonlocal checks
            checks += 1
            if checks >= 3:
                raise RuntimeError("cancelled")

        with self.assertRaisesRegex(RuntimeError, "cancelled"):
            self.backend.synth_fragment("Cancel this.", lang="en", check_cancel=cancel)
        self.assertEqual(self.closed, 1)


if __name__ == "__main__":
    unittest.main()
