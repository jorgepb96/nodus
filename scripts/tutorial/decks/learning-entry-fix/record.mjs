import {record} from '../../engine/recorder.mjs';import {SHOTS} from './shots.mjs';
import {setup,helpers,SETTINGS} from '../learning-real/common.mjs';
await record({name:'learning-entry-fix',settings:{...SETTINGS,basicsTutorialVersion:9999,recoverySetupVersion:9999,onboardingComplete:true,tourComplete:true,advancedTourComplete:true,mascotStyleChosen:true},failFast:true,shots:SHOTS,prepare:async ctx=>{
 await setup(ctx);const h=helpers(ctx);await h.open('first-answer');await ctx.page.getByTestId('library-vault-add-files').waitFor();await ctx.settle(1000);
},helpers});
