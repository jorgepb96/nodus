export function createProbeInput(password:string,requestId:string):Promise<{env:{NODUS_SUPPORT_INPUT_PIPE:string;NODUS_SUPPORT_INPUT_TOKEN:string};close():void}>;
export function readProbePassword(env?:NodeJS.ProcessEnv,stdin?:AsyncIterable<Buffer|string>):Promise<string>;
