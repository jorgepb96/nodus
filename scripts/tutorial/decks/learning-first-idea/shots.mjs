import {SHOTS as SOURCE,END_CARD} from '../learning-intermediate/shots.mjs';
export {END_CARD};
export const TITLE="From a source to a verified idea";
export const SHOTS=SOURCE.filter(s=>["select","request","upgrade","activate","analysis-setup","cloud","reuse","save-analysis","extract","processing","ideas","idea-evidence","graph","graph-result"].includes(s.id));
