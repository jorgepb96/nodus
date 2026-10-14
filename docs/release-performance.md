# Release execution and measurement

The shared Stable/Beta workflow validates the exact release tag, then overlaps
full CI with native packaging. The primary release is complete when macOS arm64,
Windows and Linux assets and update manifests are published. Stable also requires
the tested Zotero plugin. No failed, cancelled or missing required job can publish.

Linux compiles native modules, runs the normal packaging hooks and verifies the
glibc floor once on Ubuntu 22.04. It transfers that prepared app as a tar archive
to preserve executable permissions and relative symlinks. Three isolated runners
generate DEB, RPM and AppImage with electron-builder's `--prepackaged` option.
They use the producer's exact Node version and the same locked installer tooling.
Each verifies the archive and complete payload against its commit, lockfile,
version, repository, platform, architecture and release channel. The only permitted
payload additions are electron-builder's normal updater and native AppArmor
metadata. Final collection requires all three integrity reports and the exact
asset inventory. AppImage blockmap, SHA-512, zsync, updater metadata and the
byte-identical historical alias retain their existing checks.

The Zotero plugin runs alongside platform packaging. English release notes are
generated once at the tag, transferred by immutable artifact ID, and checked by
SHA-256 before publication. Downloaded Electron/packaging tools, pinned Zotero
runtime downloads and incremental TypeScript state can be cached; the application
is always compiled from current sources and checked. Cold caches run the full work.
Cache availability depends on GitHub's ref scoping; it is not assumed for estimates.

After publication a short dispatcher starts `release-macos-intel.yml` for the same
tag and channel. The primary workflow does not wait for Intel. That independent
run retains signing, notarization and native checks and appends its assets and
manifest entries without replacing arm64's update pointer. Retry an Intel failure
using its manual workflow with the original tag and channel.

## Recover the 5.10.0 Linux installers

The first 5.10.0 run built macOS, Windows and the Linux application and passed its
full CI, but all three Linux format jobs rejected the restored payload. The
producer recorded the browser connector ZIP with mode `0666`. Default tar
extraction applied the consumer's umask and changed it to `0644`.

Restore archives with `tar -p` so file and directory permissions match the
producer's manifest exactly. Archive hashes, complete payload hashes, executable
permissions, relative symlinks and release provenance still have to match.

To recover the existing tag, dispatch **Stable release** from the branch that
contains this workflow correction with `tag=v5.10.0`. Only the Linux installer
runners load `scripts/release-linux-artifact.mjs` from the exact workflow commit.
The application checkout, prepared payload, lockfile and version still come from
the immutable tag. The helper is not included in the prepackaged application.
The existing draft is reused, and all quality, packaging and publication gates
run again. The `v5.10.0` tag does not need to be moved or replaced.

## Validate without publishing

The full PR CI includes a small real Linux packaging fixture in the integration
group. It creates DEB, RPM and AppImage concurrently from separate copies of one
synthetic ASAR and native executable. Source packaging hooks deliberately throw
if unexpectedly invoked. It extracts all three installers and checks original
payload bytes, executable permissions, update channel and native package type,
then passes their assets through the production collection gate. Nothing is
uploaded to a release. On a Linux x64 host with dependencies installed:

```sh
sudo apt-get install --no-install-recommends -y zsync libfuse2 libarchive-tools
node --test scripts/test-release-linux-artifact.mjs scripts/test-release-performance-workflow.mjs
node scripts/verify-linux-release-formats.mjs
```

The unit tests reject corrupted archives/assets, wrong commits/channels, missing
or duplicate formats, changed payloads/permissions and escaping symlinks. Existing
native, signing, bootstrap, glibc, updater and Zotero contract suites still run.

## Measure the next release

Measure workflow creation to successful publication of the primary platforms,
including runner queues. Record Intel's separate start/completion independently.
Also record full CI, Linux preparation, each format, macOS signing/notarization,
uploads and publication durations. Sum all job runtimes separately to measure
runner consumption: parallel packaging trades more setup for shorter elapsed time.

The target is under 35 minutes; 20–25 minutes is an ambition, not a measured
result. Linux's previous sequential formats spent about 2 minutes on AppImage,
9 on DEB and 9 on RPM in v5.9.1. Parallel formats remove that sequential sum but
add archive transfer and runner setup. macOS signing/notarization and queue time
can become the longest path. Only the next signed release can establish the new
end-to-end time; do not create a public release solely to benchmark it.
