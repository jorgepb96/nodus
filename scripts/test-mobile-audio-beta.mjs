import assert from 'node:assert/strict';
import test from 'node:test';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const dir=mkdtempSync(path.join(tmpdir(),'nodus-audio-beta-'));
try {
  buildSync({entryPoints:['shared/mobileAudioBeta.ts'],outfile:path.join(dir,'policy.cjs'),bundle:true,platform:'node',format:'cjs'});
  const policy=createRequire(import.meta.url)(path.join(dir,'policy.cjs'));
  test('mobile beta rejects synthesis and generated persistence while preserving saved playback',()=>{
    assert.equal(policy.MOBILE_AUDIO_CAPABILITIES.audioGeneration,false);
    for(const method of ['getAudioSegments','saveAudioClip','humeSynthesize','generateAudio','generateSpeech','synthesizeAudio','generateNarration','ttsSpeak','ttsLoad','ttsInstallRuntime','ttsDownloadModel','ttsDownloadVoice','ttsSaveVoice'])assert.throws(()=>policy.requireMobileAudioMethod(method),/mobile_audio_generation_deferred/);
    for(const method of ['listAudioClips','openSavedAudioClip','getAudioClipDataUrl','exportAudioClip','listStudyAudioBookmarks','getStudyRecording','getTestimonyMedia'])assert.doesNotThrow(()=>policy.requireMobileAudioMethod(method));
  });
} finally {rmSync(dir,{recursive:true,force:true});}
