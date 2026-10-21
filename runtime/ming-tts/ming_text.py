"""Text side of the Ming-3.0 request: fragments, prompt and built-in voices.

Both backends split text with this module, so a narration produces the same
fragments, and therefore the same files, whichever backend speaks it.

``_semantic_length``, ``_add_period`` and ``_split_fragments`` are copied
verbatim from mlx-audio's ``mlx_audio/tts/models/bailingmm/bailingmm.py``
(MIT, Copyright (c) 2024 Prince Canuma; vendored in ``mlx_ming3/`` at the
commit named in ``mlx_ming3/NODUS_VENDOR.md``). The protocol test checks that
the copies still match the vendored module token for token. No text
normalization runs here: Ming's FST normalizer needs pynini, which Nodus does
not ship.

Only the standard library is imported, so the protocol layer can run without
any model stack installed.
"""
from __future__ import annotations

import json
import re
from typing import List, Optional

# Fragment size in "semantic units": one per Chinese character or English word.
MING3_MAX_FRAGMENT_LENGTH = 50

DEFAULT_TTS_PROMPT = "Please generate speech based on the following description.\n"

# Ming-3.0 adds a "Target language:" line only for the languages beyond zh/en.
TARGET_LANGUAGES = {
    "ja": "Japanese",
    "ko": "Korean",
    "de": "German",
    "fr": "French",
    "es": "Spanish",
}
LANGUAGES = ("es", "en", "zh", "fr", "de", "ja", "ko")

# Built-in voice names: "US_James"-style English voices and Chinese names
# such as "灵小柔" or "灵信远_高兴" (same pattern as mlx-audio).
BUILTIN_VOICE_RE = re.compile(
    r"^(?:(?:US|UK)_[A-Z][a-z]+|[一-鿿][一-鿿_]*)$"
)

_CJK_RE = re.compile(r"[一-鿿]")


def _semantic_length(text: str) -> int:
    return len(re.findall(r"[一-龥]", text)) + len(re.findall(r"[a-zA-Z]+", text))


def _add_period(text: str) -> str:
    text = text.rstrip()
    if not text:
        return text
    period = "。" if _CJK_RE.search(text) else "."
    if text[-1] in ",，、;；":
        return text[:-1] + period
    if text[-1].isalnum():
        return text + period
    return text


def _split_fragments(text: str, max_length: int) -> List[str]:
    """Split text into sentence-aligned fragments of at most ``max_length``.

    A simplified version of Ming-3.0's ``cut_text_by_semantic_length``: whole
    sentences are packed together, and a sentence that is too long on its own
    is split at commas, then at words or Chinese characters for long clauses.
    """
    if max_length <= 0:
        raise ValueError("max_length must be positive")
    text = " ".join(text.split())
    if _semantic_length(text) <= max_length:
        return [text]

    # Pieces keep their trailing whitespace, so joining them restores the
    # text exactly. ASCII punctuation only ends a piece before whitespace,
    # which keeps "3.14", "1,000", "U.S." and "..." intact.
    sentence_re = re.compile(r".*?(?:[。！？]|[.!?](?=\s)|$)\s*")
    clause_re = re.compile(r".*?(?:[，；、]|[,;](?=\s)|$)\s*")
    # Keep tags and non-Chinese words intact, including numbers and abbreviations.
    word_re = re.compile(r"\[[^\]]*\]|[一-龥]|[^\s一-龥]+|\s+")

    def units(pattern: re.Pattern, value: str) -> List[str]:
        return [m.group(0) for m in pattern.finditer(value) if m.group(0)]

    def pack(pieces: List[str]) -> List[str]:
        out, cur = [], ""
        for piece in pieces:
            if cur and _semantic_length(cur + piece) > max_length:
                out.append(cur)
                cur = piece
            else:
                cur += piece
        if cur:
            out.append(cur)
        return out

    pieces = []
    for sentence in units(sentence_re, text):
        if _semantic_length(sentence) <= max_length:
            pieces.append(sentence)
        else:
            for clause in units(clause_re, sentence):
                if _semantic_length(clause) > max_length:
                    pieces.extend(pack(word_re.findall(clause)))
                else:
                    pieces.append(clause)
    return [f.strip() for f in pack(pieces) if f.strip()]


def split_fragments(text: str, max_length: int = MING3_MAX_FRAGMENT_LENGTH) -> List[str]:
    """The fragments mlx-audio's ``generate`` would synthesize for ``text``."""
    return _split_fragments(_add_period(text), max_length)


def tts_prompt(lang: Optional[str]) -> str:
    language = TARGET_LANGUAGES.get(str(lang or "").strip().lower())
    if language:
        return DEFAULT_TTS_PROMPT + f"Target language: {language}.\n"
    return DEFAULT_TTS_PROMPT


def builtin_voice_instruction(name: str) -> str:
    """The IP caption for a built-in voice (zh schema, trained key order).

    Same JSON as mlx-audio's ``ming3_instruction(ip=name)`` and the official
    ``tts_tasks.build_structured_instruction(ip=name)``.
    """
    if not BUILTIN_VOICE_RE.match(str(name or "")):
        raise ValueError(f"unknown built-in voice: {name!r}")
    fields = ("序号", "说话人", "方言", "风格", "语速", "基频", "音量", "情感")
    values = (1, "speaker_1", None, None, None, None, None, None)
    item = dict(zip(fields, values))
    item["BGM"] = {key: None for key in ("Genre", "Mood", "Instrument", "Theme", "ENV", "SNR")}
    item["IP"] = name
    return json.dumps({"audio_sequence": [item]}, ensure_ascii=False)
