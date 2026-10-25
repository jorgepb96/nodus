// Opt-in real CPU integration campaign. Uses an isolated profile and never changes the source WAV.
// NODUS_POCKET_PYTHON: Python with huggingface_hub and an authorized HF credential.
// NODUS_POCKET_REFERENCE: a WAV the user authorized for cloning.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-pocket-live')) process.exit(0);
const python = process.env.NODUS_POCKET_PYTHON;
const reference = process.env.NODUS_POCKET_REFERENCE;
assert.ok(python && reference, 'Set NODUS_POCKET_PYTHON and NODUS_POCKET_REFERENCE explicitly.');
const root = process.env.NODUS_POCKET_QA_ROOT || await fs.mkdtemp(path.join(os.tmpdir(), 'nodus-pocket-live-'));
await fs.mkdir(root, {recursive:true,mode:0o700});
console.log('Isolated QA profile:',root);
const require = createRequire(import.meta.url);
installRuntimeHooks(root);
const load = file => require(path.join(repoRoot,file));
const token = execFileSync(python,['-c','from huggingface_hub import get_token; print(get_token() or "")'],{encoding:'utf8'}).trim();
assert.ok(token,'No HF token configured');
// Credential injection stays in memory: no QA token is written to disk or logs.
load('electron/secrets/secretStore.ts').getAudioKey = name => name === 'huggingface' ? token : null;
const vaults = load('electron/vaults/vaultRegistry.ts');
const vault = vaults.createVault('Pocket TTS live QA'); vaults.setActiveVault(vault.id);
const {updateSettings} = load('electron/db/settingsRepo.ts');
const {POCKET_MODEL_ID,POCKET_LANGUAGES,POCKET_DEFAULT_VOICES,POCKET_VOICES} = load('shared/pocketTts.ts');
const {ttsService,TtsService} = load('electron/tts/service.ts');
let service = ttsService();
const summary = {reference:path.basename(reference),root,checks:[],clips:[],languages:[]};
let browser;
let off;
const check = (name,details={}) => { summary.checks.push({name,...details});console.log('PASS',name,JSON.stringify(details)); };
try {
 updateSettings({ttsModelId:POCKET_MODEL_ID,ttsLanguage:'auto',ttsPocketVoiceId:'pocket:lola'});
 let phase;
 off=service.onEvent(e=>{if(e.kind==='install'&&phase!==e.phase){phase=e.phase;console.log('Runtime:',e.phase);}});
 await service.installRuntime('pocket');off();off=null;
 assert.equal((await service.status()).pocketRuntime.device,'cpu');check('real runtime install and self-check');
 let cancelled=false;
 off=service.onEvent(e=>{if(e.kind==='model'&&e.status.id===POCKET_MODEL_ID&&e.status.downloadedBytes>5_000_000&&!cancelled){cancelled=true;service.models.cancel(POCKET_MODEL_ID);}});
 try { await service.downloadModel(POCKET_MODEL_ID); } catch(e) { if(!cancelled)throw e; }
 off();off=null;
 if(cancelled){assert.equal((await service.status()).models.find(m=>m.id===POCKET_MODEL_ID).downloaded,false);check('cancelled model is not marked ready');}
 await service.downloadModel(POCKET_MODEL_ID);
 assert.ok((await service.status()).models.find(m=>m.id===POCKET_MODEL_ID).downloaded);check('full gated model download and verified resume',{languages:7});
 await service.downloadModel(POCKET_MODEL_ID);check('repeat verified model download');
 const bundle=await build({entryPoints:[path.join(repoRoot,'src/lib/narration/voiceAudio.ts')],bundle:true,format:'iife',globalName:'ReferenceAudio',write:false});
 browser=await chromium.launch({executablePath:process.env.NODUS_QA_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage();await page.addScriptTag({content:bundle.outputFiles[0].text});
 const source=await fs.readFile(reference);
 const prepared=await page.evaluate(async bytes=>{const p=await ReferenceAudio.prepareReferenceAudio(new Blob([new Uint8Array(bytes)],{type:'audio/wav'}));return {wav:Array.from(p.wav),durationS:p.durationS,peak:p.peak};},Array.from(source));
 const voice=await service.saveVoice({name:'Pocket QA reference',language:'es',engine:'pocket',transcript:'',origin:'uploaded',consent:true,wav:new Uint8Array(prepared.wav)});
 updateSettings({ttsPocketVoiceId:voice.id});check('real browser audio preparation and persisted voice',{durationS:prepared.durationS,voiceId:voice.id});
 async function speak(text,voiceId,language='es',save=true) {
  const events=[];const off=service.onEvent(e=>{if(e.kind==='job')events.push(e);});
  const start=await service.speak({text,voiceId,language,save:save?{kind:'dictionary_entry',id:'pocket-live-qa',segmentIndex:summary.clips.length,segmentLabel:'Pocket live QA'}:undefined});
  const deadline=Date.now()+180_000;
  try{
   while(Date.now()<deadline){const end=events.find(e=>e.progress.jobId===start.jobId&&['done','error','cancelled'].includes(e.progress.state));if(end){assert.equal(end.progress.state,'done',JSON.stringify(end.progress));if(save){assert.ok(end.clip);assert.equal(end.clip.provider,'pocket');summary.clips.push(end.clip);}return end;}await new Promise(r=>setTimeout(r,100));}
   throw new Error('TTS job deadline exceeded');
  }finally{off();}
 }
 const clone=await speak('Esta es una prueba de clonación de voz en Nodus. La grabación de referencia se procesa en este equipo y la voz queda guardada para volver a utilizarla.',voice.id);
 check('real reference cloning and persisted WAV/SQLite clip',{audioS:clone.progress.audioS,genS:clone.progress.genS});
 const {audioFilePath}=load('electron/audio/audioPaths.ts');
 const clip=summary.clips[0];const wav=await fs.readFile(audioFilePath(clip.fileName));
 const playback=await page.evaluate(async bytes=>{const data=new Uint8Array(bytes);const context=new AudioContext();const decoded=await context.decodeAudioData(data.buffer.slice(0));const audio=new Audio(URL.createObjectURL(new Blob([data],{type:'audio/wav'})));audio.muted=true;audio.playbackRate=16;await audio.play();await new Promise((resolve,reject)=>{audio.onended=resolve;audio.onerror=reject;});await context.close();return {duration:decoded.duration,rate:decoded.sampleRate};},Array.from(wav));
 check('browser decodes and plays saved clone clip',playback);
 const {ref}=await service.voices.resolve(voice.id);
 const cacheBefore=await fs.readdir(ref.cacheDir);const cacheFile=cacheBefore.find(n=>n.startsWith('pocket-es-'));assert.ok(cacheFile);
 const cacheStamp=(await fs.stat(path.join(ref.cacheDir,cacheFile))).mtimeMs;
 await service.unload();
 service=new TtsService();assert.ok((await service.voices.list()).some(v=>v.id===voice.id));
 await speak('La voz personalizada se reutiliza después de reiniciar el motor, sin volver a codificar la referencia.',voice.id);
 assert.equal((await fs.stat(path.join(ref.cacheDir,cacheFile))).mtimeMs,cacheStamp);check('new service/process reuses persisted clone cache');
 for(const language of POCKET_LANGUAGES){
  const text={es:'Hola, esta es la voz predeterminada en español.',en:'Hello, this is the default English voice.',fr:'Bonjour, voici la voix française.',de:'Hallo, das ist die deutsche Stimme.',it:'Ciao, questa è la voce italiana.',pt:'Olá, esta é a voz em português.',nl:'Hallo, dit is de Nederlandse stem.'}[language];
  const end=await speak(text,`pocket:${POCKET_DEFAULT_VOICES[language]}`,language);
  summary.languages.push({language,audioS:end.progress.audioS,genS:end.progress.genS});check('native default '+language,summary.languages.at(-1));
 }
 for(const v of POCKET_VOICES)await service.downloadVoice(`pocket:${v.id}`);
 assert.equal((await service.voices.list()).filter(v=>v.origin==='pocket'&&v.downloaded).length,27);check('all 27 named official voice downloads');
 await speak('This is an optional official voice.', 'pocket:anna','en');check('optional official voice synthesis');
 const job=await service.speak({text:'Esta frase se repite para probar la cancelación de una narración larga. '.repeat(80),voiceId:voice.id,language:'es'});
 const cancelledJob=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{stop();reject(new Error('Cancel timeout'));},30_000);const stop=service.onEvent(e=>{if(e.kind==='job'&&e.progress.jobId===job.jobId&&e.progress.state==='cancelled'){clearTimeout(timer);stop();resolve();}});});
 await new Promise(resolve=>setTimeout(resolve,1000));service.cancel(job.jobId);await cancelledJob;check('real job cancellation');
 await service.unload();
 const repo=load('electron/db/audioClipsRepo.ts');assert.ok(repo.listAudioClips('dictionary_entry','pocket-live-qa').length>=9);check('clip metadata and playback files persist');
 await service.voices.remove(voice.id);assert.ok(!(await service.voices.list()).some(v=>v.id===voice.id));check('custom voice deletion');
 await service.deleteModel(POCKET_MODEL_ID);assert.equal((await service.status()).models.find(m=>m.id===POCKET_MODEL_ID).downloaded,false);check('model deletion');
 await service.removeRuntime('pocket');assert.equal((await service.status()).pocketRuntime.installed,false);check('runtime removal');
 summary.success=true;
} finally {
 off?.();service.killSync();await browser?.close();
 await fs.writeFile(path.join(root,'verification.json'),JSON.stringify(summary,null,2));
 load('electron/db/database.ts').closeDb();
}
console.log('Full campaign passed; results:',path.join(root,'verification.json'));
