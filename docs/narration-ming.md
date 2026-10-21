# Narration with Ming 3.0 TTS

Nodus narrates research-chat answers, Deep Research reports, immersions, dictionary entries
and Study material locally with **Ming-3.0-tts 0.5B** (inclusionAI, MIT), **Phonon**
(Gradium) and **Kokoro-82M** (hexgrad, Apache-2.0). The older Piper, Kokoro and Hume
clips stay playable (they are WAV files) and are labelled with their original provider.

## Kokoro-82M

Kokoro is the third local engine: a single 82M ONNX graph (`kokoro-v1.0.int8.onnx`) plus
`voices-v1.0.bin` with 31 English and Spanish voices. It runs in its own Python environment
(`runtime/ming-tts/requirements-kokoro.lock`: `kokoro-onnx`, ONNX Runtime, espeak-ng, no
PyTorch) on the CPU, writes 24 kHz WAV fragments like Phonon and is measured at roughly
0.12–0.24 RTF on the Apple M2 (about 4–8× real time, depending on the voice and whether the
first phonemizer call is included). The model and voice pack are pinned to the
`thewh1teagle/kokoro-onnx` v1.0 release with exact sizes and SHA-256 and are deleted and
re-downloaded like any other checkpoint.

The Research chat header carries an **Escuchar** action for the latest finished answer. It
opens the same Listen balloon and starts the saved clip or generation on the first click;
the per-answer icon still opens the balloon without starting.

Nodus Scriptor has the same **Escuchar** button in its editor header, next to Context and
Focus. It narrates the document as it is when the balloon opens: the clips are keyed
`scriptor_document` / `<documentId>:<textHash>`, so an edited document is narrated again
instead of replaying stale audio. In notes, the «Lectura por voz» action opens this balloon;
study documents keep their study narration panel (modes, pronunciations, bookmarks). The
selection toolbar (and the floating «Pulir» bubble in raw Markdown) has a speaker icon that
reads the selected text at once. That narration is **ephemeral**: the speak request carries
no `save`, so no clip or row is written; the fragments live in the engine's live folder,
which is removed ten minutes after each job ends and on every start. A second click pauses
or resumes it, a new selection cancels the previous one, and without an engine the icon
opens the header balloon to install it.

The balloon's voice selector is a styled list, not a native select: it has a search box and
model/language filters that accept one or several choices (Ming, Phonon, Kokoro; any
combination of languages). The narration language select uses the same styled surface. The
picker lists the voices of every platform-supported checkpoint and selecting one carries
the checkpoint that speaks its language (Phonon's per-language model first, otherwise its
multilingual one; Kokoro has one checkpoint for both languages), so choosing a voice can
switch the model.

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
  saving requires the consent checkbox. Both paths need the exact transcript: save and
  update reject one shorter than three characters per second of audio (minimum 12), because
  Ming conditions the cloned prompt on that text and a file name produces stuttering and
  partial audio.
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
them. Defaults: on, 7 days, every surface inheriting the global rule except Nodus Scriptor,
which keeps its clips for one day (a draft keeps changing, so its narration is a quick check,
not an archive); each of Research chat, Dictionary, Deep Research, Immersion and Nodus
Scriptor can inherit, use its own days or never delete. Settings saved before a surface
existed get that surface's default. Study narration is never swept. «Conservar» pins a clip
(`audio_clips.pinned`). Deleting a chat (or a message), a report, an immersion, a dictionary
entry or a note deletes its clips; the sweep also removes the clips of Scriptor documents
that no longer exist (notes removed with their collection, study documents in the trash).

## Data model

Migration **205** rebuilds `audio_clips` to accept `chat_message` and `dictionary_entry`
and adds `model_id` and `pinned`; `SYNC_SCHEMA_VERSION` moved to 205 with it. Chat clips use
`<conversationId>:<messageId>` as entity id so a conversation's clips can be found by prefix.

Migration **206** rebuilds `audio_clips` again to accept `scriptor_document`, copying every
column. The columns do not change and 205 and 206 ship in the same release, so
`SYNC_SCHEMA_VERSION` stays at 205. Scriptor clips use `<documentId>:<textHash>`.

## Tests

`scripts/test-tts-catalogue.mjs`, `test-tts-engine-units.mjs` and
`test-tts-host-lifecycle.mjs` (a fake sidecar drives the real host: priority queue, cancel,
kill on an ignored cancel, idle unload, quit kill).
`test-narration-clip-cleanup.mjs` deletes real items (Scriptor notes included) and checks
that their clips go; `test-scriptor-listen.mjs` guards the Scriptor header button, the
selection icon and its ephemeral narration.
