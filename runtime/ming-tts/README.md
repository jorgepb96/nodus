# Ming-3.0 TTS sidecar

Narration with voice cloning runs Ming-3.0-tts-0.5B (MIT) in a Python process that the
Electron main process spawns (`electron/tts/host.ts`). Inference never runs in Electron's
main or renderer process, so a long narration cannot freeze the window. The sidecar is
started at low priority, loads the model on demand, and is killed after it has been idle.
Audio never crosses the pipe: each fragment is written to disk as a WAV file and only its
path is reported, so the host can start playback while later fragments are still being
generated.

| Backend | Where | How |
| --- | --- | --- |
| `mlx` | macOS, Apple Silicon | mlx-audio 0.6.0 with the Ming-3.0 module vendored from mlx-audio main (`mlx_ming3/`), 8-bit MLX weights |
| `torch` | Windows x64, Linux x64, Intel macOS | the official inference code vendored in `ming_official/`; CUDA in bf16 (fp16 on GPUs without bf16), otherwise CPU in fp32 (int8 dynamic quantization of every `nn.Linear` behind `--cpu-quant int8`) |
| `fake` | anywhere | no model, standard library only; for protocol tests (`scripts/test-ming-sidecar-protocol.mjs`) |

## Files

| File | What it is |
| --- | --- |
| `serve.py` | Entry point: the protocol, the job queue, cancellation, the voice cache and WAV output. Backend-agnostic. |
| `ming_text.py` | Fragment splitting (a verbatim copy of mlx-audio's `_split_fragments`, checked by the protocol test), the prompt and its `Target language:` line, built-in voice captions. Standard library only. |
| `speaker.py` | CAM++ speaker embedding: Kaldi fbank in NumPy plus `campplus.onnx` on onnxruntime. |
| `prompt_audio.py` | Trims the reference clip's leading and trailing silence before it is encoded (why: below). |
| `backend_mlx.py`, `backend_torch.py`, `backend_fake.py` | One class each with the same small interface (`load`, `encode_prompt`, `synth_fragment`, ...). |
| `mlx_ming3/` | Vendored mlx-audio module; see its `NODUS_VENDOR.md` for the commit and why. |
| `ming_official/` | Vendored official inference code; see its `NODUS_VENDOR.md`. |
| `requirements-*.in` / `requirements-*.lock` | Inputs and hash-pinned locks (below). |
| `lock.sh`, `verify_locks.py` | Regenerate the locks; check every lock against every platform it serves. |

## Starting it

```
<venv>/python -I -B serve.py --backend mlx|torch --models-dir <dir> [--device auto|cuda|cpu] [--cpu-quant none|int8]
<venv>/python -I serve.py --self-check --backend mlx|torch [--device ...]
```

`--self-check` imports the whole inference stack without loading a model, runs one tiny
operation on the device, prints one line and exits: `{"ok":true,"backend":"mlx","device":"metal"|"cuda"|"cpu","versions":{"python":…,"mlx":…},"elapsed_s":…}`
(plus `device_name` on CUDA) with status 0, or `{"ok":false,"backend","error"}` with
status 1. It needs no `--models-dir`. The host runs it after building an environment.

- `-I` keeps the user's Python environment out (and leaves the script's directory off
  `sys.path`; `serve.py` adds its own directory). `-B` writes no `.pyc` next to the code.
- The environment can be scrubbed down to `PATH` (and `TMPDIR`/`TEMP`). The sidecar sets
  `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1` and `HF_HOME=<models-dir>/.hf` for itself:
  it never reaches the network and never writes into the user's own caches.
- `--device` only matters for `torch`: `auto` takes CUDA when torch sees a GPU,
  `cpu` forces the CPU, `cuda` fails at start-up without a GPU.
- The CPU backend sizes its thread pool to physical cores − 2 (at least 1).
- `--cpu-quant` (torch on the CPU only) defaults to `none`, plain fp32. `int8` applies
  `torch.ao.quantization.quantize_dynamic` to every `nn.Linear`. On the one CPU measured
  (Apple M2 through qnnpack) int8 was no faster, took 49–62 s to load instead of 7–9 s,
  and in two of seven runs missed the stop and ran on (20 s of audio for a 4 s sentence);
  fp32 did not in eight. x86 (fbgemm) has not been measured; measure there before
  turning it on.
- `.pyc` files are never written next to the code, with or without `-B`.
- The process exits with status 0 as soon as stdin reaches EOF, whatever it is doing,
  including while the model stack is still importing. Closing stdin is the normal way to
  stop it; killing it is safe too (WAV files are written under a `.part` name and renamed
  into place, so a reader never sees a half-written fragment).

## Protocol

One JSON object per line, UTF-8, in both directions. Commands go to stdin, events come
from stdout. **stdout carries protocol lines and nothing else**: the real stdout is
duplicated for the protocol at start-up and file descriptor 1 is pointed at stderr, so
nothing a library prints, in Python or native code, can corrupt the stream. stderr is
for human-readable logs only.

Every command has a `type` and may carry an `id`, echoed in its reply. Commands are
handled one at a time, in arrival order, except `cancel` and `exit`, which act
immediately even while a job is running.

### Start-up

| Event | When |
| --- | --- |
| `{"type":"ready","protocol":1,"backend":"mlx","device":"Device(gpu, 0) (Apple M2)","pid":123}` | Once, first, after the backend has imported. Commands sent earlier are queued, not lost. |
| `{"type":"fatal","message":"..."}` | Instead of `ready` when the backend cannot start (e.g. a missing package); the process then exits with status 3. |

### Commands

| Command | Replies |
| --- | --- |
| `{"type":"load","id","model_path","model_id","campplus_path"?}` | `{"type":"loaded","id","load_s","sample_rate","speaker_encoder"}` then, after an automatic warm-up synthesis, `{"type":"warm","id","warmup_s"}`. Loading the model that is already loaded replies at once (`"reused":true`, `load_s` and `warmup_s` 0). Loading another one unloads the first. |
| `{"type":"prepare_voice","id","voice_id","wav_path","text","cache_dir","spk_emb"?}` | `{"type":"voice_ready","id","voice_id","cache_path","prompt_s","spk_emb","elapsed_s"}` |
| `{"type":"synth","job_id","id"?,"text","voice","lang","out_dir","use_spk_emb"?}` | `fragment` events, then exactly one of `done`, `cancelled`, `error` (below). |
| `{"type":"cancel","job_id"}` | No reply of its own: the job ends with `cancelled`. |
| `{"type":"unload","id"}` | `{"type":"unloaded","id"}` |
| `{"type":"ping","id"}` | `{"type":"pong","id"}` |
| `{"type":"exit","id"}` | `{"type":"bye","id"}`, then the process exits with status 0. |

Any command can instead get `{"type":"error","id","message"}`. The sidecar keeps serving
after an error; only `fatal` ends it.

- `model_id` names the voice-cache file, so it may only contain letters, digits, `.`, `_`
  and `-`. Use a different id for each set of weights (e.g. `ming3-0.5b-mlx-8bit`,
  `ming3-0.5b-bf16`): prompt latents from one model are not valid for another.
- `campplus_path` locates `campplus.onnx` (the CAM++ speaker encoder). Without it the
  sidecar looks for `campplus.onnx` in `model_path`, then in `--models-dir`.
  `speaker_encoder` in `loaded` says whether one was found. It is only needed for
  `use_spk_emb`.
- `model_path` is a directory with `config.json` and the weights (layout below).

### Voices

A synth request names its voice in one of two ways:

```json
{"kind": "clone", "voice_id": "v1", "wav_path": "/…/ref.wav", "text": "exact transcript of ref.wav", "cache_dir": "/…/voices/v1"}
{"kind": "builtin", "name": "US_James"}
```

**Clone.** The reference clip is encoded once into the model's prompt latent and cached in
`cache_dir/<model_id>.npz` (NumPy archive: `latent`, optionally `spk_emb`, and `meta`, a
JSON string with the WAV's SHA-256, the transcript, the model id, the backend and the
latent's dtype). `prepare_voice` builds the cache ahead of time; a synth with a clone voice
builds it itself if it is missing, and rebuilds it whenever the WAV, the transcript, the
model or the backend changed. Encoding samples the VAE posterior, so caching is also what
makes one voice sound the same from job to job. `prepare_voice` also computes the 192-dim
CAM++ embedding when a speaker encoder is available (or when `"spk_emb": true`).

Before encoding, the clip's leading and trailing silence is cut, keeping 0.10 s before
the first sound and 0.15 s after the last (`prompt_audio.py`; `trimmed_s` in
`voice_ready` says how much went). Ming continues from the tail of the reference, whose
last latent seeds the first decode step, so a clip that ends in silence asks the model
to stay silent. Measured with a 9.1 s reference ending in 1.42 s of digital silence and
no speaker embedding: whole fragments came out silent (0.3 s after trimming the output)
in two of three seeds on MLX and in both seeds on the official torch code; with the tail
cut, every fragment spoke on both backends.

The transcript must match the clip exactly: Ming conditions on the pair, and a wrong
transcript degrades the audio. The clip and the text both occupy the model's 512-position
context, so a long reference leaves less room for each fragment; 5–12 s clips work well.
Any format libsndfile/miniaudio reads, any sample rate (it is resampled), stereo is mixed
down.

`use_spk_emb` (default `false`) additionally feeds the CAM++ embedding into the speaker
slot, as the official `--use_spk_emb` does. Without it the voice comes from the prompt
latent and transcript alone. An A/B of the two on this Mac is under *Measurements*.

**Built-in.** `name` is one of Ming's IP voices: the English `US_Emma`, `US_James`,
`UK_George`, `UK_Charlotte`, or a Chinese voice name from the upstream cookbook
(`cookbooks/instructions.md`, e.g. `灵小柔`). It is sent as the IP caption over a zeroed
speaker slot (`use_zero_spk_emb`), as the official IP task does. Anything else is refused.

### Synthesis

`lang` is one of `es`, `en`, `zh`, `fr`, `de`, `ja`, `ko` (default `en`). For `de`, `es`,
`fr`, `ja` and `ko` the prompt gets Ming-3.0's `Target language: <Language>.` line; `zh`
and `en` get none, as upstream.

The text is split into fragments exactly as mlx-audio's Ming-3.0 `generate` splits it: a
final period is added, then whole sentences are packed up to 50 "semantic units" (one per
Chinese character or Latin word), splitting an overlong sentence at commas and then at
words. Both backends use the same splitter, so a text yields the same fragments, and the
same file names, everywhere. The unit count only knows `[a-zA-Z]`, so an accented word
(`fútbol`, `mañana`) counts as two and Spanish fragments come out somewhat shorter than
50 words; that is upstream's behaviour and is kept as is. There is no text normalization (upstream's pynini FST
normalizer is not shipped): write numbers the way they should be read when it matters.

Sampling is fixed at Ming's reference settings, cfg 2.0, 10 flow steps, sigma 0.25,
temperature 0. Requests cannot lower the step count.

Each fragment is generated, decoded in one pass, trimmed of trailing silence (keeping
0.3 s, as upstream does per fragment) and written to `out_dir/NNN.wav` (`000.wav`,
`001.wav`, …): PCM16, mono, the model's native rate (44100 Hz). Then:

```json
{"type":"fragment","job_id":"j1","id":"…","n":0,"total":4,"path":"/…/000.wav","duration_s":6.85,"gen_s":5.12,"sample_rate":44100,"text":"the fragment's text","steps":86}
{"type":"done","job_id":"j1","id":"…","total":4,"total_audio_s":27.4,"total_gen_s":20.3,"rtf":0.74}
```

- `n` is 0-based and matches the file name. Fragments arrive strictly in order.
- `gen_s` is wall time for that fragment, including decoding and writing.
- `steps` is the number of 12.5 Hz latent steps generated. `"truncated":true` appears when
  a fragment hit the context budget before the model's stop head fired; its audio may end
  early.
- `out_dir` is created if missing. Existing files with the same names are overwritten.

**Exactly one terminal event per job**: `done`, `cancelled` or
`{"type":"error","job_id","id"?,"message"}`. Nothing for that job follows it.

**Cancellation** is cooperative and quick: the flag is checked between decode steps (each
~80 ms of audio) and between fragments, so a running job stops within one step. A job that
is still queued ends with `cancelled` without running. Fragments already reported stay on
disk. A `cancel` for a job that is not queued or running (already finished, unknown) is
ignored, because its terminal event was already sent.

A `synth` whose `job_id` is already queued or running is refused with
`{"type":"error","id","rejected_job_id","message"}`; the job already holding that id is
not affected (the error carries `rejected_job_id`, not `job_id`, for exactly that reason).

Between fragments the backend releases cached memory (`mx.clear_cache()` on MLX, whose
buffer cache is capped at 1 GiB, `torch.cuda.empty_cache()` on CUDA).

## Models

What the host downloads (and verifies) before `load`:

| Backend | Repository and revision | Files |
| --- | --- | --- |
| `mlx` | `mlx-community/Ming-3.0-tts-0.5B-8bit` @ `c807b99d2ea77d896fcffc917f0330d36470bb29` | `config.json`, `model.safetensors` (1,573,366,591 B, sha256 `e88a4b53…8971fc`), `model.safetensors.index.json`, `tokenizer.json`, `tokenizer_config.json`, `vocab.json`, `merges.txt`, `added_tokens.json`, `special_tokens_map.json`, `configuration.json`. `campplus.safetensors` is not needed. |
| `torch` | `inclusionAI/Ming-3.0-tts-0.5B` @ `e5bd8da31ecf1b9276cdbdda821fa891068f1368` | the same tokenizer/config files plus `model.safetensors` (2,959,055,504 B, sha256 `45c4d78d…d674c`, bf16) and `campplus.onnx` |
| speaker encoder (both) | `inclusionAI/Ming-3.0-tts-0.5B` @ the revision above | `campplus.onnx` (28,303,423 B, sha256 `a6ac6a63997761ae2997373e2ee1c47040854b4b759ea41ec48e4e42df0f4d73`) |

The MLX repository only carries the CAM++ weights as `campplus.safetensors` (ONNX
initializers with fused, unnamed convolutions), which cannot be run without the graph, so
MLX installs that want `use_spk_emb` fetch `campplus.onnx` from the official repository and
pass it as `campplus_path` (or put it in `--models-dir`).

## Python environments

Every lock is CPython 3.12, fully hash-pinned and wheel-only, and installs with

```
python -m pip install --require-hashes --no-deps --only-binary=:all: -r requirements-<x>.lock
```

| Lock | Platforms | Notes |
| --- | --- | --- |
| `requirements-mlx.lock` | darwin-arm64 (macOS 14+) | mlx 0.32.4, mlx-audio 0.6.0, transformers 5.x (tokenizer only, no torch), onnxruntime. ~730 MB installed. |
| `requirements-torch-cpu.lock` | win32-x64, linux-x64, darwin-x64 | torch/torchaudio 2.6.0+cpu from `download.pytorch.org/whl/cpu` on Windows and Linux (206 MB / 179 MB wheels). PyTorch publishes nothing for Intel Macs after 2.2.2, so darwin gets torch 2.2.2 (151 MB) through markers; NumPy is held at 1.26.4 everywhere because 2.2.2 needs NumPy 1. |
| `requirements-torch-cuda.lock` | win32-x64, linux-x64 | torch/torchaudio 2.6.0+cu124. The Windows torch wheel is 2.53 GB on its own; on Linux torch is 768 MB plus the `nvidia-*` CUDA 12.4 wheels (cuDNN alone 665 MB). Needs an NVIDIA driver recent enough for CUDA 12 (CUDA 12.4 itself ships with 550 on Linux and 551 on Windows). |

The torch locks carry their `--extra-index-url` lines, so pip finds the PyTorch wheels.
Wheels above 256 MB exceed the per-wheel ceiling of the capability runtime installer
(`electron/capabilities/pythonRuntime.ts`), so the TTS host cannot reuse that validator
as it is for the CUDA lock.

`./lock.sh` regenerates all three with `uv pip compile` and then runs `verify_locks.py`,
which checks, for each lock and each platform it serves, that every requirement whose
marker holds there has a wheel on one of the lock's indexes whose tags that platform
accepts and whose SHA-256 is in the lock. That is pip's own selection, simulated from the
index pages, so the Windows and Linux locks can be checked from a Mac.

## Measurements

MacBook Air M2 (Mac14,15, 16 GB), 2026-10-20, nothing else on the GPU. The text is two
Spanish paragraphs, 102 semantic units, split into three fragments of 50, 35 and 17
units. Reference clips: `es_castellano` (9.1 s, 7.8 s after trimming) and `es_mi_voz`
(12.9 s, 12.5 s). `gen_s` is wall time per fragment, including decode and the WAV write.

**MLX, 8-bit** (`requirements-mlx.lock`): load 1.8 s, warm-up 0.6 s, `prepare_voice`
0.5–1.7 s (prompt latent plus CAM++).

| Job | Fragment audio / generation (s) | Total audio | Total gen | RTF |
| --- | --- | --- | --- | --- |
| `es_castellano`, no spk_emb | 12.56 / 10.36 · 9.20 / 7.94 · 4.16 / 3.47 | 25.9 | 21.8 | 0.84 |
| `es_castellano`, no spk_emb (A/B run) | 12.48 / 11.43 · 8.90 / 8.90 · 4.16 / 4.27 | 25.5 | 24.6 | 0.96 |
| `es_castellano`, spk_emb | 12.16 / 12.14 · 9.04 / 9.39 · 4.16 / 4.53 | 25.4 | 26.1 | 1.03 |
| `es_mi_voz`, no spk_emb | 12.88 / 13.39 · 9.84 / 11.00 · 4.80 / 5.37 | 27.5 | 29.8 | 1.08 |
| `es_mi_voz`, spk_emb | 12.80 / 13.37 · 10.32 / 11.26 · 4.56 / 5.03 | 27.7 | 29.7 | 1.07 |

On this base M2, generation runs at about real time, so streaming playback starts after
the first fragment (~10–13 s) and can then stall briefly between fragments. Cancelling
mid-job ended it 0.15 s after the `cancel` was sent, with one fragment written.

**torch on the CPU** (`requirements-torch-cpu.lock`, darwin branch: torch 2.2.2; same
numbers with torch 2.6.0), official bf16 weights run in fp32, 6 threads: load 6.9 s,
warm-up 5.2 s, RTF 6–8 on one-sentence fragments. The M2's CPU is not the target here
(Windows/Linux x86 desktops are), so read this only as "works, and is far from real time
on a laptop CPU".

**Parity with the official code.** For the same request, MLX and the vendored official
code build identical token sequences (199 tokens), and on identical inputs agree to a
cosine ≥ 0.9998 on the LLM's hidden state and stop probability, ≥ 0.9999 on the DiT
velocity, and 1.0000 on a full 10-step flow integration (8-bit MLX against bf16 run in
fp32). The NumPy fbank matches `torchaudio.compliance.kaldi.fbank` to within 7.3e-4,
and the CAM++ embeddings match the official extractor's to 1.1e-5 (cosine 1.0000) on
three clips.

**Speaker embedding A/B.** With a clean reference, `use_spk_emb` changed neither length
nor speed measurably. Before the reference trim it was what rescued `es_castellano`;
after the trim both modes speak. Whether it improves similarity is a listening question:
the WAVs are kept for that.

**CUDA** has not been run: no NVIDIA GPU was available. The code path is the official one
(bf16 under the official CUDA autocast) and the lock is checked by `verify_locks.py`, but
it has not executed.
