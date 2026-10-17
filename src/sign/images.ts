import { t, getActiveLang } from "../i18n";
import type {
  SignAppearance,
  SignCertificate,
  SignSignature,
} from "@shared/signTypes";
import type { SignBox } from "./geometry";
export async function loadSignImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("No se pudo abrir la imagen."));
    image.src = src;
  });
}
/** Pixel bounds of the ink inside `crop` (0..1 of the canvas), or null when that area is empty. */
export function inkBounds(canvas: HTMLCanvasElement, crop?: SignBox | null) {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const x0 = crop ? Math.max(0, Math.floor(crop.x * width)) : 0;
  const y0 = crop ? Math.max(0, Math.floor(crop.y * height)) : 0;
  const x1 = crop ? Math.min(width, Math.ceil((crop.x + crop.w) * width)) : width;
  const y1 = crop ? Math.min(height, Math.ceil((crop.y + crop.h) * height)) : height;
  let left = width,
    right = -1,
    top = height,
    bottom = -1;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      if (image.data[(y * width + x) * 4 + 3] > 10) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  return right < left ? null : { left, right, top, bottom };
}
/** The frame a new crop starts from: the ink with a small margin, or the whole canvas. */
export function initialCrop(canvas: HTMLCanvasElement): SignBox {
  const ink = inkBounds(canvas);
  if (!ink) return { x: 0, y: 0, w: 1, h: 1 };
  const margin = 12;
  const x = Math.max(0, ink.left - margin), y = Math.max(0, ink.top - margin);
  const r = Math.min(canvas.width, ink.right + 1 + margin), b = Math.min(canvas.height, ink.bottom + 1 + margin);
  return { x: x / canvas.width, y: y / canvas.height, w: (r - x) / canvas.width, h: (b - y) / canvas.height };
}
/** The saved signature: the ink inside the crop frame, without empty margins. */
export function trimSignature(canvas: HTMLCanvasElement, crop?: SignBox | null) {
  const ink = inkBounds(canvas, crop);
  if (!ink)
    throw new Error("Dibuja o importa una firma antes de guardarla.");
  const { left, right, top, bottom } = ink;
  const result = document.createElement("canvas");
  result.width = right - left + 17;
  result.height = bottom - top + 17;
  result
    .getContext("2d")!
    .drawImage(
      canvas,
      left,
      top,
      right - left + 1,
      bottom - top + 1,
      8,
      8,
      right - left + 1,
      bottom - top + 1,
    );
  return {
    png: result.toDataURL("image/png"),
    width: result.width,
    height: result.height,
  };
}
export async function appearanceImage(
  profile: SignAppearance,
  signatures: SignSignature[],
  certificate?: SignCertificate | null,
) {
  const canvas = document.createElement("canvas");
  canvas.width = 1000;
  canvas.height = 400;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#17202d";
  const signature = signatures.find((s) => s.id === profile.signatureId);
  const start = signature ? 420 : 30;
  if (signature) {
    const image = await loadSignImage(signature.png);
    const scale = Math.min(360 / image.width, 280 / image.height);
    ctx.drawImage(
      image,
      30,
      200 - (image.height * scale) / 2,
      image.width * scale,
      image.height * scale,
    );
  }
  const font =
    profile.font === "serif"
      ? "Georgia"
      : profile.font === "mono"
        ? "monospace"
        : "Arial";
  const size = profile.fontSize * 2.3;
  ctx.font = `${size}px ${font}`;
  const lines = [
    profile.signer || certificate?.subject || t("Firma con certificado"),
    profile.showDate ? new Date().toLocaleString(getActiveLang()) : "",
    profile.reason,
    profile.location,
    profile.text,
    profile.showCertificate && certificate
      ? `SHA-256: ${certificate.fingerprint.slice(0, 12)}…${certificate.fingerprint.slice(-12)}`
      : "",
  ].filter(Boolean);
  const wrapped: string[] = [];
  for (const line of lines) {
    for (const paragraph of line.split("\n")) {
      let current = "";
      for (const char of paragraph) {
        if (ctx.measureText(current + char).width > 970 - start) {
          wrapped.push(current);
          current = "";
        }
        current += char;
      }
      wrapped.push(current);
    }
  }
  const lineHeight = Math.min(size * 1.35, 340 / Math.max(wrapped.length, 1));
  ctx.font = `${Math.min(size, lineHeight / 1.2)}px ${font}`;
  wrapped.forEach((line, i) =>
    ctx.fillText(line, start, 40 + (i + 1) * lineHeight),
  );
  return canvas.toDataURL("image/png");
}
export function textImage(text: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 1000;
  canvas.height = 240;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#17202d";
  ctx.font = "56px Arial";
  const lines = text.split("\n").slice(0, 3);
  lines.forEach((line, i) => ctx.fillText(line, 10, 65 + i * 75, 980));
  return canvas.toDataURL("image/png");
}
