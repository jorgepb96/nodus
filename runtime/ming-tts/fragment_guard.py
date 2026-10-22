"""Fit Ming fragments into the reference's remaining context; never publish truncation.

The 512 positions contain the reference audio, its transcript, the target text
and the generated latents. A fixed word limit alone cannot bound that sum.
"""
from __future__ import annotations

import math

from ming_text import _semantic_length, _split_fragments


class FragmentContextError(ValueError):
    pass


def subdivide(text):
    """Keep every word and punctuation mark, without adding new sentence endings."""
    pieces = _split_fragments(text, max(1, _semantic_length(text) // 2))
    if len(pieces) < 2:
        # Kana/Hangul are not counted by upstream's Chinese/Latin word counter.
        boundaries = [i for i, char in enumerate(text) if char.isspace()]
        if boundaries:
            middle = min(boundaries, key=lambda i: abs(i - len(text) / 2))
            pieces = [text[:middle].strip(), text[middle:].strip()]
        elif any('\u3040' <= char <= '\u30ff' or '\uac00' <= char <= '\ud7af' for char in text) and len(text) > 1:
            middle = len(text) // 2
            pieces = [text[:middle], text[middle:]]
    if len(pieces) < 2 or not all(pieces):
        raise FragmentContextError('Reference audio and transcript leave too little Ming context. Use a shorter reference recording with its matching transcript.')
    return pieces


def plan_fragments(fragments, decode_budget):
    """Reserve output room before inference; truncated results still require a retry.

    This speech-rate estimate is deliberately conservative, not a completeness
    guarantee. Only the model's natural stop can accept a generated fragment.
    """
    def fit(text):
        units = max(_semantic_length(text), len(text) / 6)
        required = math.ceil(12.5 * (1 + 0.42 * units))
        if decode_budget(text) >= required:
            return [text]
        return [part for piece in subdivide(text) for part in fit(piece)]

    return [part for fragment in fragments for part in fit(fragment)]


def synthesize_complete(text, synthesize, join_audio, depth=0):
    """Retry all the original text in smaller pieces before exposing any audio.

    Concatenating corrected children into one published fragment keeps the
    protocol's indices and total stable. Partial attempts are never playable.
    """
    audio, info = synthesize(text)
    if not info.get('truncated'):
        return audio, info
    if depth >= 8:
        raise FragmentContextError('Ming could not finish a fragment within its context. Use a shorter reference recording with its matching transcript.')
    results = [synthesize_complete(piece, synthesize, join_audio, depth + 1) for piece in subdivide(text)]
    return join_audio([result[0] for result in results]), {
        'steps': sum(result[1]['steps'] for result in results),
        'truncated': False,
        'retries': 1 + sum(result[1].get('retries', 0) for result in results),
    }
