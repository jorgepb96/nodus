# Harrier Q8 WASM compatibility graph

Derived from `onnx-community/harrier-oss-v1-270m-ONNX`, revision
`d59c919d0159aea2c19ed7d04288fcdd048d0f9c`, based on Microsoft's
`microsoft/harrier-oss-v1-270m`. Upstream declares MIT licensing:
https://huggingface.co/microsoft/harrier-oss-v1-270m
https://huggingface.co/onnx-community/harrier-oss-v1-270m-ONNX

Copyright (c) Microsoft Corporation. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The compatibility graph replaces one GatherBlockQuantized operator with
standard Gather/Cast/Reshape/Sub/Mul operators. Only selected token rows are
dequantized. External weights and quantization stay unchanged. Reproduce with
`python scripts/prepare-zotero-harrier-onnx.py` (requires `onnx`). SHA-256:
`bfb6e7bbefc48cee9ba73f3b2eb092f7c4aa632d5a4ec092068b07e9a09f57f3`.
