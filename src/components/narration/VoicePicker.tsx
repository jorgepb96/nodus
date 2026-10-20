import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TTS_LANGUAGES, type TtsLanguage } from '@shared/ttsModels';
import type { TtsVoice } from '@shared/ttsVoices';
import { Icon } from '../ui';
import { t } from '../../i18n';
import './voicePicker.css';

/** A voice with the downloaded checkpoint that can actually speak its language. */
export interface VoicePickerOption {
  voice: TtsVoice;
  engine: 'ming' | 'phonon' | 'kokoro';
  modelId: string;
  modelLabel: string;
}

const normalize = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/**
 * The voice selector shared by the listen balloon: a styled list with a search box and
 * model/language filters, rather than the native select whose long popup overflowed the
 * balloon. Selecting a voice also carries the downloaded model that supports its language.
 */
export function VoicePicker({ options, value, selectedName, onSelect, disabled = false }: {
  options: VoicePickerOption[];
  value: string;
  selectedName?: string;
  onSelect: (option: VoicePickerOption) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [engineFilter, setEngineFilter] = useState<Array<'ming' | 'phonon' | 'kokoro'>>([]);
  const [languageFilter, setLanguageFilter] = useState<TtsLanguage[]>([]);
  const [openFilter, setOpenFilter] = useState<'engine' | 'language' | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.voice.id === value);
  const label = selected?.voice.name || selectedName || t('Voz');

  const languages = useMemo(() => {
    const present = new Set(options.map((option) => option.voice.language));
    return TTS_LANGUAGES.filter((entry) => present.has(entry.code as TtsLanguage));
  }, [options]);
  const engines = useMemo(() => {
    const present = new Set(options.map((option) => option.engine));
    return ([['ming', 'Ming'], ['phonon', 'Phonon'], ['kokoro', 'Kokoro']] as const).filter(([id]) => present.has(id));
  }, [options]);

  const filtered = useMemo(() => {
    const needle = normalize(query.trim());
    return options.filter((option) => {
      if (engineFilter.length && !engineFilter.includes(option.engine)) return false;
      if (languageFilter.length && !languageFilter.includes(option.voice.language)) return false;
      if (!needle) return true;
      const languageLabel = TTS_LANGUAGES.find((entry) => entry.code === option.voice.language)?.label ?? '';
      return normalize([option.voice.name, option.voice.locale ?? '', option.voice.description ?? '', languageLabel].join(' ')).includes(needle);
    }).sort((a, b) => {
      const order = { ming: 0, phonon: 1, kokoro: 2 } as const;
      return order[a.engine] - order[b.engine]
        || a.voice.name.localeCompare(b.voice.name, undefined, { sensitivity: 'base', numeric: true });
    });
  }, [options, engineFilter, languageFilter, query]);

  const groups = useMemo(() => {
    const byEngine = new Map<'ming' | 'phonon' | 'kokoro', VoicePickerOption[]>();
    for (const option of filtered) byEngine.set(option.engine, [...(byEngine.get(option.engine) ?? []), option]);
    return [...byEngine.entries()];
  }, [filtered]);

  const engineSummary = engineFilter.length === 0
    ? t('Todos')
    : engineFilter.length === 1
      ? engines.find(([id]) => id === engineFilter[0])?.[1] ?? t('Todos')
      : `${engines.find(([id]) => id === engineFilter[0])?.[1] ?? ''} +${engineFilter.length - 1}`;
  const languageSummary = languageFilter.length === 0
    ? t('Todos')
    : languageFilter.length === 1
      ? languages.find((entry) => entry.code === languageFilter[0])?.label ?? t('Todos')
      : `${languages.find((entry) => entry.code === languageFilter[0])?.label ?? ''} +${languageFilter.length - 1}`;
  const toggle = <T,>(list: T[], value: T) => list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];

  const close = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) window.setTimeout(() => trigger.current?.focus({ preventScroll: true }));
  };

  useLayoutEffect(() => {
    if (!open) return;
    const panel = popup.current;
    const anchor = trigger.current;
    if (!panel || !anchor) return;
    panel.setAttribute('popover', 'manual');
    panel.showPopover();
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 300), window.innerWidth - 24);
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const upwards = below < 320 && above > below;
      if (upwards) {
        panel.style.top = 'auto';
        panel.style.bottom = `${window.innerHeight - rect.top + 6}px`;
      } else {
        panel.style.bottom = 'auto';
        panel.style.top = `${rect.bottom + 6}px`;
      }
      panel.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
      panel.style.width = `${width}px`;
      panel.style.maxHeight = `${Math.min(370, Math.max(220, upwards ? above : below))}px`;
    };
    place();
    const focus = window.requestAnimationFrame(() => search.current?.focus({ preventScroll: true }));
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    const onScroll = (event: Event) => { if (!panel.contains(event.target as Node)) place(); };
    window.addEventListener('resize', place);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      window.cancelAnimationFrame(focus);
      observer.disconnect();
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', onScroll, true);
      if (panel.matches(':popover-open')) panel.hidePopover();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (trigger.current?.contains(event.target as Node) || popup.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  const choose = (option: VoicePickerOption) => {
    onSelect(option);
    close();
  };

  return <div className="voice-picker" onKeyDown={(event) => {
    if (event.key === 'Escape' && open) {
      // First close the filter panel, then the picker; never the header balloon.
      event.preventDefault();
      event.stopPropagation();
      if (openFilter) setOpenFilter(null);
      else close();
    }
  }}>
    <button
      ref={trigger}
      type="button"
      className="voice-picker-trigger"
      data-testid="listen-voice"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? listId : undefined}
      aria-label={`${t('Voz')}: ${label}`}
      title={label}
      disabled={disabled}
      onClick={() => {
        if (open) close(false);
        else {
          setQuery('');
          setOpen(true);
        }
      }}
    >
      <Icon name="userVoice" size={14} />
      <span className="voice-picker-trigger-text">
        <span>{label}</span>
        {selected && <small>{TTS_LANGUAGES.find((entry) => entry.code === selected.voice.language)?.label}{selected.voice.locale ? ` · ${selected.voice.locale}` : ''}</small>}
      </span>
      <Icon name="chevronDown" size={14} />
    </button>

    {open && <div ref={popup} className="voice-picker-popover">
      <label className="header-balloon-search voice-picker-search">
        <Icon name="search" size={14} />
        <input
          ref={search}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('Buscar voces…')}
          aria-label={t('Buscar voces…')}
          data-testid="listen-voice-search"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <div className="voice-picker-filters">
        <div className="voice-picker-filter">
          <span className="voice-picker-filter-label">{t('Modelo')}</span>
          <button type="button" className={`voice-picker-filter-trigger ${openFilter === 'engine' ? 'is-open' : ''}`} aria-label={t('Modelo')} aria-haspopup="listbox" aria-expanded={openFilter === 'engine'} data-testid="listen-voice-filter-model" onClick={() => setOpenFilter((value) => value === 'engine' ? null : 'engine')}>
            <span>{engineSummary}</span><Icon name="chevronDown" size={12} />
          </button>
        </div>
        <div className="voice-picker-filter">
          <span className="voice-picker-filter-label">{t('Idioma')}</span>
          <button type="button" className={`voice-picker-filter-trigger ${openFilter === 'language' ? 'is-open' : ''}`} aria-label={t('Idioma')} aria-haspopup="listbox" aria-expanded={openFilter === 'language'} data-testid="listen-voice-filter-language" onClick={() => setOpenFilter((value) => value === 'language' ? null : 'language')}>
            <span>{languageSummary}</span><Icon name="chevronDown" size={12} />
          </button>
        </div>
        {(engineFilter.length > 0 || languageFilter.length > 0 || query) && <button type="button" className="voice-picker-clear" onClick={() => { setEngineFilter([]); setLanguageFilter([]); setQuery(''); setOpenFilter(null); }} title={t('Limpiar')} aria-label={t('Limpiar')}><Icon name="x" size={12} /></button>}
      </div>
      {openFilter === 'engine' || openFilter === 'language' ? <div className="voice-picker-choice-panel" role="listbox" aria-multiselectable="true" aria-label={openFilter === 'engine' ? t('Modelo') : t('Idioma')} data-testid="listen-voice-filter-panel">
        <div className="voice-picker-choice-head"><strong>{openFilter === 'engine' ? t('Modelo') : t('Idioma')}</strong><button type="button" className="voice-picker-choice-close" aria-label={t('Cerrar')} title={t('Cerrar')} onClick={() => setOpenFilter(null)}><Icon name="x" size={12} /></button></div>
        <label className="voice-picker-choice">
          <input type="checkbox" checked={(openFilter === 'engine' ? engineFilter : languageFilter).length === 0} onChange={() => { if (openFilter === 'engine') setEngineFilter([]); else setLanguageFilter([]); }} />
          <span>{t('Todos')}</span>
        </label>
        {openFilter === 'engine'
          ? engines.map(([id, name]) => <label key={id} className="voice-picker-choice"><input type="checkbox" checked={engineFilter.includes(id)} onChange={() => setEngineFilter((current) => toggle(current, id))} /><span>{name}</span></label>)
          : languages.map((entry) => <label key={entry.code} className="voice-picker-choice"><input type="checkbox" checked={languageFilter.includes(entry.code)} onChange={() => setLanguageFilter((current) => toggle(current, entry.code))} /><span>{entry.label}</span></label>)}
      </div> : <div className="voice-picker-list" id={listId} role="listbox" aria-label={t('Todas las voces')}>
        {groups.map(([group, entries]) => <div key={group} className="voice-picker-group">
          <div className="voice-picker-group-label">{group === 'ming' ? 'Ming' : group === 'phonon' ? 'Phonon' : 'Kokoro'}</div>
          {entries.map((option) => {
            const languageLabel = TTS_LANGUAGES.find((entry) => entry.code === option.voice.language)?.label ?? option.voice.language;
            const active = option.voice.id === value;
            return <button
              key={option.voice.id}
              type="button"
              role="option"
              aria-selected={active}
              className={`voice-picker-option ${active ? 'is-selected' : ''}`}
              data-testid={`listen-voice-option-${option.voice.id}`}
              title={option.voice.description ?? option.voice.name}
              onClick={() => choose(option)}
            >
              <span className="voice-picker-option-text">
                <strong>{option.voice.name}</strong>
                <small>{languageLabel}{option.voice.locale ? ` · ${option.voice.locale}` : ''} · {option.modelLabel}</small>
              </span>
              {active && <Icon name="check" size={13} />}
            </button>;
          })}
        </div>)}
        {!filtered.length && <p className="voice-picker-empty">{t('Ninguna voz coincide con los filtros.')}</p>}
      </div>}
    </div>}
  </div>;
}
