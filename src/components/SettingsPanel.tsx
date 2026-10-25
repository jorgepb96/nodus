import type { HTMLAttributes, ReactNode } from 'react';
import { Icon } from './ui';

/**
 * The one card every Settings section is drawn with.
 *
 * Settings grew panel by panel, and each panel brought its own frame: an uppercase grey
 * heading here, a nested white box there, another card with a different padding below.
 * Side by side they read as unrelated screens. Everything in Settings now goes through
 * this card, so the heading, the description, the actions and the spacing between rows
 * are the same wherever the user looks.
 */
export function SettingsPanel({
  title,
  description,
  icon,
  actions,
  children,
  className = '',
  id,
  ...props
}: Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  title: ReactNode;
  description?: ReactNode;
  icon?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      tabIndex={id ? -1 : undefined}
      className={`settings-panel card mb-4 p-5 last:mb-0${id ? ' scroll-mt-6' : ''} ${className}`}
      {...props}
    >
      <header className="mb-4 flex flex-wrap items-start gap-3">
        {icon && <SettingsIconBadge icon={icon} />}
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold leading-6 text-neutral-900 dark:text-neutral-100">{title}</h2>
          {description && <p className="mt-0.5 max-w-3xl text-xs leading-5 text-neutral-600 dark:text-neutral-400">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function SettingsIconBadge({ icon, size = 'md' }: { icon: string; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300 ${size === 'sm' ? 'h-7 w-7' : 'h-8 w-8'}`}
    >
      <Icon name={icon} size={size === 'sm' ? 14 : 16} />
    </span>
  );
}

/**
 * A labelled setting: label and one-line hint on the left, the control on the right.
 * `stacked` puts a control that is itself a grid of options under its label instead,
 * where the two-column shape would leave the label column empty for its whole height.
 */
export function SettingsRow({
  label,
  hint,
  icon,
  stacked = false,
  children,
  className = '',
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  label: ReactNode;
  hint?: ReactNode;
  icon?: string;
  stacked?: boolean;
  children: ReactNode;
}) {
  const heading = (
    <div className={`flex min-w-0 gap-3 ${stacked ? '' : 'md:pt-1.5'}`}>
      {icon && <SettingsIconBadge icon={icon} size="sm" />}
      <label className="min-w-0 text-sm font-medium text-neutral-800 dark:text-neutral-200">
        {label}
        {hint && <span className="mt-0.5 block text-xs font-normal leading-5 text-neutral-500">{hint}</span>}
      </label>
    </div>
  );
  if (stacked) {
    return (
      <div className={`grid gap-3 ${className}`} {...props}>
        {heading}
        <div className="min-w-0">{children}</div>
      </div>
    );
  }
  return (
    <div className={`grid gap-3 md:grid-cols-[minmax(13rem,0.85fr)_minmax(0,1.55fr)] md:items-start ${className}`} {...props}>
      {heading}
      <div className="min-w-0 md:flex md:justify-end">{children}</div>
    </div>
  );
}

export type SettingsTab<Id extends string> = { id: Id; label: string; icon: string };

/**
 * Icon tabs inside a Settings section. They are tabs, not buttons, so their names never
 * collide with the section buttons of the Settings navigation.
 */
export function SettingsTabs<Id extends string>({
  tabs,
  active,
  onSelect,
  label,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'> & {
  tabs: readonly SettingsTab<Id>[];
  active: Id;
  onSelect: (id: Id) => void;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-800 dark:bg-neutral-950/60"
      {...props}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            data-testid={`settings-tab-${tab.id}`}
            className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${
              selected
                ? 'bg-white text-indigo-700 shadow-sm dark:bg-neutral-800 dark:text-white'
                : 'text-neutral-600 hover:bg-white/70 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100'
            }`}
            onClick={() => onSelect(tab.id)}
          >
            <Icon name={tab.icon} size={15} />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
