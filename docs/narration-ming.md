# Narration with Ming 3.0 TTS

Nodus narrates research-chat answers, Deep Research reports, immersions, dictionary entries
and Study material with **Ming-3.0-tts 0.5B** (inclusionAI, MIT), running locally. It
replaces the Piper, Kokoro and Hume engines; their old clips stay playable (they are WAV
files) and are labelled with their original provider.

## Architecture

```
Renderer                                Main process                         Python sidecar
ListenButton / ListenBalloon ──tts:*──▶ electron/tts/service.ts ──stdin──▶ runtime/ming-tts/serve.py
NarrationProvider (AudioPlayer.tsx) ◀── tts:event ── host.ts (queue,     ◀─stdout─ JSON lines, one per
  two <audio> elements, gapless     ◀── nodus-audio:// ─ idle unload,              fragment; WAV files
NarrationMiniPlayer (header)              lower priority, kill)                    written to disk
```

- **Inference never runs in Electron.** The sidecar is spawned on demand at a lower CPU
  priority, loads one checkpoint, warms it up and stays resident until `ttsIdleUnloadMin`
  (default 5) minutes without work, an explicit «Desactivar», or app quit (all three quit
  paths call `killTtsSync`). The main thread only routes small messages.
- **Audio never crosses IPC.** The sidecar writes each fragment to
  `userData/local-tts/live/<jobId>/NNN.wav`; the renderer plays it through the
  `nodus-audio://` protocol (`electron/tts/audioProtocol.ts`), which streams files with
  range support. Saved clips and voice references use the same protocol. The old
  `audio:clipData` base64 data URLs are gone.
- **Streaming.** Ming 3.0 decodes text in ~50-word fragments (a 512-position cache), so the
  sidecar generates and emits fragment by fragment. The player starts with the first one
  when the measured real-time factor is ≤ 0.9; otherwise it waits until the buffered audio
  covers what generation is still behind (`liveStartThreshold` in `AudioPlayer.tsx`). Above
  RTF 1.5 the UI warns that playback may pause.
- **Segments and clips.** `electron/audio/speakable.ts` splits an item into narration
  segments (sections, stages); each is one Ming job and, when it ends, its fragments are
  joined (`wavConcat.ts`) into one clip in `<vault>/audio/` with a row in `audio_clips`.

## Backends

| Platform | Backend | Checkpoint |
|---|---|---|
| macOS arm64 | MLX (`mlx-audio==0.6.0`) on the GPU | `mlx-community/Ming-3.0-tts-0.5B-8bit` (1.6 GB) or the 4-bit `jorgepb96/Ming-3.0-tts-0.5B-4bit` (0.84 GB); the 4-bit is lighter and a little less faithful |
| Windows, Linux, macOS x64 | PyTorch: CUDA when an NVIDIA GPU answers, otherwise CPU (dynamic int8 on Linear layers) | `inclusionAI/Ming-3.0-tts-0.5B` (3.0 GB) |

`electron/tts/install.ts` builds a private CPython 3.12 environment under
`userData/local-tts/runtime/env-<uuid>` with `pip --require-hashes --no-deps
--only-binary=:all:` from `runtime/ming-tts/requirements-*.lock`, then publishes it only
after `serve.py --self-check` succeeds. On macOS the base is a system 3.12 or the pinned
standalone download, never the bundled runtime (the hardened runtime refuses native wheels).
If the CUDA build installs but sees no device, the CPU build replaces it.

Checkpoints download through `downloadVerifiedNodusAsset` (Range resume, exact size,
SHA-256) into `userData/local-tts/models/<id>/`; `ready.json` marks a verified download.

## Model parameters (from the upstream docs)

- `cfg 2.0`, `flow_steps 10`, `sigma 0.25`, `temperature 0`. Fewer flow steps were tried and
  produce audible artifacts.
- `Target language:` is added for de/es/fr/ja/ko and required there; zh/en need none.
- Built-in voices use the `IP` task with an empty speaker slot; voice cloning passes the
  reference clip and its exact transcript. The encoded prompt is cached per voice and model
  in `voices/<id>/cache/`.
- Text normalization (pynini) is off; `speakable.ts` cleans Markdown, citations and formulas.

## Voices

`electron/tts/voices.ts` keeps the library per user (not per vault) in
`userData/local-tts/voices/<id>/`:

- `user:<uuid>` — recorded (through `useLocalAudioRecorder`, after the microphone privacy
  notice) or uploaded; prepared in the renderer to mono 44.1 kHz, trimmed and normalized;
  saving requires the consent checkbox.
- `cc0:es-dave` — a Castilian clip from OHF-Voice/voice-datasets (CC0), bundled in
  `electron/assets/tts/voices/`.
- `ming:<name>` — Ming's built-in voices (`shared/mingBuiltinVoices.ts`), without the
  upstream entries that imitate film, series and cartoon characters.
- `phonon:<id>` — the 102-voice Gradium catalogue (`shared/phononVoices.ts`), downloaded on
  first use. The catalogue carries `es-es` voices; Nodus keeps their language when the text
  is Spanish and passes `es` to the Phonon runtime. On the English 31M checkpoint the voice
  and normalisation work, but the accent is approximate: the 40M Spanish/multilingual
  checkpoints are the quality path and stay gated and non-commercial.

## Retention

`electron/tts/retention.ts` deletes unpinned clips older than each surface's rule, at start-up
(after a minute) and every six hours, in batches of 100 with an event-loop yield between
them. Defaults: on, 7 days, every surface inheriting the global rule; each of Research chat,
Dictionary, Deep Research and Immersion can inherit, use its own days or never delete. Study
narration is never swept. «Conservar» pins a clip (`audio_clips.pinned`). Deleting a chat (or a
message), a report, an immersion or a dictionary entry deletes its clips.

## Data model

Migration **205** rebuilds `audio_clips` to accept `chat_message` and `dictionary_entry`
and adds `model_id` and `pinned`; `SYNC_SCHEMA_VERSION` moved to 205 with it. Chat clips use
`<conversationId>:<messageId>` as entity id so a conversation's clips can be found by prefix.

## Tests

`scripts/test-tts-catalogue.mjs`, `test-tts-engine-units.mjs` and
`test-tts-host-lifecycle.mjs` (a fake sidecar drives the real host: priority queue, cancel,
kill on an ignored cancel, idle unload, quit kill).
