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

export type SignHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const SIGN_HANDLES: SignHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Resize from any corner or edge, in the box's rotated coordinate system,
 * keeping the opposite corner or edge fixed. Corners keep the proportions
 * unless `proportional` is false; edges change one dimension. */
export function resizeFromHandle<T extends SignBox>(box: T, handle: SignHandle, dx: number, dy: number, width: number, height: number,
  angle = 0, proportional = handle.length === 2, min = { w: .04, h: .025 }): T {
  const sx = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
  const sy = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
  const a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const lx = c * dx + s * dy, ly = -s * dx + c * dy;
  const w0 = box.w * width, h0 = box.h * height;
  let w = sx ? w0 + sx * lx : w0, h = sy ? h0 + sy * ly : h0;
  if (proportional && sx && sy) {
    const lowest = Math.max(min.w * width / w0, min.h * height / h0);
    const highest = Math.min(width / w0, height / h0);
    const scale = Math.max(lowest, Math.min(highest, Math.max(w / w0, h / h0)));
    w = w0 * scale; h = h0 * scale;
  } else {
    w = Math.max(min.w * width, Math.min(width, w));
    h = Math.max(min.h * height, Math.min(height, h));
  }
  const ox = sx * (w - w0) / 2, oy = sy * (h - h0) / 2;
  const cx = (box.x + box.w / 2) * width + c * ox - s * oy;
  const cy = (box.y + box.h / 2) * height + s * ox + c * oy;
  const nw = w / width, nh = h / height;
  return { ...box, w: nw, h: nh,
    x: Math.max(0, Math.min(1 - nw, cx / width - nw / 2)),
    y: Math.max(0, Math.min(1 - nh, cy / height - nh / 2)),
  };
}
