export function trialReceiptPath(root: string,token: string): string;
export function waitForTrial(input: {root:string;token:string;version:string;pid:number;signal?:AbortSignal;timeout?:number}): Promise<{protocol:1;root:string;token:string;version:string;pid:number}>;
