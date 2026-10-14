import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import path from 'node:path';import os from 'node:os';
const run=promisify(execFile);const root=path.resolve(import.meta.dirname,'../../../..');
const definitions=[
 ['learning-real','learning-real','01-simple','Your first answer with evidence',null,null,'evidence'],
 ['learning-intermediate','learning-first-idea','02-ideas','From a source to a verified idea',null,'authors','graph-result'],
 ['learning-authors','learning-authors','03-authors','Authors and source evidence',null,null,'author-dossier'],
 ['learning-argument-map','learning-argument-map','04-argument-map','Inspect an argument and its evidence',null,null,'map'],
 ['learning-dictionary','learning-dictionary','05-dictionary','Define a concept from your corpus',null,null,'definition'],
 ['learning-research-question','learning-research-question','06-research-question','Investigate a question with evidence',null,null,'research-evidence'],
 ['learning-overview','learning-overview','07-state-of-the-question','Review evidence coverage',null,null,'overview-evidence'],
 ['learning-hypothesis','learning-hypothesis','08-hypotheses','Formulate and assess a hypothesis',null,null,'hypothesis-evidence'],
 ['learning-reading','learning-reading','09-reading-path','Choose and open your next source',null,null,'reading-source'],
 ['learning-deep-research','learning-deep-research','10-deep-research','Run a limited research report',null,null,'deep-open'],
 ['learning-scriptor','learning-scriptor','11-scriptor','Write with source references',null,null,'scriptor-edit'],
 ['learning-interface','learning-interface','12-interface','Interface, appearance, languages, and Nodi',null,null,'theme-options'],
];
const output=path.join(os.homedir(),'Desktop','Nodus_Guided_Tutorials_EN_2026-10-14');await mkdir(output,{recursive:true});
const args=process.argv.slice(2);const selected=definitions.filter(d=>!args.length||args.includes(d[0])||args.includes(d[1]));
const manifest=[];
for(const [parent,deck,file,title,startId,endId,thumbId]of selected){
 const source=path.join(root,'.tutorial-out',parent);const timeline=JSON.parse(await readFile(path.join(source,'timeline.json')));if(timeline.warnings.length)throw new Error(`${parent}: warnings prevent publication`);
 const narration=JSON.parse(await readFile(path.join(source,'narration.json')));const {SHOTS}=await import(`../${parent}/shots.mjs`);
 const start=startId?SHOTS.findIndex(s=>s.id===startId):0;const end=endId?SHOTS.findIndex(s=>s.id===endId):SHOTS.length;const shots=SHOTS.slice(start,end);if(!shots.length)throw new Error('Empty lesson');
 const ids=shots.map(s=>s.id);if(ids.some(id=>!timeline.shots.some(s=>s.id===id)))throw new Error(`${parent}: incomplete recording`);const first=narration.cues.find(c=>c.id===ids[0]);const cues=narration.cues.filter(c=>ids.includes(c.id)).map(c=>({...c,start:c.start-first.start}));const total=cues.at(-1).start+cues.at(-1).duration;
 const dest=path.join(root,'.tutorial-out',deck);await mkdir(dest,{recursive:true});const editedTimeline={...timeline,shots:timeline.shots.filter(s=>ids.includes(s.id)).map(s=>{const original=shots.find(x=>x.id===s.id);const duration=cues.find(c=>c.id===s.id).duration;return s.end-s.start<duration*.99||original?.act&&s.end-s.start>duration*1.1?{...s,narration:duration,timelapse:true,timingAdjustment:'Recorded interaction fitted to narration'}:{...s,narration:duration};})};await writeFile(path.join(dest,'capture-timeline.json'),JSON.stringify(timeline,null,2));await writeFile(path.join(dest,'timeline.json'),JSON.stringify(editedTimeline,null,2));
 if(deck!==parent){
  const moduleDir=path.join(root,'scripts/tutorial/decks',deck);await mkdir(moduleDir,{recursive:true});
  await writeFile(path.join(moduleDir,'shots.mjs'),`import {SHOTS as SOURCE,END_CARD} from '../${parent}/shots.mjs';\nexport {END_CARD};\nexport const TITLE=${JSON.stringify(title)};\nexport const SHOTS=SOURCE.filter(s=>${JSON.stringify(ids)}.includes(s.id));\n`);
  await copyFile(path.join(root,'scripts/tutorial/decks/learning-real/captions.mjs'),path.join(moduleDir,'captions.mjs'));

  await writeFile(path.join(dest,'narration.json'),JSON.stringify({...narration,total,cues},null,2));
  await run('ffmpeg',['-y','-loglevel','error','-ss',String(first.start),'-i',path.join(source,'narration.wav'),'-t',String(total),'-c','copy',path.join(dest,'narration.wav')]);
 }
 const env={...process.env,NODUS_TUTORIAL_MUSIC:path.join(os.homedir(),'Desktop/nodus_visual_identity/Quiet Dashboard Glow.mp3')};
 for(const phase of ['subtitles','assemble','cards']){
  console.log('Processing',file,phase);const r=await run(process.execPath,[path.join(root,`scripts/tutorial/engine/${phase}.mjs`),`--deck=${deck}`],{env,maxBuffer:4000000});console.log(r.stdout);
 }
 const final=path.join(dest,`nodus-tutorial-${deck}-en-final-subtitled.mp4`);const target=path.join(output,`${file}.mp4`);await copyFile(final,target);
 await copyFile(path.join(dest,`subtitles/youtube/nodus-tutorial-${deck}.en.srt`),path.join(output,`${file}.srt`));
 await run('ffmpeg',['-y','-loglevel','error','-i',path.join(dest,'narration.wav'),'-c:a','libmp3lame','-q:a','2',path.join(output,`${file}-narration.mp3`)]);
 const cue=cues.find(c=>c.id===thumbId)??cues.at(-1);const at=5+cue.start+Math.min(2,cue.speech*.55);await run('ffmpeg',['-y','-loglevel','error','-ss',String(at),'-i',target,'-frames:v','1',path.join(output,`${file}.png`)]);
 const info=JSON.parse((await run('ffprobe',['-v','error','-show_format','-show_streams','-of','json',target])).stdout);if(!info.streams.some(s=>s.codec_type==='audio')||!info.streams.some(s=>s.codec_type==='subtitle'))throw new Error('Missing audio/subtitles');
 manifest.push({parent,lesson:deck,title,file:`${file}.mp4`,duration:+info.format.duration,voice:narration.voice,models:narration.model,thumbnailTime:at});
}
await writeFile(path.join(output,`manifest-${args.join('-')||'all'}.json`),JSON.stringify(manifest,null,2));console.log('DELIVERED',output);
