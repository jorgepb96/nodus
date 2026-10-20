import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TTS_LANGUAGES, type TtsLanguage } from '@shared/ttsModels';
import type { TtsVoice } from '@shared/ttsVoices';
import { Icon } from '../ui';
import { t } from '../../i18n';
import './voicePicker.css';

/** A voice with the downloaded checkpoint that can actually speak its language. */
export interface VoicePickerOption {
  voice: TtsVoice;
  engine: 'ming' | 'phonon';
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
  const [engine, setEngine] = useState<'all' | 'ming' | 'phonon'>('all');
  const [language, setLanguage] = useState<'all' | TtsLanguage>('all');
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
    return ([['ming', 'Ming'], ['phonon', 'Phonon']] as const).filter(([id]) => present.has(id));
  }, [options]);

  const filtered = useMemo(() => {
    const needle = normalize(query.trim());
    return options.filter((option) => {
      if (engine !== 'all' && option.engine !== engine) return false;
      if (language !== 'all' && option.voice.language !== language) return false;
      if (!needle) return true;
      const languageLabel = TTS_LANGUAGES.find((entry) => entry.code === option.voice.language)?.label ?? '';
      return normalize([option.voice.name, option.voice.locale ?? '', option.voice.description ?? '', languageLabel].join(' ')).includes(needle);
    }).sort((a, b) => a.engine === b.engine ? a.voice.name.localeCompare(b.voice.name, undefined, { sensitivity: 'base', numeric: true }) : a.engine === 'ming' ? -1 : 1);
  }, [options, engine, language, query]);

  const groups = useMemo(() => {
    const byEngine = new Map<'ming' | 'phonon', VoicePickerOption[]>();
    for (const option of filtered) byEngine.set(option.engine, [...(byEngine.get(option.engine) ?? []), option]);
    return [...byEngine.entries()];
  }, [filtered]);

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
      // The header balloon closes on a handled Escape too; keep the picker layer first.
      event.preventDefault();
      event.stopPropagation();
      close();
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
        <label className="voice-picker-filter">
          <span>{t('Modelo')}</span>
          <select aria-label={t('Modelo')} value={engine} onChange={(event) => setEngine(event.target.value as typeof engine)} data-testid="listen-voice-filter-model">
            <option value="all">{t('Todos')}</option>
            {engines.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label className="voice-picker-filter">
          <span>{t('Idioma')}</span>
          <select aria-label={t('Idioma')} value={language} onChange={(event) => setLanguage(event.target.value as typeof language)} data-testid="listen-voice-filter-language">
            <option value="all">{t('Todos')}</option>
            {languages.map((entry) => <option key={entry.code} value={entry.code}>{entry.label}</option>)}
          </select>
        </label>
        {(engine !== 'all' || language !== 'all' || query) && <button type="button" className="voice-picker-clear" onClick={() => { setEngine('all'); setLanguage('all'); setQuery(''); }} title={t('Limpiar')} aria-label={t('Limpiar')}><Icon name="x" size={12} /></button>}
      </div>
      <div className="voice-picker-list" id={listId} role="listbox" aria-label={t('Todas las voces')}>
        {groups.map(([group, entries]) => <div key={group} className="voice-picker-group">
          <div className="voice-picker-group-label">{group === 'ming' ? 'Ming' : 'Phonon'}</div>
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
      </div>
    </div>}
  </div>;
}
