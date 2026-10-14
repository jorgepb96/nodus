import {record} from '../../engine/recorder.mjs';import {SHOTS} from './shots.mjs';
import {setup,helpers,withKey} from '../learning-real/common.mjs';
await withKey(()=>record({name:'learning-reader-fix',existingProfile:process.env.NODUS_VIDEO_REUSE_PROFILE,settings:{firstVaultVersion:9999},failFast:true,shots:SHOTS,prepare:async ctx=>{
 await setup(ctx);const h=helpers(ctx);await h.pause();await h.profile('advanced');await h.open('deep-research');await h.click('[data-testid="deep-research-new"]');await ctx.page.keyboard.press('Escape');await h.pause();
},helpers}));
