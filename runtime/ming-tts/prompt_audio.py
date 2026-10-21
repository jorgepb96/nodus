"""Reference-clip preparation shared by both backends.

Ming-3.0 continues from the tail of the reference: its last latent seeds the
latent history of the first decode step. A clip that ends in silence therefore
asks the model to keep being silent, and it often does. Measured with a 9 s
reference ending in 1.4 s of digital silence, no speaker embedding: two of
three seeds produced a silent fragment on MLX, and the official torch code
behaved the same; with the tail cut to 0.15 s, three of three spoke. Leading
silence is harmless to the model but spends context, so it is cut too.
"""
from __future__ import annotations

import numpy as np

FRAME_S = 0.02
KEEP_LEAD_S = 0.10
KEEP_TAIL_S = 0.15
# A frame is sound when its mean level reaches this fraction of the loudest
# frame's; low enough to keep breaths and soft word endings.
RELATIVE_THRESHOLD = 0.03
ABSOLUTE_FLOOR = 1e-4


def trim_silence(audio: np.ndarray, sample_rate: int):
    """Cut leading and trailing silence, keeping short margins.

    Returns the trimmed clip and the seconds removed. A clip with no sound at
    all is returned unchanged.
    """
    audio = np.asarray(audio, dtype=np.float32).reshape(-1)
    frame = max(1, int(sample_rate * FRAME_S))
    count = audio.shape[0] // frame
    if count < 2:
        return audio, 0.0
    level = np.abs(audio[: count * frame]).reshape(count, frame).mean(axis=1)
    loud = np.nonzero(level >= max(level.max() * RELATIVE_THRESHOLD, ABSOLUTE_FLOOR))[0]
    if loud.size == 0:
        return audio, 0.0
    start = max(0, int(loud[0]) * frame - int(sample_rate * KEEP_LEAD_S))
    end = min(audio.shape[0], (int(loud[-1]) + 1) * frame + int(sample_rate * KEEP_TAIL_S))
    return audio[start:end], (audio.shape[0] - (end - start)) / float(sample_rate)
