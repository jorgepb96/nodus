import {executeRegisteredChatSkills} from '../../skill-capabilities/registry/main';
import {parseArtifactReference,readCapabilityArtifact} from './artifactStore';
import {getChatImage,storeCapabilityFile} from '../chatAssets';
import {evaluateInSvgSandbox} from '../ai/svgSandboxWindow';
import {portableResourceExecution} from '../../shared/portableResourceExecution';
export type {SkillResourceResult} from '../../shared/portableResourceExecution';
const resources=portableResourceExecution({executeRegisteredChatSkills,parseArtifactReference,readCapabilityArtifact,getChatImage,storeCapabilityFile,evaluateInSvgSandbox});
export function executeSkillResources(...args:Parameters<typeof resources.executeSkillResources>){return resources.executeSkillResources(...args);}
