import {record} from '../../engine/recorder.mjs';
import {SHOTS} from './shots.mjs';
import {setup,helpers,withKey,question} from '../learning-real/common.mjs';
await withKey(()=>record({name:'learning-balloon-fix',existingProfile:process.env.NODUS_VIDEO_REUSE_PROFILE,settings:{firstVaultVersion:9999},failFast:true,shots:SHOTS,prepare:async ctx=>{
 await setup(ctx,{paid:true});const h=helpers(ctx);await h.pause();await h.profile('simple');
 await ctx.page.locator('[data-tour="nav-library"]').click();await ctx.page.getByTestId('library-vault-add-files').waitFor();await h.open('first-answer');await h.selectSource();await h.wait(s=>s.academicPracticeSession?.step===2,'existing prepared source');
 await h.click('[data-testid="learning-suggest-question"]');await ctx.page.getByTestId('research-new-conversation').click();await h.fill('.research-composer-input',question);
},helpers}));
