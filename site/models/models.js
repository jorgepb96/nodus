/*
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

Draws the model guide from models-data.js: the tabs, the filter bubbles, the
tables and the methodology. Nothing here holds content; to change what the page
says, edit the data file.

The URL carries the state, so a filtered view can be shared:
  /models/?machine=mac16,gpu8&price=budget#local
*/
(function () {
  'use strict';

  const guide = window.NODUS_MODEL_GUIDE;
  const tabBar = document.getElementById('mg-tabs');
  const panelsHost = document.getElementById('mg-panels');
  const section = document.getElementById('mg-guide');
  if (!guide || !tabBar || !panelsHost || !section) return;

  /* ------------------------------------------------------------ markup helpers */

  const ICON_PATHS = {
    chip: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
    vectors: '<circle cx="6" cy="6" r="2.2"/><circle cx="18" cy="7" r="2.2"/><circle cx="12" cy="18" r="2.2"/><path d="m8.2 6.3 7.6.6M7.1 8l3.8 8M16.9 9l-3.8 7"/>',
    chat: '<path d="M21 14.5a2 2 0 0 1-2 2H8l-4.5 4V5.5a2 2 0 0 1 2-2H19a2 2 0 0 1 2 2Z"/><path d="M8 9h8M8 12.5h5"/>',
    bulb: '<path d="M9 18h6M10 21.5h4"/><path d="M12 2.5a6.5 6.5 0 0 0-3.8 11.8c.5.4.8 1 .8 1.7V16h6v-.1c0-.6.3-1.2.8-1.6A6.5 6.5 0 0 0 12 2.5Z"/>',
    compass: '<circle cx="12" cy="12" r="9.5"/><path d="m15.8 8.2-2 5.6-5.6 2 2-5.6Z"/>',
    signpost: '<path d="M12 22v-7M12 6V2.5"/><path d="M5 6h11.5l3 3-3 3H5Z"/>',
    check: '<path d="m5 12.5 4.2 4L19 7"/>',
    cross: '<path d="m7 7 10 10M17 7 7 17"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    sort: '<path class="mg-up" d="m8 9.5 4-4 4 4"/><path class="mg-down" d="m8 14.5 4 4 4-4"/>',
    info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 11v5.5M12 7.7v.1"/>',
    good: '<circle cx="12" cy="12" r="9.5"/><path d="m8 12.3 2.7 2.6L16.2 9.4"/>',
    warn: '<path d="M10.3 3.9 2.4 17.6a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9.5V14M12 17.2v.1"/>',
    bad: '<circle cx="12" cy="12" r="9.5"/><path d="m9 9 6 6M15 9l-6 6"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
  };
  const icon = (name, className = 'mg-ic') => `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
  const STAR = '<svg class="mg-star" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 .9a.7.7 0 0 1 .63.39l1.8 3.64 4.02.58a.7.7 0 0 1 .39 1.2l-2.91 2.83.69 4a.7.7 0 0 1-1.02.74L8 12.4l-3.6 1.88a.7.7 0 0 1-1.02-.74l.69-4L1.16 6.71a.7.7 0 0 1 .39-1.2l4.02-.58L7.37 1.3A.7.7 0 0 1 8 .9Z"/></svg>';

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]
  ));

  /* The only markup the data file may use: **bold**, *italic*, `code` and
     [label](https://…) or [label](#tab). Everything else is escaped first. */
  function inline(text) {
    let html = escapeHtml(text);
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*\s][^*]*)\*/g, '<em>$1</em>');
    html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
      if (!/^(?:https:\/\/|#)/.test(href)) return label;
      const external = href.startsWith('https://');
      return `<a href="${href}"${external ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
    });
    return html;
  }

  const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const formatDate = (iso) => dateFormat.format(new Date(`${iso}T00:00:00Z`));

  function money(value, { cents = false } = {}) {
    if (value == null || !Number.isFinite(value)) return '<span class="mg-dash">—</span>';
    // a price quoted to the tenth of a cent keeps its third decimal
    const fine = !cents && value < 1 && Math.round(value * 1000) % 10 !== 0;
    const digits = fine ? 3 : 2;
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  }

  // '~59.6 ‡' and '61.36 (text)' still sort and draw a bar by their number
  const numeric = (value) => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return Number.parseFloat(value.replace(/[^\d.]/g, ''));
    return Number.NaN;
  };

  /* ------------------------------------------------------------ data */

  const latest = (guide.tabs || []).map((tab) => tab.updated).filter(Boolean).sort().at(-1);

  // The last tab is not in the data file: it holds the definitions, the
  // sources and the update history, which models-data.js keeps apart.
  const tabs = [...(guide.tabs || []), {
    id: 'method',
    label: 'Methodology',
    icon: 'info',
    accent: '#a78bfa',
    updated: latest,
    title: 'Methodology and sources',
    intro: 'Definitions of the columns, the sources consulted and the update history.',
    filters: [],
    tables: [],
    extra: '<dl class="mg-method" id="mg-method"></dl>'
      + '<div class="mg-about-grid"><div class="mg-sources" id="mg-sources"></div>'
      + '<aside class="mg-history"><h3>Update history</h3><ol class="mg-changelog" id="mg-changelog"></ol>'
      + '<p class="mg-edit">To report outdated data, <a href="https://github.com/jorgepb96/nodus/issues/new/choose" target="_blank" rel="noopener">open an issue on GitHub</a>. All tables on this page are generated from <a href="https://github.com/jorgepb96/nodus/blob/main/site/models/models-data.js" target="_blank" rel="noopener">models-data.js</a>.</p></aside></div>'
      + '<p class="mg-disclaimer">Comparisons and priorities are proposals to validate on real corpora, not performance guarantees.</p>',
  }];
  const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));
  const columnId = (column) => column.id || column.key;
  const optionsOf = (facet) => (facet.groups ? facet.groups.flatMap((group) => group.options) : facet.options);

  // Each row inherits its table's fields and, through `ref`, its API model.
  for (const tab of tabs) {
    for (const table of tab.tables) {
      table.resolved = table.rows.map((row) => ({
        ...(table.row || {}),
        ...(row.ref ? guide.apiModels[row.ref] : {}),
        ...row,
      }));
      // bars are measured against the whole table, so they hold still while filtering
      table.maxima = {};
      for (const column of table.columns) {
        if (column.type !== 'score' && column.type !== 'speed') continue;
        const values = table.resolved.map((row) => numeric(row[column.key])).filter(Number.isFinite);
        table.maxima[columnId(column)] = Math.max(...values, 1);
      }
    }
  }

  const facetIds = new Set(tabs.flatMap((tab) => tab.filters.map((facet) => facet.id)));
  const selected = new Map();
  const sorts = new Map();
  const estimates = new Map();
  let activeTab = null;

  /* ------------------------------------------------------------ filtering */

  const RANGE_KEYS = ['atLeast', 'over', 'upTo', 'below'];
  const hasRange = (option) => RANGE_KEYS.some((key) => option[key] != null);
  const inRange = (value, option) => (option.atLeast == null || value >= option.atLeast)
    && (option.over == null || value > option.over)
    && (option.upTo == null || value <= option.upTo)
    && (option.below == null || value < option.below);

  function applies(facet, row) {
    if (facet.type === 'machine') return Boolean(row.fit || row.machines);
    return row[facet.field] !== undefined && row[facet.field] !== null;
  }

  // A model fits a machine when it needs no more than that machine has. CPU
  // support is its own option: it does not imply that a small Mac or GPU has
  // enough memory for the rest of the local stack.
  function fits(row, option) {
    if (row.machines) return row.machines.includes(option.id);
    if (option.kind === 'cpu') return Boolean(row.fit.cpu);
    const need = row.fit[option.kind];
    return need != null && need <= option.gb;
  }

  function matches(facet, option, row) {
    if (facet.type === 'machine') return fits(row, option);
    const value = row[facet.field];
    if (hasRange(option)) return typeof value === 'number' && inRange(value, option);
    return [].concat(value).includes(option.id);
  }

  // OR inside a filter, AND across filters; `skip` leaves one out, for counting.
  function passes(row, facets, skip) {
    return facets.every((facet) => {
      if (facet.id === skip) return true;
      const chosen = selected.get(facet.id);
      if (!chosen || !chosen.size || !applies(facet, row)) return true;
      return optionsOf(facet).some((option) => chosen.has(option.id) && matches(facet, option, row));
    });
  }

  const tabRows = (tab) => tab.tables.flatMap((table) => table.resolved);
  const activeIn = (tab) => tab.filters.filter((facet) => selected.get(facet.id)?.size).length;

  /* ------------------------------------------------------------ cells */

  function estimateCost(row, table) {
    const estimate = estimates.get(table.id);
    if (!estimate || !Number.isFinite(row.input) || !Number.isFinite(row.output)) return Number.NaN;
    return estimate.documents * (estimate.inputTokens * row.input + estimate.outputTokens * row.output) / 1e6;
  }

  function bar(value, maximum, text) {
    const amount = numeric(value);
    if (!Number.isFinite(amount)) return '<span class="mg-dash">—</span>';
    const share = Math.max(0.04, Math.min(1, amount / maximum));
    return `<span class="mg-bar" style="--v:${share.toFixed(3)}"><span>${text}</span></span>`;
  }

  function nameCell(row) {
    const label = escapeHtml(row.name);
    const target = row.source || row.href;
    const external = Boolean(row.source);
    const title = target
      ? `<a class="mg-model" href="${escapeHtml(target)}"${external ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`
      : `<span class="mg-model">${label}</span>`;
    return `<div class="mg-name">${row.tag ? `<span class="mg-tag">${escapeHtml(row.tag)}</span>` : ''}${title}${row.reasoning ? `<span class="mg-reason">${escapeHtml(row.reasoning)}</span>` : ''}</div>`
      + `${row.sub ? `<div class="mg-sub">${inline(row.sub)}</div>` : ''}`
      + `${row.pick ? `<span class="mg-pick">${STAR}${escapeHtml(row.pick)}</span>` : ''}`;
  }

  function fitCell(row) {
    const fit = row.fit;
    if (!fit) return '<span class="mg-dash">—</span>';
    const chips = [];
    if (fit.mac) chips.push(['mac', `Mac ${fit.mac} GB+`]);
    if (fit.gpu) chips.push(['gpu', `GPU ${fit.gpu} GB+`]);
    if (fit.cpu) chips.push(['cpu', fit.cpu === 'slow' ? 'CPU, slow' : 'CPU']);
    return `<div class="mg-fit">${chips.map(([kind, text]) => `<span class="mg-chip mg-chip--${kind}">${text}</span>`).join('')}</div>`
      + `${row.fitNote ? `<div class="mg-sub">${inline(row.fitNote)}</div>` : ''}`;
  }

  const VERDICTS = { yes: ['good', 'Yes', 'check'], aux: ['info', 'Retrieval only', 'info'], no: ['bad', 'No', 'cross'] };
  function verdictCell(value, column) {
    if (!value) return '<span class="mg-dash">—</span>';
    const [tone, label, glyph] = VERDICTS[value] || ['muted', value, 'info'];
    const finalTone = column.tones?.[value] || tone;
    return `<span class="mg-verdict mg-verdict--${finalTone}">${icon(glyph, 'mg-verdict-ic')}${escapeHtml(label)}</span>`;
  }

  function cell(column, row, table) {
    const value = row[column.key];
    switch (column.type) {
      case 'name': return nameCell(row);
      case 'price': return money(value == null ? null : value * (column.scale || 1));
      case 'cost': return money(estimateCost(row, table), { cents: true });
      case 'score': {
        if (value == null) return '<span class="mg-dash">—</span>';
        const text = typeof value === 'number'
          ? value.toLocaleString('en-US', { minimumFractionDigits: column.decimals || 0, maximumFractionDigits: 2 })
          : escapeHtml(value);
        return bar(value, table.maxima[columnId(column)], text);
      }
      case 'speed':
        return value == null
          ? '<span class="mg-dash">—</span>'
          : bar(value, table.maxima[columnId(column)], `${row.speedApprox ? '~' : ''}${value}<small> t/s</small>`);
      case 'fit': return fitCell(row);
      case 'licence':
        return value
          ? `<a href="${escapeHtml(value.url)}" target="_blank" rel="noopener">${escapeHtml(value.name)}</a>`
            + `${value.by ? `<span class="mg-sub mg-by"> · ${escapeHtml(value.by)}</span>` : ''}`
            + `${value.warn ? `<span class="mg-flag">${escapeHtml(value.warn)}</span>` : ''}`
          : '<span class="mg-dash">—</span>';
      case 'link':
        return value ? `<a href="${escapeHtml(value.url)}" target="_blank" rel="noopener">${escapeHtml(value.label)}</a>` : '<span class="mg-dash">—</span>';
      case 'verdict': return verdictCell(value, column);
      default:
        return value == null || value === '' ? '<span class="mg-dash">—</span>' : inline(value);
    }
  }

  const NUMERIC = new Set(['price', 'cost', 'score', 'speed']);
  // cheapest first for money, best first for scores
  const firstDirection = (column) => (column.type === 'score' || column.type === 'speed' ? 'desc' : 'asc');

  function sortRows(rows, table) {
    const sort = sorts.get(table.id);
    if (!sort) return rows;
    const column = table.columns.find((entry) => columnId(entry) === sort.column);
    if (!column) return rows;
    const valueOf = (row) => (column.type === 'cost'
      ? estimateCost(row, table)
      : numeric(row[column.key]) * (column.scale || 1));
    return [...rows].sort((a, b) => {
      const left = valueOf(a);
      const right = valueOf(b);
      if (!Number.isFinite(left) && !Number.isFinite(right)) return 0;
      if (!Number.isFinite(left)) return 1;
      if (!Number.isFinite(right)) return -1;
      return sort.direction === 'asc' ? left - right : right - left;
    });
  }

  /* ------------------------------------------------------------ static markup */

  function callout(note) {
    const tone = note.tone || 'info';
    return `<aside class="mg-callout mg-callout--${tone}">${icon(tone, 'mg-callout-ic')}<div>`
      + `${note.title ? `<b>${inline(note.title)}</b>` : ''}<p>${inline(note.text)}</p></div></aside>`;
  }

  function flow(spec) {
    return `<div class="mg-flow">${spec.lanes.map((lane) => `<div class="mg-lane mg-lane--${lane.tone || 'accent'}">`
      + `<span class="mg-lane-label">${escapeHtml(lane.label)}</span>`
      + `<ol class="mg-steps">${lane.steps.map((step) => `<li><span>${escapeHtml(step)}</span></li>`).join('')}</ol></div>`).join('')}</div>`;
  }

  function estimator(table) {
    const initial = { ...table.estimator };
    estimates.set(table.id, initial);
    const field = (key, step, width) => `<input class="mg-num" type="number" inputmode="numeric" min="0" step="${step}" value="${initial[key]}" data-estimate="${key}" data-table="${table.id}" style="--w:${width}ch" aria-label="${{ documents: 'Number of documents', inputTokens: 'Input tokens per document', outputTokens: 'Output tokens per document' }[key]}"/>`;
    return `<p class="mg-estimator">Estimate for ${field('documents', 100, 7)} documents of ${field('inputTokens', 1000, 7)} input and ${field('outputTokens', 500, 6)} output tokens each.</p>`;
  }

  function tableBlock(table) {
    const titleId = `mg-title-${table.id}`;
    const head = table.columns.map((column) => {
      const align = NUMERIC.has(column.type) ? ' class="mg-num-col"' : '';
      const label = escapeHtml(column.label);
      if (!NUMERIC.has(column.type)) return `<th scope="col"${align}>${label}</th>`;
      return `<th scope="col"${align} aria-sort="none"><button class="mg-sort" type="button" data-table="${table.id}" data-column="${columnId(column)}">${label}${icon('sort', 'mg-sort-ic')}</button></th>`;
    }).join('');

    const heading = `<h3 class="mg-block-title" id="${titleId}">${escapeHtml(table.title)}</h3><span class="mg-block-count" data-count="${table.id}"></span>`;
    const body = `${table.intro ? `<p class="mg-block-intro">${inline(table.intro)}</p>` : ''}`
      + `${table.flow ? flow(table.flow) : ''}`
      + `${table.estimator ? estimator(table) : ''}`
      + `<div class="mg-table-card"><div class="mg-scroll"><table class="mg-table" aria-labelledby="${titleId}">`
      + `<thead><tr>${head}</tr></thead><tbody data-body="${table.id}"></tbody></table></div>`
      + `<div class="mg-empty" data-empty="${table.id}" hidden>No rows match the selected filters. <button class="mg-link-btn" type="button" data-clear>Clear filters</button></div></div>`
      + `${table.footnote ? `<p class="mg-footnote">${inline(table.footnote)}</p>` : ''}`
      + `${table.callout ? callout(table.callout) : ''}`;

    if (table.collapsed) {
      return `<details class="mg-block mg-collapsible" id="mg-${table.id}"><summary class="mg-block-head">${heading}${icon('chevron', 'mg-chev')}</summary>${body}</details>`;
    }
    return `<article class="mg-block" id="mg-${table.id}"><header class="mg-block-head">${heading}</header>${body}</article>`;
  }

  // How a chosen option reads on its closed button: "Mac 16 GB", "Budget".
  const shortLabel = (option) => (option.kind === 'mac' ? `Mac ${option.label}`
    : option.kind === 'gpu' ? `GPU ${option.label}` : option.label);

  function options(tab, facet, list) {
    const universe = tabRows(tab);
    return list
      // an option no row of this tab could ever match is left out entirely
      .filter((option) => universe.some((row) => applies(facet, row) && matches(facet, option, row)))
      .map((option) => `<button class="mg-opt" type="button" aria-pressed="false" data-facet="${facet.id}" data-option="${option.id}">`
        + `<span class="mg-check" aria-hidden="true">${icon('check', 'mg-check-ic')}</span>`
        + `<span class="mg-opt-label">${escapeHtml(option.label)}${option.hint ? ` <i>${escapeHtml(option.hint)}</i>` : ''}</span>`
        + `<span class="mg-count" aria-hidden="true"></span></button>`)
      .join('');
  }

  // One button per filter; it opens a popover with the options, any number of
  // which can be ticked.
  function filterBox(tab) {
    if (!tab.filters.length) return '';
    const pops = tab.filters.map((facet) => {
      const panelId = `mg-pop-${tab.id}-${facet.id}`;
      const body = facet.groups
        ? facet.groups.map((group) => {
          const items = options(tab, facet, group.options);
          return items
            ? `<div class="mg-pop-col"><p class="mg-pop-group">${escapeHtml(group.label)}${group.hint ? ` <i>${escapeHtml(group.hint)}</i>` : ''}</p>${items}</div>`
            : '';
        }).join('')
        : options(tab, facet, facet.options);
      return `<div class="mg-pop" data-pop="${facet.id}">`
        + `<button class="mg-pop-btn" type="button" aria-expanded="false" aria-controls="${panelId}">`
        + `<span class="mg-pop-label">${escapeHtml(facet.label)}</span><span class="mg-pop-value" data-value="${facet.id}">All</span>`
        + `${icon('chevron', 'mg-pop-chev')}</button>`
        + `<div class="mg-pop-panel${facet.groups ? ' mg-pop-panel--cols' : ''}" id="${panelId}" role="group" aria-label="${escapeHtml(facet.label)}" hidden>${body}</div></div>`;
    }).join('');
    return `<div class="mg-filters">${pops}<button class="mg-clear" type="button" data-clear>${icon('cross', 'mg-ic')}Clear</button>`
      + `<p class="mg-meta" data-meta role="status" aria-live="polite"></p></div>`;
  }

  function panelMarkup(tab) {
    return `<div class="mg-panel" role="tabpanel" id="mg-panel-${tab.id}" aria-labelledby="mg-tab-${tab.id}" tabindex="-1" hidden>`
      + `<header class="mg-panel-head"><div class="mg-panel-copy"><h2 class="mg-panel-title">${escapeHtml(tab.title)}</h2>`
      + `<p class="mg-panel-intro">${inline(tab.intro)}</p></div>`
      + `<p class="mg-reviewed">${icon('calendar', 'mg-ic')}Reviewed <time datetime="${tab.updated}">${formatDate(tab.updated)}</time></p></header>`
      + `${(tab.notes || []).map(callout).join('')}`
      + `${filterBox(tab)}`
      + `${tab.tables.length ? `<div class="mg-blocks">${tab.tables.map(tableBlock).join('')}</div>` : ''}`
      + `${tab.extra || ''}</div>`;
  }

  tabBar.innerHTML = tabs.map((tab) => `<button class="mg-tab" type="button" role="tab" id="mg-tab-${tab.id}" aria-controls="mg-panel-${tab.id}" aria-selected="false" tabindex="-1" data-tab="${tab.id}" style="--tab-accent:${tab.accent}">`
    + `${icon(tab.icon, 'mg-tab-ic')}<span>${escapeHtml(tab.label)}</span></button>`).join('');
  panelsHost.innerHTML = tabs.map(panelMarkup).join('');

  /* ------------------------------------------------------------ refresh */

  function refresh(tab) {
    const panel = document.getElementById(`mg-panel-${tab.id}`);
    let shown = 0;
    let total = 0;

    for (const table of tab.tables) {
      const rows = sortRows(table.resolved.filter((row) => passes(row, tab.filters)), table);
      total += table.resolved.length;
      shown += rows.length;
      panel.querySelector(`[data-body="${table.id}"]`).innerHTML = rows.map((row) => (
        `<tr${row.pick ? ' class="is-pick"' : ''}>${table.columns.map((column, index) => (
          `<td data-label="${escapeHtml(column.label)}" class="${[index === 0 ? 'mg-first' : '', NUMERIC.has(column.type) ? 'mg-num-col' : ''].filter(Boolean).join(' ')}"><div class="mg-cell">${cell(column, row, table)}</div></td>`
        )).join('')}</tr>`
      )).join('');
      panel.querySelector(`[data-empty="${table.id}"]`).hidden = rows.length > 0;
      panel.querySelector(`[data-body="${table.id}"]`).closest('.mg-scroll').hidden = rows.length === 0;
      const count = panel.querySelector(`[data-count="${table.id}"]`);
      count.textContent = rows.length === table.resolved.length ? `${rows.length}` : `${rows.length} of ${table.resolved.length}`;
      count.classList.toggle('is-filtered', rows.length !== table.resolved.length);

      const sort = sorts.get(table.id);
      for (const button of panel.querySelectorAll(`.mg-sort[data-table="${table.id}"]`)) {
        const state = sort && sort.column === button.dataset.column ? sort.direction : null;
        button.closest('th').setAttribute('aria-sort', state === 'asc' ? 'ascending' : state === 'desc' ? 'descending' : 'none');
      }
    }

    const universe = tabRows(tab);
    for (const facet of tab.filters) {
      const chosen = selected.get(facet.id) || new Set();
      const value = panel.querySelector(`[data-value="${facet.id}"]`);
      const picked = optionsOf(facet).filter((option) => chosen.has(option.id));
      if (value) {
        value.textContent = picked.length === 0 ? 'All'
          : picked.length === 1 ? shortLabel(picked[0]) : `${shortLabel(picked[0])} +${picked.length - 1}`;
        value.closest('.mg-pop-btn').classList.toggle('is-active', picked.length > 0);
      }
      for (const option of optionsOf(facet)) {
        const button = panel.querySelector(`.mg-opt[data-facet="${facet.id}"][data-option="${option.id}"]`);
        if (!button) continue;
        const count = universe.filter((row) => applies(facet, row) && passes(row, tab.filters, facet.id) && matches(facet, option, row)).length;
        const on = chosen.has(option.id);
        button.setAttribute('aria-pressed', String(on));
        button.classList.toggle('is-empty', count === 0 && !on);
        button.querySelector('.mg-count').textContent = String(count);
        button.setAttribute('aria-label', `${option.label}${option.hint ? `, ${option.hint}` : ''}: ${count} ${count === 1 ? 'match' : 'matches'}`);
      }
    }

    const active = activeIn(tab);
    const meta = panel.querySelector('[data-meta]');
    if (meta) {
      meta.innerHTML = active
        ? `<b>${shown}</b> of ${total} entries`
        : `<b>${total}</b> entries`;
    }
    const clear = panel.querySelector('.mg-clear');
    if (clear) clear.disabled = active === 0;
  }

  /* ------------------------------------------------------------ state and URL */

  function syncUrl() {
    const params = new URLSearchParams(location.search);
    for (const id of facetIds) params.delete(id);
    // written by hand so the commas stay readable: ?machine=mac16,gpu8
    const parts = [params.toString()];
    for (const [id, chosen] of selected) {
      if (chosen.size) parts.push(`${id}=${[...chosen].map(encodeURIComponent).join(',')}`);
    }
    const search = parts.filter(Boolean).join('&');
    history.replaceState(null, '', `${location.pathname}${search ? `?${search}` : ''}${activeTab ? `#${activeTab}` : ''}`);
  }

  function retune(tab) {
    const root = document.documentElement;
    root.style.setProperty('--accent', tab.accent);
    root.style.setProperty('--accent-soft', `${tab.accent}26`);
    // site.js re-reads this when the page scrolls back into the section
    const main = document.getElementById('main');
    if (main) main.dataset.accent = tab.accent;
    window.NodusOrganism?.tune(tab.accent, main?.dataset.second || tab.accent, Number(main?.dataset.energy || 0.28));
  }

  // Lands the tab bar right under the site header, where it then sticks.
  function scrollToTabs() {
    const header = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 62;
    scrollTo({ top: section.getBoundingClientRect().top + scrollY - header, behavior: 'instant' });
  }

  function selectTab(id, { focus = false, scroll = false, sync = true } = {}) {
    const tab = tabsById.get(id) || tabs[0];
    closePops();
    activeTab = tab.id;
    for (const button of tabBar.querySelectorAll('.mg-tab')) {
      const on = button.dataset.tab === tab.id;
      button.setAttribute('aria-selected', String(on));
      button.tabIndex = on ? 0 : -1;
      if (on && focus) button.focus();
      // keep the chosen tab in view inside the bar, without moving the page
      if (on && tabBar.scrollWidth > tabBar.clientWidth) {
        tabBar.scrollTo({ left: button.offsetLeft - (tabBar.clientWidth - button.offsetWidth) / 2 });
      }
    }
    for (const panel of panelsHost.querySelectorAll('.mg-panel')) {
      panel.hidden = panel.id !== `mg-panel-${tab.id}`;
    }
    refresh(tab);
    retune(tab);
    if (scroll) scrollToTabs();
    if (sync) syncUrl();
  }

  /* ------------------------------------------------------------ events */

  const syncOverflow = () => {
    const scrollable = tabBar.scrollWidth > tabBar.clientWidth + 1;
    tabBar.toggleAttribute('data-scrollable', scrollable);
    tabBar.toggleAttribute('data-at-end', !scrollable || tabBar.scrollLeft + tabBar.clientWidth >= tabBar.scrollWidth - 2);
  };
  tabBar.addEventListener('scroll', syncOverflow, { passive: true });
  addEventListener('resize', syncOverflow, { passive: true });

  tabBar.addEventListener('click', (event) => {
    const button = event.target.closest('.mg-tab');
    if (button) selectTab(button.dataset.tab);
  });

  tabBar.addEventListener('keydown', (event) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.id === activeTab);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    selectTab(tabs[next].id, { focus: true });
  });

  function setPop(pop, open) {
    pop.querySelector('.mg-pop-btn').setAttribute('aria-expanded', String(open));
    pop.querySelector('.mg-pop-panel').hidden = !open;
  }
  function closePops(except) {
    for (const pop of panelsHost.querySelectorAll('.mg-pop')) if (pop !== except) setPop(pop, false);
  }
  // A press outside any open list closes it; Escape closes it and returns focus.
  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.mg-pop')) closePops();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const open = panelsHost.querySelector('.mg-pop-btn[aria-expanded="true"]');
    if (!open) return;
    closePops();
    open.focus();
  });

  panelsHost.addEventListener('click', (event) => {
    const tab = tabsById.get(activeTab);
    const toggle = event.target.closest('.mg-pop-btn');
    if (toggle) {
      const pop = toggle.closest('.mg-pop');
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      closePops(pop);
      setPop(pop, open);
      return;
    }
    const bubble = event.target.closest('.mg-opt');
    if (bubble) {
      const chosen = selected.get(bubble.dataset.facet) || new Set();
      if (chosen.has(bubble.dataset.option)) chosen.delete(bubble.dataset.option);
      else chosen.add(bubble.dataset.option);
      selected.set(bubble.dataset.facet, chosen);
      refresh(tab);
      syncUrl();
      return;
    }
    if (event.target.closest('[data-clear]')) {
      closePops();
      for (const facet of tab.filters) selected.delete(facet.id);
      refresh(tab);
      syncUrl();
      return;
    }
    const sort = event.target.closest('.mg-sort');
    if (sort) {
      const table = tab.tables.find((entry) => entry.id === sort.dataset.table);
      const column = table.columns.find((entry) => columnId(entry) === sort.dataset.column);
      const current = sorts.get(table.id);
      const first = firstDirection(column);
      if (!current || current.column !== sort.dataset.column) sorts.set(table.id, { column: sort.dataset.column, direction: first });
      else if (current.direction === first) sorts.set(table.id, { column: current.column, direction: first === 'asc' ? 'desc' : 'asc' });
      else sorts.delete(table.id);
      refresh(tab);
    }
  });

  panelsHost.addEventListener('input', (event) => {
    const input = event.target.closest('[data-estimate]');
    if (!input) return;
    const estimate = estimates.get(input.dataset.table);
    const value = Number(input.value);
    estimate[input.dataset.estimate] = Number.isFinite(value) && value >= 0 ? value : 0;
    refresh(tabsById.get(activeTab));
  });

  // Links to a tab (#embeddings, from the hero, the guide or a table) switch
  // tabs instead of jumping to an element that does not exist.
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    const id = link.getAttribute('href').slice(1);
    if (!tabsById.has(id)) return;
    event.preventDefault();
    selectTab(id, { scroll: true });
  });

  addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (tabsById.has(id) && id !== activeTab) selectTab(id, { scroll: true });
  });

  /* ------------------------------------------------------------ the rest of the page */

  const updated = document.getElementById('mg-updated');
  if (updated && latest) {
    updated.dateTime = latest;
    updated.textContent = formatDate(latest);
  }
  const benchmark = document.getElementById('mg-benchmark');
  if (benchmark && guide.benchmark) {
    benchmark.href = guide.benchmark.url;
    benchmark.textContent = guide.benchmark.label;
  }
  const languages = document.getElementById('mg-languages');
  if (languages && guide.languages) languages.textContent = guide.languages;

  const method = document.getElementById('mg-method');
  if (method) {
    const items = [
      { term: 'Review date', text: `Data as of **${latest ? formatDate(latest) : 'the date shown on each tab'}**. Prices, available models and measured speeds change. Each tab shows its own review date.` },
      ...(guide.method || []),
    ];
    method.innerHTML = items.map((item) => `<div class="mg-method-item"><dt>${escapeHtml(item.term)}</dt><dd>${inline(item.text)}</dd></div>`).join('');
  }

  const sources = document.getElementById('mg-sources');
  if (sources) {
    sources.innerHTML = (guide.sources || []).map((group) => `<div class="mg-source-group"><h3>${escapeHtml(group.title)}</h3><ul>${group.links.map((link) => (
      `<li><a href="${escapeHtml(link.url)}" target="_blank" rel="noopener">${escapeHtml(link.label)}</a></li>`
    )).join('')}</ul></div>`).join('');
  }

  const changelog = document.getElementById('mg-changelog');
  if (changelog) {
    changelog.innerHTML = (guide.changelog || []).map((entry) => (
      `<li><time datetime="${escapeHtml(entry.date)}">${formatDate(entry.date)}</time><span>${inline(entry.text)}</span></li>`
    )).join('');
  }

  /* ------------------------------------------------------------ start */

  const params = new URLSearchParams(location.search);
  for (const id of facetIds) {
    const value = params.get(id);
    if (value) selected.set(id, new Set(value.split(',').filter(Boolean)));
  }
  const requested = location.hash.slice(1);
  selectTab(tabsById.has(requested) ? requested : tabs[0].id, { sync: false });
  syncOverflow();
  if (tabsById.has(requested)) requestAnimationFrame(scrollToTabs);
})();
