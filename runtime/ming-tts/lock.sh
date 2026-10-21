#!/bin/sh
# Regenerate the three hash-pinned locks, then check each one against every platform it
# serves. uv resolves; pip installs (--require-hashes --no-deps --only-binary=:all:).
set -eu
cd "$(dirname "$0")"
UV_FLAGS="--python-version 3.12 --generate-hashes --only-binary :all: --emit-index-url"
# MLX wheels need macOS 14; onnxruntime needs 13.
MACOSX_DEPLOYMENT_TARGET=14.0 uv pip compile requirements-mlx.in $UV_FLAGS \
  --python-platform aarch64-apple-darwin -o requirements-mlx.lock
uv pip compile requirements-torch-cpu.in $UV_FLAGS --universal \
  --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match \
  -o requirements-torch-cpu.lock
uv pip compile requirements-torch-cuda.in $UV_FLAGS --universal \
  --extra-index-url https://download.pytorch.org/whl/cu124 --index-strategy unsafe-best-match \
  -o requirements-torch-cuda.lock
# Needs `packaging` in the interpreter that runs it.
python3 verify_locks.py
