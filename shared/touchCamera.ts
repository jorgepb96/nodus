export type TouchPoint = { x: number; y: number };
export type TouchCamera = TouchPoint & { zoom: number };
export function touchPair(a: TouchPoint, b: TouchPoint) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
}
export function pinchTranslation(camera: TouchCamera, start: ReturnType<typeof touchPair>, next: ReturnType<typeof touchPair>): TouchCamera {
  const zoom = Math.max(0.025, Math.min(1.8, camera.zoom * next.distance / start.distance));
  return { zoom, x: next.x - (start.x - camera.x) * zoom / camera.zoom, y: next.y - (start.y - camera.y) * zoom / camera.zoom };
}
export function pinchWorldCamera(camera: TouchCamera, start: ReturnType<typeof touchPair>, next: ReturnType<typeof touchPair>, size: { w: number; h: number }): TouchCamera {
  const zoom = Math.max(0.025, Math.min(4, camera.zoom * next.distance / start.distance));
  return { zoom, x: camera.x + (start.x - size.w / 2) / camera.zoom - (next.x - size.w / 2) / zoom,
    y: camera.y + (start.y - size.h / 2) / camera.zoom - (next.y - size.h / 2) / zoom };
}
