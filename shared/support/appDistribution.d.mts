export interface SupportArtifact {name:string;format:string;platformSignature:string;url:string;bytes:number;sha256:string}
export interface SupportAppManifest {format:'nodus.support-app/1';protocol:1;contentSha256:string;expandedBytes:number;version:string;platform:string;arch:string;executable:string;runtime:SupportArtifact;installers:SupportArtifact[]}
export function supportInstallerFormat(platform:string,options?:{appImage?:boolean;deb?:boolean;rpm?:boolean}):string;
export function verifySupportApp(envelope:unknown,keys:Array<{keyId:string;publicKeyPem:string}>,platform:string,arch:string):SupportAppManifest;
export function selectSupportInstaller(manifest:SupportAppManifest,format:string):SupportArtifact;
export function supportJson(response:Response):Promise<any>;
export function resolveSupportApp(version:string,keys:Array<{keyId:string;publicKeyPem:string}>,platform:string,arch:string,options?:{fetch?:typeof fetch;signal?:AbortSignal}):Promise<{manifest:SupportAppManifest;envelope:unknown}>;

export function supportContentDigest(value:unknown):string;

export function newerSupportVersion(a:string,b:string):boolean;
