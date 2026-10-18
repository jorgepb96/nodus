import type { PointerEvent } from "react";
import { SIGN_HANDLES, type SignHandle } from "./geometry";

/** Eight handles around a box: corners keep the proportions (Shift frees them),
 * edges stretch one side. Keyboard users have the precise fields instead. */
export function ResizeHandles({ onPointerDown }: { onPointerDown: (e: PointerEvent<HTMLElement>, handle: SignHandle) => void }) {
  return <>
    {SIGN_HANDLES.map((handle) => (
      <span key={handle} className="sign-resize" data-handle={handle} aria-hidden="true"
        onPointerDown={(e) => onPointerDown(e, handle)} />
    ))}
  </>;
}
