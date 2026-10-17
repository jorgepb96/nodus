// Nodus Sign: serialisable contracts; visual and cryptographic operations stay separate.
import type { ProtectSourceRef, ProtectSourceSummary } from "./protectTypes";
export interface SignSignature {
  id: string;
  name: string;
  png: string;
  width: number;
  height: number;
}
export interface SignAppearance {
  id: string;
  name: string;
  signer: string;
  reason: string;
  location: string;
  text: string;
  font: "sans" | "serif" | "mono";
  fontSize: number;
  showDate: boolean;
  showCertificate: boolean;
  signatureId: string | null;
}
export interface SignPlacement {
  id: string;
  groupId?: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
  png: string;
}
export interface SignHistory {
  id: string;
  name: string;
  createdAt: string;
  mode: "visual" | "certificate";
  sha256: string;
  size: number;
}
export interface SignLibrary {
  signatures: SignSignature[];
  profiles: SignAppearance[];
  history: SignHistory[];
}
export interface SignDocument {
  visualLocked?: boolean;
  id: string;
  name: string;
  bytes: Uint8Array;
}
export interface SignValidation {
  field: string;
  intact: boolean;
  valid: boolean;
  trusted: boolean;
  coverage: string;
  modification: string;
  signer: string;
}
export interface SignInspection {
  signatures: SignValidation[];
  restricted: boolean;
  encrypted: boolean;
}
export interface SignCertificate {
  subject: string;
  issuer: string;
  serial: string;
  fingerprint: string;
  notBefore: string;
  notAfter: string;
  usable: boolean;
}
export interface SignEngineStatus {
  available: boolean;
  version?: string;
  python: string;
  error?: string;
}
export interface SignInstallProgress {
  phase: 'checking' | 'python' | 'environment' | 'dependencies' | 'verifying' | 'ready';
  fraction: number;
}
export interface SignCryptoRequest {
  documentId: string;
  certificateToken: string;
  password: string;
  appearance: SignAppearance;
  page: number;
  box: [number, number, number, number];
  /** One real incremental signature per selected page, with a single explicit authorization. */
  widgets?: { page: number; box: [number, number, number, number] }[];
  /** False for a signature with no appearance on any page. */
  visible?: boolean;
  appearancePng: string;
  confirmed: boolean;
}
export const defaultSignAppearance = (): SignAppearance => ({
  id: "",
  name: "Personal",
  signer: "",
  reason: "",
  location: "",
  text: "",
  font: "sans",
  fontSize: 12,
  showDate: true,
  showCertificate: true,
  signatureId: null,
});
export interface SignApi {
  getSignLibrary(): Promise<SignLibrary>;
  saveSignSignature(signature: SignSignature): Promise<SignLibrary>;
  deleteSignSignature(id: string): Promise<SignLibrary>;
  saveSignProfile(profile: SignAppearance): Promise<SignLibrary>;
  deleteSignProfile(id: string): Promise<SignLibrary>;
  openSignDocument(source: ProtectSourceRef): Promise<SignDocument>;
  readSignHistory(id: string): Promise<SignDocument>;
  deleteSignHistory(id: string): Promise<SignLibrary>;
  saveSignVisual(
    documentId: string,
    placements: SignPlacement[],
  ): Promise<SignDocument>;
  exportSignDocument(id: string): Promise<boolean>;
  saveSignToVault(id: string): Promise<string>;
  revealSignDocument(id: string): Promise<void>;
  getSignEngineStatus(): Promise<SignEngineStatus>;
  configureSignPython(): Promise<SignEngineStatus>;
  installSignEngine(onProgress: (event: SignInstallProgress) => void): Promise<SignEngineStatus>;
  cancelSignEngineInstall(): Promise<void>;
  pickSignCertificate(): Promise<{ token: string; name: string } | null>;
  inspectSignCertificate(
    token: string,
    password: string,
  ): Promise<SignCertificate>;
  inspectSignDocument(id: string): Promise<SignInspection>;
  signWithCertificate(request: SignCryptoRequest): Promise<SignDocument>;
  cancelSignOperation(): Promise<void>;
  /** Finger drawing on the trackpad. Resolves null where only the cursor is available. */
  startSignTrackpad(onFrame: (frame: SignTrackpadFrame) => void): Promise<SignTrackpadSurface | null>;
  stopSignTrackpad(): Promise<void>;
}
/** Physical size of the touch surface, in millimetres. */
export interface SignTrackpadSurface {
  width: number;
  height: number;
}
/** One finger on the trackpad: a serial that is new for every touch, and its place, 0..1 with y upwards. */
export interface SignTrackpadContact {
  id: number;
  x: number;
  y: number;
}
/** Every finger touching one trackpad, and that trackpad's size in millimetres. */
export interface SignTrackpadFrame extends SignTrackpadSurface {
  device: number;
  contacts: SignTrackpadContact[];
}
export type SignSource = ProtectSourceSummary;
