import type { SignTrackpadContact, SignTrackpadFrame, SignTrackpadSurface } from "@shared/signTypes";

/** Where the trackpad sits on the canvas, in canvas pixels. */
export interface TrackpadArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The whole trackpad, to scale and centred on the canvas. Every place a finger
 * can reach lands inside it, so nothing is cut off, and the editor outlines it
 * so the edges of the trackpad are the edges the user sees. */
export function trackpadArea(surface: SignTrackpadSurface, width = 900, height = 300): TrackpadArea {
  const aspect = surface.width > 0 && surface.height > 0 ? surface.width / surface.height : 1.6;
  const areaHeight = Math.min(height, width / aspect);
  const areaWidth = areaHeight * aspect;
  return { x: (width - areaWidth) / 2, y: (height - areaHeight) / 2, width: areaWidth, height: areaHeight };
}

const unit = (value: number) => Math.min(1, Math.max(0, value));

/** A finger on the trackpad (0..1, y upwards) as a canvas point. */
export function trackpadPoint(contact: Pick<SignTrackpadContact, "x" | "y">, area: TrackpadArea) {
  return { x: area.x + unit(contact.x) * area.width, y: area.y + (1 - unit(contact.y)) * area.height };
}

/** Which finger draws. A stroke belongs to the finger that started it and lasts
 * until that finger lifts, whatever else touches meanwhile: a palm or thumb
 * landing mid-stroke neither ends it nor jumps it elsewhere. A new stroke starts
 * only with a finger that touched after the last stroke ended, so a contact that
 * was already resting never draws. Contact ids are serials that never repeat. */
export interface FingerPen {
  id: number | null;
  floor: number;
  seen: number;
}

export const restingPen = (): FingerPen => ({ id: null, floor: -1, seen: -1 });

export type PenStep =
  | { kind: "begin" | "extend"; contact: SignTrackpadContact }
  | { kind: "end" }
  | { kind: "none" };

export function followFinger(pen: FingerPen, frame: Pick<SignTrackpadFrame, "contacts">): { pen: FingerPen; steps: PenStep[] } {
  const seen = Math.max(pen.seen, ...frame.contacts.map((c) => c.id));
  const steps: PenStep[] = [];
  let { id, floor } = pen;
  if (id !== null) {
    const same = frame.contacts.find((c) => c.id === id);
    if (same) return { pen: { id, floor, seen }, steps: [{ kind: "extend", contact: same }] };
    steps.push({ kind: "end" });
    id = null;
    floor = Math.max(floor, pen.seen);
  }
  const fresh = frame.contacts.filter((c) => c.id > floor);
  if (fresh.length) {
    const contact = fresh.reduce((a, b) => (b.id > a.id ? b : a));
    id = contact.id;
    floor = contact.id;
    steps.push({ kind: "begin", contact });
  }
  return { pen: { id, floor, seen }, steps: steps.length ? steps : [{ kind: "none" }] };
}
