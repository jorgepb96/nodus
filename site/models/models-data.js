/*
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

The Nodus model guide. Every tab, filter and table on /models/ is drawn from
this one file, so keeping the page current means editing only what is here.

HOW TO UPDATE
  1. Change prices, scores or rows below. An API model's numbers live once, in
     `apiModels`; every table that lists it reads them from there.
  2. Set `updated` (YYYY-MM-DD) on each tab you reviewed. The hero shows the
     most recent date of any tab, so nothing else needs touching.
  3. Add a line at the top of `changelog` saying what changed.
  4. Run `node --test scripts/test-site-models.mjs`: it checks every id,
     reference and date in this file.

SHAPES
  apiModels  { id: { name, reasoning?, provider, input, output, intelligence,
             speed, speedApprox?, taskCost, source } }. Prices are USD per
             million tokens. A table row points at one with `ref: 'id'`.
  tabs       In display order: { id, label, icon, accent, updated, title,
             intro, notes?, filters, tables }.
  filters    The bubble rows of a tab: { id, label, field, options }.
             A row passes a filter when it matches ANY selected bubble, and it
             has to pass every filter that has a selection. A row with no value
             in `field` is left alone by that filter.
             An option matches when its `id` equals the row's `field` (or sits
             in it, when that is a list), or, for numbers, through `atLeast`,
             `over`, `upTo` and `below`.
             `type: 'machine'` is the hardware filter: rows match through `fit`
             (the minimum Mac/GPU memory in GB, or `cpu`) or through an
             explicit `machines` list of option ids.
             The same filter id on two tabs shares one selection, so a reader
             picks their machine once.
  tables     { id, title, intro?, columns, rows, footnote?, callout?, flow?,
             estimator?, collapsed?, row? }. `row` holds fields every row of
             the table inherits, such as `runs: 'api'`.
  columns    { key, label, type }. Types: name, text, price, score, speed,
             fit, licence, link, verdict, cost. `name` shows `name`, `tag`,
             `reasoning`, `pick` and `sub`, and links to `source` or `href`.
             `verdict` cells hold yes | aux | no; `tones` can mute one.
  text       Intros, notes and text cells accept **bold**, `code` and
             [links](https://…). Nothing else is interpreted.
*/
(function () {
  'use strict';

  /* ---------------------------------------------------------------- API models
     One entry per model and reasoning setting. */
  const apiModels = {
    'deepseek-flash-max': {
      name: 'DeepSeek V4.1 Flash-1017', reasoning: 'Max', provider: 'deepseek',
      input: 0.30, output: 1.20, intelligence: 45, speed: 230, taskCost: 0.26,
      source: 'https://artificialanalysis.ai/models/deepseek-v4-1-flash-1017',
    },
    'mimo-pro': {
      name: 'MiMo V2.6 Pro', provider: 'xiaomi',
      input: 0.435, output: 0.87, intelligence: 46, speed: 48, taskCost: 0.13,
      source: 'https://artificialanalysis.ai/models/mimo-v2-6-pro',
    },
    'haiku-high': {
      name: 'Claude Haiku 5.5', reasoning: 'High', provider: 'anthropic',
      input: 0.10, output: 0.50, intelligence: 38, speed: 189, taskCost: 0.08,
      source: 'https://artificialanalysis.ai/models/claude-haiku-5-5-high',
    },
    'haiku-max': {
      name: 'Claude Haiku 5.5', reasoning: 'Max', provider: 'anthropic',
      input: 0.10, output: 0.50, intelligence: 43, speed: 235, taskCost: 0.21,
      source: 'https://artificialanalysis.ai/models/claude-haiku-5-5',
    },
    'glm-flash': {
      name: 'GLM-5.3 Flash', provider: 'zhipu',
      input: 0.15, output: 0.50, intelligence: 42, speed: 78, taskCost: 0.28,
      source: 'https://artificialanalysis.ai/models/glm-5-3-flash',
    },
    'luna-max': {
      name: 'GPT-6 Luna', reasoning: 'Max', provider: 'openai',
      input: 0.10, output: 0.50, intelligence: 38, speed: 129, taskCost: 0.07,
      source: 'https://artificialanalysis.ai/models/gpt-6-luna',
    },
    'luna-high': {
      name: 'GPT-6 Luna', reasoning: 'High', provider: 'openai',
      input: 0.10, output: 0.50, intelligence: 33, speed: 117, taskCost: 0.03,
      source: 'https://artificialanalysis.ai/models/gpt-6-luna-high',
    },
    'mimo-flash': {
      name: 'MiMo V2.6 Flash', provider: 'xiaomi',
      input: 0.14, output: 0.28, intelligence: 38, speed: 50, taskCost: 0.06,
      source: 'https://artificialanalysis.ai/models/mimo-v2-6-flash',
    },
    'gemini-flash-high': {
      name: 'Gemini 3.8 Flash', reasoning: 'High', provider: 'google',
      input: 0.75, output: 3.75, intelligence: 41, speed: 150, speedApprox: true, taskCost: 1.24,
      source: 'https://artificialanalysis.ai/models/releases/gemini-3-8-flash',
    },
    'gemini-flash-lite': {
      name: 'Gemini 3.5 Flash-Lite', provider: 'google',
      input: 0.30, output: 2.50, intelligence: 22, speed: 410, taskCost: 0.19,
      source: 'https://artificialanalysis.ai/models/gemini-3-5-flash-lite',
    },
    'sonnet-max': {
      name: 'Claude Sonnet 5.5', reasoning: 'Max', provider: 'anthropic',
      input: 2.00, output: 10.00, intelligence: 56, speed: 140, speedApprox: true, taskCost: 5.46,
      source: 'https://artificialanalysis.ai/models/claude-sonnet-5-5',
    },
    'sol-max': {
      name: 'GPT-6.1 Sol', reasoning: 'Max', provider: 'openai',
      input: 2.00, output: 10.00, intelligence: 52, speed: 55, speedApprox: true, taskCost: 0.72,
      source: 'https://artificialanalysis.ai/models/gpt-6-1-sol',
    },
    'opus-max': {
      name: 'Claude Opus 5.5', reasoning: 'Max', provider: 'anthropic',
      input: 4.00, output: 20.00, intelligence: 58, speed: 94, speedApprox: true, taskCost: 5.98,
      source: 'https://artificialanalysis.ai/models/claude-opus-5-5',
    },
  };

  /* ---------------------------------------------------------------- filters
     Shared between tabs: the same id keeps the same selection everywhere. */
  const MACHINE = {
    id: 'machine', label: 'Hardware', type: 'machine',
    groups: [
      { label: 'Mac', hint: 'unified memory', options: [
        { id: 'mac8', label: '8 GB', kind: 'mac', gb: 8 },
        { id: 'mac16', label: '16 GB', kind: 'mac', gb: 16 },
        { id: 'mac24', label: '24 GB', kind: 'mac', gb: 24 },
        { id: 'mac32', label: '32 GB', kind: 'mac', gb: 32 },
        { id: 'mac48', label: '48 GB', kind: 'mac', gb: 48 },
        { id: 'mac64', label: '64 GB+', kind: 'mac', gb: 64 },
      ] },
      { label: 'PC graphics card', hint: 'free VRAM', options: [
        { id: 'gpu6', label: '6 GB', kind: 'gpu', gb: 6 },
        { id: 'gpu8', label: '8 GB', kind: 'gpu', gb: 8 },
        { id: 'gpu12', label: '12 GB', kind: 'gpu', gb: 12 },
        { id: 'gpu16', label: '16 GB', kind: 'gpu', gb: 16 },
        { id: 'gpu24', label: '24 GB', kind: 'gpu', gb: 24 },
        { id: 'gpu32', label: '32 GB', kind: 'gpu', gb: 32 },
        { id: 'gpu48', label: '48 GB+', kind: 'gpu', gb: 48 },
      ] },
      { label: 'No graphics card', options: [
        { id: 'cpu', label: 'CPU only', kind: 'cpu' },
      ] },
    ],
  };

  const RUNS = {
    id: 'runs', label: 'Runs', field: 'runs',
    options: [
      { id: 'local', label: 'Local' },
      { id: 'api', label: 'API' },
    ],
  };

  const PRICE = {
    id: 'price', label: 'Output price', field: 'output',
    options: [
      { id: 'budget', label: 'Budget', hint: 'up to $0.50', upTo: 0.5 },
      { id: 'mid', label: 'Mid-range', hint: '$0.51 to $2', over: 0.5, upTo: 2 },
      { id: 'premium', label: 'Premium', hint: 'over $2', over: 2 },
    ],
  };

  const SPEED = {
    id: 'speed', label: 'API speed', field: 'speed',
    options: [
      { id: 'fast', label: 'Fast', hint: '150+ t/s', atLeast: 150 },
      { id: 'steady', label: 'Medium', hint: '80 to 149 t/s', atLeast: 80, below: 150 },
      { id: 'slow', label: 'Slow', hint: 'under 80 t/s', below: 80 },
    ],
  };

  const PROVIDER = {
    id: 'provider', label: 'Provider', field: 'provider',
    options: [
      { id: 'anthropic', label: 'Anthropic' },
      { id: 'deepseek', label: 'DeepSeek' },
      { id: 'google', label: 'Google' },
      { id: 'openai', label: 'OpenAI' },
      { id: 'xiaomi', label: 'Xiaomi MiMo' },
      { id: 'zhipu', label: 'Z.ai GLM' },
    ],
  };

  /* ---------------------------------------------------------------- columns
     The API columns repeat across three tabs, so they are written once. */
  const API_HEAD = [
    { key: 'name', label: 'Model', type: 'name' },
    { key: 'input', label: 'Input / 1M', type: 'price' },
    { key: 'output', label: 'Output / 1M', type: 'price' },
    { key: 'intelligence', label: 'AA intelligence', type: 'score' },
    { key: 'speed', label: 'API speed', type: 'speed' },
    { key: 'taskCost', label: 'AA cost / task', type: 'price' },
  ];

  const LICENCE = {
    apache: (by, url) => ({ name: 'Apache 2.0', by, url }),
    mit: (by, url) => ({ name: 'MIT', by, url }),
  };

  /* ---------------------------------------------------------------- tabs */
  const tabs = [
    /* ============================================================ local */
    {
      id: 'local',
      label: 'Local models',
      icon: 'chip',
      accent: '#2dd4bf',
      updated: '2026-10-20',
      title: 'Local models',
      intro: 'Models with downloadable weights that run on your own computer. Use them for Research Chat, the Dictionary, drafting, summaries of **already retrieved ideas** and semantic search. They are not recommended for bulk extraction of new ideas. The minimums below assume a grounded research answer, not just loading a model. API speed figures do not apply to local inference.',
      notes: [{
        tone: 'warn',
        title: 'Why the minimums are higher than the weights suggest',
        text: 'A precise answer is not one prompt. To ground it, Nodus iterates between embeddings, the ideas and works retrieved from your library, and the sources it must cite, and the model has to hold that material in context while it reasons and writes. On less capable machines the context window fills after a few retrieval steps, memory spills into swap, and replies become very slow even when the model itself loads. The minimums below cover the **whole local stack** — the generative model, the embedding and reranking models, a long context, the operating system and the application — not just the Q4 weights. In testing, Gemma 4 E2B Q4 answered on a 16 GB M2 MacBook Air, but its context filled almost immediately and it was too slow to be usable. **Local chat now starts at 24 GB of unified memory or 12 GB of VRAM**; below that, keep embeddings and retrieval local and use an API for the answer. Embedding and reranking minima stay separate because those models are small enough to run on their own.',
      }],
      filters: [MACHINE, {
        id: 'family', label: 'Family', field: 'family',
        options: [
          { id: 'gemma', label: 'Gemma' },
          { id: 'qwen', label: 'Qwen' },
          { id: 'phi', label: 'Phi' },
        ],
      }],
      tables: [
        {
          id: 'local-llm',
          title: 'Generative models',
          intro: 'Sorted by size. The hardware filter shows only the models that fit the selected machine.',
          columns: [
            { key: 'name', label: 'Model', type: 'name' },
            { key: 'q4', label: 'Q4 size*', type: 'text' },
            { key: 'fit', label: 'Runs on (minimum)', type: 'fit' },
            { key: 'chat', label: 'Research Chat', type: 'text' },
            { key: 'dictionary', label: 'Dictionary / retrieved ideas', type: 'text' },
            { key: 'licence', label: 'Licence · weights', type: 'licence' },
          ],
          rows: [
            { name: 'Gemma 4 E2B IT', family: 'gemma', sub: '5.1B total · 2.3B effective', q4: '~3–5 GB', fit: { mac: 24, gpu: 12, cpu: 'slow' }, chat: 'Basic, short context', dictionary: 'Quick definitions', licence: LICENCE.apache('Google', 'https://huggingface.co/google/gemma-4-E2B-it') },
            { name: 'Qwen3.5 4B', family: 'qwen', sub: '4B', q4: '~3–5 GB', fit: { mac: 24, gpu: 12, cpu: 'slow' }, chat: 'Light, short context', dictionary: '**Well suited**', licence: LICENCE.apache('Qwen', 'https://huggingface.co/Qwen/Qwen3.5-4B') },
            { name: 'Phi-4 Mini Instruct', family: 'phi', sub: '3.8B', q4: '~3–5 GB', fit: { mac: 24, gpu: 12, cpu: 'slow' }, chat: 'Light, short context', dictionary: 'Definitions, structured output', licence: LICENCE.mit('Microsoft', 'https://huggingface.co/microsoft/Phi-4-mini-instruct') },
            { name: 'Gemma 4 E4B IT', family: 'gemma', sub: '8B total · 4.5B effective', q4: '~5–8 GB', fit: { mac: 32, gpu: 16 }, chat: 'Good, short context', dictionary: '**Well suited**, multimodal', licence: LICENCE.apache('Google', 'https://huggingface.co/google/gemma-4-E4B-it') },
            { name: 'Qwen3.5 9B', family: 'qwen', pick: 'Balanced pick', sub: '~9B', q4: '~6–9 GB', fit: { mac: 32, gpu: 16 }, chat: '**Balanced**', dictionary: '**Balanced**, multilingual', licence: LICENCE.apache('Qwen', 'https://huggingface.co/Qwen/Qwen3.5-9B') },
            { name: 'Gemma 4 12B Unified', family: 'gemma', sub: '~12B', q4: '~8–12 GB', fit: { mac: 48, gpu: 24 }, chat: 'High', dictionary: 'High', licence: LICENCE.apache('Google', 'https://huggingface.co/google/gemma-4-12B-it') },
            { name: 'Gemma 4 26B-A4B', family: 'gemma', sub: '25.2B total · 3.8B active', q4: '~15–20 GB', fit: { mac: 48, gpu: 32 }, chat: '**High, efficient MoE**', dictionary: 'High', licence: LICENCE.apache('Google', 'https://huggingface.co/google/gemma-4-26B-A4B-it') },
            { name: 'Qwen3.8 27B', family: 'qwen', sub: '27B', q4: '~17–22 GB', fit: { mac: 64, gpu: 32 }, fitNote: '48 GB only with a short context; 64 GB recommended', chat: '**Very high**', dictionary: 'High', licence: LICENCE.apache('Qwen', 'https://huggingface.co/Qwen/Qwen3.8-27B') },
            { name: 'Qwen3.5 35B-A3B', family: 'qwen', sub: '~35B total · ~3B active', q4: '~22–28 GB', fit: { mac: 64, gpu: 48 }, chat: 'High, MoE', dictionary: 'High', licence: LICENCE.apache('Qwen', 'https://huggingface.co/Qwen/Qwen3.5-35B-A3B') },
            { name: 'Gemma 4 31B', family: 'gemma', sub: '~31B', q4: '~20–26 GB', fit: { mac: 64, gpu: 48 }, chat: '**Very high**', dictionary: 'High', licence: LICENCE.apache('Google', 'https://huggingface.co/google/gemma-4-31B-it') },
          ],
          footnote: '* **Q4 size is an estimate** of 4-bit weights plus metadata, varying between GGUF and MLX builds. It is **not** the hardware minimum: the *Runs on* column adds headroom for the operating system, the application, the embedding and reranking models, a long context, the KV cache and a shared GPU. The *active* parameters of a MoE model are not the parameters that must be stored in memory, and the “effective” sizes of Gemma E2B/E4B are not the total sizes. More memory does not guarantee good throughput.',
        },
        {
          id: 'local-profiles',
          title: 'Hardware profiles',
          intro: 'Reference machines with the models suited to each one for chat and for retrieval.',
          columns: [
            { key: 'name', label: 'Profile', type: 'name' },
            { key: 'memory', label: 'Memory', type: 'text' },
            { key: 'graphics', label: 'Graphics', type: 'text' },
            { key: 'chat', label: 'Research Chat + Dictionary', type: 'text' },
            { key: 'retrieval', label: 'Embeddings + retrieval', type: 'text' },
            { key: 'verdict', label: 'Verdict', type: 'text' },
          ],
          rows: [
            { tag: 'D0', name: 'Budget CPU, N100 mini-PC', machines: ['cpu'], memory: '8–16 GB RAM', graphics: 'Intel UHD, no dedicated VRAM', chat: '**No local chat recommended**; use an API', retrieval: 'EmbeddingGemma 2 (text), Harrier 270M, GTE reranker 306M', verdict: '**Retrieval only; API for conversation**' },
            { tag: 'D1', name: 'Entry Mac or laptop', machines: ['mac8'], memory: '**8 GB unified**', graphics: 'Apple Silicon integrated GPU', chat: '**None**; use an API for chat', retrieval: 'Harrier 270M, Voyage 4 Nano, EmbeddingGemma 2 (text)', verdict: '**Retrieval only; local chat starts at 24 GB**' },
            { tag: 'D2', name: 'MacBook Air M2, 16 GB', machines: ['mac16'], memory: '**16 GB unified**', graphics: 'Apple M2 GPU', chat: '**None**; the tested Gemma E2B Q4 was too slow and ran out of context', retrieval: '**Harrier 0.6B / BGE-M3** + Qwen3 Reranker 0.6B, run sequentially', verdict: '**Retrieval only; local chat starts at 24 GB**' },
            { tag: 'D3', name: 'Mac mini or MacBook Pro', pick: 'Balanced', machines: ['mac24', 'mac32'], memory: '24–32 GB unified', graphics: 'Apple Silicon GPU', chat: 'Gemma E2B / Qwen 4B Q4 on 24 GB; Qwen 9B / Gemma E4B on 32 GB', retrieval: 'Harrier 0.6B / BGE-M3 / EmbeddingGemma 2', verdict: '**Entry local chat at 24 GB; balanced at 32 GB**' },
            { tag: 'D4', name: 'Mac Studio or MacBook Pro', machines: ['mac48', 'mac64'], memory: '**48–64 GB unified**', graphics: 'Apple Silicon with more memory bandwidth', chat: 'Gemma 12B / 26B-A4B on 48 GB; Qwen 27B, Gemma 31B and Qwen 35B-A3B on 64 GB', retrieval: 'Qwen3 Embedding 4B–8B; a 4B reranker if needed', verdict: 'Best local profile for quality' },
            { tag: 'D5', name: 'PC with an entry graphics card', machines: ['gpu6', 'gpu8'], memory: '16–32 GB RAM + **6–8 GB VRAM**', graphics: 'NVIDIA or AMD, discrete', chat: '**None**; use an API for chat', retrieval: 'Harrier 270M / 0.6B, EmbeddingGemma 2', verdict: '**Retrieval only; local chat starts at 12 GB VRAM**' },
            { tag: 'D6', name: 'PC with a mid-range graphics card', machines: ['gpu12', 'gpu16'], memory: '32 GB RAM + **12–16 GB VRAM**', graphics: 'NVIDIA or AMD, discrete', chat: '**Qwen 4B / E2B Q4 (12 GB)**; Qwen 9B / Gemma E4B (16 GB)', retrieval: 'BGE-M3, Harrier 0.6B, Qwen3 Reranker 0.6B', verdict: 'Light local chat with short contexts' },
            { tag: 'D7', name: 'PC with a high-end graphics card', machines: ['gpu24'], memory: '32–64 GB RAM + **24 GB VRAM**', graphics: 'RTX 3090 / 4090 or another 24 GB card', chat: 'Gemma 12B Q4; Gemma 26B-A4B with care', retrieval: 'Qwen3 Embedding 4B–8B and rerankers', verdict: 'Mid-size models; check KV cache size' },
            { tag: 'D8', name: 'Workstation', machines: ['gpu32', 'gpu48'], memory: '64–128+ GB RAM + **32–48+ GB VRAM**', graphics: 'Professional GPU or multiple GPUs', chat: 'Qwen 27B / Gemma 31B / Qwen 35B-A3B', retrieval: '8B embeddings and top-tier reranking', verdict: 'Best local quality that fits in VRAM' },
          ],
        },
        {
          id: 'local-mac',
          title: 'Apple Silicon, by memory',
          collapsed: true,
          intro: 'Unified memory is not dedicated VRAM: macOS and open applications use the same memory.',
          columns: [
            { key: 'name', label: 'Memory', type: 'name' },
            { key: 'chat', label: 'Preferred chat models', type: 'text' },
            { key: 'embeddings', label: 'Preferred embedding models', type: 'text' },
            { key: 'avoid', label: 'Avoid as default', type: 'text' },
          ],
          rows: [
            { name: '8 GB', machines: ['mac8'], chat: '**None recommended**; use an API', embeddings: 'Harrier 270M · Voyage Nano', avoid: 'All local generative models' },
            { name: '16 GB', machines: ['mac16'], chat: '**None recommended**; the tested Gemma E2B Q4 was too slow and ran out of context', embeddings: '**Harrier 0.6B · BGE-M3**', avoid: 'Local generative models for research chat' },
            { name: '24 GB', machines: ['mac24'], chat: 'Gemma E2B · Qwen 4B Q4, short context', embeddings: 'Harrier 0.6B · EmbeddingGemma 2', avoid: '9B and up with long context' },
            { name: '32 GB', machines: ['mac32'], chat: '**Qwen 9B Q4 · Gemma E4B**', embeddings: 'Qwen3 Embedding 4B', avoid: '27B / 35B' },
            { name: '48 GB', machines: ['mac48'], chat: 'Gemma 12B · Gemma 26B-A4B · Qwen 27B with care', embeddings: 'Qwen3 Embedding 4B–8B', avoid: '31B / 35B with long context' },
            { name: '64 GB', machines: ['mac64'], chat: 'Qwen 27B · Gemma 31B · Qwen 35B-A3B', embeddings: 'Qwen3 Embedding 8B', avoid: 'Untested speed assumptions' },
          ],
        },
        {
          id: 'local-pc',
          title: 'PC graphics card, by free VRAM',
          collapsed: true,
          intro: 'Values refer to **free VRAM**, not RAM plus VRAM. A model that exceeds VRAM can be partly offloaded to RAM; speed then depends on the bus, the inference engine and the CPU.',
          columns: [
            { key: 'name', label: 'Free VRAM', type: 'name' },
            { key: 'chat', label: 'Chat (Q4, approximate)', type: 'text' },
            { key: 'embeddings', label: 'Embeddings and reranking', type: 'text' },
          ],
          rows: [
            { name: '4–6 GB', machines: ['gpu6'], chat: '**None recommended**; use an API', embeddings: 'Harrier 270M / Voyage Nano' },
            { name: '8 GB', machines: ['gpu8'], chat: '**None recommended**; 12 GB is the entry point', embeddings: 'Harrier 0.6B / BGE-M3' },
            { name: '12 GB', machines: ['gpu12'], chat: 'Phi-4 Mini / Qwen 4B Q4', embeddings: 'Harrier 0.6B + a 0.6B reranker' },
            { name: '16 GB', machines: ['gpu16'], chat: 'Qwen 9B / Gemma E4B', embeddings: 'BGE-M3 / Qwen3 Embedding 4B' },
            { name: '24 GB', machines: ['gpu24'], chat: 'Gemma 12B / Gemma 26B-A4B', embeddings: 'Qwen3 Embedding 4B–8B' },
            { name: '32–48 GB', machines: ['gpu32', 'gpu48'], chat: 'Qwen 27B / Gemma 31B / Qwen 35B-A3B', embeddings: 'Large embeddings + large rerankers' },
          ],
        },
        {
          id: 'local-cpu',
          title: 'No suitable graphics card, or a home server',
          collapsed: true,
          columns: [
            { key: 'name', label: 'RAM', type: 'name' },
            { key: 'advice', label: 'What to run', type: 'text' },
          ],
          rows: [
            { name: '8–16 GB', machines: ['cpu'], advice: 'Retrieval only: **EmbeddingGemma 2 (text only)**, Voyage 4 Nano, Harrier 270M or a 306M reranker. Local chat on a CPU is too slow for research; use an API.' },
            { name: '32 GB, e.g. Intel N100', machines: ['cpu'], advice: 'A 9–27B model that fits in RAM **does not** respond quickly, and the context grows with every retrieval step. Prioritise embeddings, search, a vector server and reranking; use an API for conversation.' },
            { name: '64 GB and up', machines: ['cpu'], advice: 'Can hold larger models, but RAM and parameter count do not replace memory bandwidth and hardware acceleration. Still not recommended for interactive research chat.' },
          ],
        },
        {
          id: 'local-retrieval',
          title: 'Local retrieval and API extraction',
          intro: 'Retrieving existing ideas is **not** the same as extracting new ones. Retrieval runs locally; bulk extraction uses an API.',
          flow: {
            lanes: [
              { label: 'Local', tone: 'good', steps: ['Ideas already indexed', 'Local embeddings', 'Semantic + hybrid search', 'Local reranker', 'Research Chat or Dictionary'] },
              { label: 'API', tone: 'warn', steps: ['Unprocessed documents', 'Idea Extraction', 'Ideas already indexed'] },
            ],
          },
          columns: [
            { key: 'name', label: 'Local task', type: 'name' },
            { key: 'verdict', label: 'Recommended?', type: 'verdict' },
            { key: 'components', label: 'Models and components', type: 'text' },
            { key: 'condition', label: 'Condition', type: 'text' },
          ],
          rows: [
            { name: 'Find existing ideas and similarities', verdict: 'yes', components: 'Harrier 0.6B, BGE-M3, Voyage 4 Nano, EmbeddingGemma 2', condition: 'A compatible vector index' },
            { name: 'Sort the results by relevance', verdict: 'yes', components: 'Qwen3 Reranker 0.6B, GTE Multilingual Reranker 306M', condition: 'Run it on the top 20–50 passages' },
            { name: 'Explain and connect retrieved ideas', verdict: 'yes', components: 'Qwen3.5 4B on 24 GB, Qwen3.5 9B on 32 GB, Gemma 26B-A4B on 48 GB', condition: 'Answer citing IDs, passages and sources; memory must cover the answer, not only the weights' },
            { name: 'Extract new ideas in bulk', verdict: 'no', components: '**Local models not recommended**', condition: 'Use an API provider: see [Idea Extraction](#extraction)' },
          ],
        },
      ],
    },

    /* ============================================================ embeddings */
    {
      id: 'embeddings',
      label: 'Embeddings',
      icon: 'vectors',
      accent: '#818cf8',
      updated: '2026-10-19',
      title: 'Embeddings',
      intro: 'Embeddings convert passages into vectors used to find related texts, ideas and documents. They are used for retrieval and **do not generate ideas**. They can run locally or through a paid API. For historical sources in three languages, test cross-language search, proper names and literal quotations before choosing one.',
      filters: [RUNS, MACHINE, {
        id: 'modality', label: 'Content', field: 'modality',
        options: [
          { id: 'text', label: 'Text' },
          { id: 'multimodal', label: 'Multimodal' },
        ],
      }],
      tables: [
        {
          id: 'embeddings-local',
          title: 'Local embedding models: multilingual quality',
          row: { runs: 'local' },
          columns: [
            { key: 'name', label: 'Model', type: 'name' },
            { key: 'mteb', label: 'MTEB multilingual†', type: 'score', decimals: 1 },
            { key: 'context', label: 'Context', type: 'text' },
            { key: 'dimensions', label: 'Dimensions', type: 'text' },
            { key: 'fit', label: 'Runs on (minimum)', type: 'fit' },
            { key: 'notes', label: 'What sets it apart', type: 'text' },
            { key: 'licence', label: 'Licence · weights', type: 'licence' },
          ],
          rows: [
            { name: 'Harrier-OSS 0.6B', pick: 'Main text candidate', sub: '~600M parameters', modality: 'text', mteb: 69.0, context: '32K', dimensions: '1,024', fit: { mac: 16, gpu: 8 }, notes: '**The main candidate for text**', licence: LICENCE.mit('Microsoft', 'https://huggingface.co/microsoft/harrier-oss-v1-0.6b') },
            { name: 'Harrier-OSS 270M', sub: '270M parameters', modality: 'text', mteb: 66.5, context: '32K', dimensions: '640', fit: { mac: 8, gpu: 6, cpu: true }, notes: 'Light, text', licence: LICENCE.mit('Microsoft', 'https://huggingface.co/microsoft/harrier-oss-v1-270m') },
            { name: 'Voyage 4 Nano', sub: '~340M parameters', modality: 'text', mteb: null, context: '32K', dimensions: '256–2,048', fit: { mac: 8, gpu: 6, cpu: true }, notes: '**Shares the Voyage 4 vector space**', licence: LICENCE.apache('Voyage', 'https://huggingface.co/voyageai/voyage-4-nano') },
            { name: 'EmbeddingGemma 2 (text)', sub: '**270M text** · 740M multimodal', modality: ['text', 'multimodal'], mteb: '61.36 (text)', context: '8K', dimensions: '128–768', fit: { mac: 8, gpu: 6, cpu: true }, fitNote: 'Other modalities are optional', notes: 'Text, code, images, audio and video', licence: LICENCE.apache('Google', 'https://huggingface.co/google/embeddinggemma-2') },
            { name: 'BGE-M3', sub: '~568M parameters', modality: 'text', mteb: '~59.6 ‡', context: '8K', dimensions: '1,024', fit: { mac: 16, gpu: 8 }, notes: '**Dense + sparse + ColBERT**', licence: LICENCE.mit('BAAI', 'https://huggingface.co/BAAI/bge-m3') },
            { name: 'Qwen3 Embedding 0.6B', sub: '~600M parameters', modality: 'text', mteb: 64.3, context: '32K', dimensions: '1,024', fit: { mac: 16, gpu: 8 }, notes: '100+ languages, takes instructions', licence: LICENCE.apache('Qwen', 'https://huggingface.co/Qwen/Qwen3-Embedding-0.6B') },
            { name: 'Qwen3 Embedding 4B', sub: '4B parameters', modality: 'text', mteb: 69.5, context: '32K', dimensions: '2,560', fit: { mac: 32, gpu: 12 }, notes: 'Higher quality, more compute', licence: LICENCE.apache('Qwen', 'https://huggingface.co/Qwen/Qwen3-Embedding-4B') },
            { name: 'Qwen3 Embedding 8B', sub: '8B parameters', modality: 'text', mteb: 70.6, context: '32K', dimensions: '4,096', fit: { mac: 48, gpu: 16 }, notes: 'High quality, lower throughput', licence: LICENCE.apache('Qwen', 'https://huggingface.co/Qwen/Qwen3-Embedding-8B') },
            { name: 'Harrier-OSS 27B', sub: '27B parameters', modality: 'text', mteb: 74.3, context: '32K', dimensions: '5,376', fit: { mac: 64, gpu: 48 }, fitNote: 'Workstation class', notes: 'Benchmark quality, impractical on a desktop', licence: LICENCE.mit('Microsoft', 'https://huggingface.co/microsoft/harrier-oss-v1-27b') },
          ],
          footnote: '† Published MTEB Multilingual v2 scores, **not** the AA Intelligence Index; compare values from different model cards and dates with caution. ‡ The BGE-M3 score does not reflect its sparse and multi-vector retrieval. EmbeddingGemma 2 has **740M parameters in total** and a **270M text encoder**. Sources: [Microsoft](https://huggingface.co/microsoft/harrier-oss-v1-0.6b) · [Google](https://developers.googleblog.com/embeddinggemma-2-the-developer-guide/) · [BAAI](https://huggingface.co/BAAI/bge-m3).',
        },
        {
          id: 'embeddings-api',
          title: 'API embeddings: indexing cost',
          intro: 'Billed per **input token**. Prices per million text tokens, excluding tax, caching and volume discounts.',
          row: { runs: 'api' },
          columns: [
            { key: 'name', label: 'Model', type: 'name' },
            { key: 'price', label: 'USD / 1M tokens', type: 'price' },
            { key: 'price', id: 'price100', label: '100M tokens', type: 'price', scale: 100 },
            { key: 'multimodal', label: 'Multimodal', type: 'verdict', tones: { no: 'muted' } },
            { key: 'use', label: 'Use it for', type: 'text' },
            { key: 'pricing', label: 'Rates', type: 'link' },
          ],
          rows: [
            { name: 'BGE-M3 via OpenRouter', pick: 'Recommended API', sub: '`baai/bge-m3` · 8K context', modality: 'text', price: 0.01, multimodal: 'no', use: '**Recommended API option**: lowest price; same model as local BGE-M3', pricing: { label: 'OpenRouter', url: 'https://openrouter.ai/baai/bge-m3' } },
            { name: 'Voyage 4 Lite', modality: 'text', price: 0.02, multimodal: 'no', use: '**Cheap indexing**; queries against Voyage 4 indexes', pricing: { label: 'Voyage', url: 'https://docs.voyageai.com/docs/pricing' } },
            { name: 'OpenAI text-embedding-3-small', modality: 'text', price: 0.02, multimodal: 'no', use: 'Low-cost API, widely integrated', pricing: { label: 'OpenAI', url: 'https://platform.openai.com/docs/pricing' } },
            { name: 'Voyage 4', modality: 'text', price: 0.06, multimodal: 'no', use: 'Balanced option in the Voyage 4 family', pricing: { label: 'Voyage', url: 'https://docs.voyageai.com/docs/pricing' } },
            { name: 'Voyage 4 Large', modality: 'text', price: 0.12, multimodal: 'no', use: 'Higher retrieval quality', pricing: { label: 'Voyage', url: 'https://docs.voyageai.com/docs/pricing' } },
            { name: 'OpenAI text-embedding-3-large', modality: 'text', price: 0.13, multimodal: 'no', use: 'Established alternative', pricing: { label: 'OpenAI', url: 'https://platform.openai.com/docs/pricing' } },
            { name: 'Gemini Embedding 001', modality: 'text', price: 0.15, multimodal: 'no', use: 'Multilingual', pricing: { label: 'Google', url: 'https://ai.google.dev/gemini-api/docs/pricing' } },
            { name: 'Gemini Embedding 2', sub: 'Price shown for text', modality: ['text', 'multimodal'], price: 0.20, multimodal: 'yes', use: 'Text + photographs + audio and video', pricing: { label: 'Google', url: 'https://ai.google.dev/gemini-api/docs/pricing' } },
          ],
          callout: {
            tone: 'good',
            title: 'Voyage 4 shared vector space',
            text: 'Documents indexed with **Voyage 4 Large** can be queried with **Voyage 4 Nano** (local) or 4 Lite (API) **without reindexing**, because the family shares one vector space. Voyage offers **200M free tokens** for eligible Voyage 4 models under its current terms. [Source: Voyage AI](https://blog.voyageai.com/2026/01/15/voyage-4/)',
          },
        },
        {
          id: 'embeddings-rerankers',
          title: 'Local rerankers',
          intro: 'A reranker reorders the passages returned by a search by relevance.',
          row: { runs: 'local', modality: 'text' },
          columns: [
            { key: 'name', label: 'Reranker', type: 'name' },
            { key: 'context', label: 'Context', type: 'text' },
            { key: 'languages', label: 'Languages', type: 'text' },
            { key: 'fit', label: 'Runs on (minimum)', type: 'fit' },
            { key: 'licence', label: 'Licence · weights', type: 'licence' },
            { key: 'role', label: 'Role in Nodus', type: 'text' },
          ],
          rows: [
            { name: 'GTE Multilingual Reranker Base', sub: '306M parameters', context: '8K', languages: '70+', fit: { mac: 8, gpu: 6, cpu: true }, licence: LICENCE.apache('Alibaba', 'https://huggingface.co/Alibaba-NLP/gte-multilingual-reranker-base'), role: 'Light reranking' },
            { name: 'Qwen3 Reranker 0.6B', pick: 'Balanced pick', sub: '600M parameters', context: '32K', languages: '100+', fit: { mac: 16, gpu: 8 }, licence: LICENCE.apache('Qwen', 'https://huggingface.co/Qwen/Qwen3-Reranker-0.6B'), role: '**The balanced option**' },
            { name: 'BGE Reranker v2 M3', sub: '~568M parameters', context: 'Depends on the runtime', languages: 'Multilingual', fit: { mac: 16, gpu: 8 }, licence: LICENCE.mit('BAAI', 'https://huggingface.co/BAAI/bge-reranker-v2-m3'), role: 'Simple, pairs with the BGE family' },
            { name: 'Jina Reranker v3.5', sub: '600M parameters', context: 'Depends on the runtime', languages: 'Multilingual', fit: { mac: 16, gpu: 8 }, licence: { name: 'CC BY-NC 4.0', by: 'Jina', url: 'https://huggingface.co/jinaai/jina-reranker-v3.5', warn: 'Non-commercial' }, role: 'Test candidate; **check the licence**' },
            { name: 'Qwen3 Reranker 4B', sub: '4B parameters', context: '32K', languages: '100+', fit: { mac: 32, gpu: 16 }, licence: LICENCE.apache('Qwen', 'https://huggingface.co/Qwen/Qwen3-Reranker-4B'), role: 'High quality, more latency' },
          ],
          callout: {
            tone: 'warn',
            title: 'Index compatibility',
            text: 'Do not mix embedding models without a compatible index. If the vector space or the dimension changes, Nodus must build a new index. Changing the **reranker** does not require reindexing, because it works on query–passage pairs. For historical sources, keep exact or BM25 search for place names, dates, authors and proper names.',
          },
        },
      ],
    },

    /* ============================================================ chat */
    {
      id: 'chat',
      label: 'Research Chat + Dictionary',
      icon: 'chat',
      accent: '#a78bfa',
      updated: '2026-10-20',
      title: 'Research Chat + Dictionary',
      intro: 'Both features **can use local models**: Nodus searches the local index, generates the answer and shows verifiable citations. APIs provide higher quality and longer context. Local chat needs at least **24 GB of unified memory or 12 GB of VRAM**; below that, keep the retrieval local and use an API for the answer.',
      filters: [RUNS, PRICE, SPEED, PROVIDER],
      tables: [
        {
          id: 'chat-api',
          title: 'API models: price, intelligence and speed',
          row: { runs: 'api' },
          columns: [...API_HEAD, { key: 'profile', label: 'Profile', type: 'text' }],
          rows: [
            { ref: 'deepseek-flash-max', pick: 'Research Chat', profile: '**Featured for Research Chat: speed and tools**' },
            { ref: 'mimo-pro', profile: 'Reasoning and long context' },
            { ref: 'haiku-high', pick: 'Dictionary', profile: '**Dictionary: accuracy per cost**' },
            { ref: 'haiku-max', profile: 'Higher score; longer time to first token' },
            { ref: 'glm-flash', profile: 'Cheap alternative, verbose' },
            { ref: 'luna-max', profile: 'Low-cost reasoning' },
            { ref: 'luna-high', profile: 'Short definitions' },
            { ref: 'mimo-flash', profile: 'Low cost per token' },
            { ref: 'gemini-flash-high', profile: 'Google’s multimodal; higher price' },
            { ref: 'sonnet-max', profile: 'Premium option, not a default' },
          ],
          footnote: 'USD per million tokens. **AA** is the Artificial Analysis general index, not a Nodus quality measurement. *High* and *Max* settings may use different amounts of hidden reasoning tokens. Speed is generation speed **after the answer starts**, not total time. Click a column heading to sort.',
        },
        {
          id: 'chat-local',
          title: 'Local alternatives',
          row: { runs: 'local' },
          flow: {
            lanes: [
              { label: 'Chat pipeline', tone: 'accent', steps: ['Query', 'Retrieval (dense + lexical)', 'Reranking', 'Answer with citations'] },
            ],
          },
          columns: [
            { key: 'name', label: 'Tier', type: 'name' },
            { key: 'chat', label: 'Research Chat', type: 'text' },
            { key: 'dictionary', label: 'Dictionary', type: 'text' },
            { key: 'retrieval', label: 'Idea retrieval', type: 'text' },
            { key: 'fit', label: 'Runs on (minimum)', type: 'fit' },
          ],
          rows: [
            { name: 'Light', chat: 'Qwen3.5 4B', dictionary: 'Gemma E2B / Phi-4 Mini', retrieval: 'Harrier 270M + GTE Reranker', fit: { mac: 24, gpu: 12 } },
            { name: 'Balanced', pick: 'Balanced pick', chat: '**Qwen3.5 9B**', dictionary: '**Gemma E4B / Qwen3.5 9B**', retrieval: '**Harrier 0.6B or BGE-M3 + Qwen3 Reranker**', fit: { mac: 32, gpu: 16 } },
            { name: 'Advanced', chat: 'Gemma 4 26B-A4B', dictionary: 'Gemma 4 12B', retrieval: 'Harrier / Qwen3 Embedding 4B + reranker', fit: { mac: 48, gpu: 32 } },
            { name: 'Best local quality', chat: 'Qwen3.8 27B / Gemma 4 31B', dictionary: 'Qwen3.8 27B', retrieval: 'Qwen3 Embedding 8B + reranker', fit: { mac: 64, gpu: 48 } },
          ],
          callout: {
            tone: 'info',
            title: 'Answer format',
            text: 'Do not invent sources; return the passage text and its reference. For the Dictionary, limit output length, structure entries as term, senses and context, and link examples to sources when available.',
          },
        },
      ],
    },

    /* ============================================================ extraction */
    {
      id: 'extraction',
      label: 'Idea Extraction',
      icon: 'bulb',
      accent: '#fbbf24',
      updated: '2026-10-19',
      title: 'Idea Extraction',
      intro: 'Idea Extraction processes documents and extracts **new** ideas with their attribution. It uses API providers. Processing many pages, attributing claims and validating passages is a different workload from searching already extracted ideas, which runs locally with embeddings and a reranker.',
      notes: [{
        tone: 'bad',
        title: 'Local models not recommended',
        text: 'Use local models to search and rerank extracted ideas. Use an API provider for bulk extraction.',
      }],
      filters: [PRICE, SPEED, PROVIDER],
      tables: [
        {
          id: 'extraction-api',
          title: 'API candidates (no default)',
          intro: 'No model is set as **default**. Select by testing on your own corpus: faithfulness, omitted ideas, attribution accuracy and total cost.',
          row: { runs: 'api' },
          estimator: { documents: 1000, inputTokens: 10000, outputTokens: 2000 },
          columns: [...API_HEAD, { key: 'estimate', label: 'Estimated cost', type: 'cost' }, { key: 'test', label: 'What to test', type: 'text' }],
          rows: [
            { ref: 'haiku-high', test: 'Faithfulness and JSON structure' },
            { ref: 'luna-high', test: 'Cost per valid idea, and concision' },
            { ref: 'luna-max', test: 'Interpretive nuance' },
            { ref: 'deepseek-flash-max', test: 'Coverage and end-to-end time' },
            { ref: 'mimo-flash', test: 'Batch runs, bulk cost, omissions' },
            { ref: 'mimo-pro', test: 'Hard cases and implicit ideas' },
            { ref: 'glm-flash', test: 'Verbosity and actual token cost' },
            { ref: 'haiku-max', test: 'Improvement over High' },
            { ref: 'gemini-flash-lite', test: 'Throughput, output cost and omissions at volume' },
          ],
          footnote: 'Simplified estimate: every document has the same input and billable output tokens (reasoning included). Excludes caching, batch pricing, off-peak discounts, retries, format errors and tools, and does not measure the actual reasoning length of each model. Adjust the three values above to match your corpus.',
          callout: {
            tone: 'info',
            title: 'Selection criteria',
            text: 'Test 50–100 multilingual articles or chapters. Review manually the supported claims, omitted ideas, spurious references and accuracy of exact quotations. Compare **end-to-end** time and cost per correct idea.',
          },
        },
      ],
    },

    /* ============================================================ deep research */
    {
      id: 'deep',
      label: 'Deep Research + Immersion',
      icon: 'compass',
      accent: '#22d3ee',
      updated: '2026-10-20',
      title: 'Deep Research + Immersion',
      intro: '**Deep Research** requires iterative searches, planning, tool calls, source reconciliation and citations. **Immersion** requires explanations, extended dialogue and adaptation to the user’s level. Both use APIs by default; local embeddings and search can handle the retrieval step.',
      filters: [PRICE, SPEED, PROVIDER],
      tables: [
        {
          id: 'deep-api',
          title: 'API models',
          row: { runs: 'api' },
          columns: [...API_HEAD, { key: 'research', label: 'Deep Research', type: 'text' }, { key: 'immersion', label: 'Immersion', type: 'text' }],
          rows: [
            { ref: 'deepseek-flash-max', pick: 'Deep Research', research: '**Featured: balance of tools and price**', immersion: 'Good' },
            { ref: 'mimo-pro', research: 'Demanding research', immersion: 'Good' },
            { ref: 'haiku-high', research: 'Cheap subtasks', immersion: '**Conversation and tutoring**' },
            { ref: 'haiku-max', research: 'Reasoning, with high latency', immersion: 'Complex tutoring' },
            { ref: 'glm-flash', research: 'Synthesis with tools', immersion: 'Good' },
            { ref: 'luna-max', research: 'Scoped subagents', immersion: 'Low-cost tutoring' },
            { ref: 'gemini-flash-high', research: 'Multimodal documents', immersion: 'Good' },
            { ref: 'sonnet-max', research: '**Premium tier**', immersion: 'Premium tier' },
            { ref: 'sol-max', research: '**Premium tier, less verbose**', immersion: 'Premium tier' },
            { ref: 'opus-max', research: '**Premium tier, highest score**', immersion: '**Premium tier, deepest tutoring**' },
          ],
          callout: {
            tone: 'info',
            title: 'Evaluation criteria',
            text: 'General intelligence scores are not sufficient. For Deep Research, measure the number of relevant searches, plan quality, source traceability, tool errors, real citations and **cost per completed report**. Immersion requires separate tests of teaching value.',
          },
        },
      ],
    },

    /* ============================================================ decision guide */
    {
      id: 'guide',
      label: 'Decision guide',
      icon: 'signpost',
      accent: '#f0abfc',
      updated: '2026-10-20',
      title: 'Decision guide',
      intro: 'One row per Nodus feature: local support, viable local setup, API to evaluate and decision metric.',
      filters: [{
        id: 'local', label: 'Runs locally', field: 'local',
        options: [
          { id: 'yes', label: 'Yes' },
          { id: 'aux', label: 'Retrieval only' },
          { id: 'no', label: 'No' },
        ],
      }],
      tables: [
        {
          id: 'guide-matrix',
          title: 'Feature matrix',
          columns: [
            { key: 'name', label: 'Nodus feature', type: 'name' },
            { key: 'local', label: 'Local?', type: 'verdict' },
            { key: 'localSetup', label: 'Viable local setup', type: 'text' },
            { key: 'api', label: 'API to evaluate', type: 'text' },
            { key: 'measure', label: 'Decide by', type: 'text' },
          ],
          rows: [
            { name: 'Research Chat', href: '#chat', local: 'yes', localSetup: 'Qwen3.5 4B (24 GB); Qwen3.5 9B (32 GB); Qwen3.8 27B (64 GB)', api: 'DeepSeek Flash-1017; Haiku High', measure: 'Grounded answers and total latency' },
            { name: 'Dictionary', href: '#chat', local: 'yes', localSetup: 'Gemma E2B / E4B (24–32 GB); Qwen3.5 9B (32 GB)', api: 'Haiku High; Luna High', measure: 'Terminological accuracy and concision' },
            { name: 'Text embeddings', href: '#embeddings', local: 'yes', localSetup: 'Harrier 270M (light) / **Harrier 0.6B** (balanced); BGE-M3 (hybrid)', api: '**BGE-M3 via OpenRouter**; Voyage 4 / 4 Lite', measure: 'Recall@10, MRR / nDCG, indexing cost' },
            { name: 'Multimodal embeddings', href: '#embeddings', local: 'yes', localSetup: '**EmbeddingGemma 2**', api: 'Gemini Embedding 2', measure: 'Cross-modal text–image retrieval' },
            { name: 'Retrieving existing ideas', href: '#local', local: 'yes', localSetup: 'BGE-M3 / Harrier + Qwen3 0.6B reranker; a local answer needs 24 GB+', api: 'Voyage 4 + an API LLM (optional)', measure: 'Source accuracy, latency, top-k' },
            { name: 'Idea Extraction (new ideas)', href: '#extraction', local: 'no', localSetup: '**None**', api: '**See the API comparison; no default**', measure: 'Supported ideas, misses, time and cost per idea' },
            { name: 'Deep Research', href: '#deep', local: 'aux', localSetup: 'Embeddings and lexical search; no local LLM by default', api: 'DeepSeek Flash-1017, MiMo Pro; Sol or Sonnet as premium', measure: 'Finished research with verified citations' },
            { name: 'Immersion', href: '#deep', local: 'aux', localSetup: 'Embeddings and local reading', api: 'Haiku High; Luna; Sonnet as premium', measure: 'Teaching value and cost per session' },
          ],
        },
      ],
    },
  ];

  /* ---------------------------------------------------------------- methodology */
  const method = [
    { term: 'API prices', text: 'USD per **million input and output tokens**, before tax, batch discounts, caching, special rates or aggregator margins.' },
    { term: 'AA intelligence', text: '[Artificial Analysis Intelligence Index v4.3.2](https://artificialanalysis.ai/); higher is better. It compares the general capability of the listed variant and reasoning setting. It **does not measure academic extraction or bibliographic faithfulness**.' },
    { term: 'API speed', text: 'Output tokens per second from the measured provider. It **excludes part of the initial reasoning and the time to first token**. It is not documents per second, total cost or local speed. Rounded point measurements.' },
    { term: 'AA cost / task', text: 'A weighted average across the Artificial Analysis tasks. It is not the cost of a Nodus request or of extracting one document.' },
    { term: 'MTEB multilingual', text: 'An embeddings benchmark, **not comparable with the AA index**. Its subtasks are not historiographical RAG.' },
    { term: 'Local hardware', text: 'Bands are **minimums for a full grounded answer**, not measured throughput: they include the generative model, the embedding and reranking models, a long context, the application and the operating system. Context, batch size, offload, drivers and quantisation still affect the result. No local throughput figures are given without physical tests.' },
    { term: 'Licences', text: 'As declared in the repositories consulted. Check terms, versions and dependencies before distributing a model with Nodus.' },
  ];

  const sources = [
    {
      title: 'Generative models and prices',
      links: [
        { label: 'Artificial Analysis · DeepSeek Flash-1017', url: 'https://artificialanalysis.ai/models/deepseek-v4-1-flash-1017' },
        { label: 'Artificial Analysis · MiMo V2.6 Pro', url: 'https://artificialanalysis.ai/models/mimo-v2-6-pro' },
        { label: 'Artificial Analysis · MiMo V2.6 Flash', url: 'https://artificialanalysis.ai/models/mimo-v2-6-flash' },
        { label: 'Artificial Analysis · Haiku 5.5 High', url: 'https://artificialanalysis.ai/models/claude-haiku-5-5-high' },
        { label: 'Artificial Analysis · Haiku 5.5 Max', url: 'https://artificialanalysis.ai/models/claude-haiku-5-5' },
        { label: 'Artificial Analysis · GPT-6 Luna High', url: 'https://artificialanalysis.ai/models/gpt-6-luna-high' },
        { label: 'Artificial Analysis · GPT-6 Luna Max', url: 'https://artificialanalysis.ai/models/gpt-6-luna' },
        { label: 'Artificial Analysis · GLM-5.3 Flash', url: 'https://artificialanalysis.ai/models/glm-5-3-flash' },
        { label: 'Artificial Analysis · Gemini 3.8 Flash', url: 'https://artificialanalysis.ai/models/releases/gemini-3-8-flash' },
        { label: 'Artificial Analysis · Gemini 3.5 Flash-Lite', url: 'https://artificialanalysis.ai/models/gemini-3-5-flash-lite' },
        { label: 'Artificial Analysis · Claude Sonnet 5.5', url: 'https://artificialanalysis.ai/models/claude-sonnet-5-5' },
        { label: 'Artificial Analysis · Claude Opus 5.5', url: 'https://artificialanalysis.ai/models/claude-opus-5-5' },
        { label: 'Artificial Analysis · GPT-6.1 Sol', url: 'https://artificialanalysis.ai/models/gpt-6-1-sol' },
        { label: 'Qwen3.8 27B', url: 'https://huggingface.co/Qwen/Qwen3.8-27B' },
        { label: 'Qwen3.5 9B', url: 'https://huggingface.co/Qwen/Qwen3.5-9B' },
        { label: 'Qwen3.5 35B-A3B', url: 'https://huggingface.co/Qwen/Qwen3.5-35B-A3B' },
        { label: 'Google Gemma 4: real sizes and active parameters', url: 'https://huggingface.co/google/gemma-4-E4B-it' },
      ],
    },
    {
      title: 'Embeddings and reranking',
      links: [
        { label: 'Microsoft Harrier OSS: MTEB v2 and parameters', url: 'https://huggingface.co/microsoft/harrier-oss-v1-0.6b' },
        { label: 'Google EmbeddingGemma 2: modular design', url: 'https://developers.googleblog.com/embeddinggemma-2-the-developer-guide/' },
        { label: 'BAAI BGE-M3: dense, sparse, multi-vector', url: 'https://huggingface.co/BAAI/bge-m3' },
        { label: 'Qwen3 Embedding and Reranker', url: 'https://huggingface.co/Qwen/Qwen3-Reranker-0.6B' },
        { label: 'Voyage 4: a shared vector space', url: 'https://blog.voyageai.com/2026/01/15/voyage-4/' },
        { label: 'Voyage pricing', url: 'https://docs.voyageai.com/docs/pricing' },
        { label: 'Google API pricing', url: 'https://ai.google.dev/gemini-api/docs/pricing' },
        { label: 'OpenAI API pricing', url: 'https://platform.openai.com/docs/pricing' },
        { label: 'OpenRouter · BGE-M3 embeddings', url: 'https://openrouter.ai/baai/bge-m3' },
      ],
    },
  ];

  /* Newest first. One line per review. */
  const changelog = [
    { date: '2026-10-20', text: 'Added Claude Opus 5.5 to Deep Research + Immersion, refreshed the measured speed of GPT-6.1 Sol and MiMo V2.6 Pro, and marked DeepSeek Flash as the featured model in both Research Chat and Deep Research.' },
    { date: '2026-10-20', text: 'Raised the memory requirements for every local generative model and explained why a grounded answer needs more than the Q4 weights: local chat now starts at 24 GB unified or 12 GB VRAM, and 16 GB machines are recommended for retrieval only.' },
    { date: '2026-10-19', text: 'Added BGE-M3 via OpenRouter as the recommended API embedding model, and Gemini 3.5 Flash-Lite to the Idea Extraction candidates.' },
    { date: '2026-10-19', text: 'First edition: local models, embeddings and rerankers, Research Chat + Dictionary, Idea Extraction, Deep Research + Immersion, and the decision guide.' },
  ];

  window.NODUS_MODEL_GUIDE = {
    benchmark: { label: 'Artificial Analysis v4.3.2', url: 'https://artificialanalysis.ai/' },
    languages: 'English, Spanish, French',
    apiModels,
    tabs,
    method,
    sources,
    changelog,
  };
})();
