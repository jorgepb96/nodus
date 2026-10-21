# Nodus: package wrapper for the vendored mlx-audio Ming-3.0 module (see
# NODUS_VENDOR.md). It stands in for ``mlx_audio.tts.models.bailingmm``, so it
# exports what mlx-audio's loader looks up there.
from . import bailingmm
from .bailingmm import Model, ModelConfig

__all__ = ["Model", "ModelConfig", "bailingmm"]
