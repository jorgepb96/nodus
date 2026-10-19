export interface LaunchPolicy { format: string; id: string; source: string; at: string; softwareGraphics: boolean; recoveredRoot: string | null; }
export function readPolicy(folder: string, profile: string): LaunchPolicy | null;
export function resolvePolicy(folder: string, profile: string): LaunchPolicy | null;
export function writePolicy(folder: string, profile: string, changes: { softwareGraphics: boolean; recoveredRoot: string | null }, previousId?: string | null, id?: string): Promise<LaunchPolicy>;
