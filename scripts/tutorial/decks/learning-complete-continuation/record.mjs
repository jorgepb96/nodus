import {record} from '../../engine/recorder.mjs';import {SHOTS} from './shots.mjs';import {setup,helpers,withKey} from '../learning-real/common.mjs';
await withKey(()=>record({name:'learning-complete-continuation',masterProfile:process.env.NODUS_VIDEO_MASTER,settings:{firstVaultVersion:9999},failFast:true,shots:SHOTS,prepare:ctx=>setup(ctx,{master:true,paid:true}),helpers}));
