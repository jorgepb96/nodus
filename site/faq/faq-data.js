/*
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

The Nodus FAQ. Each entry is { id, cat, q, a } and `a` is trusted HTML authored here.
Categories must exist in FAQ_CATEGORIES below.
*/
window.FAQ_CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'basics', label: 'Getting started' },
  { id: 'rigor', label: 'Academic rigour' },
  { id: 'ai', label: 'AI & setup' },
  { id: 'features', label: 'Features' },
];

window.FAQ_ENTRIES = [
  {
    "id": "what-is",
    "cat": "basics",
    "q": "What is Nodus?",
    "a": "<p>Nodus is a free, open-source, local-first desktop workspace for the academic community — research, teaching and study. You work in <strong>vaults</strong>, and each vault picks a mode. Nine modes ship today: <strong>Academic</strong> (a research library of ideas and evidence), <strong>Teaching</strong> (classes, assessment and grades), <strong>Study</strong> (your own subjects, materials and revision), <strong>Databases</strong> (your own structured data), <strong>Genealogy</strong> (people reconstructed from records), <strong>Worldbuilding</strong> (a fictional setting and its continuity), <strong>Primary Sources</strong> (archival documents and source criticism), <strong>Testimony</strong> (interviews and oral history) and <strong>Prosopography</strong> (collective biography across scattered sources).</p><p>You can build a library inside Nodus from your own files, or connect a Zotero collection you already keep — neither is required by the other. The engine, the local storage and the settings are shared; the mode only changes which sections appear and how the AI assistant is briefed. Think of it as a <strong>map and workbench for your own corpus</strong>, not a general chatbot or a replacement for reading.</p>"
  },
  {
    "id": "expect",
    "cat": "basics",
    "q": "What should I expect — and not expect — from Nodus?",
    "a": "<p>Expect help with organising a large body of material, locating passages, comparing authors, surfacing contradictions and gaps, planning reading, producing study routes, running analysis over your own data and assembling evidence-backed drafts.</p><p>Do not expect automatic truth, a complete literature review without building the corpus, perfect OCR, flawless page numbers, or a finished argument that no human needs to inspect. Quality depends on your sources, extracted text, chosen model and judgment.</p>"
  },
  {
    "id": "first-steps",
    "cat": "basics",
    "q": "What do I need for a sensible first setup?",
    "a": "<ol><li>Pick the vault mode that matches the work. Every mode is available from the first launch.</li><li>Bring in a small, known set of material — drop your own files straight into Nodus, or connect a <strong>Zotero 7+</strong> collection if you keep one. Zotero is optional, and Nodus reads it locally and never writes back to it. <a href=\"https://www.zotero.org/download/\" target=\"_blank\" rel=\"noopener\">Get Zotero</a>.</li><li>Start small so you can check extraction quality before you scale up.</li><li>Choose either one cloud provider key or a local provider (Ollama / LM Studio).</li><li>Configure an embeddings provider and index the material.</li><li>Open several extracted ideas and compare quote, page and interpretation with the source before going further.</li></ol>"
  },
  {
    "id": "privacy",
    "cat": "basics",
    "q": "Does my library stay private and local?",
    "a": "<p>Your database, extracted text, graph, notes, drafts and downloaded voice models are stored on your machine. Nodus has no account system or telemetry. API keys are encrypted with the operating system’s secure storage.</p><p><strong>Nodus Protect</strong> processes documents locally and never sends them to AI providers or external services.</p><p><strong>If you choose a cloud AI provider for another Nodus feature</strong>, the text required for that request is sent to that provider under its terms. If you use Ollama or LM Studio for text and embeddings, and Piper or Kokoro for voice, those workloads can remain local. Decorative cloud images and Hume voice are optional cloud calls.</p>"
  },
  {
    "id": "write-for-me",
    "cat": "rigor",
    "q": "Can Nodus write for me?",
    "a": "<p class=\"faq-callout\"><strong>No. Nodus must not replace your authorship, reasoning or scholarly responsibility.</strong></p><p>It can organize evidence, suggest an outline, compare positions and generate a provisional draft from selected materials. You must decide the research question, method, argument, interpretation and final wording. Treat generated prose as a proposal to interrogate and rewrite, never as submit-ready text.</p>"
  },
  {
    "id": "verify-everything",
    "cat": "rigor",
    "q": "Why must I verify everything?",
    "a": "<p>Because an AI model can misread a passage, overstate a result, merge distinct concepts, miss a qualification, inherit an OCR error or produce a plausible but incorrect paraphrase. Nodus blocks unsupported source identifiers and makes citations clickable, but that does not make every interpretation true.</p><p><strong>Minimum rigorous workflow:</strong></p><ol><li>Open every substantive citation in Nodus.</li><li>Compare the quotation or paraphrase with the original PDF and edition.</li><li>Check the page, author, year and bibliographic record.</li><li>Look for limitations and counterevidence.</li><li>Rewrite the argument in your own voice and follow your institution’s AI-disclosure rules.</li></ol>"
  },
  {
    "id": "citation-error",
    "cat": "rigor",
    "q": "What should I do if a citation, quotation or interpretation is wrong?",
    "a": "<p>Stop using that claim until you have checked the source. Correct the source metadata or text — in Nodus, or in Zotero if that is where the item lives — repair the idea and its evidence, and regenerate only the affected analysis. OCR errors are especially common in scans.</p><p>Never “fix” a citation by making the prose sound more convincing. The evidence controls the claim, not the other way around. If the source does not support it, remove or qualify it.</p>"
  },
  {
    "id": "publication",
    "cat": "rigor",
    "q": "Can I use Nodus in assessed or published academic work?",
    "a": "<p>Potentially, but the rules come from your university, journal, funder and discipline. Check policies on generative AI, authorship, disclosure, confidentiality and research integrity before use.</p><p>Keep a record of the sources and steps you verified, disclose AI assistance when required, and never send confidential, personal or embargoed material to a cloud provider without authorization. You remain accountable for every submitted sentence and citation.</p>"
  },
  {
    "id": "api-keys",
    "cat": "ai",
    "q": "What is an API key, and do I need one?",
    "a": "<p>An API key is a private credential that lets Nodus call a cloud model using <strong>your</strong> provider account. It is not the same as a ChatGPT, Claude or Gemini web subscription, and API usage may be billed separately.</p><p>You do not need a cloud key if you run compatible text and embedding models through Ollama or LM Studio. For cloud use, one key is enough to begin. OpenAI, Gemini and OpenRouter can also provide embeddings; Anthropic, DeepSeek and Xiaomi MiMo are text providers in Nodus. Hume has a separate, optional key for cloud voice.</p>"
  },
  {
    "id": "get-api-keys",
    "cat": "ai",
    "q": "How do I get each API key supported by Nodus?",
    "a": "<p>Create only the keys you plan to use. In Nodus, open <strong>Settings → Providers</strong>, expand the provider, paste the key, save it, then load models.</p><ul><li><strong>Anthropic:</strong> sign in to the <a href=\"https://console.anthropic.com/settings/keys\" target=\"_blank\" rel=\"noopener\">Anthropic Console</a>, enable API billing if requested, create a key and copy it once. Text generation only in Nodus.</li><li><strong>OpenAI:</strong> open <a href=\"https://platform.openai.com/api-keys\" target=\"_blank\" rel=\"noopener\">API Keys</a>, create a project secret key and add API billing. A ChatGPT subscription does not include API credit. Supports text, embeddings and optional images.</li><li><strong>OpenRouter:</strong> create an account, add credit if needed, then create a key in <a href=\"https://openrouter.ai/settings/keys\" target=\"_blank\" rel=\"noopener\">OpenRouter Keys</a>; you can set a spending limit. It provides many upstream models and can support text, embeddings and images depending on the model.</li><li><strong>DeepSeek:</strong> register on the <a href=\"https://platform.deepseek.com/api_keys\" target=\"_blank\" rel=\"noopener\">DeepSeek Platform</a>, create a key and add balance if required. In Nodus it is for text, not embeddings.</li><li><strong>Google Gemini:</strong> create or view a project key in <a href=\"https://aistudio.google.com/api-keys\" target=\"_blank\" rel=\"noopener\">Google AI Studio</a>. The key belongs to a Google Cloud project; review quota and billing. Supports text, embeddings and optional images.</li><li><strong>Xiaomi MiMo:</strong> sign in to the <a href=\"https://platform.xiaomimimo.com/\" target=\"_blank\" rel=\"noopener\">MiMo Open Platform</a>, open the console, create a dedicated API key and fund the account or token plan if required. Load the current model catalog; obsolete V2 names have moved to V2.5. Text only in Nodus.</li><li><strong>Hume:</strong> follow the <a href=\"https://dev.hume.ai/docs/introduction/api-key\" target=\"_blank\" rel=\"noopener\">Hume API key guide</a> and paste the API key under Audio & Voice. It is optional and only for cloud text-to-speech; the section text is sent to Hume.</li></ul><p>Never paste a key into a document, screenshot, chat or public repository. Revoke and replace it immediately if exposed.</p>"
  },
  {
    "id": "embeddings",
    "cat": "ai",
    "q": "What are embeddings, in plain language?",
    "a": "<p>An embedding turns a piece of text into a long list of numbers that represents its <strong>meaning</strong>. Similar passages end up near one another in that mathematical space even when they use different words.</p><p>Nodus uses embeddings for semantic search, related-idea candidates, theme proximity and graph discovery. They do not write prose and are not a hidden summary. They are a searchable index derived from your text.</p><p>The embedding vectors are stored locally. Creating them uses the embedding provider you selected: cloud providers receive the text being embedded; local providers keep that step on your machine.</p>"
  },
  {
    "id": "embedding-model",
    "cat": "ai",
    "q": "Why is the embeddings model configured separately?",
    "a": "<p>Chat models generate text; embedding models create vectors. Nodus supports embeddings through <strong>OpenAI, Gemini, OpenRouter, Ollama and LM Studio</strong>. Anthropic, DeepSeek and Xiaomi MiMo currently cannot be selected as the embedding provider.</p><p>Use one embedding model consistently. If you change provider, model or vector dimension, the old and new vectors are not comparable, so Nodus marks the index stale and must regenerate it. That takes time and, with a cloud provider, can consume paid tokens.</p><p>Practical local defaults are <code>nomic-embed-text</code> in Ollama and a Nomic embedding model in LM Studio.</p>"
  },
  {
    "id": "local-models",
    "cat": "ai",
    "q": "What are local AI models?",
    "a": "<p>They are downloadable model weights that run on your CPU/GPU instead of a provider’s servers. Nodus connects to them through Ollama or LM Studio. After the model is downloaded, inference can work offline and your prompt stays on the machine running that server.</p><p>Trade-offs: no per-call cloud bill and stronger privacy, but you supply the RAM/VRAM, disk space, electricity and waiting time. Smaller models are faster but make more extraction and reasoning mistakes; large contexts also use more memory.</p>"
  },
  {
    "id": "local-requirements",
    "cat": "ai",
    "q": "What hardware do I need, and which local models are recommended?",
    "a": "<p><strong>Practical baseline for local chat:</strong> 24 GB of unified or system memory, a modern CPU and enough free disk for the model plus working space. A supported GPU or Apple Silicon makes a large difference. 16 GB is enough for local embeddings and search, but not for a grounded research answer: in testing, Gemma 4 E2B Q4 on a 16 GB M2 MacBook Air replied but filled its context almost immediately and was too slow to use. CPU-only operation is possible but slower.</p><ul><li><strong>16 GB or less:</strong> local embeddings and retrieval only; use an API for chat.</li><li><strong>24 GB:</strong> <code>gemma4:e2b</code> or Qwen3.5 4B Q4, with a short context.</li><li><strong>32 GB:</strong> Qwen3.5 9B Q4 or Gemma 4 E4B; the balanced local profile.</li><li><strong>48 GB:</strong> Gemma 4 12B or Gemma 4 26B-A4B.</li><li><strong>64 GB+:</strong> Qwen3.8 27B, Gemma 4 31B or Qwen3.5 35B-A3B.</li></ul><p>See the current <a href=\"https://ollama.com/library/gemma4\" target=\"_blank\" rel=\"noopener\">Gemma 4 variants and download sizes</a>. A model file fitting on disk does not guarantee it fits comfortably in memory, and a precise answer needs room for the embedding model, the retrieved passages and the conversation. The <a href=\"../models/\">model guide</a> explains the minimums in detail.</p>"
  },
  {
    "id": "ollama-setup",
    "cat": "ai",
    "q": "How do I use Ollama with Nodus?",
    "a": "<ol><li><a href=\"https://ollama.com/download\" target=\"_blank\" rel=\"noopener\">Install Ollama</a> and leave it running.</li><li>Open a terminal and download a model, for example <code>ollama pull gemma4:e4b</code>. For local embeddings also run <code>ollama pull nomic-embed-text</code>.</li><li>In Nodus, go to <strong>Settings → Providers → Ollama</strong>. Keep <code>http://localhost:11434</code>, test the connection and load models.</li><li>Mark the desired model as a favorite and select it for the relevant workload. Select Ollama plus <code>nomic-embed-text</code> in Embeddings if you want a fully local semantic index.</li></ol><p>If Ollama is on another computer, use its LAN address only if you understand the network exposure and secure it appropriately.</p>"
  },
  {
    "id": "lmstudio-setup",
    "cat": "ai",
    "q": "How do I use LM Studio with Nodus?",
    "a": "<ol><li><a href=\"https://lmstudio.ai/download\" target=\"_blank\" rel=\"noopener\">Install LM Studio</a> and check its <a href=\"https://lmstudio.ai/docs/app/system-requirements\" target=\"_blank\" rel=\"noopener\">system requirements</a>.</li><li>Use Discover to download a GGUF or MLX instruction model, then load it.</li><li>Open <strong>Developer → Start Server</strong>. The default address is <code>http://localhost:1234</code>.</li><li>In Nodus, open <strong>Settings → Providers → LM Studio</strong>, test the connection and load models.</li><li>For semantic indexing, also load an embedding model and select it in Nodus’s Embeddings settings.</li></ol><p>Do not enable LAN serving or CORS unless needed; if you expose the server beyond localhost, enable authentication and paste its token into Nodus.</p>"
  },
  {
    "id": "deep-research",
    "cat": "features",
    "q": "What is Deep Research in Nodus?",
    "a": "<p>Deep Research is an orchestrated report builder over <strong>your selected corpus</strong>. It plans an outline, writes section by section, tracks coverage, assembles a support matrix and bibliography, and can produce an adaptive 5–20 page report with clickable citations.</p><p>It is not an autonomous systematic review and it does not make your corpus complete. A well-cited report can still misinterpret evidence or omit important literature. Verify every substantive claim and use the result as a research draft, not a final publication.</p>"
  },
  {
    "id": "immersion",
    "cat": "features",
    "q": "What is Immersion mode?",
    "a": "<p>Immersion turns a theme in your corpus into a saved guided learning route: a panorama, sequenced stations with verbatim quotations, contrasts, research frontiers and a final exam. The number and order of stations adapt to the material.</p><p>You can read it or generate narration. It is designed for close study and recall, not as background audio that replaces the sources. Open the cited passages whenever a station matters to your argument.</p>"
  },
  {
    "id": "audio-images",
    "cat": "features",
    "q": "Do audio and decorative images require cloud AI?",
    "a": "<p>No. Piper and Kokoro voices run locally after their model files are downloaded. Hume is an optional cloud voice provider and requires its own key. Decorative images are optional and may use OpenAI, Google or OpenRouter; Nodus asks separately and a failed image never removes the report or immersion.</p><p>Images are illustrative, not evidence. Never treat an AI-generated image as a historical, scientific or documentary source.</p>"
  },
  {
    "id": "teaching-mode",
    "cat": "features",
    "q": "What does Teaching mode cover?",
    "a": "<p>Teaching mode covers academic years, courses, subjects, groups, timetables, calendars, materials, recordings and question banks. You can build weighted analytic rubrics, compose printable exams, publish an assessment plan, and manage grades while keeping <strong>exempt</strong>, <strong>not assessed</strong> and <strong>not submitted</strong> distinct from a numeric zero.</p><p>AI can generate teaching materials, questions and rubric structures, but Nodus never sends rosters, grades or student answers to a model, and never uses AI to grade, profile or evaluate students. That boundary is a design rule, not a setting you can switch off.</p>"
  },
  {
    "id": "appearance",
    "cat": "features",
    "q": "Can I change how Nodus looks?",
    "a": "<p>Yes, from <strong>Settings → Appearance</strong>, which keeps two choices separate. <strong>Colour mode</strong> sets Light, Dark or System, where System follows your operating system. <strong>Colour theme</strong> selects the palette: sixteen built-in ones plus the original <strong>Default</strong>. The palette stays selected when you switch mode, so the same one works in light and dark.</p><p><strong>Create theme</strong> opens an editor for the accent colour, the pale and deep surfaces, the text colour of each mode and the outer app background, with a tint control for how much accent bleeds into the surfaces. It previews the palette on the interface as you work and refuses to save a combination whose text and surfaces are too close in contrast. Your themes sit beside the built-in ones and can be edited or deleted; removing the one in use returns the interface to Default.</p><p>Appearance applies immediately, is stored in your local profile, and never sends vault content anywhere. With a portable profile the selected palette and your custom themes travel to Nodus Server Web as well.</p>"
  }
];
