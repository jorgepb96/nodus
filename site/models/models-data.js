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
      input: 0.435, output: 0.87, intelligence: 46, speed: 51, taskCost: 0.13,
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
    'sonnet-max': {
      name: 'Claude Sonnet 5.5', reasoning: 'Max', provider: 'anthropic',
      input: 2.00, output: 10.00, intelligence: 56, speed: 140, speedApprox: true, taskCost: 5.46,
      source: 'https://artificialanalysis.ai/models/claude-sonnet-5-5',
    },
    'sol-max': {
      name: 'GPT-6.1 Sol', reasoning: 'Max', provider: 'openai',
      input: 2.00, output: 10.00, intelligence: 52, speed: 64, speedApprox: true, taskCost: 0.72,
      source: 'https://artificialanalysis.ai/models/gpt-6-1-sol',
    },
  };

  /* ---------------------------------------------------------------- filters
     Shared between tabs: the same id keeps the same selection everywhere. */
  const MACHINE = {
    id: 'machine', label: 'Your machine', type: 'machine',
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
      { id: 'local', label: 'On my machine' },
      { id: 'api', label: 'Through an API' },
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
      { id: 'steady', label: 'Steady', hint: '80 to 149 t/s', atLeast: 80, below: 150 },
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
      updated: '2026-10-19',
      title: 'Local models',
      intro: 'Open weights you download and run yourself. They handle Research Chat, the Dictionary, drafting, summaries of **ideas you’ve already retrieved**, and semantic search. They aren’t proposed for extracting new ideas in bulk. And an API’s speed tells you nothing about how fast a model runs on your laptop.',
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
          intro: 'From lightest to heaviest. Pick your machine above and only what fits stays.',
          columns: [
            { key: 'name', label: 'Model', type: 'name' },
            { key: 'q4', label: 'Q4 size*', type: 'text' },
            { key: 'fit', label: 'Runs on (minimum)', type: 'fit' },
            { key: 'chat', label: 'Research Chat', type: 'text' },
            { key: 'dictionary', label: 'Dictionary / retrieved ideas', type: 'text' },
            { key: 'licence', label: 'Licence · weights', type: 'licence' },
          ],
          rows: [
            { name: 'Gemma 4 E2B IT', family: 'gemma', sub: '5.1B total · 2.3B effective', q4: '~3–5 GB', fit: { mac: 8, gpu: 6, cpu: 'slow' }, chat: 'Basic', dictionary: 'Quick definitions', licence: LICENCE.apache('Google', 'https://huggingface.co/google/gemma-4-E2B-it') },
            { name: 'Qwen3.5 4B', family: 'qwen', sub: '4B', q4: '~3–5 GB', fit: { mac: 8, gpu: 6, cpu: 'slow' }, chat: 'Light', dictionary: '**Very well suited**', licence: LICENCE.apache('Qwen', 'https://huggingface.co/Qwen/Qwen3.5-4B') },
            { name: 'Phi-4 Mini Instruct', family: 'phi', sub: '3.8B', q4: '~3–5 GB', fit: { mac: 8, gpu: 6, cpu: 'slow' }, chat: 'Light', dictionary: 'Definitions, structured output', licence: LICENCE.mit('Microsoft', 'https://huggingface.co/microsoft/Phi-4-mini-instruct') },
            { name: 'Gemma 4 E4B IT', family: 'gemma', sub: '8B total · 4.5B effective', q4: '~5–8 GB', fit: { mac: 16, gpu: 8 }, chat: 'Good', dictionary: '**Very well suited**, multimodal', licence: LICENCE.apache('Google', 'https://huggingface.co/google/gemma-4-E4B-it') },
            { name: 'Qwen3.5 9B', family: 'qwen', pick: 'Balanced pick', sub: '~9B', q4: '~6–9 GB', fit: { mac: 16, gpu: 12 }, chat: '**Balanced**', dictionary: '**Balanced**, multilingual', licence: LICENCE.apache('Qwen', 'https://huggingface.co/Qwen/Qwen3.5-9B') },
            { name: 'Gemma 4 12B Unified', family: 'gemma', sub: '~12B', q4: '~8–12 GB', fit: { mac: 24, gpu: 16 }, chat: 'High', dictionary: 'High', licence: LICENCE.apache('Google', 'https://huggingface.co/google/gemma-4-12B-it') },
            { name: 'Gemma 4 26B-A4B', family: 'gemma', sub: '25.2B total · 3.8B active', q4: '~15–20 GB', fit: { mac: 32, gpu: 24 }, chat: '**High, efficient MoE**', dictionary: 'High', licence: LICENCE.apache('Google', 'https://huggingface.co/google/gemma-4-26B-A4B-it') },
            { name: 'Qwen3.8 27B', family: 'qwen', sub: '27B', q4: '~17–22 GB', fit: { mac: 32, gpu: 24 }, fitNote: 'Tight on a 32 GB Mac; 48 GB is comfortable', chat: '**Very high**', dictionary: 'High', licence: LICENCE.apache('Qwen', 'https://huggingface.co/Qwen/Qwen3.8-27B') },
            { name: 'Qwen3.5 35B-A3B', family: 'qwen', sub: '~35B total · ~3B active', q4: '~22–28 GB', fit: { mac: 48, gpu: 32 }, chat: 'High, MoE', dictionary: 'High', licence: LICENCE.apache('Qwen', 'https://huggingface.co/Qwen/Qwen3.5-35B-A3B') },
            { name: 'Gemma 4 31B', family: 'gemma', sub: '~31B', q4: '~20–26 GB', fit: { mac: 48, gpu: 32 }, chat: '**Very high**', dictionary: 'High', licence: LICENCE.apache('Google', 'https://huggingface.co/google/gemma-4-31B-it') },
          ],
          footnote: '* **Estimates**, not official requirements or measurements: roughly 4-bit weights plus metadata, and they vary between GGUF and MLX builds. They **don’t include the headroom** for the system, long context, KV cache, vision, other processes or a shared GPU, so keep several GB free. A MoE model’s *active* parameters aren’t what has to sit in memory, and Gemma E2B/E4B “effective” sizes aren’t the totals either. A 24 GB card can run tight on long contexts, and 32 GB doesn’t guarantee good throughput.',
        },
        {
          id: 'local-profiles',
          title: 'Hardware profiles',
          intro: 'Start here if you know your machine but not the model names. Each profile says what’s realistic for chat and for retrieval.',
          columns: [
            { key: 'name', label: 'Profile', type: 'name' },
            { key: 'memory', label: 'Memory', type: 'text' },
            { key: 'graphics', label: 'Graphics', type: 'text' },
            { key: 'chat', label: 'Research Chat + Dictionary', type: 'text' },
            { key: 'retrieval', label: 'Embeddings + retrieval', type: 'text' },
            { key: 'verdict', label: 'Verdict', type: 'text' },
          ],
          rows: [
            { tag: 'D0', name: 'Budget CPU, N100 mini-PC', machines: ['cpu'], memory: '8–16 GB RAM', graphics: 'Intel UHD, no dedicated VRAM', chat: 'Phi-4 Mini, Gemma E2B or Qwen 4B, **slow on CPU**', retrieval: 'EmbeddingGemma 2 (text), Harrier 270M, GTE reranker 306M', verdict: '**Search and Dictionary before heavy chat**' },
            { tag: 'D1', name: 'Entry Mac or laptop', machines: ['mac8'], memory: '**8 GB unified**', graphics: 'Apple Silicon integrated GPU', chat: 'Qwen3.5 4B or Gemma E2B Q4, short context', retrieval: 'Harrier 270M, Voyage 4 Nano, EmbeddingGemma 2 (text)', verdict: 'Works, with few apps open at once' },
            { tag: 'D2', name: 'MacBook Air M2, 16 GB', pick: 'Balanced', machines: ['mac16'], memory: '**16 GB unified**', graphics: 'Apple M2 GPU', chat: '**Qwen3.5 9B Q4**; Gemma E4B as the alternative', retrieval: '**Harrier 0.6B / BGE-M3** + Qwen3 Reranker 0.6B, one after the other', verdict: '**Nodus’s balanced local profile**' },
            { tag: 'D3', name: 'Mac mini or MacBook Pro', machines: ['mac24', 'mac32'], memory: '24–32 GB unified', graphics: 'Apple Silicon GPU', chat: 'Gemma 4 12B; Gemma 26B-A4B Q4 on 32 GB with room to spare; Qwen 27B is tight', retrieval: 'Harrier 0.6B / BGE-M3 / EmbeddingGemma 2', verdict: 'Good for advanced chat; watch the KV cache' },
            { tag: 'D4', name: 'Mac Studio or MacBook Pro', machines: ['mac48', 'mac64'], memory: '**48–64 GB unified**', graphics: 'Apple Silicon with more memory bandwidth', chat: '**Qwen3.8 27B**, Gemma 4 26B-A4B / 31B, Qwen 35B-A3B', retrieval: 'Qwen3 Embedding 4B–8B; a 4B reranker if it earns its place', verdict: 'Best local profile for quality' },
            { tag: 'D5', name: 'PC with an entry graphics card', machines: ['gpu6', 'gpu8'], memory: '16–32 GB RAM + **6–8 GB VRAM**', graphics: 'NVIDIA or AMD, discrete', chat: 'Qwen 4B / Gemma E4B Q4; 9B may need offload', retrieval: 'Harrier 270M / 0.6B, EmbeddingGemma 2', verdict: 'Depends on real VRAM, not total RAM' },
            { tag: 'D6', name: 'PC with a mid-range graphics card', machines: ['gpu12', 'gpu16'], memory: '32 GB RAM + **12–16 GB VRAM**', graphics: 'NVIDIA or AMD, discrete', chat: '**Qwen 9B**, Gemma 12B Q4 (16 GB), small models with long context', retrieval: 'BGE-M3, Harrier 0.6B, Qwen3 Reranker 0.6B', verdict: 'Good interactive speed' },
            { tag: 'D7', name: 'PC with a high-end graphics card', machines: ['gpu24'], memory: '32–64 GB RAM + **24 GB VRAM**', graphics: 'RTX 3090 / 4090 or another 24 GB card', chat: 'Gemma 26B-A4B / Qwen 27B Q4, minding the KV cache', retrieval: 'Qwen3 Embedding 4B–8B and rerankers', verdict: 'Ideal for ~27B models if they fit whole' },
            { tag: 'D8', name: 'Workstation', machines: ['gpu32', 'gpu48'], memory: '64–128+ GB RAM + **32–48+ GB VRAM**', graphics: 'Professional GPU or several', chat: 'Gemma 31B, Qwen 35B-A3B and longer contexts', retrieval: '8B embeddings and top-tier reranking', verdict: 'Advanced; the hardware costs a lot' },
          ],
        },
        {
          id: 'local-mac',
          title: 'Apple Silicon, by memory',
          collapsed: true,
          intro: 'Unified memory isn’t dedicated VRAM: macOS and every open app draw from the same pool.',
          columns: [
            { key: 'name', label: 'Memory', type: 'name' },
            { key: 'chat', label: 'Preferred chat models', type: 'text' },
            { key: 'embeddings', label: 'Preferred embedding models', type: 'text' },
            { key: 'avoid', label: 'Don’t make it the default', type: 'text' },
          ],
          rows: [
            { name: '8 GB', machines: ['mac8'], chat: 'Gemma E2B · Qwen 4B Q4', embeddings: 'Harrier 270M · Voyage Nano', avoid: '9B and up with long context' },
            { name: '16 GB', machines: ['mac16'], chat: '**Qwen 9B Q4 · Gemma E4B**', embeddings: '**Harrier 0.6B · BGE-M3**', avoid: '27B / 35B, and heavy multitasking' },
            { name: '24 GB', machines: ['mac24'], chat: 'Gemma 12B · 9B with more context', embeddings: 'Harrier 0.6B · EmbeddingGemma 2', avoid: '35B Q4' },
            { name: '32 GB', machines: ['mac32'], chat: 'Gemma 26B-A4B · Qwen 27B with care', embeddings: 'Qwen3 Embedding 4B', avoid: '35B, if you need it fluent for long stretches' },
            { name: '48–64 GB', machines: ['mac48', 'mac64'], chat: 'Qwen 27B · Gemma 31B · Qwen 35B-A3B', embeddings: 'Qwen3 Embedding 8B', avoid: 'Assuming speeds you haven’t tested' },
          ],
        },
        {
          id: 'local-pc',
          title: 'PC graphics card, by free VRAM',
          collapsed: true,
          intro: 'Read it as **free VRAM**, not RAM plus VRAM. A model that doesn’t fit can spill into RAM, but then speed depends on the bus, the engine and the CPU.',
          columns: [
            { key: 'name', label: 'Free VRAM', type: 'name' },
            { key: 'chat', label: 'Chat, roughly, in Q4', type: 'text' },
            { key: 'embeddings', label: 'Embeddings and reranking', type: 'text' },
          ],
          rows: [
            { name: '4–6 GB', machines: ['gpu6'], chat: 'Phi-4 Mini / Qwen 4B', embeddings: 'Harrier 270M / Voyage Nano' },
            { name: '8 GB', machines: ['gpu8'], chat: 'Qwen 4B / Gemma E4B', embeddings: 'Harrier 0.6B / BGE-M3' },
            { name: '12 GB', machines: ['gpu12'], chat: 'Qwen 9B / Gemma 12B, very tight', embeddings: 'Harrier 0.6B + a 0.6B reranker' },
            { name: '16 GB', machines: ['gpu16'], chat: 'Qwen 9B / Gemma 12B', embeddings: 'BGE-M3 / Qwen3 Embedding 4B' },
            { name: '24 GB', machines: ['gpu24'], chat: 'Gemma 26B-A4B / Qwen 27B Q4', embeddings: 'Qwen3 Embedding 8B' },
            { name: '32–48 GB', machines: ['gpu32', 'gpu48'], chat: 'Qwen 35B-A3B / Gemma 31B', embeddings: 'Large embeddings + large rerankers' },
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
            { name: '8–16 GB', machines: ['cpu'], advice: 'Put **EmbeddingGemma 2 (text only)**, Voyage 4 Nano, Harrier 270M or a 306M reranker first. Chat with a 2–4B model only if slow is fine.' },
            { name: '32 GB, e.g. Intel N100', machines: ['cpu'], advice: 'A 9–27B model that fits in RAM **won’t necessarily** answer quickly. Put embeddings, search, a vector server and reranking first, and send complex conversation to an API.' },
            { name: '64 GB and up', machines: ['cpu'], advice: 'Holds bigger models, but RAM and parameter count don’t make up for memory bandwidth and acceleration.' },
          ],
        },
        {
          id: 'local-retrieval',
          title: 'Retrieve ideas locally; extract them through an API',
          intro: 'Retrieving ideas you already have **isn’t** extracting new ones. The first runs fine on your machine.',
          flow: {
            lanes: [
              { label: 'On your machine', tone: 'good', steps: ['Ideas already indexed', 'Local embeddings', 'Semantic + hybrid search', 'Local reranker', 'Research Chat or Dictionary'] },
              { label: 'Through an API', tone: 'warn', steps: ['Unprocessed documents', 'Idea Extraction', 'Ideas already indexed'] },
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
            { name: 'Explain and connect retrieved ideas', verdict: 'yes', components: 'Qwen3.5 9B, Gemma E4B or Gemma 26B-A4B, depending on hardware', condition: 'Answer citing IDs, passages and sources' },
            { name: 'Extract new ideas in bulk', verdict: 'no', components: '**Local models aren’t recommended**', condition: 'Use an API provider: see [Idea Extraction](#extraction)' },
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
      intro: 'Embeddings turn passages into vectors so Nodus can find related texts, ideas and documents. They retrieve; they **don’t generate ideas**. Run them on your machine or pay per token through an API. With historical sources in three languages, test cross-language search, proper names and literal quotations before you settle on one.',
      filters: [RUNS, MACHINE, {
        id: 'modality', label: 'Content', field: 'modality',
        options: [
          { id: 'text', label: 'Text' },
          { id: 'multimodal', label: 'Images, audio, video' },
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
            { name: 'Harrier-OSS 0.6B', pick: 'Top text candidate', sub: '~600M parameters', modality: 'text', mteb: 69.0, context: '32K', dimensions: '1,024', fit: { mac: 16, gpu: 8 }, notes: '**The main candidate for text**', licence: LICENCE.mit('Microsoft', 'https://huggingface.co/microsoft/harrier-oss-v1-0.6b') },
            { name: 'Harrier-OSS 270M', sub: '270M parameters', modality: 'text', mteb: 66.5, context: '32K', dimensions: '640', fit: { mac: 8, cpu: true }, notes: 'Light, text', licence: LICENCE.mit('Microsoft', 'https://huggingface.co/microsoft/harrier-oss-v1-270m') },
            { name: 'Voyage 4 Nano', sub: '~340M parameters', modality: 'text', mteb: null, context: '32K', dimensions: '256–2,048', fit: { mac: 8, cpu: true }, notes: '**Shares the Voyage 4 vector space**', licence: LICENCE.apache('Voyage', 'https://huggingface.co/voyageai/voyage-4-nano') },
            { name: 'EmbeddingGemma 2 (text)', sub: '**270M text** · 740M multimodal', modality: ['text', 'multimodal'], mteb: '61.36 (text)', context: '8K', dimensions: '128–768', fit: { mac: 8, cpu: true }, fitNote: 'Other modalities are optional', notes: 'Text, code, images, audio and video', licence: LICENCE.apache('Google', 'https://huggingface.co/google/embeddinggemma-2') },
            { name: 'BGE-M3', sub: '~568M parameters', modality: 'text', mteb: '~59.6 ‡', context: '8K', dimensions: '1,024', fit: { mac: 16, gpu: 8 }, notes: '**Dense + sparse + ColBERT**', licence: LICENCE.mit('BAAI', 'https://huggingface.co/BAAI/bge-m3') },
            { name: 'Qwen3 Embedding 0.6B', sub: '~600M parameters', modality: 'text', mteb: 64.3, context: '32K', dimensions: '1,024', fit: { mac: 16, gpu: 8 }, notes: '100+ languages, takes instructions', licence: LICENCE.apache('Qwen', 'https://huggingface.co/Qwen/Qwen3-Embedding-0.6B') },
            { name: 'Qwen3 Embedding 4B', sub: '4B parameters', modality: 'text', mteb: 69.5, context: '32K', dimensions: '2,560', fit: { mac: 32, gpu: 12 }, notes: 'Quality, at more compute', licence: LICENCE.apache('Qwen', 'https://huggingface.co/Qwen/Qwen3-Embedding-4B') },
            { name: 'Qwen3 Embedding 8B', sub: '8B parameters', modality: 'text', mteb: 70.6, context: '32K', dimensions: '4,096', fit: { mac: 48, gpu: 16 }, notes: 'High quality, lower throughput', licence: LICENCE.apache('Qwen', 'https://huggingface.co/Qwen/Qwen3-Embedding-8B') },
            { name: 'Harrier-OSS 27B', sub: '27B parameters', modality: 'text', mteb: 74.3, context: '32K', dimensions: '5,376', fit: { mac: 64, gpu: 48 }, fitNote: 'Workstation class', notes: 'Benchmark quality, impractical on a desktop', licence: LICENCE.mit('Microsoft', 'https://huggingface.co/microsoft/harrier-oss-v1-27b') },
          ],
          footnote: '† Published MTEB Multilingual v2 scores, **not** the AA Intelligence Index; figures from different model cards and dates don’t compare cleanly. ‡ BGE-M3’s score leaves out its sparse and multi-vector retrieval. EmbeddingGemma 2 has **740M parameters in total** but a **270M text encoder**; don’t mix the two sizes up. Sources: [Microsoft](https://huggingface.co/microsoft/harrier-oss-v1-0.6b) · [Google](https://developers.googleblog.com/embeddinggemma-2-the-developer-guide/) · [BAAI](https://huggingface.co/BAAI/bge-m3).',
        },
        {
          id: 'embeddings-api',
          title: 'Embeddings through an API: indexing cost',
          intro: 'You pay for **input tokens**, not for an LLM’s output. Prices are per million text tokens, before tax, caching or volume discounts.',
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
            { name: 'Voyage 4 Lite', modality: 'text', price: 0.02, multimodal: 'no', use: '**Cheap indexing**; queries against Voyage 4 indexes', pricing: { label: 'Voyage', url: 'https://docs.voyageai.com/docs/pricing' } },
            { name: 'OpenAI text-embedding-3-small', modality: 'text', price: 0.02, multimodal: 'no', use: 'Low-cost API, integrated almost everywhere', pricing: { label: 'OpenAI', url: 'https://platform.openai.com/docs/pricing' } },
            { name: 'Voyage 4', pick: 'Recommended API', modality: 'text', price: 0.06, multimodal: 'no', use: '**The balance we recommend through an API**', pricing: { label: 'Voyage', url: 'https://docs.voyageai.com/docs/pricing' } },
            { name: 'Voyage 4 Large', modality: 'text', price: 0.12, multimodal: 'no', use: 'Higher retrieval quality', pricing: { label: 'Voyage', url: 'https://docs.voyageai.com/docs/pricing' } },
            { name: 'OpenAI text-embedding-3-large', modality: 'text', price: 0.13, multimodal: 'no', use: 'The established alternative', pricing: { label: 'OpenAI', url: 'https://platform.openai.com/docs/pricing' } },
            { name: 'Gemini Embedding 001', modality: 'text', price: 0.15, multimodal: 'no', use: 'Multilingual', pricing: { label: 'Google', url: 'https://ai.google.dev/gemini-api/docs/pricing' } },
            { name: 'Gemini Embedding 2', sub: 'Price shown for text', modality: ['text', 'multimodal'], price: 0.20, multimodal: 'yes', use: 'Text + photographs + audio and video', pricing: { label: 'Google', url: 'https://ai.google.dev/gemini-api/docs/pricing' } },
          ],
          callout: {
            tone: 'good',
            title: 'A combination worth knowing',
            text: 'Index your documents once with **Voyage 4 Large**, then embed queries with **Voyage 4 Nano** on your machine or 4 Lite through the API, **without reindexing**: the family shares one vector space. Voyage offers **200M free tokens** to start on eligible Voyage 4 models, under its current terms. [Source: Voyage AI](https://blog.voyageai.com/2026/01/15/voyage-4/)',
          },
        },
        {
          id: 'embeddings-rerankers',
          title: 'Local rerankers: sharper idea retrieval',
          intro: 'A reranker rescores the passages a search returns, so the best evidence comes first.',
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
            { name: 'GTE Multilingual Reranker Base', sub: '306M parameters', context: '8K', languages: '70+', fit: { mac: 8, cpu: true }, licence: LICENCE.apache('Alibaba', 'https://huggingface.co/Alibaba-NLP/gte-multilingual-reranker-base'), role: 'Light reranking' },
            { name: 'Qwen3 Reranker 0.6B', pick: 'Balanced pick', sub: '600M parameters', context: '32K', languages: '100+', fit: { mac: 16, gpu: 8 }, licence: LICENCE.apache('Qwen', 'https://huggingface.co/Qwen/Qwen3-Reranker-0.6B'), role: '**The balanced option**' },
            { name: 'BGE Reranker v2 M3', sub: '~568M parameters', context: 'Depends on the runtime', languages: 'Multilingual', fit: { mac: 16, gpu: 8 }, licence: LICENCE.mit('BAAI', 'https://huggingface.co/BAAI/bge-reranker-v2-m3'), role: 'Simple, pairs with the BGE family' },
            { name: 'Jina Reranker v3.5', sub: '600M parameters', context: 'Depends on the runtime', languages: 'Multilingual', fit: { mac: 16, gpu: 8 }, licence: { name: 'CC BY-NC 4.0', by: 'Jina', url: 'https://huggingface.co/jinaai/jina-reranker-v3.5', warn: 'Non-commercial' }, role: 'Worth testing; **mind the licence**' },
            { name: 'Qwen3 Reranker 4B', sub: '4B parameters', context: '32K', languages: '100+', fit: { mac: 32, gpu: 16 }, licence: LICENCE.apache('Qwen', 'https://huggingface.co/Qwen/Qwen3-Reranker-4B'), role: 'High quality, more latency' },
          ],
          callout: {
            tone: 'warn',
            title: 'Don’t mix embedding models without a compatible index',
            text: 'If the vector space or the dimension changes, Nodus has to build a new index. Changing the **reranker** never needs a reindex, because it works on query–passage pairs. For historical work, keep exact or BM25 search alongside, for place names, dates, authors and proper names.',
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
      updated: '2026-10-19',
      title: 'Research Chat + Dictionary',
      intro: 'Both features **work with local models**. Nodus searches your index on your machine, writes the answer and shows citations you can check. Switch to an API when you want more quality or a longer context.',
      filters: [RUNS, PRICE, SPEED, PROVIDER],
      tables: [
        {
          id: 'chat-api',
          title: 'API models: price, intelligence and speed',
          row: { runs: 'api' },
          columns: [...API_HEAD, { key: 'profile', label: 'Profile', type: 'text' }],
          rows: [
            { ref: 'deepseek-flash-max', pick: 'Research Chat', profile: '**Research Chat: speed and tools**' },
            { ref: 'mimo-pro', profile: 'Reasoning and long context' },
            { ref: 'haiku-high', pick: 'Dictionary', profile: '**Dictionary: accuracy for the cost**' },
            { ref: 'haiku-max', profile: 'Smart; slower to start answering' },
            { ref: 'glm-flash', profile: 'Cheap alternative, verbose' },
            { ref: 'luna-max', profile: 'Low-cost reasoning' },
            { ref: 'luna-high', profile: 'Short definitions' },
            { ref: 'mimo-flash', profile: 'Low cost per token' },
            { ref: 'gemini-flash-high', profile: 'Google’s multimodal; higher price' },
            { ref: 'sonnet-max', profile: 'Premium step up, not a default' },
          ],
          footnote: 'USD per million tokens. **AA** is the Artificial Analysis general index, not a Nodus quality measurement. *High* and *Max* settings can spend different amounts of hidden reasoning tokens. Speed is generation **once the answer has started**, not total time. Click a column heading to sort.',
        },
        {
          id: 'chat-local',
          title: 'Local alternatives for both features',
          row: { runs: 'local' },
          flow: {
            lanes: [
              { label: 'How the chat answers', tone: 'accent', steps: ['Your question', 'Retrieval (dense + lexical)', 'Reranking', 'Answer with citations'] },
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
            { name: 'Light', chat: 'Qwen3.5 4B', dictionary: 'Gemma E2B / Phi-4 Mini', retrieval: 'Harrier 270M + GTE Reranker', fit: { mac: 8, gpu: 6 } },
            { name: 'Balanced', pick: 'Balanced pick', chat: '**Qwen3.5 9B**', dictionary: '**Gemma E4B / Qwen3.5 9B**', retrieval: '**Harrier 0.6B or BGE-M3 + Qwen3 Reranker**', fit: { mac: 16, gpu: 12 } },
            { name: 'Advanced', chat: 'Gemma 4 26B-A4B', dictionary: 'Gemma 4 12B', retrieval: 'Harrier / Qwen3 Embedding 4B + reranker', fit: { mac: 32, gpu: 24 } },
            { name: 'Best local quality', chat: 'Qwen3.8 27B / Gemma 4 31B', dictionary: 'Qwen3.8 27B', retrieval: 'Qwen3 Embedding 8B + reranker', fit: { mac: 48, gpu: 32 } },
          ],
          callout: {
            tone: 'info',
            title: 'What a good answer looks like',
            text: 'Never invent a source: return the passage text and its reference. For the Dictionary, cap the length of the answer, lay each entry out as term, senses and context, and keep examples tied to sources when there are any.',
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
      intro: 'Idea Extraction reads your documents and pulls out **new** ideas with their attribution. It runs through an API. Working through many pages, attributing claims and validating passages is a different load from searching ideas you’ve already extracted, which local embeddings and a reranker do well.',
      notes: [{
        tone: 'bad',
        title: 'Local models aren’t recommended here',
        text: 'Use them to search and rerank ideas once they exist, and leave bulk extraction to an API provider.',
      }],
      filters: [PRICE, SPEED, PROVIDER],
      tables: [
        {
          id: 'extraction-api',
          title: 'API candidates, with no winner picked in advance',
          intro: 'This table **doesn’t name a default**. Choose by testing on your own corpus: faithfulness, missed ideas, attribution accuracy and total cost.',
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
            { ref: 'glm-flash', test: 'Verbosity and the real token bill' },
            { ref: 'haiku-max', test: 'What it gains over High' },
          ],
          footnote: 'The estimate is simplified on purpose: every document costs the same input and billable output tokens (reasoning included). No caching, batch pricing, off-peak discounts, retries, format errors or tools, and it doesn’t measure how long each model actually thinks. Change the three numbers above to match your corpus.',
          callout: {
            tone: 'info',
            title: 'Before you set a default',
            text: 'Run 50–100 multilingual articles or chapters. Review by hand the claims each model supports, the ideas it misses, any spurious references and the quality of exact quotations. Then compare **end-to-end** time and dollars per correct idea.',
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
      updated: '2026-10-19',
      title: 'Deep Research + Immersion',
      intro: '**Deep Research** searches in rounds, plans, calls tools, reconciles sources and cites them. **Immersion** explains, keeps a long conversation going and adapts to your level. Both lean on APIs, though local embeddings and search can still do the retrieval underneath.',
      filters: [PRICE, SPEED, PROVIDER],
      tables: [
        {
          id: 'deep-api',
          title: 'Agentic, capable and efficient models',
          row: { runs: 'api' },
          columns: [...API_HEAD, { key: 'research', label: 'Deep Research', type: 'text' }, { key: 'immersion', label: 'Immersion', type: 'text' }],
          rows: [
            { ref: 'deepseek-flash-max', research: '**Balance of tools and price**', immersion: 'Good' },
            { ref: 'mimo-pro', research: 'Demanding research', immersion: 'Good' },
            { ref: 'haiku-high', research: 'Cheap subtasks', immersion: '**Conversation and tutoring**' },
            { ref: 'haiku-max', research: 'Reasoning, with high latency', immersion: 'Complex tutoring' },
            { ref: 'glm-flash', research: 'Synthesis with tools', immersion: 'Good' },
            { ref: 'luna-max', research: 'Narrow subagents', immersion: 'Low-cost tutoring' },
            { ref: 'gemini-flash-high', research: 'Multimodal documents', immersion: 'Good' },
            { ref: 'sonnet-max', research: '**Premium tier**', immersion: 'Premium tier' },
            { ref: 'sol-max', research: '**Premium tier, less verbose**', immersion: 'Premium tier' },
          ],
          callout: {
            tone: 'info',
            title: 'General intelligence isn’t the whole story',
            text: 'For Deep Research in Nodus, count how many searches were relevant, how good the plan was, whether every source can be traced, tool errors, real citations and the **cost of each finished report**. Immersion needs its own tests of how well it teaches.',
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
      updated: '2026-10-19',
      title: 'Decision guide',
      intro: 'One row per Nodus feature: whether it runs locally, a local setup that works, the API to try, and the measure that should settle the choice.',
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
          title: 'Which setup for which feature',
          columns: [
            { key: 'name', label: 'Nodus feature', type: 'name' },
            { key: 'local', label: 'Local?', type: 'verdict' },
            { key: 'localSetup', label: 'Local setup that works', type: 'text' },
            { key: 'api', label: 'API to evaluate', type: 'text' },
            { key: 'measure', label: 'Decide by', type: 'text' },
          ],
          rows: [
            { name: 'Research Chat', href: '#chat', local: 'yes', localSetup: 'Qwen3.5 9B Q4 (16 GB); Qwen3.8 27B (48 GB)', api: 'DeepSeek Flash-1017; Haiku High', measure: 'Grounded answers and total latency' },
            { name: 'Dictionary', href: '#chat', local: 'yes', localSetup: 'Gemma E2B / E4B; Qwen3.5 9B', api: 'Haiku High; Luna High', measure: 'Terminological accuracy and concision' },
            { name: 'Text embeddings', href: '#embeddings', local: 'yes', localSetup: 'Harrier 270M (light) / **Harrier 0.6B** (balanced); BGE-M3 (hybrid)', api: '**Voyage 4** / 4 Lite', measure: 'Recall@10, MRR / nDCG, indexing cost' },
            { name: 'Multimodal embeddings', href: '#embeddings', local: 'yes', localSetup: '**EmbeddingGemma 2**', api: 'Gemini Embedding 2', measure: 'Cross-modal text–image retrieval' },
            { name: 'Retrieving existing ideas', href: '#local', local: 'yes', localSetup: 'BGE-M3 / Harrier + Qwen3 0.6B reranker; Qwen 9B to explain the results', api: 'Voyage 4 + an API LLM, if you like', measure: 'Source accuracy, latency, top-k' },
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
    { term: 'AA intelligence', text: '[Artificial Analysis Intelligence Index v4.3.2](https://artificialanalysis.ai/); higher is better. It compares the general ability of the listed variant and reasoning setting, and **doesn’t measure academic extraction or bibliographic faithfulness**.' },
    { term: 'API speed', text: 'Output tokens per second from the measured provider. It **leaves out some of the upfront reasoning and the wait for the first token**, so don’t read it as documents per second, total cost or local speed. Rounded snapshots.' },
    { term: 'AA cost / task', text: 'A weighted average across the Artificial Analysis tasks. It isn’t the cost of a Nodus request or of extracting one document.' },
    { term: 'MTEB multilingual', text: 'An embeddings benchmark, **not comparable with the AA index**. Its subtasks aren’t historiographical RAG either.' },
    { term: 'Local hardware', text: 'Bands are **estimated**, not measured on a particular Mac or GPU. Context, batch size, offload, drivers and quantisation all move the result, and no local tokens-per-second figure is quoted without a physical test.' },
    { term: 'Licences', text: 'As declared in the repositories consulted. Check the terms, versions and dependencies before distributing a model with anything.' },
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
        { label: 'Artificial Analysis · Claude Sonnet 5.5', url: 'https://artificialanalysis.ai/models/claude-sonnet-5-5' },
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
      ],
    },
  ];

  /* Newest first. One line per review. */
  const changelog = [
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
