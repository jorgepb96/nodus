import { t, tx } from '../i18n';
import { Icon } from './ui';
import { researchChatQueue, type QueuedResearchTurn } from '../researchChatQueue';
import { useEffect, useState } from 'react';

export function ResearchChatQueue({ queueKey, items, paused, editingId, error, onEdit }: {
  queueKey: string; items: QueuedResearchTurn[]; paused: boolean; editingId: string | null; error: string;
  onEdit: (item: QueuedResearchTurn) => void;
}) {
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  useEffect(() => () => { researchChatQueue.change(queueKey, { draggingId: null }); }, [queueKey]);
  if (!items.length && !error) return null;
  return <div className="research-prompt-queue" data-testid="research-prompt-queue">
    <div className="research-prompt-queue-heading">
      <span><Icon name="list" size={14} />{tx('En cola ({n})', { n: items.length })}</span>
      <button type="button" onClick={() => researchChatQueue.change(queueKey, { paused: !paused, error: '' })} aria-label={t(paused ? 'Reanudar cola' : 'Pausar cola')}>
        <Icon name={paused ? 'play' : 'pause'} size={13} />{t(paused ? 'Reanudar cola' : 'Pausar cola')}
      </button>
    </div>
    {error && <p className="research-attachment-error" role="alert">{error}</p>}
    <ol className="research-prompt-queue-list" aria-label={t('Peticiones en cola')}>
      {items.map((item, index) => {
        const config = item.settings;
        const effortLabels: Record<string, string> = { standard: 'Estándar', none: 'Desactivado', off: 'Desactivado', minimal: 'Mínimo', low: 'Bajo', medium: 'Medio', high: 'Alto', xhigh: 'Muy alto', max: 'Máximo', ultra: 'Ultra', on: 'Thinking activado' };
        const effort = config.thinkingEffort ? t(effortLabels[config.thinkingEffort] ?? config.thinkingEffort) : null;
        const details = [config.model?.provider, config.model?.model, t(config.explorationMode === 'expanded' ? 'Ampliado' : 'Rápido'), effort, config.systemPromptSnapshot?.name ?? 'Default', config.concilium ? 'Concilium' : null, config.webSearch !== 'off' ? t('Web') : null, config.answerVerification === 'structured' ? t('Verificar fuentes') : null].filter(Boolean).join(' · ');
        return <li key={item.id} data-queue-id={item.id} className={`${editingId === item.id ? 'is-editing' : ''} ${dropTarget === item.id ? 'is-drop-target' : ''}`}
          onDragOver={event => {
            if (!researchChatQueue.get(queueKey).draggingId) return;
            event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(item.id);
            // Keep the list scrollable while holding a row near either edge.
            const list = event.currentTarget.parentElement!;
            const bounds = list.getBoundingClientRect();
            if (event.clientY < bounds.top + 28) list.scrollTop -= 10;
            if (event.clientY > bounds.bottom - 28) list.scrollTop += 10;
          }}
          onDrop={event => {
            const id = researchChatQueue.get(queueKey).draggingId;
            if (!id) return;
            event.preventDefault(); event.stopPropagation();
            researchChatQueue.move(queueKey, id, item.id); setDropTarget(null);
          }}>
          <button type="button" className="research-prompt-queue-drag" draggable={!editingId} aria-label={`${t('Arrastrar para reordenar')} ${index + 1}`} title={`${t('Arrastrar para reordenar')} · ↑/↓`}
            onDragStart={event => { event.stopPropagation(); event.dataTransfer.setData('text/plain', item.id); event.dataTransfer.effectAllowed = 'move'; researchChatQueue.change(queueKey, { draggingId: item.id }); }}
            onDragEnd={() => { researchChatQueue.change(queueKey, { draggingId: null }); setDropTarget(null); }}
            onKeyDown={event => {
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
              event.preventDefault();
              const next = items[index + (event.key === 'ArrowUp' ? -1 : 1)];
              if (next) researchChatQueue.move(queueKey, item.id, next.id);
            }}><span aria-hidden="true">⠿</span></button>
          <span className="research-prompt-queue-number">{index + 1}</span>
          <div className="research-prompt-queue-copy"><p title={item.content}>{item.content}</p><span title={details}>{details}{item.attachments.length ? ` · ${tx('{n} archivos', { n: item.attachments.length })}` : ''}</span></div>
          <button type="button" title={t('Editar petición')} aria-label={`${t('Editar petición')} ${index + 1}`} onClick={() => onEdit(item)}><Icon name="edit" size={15} /></button>
          <button type="button" title={t('Borrar petición')} aria-label={`${t('Borrar petición')} ${index + 1}`} onClick={() => researchChatQueue.change(queueKey, { deletingId: item.id })}><Icon name="trash" size={15} /></button>
        </li>;
      })}
    </ol>
  </div>;
}
