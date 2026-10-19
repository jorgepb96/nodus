export interface SupportDistributionState {
  phase: 'idle'|'checking'|'available'|'downloading'|'installing'|'installed'|'saved'|'cancelled'|'pending'|'error';
  installedVersion?:string;
  availableVersion?:string;
  platform:string;
  arch:string;
  installerFormat?:string;
  bytes?:number;
  completed?:number;
  error?:string;
}
