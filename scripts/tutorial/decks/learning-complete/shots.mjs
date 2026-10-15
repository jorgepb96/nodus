import {SHOTS as simple,END_CARD} from '../learning-real/shots.mjs';
import {SHOTS as intermediate} from '../learning-intermediate/shots.mjs';
import {SHOTS as advanced} from '../learning-advanced/shots.mjs';
import {SHOTS as iface} from '../learning-interface/shots.mjs';
export {END_CARD};
export const TITLE='Learn academic research in Nodus';
const prefix=(name,shots)=>shots.map(s=>({...s,id:`${name}-${s.id}`,focus:null}));
export const SHOTS=[
 {id:'illustrated-profiles',say:'The Interface selector contains four illustrated profiles: Simple, Intermediate, Advanced, and Custom.',keepOverlay:true,chapter:'Simple: prepare, ask, and verify',act:async h=>{await h.click('[data-testid="academic-interface-trigger"]');await h.page.locator('.academic-profile-illustration').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));}},
 ...prefix('simple',simple).map((s,i)=>i===0?{...s,act:async h=>{await h.click('[data-testid="academic-profile-simple"]');await simple[0].act(h);}}:s),
 ...prefix('ideas',intermediate.slice(0,14)).map((s,i)=>i===3?{...s,act:async h=>{await intermediate[i].act(h);await h.click('[data-testid="academic-interface-trigger"]');await h.settle(1800);await h.page.getByTestId('academic-interface-picker').getByRole('button',{name:'Close',exact:true}).click();}}:s),
 ...prefix('authors',intermediate.slice(14,17)),
 ...prefix('argument',intermediate.slice(17,20)),
 ...prefix('dictionary',intermediate.slice(20)),
 ...prefix('question',advanced.slice(0,5)),
 ...prefix('overview',advanced.slice(5,11)),
 ...prefix('hypothesis',advanced.slice(11,15)),
 ...prefix('reading',advanced.slice(15,18)),
 ...prefix('deep',advanced.slice(18,26)),
 ...prefix('scriptor',advanced.slice(26)),
 ...prefix('interface',iface),
];
