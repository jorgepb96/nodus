# CI execution and measurement

CI builds each commit once on `ubuntu-22.04`. Six independent Linux jobs run
every `scripts/test-*.mjs` file, with the same Node 22 runtime, Electron native
module checks, full Git history, and at most two-file process concurrency.
Files with a static Playwright import run in a first phase at concurrency one;
other files run afterward at concurrency two, retaining process isolation.
This reduces competing browser processes on each hosted runner. The
classification changes scheduling only: both phases together execute every
assigned file, and summaries add the real counts while retaining any failure,
cancellation or skip from either phase. Browser durations receive twice the
placement weight to account for their sequential execution. Three additional
isolated Linux jobs share the same verified build: smoke plus the three graph
E2Es, backups export/restore, and marketplace/native integration checks.
The build, lint/TypeScript checks and selected native hosts start together.
Tests wait for the build, but not for static analysis; the final gate requires
both. Cross-repository capability checks retain all three platforms.

Component browser fixtures own a Playwright browser server bound to loopback.
Cleanup allows ten seconds for Chrome to exit gracefully, then terminates only
that fixture's process tree and waits up to fifteen seconds for exit and Playwright's
temporary-profile cleanup. A failed kill
or a surviving process fails the test. This prevents successful assertions from
later timing out in an unbounded browser close; assertions, test deadlines and
the complete-inventory gate remain active. Shutdown fallbacks are logged with
the `[component-browser]` prefix. `test-component-browser-lifecycle.mjs` covers
stalled cleanup with a real disposable process as well as failure propagation.
When the owned Chrome process emits `exit`, its stdio streams are destroyed so
inherited pipe descriptors cannot hold Node's later `close` event open. This
allows Playwright to finish cleanup after a confirmed process exit. Regression
coverage includes a real helper process retaining stdout/stderr, both before
and after the parent's exit; live browser streams are never closed this way.

`scripts/ci-test-shards.mjs plan` discovers the complete test inventory. Historical
durations in `scripts/ci-test-durations.json` balance placement, never inclusion:
new files without hints also run. Each group runs longer files first and reports
the runner's actual file-process completions, durations, result counts and skips.
Every group is seeded with at least one file. Hints were refreshed from all 960
successfully executed files in
[run 38539770257](https://github.com/jorgepb96/nodus/actions/runs/38539770257).
E2E work has its own runners and is not reserved in unit-test placement.
All six unit groups and all three real-app groups run with `fail-fast: false`:
one failure cannot cancel another group's coverage. The aggregate matrix result
rejects failure/cancellation in any group. Existing assertions and individual
timeouts remain, and diagnostics use distinct artifact names for each E2E group.

The final `test` check requires successful lint/TypeScript, build, all groups, E2E and capability
jobs, and checks that every discovered file completed exactly once. Missing,
duplicate, cancelled, failed or stale reports fail the gate. New skipped tests
also fail; only the existing exact skip names/reasons and nine explicitly named
macOS cases on Linux are accepted. Those native cases must still pass without
skips on macOS. Existing assertions and E2E timeouts are unchanged.

Build outputs and the contract sources generated during preparation travel in a
tar archive to retain native helper permissions. Source-driven tests therefore
see the same generated files as the original single job. The
manifest verifies their SHA-256 hashes and the exact checked-out commit before
tests start. Artifacts are scoped to the current workflow run. A failed-job rerun
reuses the successful build's artifact ID and replaces only retried group reports;
successful groups remain valid for the same commit. Builds are not restored from
another commit. TypeScript incremental state and ESLint's
content cache accelerate the separate required quality job, but both tools still
run against current sources on every code change; cache misses perform full checks.
That job generates the current contract sources before checking types and installs
dependencies without native lifecycle scripts because static checks do not use
Electron. Native hosts retain `build:ci` with their own typecheck and incremental
caches. The Linux builder uses `build:ci:bundle`, preserving native prebuild hooks
and compiling the current sources while the required quality job runs separately.

The builder also shares its rebuilt native binaries and Electron rebuild metadata
in a small, separate archive. Consumers install the locked dependencies with
`npm ci`, verify the exact commit, lockfile hash, OS, architecture, Node version,
Electron version, ABI and every transferred file hash, and open a real in-memory
SQLite database under Electron. They still run `electron-builder install-app-deps`
to check all current native dependencies; valid rebuild metadata avoids repeating
the same compilation. Runtime mismatches or missing/corrupt binaries fail the job.
The native archive is never restored from a cross-run dependency cache.

The builder compiles the component fixtures' stylesheet with the same Tailwind
command, once from the current checkout. It includes the CSS in the commit-bound
build hash manifest. Consumers use that verified file and fail if it is missing
or empty, avoiding duplicate compilation at parallel test startup. All browser
assertions still inspect the real generated stylesheet. Local tests retain their
existing stylesheet preparation unless the CI artifact path is explicitly set.
Each Linux consumer installs and verifies working `ffmpeg` and `ffprobe` binaries.
This keeps the Drift audio
fixture's duration, channels, sample rate and loop-seam assertions active; a
missing tool is not accepted as an additional skip.

The attachment integration fixture intercepts structured planner inference as well
as text/stream inference. It retains the literal planning fallback and all format,
engine and provider assertions, while avoiding subscription CLI processes after
the checks finish. The planner and transports retain their dedicated test suites.

## Validate on a pull request

1. Compare with the current full Linux baseline
   [38539770257](https://github.com/jorgepb96/nodus/actions/runs/38539770257):
   total 20m19s, builder 8m07s, slowest unit job 11m20s and E2E job 9m06s.
   Its 960 test files all passed; the new orchestration still discovers every
   current file rather than freezing that baseline inventory.
2. Confirm all build, group, E2E and capability jobs pass. Read the final `test`
   job summary and download the `ci-tests-*` JSON reports. Their combined file
   inventory must match discovery; result counts alone are not sufficient.
3. Measure elapsed feedback from workflow creation to the final successful gate.
   For each job record creation/start/completion timestamps to separate queue
   time from execution. Sum execution durations across **all** jobs to measure
   total runner consumption; faster feedback does not imply fewer runner minutes.
4. A first execution measures a cold check cache. A later commit with small changes
   can measure restored incremental caches; do not combine the two benchmarks.
5. Aim for less than 15 minutes and compare measured results before claiming
   an improvement. Six Linux test runners plus three real-app runners trade
   additional dependency setup for shorter feedback. Native hosts can become
   the slowest path, and queue time or cold caches can still exceed the target.

Application code and the local `npm test`, `npm run test:ci`, `npm run build`,
`npm run lint` and `npm run typecheck` commands retain their original behavior.
For local orchestration verification use:

```sh
node --test scripts/test-ci-quality-gate.mjs
npx electron-builder install-app-deps
node scripts/ci-native-artifact.mjs pack
node scripts/ci-native-artifact.mjs verify
node scripts/lib/component-test-styles.mjs prepare-ci
npm run build:ci
npm run build:server-web
node scripts/ci-test-shards.mjs plan
node scripts/ci-build-artifact.mjs pack
node scripts/ci-build-artifact.mjs verify
for shard in 1 2 3 4 5 6; do
  npm run test:ci:shard -- "$shard"
done
node scripts/ci-test-shards.mjs verify
```
