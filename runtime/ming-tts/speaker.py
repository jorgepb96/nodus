"""CAM++ speaker embedding (192-dim) for Ming-3.0 voice cloning.

The official runtime (``ming_official/spkemb_extractor.py``) feeds Kaldi
fbank features of the 16 kHz prompt into ``campplus.onnx`` through
onnxruntime. torchaudio is not available on the MLX stack, so ``kaldi_fbank``
reimplements ``torchaudio.compliance.kaldi.fbank`` with the arguments the
official extractor uses (80 bins, dither 0, every other option at its
default) in NumPy; the protocol README records how far the two agree.
"""
from __future__ import annotations

import math

import numpy as np

SAMPLE_RATE = 16000
EMBEDDING_DIM = 192


def _mel(freq):
    return 1127.0 * np.log(1.0 + np.asarray(freq, dtype=np.float64) / 700.0)


def _mel_banks(num_bins: int, padded_window: int, sample_rate: int, low_freq: float = 20.0, high_freq: float = 0.0) -> np.ndarray:
    nyquist = 0.5 * sample_rate
    if high_freq <= 0.0:
        high_freq += nyquist
    num_fft_bins = padded_window // 2
    fft_bin_width = sample_rate / padded_window
    mel_low, mel_high = _mel(low_freq), _mel(high_freq)
    delta = (mel_high - mel_low) / (num_bins + 1)
    b = np.arange(num_bins, dtype=np.float64)[:, None]
    left = mel_low + b * delta
    center = mel_low + (b + 1.0) * delta
    right = mel_low + (b + 2.0) * delta
    mel = _mel(fft_bin_width * np.arange(num_fft_bins, dtype=np.float64))[None, :]
    up = (mel - left) / (center - left)
    down = (right - mel) / (right - center)
    banks = np.maximum(0.0, np.minimum(up, down))
    # The Nyquist bin gets no weight, as in Kaldi and torchaudio.
    return np.pad(banks, ((0, 0), (0, 1))).astype(np.float32)


def kaldi_fbank(waveform: np.ndarray, num_mel_bins: int = 80, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """``torchaudio.compliance.kaldi.fbank(w, num_mel_bins=80, dither=0)``."""
    x = np.asarray(waveform, dtype=np.float32).reshape(-1)
    window = int(sample_rate * 0.025)
    shift = int(sample_rate * 0.010)
    if x.shape[0] < window:
        raise ValueError("speaker prompt is shorter than one 25 ms frame")
    frames = 1 + (x.shape[0] - window) // shift  # snip_edges=True
    index = np.arange(window)[None, :] + shift * np.arange(frames)[:, None]
    strided = x[index]
    strided = strided - strided.mean(axis=1, keepdims=True)  # remove_dc_offset
    previous = np.concatenate([strided[:, :1], strided[:, :-1]], axis=1)
    strided = strided - np.float32(0.97) * previous  # preemphasis, replicate pad
    n = np.arange(window, dtype=np.float64)
    povey = np.power(0.5 - 0.5 * np.cos(2.0 * math.pi * n / (window - 1)), 0.85).astype(np.float32)
    strided = strided * povey
    padded = 1 << (window - 1).bit_length()  # round_to_power_of_two
    spectrum = np.abs(np.fft.rfft(strided, n=padded, axis=1)).astype(np.float32) ** 2
    energies = spectrum @ _mel_banks(num_mel_bins, padded, sample_rate).T
    return np.log(np.maximum(energies, np.finfo(np.float32).eps)).astype(np.float32)


class CamPlusPlus:
    """``campplus.onnx`` on the CPU, two threads, as the official extractor."""

    def __init__(self, onnx_path: str):
        import onnxruntime

        options = onnxruntime.SessionOptions()
        options.graph_optimization_level = onnxruntime.GraphOptimizationLevel.ORT_ENABLE_ALL
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        options.log_severity_level = 3
        self.session = onnxruntime.InferenceSession(onnx_path, sess_options=options, providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name

    def embed(self, waveform_16k: np.ndarray) -> np.ndarray:
        feat = kaldi_fbank(waveform_16k)
        feat = feat - feat.mean(axis=0, keepdims=True)
        out = self.session.run(None, {self.input_name: feat[None, :, :]})[0]
        emb = np.asarray(out, dtype=np.float32).reshape(-1)
        if emb.shape[0] != EMBEDDING_DIM:
            raise ValueError(f"campplus returned {emb.shape[0]} values, expected {EMBEDDING_DIM}")
        return emb
