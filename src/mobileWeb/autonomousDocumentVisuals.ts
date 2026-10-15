import {documentVisualCaptureHash,validateMobileDocumentVisualSource,type MobileDocumentVisualCheckpoint} from '@shared/mobileDocumentVisuals';
import type {DocumentSkillPolicy} from '@shared/documentSkills';
import type {ModelRef} from '@shared/types';
import {sha256Snapshot} from '@shared/databaseResearchEngine';
import {researchVisualFields} from '@shared/documentVisualContent';
import {runAutonomousDocumentVisuals} from './autonomousResearchVisuals';
type Call=(method:string,...args:any[])=>Promise<any>;
/** A figure editor for a real report, with its own journal and command receipts.
 * It never invokes report generation or changes the original publication input. */
export class AutonomousDocumentVisuals {
 private value:MobileDocumentVisualCheckpoint|null=null;
 private active?:AbortController;
 constructor(private call:Call,private reportId:string,private vaultId:string,private changed:()=>void,private readOnly=false){}
 get checkpoint(){return this.value;}
 private async persist(){if(!this.value)return;this.value.updatedAt=new Date().toISOString();await this.call('mobileDocumentVisualCheckpoint','save',this.reportId,this.value);this.changed();}
 async load(){
  const resolved=await this.call('mobileDocumentVisualResolve',this.reportId);if(typeof resolved?.reportId!=='string')throw new Error('document_visual_target_missing');this.reportId=resolved.reportId;
  const stored=await this.call('mobileDocumentVisualCheckpoint','load',this.reportId);
  if(stored){if(stored.kind!=='documentVisuals'||stored.target?.id!==this.reportId||stored.source?.vaultId!==this.vaultId)throw new Error('document_visual_session_scope_conflict');this.value=stored;if(!this.readOnly&&stored.state==='running'){stored.state='failed';stored.error='La edición se interrumpió. Reintenta explícitamente; una respuesta de pago incierta no se comprará de nuevo automáticamente.';if(stored.manifest){stored.manifest.state='failed';for(const figure of stored.manifest.figures){if(figure.state==='running'){figure.state='failed';figure.error='Interrupted request; retry explicitly.';}}}await this.persist();}this.changed();return;}
  let captured=resolved.source;
  if(captured){const contentHash=sha256Snapshot(researchVisualFields(captured.draft));const capture={version:1,vaultId:this.vaultId,target:captured.target,contentHash,manifest:resolved.captureManifest??null,assets:resolved.captureAssets??[]};const captureCanonical=JSON.stringify(capture);captured={...captured,contentHash,capture,captureCanonical,captureHash:documentVisualCaptureHash(captureCanonical)};}
  const source=validateMobileDocumentVisualSource(captured??await this.call('mobileDocumentVisualSource',this.reportId),this.vaultId,this.reportId);
  const now=new Date().toISOString();this.value={version:1,kind:'documentVisuals',id:crypto.randomUUID(),entityKey:`deep-research:${this.reportId}`,target:source.target,source,createdAt:now,updatedAt:now,state:'capturing',manifest:structuredClone(source.capture.manifest),assets:[],calls:{},commands:[],policy:source.capture.manifest?.policy??{enabled:false,skills:[]}};
  if(this.readOnly){this.changed();return;}
  await this.persist();await this.capture();
 }
 async replaceSource(){
  this.requireEditable();
  if(this.active)throw new Error('Cancela la generación antes de revisar su fuente.');
  const old=this.required();if(old.recoveryReviewRequired)throw new Error('Revisa el trabajo recuperado antes de sustituir su fuente.');
  const source=validateMobileDocumentVisualSource(await this.call('mobileDocumentVisualSource',this.reportId),this.vaultId,this.reportId),now=new Date().toISOString();
  const replacement:MobileDocumentVisualCheckpoint={version:1,kind:'documentVisuals',id:crypto.randomUUID(),entityKey:old.entityKey,target:source.target,source,createdAt:now,updatedAt:now,state:'capturing',manifest:structuredClone(source.capture.manifest),assets:[],calls:{},commands:[],policy:source.capture.manifest?.policy??{enabled:false,skills:[]}};
  await this.call('mobileDocumentVisualCheckpoint','replaceSource',this.reportId,replacement);this.value=replacement;this.changed();await this.capture();
 }
 async capture(){
  this.requireEditable();
  const value=this.required();if(value.recoveryReviewRequired)throw new Error('Revisa el trabajo visual recuperado antes de continuarlo.');
  try{const receipts=await this.call('mobileDocumentVisualCaptureAssets',this.reportId);value.assets=receipts.map((receipt:any)=>({id:receipt.id.toLowerCase(),owner:receipt.owner,ownerRevision:receipt.ownerRevision,generationId:receipt.targetId,figureId:receipt.figureKey,mimeType:receipt.mimeType,byteCount:receipt.byteCount,sha256:receipt.sha256}));value.state='ready';delete value.error;await this.persist();}
  catch(error){value.state='failed';value.error=String(error);await this.persist();throw error;}
 }
 private requireEditable(){if(this.readOnly)throw new Error("La IA de esta beta requiere un Mac conectado. Este resultado local se conserva para consulta y exportación.");}
 private required(){if(!this.value)throw new Error('Abre o descarga la fuente real del informe antes de editar sus figuras.');return this.value;}
 async enrich(policy:DocumentSkillPolicy,options:{retry?:boolean;model?:ModelRef}={}){
  this.requireEditable();const value=this.required();if(this.active)throw new Error('Ya hay una edición visual en curso.');if(value.recoveryReviewRequired)throw new Error('Revisa el trabajo visual recuperado antes de continuarlo.');if(!options.model?.provider||!options.model.model)throw new Error('Elige un modelo configurado en este dispositivo.');
  if(value.state==='capturing'||value.assets.length<value.source.capture.assets.length)await this.capture();
  const controller=new AbortController();this.active=controller;
  try{await this.call('beginAutonomousAuthoring',value.id);}catch(error){this.active=undefined;throw error;}
  try{
   value.previous={manifest:value.manifest?structuredClone(value.manifest):null,assets:structuredClone(value.assets)};value.policy=policy;value.model=options.model;value.state='running';delete value.error;await this.persist();
   await runAutonomousDocumentVisuals(this.call,{generationId:value.id,entityKey:value.entityKey,targetId:this.reportId,vaultId:this.vaultId,parentKind:'documentVisuals',retry:options.retry??false,draft:value.source.draft,policy,model:options.model,journal:value,imageModel:value.imageModel,setImageModel:model=>{value.imageModel=model;},visuals:value.manifest?{manifest:value.manifest,assets:value.assets}:undefined,setVisuals:visuals=>{value.manifest=visuals.manifest;value.assets=visuals.assets;}},()=>this.persist(),controller);
   controller.signal.throwIfAborted();value.state='pending';await this.enqueue();
  }catch(error){value.state=controller.signal.aborted?'cancelled':'failed';value.error=String(error);await this.persist();throw error;}
  finally{this.active=undefined;await this.call('endAutonomousAuthoring',value.id);}
 }
 cancel(){this.active?.abort(new Error('Edición visual cancelada. Las respuestas y figuras guardadas se conservan.'));}
 async remove(figureId:string){this.requireEditable();const value=this.required();if(this.active)throw new Error('Cancela la generación antes de retirar una figura.');if(!value.manifest)return;value.previous={manifest:structuredClone(value.manifest),assets:structuredClone(value.assets)};const figure=value.manifest.figures.find(item=>item.id===figureId);if(!figure)throw new Error('La figura ya no pertenece a esta versión.');value.manifest.figures=value.manifest.figures.filter(item=>item.id!==figureId);value.manifest.revision=crypto.randomUUID();await this.enqueue();}
 async undo(){this.requireEditable();const value=this.required();if(this.active)throw new Error('Cancela la generación antes de deshacer.');if(!value.previous)throw new Error('No hay una versión visual anterior conservada.');const current={manifest:value.manifest,assets:value.assets};value.manifest=value.previous.manifest;if(value.manifest&&current.manifest){for(const [id,usage] of Object.entries(current.manifest.usage)){const old=value.manifest.usage[id]??{attempts:0,paidCalls:0};value.manifest.usage[id]={attempts:Math.max(old.attempts,usage.attempts),paidCalls:Math.max(old.paidCalls,usage.paidCalls)};}}value.assets=value.previous.assets;delete value.previous;if(value.manifest)value.manifest.revision=crypto.randomUUID();await this.enqueue();}
 private async enqueue(){const value=this.required();const ids=new Set<string>();for(const figure of value.manifest?.figures??[]){const poster=figure.poster?.match(/\/([a-f0-9-]{36})$/);if(poster)ids.add(poster[1]);const visit=(nodes:any[])=>{for(const node of nodes){if(node.attachmentId)ids.add(node.attachmentId);if(node.children)visit(node.children);}};if(figure.view)visit(figure.view.nodes);}const assets=value.assets.filter(asset=>ids.has(asset.id));value.commands.push({id:crypto.randomUUID(),expectedRevision:value.commands.at(-1)?.visuals?.manifest.revision??(value.commands.length?null:value.source.expectedRevision),visuals:value.manifest?structuredClone({manifest:value.manifest,assets}):null,state:'pending'});value.state='pending';await this.persist();await this.synchronize();}
 async synchronize(){
  const value=this.required();if(value.recoveryReviewRequired)throw new Error('Revisa el trabajo visual recuperado antes de publicarlo.');
  if(value.source.publicationDependency&&!(await this.call('mobileDocumentVisualPublicationReady',this.reportId)))throw new Error('El informe original sigue pendiente de sincronización. Las figuras y respuestas permanecen guardadas en este dispositivo.');
  for(const command of value.commands){if(command.state==='available')continue;if(command.state==='blocked')throw new Error(command.error??'Revisa el conflicto de esta edición visual.');
   try{if(command.visuals)await this.call('documentFigurePublishAssets',{parentKind:'documentVisuals',entityKey:value.entityKey,generationId:value.id,assets:command.visuals.assets});const ack=await this.call('saveMobileDeepResearchVisuals',{version:1,requestId:command.id,reportId:this.reportId,expectedRevision:command.expectedRevision,captureHash:value.source.captureHash,contentHash:value.source.contentHash,policy:command.visuals?.manifest.policy??value.policy,visuals:command.visuals});if(ack?.state!=='available'||ack.reportId!==this.reportId||ack.revision!==(command.visuals?.manifest.revision??null))throw new Error('La publicación no ha confirmado esta versión visual.');command.state='available';delete command.error;await this.persist();}
   catch(error){command.error=String(error);if(/conflict|revision|permission|forbidden/i.test(String(error)))command.state='blocked';value.state=command.state==='blocked'?'blocked':'pending';value.error=String(error);await this.persist();throw error;}
  }
  value.state='available';delete value.error;await this.persist();
 }
}
