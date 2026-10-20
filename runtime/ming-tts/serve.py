"""Nodus Ming-3.0 TTS sidecar: JSON lines in on stdin, JSON lines out on stdout.

Nodus' main process starts this under its private interpreter with -I -B and
a scrubbed environment, at low priority, and kills it after it has been idle.
Inference therefore never runs inside Electron. Audio never crosses the pipe
either: every fragment is written as a PCM16 WAV under the job's ``out_dir``
and only its path is reported. The process exits as soon as stdin reaches EOF
(including a crash of the parent), so an orphaned synthesizer can never
outlive Nodus. stdout carries the protocol and nothing else; logs, warnings
and anything a library prints go to stderr.

    python -I -B serve.py --backend mlx|torch|fake --models-dir <dir> [--device auto|cuda|cpu]

The protocol is documented in README.md next to this file.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import queue
import re
import sys
import threading
import time
import traceback

ROOT = pathlib.Path(__file__).resolve().parent
# -I leaves the script's directory off sys.path. Never write .pyc next to the
# code, even when started without -B: packaged resources are read-only.
sys.path.insert(0, str(ROOT))
sys.dont_write_bytecode = True

# Keep a private handle on the real stdout for the protocol, then point fd 1
# (and sys.stdout) at stderr, so a stray print in Python or native code can
# never interleave with a protocol line.
_protocol = os.fdopen(os.dup(1), "wb", buffering=0)
os.dup2(2, 1)
sys.stdout = sys.stderr
_emit_lock = threading.Lock()

import ming_text  # noqa: E402  (stdlib only)

PROTOCOL_VERSION = 1
VOICE_CACHE_VERSION = 1
# Ming-3.0 reference sampling. Requests cannot change them: fewer flow steps
# audibly degrade the voice.
SAMPLING = {"cfg": 2.0, "flow_steps": 10, "sigma": 0.25, "temperature": 0.0}
MAX_DECODE_STEPS = 1000  # each fragment is bounded first by the 512-position cache
WARMUP_TEXT = "Hello."
WARMUP_STEPS = 8
_MODEL_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def emit(event: dict) -> None:
    data = (json.dumps(event, ensure_ascii=False) + "\n").encode("utf-8")
    with _emit_lock:
        _protocol.write(data)


def log(message: str) -> None:
    sys.stderr.write(f"[ming-tts] {message}\n")
    sys.stderr.flush()


class Cancelled(Exception):
    pass


class RequestError(Exception):
    """A request the sidecar refuses; reported without a traceback."""


def _require(msg: dict, key: str, kind=str):
    value = msg.get(key)
    if not isinstance(value, kind) or (kind is str and not value.strip()):
        raise RequestError(f"'{key}' is required")
    return value


def _file_sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def write_wav(path: pathlib.Path, audio, sample_rate: int) -> float:
    """PCM16 mono, written to a temporary name and renamed into place."""
    import wave

    try:
        import numpy as np
    except ImportError:  # the fake backend runs on a bare interpreter
        from array import array

        pcm = array("h", (int(round(max(-1.0, min(1.0, float(x))) * 32767.0)) for x in audio))
        if sys.byteorder == "big":
            pcm.byteswap()
        count, frames = len(pcm), pcm.tobytes()
    else:
        samples = np.clip(np.asarray(audio, dtype=np.float32).reshape(-1), -1.0, 1.0)
        pcm = (samples * 32767.0).round().astype("<i2")
        count, frames = pcm.shape[0], pcm.tobytes()
    tmp = path.with_name(path.name + ".part")
    with wave.open(str(tmp), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(int(sample_rate))
        handle.writeframes(frames)
    os.replace(tmp, path)
    return count / float(sample_rate)


class Server:
    def __init__(self, models_dir: pathlib.Path):
        self.backend = None  # set once the backend has imported
        self.models_dir = models_dir
        self.model_id = None
        self.model_path = None
        self.campplus = None
        self.campplus_path = None
        self.commands: queue.Queue = queue.Queue()
        self.state = threading.Lock()
        self.pending: set = set()  # synth jobs queued or running
        self.cancelled: set = set()

    # -- stdin (reader thread) -------------------------------------------
    def read_commands(self) -> None:
        try:
            for raw in sys.stdin.buffer:
                line = raw.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line.decode("utf-8"))
                    if not isinstance(msg, dict):
                        raise ValueError("not an object")
                except ValueError as error:
                    emit({"type": "error", "id": None, "message": f"invalid command line: {error}"})
                    continue
                kind = msg.get("type", msg.get("cmd"))
                if kind == "cancel":
                    self.cancel(msg)
                elif kind == "exit":
                    emit({"type": "bye", "id": msg.get("id")})
                    os._exit(0)
                else:
                    if kind == "synth":
                        job_id = msg.get("job_id")
                        with self.state:
                            if not isinstance(job_id, str) or not job_id or job_id in self.pending:
                                # Not tagged with job_id: the job already queued under
                                # that id still owns its one terminal event.
                                emit({"type": "error", "id": msg.get("id"), "rejected_job_id": job_id,
                                      "message": "synth needs a 'job_id' that is not already queued"})
                                continue
                            self.pending.add(job_id)
                    self.commands.put(msg)
        finally:
            # EOF: the parent closed the pipe or died. Leave at once.
            os._exit(0)

    def cancel(self, msg: dict) -> None:
        job_id = msg.get("job_id")
        with self.state:
            if job_id in self.pending:
                self.cancelled.add(job_id)
                return
        # Finished, never queued, or already cancelled: its terminal event has
        # been or will be sent, so a second one would only confuse the host.
        log(f"cancel for job {job_id!r} that is not queued or running; ignored")

    def stop_requested(self, job_id: str) -> bool:
        return job_id in self.cancelled

    def check_cancel(self, job_id: str) -> None:
        if job_id in self.cancelled:
            raise Cancelled

    # -- main thread ------------------------------------------------------
    def serve(self) -> None:
        handlers = {
            "load": self.load,
            "prepare_voice": self.prepare_voice,
            "synth": self.synth,
            "unload": self.unload,
            "ping": lambda msg: emit({"type": "pong", "id": msg.get("id")}),
        }
        while True:
            msg = self.commands.get()
            kind = msg.get("type", msg.get("cmd"))
            handler = handlers.get(kind)
            if handler is None:
                emit({"type": "error", "id": msg.get("id"), "message": f"unknown command: {kind!r}"})
                continue
            try:
                handler(msg)
            except RequestError as error:
                emit({"type": "error", "id": msg.get("id"), "message": str(error)})
            except Exception as error:  # noqa: BLE001  (reported, then keep serving)
                traceback.print_exc()
                emit({"type": "error", "id": msg.get("id"), "message": f"{type(error).__name__}: {error}"})

    def load(self, msg: dict) -> None:
        model_path = pathlib.Path(_require(msg, "model_path"))
        model_id = _require(msg, "model_id")
        if not _MODEL_ID_RE.match(model_id):
            raise RequestError("'model_id' may only contain letters, digits, '.', '_' and '-'")
        if not (model_path / "config.json").is_file():
            raise RequestError(f"no model at {model_path}")
        if self.model_path == model_path.resolve() and self.backend.loaded:
            self.model_id = model_id
            emit({"type": "loaded", "id": msg.get("id"), "load_s": 0.0, "sample_rate": self.backend.sample_rate, "reused": True})
            emit({"type": "warm", "id": msg.get("id"), "warmup_s": 0.0})
            return
        self.unload_model()
        started = time.perf_counter()
        self.backend.load(str(model_path))
        self.model_path, self.model_id = model_path.resolve(), model_id
        campplus = msg.get("campplus_path")
        candidates = [pathlib.Path(campplus)] if isinstance(campplus, str) and campplus else [
            model_path / "campplus.onnx", self.models_dir / "campplus.onnx"]
        self.campplus_path = next((str(p) for p in candidates if p.is_file()), None)
        emit({"type": "loaded", "id": msg.get("id"), "load_s": round(time.perf_counter() - started, 3),
              "sample_rate": self.backend.sample_rate, "speaker_encoder": self.campplus_path is not None})
        started = time.perf_counter()
        self.backend.synth_fragment(WARMUP_TEXT, ming_text.tts_prompt("en"), max_steps=WARMUP_STEPS, **SAMPLING)
        self.backend.release_memory()
        emit({"type": "warm", "id": msg.get("id"), "warmup_s": round(time.perf_counter() - started, 3)})

    def unload_model(self) -> None:
        if self.backend.loaded:
            self.backend.unload()
        self.model_path = self.model_id = self.campplus = self.campplus_path = None

    def unload(self, msg: dict) -> None:
        self.unload_model()
        emit({"type": "unloaded", "id": msg.get("id")})

    # -- voices -----------------------------------------------------------
    def _speaker_encoder(self):
        if self.campplus is None:
            if not self.campplus_path:
                raise RequestError("speaker embeddings need campplus.onnx next to the model, in --models-dir, or as 'campplus_path' on load")
            from speaker import CamPlusPlus
            self.campplus = CamPlusPlus(self.campplus_path)
        return self.campplus

    def voice_prompt(self, voice: dict, want_spk_emb: bool) -> dict:
        """The cached prompt latent (and speaker embedding) for a clone voice.

        The cache is ``cache_dir/<model_id>.npz``; it is reused only while the
        reference WAV, its transcript, the model and the backend are the ones
        it was made from. The clip's leading and trailing silence is cut first
        (see prompt_audio.py).
        """
        import numpy as np

        from prompt_audio import trim_silence

        if not self.backend.loaded:
            raise RequestError("no model loaded")
        voice_id = _require(voice, "voice_id")
        wav_path = _require(voice, "wav_path")
        text = _require(voice, "text").strip()
        cache_dir = pathlib.Path(_require(voice, "cache_dir"))
        if not os.path.isfile(wav_path):
            raise RequestError(f"voice {voice_id}: reference audio not found: {wav_path}")
        meta = {"version": VOICE_CACHE_VERSION, "model_id": self.model_id, "backend": self.backend.name,
                "wav_sha256": _file_sha256(wav_path), "text": text}
        cache_file = cache_dir / f"{self.model_id}.npz"
        cached = None
        try:
            with np.load(cache_file, allow_pickle=False) as data:
                stored = json.loads(str(data["meta"]))
                if all(stored.get(key) == value for key, value in meta.items()):
                    cached = {"meta": stored, "latent": data["latent"],
                              "spk_emb": data["spk_emb"] if "spk_emb" in data.files else None}
        except FileNotFoundError:
            pass
        except Exception as error:  # noqa: BLE001  (a damaged cache is rebuilt)
            log(f"voice {voice_id}: ignoring unreadable cache {cache_file}: {error}")

        dirty = False
        if cached is None:
            audio, trimmed = trim_silence(self.backend.load_audio(wav_path, self.backend.sample_rate),
                                          self.backend.sample_rate)
            latent, dtype = self.backend.encode_prompt(audio)
            cached = {"meta": {**meta, "latent_dtype": dtype, "latent_steps": int(latent.shape[1]),
                               "trimmed_s": round(trimmed, 3)},
                      "latent": latent, "spk_emb": None}
            dirty = True
        if want_spk_emb and cached["spk_emb"] is None:
            audio, _ = trim_silence(self.backend.load_audio(wav_path, 16000), 16000)
            cached["spk_emb"] = self._speaker_encoder().embed(audio)
            dirty = True
        if dirty:
            cache_dir.mkdir(parents=True, exist_ok=True)
            arrays = {"meta": np.array(json.dumps(cached["meta"], ensure_ascii=False)),
                      "latent": np.asarray(cached["latent"], dtype=np.float32)}
            if cached["spk_emb"] is not None:
                arrays["spk_emb"] = np.asarray(cached["spk_emb"], dtype=np.float32)
            tmp = cache_file.with_name(cache_file.name + ".part")
            with open(tmp, "wb") as handle:
                np.savez(handle, **arrays)
            os.replace(tmp, cache_file)
        cached["text"] = text
        return cached

    def prepare_voice(self, msg: dict) -> None:
        started = time.perf_counter()
        voice = {key: msg.get(key) for key in ("voice_id", "wav_path", "text", "cache_dir")}
        want = msg.get("spk_emb")
        want_spk_emb = self.campplus_path is not None if want is None else bool(want)
        cached = self.voice_prompt(voice, want_spk_emb)
        emit({"type": "voice_ready", "id": msg.get("id"), "voice_id": voice["voice_id"],
              "cache_path": str(pathlib.Path(voice["cache_dir"]) / f"{self.model_id}.npz"),
              "prompt_s": round(cached["meta"]["latent_steps"] / 12.5, 2),
              "trimmed_s": cached["meta"].get("trimmed_s", 0.0),
              "spk_emb": cached["spk_emb"] is not None, "elapsed_s": round(time.perf_counter() - started, 3)})

    # -- synthesis --------------------------------------------------------
    def synth(self, msg: dict) -> None:
        job_id = msg["job_id"]
        base = {"job_id": job_id}
        if msg.get("id") is not None:
            base["id"] = msg["id"]
        try:
            self._synth(msg, job_id, base)
        except Cancelled:
            emit({"type": "cancelled", **base})
        except RequestError as error:
            emit({"type": "error", **base, "message": str(error)})
        except Exception as error:  # noqa: BLE001
            traceback.print_exc()
            emit({"type": "error", **base, "message": f"{type(error).__name__}: {error}"})
        finally:
            self.backend.release_memory()
            with self.state:
                self.pending.discard(job_id)
                self.cancelled.discard(job_id)

    def _synth(self, msg: dict, job_id: str, base: dict) -> None:
        if self.stop_requested(job_id):
            raise Cancelled
        if not self.backend.loaded:
            raise RequestError("no model loaded")
        text = _require(msg, "text")
        out_dir = pathlib.Path(_require(msg, "out_dir"))
        lang = str(msg.get("lang") or "en").strip().lower()
        if lang not in ming_text.LANGUAGES:
            raise RequestError(f"unsupported lang {lang!r}; expected one of {', '.join(ming_text.LANGUAGES)}")
        voice = msg.get("voice")
        if not isinstance(voice, dict):
            raise RequestError("'voice' is required")
        kind = voice.get("kind")
        conditioning = {}
        if kind == "clone":
            use_spk_emb = bool(msg.get("use_spk_emb", False))
            cached = self.voice_prompt(voice, use_spk_emb)
            conditioning = {
                "prompt_latent": self.backend.to_latent(cached["latent"], cached["meta"].get("latent_dtype")),
                "prompt_text": cached["text"],
                "spk_emb": cached["spk_emb"] if use_spk_emb else None,
            }
        elif kind == "builtin":
            try:
                instruction = ming_text.builtin_voice_instruction(voice.get("name"))
            except ValueError as error:
                raise RequestError(str(error)) from None
            conditioning = {"instruction": instruction, "use_zero_spk_emb": True}
        else:
            raise RequestError("voice.kind must be 'clone' or 'builtin'")

        fragments = ming_text.split_fragments(text)
        if not fragments:
            raise RequestError("text has nothing to synthesize")
        out_dir.mkdir(parents=True, exist_ok=True)
        prompt = ming_text.tts_prompt(lang)
        total_audio = total_gen = 0.0
        sample_rate = self.backend.sample_rate
        for n, fragment in enumerate(fragments):
            if self.stop_requested(job_id):
                raise Cancelled
            started = time.perf_counter()
            audio, info = self.backend.synth_fragment(
                fragment, prompt, max_steps=MAX_DECODE_STEPS,
                check_cancel=lambda: self.check_cancel(job_id), **conditioning, **SAMPLING)
            path = out_dir / f"{n:03d}.wav"
            duration = write_wav(path, audio, sample_rate)
            gen = time.perf_counter() - started
            self.backend.release_memory()
            total_audio += duration
            total_gen += gen
            event = {"type": "fragment", **base, "n": n, "total": len(fragments), "path": str(path),
                     "duration_s": round(duration, 3), "gen_s": round(gen, 3), "sample_rate": sample_rate,
                     "text": fragment, "steps": info["steps"]}
            if info.get("truncated"):
                event["truncated"] = True
            emit(event)
        emit({"type": "done", **base, "total": len(fragments), "total_audio_s": round(total_audio, 3),
              "total_gen_s": round(total_gen, 3), "rtf": round(total_gen / total_audio, 3) if total_audio else None})


_PACKAGES = {
    "mlx": ("mlx", "mlx-metal", "mlx-audio", "transformers", "tokenizers", "onnxruntime", "numpy"),
    "torch": ("torch", "torchaudio", "transformers", "tokenizers", "x-transformers", "diffusers",
              "accelerate", "onnxruntime", "soundfile", "numpy"),
    "fake": (),
}


def self_check(backend: str, device: str) -> int:
    """Import the whole inference stack without loading a model; one JSON line.

    The host runs this after building the environment: an import error, a
    wheel built for another platform or a missing native library surfaces here
    instead of at the first narration.
    """
    import importlib.metadata
    import platform

    started = time.perf_counter()
    try:
        detail = None
        if backend == "mlx":
            import mlx.core as mx

            from backend_mlx import _install_vendored_model
            _install_vendored_model()
            import mlx_audio.tts.utils  # noqa: F401
            import onnxruntime  # noqa: F401

            import speaker  # noqa: F401
            kind = "metal" if mx.metal.is_available() else "cpu"
            mx.eval(mx.ones(4) + 1)  # one op on the device: a broken Metal stack fails here
        elif backend == "torch":
            import onnxruntime  # noqa: F401
            import soundfile  # noqa: F401
            import torch
            import torchaudio  # noqa: F401

            sys.path.insert(0, str(ROOT / "ming_official"))
            import modeling_bailingmm  # noqa: F401  (pulls in the whole official stack)
            import speaker  # noqa: F401
            kind = "cuda" if device != "cpu" and torch.cuda.is_available() else "cpu"
            if device == "cuda" and kind != "cuda":
                raise RuntimeError("CUDA was requested but torch sees no CUDA device")
            if kind == "cuda":
                detail = torch.cuda.get_device_name(0)
                torch.ones(4, device="cuda").sum().item()
        else:
            kind = "cpu"
        versions = {"python": platform.python_version()}
        versions.update({name: importlib.metadata.version(name) for name in _PACKAGES[backend]})
        result = {"ok": True, "backend": backend, "device": kind, "versions": versions,
                  "elapsed_s": round(time.perf_counter() - started, 3)}
        if detail:
            result["device_name"] = detail
        emit(result)
        return 0
    except Exception as error:  # noqa: BLE001
        traceback.print_exc()
        emit({"ok": False, "backend": backend, "error": f"{type(error).__name__}: {error}"})
        return 1


def main() -> None:
    parser = argparse.ArgumentParser(description="Nodus Ming-3.0 TTS sidecar")
    parser.add_argument("--backend", choices=("mlx", "torch", "fake"), required=True)
    parser.add_argument("--models-dir")
    parser.add_argument("--device", choices=("auto", "cuda", "cpu"), default="auto", help="torch only")
    # fp32 by default: on the one CPU measured (Apple M2, qnnpack) int8 was no
    # faster, loaded 5-6x slower, and twice in seven runs missed the stop and
    # ran on. x86 (fbgemm) is unmeasured; the switch is there to measure it.
    parser.add_argument("--cpu-quant", choices=("int8", "none"), default="none",
                        help="torch on the CPU: plain fp32 (default) or int8 dynamic quantization of nn.Linear")
    parser.add_argument("--self-check", action="store_true", help="import the stack, print one JSON line, exit")
    args = parser.parse_args()
    if not args.self_check and not args.models_dir:
        parser.error("--models-dir is required")

    # Never reach the network and never write into the user's own caches:
    # every file the sidecar reads was downloaded and verified by Nodus.
    os.environ.update({
        "HF_HUB_OFFLINE": "1",
        "TRANSFORMERS_OFFLINE": "1",
        "HF_HUB_DISABLE_TELEMETRY": "1",
        "TOKENIZERS_PARALLELISM": "false",
        "TQDM_DISABLE": "1",
    })
    os.environ.setdefault("PATH", os.defpath)
    if args.self_check:
        sys.stderr.flush()
        os._exit(self_check(args.backend, args.device))

    models_dir = pathlib.Path(args.models_dir).resolve()
    os.environ["HF_HOME"] = str(models_dir / ".hf")

    # Watch stdin before the slow imports, so EOF while the model stack loads
    # still exits at once. Commands that arrive meanwhile wait in the queue.
    server = Server(models_dir)
    threading.Thread(target=server.read_commands, name="nodus-parent-watch", daemon=True).start()

    try:
        if args.backend == "mlx":
            from backend_mlx import MlxBackend
            server.backend = MlxBackend()
        elif args.backend == "torch":
            from backend_torch import TorchBackend
            server.backend = TorchBackend(args.device, args.cpu_quant)
        else:
            from backend_fake import FakeBackend
            server.backend = FakeBackend()
    except Exception as error:  # noqa: BLE001
        traceback.print_exc()
        emit({"type": "fatal", "message": f"{type(error).__name__}: {error}"})
        os._exit(3)

    emit({"type": "ready", "protocol": PROTOCOL_VERSION, "backend": server.backend.name,
          "device": server.backend.device, "pid": os.getpid()})
    server.serve()


if __name__ == "__main__":
    main()
