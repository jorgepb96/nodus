// SPDX-License-Identifier: AGPL-3.0-only
import { t } from '../../i18n';

/** User-facing text for the `TTS_*` codes the narration engine throws. */
const MESSAGES: Record<string, string> = {
  TTS_RUNTIME_NOT_INSTALLED: 'Instala el motor de voz en Ajustes → Modelos → Voz y narración.',
  TTS_MODEL_NOT_DOWNLOADED: 'Descarga un modelo de voz en Ajustes → Modelos → Voz y narración.',
  TTS_MODEL_UNAVAILABLE: 'Este modelo de voz no está disponible.',
  TTS_MODEL_DOWNLOADING: 'El modelo se está descargando; espera a que termine.',
  TTS_MODEL_IN_USE: 'El modelo está en uso. Detén la narración antes de eliminarlo.',
  TTS_INSTALL_BUSY: 'Ya se está instalando el motor de voz.',
  TTS_INSTALL_CANCELLED: 'Instalación cancelada.',
  TTS_INSTALL_FAILED: 'No se pudo instalar el motor de voz. Comprueba la conexión e inténtalo de nuevo.',
  TTS_INSTALL_LOCK_MISSING: 'Falta la lista de dependencias del motor de voz en esta versión de Nodus.',
  TTS_INSTALL_VERIFY_FAILED: 'El motor de voz se instaló pero no arranca. Prueba a repararlo.',
  TTS_INSTALL_DOWNLOAD_FAILED: 'No se pudo descargar Python para el motor de voz.',
  TTS_INSTALL_INTEGRITY_FAILED: 'La descarga de Python no superó la verificación de integridad.',
  TTS_INSTALL_PLATFORM_UNSUPPORTED: 'Este sistema no es compatible con la narración local.',
  TTS_ENGINE_SPAWN_FAILED: 'No se pudo iniciar el motor de voz.',
  TTS_ENGINE_CRASHED: 'El motor de voz se cerró inesperadamente.',
  TTS_ENGINE_TIMEOUT: 'El motor de voz tardó demasiado en responder.',
  TTS_SYNTH_FAILED: 'No se pudo generar el audio.',
  TTS_EMPTY_TEXT: 'No hay texto que narrar.',
  TTS_VOICE_NOT_FOUND: 'La voz elegida ya no existe. Elige otra en Ajustes.',
  TTS_VOICE_CONSENT_REQUIRED: 'Confirma que la voz es tuya o que tienes permiso para usarla.',
  TTS_VOICE_INVALID: 'Faltan el nombre o la transcripción de la voz.',
  TTS_VOICE_TRANSCRIPT_TOO_SHORT: 'La transcripción es demasiado corta para el audio. Escribe exactamente lo que se dice en la grabación.',
  TTS_VOICE_TOO_LARGE: 'La grabación es demasiado grande.',
  TTS_VOICE_BAD_AUDIO: 'La grabación no tiene un formato válido.',
  TTS_VOICE_BAD_LENGTH: 'La grabación debe durar entre 3 y 30 segundos.',
  TTS_VOICE_READ_ONLY: 'Esta voz no se puede modificar.',
  TTS_LICENSE_NOT_ACCEPTED: 'Acepta la licencia de uso no comercial del modelo antes de descargarlo.',
  TTS_HF_TOKEN_REQUIRED: 'Este modelo está restringido: acepta sus términos en Hugging Face y guarda un token en Ajustes → Modelos → Voz y narración.',
  TTS_VOICE_ENGINE_MISMATCH: 'La voz elegida no sirve para este modelo. Elige una voz del modelo en el selector.',
};

export function ttsErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const code = /TTS_[A-Z_]+/.exec(raw)?.[0];
  return code && MESSAGES[code] ? t(MESSAGES[code]) : raw;
}
