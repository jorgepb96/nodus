import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ArgumentBlock, ArgumentMap } from '@shared/types';
import { EDGE_LABELS, Icon, NODE_LABELS } from '../ui';
import { t, tx } from '../../i18n';
import { CARD_HEIGHT, CARD_WIDTH, layoutArgumentMap } from './layout';
import { fitArgumentCamera, focusArgumentCamera, restoreArgumentCamera, type Camera, type Viewport } from './camera';
import './argumentMap.css';
import { useCanvasPinch } from '../../hooks/useCanvasPinch';
import { pinchTranslation } from '@shared/touchCamera';

const COLORS: Record<string, string> = {
  supports: '#63cbb0', refutes: '#ee91a6', contradicts: '#ee91a6', extends: '#8caef4',
  refines: '#ba9cf0', applies_to: '#e3bf79', shares_method: '#76cbd6', precondition_of: '#df9fcb',
  measures_same: '#76cbd6', variant_of: '#ba9cf0', related: '#9ba9c7', framing: '#ba9cf0', root: '#c0acf4',
};
const relationLabel = (relation: string) => t(EDGE_LABELS[relation as keyof typeof EDGE_LABELS] ?? (relation === 'framing' ? 'encuadre' : 'relacionada'));
const AUTO_FOCUS_KEY = 'nodus.argumentMap.autoFocus';
type CameraNavigation = { kind: 'overview' | 'manual' } | { kind: 'focus'; id: string };

export function ArgumentMapCanvas({ map, onSelect, fullscreen, onToggleFullscreen, fullscreenError }: {
  map: ArgumentMap;
  onSelect: (block: ArgumentBlock) => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  fullscreenError: boolean;
}) {
  const [expanded, setExpanded] = useState(() => new Set([map.root.id]));
  const [relation, setRelation] = useState('');
  const [selected, setSelected] = useState(map.root.id);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const [autoFocus, setAutoFocus] = useState(() => localStorage.getItem(AUTO_FOCUS_KEY) !== 'false');
  const [navigation, setNavigation] = useState<CameraNavigation>({ kind: 'overview' });
  const [history, setHistory] = useState<{ camera: Camera; size: Viewport }[]>([]);
  const [animateCamera, setAnimateCamera] = useState(false);
  const previousSize = useRef<Viewport>({ width: 0, height: 0 });
  useEffect(() => { localStorage.setItem(AUTO_FOCUS_KEY, String(autoFocus)); }, [autoFocus]);

  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; camera: Camera } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const nodes = useMemo(() => layoutArgumentMap(map.root, expanded, relation), [map.root, expanded, relation]);
  const positions = useMemo(() => new Map(nodes.map(node => [node.block.id, node])), [nodes]);
  const relations = useMemo(() => {
    const counts = new Map<string, number>();
    for (const child of map.root.children) counts.set(child.relation, (counts.get(child.relation) ?? 0) + 1);
    return [...counts];
  }, [map.root]);
  const activePath = useMemo(() => {
    const ids = new Set<string>();
    let node = positions.get(selected);
    while (node) { ids.add(node.block.id); node = node.parentId ? positions.get(node.parentId) : undefined; }
    for (const node of nodes) if (node.parentId === selected) ids.add(node.block.id);
    return ids;
  }, [nodes, positions, selected]);

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width && entry.contentRect.height) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!size.width || !size.height) return;
    const oldSize = previousSize.current;
    previousSize.current = size;
    if (navigation.kind === 'overview') setCamera(fitArgumentCamera(nodes, size));
    else if (navigation.kind === 'focus') setCamera(focusArgumentCamera(nodes, navigation.id, size, cameraRef.current.zoom));
    else if (oldSize.width && (oldSize.width !== size.width || oldSize.height !== size.height)) {
      // Manual exploration keeps its scale when the evidence panel opens.
      setCamera(current => ({ ...current, x: current.x + (size.width - oldSize.width) / 2, y: current.y + (size.height - oldSize.height) / 2 }));
    }
  }, [nodes, size, navigation]);

  const fit = () => {
    setAnimateCamera(true);
    setHistory([]);
    setNavigation({ kind: 'overview' });
  };
  const chooseRelation = (next: string) => { setRelation(next); fit(); };
  const select = (block: ArgumentBlock) => {
    setSelected(block.id);
    if (autoFocus) {
      if (navigation.kind !== 'focus' || navigation.id !== block.id) {
        setHistory(current => [...current.slice(-19), { camera: cameraRef.current, size }]);
      }
      setAnimateCamera(true);
      setNavigation({ kind: 'focus', id: block.id });
    } else {
      setNavigation({ kind: 'manual' });
    }
    if (block.ideaId) onSelect(block);
  };
  const previousView = () => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory(current => current.slice(0, -1));
    setAnimateCamera(true);
    setNavigation({ kind: 'manual' });
    setCamera(restoreArgumentCamera(previous.camera, previous.size, size));
  };
  const takeManualControl = useCallback(() => {
    setAnimateCamera(false);
    setNavigation(current => current.kind === 'manual' ? current : { kind: 'manual' });
  }, []);

  const zoomAt = useCallback((factor: number, x: number, y: number) => {
    takeManualControl();
    setCamera(current => {
      const zoom = Math.max(0.025, Math.min(1.8, current.zoom * factor));
      return { zoom, x: x - (x - current.x) * zoom / current.zoom, y: y - (y - current.y) * zoom / current.zoom };
    });
  }, [takeManualControl]);
  const pinchCamera = useRef(camera);
  const pinching = useCanvasPinch(stage, () => {
    drag.current = null; pinchCamera.current = cameraRef.current; takeManualControl();
  }, (start, next) => setCamera(pinchTranslation(pinchCamera.current, start, next)));
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [zoomAt]);

  return <div className="argument-atlas" data-testid="argument-map-canvas">
    <div className="argument-atlas-heading">
      <div><div className="argument-eyebrow">{t('CARTOGRAFÍA DEL ARGUMENTO')}</div><h2>{map.seedLabel}</h2></div>
      <span className="argument-map-count"><i />{tx('{n} ideas', { n: map.ideaCount })}</span>
    </div>
    {map.overview && <p className="argument-overview">{map.overview}</p>}
    <div className="argument-relations" aria-label={t('Relaciones')}>
      <button aria-pressed={!relation} onClick={() => chooseRelation('')}>{t('Todas las ramas')} <span>{map.root.children.length}</span></button>
      {relations.map(([key, count]) => <button key={key} aria-pressed={relation === key} onClick={() => chooseRelation(relation === key ? '' : key)} style={{ '--branch-color': COLORS[key] ?? COLORS.related } as CSSProperties}><i />{relationLabel(key)}<span>{count}</span></button>)}
    </div>
    <div className="argument-stage" ref={stage} tabIndex={0} aria-label={t('Canvas de ideas. Arrastra para navegar; usa la rueda para ampliar.')}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key === '0') fit();
        else if (event.key === '+' || event.key === '=') zoomAt(1.2, size.width / 2, size.height / 2);
        else if (event.key === '-') zoomAt(1 / 1.2, size.width / 2, size.height / 2);
        else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
          event.preventDefault();
          takeManualControl();
          setCamera(c => ({ ...c, x: c.x + (event.key === 'ArrowLeft' ? 50 : event.key === 'ArrowRight' ? -50 : 0), y: c.y + (event.key === 'ArrowUp' ? 50 : event.key === 'ArrowDown' ? -50 : 0) }));
        }
      }}
      onPointerDown={event => {
        if (pinching.current) return;
        if ((event.target as HTMLElement).closest('button') || event.button !== 0) return;
        event.preventDefault();
        takeManualControl();
        event.currentTarget.focus({ preventScroll: true });
        drag.current = { x: event.clientX, y: event.clientY, camera };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        if (pinching.current) return;
        const start = drag.current;
        if (start) setCamera({ ...start.camera, x: start.camera.x + event.clientX - start.x, y: start.camera.y + event.clientY - start.y });
      }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onLostPointerCapture={() => { drag.current = null; }} onDragStart={event => event.preventDefault()}>
      <div className={`argument-world ${animateCamera ? 'is-camera-animated' : ''}`} style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
        <svg className="argument-wires" aria-hidden="true">
          {nodes.filter(node => node.parentId).map(node => {
            const parent = positions.get(node.parentId!)!;
            const x1 = parent.x + node.side * CARD_WIDTH / 2;
            const x2 = node.x - node.side * CARD_WIDTH / 2;
            const mid = (x1 + x2) / 2;
            const color = COLORS[node.block.relation] ?? COLORS.related;
            const path = `M ${x1} ${parent.y} C ${mid} ${parent.y}, ${mid} ${node.y}, ${x2} ${node.y}`;
            return <g key={node.block.id} className={activePath.has(node.block.id) ? 'is-traced' : ''} style={{ color }}>
              <path d={path} className="argument-wire-glow" /><path d={path} className="argument-wire" strokeDasharray={['refutes', 'contradicts'].includes(node.block.relation) ? '5 5' : undefined} />
              <circle cx={x2} cy={node.y} r="3" fill={color} />
            </g>;
          })}
        </svg>
        {nodes.map(({ block, x, y, parentId }) => <article key={block.id} data-block-id={block.id}
          className={`argument-node ${parentId ? '' : 'is-root'} ${selected === block.id ? 'is-selected' : ''}`}
          style={{ left: x - CARD_WIDTH / 2, top: y - CARD_HEIGHT / 2, width: CARD_WIDTH, height: CARD_HEIGHT, '--branch-color': COLORS[block.relation] ?? COLORS.related } as CSSProperties}>
          <button className="argument-node-content" aria-pressed={selected === block.id} onClick={() => select(block)} title={[block.label, block.statement || block.summary].filter(Boolean).join('\n')}>
            <span className="argument-node-relation"><i />{parentId ? relationLabel(block.relation) : t('IDEA CENTRAL')}{!parentId && <Icon name="map" size={13} />}</span>
            <strong>{block.label}</strong><span className="argument-node-statement">{block.statement || block.summary}</span>
          </button>
          <div className="argument-node-footer"><span>{t(block.type === 'framing' ? 'encuadre' : NODE_LABELS[block.type])}</span>
            {block.children.length > 0 && <button aria-expanded={expanded.has(block.id)} aria-label={`${expanded.has(block.id) ? t('Contraer rama') : t('Desplegar rama')}: ${block.label}`} onClick={() => setExpanded(current => { const next = new Set(current); if (next.has(block.id)) next.delete(block.id); else next.add(block.id); return next; })}><Icon name={expanded.has(block.id) ? 'minus' : 'plus'} size={11} />{block.children.length}</button>}
            {!!block.hiddenChildren && <span title={tx('+{n} conexiones no dibujadas', { n: block.hiddenChildren })}>+{block.hiddenChildren} ···</span>}
          </div>
        </article>)}
      </div>
      <div className="argument-canvas-caption"><span className="argument-eyebrow">{t('SIGUE EL HILO')}</span><span>{fullscreen ? map.seedLabel : t('Despliega una rama. Contrasta sus ideas.')}</span></div>
      <div className="argument-stage-actions">
      <button className="argument-auto-focus" role="switch" aria-checked={autoFocus} title={t('Centrar y ampliar la tarjeta al seleccionarla')} onClick={() => { setAutoFocus(value => !value); takeManualControl(); }}>
        <span className="argument-switch-track"><i /></span>{t('Zoom automático')}
      </button>
      <button className="argument-fullscreen-toggle" aria-pressed={fullscreen} onClick={onToggleFullscreen}>
        <Icon name={fullscreen ? 'minimize' : 'maximize'} size={15} />
        {fullscreen ? t('Salir de pantalla completa') : t('Pantalla completa')}
      </button>
      </div>
      {fullscreenError && <p className="argument-fullscreen-error" role="alert">{t('No se pudo activar la pantalla completa.')}</p>}
      <div className="argument-camera-controls">
        <button title={t('Alejar')} aria-label={t('Alejar')} onClick={() => zoomAt(1 / 1.2, size.width / 2, size.height / 2)}><Icon name="minus" size={15} /></button>
        <span>{Math.round(camera.zoom * 100)}%</span>
        <button title={t('Acercar')} aria-label={t('Acercar')} onClick={() => zoomAt(1.2, size.width / 2, size.height / 2)}><Icon name="plus" size={15} /></button>
        <button onClick={previousView} disabled={!history.length} title={t('Recuperar el encuadre anterior sin cerrar las ramas')}>{t('Vista anterior')}</button>
        <button onClick={fit}>{t('Encuadrar')}</button>
        <button onClick={() => { fit(); setRelation(''); setExpanded(new Set([map.root.id])); setSelected(map.root.id); }}>{t('Volver al inicio')}</button>
      </div>
    </div>
    <footer className="argument-atlas-footer"><span>{tx('{n} ideas visibles', { n: nodes.length })} · {t('Relaciones respecto a la idea de origen')}</span><span>{map.truncated ? t('subgrafo recortado') : t('Arrastra para explorar · Rueda para ampliar')}</span></footer>
  </div>;
}
