export type SignBox = { x: number; y: number; w: number; h: number };

export function adjustSignBox(box: SignBox, key: keyof SignBox, value: number, proportional: boolean): SignBox {
  if (!Number.isFinite(value)) return box;
  const next = { ...box };
  if (key === 'x' || key === 'y') next[key] = Math.max(0, Math.min(1 - box[key === 'x' ? 'w' : 'h'], value));
  else {
    const size = Math.max(0.01, Math.min(1, value));
    if (proportional) {
      const factor = Math.min(size / box[key], 1 / box.w, 1 / box.h);
      next.w = box.w * factor;
      next.h = box.h * factor;
    } else next[key] = size;
    next.x = Math.min(next.x, 1 - next.w);
    next.y = Math.min(next.y, 1 - next.h);
  }
  return next;
}

/** Resize in the annotation's rotated coordinate system, keeping its opposite corner fixed. */
export function resizeSignBox<T extends { x: number; y: number; w: number; h: number }>(box: T, dx: number, dy: number, width: number, height: number, angle = 0): T {
  const a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const w = Math.max(.04, Math.min(1, box.w + (c * dx + s * dy) / width));
  const h = Math.max(.025, Math.min(1, box.h + (-s * dx + c * dy) / height));
  const dw = w - box.w, dh = h - box.h;
  return { ...box, w, h,
    x: Math.max(0, Math.min(1 - w, box.x + (c - 1) * dw / 2 - s * dh * height / width / 2)),
    y: Math.max(0, Math.min(1 - h, box.y + s * dw * width / height / 2 + (c - 1) * dh / 2)),
  };
}
