import {readFile,writeFile} from 'node:fs/promises';import path from 'node:path';import {SHOTS} from './shots.mjs';
const root=path.resolve(import.meta.dirname,'../../../..'),out=path.join(root,'.tutorial-out/learning-complete');
const parts=[['learning-complete','progress.json','simple-enqueue'],['learning-complete-continuation','progress.json','dictionary-definition-wait'],['learning-complete-final','progress.json','question-advanced'],['learning-complete-research','timeline.json',null]];
let offset=0,shots=[],frames=[];let base;
for(const [deck,file,through]of parts){const input=JSON.parse(await readFile(path.join(root,'.tutorial-out',deck,file)));if(input.warnings.length)throw new Error(`${deck}: unverified recording`);base??=input;const end=through?input.shots.findIndex(s=>s.id===through)+1:input.shots.length;if(!end)throw new Error(`${deck}: missing boundary`);const selected=input.shots.slice(0,end);const stop=selected.at(-1).end;shots.push(...selected.map(s=>({...s,start:s.start+offset,end:s.end+offset})));frames.push(...input.frames.filter(f=>f.t<=stop).map(f=>({...f,t:f.t+offset})));offset+=stop+.02;}
const polished=JSON.parse(await readFile(path.join(root,'.tutorial-out/learning-complete-polish/timeline.json')));
if(polished.warnings.length)throw new Error('Polished captures contain warnings');
const replacements=new Map(polished.shots.map(s=>[s.id,{shot:s,frames:polished.frames}]));
const writing=JSON.parse(await readFile(path.join(root,'.tutorial-out/learning-complete-writing/timeline.json')));if(writing.warnings.length)throw new Error('Writing capture contains warnings');for(const shot of writing.shots)replacements.set(shot.id,{shot,frames:writing.frames});
// Bounded corrections reuse all untouched captures. The partial take contains
// only completed checkpoints; its failed final attempt is never included.
for(const [deck,file,count] of [['learning-balloon-fix','progress.json',10],['learning-entry-fix','timeline.json',2],['learning-reader-fix','timeline.json',2]]){
 const corrected=JSON.parse(await readFile(path.join(root,'.tutorial-out',deck,file)));
 if(corrected.warnings.length||corrected.shots.length!==count)throw new Error(`${deck}: correction is incomplete`);
 for(const shot of corrected.shots)replacements.set(shot.id,{shot,frames:corrected.frames});
}
const oldFrames=frames;let nextOffset=0;const nextFrames=[];
shots=shots.map(original=>{
 const replacement=replacements.get(original.id),shot=replacement?.shot??original,pool=replacement?.frames??oldFrames;
 const before=[...pool].reverse().find(f=>f.t<=shot.start)??pool[0];
 const selected=[before,...pool.filter(f=>f.t>shot.start&&f.t<shot.end)];
 nextFrames.push(...selected.map(f=>({...f,t:nextOffset+Math.max(0,f.t-shot.start)})));
 const result={...shot,start:nextOffset,end:nextOffset+shot.end-shot.start};nextOffset=result.end+.02;return result;
});frames=nextFrames;offset=nextOffset;
if(shots.length!==SHOTS.length||shots.some((s,i)=>s.id!==SHOTS[i].id))throw new Error('The recording does not contain every lesson in order');
await writeFile(path.join(out,'timeline.json'),JSON.stringify({...base,shots,frames,duration:offset,warnings:[],sourceTakes:parts},null,2));console.log('Merged verified captures',shots.length,'shots',frames.length,'frames');
