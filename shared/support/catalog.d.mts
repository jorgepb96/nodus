export const SUPPORT_CATALOG: Array<{id:string;actions:string[];guides:string[]}>;
export const SUPPORT_ACTIONS: string[];
export const DIAGNOSTIC_ACTIONS: string[];
export function suggestedActions(symptom: string): import('./types').SupportAction[];
