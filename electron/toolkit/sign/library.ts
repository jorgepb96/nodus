// Global userData shelf (same scope as Presenter). No vault paths or secrets.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  SignLibrary,
  SignSignature,
  SignAppearance,
  SignHistory,
} from "@shared/signTypes";
const safeId = (id: string) => {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(id))
    throw new Error("Invalid Sign identifier");
  return id;
};
export class SignStore {
  constructor(readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  read(): SignLibrary {
    const file = path.join(this.dir, "library.json");
    if (!fs.existsSync(file))
      return { signatures: [], profiles: [], history: [] };
    // Do not silently overwrite a damaged library.
    const lib = JSON.parse(fs.readFileSync(file, "utf8")) as SignLibrary;
    if (
      !Array.isArray(lib.signatures) ||
      !Array.isArray(lib.profiles) ||
      !Array.isArray(lib.history)
    )
      throw new Error("Invalid Sign library");
    return lib;
  }
  write(lib: SignLibrary) {
    const file = path.join(this.dir, "library.json");
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(lib), { mode: 0o600 });
    fs.renameSync(temp, file);
  }
  signature(value: SignSignature) {
    safeId(value.id);
    validatePng(value.png);
    if (
      !value.name?.trim() ||
      value.name.length > 120 ||
      !Number.isFinite(value.width) ||
      !Number.isFinite(value.height) ||
      value.width <= 0 ||
      value.height <= 0 ||
      value.width > 4096 ||
      value.height > 4096
    )
      throw new Error("Invalid signature");
    const lib = this.read();
    lib.signatures = [
      ...lib.signatures.filter((s) => s.id !== value.id),
      value,
    ];
    this.write(lib);
    return lib;
  }
  profile(value: SignAppearance) {
    safeId(value.id);
    for (const key of ["name", "signer", "reason", "location", "text"] as const)
      if (typeof value[key] !== "string" || value[key].length > 1000)
        throw new Error("Invalid appearance");
    if (
      !value.name.trim() ||
      !["sans", "serif", "mono"].includes(value.font) ||
      !Number.isFinite(value.fontSize) ||
      value.fontSize < 6 ||
      value.fontSize > 32
    )
      throw new Error("Invalid appearance");
    const lib = this.read();
    lib.profiles = [...lib.profiles.filter((p) => p.id !== value.id), value];
    this.write(lib);
    return lib;
  }
  remove(kind: "signatures" | "profiles" | "history", id: string) {
    safeId(id);
    const lib = this.read();
    lib[kind] = lib[kind].filter((s) => s.id !== id) as never;
    if (kind === "signatures")
      lib.profiles = lib.profiles.map((p) =>
        p.signatureId === id ? { ...p, signatureId: null } : p,
      );
    this.write(lib);
    if (kind === "history") fs.rmSync(this.pdfPath(id), { force: true });
    return lib;
  }
  pdfPath(id: string) {
    return path.join(this.dir, `${safeId(id)}.pdf`);
  }
  add(bytes: Uint8Array, name: string, mode: SignHistory["mode"]): SignHistory {
    if (
      bytes.length > 150 * 1024 * 1024 ||
      Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-"
    )
      throw new Error("Invalid PDF");
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const lib = this.read();
    const prior = lib.history.find((h) => h.sha256 === sha256);
    if (prior && fs.existsSync(this.pdfPath(prior.id))) return prior;
    const entry = {
      id: crypto.randomUUID(),
      name: path.basename(name),
      createdAt: new Date().toISOString(),
      mode,
      sha256,
      size: bytes.length,
    };
    fs.writeFileSync(this.pdfPath(entry.id), bytes, { mode: 0o600 });
    lib.history.unshift(entry);
    this.write(lib);
    return entry;
  }
  document(id: string) {
    const entry = this.read().history.find((h) => h.id === id);
    if (!entry) throw new Error("SIGN_COPY_MISSING");
    return {
      id,
      name: entry.name,
      bytes: new Uint8Array(fs.readFileSync(this.pdfPath(id))),
    };
  }
}
export function validatePng(png: string): void {
  if (
    typeof png !== "string" ||
    !png.startsWith("data:image/png;base64,") ||
    png.length > 8_000_000 ||
    Buffer.from(png.slice(22), "base64").subarray(0, 8).toString("hex") !==
      "89504e470d0a1a0a"
  )
    throw new Error("Invalid signature PNG");
  const header = Buffer.from(png.slice(22), "base64");
  const width = header.length >= 24 ? header.readUInt32BE(16) : 0;
  const height = header.length >= 24 ? header.readUInt32BE(20) : 0;
  if (!width || !height || width > 4096 || height > 4096)
    throw new Error("Invalid signature PNG dimensions");
}
