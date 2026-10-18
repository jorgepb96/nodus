import type {ChatSkill} from './chatSkills';
import type {ModelRef} from './types';
import {splitChatVisuals,skillHasCapability} from './chatSkills';
import {validateViewDocument,type ViewDocumentV1,type ViewNode} from '../packages/capability-api/src/views';
import {sanitizeChatSvg} from './chatSvg';
export interface PortableSkillResourceExecution {
 skills:ChatSkill[];question?:string;model?:ModelRef|null;owner?:string;version:number;isCurrent:()=>boolean;
 renderStoredArtifacts?:boolean;beforeInvoke?:()=>void;beforePaidCall?:()=>void;beforeRepair?:()=>void;maxSvgRepairs?:number;
 flushPersist?:()=>Promise<void>;
}
export interface PortableResourceExecutionHost<Execution extends PortableSkillResourceExecution,Bytes extends {length:number}> {
 executeRegisteredChatSkills(answer:string,execution:Execution,signal?:AbortSignal):Promise<string>;
 parseArtifactReference(content:string):{source:string}|null;
 readCapabilityArtifact(source:string):unknown;
 getChatImage(id:string):{blob:Bytes;mime:string}|null;
 storeCapabilityFile(owner:string,input:{bytes:Bytes;mimeType:string;name:string}):string|Promise<string>;
 evaluateInSvgSandbox<T>(script:string):Promise<T>;
}
export interface SkillResourceResult { text: string; view: ViewDocumentV1; artifactSources: string[] }

/** Collect and normalize the real dispatcher outputs using the canonical protocol. */
export function portableResourceExecution<Execution extends PortableSkillResourceExecution,Bytes extends {length:number}>(host:PortableResourceExecutionHost<Execution,Bytes>) {
 const {executeRegisteredChatSkills,parseArtifactReference,readCapabilityArtifact,getChatImage,storeCapabilityFile,evaluateInSvgSandbox}=host;
/** The chat executor remains the only protocol dispatcher. This adapter collects its
 * validated outputs for any document surface, rather than implementing another runner. */
async function executeSkillResources(answer: string, execution: Execution, signal?: AbortSignal): Promise<SkillResourceResult> {
  const authored = splitChatVisuals(answer);
  if (authored.some(part => ['capability-result', 'capability-view', 'capability-artifact'].includes(part.kind))) throw new Error('Resources must be produced by the selected skill, not fabricated as stored results.');
  if (authored.some(part => part.kind === 'svg') && !execution.skills.some(skill => skillHasCapability(skill, 'svg'))) throw new Error('SVG is not permitted by the selected skill.');
  let repairs = 0;
  const text = await executeRegisteredChatSkills(answer, { ...execution, renderStoredArtifacts: true, beforeRepair: () => {
    if (repairs++ >= 1) throw new Error('A document figure permits at most one repair.');
    execution.beforeRepair?.();
  } }, signal);
  const nodes: ViewNode[] = [], artifactSources: string[] = [];
  for (const part of splitChatVisuals(text)) {
    if (part.kind === 'svg' && part.complete) {
      const clean = await evaluateInSvgSandbox<{ svg: string; title: string } | null>(`(${sanitizeChatSvg.toString()})(${JSON.stringify(part.content)})`);
      if (clean) nodes.push({ kind: 'svg', svg: clean.svg, title: clean.title || 'Figure', alt: clean.title || execution.question || 'Figure' });
    } else if (part.kind === 'capability-view') {
      const payload = JSON.parse(part.content);
      nodes.push(...validateViewDocument(payload.view).nodes);
    } else if (part.kind === 'capability-artifact') {
      const reference = parseArtifactReference(part.content);
      if (reference && readCapabilityArtifact(reference.source)) artifactSources.push(reference.source);
    } else if (part.kind === 'capability-result') {
      const { result } = JSON.parse(part.content);
      if (result?.kind === 'svg') nodes.push({ kind: 'svg', svg: result.svg, title: result.title || 'Figure', alt: result.alt || result.title || 'Figure' });
      else if (result?.kind === 'table') nodes.push({ kind: 'table', columns: result.columns.map((label: string) => ({ label })), rows: result.rows });
      else if (result?.kind === 'image' && execution.owner && result.source?.startsWith(`nodus-image://chat/${execution.owner}/`)) {
        const image = getChatImage(result.source.slice('nodus-image://chat/'.length));
        if (image) {
          const source = await storeCapabilityFile(execution.owner, { bytes: image.blob, mimeType: image.mime, name: 'figure.png' });
          nodes.push({ kind: 'image', attachmentId: source.split('/').at(-1)!, title: result.title || 'Figure', alt: result.alt || 'Figure', name: 'figure.png', mimeType: image.mime, bytes: image.blob.length });
        }
      }
    }
  }
  // Image Atelier's legacy URI remains readable by chats; views use the common attachment
  // contract, so images and plugin media have one rendering/export path.
  for (const match of text.matchAll(/!\[([^\]]*)\]\((nodus-image:\/\/chat\/([a-f0-9]{64}\/[a-f0-9-]{36}))\)/g)) {
    if (!execution.owner || !match[3].startsWith(`${execution.owner}/`)) continue;
    const image = getChatImage(match[3]); if (!image) continue;
    const source = await storeCapabilityFile(execution.owner, { bytes: image.blob, mimeType: image.mime, name: 'figure.png' });
    nodes.push({ kind: 'image', attachmentId: source.split('/').at(-1)!, title: match[1] || 'Figure', alt: match[1] || 'Figure', name: 'figure.png', mimeType: image.mime, bytes: image.blob.length });
  }
  const normalize = async (items: ViewNode[]): Promise<ViewNode[]> => {
    const result: ViewNode[] = [];
    for (const node of items) {
      if (['audio', 'imageTiles', 'status', 'notice', 'download', 'code'].includes(node.kind)) continue;
      if (node.kind === 'details') {
        const children = await normalize(node.children);
        if (children.length) result.push({ ...node, children });
      } else if (node.kind === 'svg') {
        const clean = await evaluateInSvgSandbox<{ svg: string } | null>(`(${sanitizeChatSvg.toString()})(${JSON.stringify(node.svg)})`);
        if (clean) result.push({ ...node, svg: clean.svg });
      } else result.push(node.kind === 'map' ? { ...node, basemap: false } : node);
    }
    return result;
  };
  const insertable = await normalize(nodes);
  const visual = (node: ViewNode): boolean => node.kind === 'details' ? node.children.some(visual) : ['svg','image','model','chart','map','tree','table','math','comparison','passage'].includes(node.kind);
  if (!insertable.some(visual)) throw new Error('The skill did not produce an insertable resource.');
  // Maps in a durable document never silently start a tile subscription.
  const view = validateViewDocument({ schemaVersion: 1, summary: 'Document figure', nodes: insertable });
  return { text, view, artifactSources };
}

return {executeSkillResources};
}
