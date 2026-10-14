import { useId, useState, type KeyboardEvent } from 'react';
import { Icon } from './ui';
import { useDismissableLayer } from '../hooks';
import { t } from '../i18n';
import './galleryFilters.css';

/**
 * The filter and sort controls of the report galleries (Deep Research, its Study and
 * Teaching variants, Inmersión and database Deep Research).
 *
 * They replace native selects for two reasons. A select can hold one value, and a
 * gallery cut is often "these two of five" — unread reports of two approaches, guides
 * and reports in English. And a native select is drawn by the operating system, so it
 * ignored the vault accent and the light theme the rest of the toolbar follows.
 *
 * An empty selection means "no filter": every option is let through. That keeps the
 * stored and in-memory forms trivially compatible with the old single-value selects,
 * whose "all" is now simply nothing ticked.
 */

export interface GalleryFilterOption<T extends string = string> {
  value: T;
  label: string;
  /** How many items in the gallery carry this value; shown at the right of the row. */
  count?: number;
}

/** Arrow keys walk the rows of an open menu; Home/End jump to its ends. */
function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-gallery-filter-row]'));
  if (!rows.length) return;
  event.preventDefault();
  const current = rows.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? rows.length - 1
      : event.key === 'ArrowDown'
        ? (current + 1) % rows.length
        : (current - 1 + rows.length) % rows.length;
  rows[next]?.focus();
}

export function GalleryFilterMenu<T extends string>({
  label,
  icon,
  options,
  selected,
  onChange,
  testId,
  emptyLabel,
}: {
  label: string;
  icon: string;
  options: GalleryFilterOption<T>[];
  selected: T[];
  onChange: (next: T[]) => void;
  testId?: string;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const ref = useDismissableLayer<HTMLDivElement>({ open, onDismiss: () => setOpen(false), group: 'gallery-filters' });
  const active = selected.length > 0;
  const toggle = (value: T) =>
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);

  // One choice reads in full ("Estado: No leídos"); several collapse to a count, or the
  // toolbar would grow a line every time the reader ticks another box.
  const single = selected.length === 1 ? options.find((option) => option.value === selected[0]) : undefined;

  return (
    <div className="gallery-filter" ref={ref}>
      <button
        type="button"
        className={`gallery-filter-trigger${active ? ' is-active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        data-testid={testId}
      >
        <Icon name={icon} size={13} />
        <span className="gallery-filter-label">{label}</span>
        {single && <span className="gallery-filter-value">{single.label}</span>}
        {selected.length > 1 && <span className="gallery-filter-count">{selected.length}</span>}
        <Icon name="chevronDown" size={11} className={`gallery-filter-chevron${open ? ' is-open' : ''}`} />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className="gallery-filter-panel"
          onKeyDown={moveFocus}
          data-testid={testId ? `${testId}-menu` : undefined}
        >
          <div className="gallery-filter-head">
            <span>{label}</span>
            {active && (
              <button type="button" className="gallery-filter-clear" onClick={() => onChange([])}>
                {t('Limpiar')}
              </button>
            )}
          </div>
          {options.length === 0 ? (
            <p className="gallery-filter-empty">{emptyLabel ?? t('Sin opciones')}</p>
          ) : (
            <div className="gallery-filter-rows">
              {options.map((option, index) => {
                const checked = selected.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={checked}
                    className={`gallery-filter-row${checked ? ' is-checked' : ''}`}
                    onClick={() => toggle(option.value)}
                    autoFocus={index === 0}
                    data-gallery-filter-row
                    data-value={option.value}
                  >
                    <span className="gallery-filter-box" aria-hidden>
                      {checked && <Icon name="check" size={11} />}
                    </span>
                    <span className="gallery-filter-row-label">{option.label}</span>
                    {option.count !== undefined && <span className="gallery-filter-row-count">{option.count}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function GallerySortMenu<T extends string>({
  options,
  value,
  onChange,
  testId,
}: {
  options: GalleryFilterOption<T>[];
  value: T;
  onChange: (next: T) => void;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const ref = useDismissableLayer<HTMLDivElement>({ open, onDismiss: () => setOpen(false), group: 'gallery-filters' });
  const current = options.find((option) => option.value === value) ?? options[0];
  const label = t('Ordenar por');

  return (
    <div className="gallery-filter" ref={ref}>
      <button
        type="button"
        className="gallery-filter-trigger"
        onClick={() => setOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${label}: ${current?.label ?? ''}`}
        title={label}
        data-testid={testId}
        data-value={value}
      >
        <Icon name="sort" size={13} />
        <span className="gallery-filter-label">{current?.label}</span>
        <Icon name="chevronDown" size={11} className={`gallery-filter-chevron${open ? ' is-open' : ''}`} />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className="gallery-filter-panel is-right"
          onKeyDown={moveFocus}
          data-testid={testId ? `${testId}-menu` : undefined}
        >
          <div className="gallery-filter-head"><span>{label}</span></div>
          <div className="gallery-filter-rows">
            {options.map((option) => {
              const checked = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={checked}
                  className={`gallery-filter-row${checked ? ' is-checked' : ''}`}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  autoFocus={checked}
                  data-gallery-filter-row
                  data-value={option.value}
                >
                  <span className="gallery-filter-radio" aria-hidden>
                    {checked && <Icon name="check" size={12} />}
                  </span>
                  <span className="gallery-filter-row-label">{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Shown only while some filter is on: one click back to the whole gallery. */
export function GalleryFilterReset({ count, onClear }: { count: number; onClear: () => void }) {
  if (count <= 0) return null;
  return (
    <button type="button" className="gallery-filter-reset" onClick={onClear} data-testid="gallery-filter-reset">
      <Icon name="x" size={12} /> {t('Limpiar filtros')}
    </button>
  );
}

/**
 * The read-state filter stored by the galleries is still the old tri-state union, so a
 * stored preference written by an earlier version keeps meaning the same thing. Ticking
 * both boxes lets everything through, exactly like ticking none, so both store "all".
 */
export type ReadState = 'read' | 'unread';
export type StoredReadFilter = 'all' | ReadState;

export function readStatesFromFilter(filter: StoredReadFilter | undefined): ReadState[] {
  return filter === 'read' || filter === 'unread' ? [filter] : [];
}

export function readFilterFromStates(states: readonly ReadState[]): StoredReadFilter {
  return states.length === 1 ? states[0] : 'all';
}

/** Empty means "no filter", so every value passes. */
export function passesFilter<T extends string>(selected: readonly T[], value: T | null | undefined): boolean {
  return selected.length === 0 || (value != null && selected.includes(value));
}
