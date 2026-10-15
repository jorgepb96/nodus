import { useCallback, useEffect, useRef, useState } from 'react';
import type { ViewNode } from '@shared/capabilities';
import { Icon } from './ui';
import { t } from '../i18n';
import './chatModelViewer.css';

/** The core's 3D viewer: `nodus:3d` on the screen.
 *
 *  A capability hands over a glTF or GLB asset and gets back nothing but an attachment id.
 *  What draws it is this, and only this — there is no route by which a package supplies a
 *  renderer, a shader, a script or a stylesheet, because the only thing that crosses the
 *  boundary is a file the core has already parsed and judged.
 *
 *  Three properties are deliberate. The asset is parsed from bytes already in memory, so
 *  nothing is fetched while a model opens. The loader is given a resource path that
 *  resolves nowhere, so a glTF that asks for an external buffer or texture fails to find
 *  it rather than reaching the network. And three.js is imported the first time a model is
 *  actually shown, so a conversation that contains none never pays for it. */

type ModelNode = Extract<ViewNode, { kind: 'model' }>;

interface Loaded {
  dispose: () => void;
  reset: () => void;
  fit: () => void;
}

const MAX_PIXEL_RATIO = 2;

export function ChatModelViewer({ node, owner, staticPreview = false }: { node: ModelNode; owner?: string; staticPreview?: boolean }) {
  const mount = useRef<HTMLDivElement | null>(null);
  const loaded = useRef<Loaded | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [detail, setDetail] = useState('');
  const [open, setOpen] = useState(staticPreview);

  // Bumped by every load and every teardown. A viewer that finishes building after the
  // model was closed, the message unmounted or a newer load started belongs to nobody: it is
  // disposed at once instead of keeping a WebGL context and a render loop alive off screen.
  const generation = useRef(0);

  const teardown = useCallback(() => {
    generation.current++;
    loaded.current?.dispose();
    loaded.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  const load = useCallback(async () => {
    if (!owner || !mount.current || loaded.current) return;
    const ticket = ++generation.current;
    setState('loading');
    setDetail('');
    try {
      // Everything heavy arrives here and nowhere else: a conversation with no model in
      // it never loads a renderer.
      const [{ default: build }, asset] = await Promise.all([
        import('../lib/modelViewer'),
        window.nodus.readCapabilityModel(`nodus-capability://chat/${owner}/${node.attachmentId}`),
      ]);
      if (!mount.current || ticket !== generation.current) return;
      const viewer = await build({
        container: mount.current,
        bytes: asset.bytes,
        mimeType: asset.mimeType,
        maxPixelRatio: MAX_PIXEL_RATIO,
        label: node.alt,
      });
      if (ticket !== generation.current) { viewer.dispose(); return; }
      loaded.current = viewer;
      setState('ready');
    } catch (error) {
      if (ticket !== generation.current) return;
      teardown();
      setState('failed');
      setDetail(error instanceof Error ? error.message : String(error));
    }
  }, [node.attachmentId, node.alt, owner, teardown]);

  useEffect(() => {
    if (open) void load();
    else teardown();
  }, [open, load, teardown]);

  return <figure className="capability-view-model" data-state={state}>
    <figcaption>
      <span className="capability-view-model-title"><Icon name="cube" size={14} />{node.title}</span>
      <span className="capability-view-model-meta">{node.name} · {formatBytes(node.bytes)}</span>
    </figcaption>

    {/* The model is opened on request. A conversation that scrolled past ten of them would
        otherwise start ten WebGL contexts, which browsers cap and then start discarding. */}
    {!open && <button type="button" className="chat-skill-primary capability-view-model-open" disabled={!owner} onClick={() => setOpen(true)}>
      <Icon name="cube" size={15} />{t('Abrir el modelo 3D')}
    </button>}

    {open && <>
      <div className="capability-view-model-stage" ref={mount} role="img" aria-label={node.alt} />
      {state === 'loading' && <p className="capability-view-model-status" role="status">{t('Cargando el modelo…')}</p>}
      {state === 'failed' && <p className="capability-view-model-status" role="alert">{t('Este modelo no se pudo abrir.')}{detail ? ` ${detail}` : ''}</p>}
      <div className="capability-view-model-controls">
        <button type="button" className="chat-skill-secondary" onClick={() => loaded.current?.reset()} disabled={state !== 'ready'}>{t('Vista inicial')}</button>
        <button type="button" className="chat-skill-secondary" onClick={() => loaded.current?.fit()} disabled={state !== 'ready'}>{t('Ajustar a la pantalla')}</button>
        <button type="button" className="chat-skill-secondary" onClick={() => { setOpen(false); setState('idle'); }}>{t('Cerrar el modelo')}</button>
      </div>
      <p className="capability-view-model-hint">{t('Arrastra para girar, rueda para acercar, arrastra con el botón derecho para desplazar.')}</p>
    </>}
  </figure>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
