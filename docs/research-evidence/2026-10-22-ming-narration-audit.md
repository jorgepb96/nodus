# Ming narration: missing speech and changing timbre

## Confirmed cause of missing speech

Ming's reference runtime limits each request to 512 positions, shared by the
instruction, target text, clone transcript, clone audio latents and generated
audio. Nodus previously split by a fixed limit of 50 semantic units without
accounting for the reference. Both adapters reported `truncated` when the stop
head had not fired, but `serve.py` still published the audio and the Electron
host ignored that flag. The next fragment then started, leaving the remainder
of the previous fragment unspoken.

The installed app's local log also contained requests with 537 input positions,
which failed before decoding. This is distinct from silently exhausting the
remaining output budget during generation.

## Local reproduction and checks

Tests used the already installed MLX checkpoints, synthetic Spanish narration
text, and read-only local reference recordings. New caches and outputs were
kept in an ignored temporary workspace directory. No personal reference audio,
transcripts, cloned output, or voice identifiers are included in this change.

| Check | Observed result |
| --- | --- |
| Original 8-bit path, 18.1 s clone reference, first 37-word fragment | 102 available decode steps; exactly 102 emitted; 8.16 s output; `truncated: true` |
| Corrected 8-bit sidecar, same reference and full 50-word passage | Four fragments; 18.32 s total; natural stop on every fragment; final `done` |
| Corrected 4-bit adapter, same reference and passage | Four fragments; 17.28 s total; natural stop on every fragment |
| Corrected 8-bit adapter with a 27.1 s clone reference | 21 short fragments; 25.38 s total; no context truncation |
| Built-in `US_James`, same Spanish passage | Two fragments; 21.58 s (8-bit) and 21.52 s (4-bit); no context truncation |

These measurements establish context exhaustion and validate recovery from it.
They do not establish word accuracy: no ASR comparison or human listening score
was used. A natural stop can still omit words for model-related reasons.

## Correction

- Count the actual input positions through each adapter's own prompt builder.
- Subdivide fragments until a conservative speech-duration estimate fits the
  remaining output budget. Check cancellation during planning and inference.
- If a generated fragment is nevertheless truncated, discard that attempt and
  regenerate its entire input in smaller pieces. Join only completed children
  before publishing the original fragment index. Fail on an unsplittable input
  or after the bounded retry depth instead of accepting missing speech.
- Reject legacy truncated-fragment events in the Electron host before they
  reach playback or saved-clip concatenation.

The planner preserves the text supplied to synthesis; it does not shorten the
reference or guess a replacement transcript. Very long references can require
tiny fragments and affect fluency and latency. A shorter, clean reference with
an exact transcript leaves more room for continuous speech.

## Metallic / muffled timbre: not yet diagnosed

The report also affects built-in voices and both quantizations, so clone
context pressure alone does not explain it.

- The application writes uncompressed mono PCM16 at the model's native
  44.1 kHz and concatenates WAV payloads without recompressing them.
- The local playback-speed preference was 1.0. Both backend adapters decode
  each fragment with a fresh decoder state (`use_cache=False`); each sampler
  also creates a new LLM cache.
- An 8-bit built-in-voice probe generated the same short phrase with the same
  seed before and after an intervening longer generation and cache release.
  The two waveforms were sample-identical (136,710 samples, maximum absolute
  difference 0). This did not reproduce state accumulating across requests;
  it does not rule out quality drift within a long fragment, seed sensitivity,
  quantization effects, playback conditions, or model limitations.
- The vendored official Torch model matches upstream `main` as inspected on
  2026-10-22. The current MLX differences concern on-device interpolation and
  its public streaming wrapper; no demonstrated timbre fix was found that
  justifies changing the pinned inference code here.

Sampling remains at the reference settings: CFG 2.0, 10 flow steps, sigma 0.25,
temperature 0. No speculative EQ, denoising, reference alteration, or sampling
change is applied. Diagnosing the timbre still needs a failing output and a
matched listening comparison against the reference implementation.

## Validation

- Sidecar protocol and fragment-guard tests: 14 passed, including NumPy voice
  caching with the installed runtime interpreter.
- Host lifecycle tests, including refusal to publish a truncated event: passed.
- TTS engine unit tests, including WAV concatenation: passed.
- Electron TypeScript, host ESLint, Python syntax and diff whitespace checks:
  passed.
- Real MLX execution covered both installed 4-bit and 8-bit checkpoints. The
  Torch adapter's context calculation was reviewed but was not exercised with
  real Torch weights or CUDA hardware in this audit.

## References

- [Official Ming model and 512-position decode budget](https://github.com/inclusionAI/Ming-3.0-tts/blob/e999c39fa676722aaa9ea29b5aa19a90525b271f/modeling_bailingmm.py)
- [Pinned MLX sampler](https://github.com/Blaizzy/mlx-audio/blob/b8b59855eaca16a417f89bf9ab335fd0c0a06fad/mlx_audio/tts/models/bailingmm/bailingmm.py)
