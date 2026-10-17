import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { SignSignature, SignTrackpadFrame, SignTrackpadSurface } from "@shared/signTypes";
import { ModalBackdrop, Icon } from "../components/ui";
import { signErrorText } from "./errors";
import { t } from "../i18n";
import { initialCrop, loadSignImage, trimSignature } from "./images";
import { followFinger, restingPen, trackpadArea, trackpadPoint, type TrackpadArea } from "./trackpad";
import { resizeFromHandle, type SignBox, type SignHandle } from "./geometry";
import { ResizeHandles } from "./ResizeHandles";
type Trackpad = "finger" | "cursor";
type Point = { x: number; y: number };
const W = 900,
  H = 300;

function Tool({ label, onClick, pressed, disabled, children, testId }: {
  label: string; onClick: () => void; pressed?: boolean; disabled?: boolean; children: ReactNode; testId?: string;
}) {
  return (
    <button type="button" className="btn btn-ghost sign-tool" title={t(label)} aria-label={t(label)}
      aria-pressed={pressed} disabled={disabled} data-testid={testId} onClick={onClick}>
      {children}
    </button>
  );
}

export function SignatureEditor({
  signature,
  onSave,
  onClose,
}: {
  signature?: SignSignature;
  onSave: (s: SignSignature) => Promise<void>;
  onClose: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(signature?.name ?? "");
  const [color, setColor] = useState("#17202d");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const strokes = useRef<string[]>([]);
  const redo = useRef<string[]>([]);
  const active = useRef<number | null>(null);
  // Every stroke is drawn segment by segment through the midpoints of its
  // samples, so a finger or a fast cursor leaves a smooth line, not a polygon.
  const stroke = useRef<{ last: Point; mid: Point } | null>(null);
  const [trackpad, setTrackpad] = useState<Trackpad | null>(null);
  const mode = useRef<Trackpad | null>(null);
  const [area, setArea] = useState<TrackpadArea | null>(null);
  const areaRef = useRef<TrackpadArea | null>(null);
  const finger = useRef(restingPen());
  const pen = useRef({ x: W / 2, y: H / 2, down: false });
  const locked = useRef(false);
  const endedAt = useRef(0);
  const marker = useRef<HTMLSpanElement>(null);
  const [crop, setCrop] = useState<SignBox | null>(null);
  const [cropping, setCropping] = useState(false);
  const croppingRef = useRef(false);
  croppingRef.current = cropping;
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    input.current?.focus();
    if (signature)
      void loadSignImage(signature.png).then((image) => {
        const ctx = canvas.current?.getContext("2d");
        if (ctx) {
          const scale = Math.min(850 / image.width, 250 / image.height);
          ctx.drawImage(image, (W - image.width * scale) / 2, (H - image.height * scale) / 2, image.width * scale, image.height * scale);
        }
      });
    return () => before?.focus();
  }, []);
  const snapshot = () => {
    strokes.current.push(canvas.current!.toDataURL());
    redo.current = [];
  };
  const restore = async (url?: string) => {
    const ctx = canvas.current!.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    if (url) ctx.drawImage(await loadSignImage(url), 0, 0);
  };
  const point = (e: PointerEvent) => {
    const box = canvas.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - box.left) * W) / box.width,
      y: ((e.clientY - box.top) * H) / box.height,
    };
  };
  const ink = (width: number) => {
    const ctx = canvas.current!.getContext("2d")!;
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = width;
    return ctx;
  };
  const beginStroke = (p: Point) => {
    snapshot();
    const ctx = ink(2.5);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.1, p.y + 0.1);
    ctx.stroke();
    stroke.current = { last: p, mid: p };
  };
  const extendStroke = (p: Point, width = 2.5) => {
    const current = stroke.current;
    if (!current) return;
    const mid = { x: (current.last.x + p.x) / 2, y: (current.last.y + p.y) / 2 };
    const ctx = ink(width);
    ctx.beginPath();
    ctx.moveTo(current.mid.x, current.mid.y);
    ctx.quadraticCurveTo(current.last.x, current.last.y, mid.x, mid.y);
    ctx.stroke();
    stroke.current = { last: p, mid };
  };
  const endStroke = () => {
    const current = stroke.current;
    stroke.current = null;
    if (!current) return;
    const ctx = ink(2.5);
    ctx.beginPath();
    ctx.moveTo(current.mid.x, current.mid.y);
    ctx.lineTo(current.last.x, current.last.y);
    ctx.stroke();
  };
  const showPen = (visible: boolean) => {
    const dot = marker.current;
    if (!dot) return;
    dot.hidden = !visible;
    dot.style.left = `${(pen.current.x / W) * 100}%`;
    dot.style.top = `${(pen.current.y / H) * 100}%`;
    dot.dataset.down = String(pen.current.down);
  };
  const start = (e: PointerEvent<HTMLCanvasElement>) => {
    if (mode.current === "cursor" && e.button === 0) {
      pen.current.down = true;
      beginStroke(pen.current);
      showPen(true);
    }
    if (mode.current || croppingRef.current || active.current !== null || e.button !== 0) return;
    active.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    beginStroke(point(e));
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (mode.current === "cursor") {
      // The cursor is locked and hidden: its motion moves a pen on the canvas.
      const box = canvas.current!.getBoundingClientRect();
      const p = pen.current;
      p.x = Math.min(W, Math.max(0, p.x + (e.movementX * W) / box.width));
      p.y = Math.min(H, Math.max(0, p.y + (e.movementY * H) / box.height));
      if (p.down && (e.buttons & 1) === 1) extendStroke(p);
      else if (p.down) {
        p.down = false;
        endStroke();
      }
      showPen(true);
    }
    if (mode.current || active.current !== e.pointerId) return;
    extendStroke(point(e), e.pointerType === "pen" ? 1.5 + e.pressure * 4 : 2.5);
  };
  const lift = (e: PointerEvent<HTMLCanvasElement>) => {
    if (mode.current === "cursor" && e.button === 0 && pen.current.down) {
      pen.current.down = false;
      endStroke();
      showPen(true);
    }
    if (active.current === e.pointerId) {
      active.current = null;
      endStroke();
    }
  };
  const onFinger = (frame: SignTrackpadFrame) => {
    if (mode.current !== "finger") return;
    // The frame names its own trackpad, so a Magic Trackpad is drawn to its own scale.
    const next = trackpadArea(frame);
    if (!areaRef.current || next.width !== areaRef.current.width || next.height !== areaRef.current.height) {
      areaRef.current = next;
      setArea(next);
    }
    const { pen: following, steps } = followFinger(finger.current, frame);
    finger.current = following;
    for (const step of steps) {
      if (step.kind === "end") endStroke();
      if (step.kind === "begin" || step.kind === "extend") {
        const p = trackpadPoint(step.contact, next);
        pen.current.x = p.x;
        pen.current.y = p.y;
        if (step.kind === "begin") beginStroke(p);
        else extendStroke(p);
      }
    }
    pen.current.down = following.id !== null;
    showPen(frame.contacts.length > 0);
  };
  const stopTrackpad = () => {
    if (!mode.current) return;
    if (mode.current === "finger") void window.nodus.stopSignTrackpad();
    mode.current = null;
    pen.current.down = false;
    endStroke();
    endedAt.current = Date.now();
    setTrackpad(null);
    setArea(null);
    areaRef.current = null;
    if (document.pointerLockElement) document.exitPointerLock();
  };
  const starting = useRef(false);
  const mounted = useRef(true);
  const startTrackpad = async () => {
    if (mode.current || starting.current) return;
    starting.current = true;
    const surface = canvas.current!;
    setCropping(false);
    locked.current = false;
    // The locked cursor cannot wander off and click another window while the
    // finger draws, and it carries the motion of the cursor mode.
    const lock = Promise.resolve(surface.requestPointerLock())
      .then(() => { if (document.pointerLockElement === surface) locked.current = true; })
      .catch(() => {});
    pen.current = { x: W / 2, y: H / 2, down: false };
    finger.current = restingPen();
    // Frames are only drawn once the mode is "finger", so none can land before.
    let size: SignTrackpadSurface | null = null;
    try {
      size = await window.nodus.startSignTrackpad(onFinger);
    } catch {
      size = null;
    }
    await lock;
    starting.current = false;
    if (!mounted.current) {
      // The editor closed while the trackpad was starting.
      if (size) void window.nodus.stopSignTrackpad();
      if (document.pointerLockElement === surface) document.exitPointerLock();
      return;
    }
    if (size) {
      areaRef.current = trackpadArea(size);
      setArea(areaRef.current);
      mode.current = "finger";
      setTrackpad("finger");
    } else if (document.pointerLockElement === surface) {
      mode.current = "cursor";
      setTrackpad("cursor");
    }
    // Without the finger or a locked cursor there is nothing the normal drawing lacks.
  };
  useEffect(() => {
    if (!trackpad) return;
    const onLock = () => {
      if (document.pointerLockElement === canvas.current) locked.current = true;
      else if (locked.current) stopTrackpad();
    };
    document.addEventListener("pointerlockchange", onLock);
    window.addEventListener("blur", stopTrackpad);
    return () => {
      document.removeEventListener("pointerlockchange", onLock);
      window.removeEventListener("blur", stopTrackpad);
    };
  }, [trackpad]);
  useEffect(() => {
    // Esc and Enter end the trackpad drawing, and Esc ends cropping. They must
    // not also close the editor or press the focused button, including the Esc
    // that released the pointer lock a moment earlier.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && croppingRef.current && !mode.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setCropping(false);
        return;
      }
      if (e.key !== "Escape" && e.key !== "Enter") return;
      if (!mode.current && Date.now() - endedAt.current > 500) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      stopTrackpad();
    };
    window.addEventListener("keydown", onKey, true);
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.removeEventListener("keydown", onKey, true);
      stopTrackpad();
    };
  }, []);
  const dragCrop = (e: PointerEvent<HTMLElement>, handle?: SignHandle) => {
    if (!crop) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    const box = canvas.current!.getBoundingClientRect();
    const origin = { x: e.clientX, y: e.clientY };
    const from = crop;
    target.setPointerCapture(e.pointerId);
    const onMove = (event: globalThis.PointerEvent) => {
      const dx = event.clientX - origin.x,
        dy = event.clientY - origin.y;
      setCrop(handle
        ? resizeFromHandle(from, handle, dx, dy, box.width, box.height, 0, false, { w: 0.03, h: 0.06 })
        : { ...from,
            x: Math.max(0, Math.min(1 - from.w, from.x + dx / box.width)),
            y: Math.max(0, Math.min(1 - from.h, from.y + dy / box.height)) });
    };
    const onEnd = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onEnd);
      target.removeEventListener("pointercancel", onEnd);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onEnd);
    target.addEventListener("pointercancel", onEnd);
  };
  const importImage = async (picked?: File) => {
    if (!picked) return;
    try {
      if (
        picked.size > 8 * 1024 * 1024 ||
        !["image/png", "image/jpeg", "image/webp"].includes(picked.type)
      )
        throw new Error("Usa una imagen PNG, JPEG o WebP de menos de 8 MB.");
      const url = URL.createObjectURL(picked);
      try {
        const image = await loadSignImage(url);
        snapshot();
        const ctx = canvas.current!.getContext("2d")!;
        ctx.clearRect(0, 0, W, H);
        const scale = Math.min(850 / image.width, 250 / image.height);
        ctx.drawImage(image, (W - image.width * scale) / 2, (H - image.height * scale) / 2, image.width * scale, image.height * scale);
        setCrop(null);
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      setError(signErrorText(e));
    }
  };
  const percent = (value: number, of: number) => `${(value / of) * 100}%`;
  const drawing = trackpad !== null;
  return (
    <ModalBackdrop
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sign-editor-title"
        className="sign-dialog"
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            const controls = dialog.current!.querySelectorAll<HTMLElement>(
              "button:not(:disabled), input:not([hidden]), canvas",
            );
            const first = controls[0],
              last = controls[controls.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <header>
          <h2 id="sign-editor-title">
            {t(signature ? "Editar firma" : "Crear firma manuscrita")}
          </h2>
          <button
            className="btn btn-ghost"
            aria-label={t("Cerrar")}
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </header>
        <p>
          {t(
            "Dibuja con el cursor, un lápiz o una pantalla táctil, o usa Dibujar en el trackpad.",
          )}
        </p>
        <label>
          {t("Nombre de la firma")}
          <input
            ref={input}
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="sign-drawing" data-trackpad={trackpad ?? undefined} data-cropping={cropping || undefined}>
          <canvas
            ref={canvas}
            width={W}
            height={H}
            data-testid="sign-drawing"
            aria-label={t("Superficie de dibujo")}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={lift}
            onPointerCancel={() => {
              active.current = null;
              endStroke();
            }}
          />
          {trackpad === "finger" && area && (
            <span
              className="sign-trackpad-area"
              data-testid="sign-trackpad-area"
              style={{ left: percent(area.x, W), top: percent(area.y, H), width: percent(area.width, W), height: percent(area.height, H) }}
            />
          )}
          {crop && !drawing && (
            <div
              className="sign-crop"
              data-testid="sign-crop"
              data-editing={cropping || undefined}
              style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
              onPointerDown={cropping ? (e) => dragCrop(e) : undefined}
            >
              {cropping && <ResizeHandles onPointerDown={dragCrop} />}
            </div>
          )}
          {drawing && <span ref={marker} className="sign-pen" hidden />}
        </div>
        {drawing ? (
          <p className="sign-trackpad-hint" role="status">
            {t(
              trackpad === "finger"
                ? "Dibuja con un dedo dentro del recuadro: es tu trackpad a escala. Levanta el dedo para separar trazos. Pulsa Esc o Intro para terminar."
                : "Mantén pulsado el trackpad y desliza para dibujar. Pulsa Esc o Intro para terminar.",
            )}
          </p>
        ) : cropping ? (
          <p className="sign-trackpad-hint" role="status">
            {t("Arrastra el marco o sus tiradores para elegir qué parte se guarda. Pulsa Esc para terminar.")}
          </p>
        ) : null}
        <div className="sign-toolbar" role="toolbar" aria-label={t("Herramientas de dibujo")}>
          <label className="sign-tool sign-color" title={t("Color")}>
            <input
              type="color"
              aria-label={t("Color")}
              value={color}
              disabled={drawing}
              onChange={(e) => setColor(e.target.value)}
            />
          </label>
          <Tool label="Dibujar en el trackpad" testId="sign-trackpad" pressed={drawing} disabled={cropping} onClick={() => void startTrackpad()}>
            <Icon name="trackpad" size={18} />
          </Tool>
          <span className="sign-tool-gap" />
          <Tool label="Deshacer" disabled={drawing} onClick={() => {
            const prior = strokes.current.pop();
            if (prior) {
              redo.current.push(canvas.current!.toDataURL());
              void restore(prior);
            }
          }}>
            <Icon name="undo" size={18} />
          </Tool>
          <Tool label="Rehacer" disabled={drawing} onClick={() => {
            const next = redo.current.pop();
            if (next) {
              strokes.current.push(canvas.current!.toDataURL());
              void restore(next);
            }
          }}>
            <Icon name="redo" size={18} />
          </Tool>
          <Tool label="Limpiar" disabled={drawing} onClick={() => {
            snapshot();
            void restore();
            setCrop(null);
            setCropping(false);
          }}>
            <Icon name="eraser" size={18} />
          </Tool>
          <span className="sign-tool-gap" />
          <Tool label="Recortar" testId="sign-crop-tool" pressed={cropping} disabled={drawing} onClick={() => {
            if (cropping) return setCropping(false);
            setCrop((current) => current ?? initialCrop(canvas.current!));
            setCropping(true);
          }}>
            <Icon name="crop" size={18} />
          </Tool>
          <Tool label="Importar imagen" disabled={drawing} onClick={() => file.current?.click()}>
            <Icon name="image" size={18} />
          </Tool>
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              void importImage(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Tool label="Quitar fondo claro" disabled={drawing} onClick={() => {
            snapshot();
            const ctx = canvas.current!.getContext("2d")!;
            const data = ctx.getImageData(0, 0, W, H);
            for (let i = 0; i < data.data.length; i += 4) {
              const whiteness = Math.min(
                data.data[i],
                data.data[i + 1],
                data.data[i + 2],
              );
              if (whiteness > 225)
                data.data[i + 3] = Math.round(
                  (data.data[i + 3] * (255 - whiteness)) / 30,
                );
            }
            ctx.putImageData(data, 0, 0);
          }}>
            <Icon name="wand" size={18} />
          </Tool>
        </div>
        {error && (
          <p role="alert" className="sign-error">
            {t(error)}
          </p>
        )}
        <footer>
          <button
            className="btn btn-secondary"
            onClick={onClose}
            disabled={busy}
          >
            {t("Cancelar")}
          </button>
          <button
            className="btn btn-primary"
            data-testid="sign-save-signature"
            disabled={!name.trim() || busy || drawing}
            onClick={async () => {
              setBusy(true);
              try {
                const image = trimSignature(canvas.current!, crop);
                await onSave({
                  id: signature?.id ?? crypto.randomUUID(),
                  name: name.trim(),
                  ...image,
                });
                onClose();
              } catch (e) {
                setError(signErrorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("Guardar firma")}
          </button>
        </footer>
      </div>
    </ModalBackdrop>
  );
}
