import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DatabaseColumn } from '@shared/databases';
import type { DatabaseCalendarViewConfig, DatabaseTimelineViewConfig } from '@shared/databaseViewConfig';
import type {FilterNode} from '@shared/databaseQuery';
import {
  layoutDatabaseTemporalOverlaps,
  shiftDatabaseLocalDate,
  type DatabaseTemporalEvent,
  type DatabaseTemporalEventPage,
} from '@shared/databaseTemporal';
import { Icon } from './ui';
import { t, tx } from '../i18n';
import { toast } from './feedback';

type TemporalCommonProps = {
  databaseId: string;
  columns: DatabaseColumn[];
  onOpen: (rowId: string) => void;
  onChanged: () => void;
  mobile?: boolean;
  readOnly?: boolean;
};

const DAY = 86_400_000;

function isoDay(date: Date): string { return date.toISOString().slice(0, 10); }
function dayDate(value: string): Date { return new Date(`${value.slice(0, 10)}T00:00:00.000Z`); }
function addDays(value: string, amount: number): string { return isoDay(new Date(dayDate(value).getTime() + amount * DAY)); }
function monthStart(day: string): string { return `${day.slice(0, 7)}-01`; }
function startOfWeek(day: string, weekStartsOn: 0 | 1): string {
  const date = dayDate(day); const offset = (date.getUTCDay() - weekStartsOn + 7) % 7;
  return isoDay(new Date(date.getTime() - offset * DAY));
}
function today(): string { return new Date().toISOString().slice(0, 10); }
function monthLabel(day: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(dayDate(day));
}
function dayLabel(day: string, detail: 'short' | 'long' = 'short'): string {
  return new Intl.DateTimeFormat(undefined, detail === 'short'
    ? { weekday: 'short', day: 'numeric', timeZone: 'UTC' }
    : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(dayDate(day));
}
function timeLabel(value: string): string { return value.includes('T') ? value.slice(11, 16) : ''; }
function durationDays(start: string, end: string): number { return Math.round((dayDate(end).getTime() - dayDate(start).getTime()) / DAY); }
function defaultZone(column: DatabaseColumn | undefined): string {
  const configured = typeof column?.config.dateTimeZone === 'string' ? column.config.dateTimeZone : '';
  return configured || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function useTemporalEvents(input: {
  databaseId: string;
  startColumnId: string | null;
  endColumnId: string | null;
  dependencyColumnId: string | null;
  windowStart: string;
  windowEnd: string;
  timeZone: string;
  filter?: FilterNode | null;
}) {
  const [page, setPage] = useState<DatabaseTemporalEventPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!input.startColumnId) { setPage(null); return; }
    setLoading(true); setError(null);
    try {
      setPage(await window.nodus.queryDatabaseTemporalEvents({ ...input, startColumnId: input.startColumnId, limit: 500 }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setLoading(false); }
  }, [input.databaseId, input.dependencyColumnId, input.endColumnId, input.startColumnId, input.timeZone, input.windowEnd, input.windowStart, input.filter]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { page, loading, error, refresh };
}

function TemporalStatus({ loading, error, truncated }: { loading: boolean; error: string | null; truncated: boolean }) {
  return <>
    {loading && <div role="status" data-testid="database-temporal-loading" className="absolute inset-x-0 top-0 z-30 flex justify-center"><span className="mt-2 rounded-full bg-white px-3 py-1 text-xs shadow dark:bg-neutral-900"><Icon name="sync" className="mr-1 inline animate-spin" />{t('Cargando eventos…')}</span></div>}
    {error && <div role="alert" data-testid="database-temporal-error" className="m-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{t('No se pudieron cargar los eventos.')} <span>{error}</span></div>}
    {truncated && <div role="status" className="border-b border-amber-300 bg-amber-50 px-3 py-1 text-center text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">{t('Se muestran los primeros 500 eventos de esta ventana.')}</div>}
  </>;
}

function TemporalToolbar({ anchor, label, onPrevious, onToday, onNext, children }: {
  anchor: string; label: string; onPrevious: () => void; onToday: () => void; onNext: () => void; children?: React.ReactNode;
}) {
  return <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800" data-anchor={anchor}>
    <button className="btn btn-ghost h-8 w-8 p-0" aria-label={t('Anterior')} onClick={onPrevious}><Icon name="chevronLeft" /></button>
    <button className="btn btn-ghost h-8 px-3" onClick={onToday}>{t('Hoy')}</button>
    <button className="btn btn-ghost h-8 w-8 p-0" aria-label={t('Siguiente')} onClick={onNext}><Icon name="chevronRight" /></button>
    <h3 className="min-w-0 flex-1 truncate text-sm font-semibold capitalize">{label}</h3>
    {children}
  </div>;
}

function eventDragData(event: DatabaseTemporalEvent): string {
  return JSON.stringify({ rowId: event.sourceRowId, start: event.start, end: event.end });
}

export function DatabaseCalendarView({ databaseId, columns, config, onOpen, onChanged, mobile = false, readOnly = false }: TemporalCommonProps & { config: DatabaseCalendarViewConfig | null }) {
  const dateColumns = columns.filter((column) => column.type === 'date');
  const startColumn = columns.find((column) => column.id === config?.dateColumnId && column.type === 'date') ?? dateColumns[0];
  const endColumn = columns.find((column) => column.id === config?.endDateColumnId && column.type === 'date') ?? null;
  const scale = config?.scale ?? 'month'; const weekStartsOn = config?.weekStartsOn ?? 1;
  const [anchor, setAnchor] = useState(today());
  const timeZone = defaultZone(startColumn);
  const range = useMemo(() => {
    if (scale === 'month') {
      const start = startOfWeek(monthStart(anchor), weekStartsOn);
      return { days: 42, start, end: addDays(start, 42) };
    }
    const start = scale === 'week' ? startOfWeek(anchor, weekStartsOn) : anchor;
    const days = scale === 'week' ? 7 : 1;
    return { days, start, end: addDays(start, days) };
  }, [anchor, scale, weekStartsOn]);
  const temporal = useTemporalEvents({ databaseId, startColumnId: startColumn?.id ?? null, endColumnId: endColumn?.id ?? null,
    dependencyColumnId: null, windowStart: `${range.start}T00:00:00.000Z`, windowEnd: `${range.end}T00:00:00.000Z`, timeZone, filter: config?.filter });
  const eventsByDay = useMemo(() => {
    const result = new Map<string, DatabaseTemporalEvent[]>();
    for (const event of temporal.page?.events ?? []) {
      let day = event.start.slice(0, 10); const last = event.end.slice(0, 10);
      for (let guard = 0; guard < 367 && day <= last; guard += 1, day = addDays(day, 1)) {
        const bucket = result.get(day) ?? []; bucket.push(event); result.set(day, bucket);
      }
    }
    return result;
  }, [temporal.page]);
  const move = async (event: DatabaseTemporalEvent, targetDay: string) => {
    if (readOnly || !startColumn || !temporal.page) return;
    const delta = durationDays(event.start.slice(0, 10), targetDay);
    try {
      await window.nodus.updateDatabaseTemporalRange({ databaseId, rowId: event.sourceRowId, startColumnId: startColumn.id,
        endColumnId: endColumn?.id ?? null, start: shiftDatabaseLocalDate(event.start, delta, 'days'),
        end: shiftDatabaseLocalDate(event.end, delta, 'days'), timeZone, expectedRevision: temporal.page.revision });
      await temporal.refresh(); onChanged();
    } catch (cause) { toast(cause instanceof Error ? cause.message : String(cause)); await temporal.refresh(); }
  };
  const navigate = (direction: -1 | 1) => setAnchor((current) => scale === 'month'
    ? shiftDatabaseLocalDate(current, direction, 'months')
    : addDays(current, direction * (scale === 'week' ? 7 : 1)));

  if (!startColumn) return <div className="grid min-h-0 flex-1 place-items-center p-8 text-center text-sm text-neutral-500" data-testid="database-calendar-empty-config">
    <div><Icon name="calendar" size={30} className="mx-auto mb-3" /><p>{t('Añade una propiedad Fecha para usar el calendario.')}</p></div>
  </div>;
  const days = Array.from({ length: range.days }, (_, index) => addDays(range.start, index));
  const title = scale === 'month' ? monthLabel(anchor) : scale === 'week' ? `${dayLabel(range.start)} — ${dayLabel(addDays(range.end, -1))}` : dayLabel(anchor, 'long');
  return <section className="relative flex min-h-0 flex-1 flex-col" data-testid="database-calendar-view" aria-label={t('Calendario de base de datos')}>
    <TemporalToolbar anchor={anchor} label={title} onPrevious={() => navigate(-1)} onToday={() => setAnchor(today())} onNext={() => navigate(1)}>
      <span className="max-w-48 truncate text-xs text-neutral-500" title={timeZone}><Icon name="globe" className="mr-1 inline" />{timeZone}</span>
    </TemporalToolbar>
    <TemporalStatus loading={temporal.loading} error={temporal.error} truncated={Boolean(temporal.page?.truncated)} />
    {mobile ? <DatabaseMobileAgenda days={days} anchor={anchor} events={temporal.page?.events ?? []} onOpen={onOpen}/> : scale === 'month' ? <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-[auto_repeat(6,minmax(86px,1fr))] overflow-auto" data-testid="database-calendar-month">
      {days.slice(0, 7).map((day) => <div key={`head-${day}`} className="border-b border-r border-neutral-200 px-2 py-1 text-center text-[11px] font-semibold uppercase text-neutral-500 last:border-r-0 dark:border-neutral-800">{dayLabel(day).split(' ')[0]}</div>)}
      {days.map((day) => {
        const events = eventsByDay.get(day) ?? []; const outside = day.slice(0, 7) !== anchor.slice(0, 7);
        return <div key={day} data-testid="calendar-day" data-day={day} className={`min-h-[86px] overflow-hidden border-b border-r border-neutral-200 p-1 last:border-r-0 dark:border-neutral-800 ${outside ? 'bg-neutral-50 text-neutral-400 dark:bg-neutral-950/60' : ''}`}
          onDragOver={(event) => event.preventDefault()} onDrop={(drop) => { drop.preventDefault(); const rowId = drop.dataTransfer.getData('application/x-nodus-temporal'); const item = temporal.page?.events.find((candidate) => candidate.sourceRowId === rowId); if (item) void move(item, day); }}>
          <div className={`mb-1 text-right text-xs ${day === today() ? 'font-bold text-indigo-700 dark:text-indigo-300' : ''}`}>{Number(day.slice(8))}</div>
          <div className="space-y-0.5">{events.slice(0, 4).map((event) => <button key={`${day}-${event.id}`} draggable={!readOnly}
            onDragStart={(drag) => { drag.dataTransfer.setData('application/x-nodus-temporal', event.sourceRowId); drag.dataTransfer.setData('text/plain', eventDragData(event)); }}
            onClick={() => onOpen(event.sourceRowId)} data-testid="calendar-event"
            className="block min-h-6 w-full truncate rounded bg-indigo-100 px-1.5 py-1 text-left text-[11px] text-indigo-900 hover:bg-indigo-200 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-indigo-950 dark:text-indigo-100 dark:hover:bg-indigo-900">
            {timeLabel(event.start) && <span className="mr-1 opacity-70">{timeLabel(event.start)}</span>}{event.title}{event.recurrence && <span aria-label={t('Recurrente')}> ↻</span>}
          </button>)}{events.length > 4 && <span className="block px-1 text-[10px] text-neutral-500">+{events.length - 4}</span>}</div>
        </div>;
      })}
    </div> : <CalendarTimeGrid days={days} events={temporal.page?.events ?? []} onOpen={onOpen} onMove={move} readOnly={readOnly} />}
    {!temporal.loading && !temporal.error && (temporal.page?.events.length ?? 0) === 0 && <div className="pointer-events-none absolute inset-x-0 bottom-4 text-center text-xs text-neutral-500" data-testid="database-calendar-empty">{t('No hay eventos en este periodo.')}</div>}
  </section>;
}

function CalendarTimeGrid({ days, events, onOpen, onMove, readOnly = false }: { days: string[]; events: DatabaseTemporalEvent[]; onOpen: (id: string) => void; onMove: (event: DatabaseTemporalEvent, day: string) => void; readOnly?: boolean }) {
  const byDay = useMemo(() => new Map(days.map((day) => [day, layoutDatabaseTemporalOverlaps(events.filter((event) => event.start.slice(0, 10) === day))])), [days, events]);
  return <div className="min-h-0 flex-1 overflow-auto" data-testid="database-calendar-time-grid"><div className="grid min-w-[720px]" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(120px,1fr))` }}>
    <div className="sticky left-0 z-20 border-b border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950" />
    {days.map((day) => <div key={day} className="border-b border-r border-neutral-200 p-2 text-center text-xs font-semibold dark:border-neutral-800">{dayLabel(day)}</div>)}
    <div className="sticky left-0 z-20 h-[1152px] border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">{Array.from({ length: 24 }, (_, hour) => <span key={hour} className="absolute right-2 text-[10px] text-neutral-500" style={{ top: hour * 48 - 6 }}>{padHour(hour)}</span>)}</div>
    {days.map((day) => <div key={`lane-${day}`} data-testid="calendar-time-day" data-day={day} className="relative h-[1152px] border-r border-neutral-200 bg-[linear-gradient(to_bottom,transparent_47px,rgba(128,128,128,.16)_48px)] bg-[length:100%_48px] dark:border-neutral-800"
      onDragOver={(event) => event.preventDefault()} onDrop={(drop) => { drop.preventDefault(); const rowId = drop.dataTransfer.getData('application/x-nodus-temporal'); const item = events.find((candidate) => candidate.sourceRowId === rowId); if (item) void onMove(item, day); }}>
      {(byDay.get(day) ?? []).map((event) => { const start = event.start.includes('T') ? Number(event.start.slice(11, 13)) * 60 + Number(event.start.slice(14, 16)) : 0;
        const duration = Math.max(30, (Date.parse(event.endUtc) - Date.parse(event.startUtc)) / 60_000);
        return <button key={event.id} draggable={!readOnly} data-testid="calendar-event" onDragStart={(drag) => drag.dataTransfer.setData('application/x-nodus-temporal', event.sourceRowId)} onClick={() => onOpen(event.sourceRowId)}
          className="absolute overflow-hidden rounded border border-indigo-300 bg-indigo-100 px-1 text-left text-[10px] text-indigo-950 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-100"
          style={{ top: start * .8, height: Math.max(24, duration * .8), left: `${event.lane / event.laneCount * 100}%`, width: `${100 / event.laneCount}%` }}><strong className="block truncate">{event.title}</strong><span>{timeLabel(event.start)}–{timeLabel(event.end)}</span></button>; })}
    </div>)}
  </div></div>;
}
function padHour(hour: number): string { return `${String(hour).padStart(2, '0')}:00`; }

const TIMELINE_WINDOWS: Record<DatabaseTimelineViewConfig['scale'], { days: number; snap: 'hours' | 'days' | 'weeks' | 'months' | 'years'; step: number }> = {
  hours: { days: 2, snap: 'hours', step: 1 }, days: { days: 14, snap: 'days', step: 1 }, weeks: { days: 84, snap: 'weeks', step: 1 },
  months: { days: 366, snap: 'months', step: 1 }, quarters: { days: 732, snap: 'months', step: 3 }, years: { days: 3653, snap: 'years', step: 1 },
};

export function DatabaseTimelineView({ databaseId, columns, config, onOpen, onChanged, mobile = false, readOnly = false }: TemporalCommonProps & { config: DatabaseTimelineViewConfig | null }) {
  const dateColumns = columns.filter((column) => column.type === 'date');
  const startColumn = columns.find((column) => column.id === config?.startColumnId && column.type === 'date') ?? dateColumns[0];
  const endColumn = columns.find((column) => column.id === config?.endColumnId && column.type === 'date') ?? null;
  const dependency = columns.find((column) => column.id === config?.dependencyColumnId && column.type === 'relation') ?? null;
  const scale = config?.scale ?? 'weeks'; const definition = TIMELINE_WINDOWS[scale];
  const [anchor, setAnchor] = useState(today()); const timeZone = defaultZone(startColumn);
  const windowStart = scale === 'hours' ? anchor : startOfWeek(anchor, 1); const windowEnd = addDays(windowStart, definition.days);
  const temporal = useTemporalEvents({ databaseId, startColumnId: startColumn?.id ?? null, endColumnId: endColumn?.id ?? null,
    dependencyColumnId: dependency?.id ?? null, windowStart: `${windowStart}T00:00:00.000Z`, windowEnd: `${windowEnd}T00:00:00.000Z`, timeZone, filter: config?.filter });
  const update = async (event: DatabaseTemporalEvent, start: string, end: string) => {
    if (readOnly || !startColumn || !temporal.page) return;
    try {
      const result = await window.nodus.updateDatabaseTemporalRange({ databaseId, rowId: event.sourceRowId, startColumnId: startColumn.id,
        endColumnId: endColumn?.id ?? null, start, end, timeZone, expectedRevision: temporal.page.revision });
      if (result.dstAdjustment !== 'none') toast(t(result.dstAdjustment === 'gap-forward' ? 'Hora ajustada por el cambio de horario.' : 'Hora ambigua: se usó la primera ocurrencia.'));
      await temporal.refresh(); onChanged();
    } catch (cause) { toast(cause instanceof Error ? cause.message : String(cause)); await temporal.refresh(); }
  };
  const resize = (event: DatabaseTemporalEvent, edge: 'start' | 'end', direction: -1 | 1) => {
    const shifted = shiftDatabaseLocalDate(edge === 'start' ? event.start : event.end, direction * definition.step, definition.snap);
    void update(event, edge === 'start' ? shifted : event.start, edge === 'end' ? shifted : event.end);
  };
  if (!startColumn) return <div className="grid min-h-0 flex-1 place-items-center p-8 text-center text-sm text-neutral-500" data-testid="database-timeline-empty-config"><div><Icon name="clock" size={30} className="mx-auto mb-3" /><p>{t('Añade una propiedad Fecha para usar el timeline.')}</p></div></div>;
  const events = temporal.page?.events ?? []; const leftWidth = config?.showSideTable === false ? 0 : 220;
  if(mobile)return <section className="relative flex min-h-0 flex-1 flex-col" data-testid="database-timeline-view">
    <TemporalToolbar anchor={anchor} label={`${dayLabel(windowStart)} — ${dayLabel(addDays(windowEnd,-1))}`} onPrevious={()=>setAnchor(addDays(anchor,-definition.days))} onToday={()=>setAnchor(today())} onNext={()=>setAnchor(addDays(anchor,definition.days))}/>
    <TemporalStatus loading={temporal.loading} error={temporal.error} truncated={Boolean(temporal.page?.truncated)}/>
    <DatabaseMobileAgenda events={events} onOpen={onOpen}/>
  </section>;
  return <section className="relative flex min-h-0 flex-1 flex-col" data-testid="database-timeline-view" aria-label={t('Timeline de base de datos')}>
    <TemporalToolbar anchor={anchor} label={`${dayLabel(windowStart)} — ${dayLabel(addDays(windowEnd, -1))}`} onPrevious={() => setAnchor(addDays(anchor, -definition.days))} onToday={() => setAnchor(today())} onNext={() => setAnchor(addDays(anchor, definition.days))}>
      <span className="max-w-48 truncate text-xs text-neutral-500" title={timeZone}><Icon name="globe" className="mr-1 inline" />{timeZone}</span>
    </TemporalToolbar>
    <TemporalStatus loading={temporal.loading} error={temporal.error} truncated={Boolean(temporal.page?.truncated)} />
    <div className="min-h-0 flex-1 overflow-auto" data-testid="database-timeline-scroll"><div className="min-w-[980px]" style={{ width: leftWidth + 1200 }}>
      <div className="sticky top-0 z-30 flex h-9 border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        {leftWidth > 0 && <div className="sticky left-0 z-40 shrink-0 border-r border-neutral-200 bg-white px-3 py-2 text-xs font-semibold dark:border-neutral-800 dark:bg-neutral-950" style={{ width: leftWidth }}>{t('Página')}</div>}
        <div className="relative flex-1">{Array.from({ length: 9 }, (_, index) => { const day = addDays(windowStart, Math.round(index * definition.days / 8)); return <span key={day} className="absolute top-2 -translate-x-1/2 text-[10px] text-neutral-500" style={{ left: `${index * 12.5}%` }}>{scale === 'hours' ? `${day.slice(5)} 00:00` : day}</span>; })}</div>
      </div>
      {events.map((event) => {
        const start = Math.max(0, (Date.parse(event.startUtc) - Date.parse(`${windowStart}T00:00:00.000Z`)) / (definition.days * DAY));
        const end = Math.min(1, (Date.parse(event.endUtc) - Date.parse(`${windowStart}T00:00:00.000Z`)) / (definition.days * DAY));
        return <div key={event.id} className="flex h-12 border-b border-neutral-200 dark:border-neutral-800" data-testid="timeline-row">
          {leftWidth > 0 && <button className="sticky left-0 z-20 shrink-0 truncate border-r border-neutral-200 bg-white px-3 text-left text-xs hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:bg-neutral-900" style={{ width: leftWidth }} onClick={() => onOpen(event.sourceRowId)}>{event.title}</button>}
          <div className="relative flex-1 bg-[linear-gradient(to_right,transparent_149px,rgba(128,128,128,.13)_150px)] bg-[length:150px_100%]" onDragOver={(drag) => drag.preventDefault()} onDrop={(drop) => { drop.preventDefault(); const ratio = Math.max(0, Math.min(1, (drop.clientX - drop.currentTarget.getBoundingClientRect().left) / drop.currentTarget.clientWidth)); const target = addDays(windowStart, Math.round(ratio * definition.days)); const delta = durationDays(event.start.slice(0, 10), target); void update(event, shiftDatabaseLocalDate(event.start, delta, 'days'), shiftDatabaseLocalDate(event.end, delta, 'days')); }}>
            {event.dependencies.length > 0 && <svg aria-label={tx('{n} dependencias', { n: event.dependencies.length })} className="pointer-events-none absolute inset-0 h-full w-full overflow-visible text-amber-500" data-testid="timeline-dependency"><path d={`M 0 24 H ${Math.max(4, start * 1200 - 5)} V 18`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" /></svg>}
            <div draggable={!readOnly} onDragStart={(drag) => drag.dataTransfer.setData('application/x-nodus-temporal', event.sourceRowId)} data-testid="timeline-bar" className="absolute top-2 flex h-8 min-w-20 items-center overflow-hidden rounded-md border border-indigo-300 bg-indigo-100 text-indigo-950 shadow-sm dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-100" style={{ left: `${start * 100}%`, width: `${Math.max(.02, end - start) * 100}%` }}>
              <button data-testid="timeline-resize-start" disabled={readOnly} aria-label={t('Reducir o ampliar el inicio')} className="h-full w-6 shrink-0 cursor-ew-resize bg-indigo-300/60 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-indigo-800/60" onClick={() => resize(event, 'start', -1)} onKeyDown={(key) => { if (key.key === 'ArrowLeft' || key.key === 'ArrowRight') { key.preventDefault(); resize(event, 'start', key.key === 'ArrowLeft' ? -1 : 1); } }} />
              <button className="min-w-0 flex-1 truncate px-2 text-left text-[11px]" onClick={() => onOpen(event.sourceRowId)}>{event.title}<span className="ml-1 opacity-60">{event.start.slice(0, 10)}→{event.end.slice(0, 10)}</span></button>
              <button data-testid="timeline-resize-end" disabled={readOnly} aria-label={t('Reducir o ampliar el final')} className="h-full w-6 shrink-0 cursor-ew-resize bg-indigo-300/60 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-indigo-800/60" onClick={() => resize(event, 'end', 1)} onKeyDown={(key) => { if (key.key === 'ArrowLeft' || key.key === 'ArrowRight') { key.preventDefault(); resize(event, 'end', key.key === 'ArrowLeft' ? -1 : 1); } }} />
            </div>
          </div>
        </div>;
      })}
      {!temporal.loading && !temporal.error && events.length === 0 && <div className="grid h-40 place-items-center text-sm text-neutral-500" data-testid="database-timeline-empty">{t('No hay eventos en este periodo.')}</div>}
    </div></div>
  </section>;
}

/** Phone calendar/timeline reading uses date buttons and a complete agenda.
 * Opening an event hands its real row to the native, keyboard-aware inspector. */
function DatabaseMobileAgenda({days,anchor,events,onOpen}:{days?:string[];anchor?:string;events:DatabaseTemporalEvent[];onOpen:(id:string)=>void}){
  const [selected,setSelected]=useState(today());
  const day=days?(days.includes(selected)?selected:days.find(day=>day.slice(0,7)===anchor?.slice(0,7))??days[0]):null;
  const visible=day?events.filter(event=>event.start.slice(0,10)<=day&&event.end.slice(0,10)>=day):events;
  return <div className="mobile-database-agenda" data-testid="database-mobile-agenda">
    {days&&<div className="mobile-database-days" role="group" aria-label={t('Seleccionar fecha')}>{days.map(value=><button key={value} aria-label={dayLabel(value,'long')} aria-pressed={value===day} onClick={()=>setSelected(value)}><span>{Number(value.slice(8))}</span>{events.some(event=>event.start.slice(0,10)<=value&&event.end.slice(0,10)>=value)&&<span className="mobile-database-event-dot"/>}</button>)}</div>}
    {day&&<h3>{dayLabel(day,'long')}</h3>}
    {visible.map(event=><button className="mobile-database-event" key={event.id} onClick={()=>onOpen(event.sourceRowId)}><strong>{event.title}</strong><span>{event.start.replace('T',' ')} · {event.end.replace('T',' ')}</span>
      {event.timeZone&&<span>{event.timeZone}{event.recurrence?' · ↻':''}</span>}{event.dependencies.length>0&&<span>{tx('{n} dependencias',{n:event.dependencies.length})}</span>}
    </button>)}
    {!visible.length&&<p className="text-sm text-neutral-500">{t('No hay eventos en este periodo.')}</p>}
  </div>;
}
