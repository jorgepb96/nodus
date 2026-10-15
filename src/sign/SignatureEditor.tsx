import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { SignSignature } from "@shared/signTypes";
import { ModalBackdrop, Icon } from "../components/ui";
import { signErrorText } from "./errors";
import { t } from "../i18n";
import { loadSignImage, trimSignature } from "./images";
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
  const [name, setName] = useState(signature?.name ?? "");
  const [color, setColor] = useState("#17202d");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const strokes = useRef<string[]>([]);
  const redo = useRef<string[]>([]);
  const active = useRef<number | null>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    input.current?.focus();
    if (signature)
      void loadSignImage(signature.png).then((image) => {
        const ctx = canvas.current?.getContext("2d");
        if (ctx) {
          const scale = Math.min(850 / image.width, 250 / image.height);
          ctx.drawImage(
            image,
            25,
            25,
            image.width * scale,
            image.height * scale,
          );
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
    ctx.clearRect(0, 0, 900, 300);
    if (url) ctx.drawImage(await loadSignImage(url), 0, 0);
  };
  const point = (e: PointerEvent) => {
    const box = canvas.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - box.left) * 900) / box.width,
      y: ((e.clientY - box.top) * 300) / box.height,
    };
  };
  const start = (e: PointerEvent<HTMLCanvasElement>) => {
    if (active.current !== null || e.button !== 0) return;
    snapshot();
    active.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    const ctx = canvas.current!.getContext("2d")!;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.1, p.y + 0.1);
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.5;
    ctx.stroke();
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (active.current !== e.pointerId) return;
    const p = point(e);
    const ctx = canvas.current!.getContext("2d")!;
    ctx.lineWidth = e.pointerType === "pen" ? 1.5 + e.pressure * 4 : 2.5;
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const importImage = async (file?: File) => {
    if (!file) return;
    try {
      if (
        file.size > 8 * 1024 * 1024 ||
        !["image/png", "image/jpeg", "image/webp"].includes(file.type)
      )
        throw new Error("Usa una imagen PNG, JPEG o WebP de menos de 8 MB.");
      const url = URL.createObjectURL(file);
      try {
        const image = await loadSignImage(url);
        snapshot();
        const ctx = canvas.current!.getContext("2d")!;
        ctx.clearRect(0, 0, 900, 300);
        const scale = Math.min(850 / image.width, 250 / image.height);
        ctx.drawImage(image, 25, 25, image.width * scale, image.height * scale);
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      setError(signErrorText(e));
    }
  };
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
              "button:not(:disabled), input, canvas",
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
            "Dibuja con el cursor, un lápiz o una pantalla táctil. El trackpad mueve el cursor; no captura el dedo directamente.",
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
        <canvas
          ref={canvas}
          width={900}
          height={300}
          data-testid="sign-drawing"
          aria-label={t("Superficie de dibujo")}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={(e) => {
            if (active.current === e.pointerId) active.current = null;
          }}
          onPointerCancel={() => {
            active.current = null;
          }}
        />
        <div className="sign-row">
          <label>
            {t("Color")}
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </label>
          <button
            className="btn btn-secondary"
            onClick={() => {
              const prior = strokes.current.pop();
              if (prior) {
                redo.current.push(canvas.current!.toDataURL());
                void restore(prior);
              }
            }}
          >
            {t("Deshacer")}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              const next = redo.current.pop();
              if (next) {
                strokes.current.push(canvas.current!.toDataURL());
                void restore(next);
              }
            }}
          >
            {t("Rehacer")}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              snapshot();
              void restore();
            }}
          >
            {t("Limpiar")}
          </button>
          <label className="btn btn-secondary">
            {t("Importar imagen")}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => void importImage(e.target.files?.[0])}
            />
          </label>
          <button
            className="btn btn-secondary"
            onClick={() => {
              snapshot();
              const ctx = canvas.current!.getContext("2d")!;
              const data = ctx.getImageData(0, 0, 900, 300);
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
            }}
          >
            {t("Quitar fondo claro")}
          </button>
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
            disabled={!name.trim() || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const image = trimSignature(canvas.current!);
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
