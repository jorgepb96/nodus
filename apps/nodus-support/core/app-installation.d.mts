import type {SupportAppManifest} from '../../../shared/support/appDistribution.mjs';
export class SupportAppInstallation {
 constructor(options:{storage:string;keys:Array<{keyId:string;publicKeyPem:string}>;platform:string;arch:string;verifyPlatform?:(executable:string,manifest:SupportAppManifest)=>Promise<void>});
 current():Promise<{executable:string;manifest:SupportAppManifest}|null>;
 install(envelope:unknown,options?:{signal?:AbortSignal;fetch?:typeof fetch;progress?:(value:{phase:string;completed?:number;total?:number})=>void}):Promise<{executable:string;manifest:SupportAppManifest}>;
}
export function verifySystemSupport(executable:string,envelope:unknown,options:{keys:Array<{keyId:string;publicKeyPem:string}>;platform:string;arch:string;verifyPlatform?:(executable:string,manifest:SupportAppManifest)=>Promise<void>}):Promise<{executable:string;manifest:SupportAppManifest}>;
