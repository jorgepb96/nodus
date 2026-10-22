# Pocket TTS: live CPU verification

Date: 2026-10-22. Platform: macOS arm64. All operations used an isolated QA profile.
The user authorized a local stereo WAV recorded at 48 kHz. Its prepared duration was
27.07 seconds. The source recording and the normal Nodus profile were not modified.
No personal audio, private transcripts, credentials or QA profiles are included in this repository.

## Results

The campaign passed using the official **voice-cloning** checkpoints after the account
received access on Hugging Face:

- Real private runtime installation and CPU self-check.
- Download cancellation and HTTP Range resume; incomplete files never become ready.
- All seven checkpoints, tokenizers and native default voices: 21 files totaling
  1,574,556,609 bytes, with exact size and SHA-256 verification.
- A second download over existing verified files.
- Actual browser audio preparation: mono conversion, resampling, silence trimming and normalization.
- Saving a custom voice without a transcript and generating speech from its reference.
- Persisting the WAV and SQLite metadata; decoding and playing it in Chromium.
- Reusing the saved voice from a new service instance and Python process without rewriting its cache.
- Synthesis with Alba, Lola, Estelle, Juergen, Giovanni, Rafael and Daan.
- Downloading all 27 named official voices and synthesizing with optional voice Anna.
- Cancelling a long narration, deleting the custom voice, deleting the model and removing the runtime.

The first successful cloned narration produced **8.96 seconds of audio in 4.377 seconds
of CPU generation**. Local Whisper small transcription confirmed the complete requested
text on both the initial generation and the generation after restarting the engine.
No reference or generated audio was sent to remote services.

## Issues found and fixed

1. Cancelling a download while a WriteStream had an outstanding write could crash the
   process with an unhandled `ERR_STREAM_DESTROYED`. The shared downloader now awaits
   every file write and closes its descriptor in `finally`. A focused regression covers
   cancellation, HTTP Range resume and final SHA-256 verification.
2. The full 27-second reference caused the six-layer model to omit or garble requested
   words. References of 8–12 seconds preserved the text. Pocket conditioning now uses
   at most **12 seconds**, resampled with the official audio helpers, while retaining
   the complete saved recording. The cache version changes and the UI explains the limit.

## Reproduction

Use a Python interpreter with `huggingface_hub` and a local credential authorized for
Kyutai's model:

```sh
NODUS_POCKET_PYTHON=/path/to/python \
NODUS_POCKET_REFERENCE=/path/to/authorized-reference.wav \
node scripts/verify-pocket-tts-live.mjs
```

The opt-in script creates an isolated profile and downloads real models and dependencies.
It needs disk space and network access. By default it uses Chrome on macOS;
`NODUS_QA_CHROME` selects another Chromium executable. The credential is passed to the
verified downloader in memory and is never written to the QA logs.

Additional validation passed: full TypeScript checks, ESLint for the changed TypeScript
files, focused TTS regressions, Python backend tests and UI translation coverage.
The authenticated live campaign is opt-in and does not run as part of ordinary CI.
