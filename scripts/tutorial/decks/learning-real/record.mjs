import {record} from '../../engine/recorder.mjs';
import {SHOTS} from './shots.mjs';
import {SETTINGS,setup,helpers,withKey} from './common.mjs';
const dry=process.argv.includes('--dry');
await withKey(()=>record({failFast:true,name:'learning-real',settings:SETTINGS,shots:dry?SHOTS.slice(0,8):SHOTS,prepare:async ctx=>{await setup(ctx,{paid:!dry});if(dry)await ctx.app.evaluate(()=>{const f=globalThis.fetch;globalThis.fetch=(input,init)=>{if(String(input).includes('openrouter.ai/api/v1/')&&init?.method==='POST'&&/(chat\/completions|embeddings)(\?|$)/.test(String(input)))throw new Error('Dry run cannot make paid requests');return f(input,init);};});await ctx.page.evaluate(()=>window.nodus.setResearchPreparationPolicy({welcomeVersion:1,decision:'declined',futureAdditions:false}));},helpers}));
