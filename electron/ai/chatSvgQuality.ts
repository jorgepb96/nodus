import {portableChatSvgQuality} from '@shared/portableChatSvgQuality';
import {completeText,resolveModelRef} from './aiClient';
import {evaluateInSvgSandbox} from './svgSandboxWindow';
const svgQuality=portableChatSvgQuality({completeText,resolveModelRef,evaluateInSvgSandbox});
export function inspectChatSvg(...args:Parameters<typeof svgQuality.inspectChatSvg>){return svgQuality.inspectChatSvg(...args);}
export function refineChatSvg(...args:Parameters<typeof svgQuality.refineChatSvg>){return svgQuality.refineChatSvg(...args);}
