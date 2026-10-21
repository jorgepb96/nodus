export function trialReceiptPath(root: string,token: string): string;
export function publishTrialReceipt(input:{root:string;token:string;version:string;pid:number}):Promise<void>;
export function waitForTrial(input: {root:string;token:string;version:string;pid?:number;signal?:AbortSignal;timeout?:number}): Promise<{protocol:1;root:string;token:string;version:string;pid:number}>;
