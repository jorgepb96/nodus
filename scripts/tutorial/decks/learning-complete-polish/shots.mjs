import {SHOTS as all,TITLE,END_CARD} from '../learning-complete/shots.mjs';export {TITLE,END_CARD};export const SHOTS=all.filter(s=>s.id.startsWith('authors-')||s.id.startsWith('interface-'));
