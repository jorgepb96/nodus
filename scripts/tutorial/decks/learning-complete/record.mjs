import {record} from '../../engine/recorder.mjs';
import {SHOTS} from './shots.mjs';
import {SETTINGS,setup,helpers,withKey} from '../learning-real/common.mjs';
const dry=process.argv.includes('--dry');
await withKey(()=>record({failFast:true,name:'learning-complete',settings:SETTINGS,shots:dry?SHOTS.slice(0,9):SHOTS,prepare:async ctx=>{
 await setup(ctx,{paid:!dry});
 await ctx.page.evaluate(()=>window.nodus.setResearchPreparationPolicy({welcomeVersion:1,decision:'declined',futureAdditions:false}));
},helpers}));
