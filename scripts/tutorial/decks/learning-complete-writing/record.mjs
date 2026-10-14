import {record} from '../../engine/recorder.mjs';import {SHOTS} from './shots.mjs';import {setup,helpers,withKey} from '../learning-real/common.mjs';
await withKey(()=>record({name:'learning-complete-writing',existingProfile:process.env.NODUS_VIDEO_REUSE_PROFILE,settings:{firstVaultVersion:9999},failFast:true,shots:SHOTS,prepare:ctx=>setup(ctx),helpers}));
