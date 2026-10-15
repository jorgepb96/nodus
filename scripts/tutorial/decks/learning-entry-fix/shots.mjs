import {SHOTS as all,TITLE,END_CARD} from '../learning-complete/shots.mjs';
import {SHOTS as simple} from '../learning-real/shots.mjs';
export {TITLE,END_CARD};
// Reuse the opening explanation, with the library already rendered before capture.
export const SHOTS=all.filter(s=>['simple-simple','simple-guide'].includes(s.id)).map(s=>s.id==='simple-simple'?{...s,act:simple[0].act}:s);
