export function downloadArtifact(artifact:import('../../../shared/support/appDistribution.mjs').SupportArtifact,folder:string,options?:{signal?:AbortSignal;progress?:(value:{phase:string;completed:number;total:number})=>void}):Promise<string>;
export function acceptPlatformSignature(status:string,policy:string):void;
