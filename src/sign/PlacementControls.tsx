import { useId, useState } from 'react';
import { t } from '../i18n';
import { adjustSignBox, type SignBox } from './geometry';
import { resolveSignPages, type SignPageTarget } from './pages';

export function PlacementControls({ box, onChange, disabled = false }: {
  box: SignBox; onChange: (box: SignBox) => void; disabled?: boolean;
}) {
  const [proportional, setProportional] = useState(true);
  return <fieldset className="sign-placement-controls" disabled={disabled}>
    <legend>{t('Posición y tamaño')}</legend>
    <p>{t('Arrastra la firma sobre la página para moverla. Usa los tiradores para cambiar su tamaño: las esquinas conservan las proporciones y Mayús las libera.')}</p>
    <details className="sign-precise">
      <summary>{t('Ajuste preciso')}</summary>
      <p>{t('Porcentajes de la página. La posición se mide desde la esquina superior izquierda.')}</p>
      <div className="sign-dimensions">
        {(['x', 'y', 'w', 'h'] as const).map((key, index) => <label key={key}>
          {t(['Posición horizontal', 'Posición vertical', 'Ancho de firma', 'Alto de firma'][index])} (%)
          <input type="number" min={key === 'w' || key === 'h' ? 1 : 0} max={100} step={0.1}
            aria-label={`${t(['Posición horizontal', 'Posición vertical', 'Ancho de firma', 'Alto de firma'][index])} (%)`}
            value={Number((box[key] * 100).toFixed(1))}
            onChange={e => {
              if (e.target.value !== '' && Number.isFinite(e.target.valueAsNumber))
                onChange(adjustSignBox(box, key, e.target.valueAsNumber / 100, proportional));
            }} />
        </label>)}
      </div>
      <label className="sign-check"><input type="checkbox" checked={proportional} onChange={e => setProportional(e.target.checked)} />{t('Mantener proporciones')}</label>
    </details>
    <label>{t('Colocación rápida')}
      <select aria-label={t('Colocación rápida')} value="" onChange={e => {
        if (!e.target.value) return;
        const [horizontal, vertical] = e.target.value.split('-').map(Number);
        const margin = 0.03;
        onChange({ ...box, x: horizontal === 1 ? (1 - box.w) / 2 : horizontal === 0 ? Math.min(margin, 1 - box.w) : Math.max(0, 1 - box.w - margin), y: vertical === 1 ? (1 - box.h) / 2 : vertical === 0 ? Math.min(margin, 1 - box.h) : Math.max(0, 1 - box.h - margin) });
      }}>
        <option value="">{t('Elegir posición…')}</option>
        {['Arriba a la izquierda', 'Arriba en el centro', 'Arriba a la derecha', 'Centro a la izquierda', 'Centro', 'Centro a la derecha', 'Abajo a la izquierda', 'Abajo en el centro', 'Abajo a la derecha'].map((label, i) => <option key={label} value={`${i % 3}-${Math.floor(i / 3)}`}>{t(label)}</option>)}
      </select>
    </label>
  </fieldset>;
}

export function PageTargetControls({ target, onChange, page, count, disabled = false }: {
  target: SignPageTarget; onChange: (target: SignPageTarget) => void; page: number; count: number; disabled?: boolean;
}) {
  const help = useId();
  const pages = resolveSignPages(target, page, count);
  return <fieldset className="sign-page-target" disabled={disabled || !count}>
    <legend>{t('Páginas de la firma')}</legend>
    <label>{t('Mostrar en')}
      <select aria-label={t('Páginas de la firma')} value={target.mode} onChange={e => onChange({ ...target, mode: e.target.value as SignPageTarget['mode'] })}>
        <option value="current">{t('Página actual')} ({page})</option>
        <option value="all">{t('Todas las páginas')} ({count})</option>
        <option value="custom">{t('Páginas específicas')}</option>
      </select>
    </label>
    {target.mode === 'custom' && <label>{t('Páginas o intervalos')}
      <input type="text" aria-label={t('Páginas o intervalos')} aria-describedby={help} aria-invalid={!pages.length} value={target.range} placeholder="1, 3-5" onChange={e => onChange({ ...target, range: e.target.value })} />
    </label>}
    <p id={help} className={!pages.length && count ? 'sign-input-error' : ''}>
      {!pages.length && count ? t('Indica páginas válidas, por ejemplo: 1, 3-5.') : `${t('Páginas seleccionadas')}: ${pages.join(', ') || '—'}`}
    </p>
    <p>{t('Se conserva la misma posición y tamaño relativos en cada página.')}</p>
  </fieldset>;
}
