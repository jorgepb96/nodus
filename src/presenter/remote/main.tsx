// Nodus Presenter — the MOBILE remote page, served by the presenter's LAN server and
// opened by scanning the QR. It is a plain browser app (no nodus IPC): it speaks to
// the app over a WebSocket carrying the same PresenterActions the windows use, and
// streams the PDF + notes over HTTP. It mirrors the live tool overlays, shows the
// speaker notes, drives navigation (buttons + swipe), the timer, black screen and a
// "local preview" mode to read ahead without moving the audience.
import { createRoot } from 'react-dom/client';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Icon } from '../../components/ui';
import { setActiveLang, t } from '../../i18n';
import { normalizeBrowserUiLanguage } from '@shared/uiLanguage';
import {
  initialPresenterState,
  presenterReducer,
  type PresenterAction,
  type PresenterRuntimeState,
  type ToolName,
} from '@shared/presenterState';
import { FittedSlideRenderer } from '../../lib/presenter/renderSlide';
import { ToolOverlayController } from '../../lib/presenter/tools';
import { createThumbSession, type ThumbSession } from '../../lib/presenter/thumbSession';
import { PresenterToolbar } from '../PresenterToolbar';
import { noteParagraphs } from '../deck';
import { loadMobilePdf } from './mobilePdf';
import { installTooltipLayer } from '../../tooltipLayer';
import '../../index.css';

function apiUrl(p: string, pin: string): string {
  return `${p}${p.includes('?') ? '&' : '?'}pin=${encodeURIComponent(pin)}`;
}

function RemoteApp({ pin, onInvalidPin }: { pin: string; onInvalidPin: () => void }) {
  const [ui, setUi] = useState<PresenterRuntimeState>(() => initialPresenterState());
  const [connected, setConnected] = useState(false);
  const [everConnected, setEverConnected] = useState(false);
  const [localPreview, setLocalPreview] = useState(false);
  const [localSlide, setLocalSlide] = useState(1);
  const [notesFont, setNotesFont] = useState(16);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [videos, setVideos] = useState<Record<string, unknown>>({});
  const [carouselOpen, setCarouselOpen] = useState(false);
  const [volume, setVolume] = useState(50);
  // Notes panel height (px). null = the default ~third of the screen; the divider above
  // the notes lets the presenter trade slide-preview space for more room to read notes.
  const [notesH, setNotesH] = useState<number | null>(null);

  const stateRef = useRef(ui);
  const wsRef = useRef<WebSocket | null>(null);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const loadedPdfId = useRef<string | null>(null);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const previewWrapRef = useRef<HTMLDivElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<FittedSlideRenderer | null>(null);
  const toolCtlRef = useRef<ToolOverlayController | null>(null);
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const notesRef = useRef<HTMLDivElement | null>(null);
  const draggingNotesRef = useRef(false);
  const sessionRef = useRef<ThumbSession | null>(null);
  const localPreviewRef = useRef(false);
  const localSlideRef = useRef(1);
  const pinchRef = useRef(0);
  const pinchScaleRef = useRef(1);
  const touchStartRef = useRef({ x: 0, y: 0 });
  localPreviewRef.current = localPreview;
  localSlideRef.current = localSlide;

  const displayedSlide = localPreview ? localSlide : ui.currentSlide;
  const displayedRef = useRef(displayedSlide);
  displayedRef.current = displayedSlide;

  const send = useCallback((action: PresenterAction) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(action));
  }, []);

  const renderDisplayed = useCallback((slide: number) => {
    if (pdfDocRef.current) void rendererRef.current?.render(pdfDocRef.current, slide);
  }, []);

  const loadDeck = useCallback(async (pdfId: string) => {
    if (loadedPdfId.current === pdfId) return;
    loadedPdfId.current = pdfId;
    try {
      const [doc, pres] = await Promise.all([
        loadMobilePdf(apiUrl(`/api/pdf/${encodeURIComponent(pdfId)}`, pin)),
        fetch(apiUrl(`/api/presentation/${encodeURIComponent(pdfId)}`, pin)).then((r) => (r.ok ? r.json() : null)),
      ]);
      const prev = pdfDocRef.current;
      pdfDocRef.current = doc;
      if (prev) void prev.destroy();
      setNotes(pres?.notes ?? {});
      setVideos(pres?.videos ?? {});
      renderDisplayed(displayedRef.current);
    } catch (err) {
      console.error('Mobile deck load failed:', err);
      loadedPdfId.current = null;
    }
  }, [pin, renderDisplayed]);

  // Apply an action to local state + overlays. `fromLocal` also sends it upstream.
  const apply = useCallback(
    (action: PresenterAction, fromLocal: boolean) => {
      const prev = stateRef.current;
      const next = presenterReducer(prev, action);
      stateRef.current = next;
      setUi(next);
      if (fromLocal) send(action);

      // Tool overlays: only while showing the live slide (not previewing ahead).
      const live = !localPreviewRef.current || displayedRef.current === next.currentSlide;
      const ctl = toolCtlRef.current;
      if (ctl && live) {
        if (action.type === 'setTool') ctl.setActiveTool(action.tool);
        else if (action.type === 'setToolSize') ctl.setSize(action.tool, action.size);
        else if (action.type === 'setToolColor') ctl.setColor(action.color);
        else if (action.type === 'setZoomFactor') ctl.setZoomFactor(action.factor);
        else if (action.type === 'toolData') ctl.applyToolData(action.data);
        else if (action.type === 'clearDraw') ctl.clearDraw();
      }
      if (!fromLocal && !localPreviewRef.current && next.currentSlide !== prev.currentSlide) {
        renderDisplayed(next.currentSlide);
        toolCtlRef.current?.clearDraw();
      }
      if (next.pdfId && next.pdfId !== prev.pdfId) void loadDeck(next.pdfId);
    },
    [send, renderDisplayed, loadDeck],
  );
  const applyRef = useRef(apply);
  applyRef.current = apply;

  // ── WebSocket ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}/?pin=${encodeURIComponent(pin)}`);
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        setEverConnected(true);
      };
      ws.onmessage = (e) => {
        let msg: { kind: string; state?: PresenterRuntimeState; action?: PresenterAction };
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.kind === 'state' && msg.state) {
          const s = msg.state;
          stateRef.current = s;
          setUi(s);
          if (s.pdfId) void loadDeck(s.pdfId);
        } else if (msg.kind === 'action' && msg.action) {
          applyRef.current(msg.action, false);
        }
      };
      ws.onclose = (event) => {
        setConnected(false);
        if (event.code === 4001) {
          closed = true;
          onInvalidPin();
          return;
        }
        if (!closed) retry = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      wsRef.current?.close();
      void pdfDocRef.current?.destroy();
    };
  }, [loadDeck, onInvalidPin, pin]);

  // Set up renderer + tool overlay whenever the preview UI is (re)mounted. A momentary
  // WS drop unmounts the whole remote screen (screen !== 'remote') and remounts a FRESH
  // canvas on reconnect; keying on connected+presenting (i.e. the preview being on screen)
  // rebinds the renderer to that new canvas and repaints — otherwise rendererRef keeps
  // drawing to the old, detached canvas and the visible preview stays black.
  const previewMounted = connected && ui.presenting;
  useEffect(() => {
    if (!previewMounted) return undefined;
    if (previewCanvasRef.current && previewContainerRef.current) {
      rendererRef.current = new FittedSlideRenderer(previewCanvasRef.current, previewContainerRef.current);
    }
    if (previewWrapRef.current) {
      toolCtlRef.current = new ToolOverlayController(previewWrapRef.current, () => previewCanvasRef.current);
      toolCtlRef.current.setColor(stateRef.current.toolColor);
      toolCtlRef.current.setActiveTool(stateRef.current.toolMode);
    }
    renderDisplayed(displayedRef.current); // paint the current slide onto the fresh canvas
    return () => {
      toolCtlRef.current?.destroy();
      toolCtlRef.current = null;
      rendererRef.current = null;
    };
  }, [previewMounted, renderDisplayed]);

  // Fitting follows the notes divider and mobile viewport changes as well.
  useEffect(() => {
    if (!previewMounted || !previewContainerRef.current) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => renderDisplayed(displayedRef.current));
    });
    observer.observe(previewContainerRef.current);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [previewMounted, renderDisplayed]);

  // Re-render when the displayed slide changes.
  useEffect(() => {
    renderDisplayed(displayedSlide);
    toolCtlRef.current?.clearDraw();
    carouselRef.current
      ?.querySelector<HTMLElement>(`[data-carousel="${displayedSlide}"]`)
      ?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [displayedSlide, renderDisplayed]);

  // ── Navigation ───────────────────────────────────────────────────────────────
  const nudge = useCallback(
    (delta: number) => {
      if (localPreviewRef.current) {
        const total = stateRef.current.totalSlides || 1;
        setLocalSlide((s) => Math.min(Math.max(s + delta, 1), total));
      } else {
        apply({ type: delta > 0 ? 'next' : 'prev' }, true);
      }
    },
    [apply],
  );

  const gotoSlide = useCallback(
    (slide: number) => {
      if (localPreviewRef.current) {
        const total = stateRef.current.totalSlides || 1;
        setLocalSlide(Math.min(Math.max(slide, 1), total));
      } else {
        apply({ type: 'navigate', slide }, true);
      }
    },
    [apply],
  );

  const toggleLocalPreview = useCallback(() => {
    setLocalPreview((p) => {
      const nextVal = !p;
      if (nextVal) setLocalSlide(stateRef.current.currentSlide);
      return nextVal;
    });
  }, []);

  // ── Notes/preview divider (drag up = taller notes, shorter slide preview) ────────
  const onDividerDown = (e: React.PointerEvent) => {
    draggingNotesRef.current = true;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onDividerMove = (e: React.PointerEvent) => {
    if (!draggingNotesRef.current) return;
    const bottom = notesRef.current?.getBoundingClientRect().bottom ?? window.innerHeight;
    const max = Math.max(140, window.innerHeight * 0.7);
    setNotesH(Math.min(max, Math.max(72, bottom - e.clientY)));
  };
  const onDividerUp = () => { draggingNotesRef.current = false; };

  // ── Touch: tools (1 finger), swipe (1 finger, no tool), pinch zoom (2 fingers) ──
  const posOf = (touch: { clientX: number; clientY: number }) => {
    const rect = previewWrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return { x: 50, y: 50 };
    return {
      x: Math.min(100, Math.max(0, ((touch.clientX - rect.left) / rect.width) * 100)),
      y: Math.min(100, Math.max(0, ((touch.clientY - rect.top) / rect.height) * 100)),
    };
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = Math.hypot(dx, dy);
      pinchScaleRef.current = stateRef.current.slideZoom.scale;
      return;
    }
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    const st = stateRef.current;
    if (localPreviewRef.current || !st.toolMode) return;
    const { x, y } = posOf(e.touches[0]);
    if (st.toolMode === 'draw') {
      apply({ type: 'toolData', data: { tool: 'draw', action: 'start', x, y, color: st.toolColor, lineWidth: Math.max(1, st.toolSizes.draw) } }, true);
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current > 0) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const scale = Math.min(Math.max(pinchScaleRef.current * (Math.hypot(dx, dy) / pinchRef.current), 1), 5);
      apply({ type: 'slideZoom', data: { scale, originX: 50, originY: 50 } }, true);
      return;
    }
    const st = stateRef.current;
    if (localPreviewRef.current || !st.toolMode) return;
    const { x, y } = posOf(e.touches[0]);
    if (st.toolMode === 'draw') apply({ type: 'toolData', data: { tool: 'draw', action: 'move', x, y, color: st.toolColor, lineWidth: Math.max(1, st.toolSizes.draw) } }, true);
    else if (st.toolMode === 'flashlight') apply({ type: 'toolData', data: { tool: 'flashlight', x, y, r: st.toolSizes.flashlight } }, true);
    else if (st.toolMode === 'pointer') apply({ type: 'toolData', data: { tool: 'pointer', x, y, size: st.toolSizes.pointer } }, true);
    else if (st.toolMode === 'zoom') apply({ type: 'toolData', data: { tool: 'zoom', x, y } }, true);
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (pinchRef.current > 0 && e.touches.length < 2) pinchRef.current = 0;
    const st = stateRef.current;
    if (!localPreviewRef.current && st.toolMode === 'draw') {
      apply({ type: 'toolData', data: { tool: 'draw', action: 'end' } }, true);
      return;
    }
    if (st.toolMode) return;
    // Swipe navigation.
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) nudge(dx < 0 ? 1 : -1);
  };

  // Carousel thumbnails (built lazily when opened).
  useEffect(() => {
    if (!carouselOpen || !carouselRef.current || !pdfDocRef.current) return;
    sessionRef.current?.destroy();
    sessionRef.current = createThumbSession({
      container: carouselRef.current,
      scrollRoot: carouselRef.current,
      doc: pdfDocRef.current,
      pageCount: pdfDocRef.current.numPages,
      scale: 0.3,
      rootMargin: '0px 800px',
      buildItem: (pageNum) =>
        buildRemoteThumb(pageNum, () => {
          gotoSlide(pageNum);
          setCarouselOpen(false);
        }),
    });
    return () => {
      sessionRef.current?.destroy();
      sessionRef.current = null;
    };
  }, [carouselOpen, gotoSlide]);

  // Pull the current system volume once a presentation is live.
  useEffect(() => {
    if (!ui.presenting) return;
    void fetch(apiUrl('/api/volume', pin))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d.volume === 'number') setVolume(d.volume);
      })
      .catch(() => {});
  }, [pin, ui.presenting]);

  const paras = useMemo(() => noteParagraphs(notes[String(displayedSlide)]), [notes, displayedSlide]);
  const screen = !connected ? (everConnected ? 'reconnecting' : 'connecting') : ui.presenting ? 'remote' : 'waiting';
  const zoom = ui.slideZoom;

  const emit = (a: PresenterAction) => apply(a, true);

  return (
    <div className="fixed inset-0 flex flex-col bg-neutral-950 text-neutral-100" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {screen !== 'remote' ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <Icon name="presentation" size={40} className="text-amber-400" />
          <h1 className="text-lg font-semibold">Nodus Presenter</h1>
          <p className="text-sm text-neutral-400">
            {screen === 'connecting'
              ? t('Conectando al servidor…')
              : screen === 'reconnecting'
                ? t('Reconectando…')
                : t('Conectado. Esperando a que empiece una presentación…')}
          </p>
        </div>
      ) : (
        <>
          {/* Top bar */}
          <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
            <button
              type="button"
              onClick={() => emit({ type: 'timerToggle', timerSeconds: ui.timerSeconds })}
              title={ui.timerRunning ? t('Pausar') : t('Iniciar')}
              className={`text-sm tabular-nums ${ui.timerRunning ? 'text-emerald-400' : 'text-neutral-400'}`}
            >
              {formatTimer(ui.timerSeconds)}
            </button>
            <button type="button" onClick={() => emit({ type: 'timerReset' })} title={t('Reiniciar temporizador')} className="text-neutral-500">
              <Icon name="rotateCcw" size={14} />
            </button>
            <span className="flex-1" />
            <span className="text-sm tabular-nums text-neutral-300">
              {displayedSlide} / {ui.totalSlides || '…'}
            </span>
            <button type="button" onClick={() => setCarouselOpen(true)} title={t('Diapositivas')} className="rounded p-1 hover:bg-white/10">
              <Icon name="grid" size={18} />
            </button>
            <button
              type="button"
              onClick={toggleLocalPreview}
              title={t('Vista local de notas')}
              className={`rounded p-1 ${localPreview ? 'bg-amber-500/25 text-amber-300' : 'hover:bg-white/10'}`}
            >
              <Icon name="eye" size={18} />
            </button>
          </div>

          {/* Slide preview */}
          <div ref={previewContainerRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black p-2">
            <div
              ref={previewWrapRef}
              className="shrink-0"
              style={zoom.scale > 1 ? { transform: `scale(${zoom.scale})`, transformOrigin: `${zoom.originX}% ${zoom.originY}%` } : undefined}
            >
              <canvas ref={previewCanvasRef} className="block max-w-none" />
            </div>
            {ui.blackScreen && !localPreview && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-black text-xs text-neutral-600">{t('Pantalla en negro')}</div>
            )}
            {/* Touch surface (tools / swipe / pinch). touch-action:none keeps the browser
                from scrolling/refreshing so the tool tracks the finger 1:1. */}
            <div
              className="absolute inset-0 z-10"
              style={{ touchAction: 'none' }}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
            />
            {localPreview && (
              <span className="absolute left-2 top-2 z-20 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-medium text-black">
                {t('Vista local')}
              </span>
            )}
          </div>

          {/* Tools */}
          <div className="flex justify-center border-t border-white/10 bg-neutral-950 px-2 py-1.5">
            <PresenterToolbar
              activeTool={ui.toolMode}
              color={ui.toolColor}
              size={ui.toolMode ? ui.toolSizes[ui.toolMode as ToolName] : ui.toolSizes.pointer}
              zoomFactor={ui.zoomFactor}
              onSetTool={(tool) => emit({ type: 'setTool', tool })}
              onSetColor={(color) => emit({ type: 'setToolColor', color })}
              onSetSize={(size) => ui.toolMode && emit({ type: 'setToolSize', tool: ui.toolMode, size })}
              onSetZoomFactor={(factor) => emit({ type: 'setZoomFactor', factor })}
              onClear={() => emit({ type: 'clearDraw' })}
            />
          </div>

          {/* System volume */}
          <div className="flex items-center gap-2 border-t border-white/10 px-3 py-1.5 text-neutral-400">
            <Icon name="volume" size={16} />
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              title={t('Volumen')}
              aria-label={t('Volumen')}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setVolume(v);
                void fetch(apiUrl(`/api/volume?set=${v}`, pin)).catch(() => {});
              }}
              className="min-w-0 flex-1 accent-amber-400"
            />
            <span className="w-6 text-right text-xs tabular-nums">{volume}</span>
          </div>

          {/* Drag handle: resize notes vs. slide preview */}
          <div
            onPointerDown={onDividerDown}
            onPointerMove={onDividerMove}
            onPointerUp={onDividerUp}
            onPointerCancel={onDividerUp}
            style={{ touchAction: 'none' }}
            title={t('Ajustar tamaño de las notas')}
            aria-label={t('Ajustar tamaño de las notas')}
            className="flex h-5 shrink-0 cursor-row-resize items-center justify-center border-t border-white/10 bg-neutral-900 active:bg-white/5"
          >
            <div className="h-1 w-10 rounded-full bg-white/25" />
          </div>

          {/* Notes */}
          <div
            ref={notesRef}
            className={`flex flex-col p-2 ${notesH == null ? 'max-h-[32%] min-h-24' : 'shrink-0'}`}
            style={notesH == null ? undefined : { height: notesH }}
          >
            <div className="mb-1 flex items-center justify-between text-xs text-neutral-500">
              <span>{t('Notas')}</span>
              <div className="flex items-center gap-2">
                <button type="button" title={t('Reducir')} aria-label={t('Reducir')} onClick={() => setNotesFont((f) => Math.max(10, f - 2))}>
                  <Icon name="minus" size={14} />
                </button>
                <span className="w-6 text-center">{notesFont}</span>
                <button type="button" title={t('Aumentar')} aria-label={t('Aumentar')} onClick={() => setNotesFont((f) => Math.min(32, f + 2))}>
                  <Icon name="plus" size={14} />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ fontSize: `${notesFont}px` }}>
              {paras.length ? (
                paras.map((p, i) => (
                  <p key={i} className="mb-2 indent-[1em] whitespace-pre-wrap leading-relaxed text-neutral-200">
                    {p}
                  </p>
                ))
              ) : (
                <p className="text-sm italic text-neutral-600">{t('Sin notas para esta diapositiva')}</p>
              )}
            </div>
          </div>

          {/* Bottom bar: black + prev/next */}
          <div className="flex items-center gap-2 border-t border-white/10 p-2" style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}>
            <button
              type="button"
              onClick={() => emit({ type: 'blackScreen', enabled: !ui.blackScreen })}
              title={t('Pantalla en negro')}
              className={`rounded-lg p-2.5 ${ui.blackScreen ? 'bg-amber-500/25 text-amber-300' : 'bg-white/5 hover:bg-white/10'}`}
            >
              <Icon name="eyeOff" size={18} />
            </button>
            {Boolean(videos[String(displayedSlide)]) && (
              <button
                type="button"
                onClick={() => emit({ type: 'videoToggle' })}
                title={t('Reproducir/Pausar vídeo')}
                className={`rounded-lg p-2.5 ${ui.videoPlaying ? 'bg-amber-500/25 text-amber-300' : 'bg-white/5 hover:bg-white/10'}`}
              >
                <Icon name={ui.videoPlaying ? 'pause' : 'play'} size={18} />
              </button>
            )}
            <button type="button" title={t('Anterior')} aria-label={t('Anterior')} onClick={() => nudge(-1)} className="flex flex-1 items-center justify-center rounded-lg bg-white/5 py-3 active:bg-white/15">
              <Icon name="chevronLeft" size={24} />
            </button>
            <button type="button" title={t('Siguiente')} aria-label={t('Siguiente')} onClick={() => nudge(1)} className="flex flex-1 items-center justify-center rounded-lg bg-white/5 py-3 active:bg-white/15">
              <Icon name="chevronRight" size={24} />
            </button>
          </div>

          {/* Carousel overlay */}
          {carouselOpen && (
            <div className="fixed inset-0 z-30 flex flex-col justify-end bg-black/70" onClick={() => setCarouselOpen(false)}>
              <div className="bg-neutral-900 p-3" onClick={(e) => e.stopPropagation()}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium">{t('Diapositivas')}</span>
                  <button type="button" title={t('Cerrar')} aria-label={t('Cerrar')} onClick={() => setCarouselOpen(false)}>
                    <Icon name="x" size={20} />
                  </button>
                </div>
                <div ref={carouselRef} className="flex h-28 gap-2 overflow-x-auto" />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PresenterRemoteRoot() {
  const [pin, setPin] = useState('');
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);

  if (pin) {
    return <RemoteApp pin={pin} onInvalidPin={() => { setPin(''); setDraft(''); setInvalid(true); }} />;
  }

  return (
    <main className="fixed inset-0 grid place-items-center bg-neutral-950 p-5 text-neutral-100" data-testid="presenter-pin-gate">
      <form
        className="w-full max-w-sm rounded-3xl border border-white/10 bg-neutral-900 p-7 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          const next = draft.replace(/\D/g, '').slice(0, 6);
          if (next.length !== 6) { setInvalid(true); return; }
          setInvalid(false);
          setPin(next);
        }}
      >
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-400 text-neutral-950 shadow-lg shadow-amber-400/20">
          <Icon name="presentation" size={25} />
        </span>
        <h1 className="mt-5 text-center text-xl font-semibold">Nodus Presenter</h1>
        <p className="mt-2 text-center text-sm leading-relaxed text-neutral-400">{t('Introduce el PIN que aparece en Nodus.')}</p>
        <label htmlFor="presenter-pin" className="mt-6 block text-xs font-medium text-neutral-300">{t('PIN')}</label>
        <input
          id="presenter-pin"
          autoFocus
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          value={draft}
          onChange={(event) => { setDraft(event.target.value.replace(/\D/g, '').slice(0, 6)); setInvalid(false); }}
          placeholder="000000"
          className="mt-2 h-14 w-full rounded-xl border border-white/15 bg-neutral-950 px-4 text-center font-mono text-2xl tracking-[0.3em] text-white outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-400/10"
        />
        {invalid && <p role="alert" className="mt-2 text-center text-xs text-rose-400">{t('Código incorrecto.')}</p>}
        <button type="submit" className="mt-4 h-12 w-full rounded-xl bg-amber-400 font-semibold text-neutral-950 active:bg-amber-300">{t('Conectar')}</button>
      </form>
    </main>
  );
}

function formatTimer(sec: number): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(sec / 3600))}:${p(Math.floor((sec % 3600) / 60))}:${p(sec % 60)}`;
}

function buildRemoteThumb(pageNum: number, onClick: () => void) {
  const element = document.createElement('button');
  element.type = 'button';
  element.title = `${t('Diapositiva')} ${pageNum}`;
  element.setAttribute('aria-label', element.title);
  element.dataset.carousel = String(pageNum);
  element.className = 'relative h-full shrink-0 overflow-hidden rounded border border-white/10 bg-neutral-800';
  element.addEventListener('click', onClick);
  const canvas = document.createElement('canvas');
  canvas.className = 'block h-full w-auto';
  const label = document.createElement('span');
  label.className = 'absolute bottom-0 left-0 bg-black/70 px-1 text-[9px] text-white';
  label.textContent = String(pageNum);
  element.appendChild(canvas);
  element.appendChild(label);
  return { element, canvas };
}

const el = document.getElementById('presenter-root');
if (el) {
  setActiveLang(normalizeBrowserUiLanguage(navigator.language));
  installTooltipLayer();
  createRoot(el).render(<PresenterRemoteRoot />);
}
