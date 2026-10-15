import {record} from '../../engine/recorder.mjs';import {SHOTS} from './shots.mjs';import {setup,helpers,withKey} from '../learning-real/common.mjs';
const dry=process.argv.includes('--dry');const dryShots=SHOTS.filter(s=>['advanced','hypothesis','reading','reading-one','deep','deep-question','deep-scope','deep-options'].includes(s.id));
await withKey(()=>record({failFast:true,name:'learning-advanced',masterProfile:process.env.NODUS_VIDEO_MASTER,settings:{firstVaultVersion:9999},shots:dry?dryShots:SHOTS,prepare:ctx=>setup(ctx,{paid:!dry,master:true}),helpers}));
