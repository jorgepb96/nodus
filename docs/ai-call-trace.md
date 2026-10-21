# AI call tracing

Set `NODUS_AI_CALL_TRACE=1` when starting Nodus to attribute text/JSON model
requests to the application function that called the public completion API:

```sh
NODUS_AI_CALL_TRACE=1 NODUS_PERF_JSONL=/tmp/nodus-ai-perf.jsonl npm run dev
```

The main-process terminal output includes the same `callSite` on each request's
`AI queue wait` and `AI inference` lines, alongside its existing `requestHash`:

```text
[perf][deep] AI inference 420ms provider=codex model=example class=interactive requestHash=abc123 callSite=validateSources
```

`NODUS_PERF_JSONL` is optional. When set, its local JSONL file also carries the
label in `meta.callSite`. These events are not connected to the application's
processing-log panel or the renderer's browser console; this feature adds no UI
panel or settings switch. Restart Nodus with the environment variable set before
reproducing the operation to inspect.

The origin is captured once, at `completeJson`, `completeText`,
`completeTextNeutral`, `completeTextStream` or `completeTextStreamNeutral`, before
transport awaits. Queueing, provider retries and JSON resampling reuse that
origin. Separate operations using the same transport remain distinguishable.
Tracing is off by default: it captures no stack and adds no `callSite` key to
either console or JSONL output while disabled.

Stack-derived names are best effort. Anonymous callbacks and builds that rename
functions can use a stable, content-free label in `CallOpts` instead:

```ts
await completeText({
  system,
  user,
  callSite: 'research.verify-sources',
}, model);
```

Explicit labels take precedence and require no stack capture. They are local
diagnostic metadata, excluded from provider payloads and the request hash. Do not
put prompts, document titles, personal data or credentials in these labels.

The trace helps investigate repeated requests; it does not deduplicate calls or
change scheduling, retry policy or provider requests. Embedding requests use a
separate path and are outside this trace.
