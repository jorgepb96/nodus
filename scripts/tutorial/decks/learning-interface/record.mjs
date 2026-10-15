import {record} from '../../engine/recorder.mjs';import {SHOTS} from './shots.mjs';import {SETTINGS,setup,helpers} from '../learning-real/common.mjs';
await record({failFast:true,name:'learning-interface',shots:SHOTS,settings:SETTINGS,prepare:ctx=>setup(ctx),helpers});
