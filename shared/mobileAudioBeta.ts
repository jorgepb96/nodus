/** Embedded mobile beta capabilities; Desktop synthesis remains unchanged. */
export const MOBILE_AUDIO_CAPABILITIES = Object.freeze({ audioGeneration: false as const });
const synthesisMethods = new Set(['getAudioSegments', 'saveAudioClip', 'humeSynthesize', 'generateAudio', 'generateSpeech', 'synthesizeAudio', 'generateNarration', 'ttsSpeak', 'ttsLoad', 'ttsInstallRuntime', 'ttsDownloadModel', 'ttsDownloadVoice', 'ttsSaveVoice']);
export function requireMobileAudioMethod(method: string): void {
  if (!MOBILE_AUDIO_CAPABILITIES.audioGeneration && synthesisMethods.has(method)) {
    throw new Error('mobile_audio_generation_deferred');
  }
}
