import {
  PDFDocument,
  PDFDict,
  PDFArray,
  PDFStream,
  PDFName,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
} from "pdf-lib";
import type { SignPlacement } from "@shared/signTypes";
import { validatePng } from "./library";
export async function inspectVisualPdf(bytes: Uint8Array) {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    throw new Error(
      /encrypt/i.test(String(error)) ? "PDF_ENCRYPTED" : "SIGN_PDF_INVALID",
    );
  }
  let signed = /\/ByteRange\s*\[/.test(Buffer.from(bytes).toString("latin1"));
  let restricted = false;
  const pending: unknown[] = [
    doc.catalog,
    ...doc.context.enumerateIndirectObjects().map(([, obj]) => obj),
  ];
  const visited = new Set<unknown>();
  while (pending.length) {
    const obj = pending.pop();
    if (visited.has(obj)) continue;
    visited.add(obj);
    if (visited.size > 1_000_000) throw new Error("PDF structure too complex");
    if (obj instanceof PDFDict) {
      if (
        obj.get(PDFName.of("Type")) === PDFName.of("Sig") ||
        obj.has(PDFName.of("ByteRange"))
      )
        signed = true;
      if (
        obj.has(PDFName.of("DocMDP")) ||
        obj.get(PDFName.of("TransformMethod")) === PDFName.of("DocMDP") ||
        obj.get(PDFName.of("TransformMethod")) === PDFName.of("FieldMDP")
      )
        restricted = true;
      pending.push(...obj.values());
    } else if (obj instanceof PDFArray) pending.push(...obj.asArray());
    else if (obj instanceof PDFStream) pending.push(obj.dict);
  }
  return { doc, signed, restricted };
}
// Maps the displayed page's top-left coordinate space to the PDF crop box.
export function displayMatrix(
  rotation: number,
  x: number,
  y: number,
  w: number,
  h: number,
): [number, number, number, number, number, number] {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return [0, 1, 1, 0, x, y];
    case 180:
      return [-1, 0, 0, 1, x + w, y];
    case 270:
      return [0, -1, -1, 0, x + w, y + h];
    default:
      return [1, 0, 0, -1, x, y + h];
  }
}
export async function exportVisualPdf(
  bytes: Uint8Array,
  placements: SignPlacement[],
): Promise<Uint8Array> {
  const { doc, signed, restricted } = await inspectVisualPdf(bytes);
  if (signed || restricted) throw new Error("SIGN_VISUAL_LOCKED");
  if (
    !Array.isArray(placements) ||
    !placements.length ||
    placements.length > 300
  )
    throw new Error("Invalid placements");
  const images = new Map<string, Awaited<ReturnType<typeof doc.embedPng>>>();
  for (const p of placements) {
    validatePng(p.png);
    if (
      ![p.x, p.y, p.w, p.h, p.angle].every(Number.isFinite) ||
      !Number.isInteger(p.page) ||
      p.page < 1 ||
      p.page > doc.getPageCount() ||
      p.x < 0 ||
      p.y < 0 ||
      p.w <= 0 ||
      p.h <= 0 ||
      p.x + p.w > 1.001 ||
      p.y + p.h > 1.001 ||
      Math.abs(p.angle) > 360
    )
      throw new Error("Invalid placement");
    const page = doc.getPage(p.page - 1);
    const crop = page.getCropBox();
    const rotation = page.getRotation().angle;
    const rotated = Math.abs(rotation % 180) === 90;
    const width = rotated ? crop.height : crop.width;
    const height = rotated ? crop.width : crop.height;
    let image = images.get(p.png);
    if (!image) {
      image = await doc.embedPng(p.png);
      images.set(p.png, image);
    }
    const a = (p.angle * Math.PI) / 180;
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(
        ...displayMatrix(rotation, crop.x, crop.y, crop.width, crop.height),
      ),
      concatTransformationMatrix(
        Math.cos(a),
        Math.sin(a),
        -Math.sin(a),
        Math.cos(a),
        (p.x + p.w / 2) * width,
        (p.y + p.h / 2) * height,
      ),
      concatTransformationMatrix(1, 0, 0, -1, 0, 0),
    );
    page.drawImage(image, {
      x: (-p.w * width) / 2,
      y: (-p.h * height) / 2,
      width: p.w * width,
      height: p.h * height,
    });
    page.pushOperators(popGraphicsState());
  }
  return doc.save();
}
