/* Nodus web demo — a static, faithful replica of the app shell and views.
   Everything runs client-side on the sample corpus in data.js. */
(function () {
  const D = window.DATA;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const main = () => $('#main');

  // ---------- helpers ----------
  const workById = (id) => D.works.find((w) => w.id === id);
  const ideaById = (id) => D.ideas.find((i) => i.id === id);
  const themeById = (id) => D.themes.find((t) => t.id === id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), 3000);
  }

  function typeChip(type) {
    const c = window.TYPE_COLORS[type] || '#999';
    return `<span class="chip"><span class="dot" style="background:${c}"></span>${type}</span>`;
  }
  function edgeChip(type) {
    const c = window.EDGE_COLORS[type] || '#999';
    return `<span class="chip"><span class="dot" style="background:${c}"></span>${type.replace(/_/g, ' ')}</span>`;
  }

  // per-idea confidence + connection count, to mirror the real app's meta line
  const IDEA_CONF = { i1: 0.92, i2: 0.77, i3: 0.90, i4: 0.88, i5: 0.81, i6: 0.79, i7: 0.83, i8: 0.94, i9: 0.74, i10: 0.80, i11: 0.85, i12: 0.76 };
  const IDEA_CONN = (id) => D.edges.filter((e) => e.from === id || e.to === id).length;
  const IDEA_IN_DEBATE = new Set(['i1', 'i3', 'i6', 'i11']);
  const AUTHORS_FULL = { w1: 'Roediger, H. L. et al.', w2: 'Karpicke, J. D. & Blunt, J. R.', w3: 'Sweller, J.', w4: 'Cepeda, N. J. et al.', w5: 'Bjork, R. A. & Bjork, E. L.', w6: 'Van Gog, T. & Sweller, J.' };
  const WORK_PASSAGES = { w1: '0/2', w2: '0/1', w3: '0/2', w4: '0/2', w5: '0/1', w6: '0/1' };
  const WORK_TAG = { w1: 'demo-w1', w2: 'demo-w2', w3: 'demo-w3', w4: 'demo-w4', w5: 'demo-w5', w6: 'demo-w6' };
  const GAP_KIND = { g1: ['open question', '#a78bfa'], g2: ['open question', '#a78bfa'], g3: ['future work', '#22d3ee'], g4: ['limitation', '#fbbf24'] };

  // ---------- icons (inline, stroke style like the app) ----------
  const I = (d, cls) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"${cls ? ` class="${cls}"` : ''}>${d}</svg>`;
  const ICONS = {
    home: I('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>'),
    search: I('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    book: I('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14Z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>'),
    layers: I('<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>'),
    map: I('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>'),
    bulb: I('<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.7.5 1 1.4 1 2.3h6c0-.9.3-1.8 1-2.3A7 7 0 0 0 12 2Z"/>'),
    graduation: I('<path d="m22 9-10-5L2 9l10 5 10-5Z"/><path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5"/>'),
    compass: I('<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/>'),
    target: I('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>'),
    gap: I('<path d="M4 6h6M14 6h6M4 12h4M12 12h8M4 18h8M16 18h4"/>'),
    scale: I('<path d="M12 3v18M8 21h8"/><path d="m5 7 7-2 7 2"/><path d="M5 7 3 13a3 3 0 0 0 6 0L7 7M19 7l-2 6a3 3 0 0 0 6 0l-2-6"/>'),
    help: I('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.7 2.2c-.7.4-1.2 1-1.2 1.8v.5"/><path d="M12 17h.01"/>'),
    flask: I('<path d="M10 2v6L4.5 18a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 8V2"/><path d="M8 2h8"/>'),
    route: I('<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>'),
    network: I('<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5 6 17M12 7.5 18 17M7.5 19h9"/>'),
    globe: I('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>'),
    tools: I('<path d="M14.7 6.3a4 4 0 0 0-5-5L12 3.6 9.6 6 7.3 3.7a4 4 0 0 0 5 5L5 16l3 3 7.3-7.3a4 4 0 0 0 5-5L18 9l-3-3 2.3-2.3a4 4 0 0 0-2.6 2.6Z"/>'),
    telescope: I('<path d="m6 11 8-5 3 5-8 5-3-5Z"/><path d="m14 6 2-1.2 3 5-2 1.2M9 16l-2 5M12 14l4 7M5 21h13"/>'),
    edit: I('<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z"/>'),
    folder: I('<path d="M4 4h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/>'),
    notebook: I('<path d="M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"/><path d="M8 2v20M13 7h4M13 11h4"/>'),
    settings: I('<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z"/>'),
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7-11-7Z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
    plus: I('<path d="M12 5v14M5 12h14"/>'),
    chevronLeft: I('<path d="m15 5-7 7 7 7"/>'),
    chevronRight: I('<path d="m9 5 7 7-7 7"/>'),
    x: I('<path d="m5 5 14 14M19 5 5 19"/>'),
    check: I('<path d="m4 12.5 5 5L20 6.5"/>'),
    trash: I('<path d="M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6"/>'),
    download: I('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 19h16"/>'),
    sync: I('<path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v6h-6"/>'),
    external: I('<path d="M14 4h6v6M20 4 10 14"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>'),
    key: I('<circle cx="8" cy="14" r="4.5"/><path d="m11.5 10.5 8-8M18 4l2.5 2.5M15 7l2 2"/>'),
    wand: I('<path d="m14 6 4 4L7 21l-4-4L14 6Z"/><path d="M15 3h.01M20 8h.01M18 2l.5 2 2 .5-2 .5-.5 2-.5-2-2-.5 2-.5.5-2Z"/>'),
    palette: I('<path d="M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3 3h-2a2 2 0 0 0-1.5 3.3c.4.5.5 1.7-2.5 2.7Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10.5" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>'),
    link: I('<path d="M10 14a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2"/><path d="M14 10a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/>'),
    file: I('<path d="M6 2h8l5 5v15H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z"/><path d="M14 2v5h5"/>'),
    note: I('<path d="M5 3h14a1 1 0 0 1 1 1v12l-5 5H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M15 21v-5h5"/>'),
    languages: I('<path d="m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1"/><path d="m22 22-5-10-5 10M14 18h6"/>'),
    grid: I('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
    sparkle: I('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"/><path d="M19 15l.9 2.4L22 18.3l-2.1.9L19 21.6l-.9-2.4-2.1-.9 2.1-.9.9-2.4Z"/>'),
    eye: I('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'),
    clock: I('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>'),
    copy: I('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    shield: I('<path d="M12 2 4 5.5v6C4 16.5 7.5 20.6 12 22c4.5-1.4 8-5.5 8-10.5v-6L12 2Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
    word: I('<path d="M6 2h8l5 5v15H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z"/><path d="M14 2v5h5"/><path d="m8 12 1.5 6L11 13l1.5 5L14 12"/>'),
    list: I('<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>'),
  };

  const NAV = [
    { id: 'home', label: 'Home', icon: 'home' },
    { group: 'Explore' },
    { id: 'search', label: 'Search', icon: 'search' },
    { id: 'library', label: 'Library', icon: 'book' },
    { id: 'graph', label: 'Graph', icon: 'network' },
    { id: 'argument', label: 'Argument map', icon: 'layers' },
    { id: 'ideas', label: 'Ideas', icon: 'bulb' },
    { id: 'authors', label: 'Authors', icon: 'graduation' },
    { group: 'Analyze' },
    { id: 'immersion', label: 'Immersion', icon: 'target' },
    { id: 'research', label: 'State of the art', icon: 'compass' },
    { id: 'hypothesis', label: 'Hypotheses', icon: 'flask' },
    { id: 'reading', label: 'Reading path', icon: 'route' },
    { id: 'deepResearch', label: 'Deep Research', icon: 'telescope' },
    { group: 'Write' },
    { id: 'workspace', label: 'Workspace', icon: 'notebook' },
    { id: 'writing', label: 'Writing', icon: 'edit' },
    { id: 'projects', label: 'Projects', icon: 'folder' },
    { group: 'Tools' },
    { id: 'browser', label: 'Nodus Browser', icon: 'globe' },
    { id: 'toolkit', label: 'Nodus Toolkit', icon: 'tools' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];

  // ---------- mutable UI state ----------
  const state = {
    view: 'home',
    immersion: null,        // open immersion session id
    report: null,           // open deep-research report id
    reportPage: 0,
    draft: 'wd1',
    note: 'nn1',
    settingsTab: 'providers',
    researchTab: 'coverage',
    graphPreset: 'Overview',
    quiz: {},               // imId -> chosen index
    toggles: { autoAnalyze: false, readTag: true, animations: true, ocr: false, mcp: true, word: true, autoBackup: true, prerelease: false },
  };

  // ---------- global bottom player ----------
  const player = { audio: null, title: '' };
  function fmtTime(s) { return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0'); }
  function playTrack(src, title, sub) {
    const bp = $('#bottom-player');
    if (player.audio && player.title === title) { // toggle same track
      if (player.audio.paused) player.audio.play(); else player.audio.pause();
      return;
    }
    if (player.audio) { player.audio.pause(); player.audio = null; }
    const audio = new Audio(src);
    player.audio = audio; player.title = title;
    $('.tinfo b', bp).textContent = title;
    $('.tinfo span', bp).textContent = sub || '';
    const fill = $('.bar > div', bp), time = $('.time', bp), btn = $('.play', bp);
    btn.innerHTML = ICONS.pause;
    audio.addEventListener('play', () => (btn.innerHTML = ICONS.pause));
    audio.addEventListener('pause', () => (btn.innerHTML = ICONS.play));
    audio.addEventListener('timeupdate', () => {
      if (audio.duration) fill.style.width = (audio.currentTime / audio.duration) * 100 + '%';
      time.textContent = fmtTime(audio.currentTime) + (audio.duration ? ' / ' + fmtTime(audio.duration) : '');
    });
    audio.addEventListener('ended', () => { fill.style.width = '0%'; btn.innerHTML = ICONS.play; });
    bp.classList.add('open');
    audio.play();
  }
  function initBottomPlayer() {
    const bp = $('#bottom-player');
    bp.innerHTML = `
      <button class="play">${ICONS.play}</button>
      <div class="tinfo"><b></b><span></span></div>
      <div class="bar"><div></div></div>
      <span class="time">0:00</span>
      <button class="close" title="Close player">${ICONS.x}</button>`;
    $('.play', bp).addEventListener('click', () => {
      if (!player.audio) return;
      if (player.audio.paused) player.audio.play(); else player.audio.pause();
    });
    $('.bar', bp).addEventListener('click', (e) => {
      if (!player.audio || !player.audio.duration) return;
      const r = $('.bar', bp).getBoundingClientRect();
      player.audio.currentTime = ((e.clientX - r.left) / r.width) * player.audio.duration;
    });
    $('.close', bp).addEventListener('click', () => {
      if (player.audio) player.audio.pause();
      player.audio = null; player.title = '';
      bp.classList.remove('open');
    });
  }

  // ---------- modal ----------
  function openModal(html, wide) {
    closeModal();
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-overlay" id="modal-ov"><div class="modal${wide ? ' wide' : ''}">${html}</div></div>`;
    $('#modal-ov').addEventListener('mousedown', (e) => { if (e.target.id === 'modal-ov') closeModal(); });
  }
  function closeModal() { $('#modal-root').innerHTML = ''; }
  const modalHead = (title, sub) => `<div class="modal-head"><div><h3>${title}</h3>${sub ? `<p class="muted small" style="margin:3px 0 0">${sub}</p>` : ''}</div><button class="modal-x" onclick="UI.close()">${ICONS.x}</button></div>`;

  // ---------- shared detail modals ----------
  function ideaModal(id) {
    const i = ideaById(id);
    const w = workById(i.work);
    const rels = D.edges.filter((e) => e.from === id || e.to === id);
    openModal(`
      ${modalHead(esc(i.label), `${typeChip(i.type)} <span class="chip"><span class="dot" style="background:var(--orange)"></span>${esc(themeById(i.theme).label)}</span>`)}
      <div class="quote-block">“${esc(i.evidence)}”<span class="src">${esc(w.author)} (${w.year}), ${esc(w.title.slice(0, 60))}… · ${i.page}</span></div>
      <div class="nav-group-label" style="padding-left:0">Relations (${rels.length})</div>
      ${rels.map((e) => {
        const otherId = e.from === id ? e.to : e.from;
        const other = ideaById(otherId);
        const dir = e.from === id ? '→' : '←';
        return `<div class="arg-item plain" style="display:flex;gap:8px;align-items:center;cursor:pointer" onclick="UI.idea('${otherId}')">${edgeChip(e.type)}<span class="muted">${dir}</span> ${esc(other.label)}</div>`;
      }).join('') || '<p class="muted small">No typed relations yet.</p>'}
      <div class="tag-row" style="margin-top:16px">
        <button class="btn" onclick="UI.close();window.go('graph')">${ICONS.layers} Show in graph</button>
        <button class="btn" onclick="UI.work('${w.id}')">${ICONS.book} Open work</button>
        <button class="btn ghost" onclick="UI.toast('In the app: opens the exact page of the PDF in Zotero.')">${ICONS.external} Open in Zotero</button>
      </div>`);
  }

  function workModal(id) {
    const w = workById(id);
    const ideas = D.ideas.filter((i) => i.work === id);
    openModal(`
      ${modalHead(esc(w.title), `${esc(w.author)} · ${w.year} · ${esc(w.venue)} · ${esc(w.type)}`)}
      <div class="tag-row" style="margin:10px 0">
        ${w.read ? `<span class="chip"><span class="dot" style="background:var(--green)"></span>read</span>` : `<span class="chip"><span class="dot" style="background:var(--amber)"></span>to read</span>`}
        <span class="chip">${w.pages} pp.</span>
        <span class="chip"><span class="dot" style="background:var(--green)"></span>${esc(w.scanned)}</span>
        <span class="chip keymask">zotero:${w.zoteroKey}</span>
      </div>
      <p class="muted small" style="margin:4px 0 14px">${esc(w.abstract)}</p>
      <div class="nav-group-label" style="padding-left:0">Ideas extracted (${ideas.length})</div>
      ${ideas.map((i) => `<div class="arg-item plain" style="cursor:pointer;display:flex;gap:8px;align-items:center" onclick="UI.idea('${i.id}')">${typeChip(i.type)} ${esc(i.label)}</div>`).join('')}
      <div class="tag-row" style="margin-top:16px">
        <button class="btn" onclick="UI.toast('In the app: re-runs the local scan of the attached file and updates ideas losslessly.')">${ICONS.sync} Re-analyze</button>
        <button class="btn ghost" onclick="UI.toast('In the app: jumps to this item in your Zotero library.')">${ICONS.external} Open in Zotero</button>
      </div>`);
  }

  function authorModal(id) {
    const a = D.authors.find((x) => x.id === id);
    openModal(`
      ${modalHead(esc(a.name), 'Author sheet · identity reconciled with Zotero creators')}
      <div class="quote-block" style="border-color:var(--cyan)">“${esc(a.stance)}”<span class="src">Synthesised stance from ${a.ideas.length} ideas</span></div>
      <div class="nav-group-label" style="padding-left:0">Works in corpus (${a.works.length})</div>
      ${a.works.map((wid) => { const w = workById(wid); return `<div class="arg-item plain" style="cursor:pointer" onclick="UI.work('${wid}')">${esc(w.author)} (${w.year}) — ${esc(w.title)}</div>`; }).join('')}
      <div class="nav-group-label" style="padding-left:0">Their ideas (${a.ideas.length})</div>
      <div class="tag-row">${a.ideas.map((iid) => `<span class="chip link" onclick="UI.idea('${iid}')">${esc(ideaById(iid).label.slice(0, 44))}${ideaById(iid).label.length > 44 ? '…' : ''}</span>`).join('')}</div>
      <div class="nav-group-label" style="padding-left:0">Position map</div>
      <div class="tag-row">
        ${a.agrees.map((n) => `<span class="chip"><span class="dot" style="background:var(--green)"></span>agrees with ${esc(n)}</span>`).join('')}
        ${a.disputes.map((n) => `<span class="chip"><span class="dot" style="background:var(--red)"></span>disputes ${esc(n)}</span>`).join('')}
      </div>`);
  }

  function gapModal(id) {
    const g = D.gaps.find((x) => x.id === id);
    openModal(`
      ${modalHead(esc(g.title), `<span class="chip"><span class="dot" style="background:${g.strength === 'high' ? 'var(--red)' : 'var(--amber)'}"></span>${g.strength} signal</span> ${g.themes.map((t) => `<span class="chip">${esc(themeById(t).label)}</span>`).join(' ')}`)}
      <p class="muted small">${esc(g.detail)}</p>
      <div class="nav-group-label" style="padding-left:0">Between these ideas</div>
      ${g.adjacent.map((iid) => `<div class="arg-item plain" style="cursor:pointer;display:flex;gap:8px;align-items:center" onclick="UI.idea('${iid}')">${typeChip(ideaById(iid).type)} ${esc(ideaById(iid).label)}</div>`).join('')}
      <div class="nav-group-label" style="padding-left:0">Suggested coverage question</div>
      <div class="quote-block" style="border-color:var(--amber);font-style:normal">${esc(g.question)}</div>
      <div class="nav-group-label" style="padding-left:0">Candidate sources <span style="text-transform:none;letter-spacing:0">(external catalogue search)</span></div>
      ${g.sources.map((s) => `<div class="set-row"><div class="lbl"><b style="font-weight:600;font-size:13px">${esc(s.title)}</b><span>semantic match ${s.match}</span></div><button class="btn ghost small" onclick="UI.toast('In the app: adds the reference to Zotero via DOI lookup.')">${ICONS.plus} Add to Zotero</button></div>`).join('')}
      <div class="tag-row" style="margin-top:14px">
        <button class="btn primary" onclick="UI.close();window.go('coverage');UI.toast('Coverage question drafted from the gap.')">${ICONS.help} Track as coverage question</button>
      </div>`);
  }

  function coverageModal(id) {
    const q = D.coverage.find((x) => x.id === id);
    const color = q.status === 'covered' ? 'var(--green)' : q.status === 'partial' ? 'var(--amber)' : 'var(--red)';
    openModal(`
      ${modalHead(esc(q.question), `<span class="chip"><span class="dot" style="background:${color}"></span>${q.status}</span>`)}
      <p class="muted small">${esc(q.note)}</p>
      <div class="nav-group-label" style="padding-left:0">Evidence in corpus (${q.evidence.length})</div>
      ${q.evidence.map((iid) => `<div class="arg-item plain" style="cursor:pointer;display:flex;gap:8px;align-items:center" onclick="UI.idea('${iid}')">${typeChip(ideaById(iid).type)} ${esc(ideaById(iid).label)}</div>`).join('')}
      ${q.missing ? `<div class="nav-group-label" style="padding-left:0">What would close it</div><div class="quote-block" style="border-color:var(--red);font-style:normal">${esc(q.missing)}</div>` : '<p class="small" style="color:var(--green);margin-top:12px">This question is fully covered by the corpus.</p>'}
      <div class="tag-row" style="margin-top:14px">
        <button class="btn" onclick="UI.toast('In the app: the assistant re-evaluates coverage against the latest graph.')">${ICONS.sync} Re-evaluate</button>
        <button class="btn ghost" onclick="UI.toast('In the app: finds candidate external sources for the missing piece.')">${ICONS.search} Find sources</button>
      </div>`);
  }

  function hypoModal(id) {
    const h = D.hypotheses.find((x) => x.id === id);
    openModal(`
      ${modalHead(esc(h.title), '<span class="chip"><span class="dot" style="background:var(--violet)"></span>proposed hypothesis</span>')}
      <p style="margin:10px 0">${esc(h.statement)}</p>
      <div class="nav-group-label" style="padding-left:0">Built from</div>
      ${h.support.map((iid) => `<div class="arg-item plain" style="cursor:pointer;display:flex;gap:8px;align-items:center" onclick="UI.idea('${iid}')">${typeChip(ideaById(iid).type)} ${esc(ideaById(iid).label)}</div>`).join('')}
      <div class="nav-group-label" style="padding-left:0">Falsifiability</div>
      <p class="muted small">${esc(h.risk)}</p>
      <div class="nav-group-label" style="padding-left:0">Suggested test design</div>
      <div class="quote-block" style="border-color:var(--cyan);font-style:normal">${esc(h.test)}</div>
      <div class="tag-row" style="margin-top:14px">
        <button class="btn primary" onclick="UI.close();window.go('writing');UI.toast('In the app: opens a draft pre-seeded with the hypothesis and its citations.')">${ICONS.edit} Draft this section</button>
      </div>`);
  }

  function projectModal(id) {
    const p = D.projects.find((x) => x.id === id);
    openModal(`
      ${modalHead(esc(p.name), esc(p.updated))}
      <p class="muted small" style="margin:6px 0 14px">${esc(p.goal)}</p>
      <div class="nav-group-label" style="padding-left:0">Works (${p.works.length})</div>
      <div class="tag-row">${p.works.map((wid) => `<span class="chip link" onclick="UI.work('${wid}')">${esc(workById(wid).author)} ${workById(wid).year}</span>`).join('')}</div>
      <div class="nav-group-label" style="padding-left:0">Drafts (${p.drafts.length})</div>
      ${p.drafts.map((did) => { const d = D.writing.drafts.find((x) => x.id === did); return `<div class="arg-item plain" style="cursor:pointer" onclick="UI.close();window.go('writing')">${esc(d.title)} <span class="muted small">· ${d.words} words · ${d.citations} citations</span></div>`; }).join('')}
      <div class="nav-group-label" style="padding-left:0">Notes</div>
      ${p.notes.map((n) => `<div class="arg-item plain" style="cursor:pointer" onclick="UI.close();window.go('notes')">${esc(n)}</div>`).join('')}`);
  }

  // ---------- study sessions ----------
  const study = { deck: null, card: 0, flipped: false, sIdx: 0, sOpen: false };
  function studyModal(id) {
    const g = D.studyGuide.find((x) => x.id === id);
    if (g.cards) { study.deck = g; study.card = 0; study.flipped = false; renderFlash(); return; }
    if (g.route) { study.deck = g; study.sIdx = 0; study.sOpen = false; renderSocratic(); return; }
    openModal(`
      ${modalHead(esc(g.title), g.kind)}
      <div style="overflow-x:auto"><table class="tbl">${g.matrix.map((row, ri) => `<tr>${row.map((c) => ri === 0 ? `<th>${esc(c)}</th>` : `<td${row.indexOf(c) === 0 ? ' style="font-weight:600"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div>`, true);
  }
  function renderFlash() {
    const g = study.deck, c = g.cards[study.card];
    openModal(`
      ${modalHead(esc(g.title), `Flashcards · card ${study.card + 1} of ${g.cards.length} · spaced repetition`)}
      <div class="flashcard" onclick="UI.flip()">
        <div>${study.flipped ? `<span class="small" style="color:var(--green);font-weight:700;letter-spacing:0.06em">ANSWER</span><p style="margin:10px 0 0">${esc(c.a)}</p>` : `<p style="margin:0">${esc(c.q)}</p>`}<span class="hint">${study.flipped ? 'click to see the question' : 'click to reveal the answer'}</span></div>
      </div>
      <div class="tag-row" style="margin-top:14px;justify-content:space-between">
        <div>${study.flipped ? `
          <button class="btn" style="border-color:rgba(248,113,113,0.5)" onclick="UI.nextCard()">Again soon</button>
          <button class="btn" style="border-color:rgba(52,211,153,0.5)" onclick="UI.nextCard()">Got it</button>` : `<button class="btn" onclick="UI.flip()">${ICONS.eye} Show answer</button>`}
        </div>
        <div class="progress" style="width:120px;align-self:center"><div style="width:${((study.card) / g.cards.length) * 100}%"></div></div>
      </div>`);
  }
  function renderSocratic() {
    const g = study.deck, s = g.route[study.sIdx];
    openModal(`
      ${modalHead(esc(g.title), `Socratic route · step ${study.sIdx + 1} of ${g.route.length}`)}
      <div class="quote-block" style="border-color:var(--cyan);font-style:normal;font-size:14.5px">${esc(s.q)}</div>
      ${study.sOpen ? `<p class="muted" style="margin:12px 0">${esc(s.a)}</p>
        <button class="btn primary" onclick="UI.socNext()">${study.sIdx + 1 < g.route.length ? 'Next question' : 'Finish route'}</button>`
      : `<p class="muted small" style="margin:12px 0">Think it through, then reveal what the corpus says.</p>
        <button class="btn" onclick="UI.socReveal()">${ICONS.eye} Reveal</button>`}`);
  }

  // ---------- composers ----------
  function immersionComposer() {
    openModal(`
      ${modalHead('New immersion', 'Choose the topic and scope. Before generating you will see what your corpus knows (no AI yet).')}
      <textarea class="search-input" id="imm-topic" placeholder="What do you want to become an expert in? E.g.: the boundary conditions of the testing effect">The boundary conditions of the testing effect</textarea>
      <div class="tag-row" style="margin:12px 0">
        <div><div class="nav-group-label" style="padding:0 0 4px">Duration</div>
          <select class="select"><option>Short · ~15 min</option><option selected>Standard · ~25 min</option><option>Deep · ~45 min</option></select></div>
      </div>
      <div class="tag-row" style="margin:4px 0 16px">
        <button class="chip link" onclick="this.classList.toggle('active');this.style.borderColor=this.style.borderColor?'':'var(--indigo)'" style="border-color:var(--indigo)">${ICONS.check} Review questions</button>
        <button class="chip link" onclick="this.style.borderColor=this.style.borderColor?'':'var(--indigo)'" style="border-color:var(--indigo)">${ICONS.check} Decorative image</button>
      </div>
      <div class="tag-row" style="justify-content:flex-end">
        <button class="btn ghost" onclick="UI.close()">Cancel</button>
        <button class="btn primary" onclick="UI.scope()">${ICONS.compass} Explore the territory</button>
      </div>`);
  }
  function scopeScreen() {
    const s = D.immersions[1];
    openModal(`
      ${modalHead('The territory', 'This is what your corpus knows about the topic. No AI yet: just embeddings and the graph.')}
      <div class="scope-stats">
        ${[['9', 'ideas'], ['5', 'works'], ['5', 'authors'], ['1', 'debates'], ['2', 'gaps'], ['22', 'passages']].map(([v, l]) => `<div class="scope-stat"><b>${v}</b><span>${l}</span></div>`).join('')}
      </div>
      <div class="nav-group-label" style="padding-left:0">Main voices</div>
      <div class="tag-row">${['Karpicke', 'Roediger', 'Van Gog', 'Sweller', 'Bjork'].map((n) => `<span class="chip">${n}</span>`).join('')}</div>
      <div class="nav-group-label" style="padding-left:0">Themes it touches</div>
      <div class="tag-row">${['RETRIEVAL PRACTICE', 'COGNITIVE LOAD'].map((n) => `<span class="chip"><span class="dot" style="background:var(--orange)"></span>${n}</span>`).join('')}</div>
      <div class="nav-group-label" style="padding-left:0">Strongest ideas</div>
      ${['i1', 'i6', 'i3'].map((iid) => `<div class="arg-item plain" style="cursor:pointer;display:flex;gap:8px;align-items:center" onclick="UI.idea('${iid}')">${typeChip(ideaById(iid).type)} ${esc(ideaById(iid).label)}</div>`).join('')}
      <p class="muted small" style="margin-top:12px">Estimated: ~25 min · 2 stations · questions on · decorative image on</p>
      <div class="tag-row" style="justify-content:flex-end">
        <button class="btn ghost" onclick="UI.newImmersion()">${ICONS.chevronLeft} Back</button>
        <button class="btn primary" onclick="UI.close();UI.toast('In the app: the immersion is generated in the background and lands in this gallery, resumable at any point.');">${ICONS.sparkle} Generate immersion</button>
      </div>`);
  }
  function reportComposer() {
    openModal(`
      ${modalHead('New report', 'The report develops your idea in full, citing the whole corpus.')}
      <textarea class="search-input" placeholder="Write the research idea or question. The report will develop it completely, citing every work in the corpus.">Is the testing effect one mechanism or a family of effects with different boundary conditions?</textarea>
      <div class="tag-row" style="margin:12px 0">
        <button class="chip link" style="border-color:var(--indigo)">${ICONS.check} Decorative image</button>
        <span class="chip">writer: nodus model (claude-sonnet-5)</span>
      </div>
      <p class="muted small">Generated in the background: you can close this and keep working. Reports queue and run one after another.</p>
      <div class="tag-row" style="justify-content:flex-end;margin-top:8px">
        <button class="btn ghost" onclick="UI.close()">Cancel</button>
        <button class="btn primary" onclick="UI.close();UI.toast('Report added to the queue. In the app it generates in the background while you keep working.')">${ICONS.plus} Add to queue</button>
      </div>`);
  }

  function matrixModal(rid) {
    const r = D.deepResearch.find((x) => x.id === rid);
    openModal(`
      ${modalHead('Support matrix', 'Which works back each claim of the report — and which push back.')}
      <div style="overflow-x:auto"><table class="tbl">
        <thead><tr><th>Claim</th><th>Source A</th><th></th><th>Source B</th><th></th></tr></thead>
        <tbody>${r.matrix.map((row) => `<tr><td style="font-weight:600">${esc(row[0])}</td><td>${esc(row[1])}</td><td>${row[2] ? edgeChip(row[2]) : ''}</td><td>${esc(row[3])}</td><td>${row[4] ? edgeChip(row[4]) : ''}</td></tr>`).join('')}</tbody>
      </table></div>`, true);
  }

  // ---------- assistant chat ----------
  const chat = {
    open: false, view: 'chat', current: 'c1', seq: 3, replyIdx: 0, waiting: false,
    convos: [
      { id: 'c1', archived: false, title: 'Testing effect boundaries', messages: [
        { who: 'user', text: 'What does my corpus say about the testing effect?' },
        { who: 'ai', text: 'Six works touch it, and they disagree in exactly one place: whether the effect survives complex material. The strongest support and the sharpest objection are one click away:', chips: [['idea', 'i1'], ['idea', 'i6'], ['author', 'a6']] },
      ] },
      { id: 'c2', archived: true, title: 'Is spacing just covert retrieval?', messages: [
        { who: 'user', text: 'Is spacing just covert retrieval?' },
        { who: 'ai', text: 'Your corpus never tests it directly — it is logged as an open gap, and one of your hypotheses proposes the experiment that would settle it:', chips: [['idea', 'i8'], ['idea', 'i9'], ['gap', 'g2']] },
      ] },
    ],
  };
  const CANNED = [
    { text: 'Quick confession: I am not an AI — this is a static web demo, so nobody is actually thinking right now. In the desktop app I answer from your corpus and cite only what exists. A real answer would look like this:', chips: [['idea', 'i1'], ['idea', 'i2'], ['author', 'a1']] },
    { text: 'Still not an AI (my entire brain is one JSON file), but here is the shape of a real reply: your corpus hosts a live dispute on exactly this. One camp says the effect is robust; the other says working memory gates it:', chips: [['idea', 'i6'], ['idea', 'i11'], ['author', 'a6']] },
    { text: 'I would love to reason about that, but thinking is sold separately — it ships with the desktop app (bring your own key, or run a local model with Ollama). What I can do is point at the open gap your question grazes:', chips: [['gap', 'g1'], ['idea', 'i8'], ['author', 'a4']] },
  ];
  const curConvo = () => chat.convos.find((c) => c.id === chat.current);
  function chatChip([kind, id]) {
    if (kind === 'idea') { const i = ideaById(id); return `<span class="chip link" onclick="UI.idea('${id}')"><span class="dot" style="background:${window.TYPE_COLORS[i.type]}"></span>${esc(i.label.slice(0, 40))}${i.label.length > 40 ? '…' : ''}</span>`; }
    if (kind === 'author') { const a = D.authors.find((x) => x.id === id); return `<span class="chip link" onclick="UI.author('${id}')"><span class="dot" style="background:var(--violet)"></span>${esc(a.name)}</span>`; }
    if (kind === 'gap') { const g = D.gaps.find((x) => x.id === id); return `<span class="chip link" onclick="UI.gap('${id}')"><span class="dot" style="background:var(--amber)"></span>gap · ${esc(g.title)}</span>`; }
    return '';
  }
  function renderChat(typing) {
    const root = $('#chat-root');
    if (!chat.open) { root.innerHTML = ''; return; }
    const archived = chat.convos.filter((c) => c.archived);
    const convo = curConvo();
    let body;
    if (chat.view === 'archive') {
      body = `<div class="chat-msgs">
        <div><button class="btn ghost small" onclick="UI.chatBack()">${ICONS.chevronLeft} Back to the conversation</button></div>
        <div class="nav-group-label" style="padding-left:0">Archived conversations (${archived.length})</div>
        ${archived.length ? archived.map((c) => `<div class="conv-row" onclick="UI.chatOpen('${c.id}')">
          <div class="cv-t"><b>${esc(c.title)}</b><span>${c.messages.length} messages · archived</span></div>
          <span class="btn ghost small">Open</span>
        </div>`).join('') : '<p class="muted small">Nothing archived yet.</p>'}
      </div>`;
    } else {
      body = `<div class="chat-msgs" id="chat-msgs">
        ${convo.messages.length === 0 ? `<div class="msg hint">Ask anything about the sample corpus. Spoiler: I am a demo, not an AI — but I will show you exactly how answers look in the app.</div>` : ''}
        ${convo.messages.map((m) => m.who === 'user'
          ? `<div class="msg user">${esc(m.text)}</div>`
          : `<div class="msg ai">${esc(m.text)}${m.chips ? `<div class="tag-row">${m.chips.map(chatChip).join('')}</div>` : ''}</div>`).join('')}
        ${typing ? '<div class="msg ai"><span class="typing"><i></i><i></i><i></i></span></div>' : ''}
      </div>
      <div class="chat-input">
        <input id="chat-inp" placeholder="Ask about your corpus…" autocomplete="off"
          onkeydown="if(event.key==='Enter')UI.chatSend()"/>
        <button class="btn primary" onclick="UI.chatSend()">Send</button>
      </div>`;
    }
    root.innerHTML = `<div class="modal-overlay" id="chat-ov"><div class="modal chat-modal">
      <div class="chat-head">
        <div style="flex:1;min-width:0">
          <h3>${ICONS.sparkle} Assistant</h3>
          <p>Corpus-aware chat — answers cite only what exists in your vault.</p>
        </div>
        <button class="modal-x" onclick="UI.chatClose()">${ICONS.x}</button>
      </div>
      <div class="chat-tools">
        <button class="btn small" onclick="UI.chatNew()">${ICONS.plus} New conversation</button>
        <button class="btn ghost small${chat.view === 'archive' ? ' primary' : ''}" onclick="UI.chatArchView()">${ICONS.folder} Archived (${archived.length})</button>
        ${chat.view === 'chat' ? `<button class="btn ghost small" style="margin-left:auto" onclick="UI.chatArchive()" title="Archive this conversation">${ICONS.download} Archive conversation</button>` : ''}
      </div>
      ${body}
    </div></div>`;
    $('#chat-ov').addEventListener('mousedown', (e) => { if (e.target.id === 'chat-ov') UI.chatClose(); });
    const msgs = $('#chat-msgs');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
    const inp = $('#chat-inp');
    if (inp) inp.focus();
  }

  // Incremental message helpers — avoid rebuilding the whole modal (no flicker).
  function msgHTML(m) {
    return m.who === 'user'
      ? `<div class="msg user">${esc(m.text)}</div>`
      : `<div class="msg ai">${esc(m.text)}${m.chips ? `<div class="tag-row">${m.chips.map(chatChip).join('')}</div>` : ''}</div>`;
  }
  function chatScroll() { const b = $('#chat-msgs'); if (b) b.scrollTop = b.scrollHeight; }
  function appendMsg(m) { const b = $('#chat-msgs'); if (!b) return; b.insertAdjacentHTML('beforeend', msgHTML(m)); chatScroll(); }
  function showTyping() { const b = $('#chat-msgs'); if (!b) return; b.insertAdjacentHTML('beforeend', '<div class="msg ai typing-bubble"><span class="typing"><i></i><i></i><i></i></span></div>'); chatScroll(); }
  function hideTyping() { const t = $('#chat-msgs .typing-bubble'); if (t) t.remove(); }

  // ---------- views ----------
  const VIEWS = {};
  const title = (icon, label, sub) => `<h1 class="view-title">${ICONS[icon]} ${label}</h1><p class="view-sub">${sub}</p>`;

  VIEWS.home = () => `
    <section class="academic-hero">
      <div class="academic-eyebrow">${ICONS.book} Academic vault</div>
      <h1>Your research workspace</h1>
      <p>Organize your corpus, connect ideas and turn analysis into next steps from a local, private workspace.</p>
    </section>
    <div class="card next-step-card">
      <div class="small" style="letter-spacing:0.08em;text-transform:uppercase;color:var(--text-3);font-weight:700">Recommended next step</div>
      <h3 style="font-size:17px;margin-top:6px">Open the graph — 1 contradiction is waiting</h3>
      <p class="muted small" style="margin:4px 0 12px">Van Gog &amp; Sweller (2015) push back on your two strongest ideas. State of the art sets both positions head to head.</p>
      <button class="btn primary" onclick="go('debate')">Review the debate</button>
    </div>
    <div class="card corpus-health" style="margin-top:14px">
      <div class="view-head"><div><h3>Corpus health</h3><p class="muted small" style="margin:2px 0 10px">What is left to analyse, index or recover.</p></div><span class="muted small">${D.works.length} works</span></div>
      <div class="health-grid">
        <div><span>No text</span><b>0</b></div><div><span>Light analysis only</span><b>0</b></div><div><span>Priority to analyse</span><b>0</b></div><div><span>Embeddings</span><b>up to date</b></div>
      </div>
    </div>
    <div class="grid cols-3" style="margin-top:14px">
      ${[
        ['Corpus', `${D.works.length}`, 'works synced', 'library', 'Library', 83],
        ['Analysis', `${D.works.length}/${D.works.length}`, 'with themes & ideas', 'graph', 'Analyze', 100],
        ['Graph', `${D.ideas.length}`, 'navigable ideas', 'graph', 'Open graph', 90],
        ['State of the art', `${D.coverage.length}`, 'questions mapped', 'research', 'Review', 72],
        ['Workspace', `${D.notes.reduce((sum, folder) => sum + folder.notes.length, 0)}`, 'notes and ideas', 'workspace', 'Open', 76],
        ['Writing', 'ready', 'academic workshop', 'writing', 'Open', 100],
      ].map(([t, n, s, view, cta, pct]) => `
        <div class="card click" onclick="go('${view}')">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <h3>${t}</h3><span class="btn ghost small">${cta}</span>
          </div>
          <div class="stat">${n} <span class="small muted" style="font-weight:400">${s}</span></div>
          <div class="progress"><div style="width:${pct}%"></div></div>
        </div>`).join('')}
    </div>`;

  VIEWS.search = () => `
    <div class="search-heading">
      ${title('search', 'Global search', 'Search across notes, ideas, works, gaps, themes and authors.')}
      <div class="segmented"><button class="active">Text</button><button>Meaning</button></div>
    </div>
    <input class="search-input search-hero-input" id="search-box" placeholder="Search across notes, ideas, works, gaps, themes and authors…" autocomplete="off"/>
    <div class="pills search-scopes"><button class="pill active">${ICONS.notebook} Notes</button><button class="pill active">${ICONS.bulb} Ideas</button><button class="pill active">${ICONS.book} Works</button><button class="pill active">${ICONS.gap} Gaps</button><button class="pill active">Themes</button><button class="pill active">${ICONS.graduation} Authors</button></div>
    <div id="search-results" style="margin-top:16px"></div>`;

  function runSearch(q) {
    const box = $('#search-results');
    const query = q.trim().toLowerCase();
    if (!query) { box.innerHTML = '<p class="muted small">Type to search the sample corpus. Semantic matches are simulated with substring + theme matching. Every result opens its full detail.</p>'; return; }
    const ideas = D.ideas.filter((i) => (i.label + ' ' + i.evidence).toLowerCase().includes(query));
    const authors = D.authors.filter((a) => (a.name + ' ' + a.stance).toLowerCase().includes(query));
    const works = D.works.filter((w) => (w.title + ' ' + w.author + ' ' + w.abstract).toLowerCase().includes(query));
    box.innerHTML = `
      ${ideas.length ? `<div class="nav-group-label" style="padding-left:0">Ideas (${ideas.length})</div>` + ideas.map((i) => `
        <div class="card click" style="margin-top:8px" onclick="UI.idea('${i.id}')"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${typeChip(i.type)}<b>${esc(i.label)}</b></div>
        <p class="muted small" style="margin:6px 0 0">${esc(i.evidence)} — <i>${esc(workById(i.work).author)} ${workById(i.work).year}, ${i.page}</i></p></div>`).join('') : ''}
      ${authors.length ? `<div class="nav-group-label" style="padding-left:0">Authors (${authors.length})</div>` + authors.map((a) => `<div class="card click" style="margin-top:8px" onclick="UI.author('${a.id}')"><b>${esc(a.name)}</b><p class="muted small" style="margin:4px 0 0">${esc(a.stance)}</p></div>`).join('') : ''}
      ${works.length ? `<div class="nav-group-label" style="padding-left:0">Works (${works.length})</div>` + works.map((w) => `<div class="card click" style="margin-top:8px" onclick="UI.work('${w.id}')"><b>${esc(w.title)}</b><p class="muted small" style="margin:4px 0 0">${esc(w.author)} · ${w.year} · ${esc(w.venue)}</p></div>`).join('') : ''}
      ${!ideas.length && !authors.length && !works.length ? '<p class="muted">No matches in the sample corpus.</p>' : ''}`;
  }

  VIEWS.library = () => `
    <div class="view-head">
      <div>
        <h1 class="view-title">${ICONS.book} Library <span class="muted" style="font-size:14px;font-weight:400">${D.works.length} works visible</span></h1>
        <p class="view-sub" style="margin-bottom:0">Works synced from Zotero. Click any work to see its extracted ideas and analysis state.</p>
      </div>
      <div class="tag-row">
        <div class="segmented"><button class="active">This vault</button><button>Enable Global</button></div>
        <button class="btn ghost">${ICONS.folder} Collections</button>
      </div>
    </div>
    <div class="toolbar library-search" style="margin:16px 0 10px">
      <input class="search-input" style="flex:1;min-width:170px" placeholder="Search title or author…"/>
      <button class="btn ghost">${ICONS.list} Filters</button>
    </div>
    <div class="tag-row" style="margin-bottom:14px">
      <span class="muted small">${D.works.length} results with the current filters</span>
      <button class="btn ghost small">${ICONS.check} Select the ${D.works.length} on this page</button>
      <button class="btn primary small" onclick="UI.toast('In the app: opens the analysis pipeline for the selected works.')">${ICONS.compass} Process library</button>
    </div>
    <div class="card" style="padding:0;overflow-x:auto">
      <table class="tbl"><thead><tr><th>Title</th><th>Authors</th><th>Year</th><th>Theme(s)</th><th>Ideas</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      ${D.works.map((w) => `<tr class="rowlink" onclick="UI.work('${w.id}')">
        <td><b>${esc(w.title.length > 46 ? w.title.slice(0, 44) + '…' : w.title)}</b><div class="muted small">${WORK_TAG[w.id]}</div></td>
        <td class="muted" style="white-space:nowrap">${esc(AUTHORS_FULL[w.id])}</td>
        <td class="muted">${w.year}</td>
        <td class="muted" style="max-width:150px"><span style="display:inline-block;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom">${esc(themeById(w.themeIds[0]).label)}</span></td>
        <td>${D.ideas.filter((i) => i.work === w.id).length}</td>
        <td><span class="chip" style="color:var(--amber);border-color:rgba(251,191,36,0.42)">${ICONS.file} Abstract only</span></td>
        <td><button class="btn ghost small" onclick="event.stopPropagation();UI.toast('The desktop app can analyze this work from its attached file.')">Analyze</button></td>
      </tr>`).join('')}
      </tbody></table>
    </div>
    <p class="muted small" style="margin-top:12px">The desktop app keeps this list in sync with Zotero — duplicate detection and lossless merge, degraded-scan auto-retry, and a full audit ledger of every change.</p>`;

  // ---- graph (canvas force layout) ----
  VIEWS.graph = () => `
    ${title('network', 'Graph', 'Every idea, theme and relation in the corpus — draggable, filterable, alive. Click a node.')}
    <div class="pills" id="graph-presets">
      ${['Overview', 'Contradictions', 'Gaps', 'Reading', 'Authors'].map((p, i) => `<button class="pill ${i === 0 ? 'active' : ''}" data-p="${p}">${p}</button>`).join('')}
    </div>
    <div class="graph-wrap">
      <canvas id="graph-canvas"></canvas>
      <div class="legend">
        <div style="font-weight:700;margin-bottom:4px;color:var(--text)">Legend</div>
        ${Object.entries(window.TYPE_COLORS).map(([k, c]) => `<div class="row"><span class="dot" style="background:${c}"></span>${k}</div>`).join('')}
        <div style="border-top:1px solid var(--border);margin:6px 0"></div>
        ${['supports', 'contradicts', 'extends', 'refines'].map((k) => `<div class="row"><span class="line" style="background:${window.EDGE_COLORS[k]}"></span>${k}</div>`).join('')}
      </div>
      <div class="node-panel" id="node-panel"></div>
    </div>`;

  let graphAnim = null;
  function initGraph(preset) {
    cancelAnimationFrame(graphAnim);
    const canvas = $('#graph-canvas');
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight || 560;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const nodes = [
      ...D.themes.map((t) => ({ id: t.id, label: t.label, type: 'theme', r: 11 })),
      ...D.ideas.map((i) => ({ id: i.id, label: i.label, type: i.type, r: 6.5, theme: i.theme, work: i.work })),
    ];
    const edges = [
      ...D.edges.map((e) => ({ ...e })),
      ...D.ideas.map((i) => ({ from: i.id, to: i.theme, type: '_member' })),
    ];
    const byId = {}; nodes.forEach((n) => (byId[n.id] = n));
    nodes.forEach((n, k) => {
      const a = (k / nodes.length) * Math.PI * 2;
      n.x = W / 2 + Math.cos(a) * (140 + (k % 3) * 40);
      n.y = H / 2 + Math.sin(a) * (110 + (k % 3) * 30);
      n.vx = 0; n.vy = 0;
    });

    const emphasize = (e) =>
      preset === 'Contradictions' ? (e.type === 'contradicts' || e.type === 'refutes') :
      preset === 'Reading' ? ['supports', 'extends'].includes(e.type) : true;
    const nodeDim = (n) => {
      if (preset === 'Gaps') return !['t2', 'i6', 'i11', 'i8'].includes(n.id);
      if (preset === 'Contradictions') return !['i2', 'i6', 'i1', 'i11', 't1', 't2'].includes(n.id);
      return false;
    };

    let dragging = null, hover = null, selected = null;
    const pos = (ev) => {
      const r = canvas.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };
    const pick = (p) => nodes.find((n) => Math.hypot(n.x - p.x, n.y - p.y) < n.r + 6);
    canvas.onmousedown = (ev) => { const p = pos(ev); dragging = pick(p); };
    canvas.onmousemove = (ev) => {
      const p = pos(ev);
      if (dragging) { dragging.x = p.x; dragging.y = p.y; dragging.vx = dragging.vy = 0; }
      else { hover = pick(p); canvas.style.cursor = hover ? 'pointer' : 'grab'; }
    };
    window.onmouseup = () => (dragging = null);
    canvas.onclick = (ev) => {
      const n = pick(pos(ev));
      selected = n || null;
      const panel = $('#node-panel');
      if (!n) { panel.classList.remove('open'); return; }
      const idea = ideaById(n.id);
      panel.classList.add('open');
      panel.innerHTML = idea
        ? `${typeChip(idea.type)}<h4 style="margin-top:8px">${esc(idea.label)}</h4>
           <p class="muted small">${esc(idea.evidence)}</p>
           <p class="small" style="color:#a5b4fc">${esc(workById(idea.work).author)} ${workById(idea.work).year}, ${idea.page}</p>
           <button class="btn small" onclick="UI.idea('${idea.id}')">Open idea</button>`
        : `${typeChip('theme')}<h4 style="margin-top:8px">${esc(n.label)}</h4>
           <p class="muted small">${D.ideas.filter((i) => i.theme === n.id).length} ideas in this theme.</p>`;
    };

    function step() {
      for (const n of nodes) {
        for (const m of nodes) {
          if (n === m) continue;
          const dx = n.x - m.x, dy = n.y - m.y;
          const d2 = dx * dx + dy * dy + 40;
          const f = 1400 / d2;
          n.vx += (dx / Math.sqrt(d2)) * f;
          n.vy += (dy / Math.sqrt(d2)) * f;
        }
        n.vx += (W / 2 - n.x) * 0.0016;
        n.vy += (H / 2 - n.y) * 0.0022;
      }
      for (const e of edges) {
        const a = byId[e.from], b = byId[e.to];
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const want = e.type === '_member' ? 90 : 150;
        const f = (d - want) * 0.004;
        a.vx += (dx / d) * f; a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
      }
      for (const n of nodes) {
        if (n === dragging) continue;
        n.vx *= 0.86; n.vy *= 0.86;
        n.x += n.vx; n.y += n.vy;
        n.x = Math.max(30, Math.min(W - 30, n.x));
        n.y = Math.max(26, Math.min(H - 26, n.y));
      }
      ctx.clearRect(0, 0, W, H);
      for (const e of edges) {
        const a = byId[e.from], b = byId[e.to];
        if (!a || !b) continue;
        const em = e.type !== '_member' && emphasize(e);
        ctx.strokeStyle = e.type === '_member' ? 'rgba(120,120,140,0.14)' : (window.EDGE_COLORS[e.type] || '#888');
        ctx.globalAlpha = e.type === '_member' ? 1 : em ? 0.85 : 0.18;
        ctx.lineWidth = em && e.type !== '_member' ? 1.6 : 1;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      for (const n of nodes) {
        const dim = nodeDim(n);
        const c = window.TYPE_COLORS[n.type] || '#999';
        ctx.globalAlpha = dim ? 0.22 : 1;
        if (n === selected || n === hover) {
          ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 5, 0, 7); ctx.strokeStyle = c; ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = dim ? 0.22 : 1;
        }
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 7);
        ctx.fillStyle = c; ctx.fill();
        if (n.type === 'theme' || n === hover || n === selected) {
          ctx.fillStyle = n.type === 'theme' ? '#e5e5e5' : '#c7c7d1';
          ctx.font = (n.type === 'theme' ? '700 11px ' : '10.5px ') + 'Inter, system-ui, sans-serif';
          const label = n.label.length > 38 ? n.label.slice(0, 36) + '…' : n.label;
          ctx.fillText(label, n.x + n.r + 5, n.y + 3.5);
        }
        ctx.globalAlpha = 1;
      }
      graphAnim = requestAnimationFrame(step);
    }
    step();
  }

  VIEWS.argument = () => {
    const routes = D.ideas.map((i) => {
      const es = D.edges.filter((e) => e.from === i.id || e.to === i.id);
      const types = {};
      es.forEach((e) => { types[e.type] = (types[e.type] || 0) + 1; });
      const neigh = es.map((e) => (e.from === i.id ? e.to : e.from));
      const avg = (IDEA_CONF[i.id] + neigh.reduce((s, n) => s + (IDEA_CONF[n] || 0.8), 0)) / (1 + neigh.length);
      return { i, conns: es.length, types, neigh, avg };
    }).sort((a, b) => b.conns - a.conns);
    return `
    <div class="view-head">
      <div>${title('layers', 'Argument map', 'Every idea ranked by its argumentative connections: supports, contradictions and refinements. Click a route to expand its connected ideas.')}</div>
    </div>
    <div class="toolbar" style="margin-bottom:16px">
      <div class="pills" style="margin:0"><button class="pill active">Automatic</button><button class="pill">AI</button></div>
      <span class="muted small">${routes.length} of ${routes.length} routes</span>
      <input class="search-input" style="flex:1;min-width:150px" placeholder="Search route…"/>
      <span class="muted small">Min. connections</span>
      <input class="select" style="width:52px;text-align:center" value="0"/>
    </div>
    ${routes.map((r, k) => `
      <div class="route-block" id="route-${r.i.id}">
        <div class="route-row" onclick="UI.argToggle('${r.i.id}')">
          <span class="route-num">${k + 1}</span>
          <div style="flex:1;min-width:0">
            <div class="list-title"><span class="list-dot" style="background:${window.TYPE_COLORS[r.i.type]}"></span><b>${esc(r.i.label)}</b>${IDEA_IN_DEBATE.has(r.i.id) ? '<span class="chip" style="color:var(--red);border-color:rgba(248,113,113,0.4)">1 debate</span>' : ''}</div>
            <div class="route-conn"><span><b style="color:var(--text-2)">${r.conns}</b> connection${r.conns !== 1 ? 's' : ''}</span><span>avg conf ${r.avg.toFixed(2)}</span>${Object.entries(r.types).map(([t, n]) => `<span>${t.replace(/_/g, ' ')} ×${n}</span>`).join('')}</div>
            <div class="route-neigh">↳ ${r.neigh.map((n) => esc(ideaById(n).label)).join(' · ')}</div>
          </div>
          <span class="route-chev">${ICONS.chevronRight}</span>
        </div>
        <div class="route-detail">
          <div class="nav-group-label" style="padding:14px 0 6px">Connected ideas (${r.conns})</div>
          ${D.edges.filter((e) => e.from === r.i.id || e.to === r.i.id).map((e) => {
            const other = e.from === r.i.id ? e.to : e.from;
            const dir = e.from === r.i.id ? '→' : '←';
            return `<div class="route-conn-row" onclick="event.stopPropagation();UI.idea('${other}')">${edgeChip(e.type)}<span class="muted">${dir}</span><span class="rc-idea">${typeChip(ideaById(other).type)} ${esc(ideaById(other).label)}</span><span class="rc-open muted small">Open ${ICONS.chevronRight}</span></div>`;
          }).join('')}
        </div>
      </div>`).join('')}`;
  };

  const ideaState = { filter: 'all', sort: 'name', q: '' };
  VIEWS.ideas = () => `
    <h1 class="view-title">${ICONS.bulb} Ideas <span class="muted" style="font-size:14px;font-weight:400">${D.ideas.length} ideas extracted</span></h1>
    <p class="view-sub">Typed claims, findings, constructs and frameworks — each with verbatim evidence, a confidence score and its connections. Click any idea.</p>
    <div class="toolbar">
      <input class="search-input" id="idea-q" style="flex:1;min-width:170px" placeholder="Search ideas…" autocomplete="off"/>
      <select class="select" id="idea-type">
        <option value="all">All types</option>
        ${Object.keys(window.TYPE_COLORS).filter((t) => t !== 'theme').map((t) => `<option value="${t}">${t}</option>`).join('')}
      </select>
      <select class="select" id="idea-sort">
        <option value="name">Sort: name</option>
        <option value="type">Sort: type</option>
        <option value="conn">Sort: connections</option>
      </select>
    </div>
    <div id="idea-list" style="margin-top:14px"></div>`;

  function renderIdeas() {
    const { filter, sort, q } = ideaState;
    const query = q.trim().toLowerCase();
    let list = D.ideas.filter((i) => (filter === 'all' || i.type === filter) && (i.label + ' ' + i.evidence).toLowerCase().includes(query));
    list = list.slice().sort((a, b) => sort === 'type' ? a.type.localeCompare(b.type) : sort === 'conn' ? IDEA_CONN(b.id) - IDEA_CONN(a.id) : a.label.localeCompare(b.label));
    $('#idea-list').innerHTML = list.map((i) => {
      const conns = IDEA_CONN(i.id);
      return `<div class="list-row fade-in" onclick="UI.idea('${i.id}')">
        <span class="list-dot" style="background:${window.TYPE_COLORS[i.type]}"></span>
        <div class="list-main">
          <div class="list-title"><b>${esc(i.label)}</b>${typeChip(i.type)}</div>
          <p class="list-desc">${esc(i.evidence)}</p>
          <div class="list-meta"><span>1 work(s)</span><span>${conns} connection(s)</span><span>conf ${IDEA_CONF[i.id].toFixed(2)}</span><span>${esc(themeById(i.theme).label)}</span></div>
        </div>
      </div>`;
    }).join('') || '<p class="muted small">No ideas match your filters.</p>';
  }

  VIEWS.authors = () => `
    ${title('graduation', 'Authors', 'Who backs each idea — author sheets and a synthesis matrix, reconciled against Zotero identities.')}
    <div class="grid cols-3">
      ${D.authors.map((a) => `<div class="card click" onclick="UI.author('${a.id}')">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#a78bfa);display:grid;place-items:center;font-weight:700;font-size:13px;flex-shrink:0">${a.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</div>
          <div><b>${esc(a.name)}</b><div class="muted small">${a.works.length} work${a.works.length > 1 ? 's' : ''} · ${a.ideas.length} ideas</div></div>
        </div>
        <p class="muted small" style="margin:10px 0 0">“${esc(a.stance)}”</p>
      </div>`).join('')}
    </div>
    <div class="card" style="margin-top:16px;padding:0;overflow-x:auto">
      <table class="tbl"><thead><tr><th>Claim</th><th>For</th><th>Against</th></tr></thead><tbody>
        <tr><td><b>Testing beats restudy</b></td><td>Roediger · Karpicke · Bjork</td><td class="muted">—</td></tr>
        <tr><td><b>Effect survives complex material</b></td><td>Karpicke · Blunt</td><td style="color:var(--red)">Van Gog · Sweller</td></tr>
        <tr><td><b>Spacing aids consolidation</b></td><td>Cepeda · Bjork</td><td class="muted">— (untested)</td></tr>
      </tbody></table>
    </div>`;

  VIEWS.study = () => `
    ${title('compass', 'Study', 'Guides, flashcards and Socratic routes generated from your own corpus — never from thin air. Click one to start.')}
    <div class="grid cols-3">
      ${D.studyGuide.map((s) => `<div class="card click" onclick="UI.study('${s.id}')">
        <span class="chip"><span class="dot" style="background:var(--cyan)"></span>${s.kind}</span>
        <h3 style="margin-top:9px">${esc(s.title)}</h3>
        <p class="muted small">${esc(s.desc)}</p>
        <span class="btn small">${ICONS.play} Start · ${s.count} items</span>
      </div>`).join('')}
    </div>`;

  // ---- immersion ----
  VIEWS.immersion = () => {
    if (state.immersion) return immersionSession(state.immersion);
    return `
    <div class="view-head">
      <div>${title('target', 'Immersion', 'Master a topic of your corpus: panorama, stations with verbatim quotes, contrasts, frontiers and a final exam. Everything is saved so you can resume.')}</div>
      <button class="btn primary" onclick="UI.newImmersion()">${ICONS.plus} New immersion</button>
    </div>
    <div class="pills">
      <input class="search-input" style="width:240px;padding:6px 12px;font-size:12.5px" placeholder="Search your immersions…"/>
      <select class="select"><option>Most recent</option><option>Oldest</option><option>By title (A–Z)</option></select>
    </div>
    <div class="gallery">
      ${D.immersions.map((im) => `<div class="tile" onclick="UI.openImmersion('${im.id}')">
        <img src="${im.art}" alt="${esc(im.title)}"/>
        <div class="meta">
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><b>${esc(im.title)}</b><span class="muted small" style="flex-shrink:0">${im.duration}</span></div>
          <p class="muted small" style="margin:4px 0 10px">${esc(im.topic)}</p>
          <div class="progress"><div style="width:${im.progress}%"></div></div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
            <span class="muted small">${im.progress > 0 ? im.progress + '% · in progress' : 'not started'}</span>
            <span class="play-inline">${ICONS.play} ${im.progress > 0 ? 'Continue' : 'Start'}</span>
          </div>
        </div>
      </div>`).join('')}
    </div>
    <p class="muted small" style="margin-top:14px">Narration is generated locally (Piper &amp; Kokoro run on your machine; Hume is bring-your-own-key). These two sample walks carry real audio.</p>`;
  };

  function immersionSession(id) {
    const im = D.immersions.find((x) => x.id === id);
    const stepIcon = { panorama: 'eye', station: 'book', contrasts: 'scale', frontiers: 'gap', exam: 'graduation' };
    const chosen = state.quiz[id];
    return `
    <button class="back-btn" onclick="UI.closeImmersion()">${ICONS.chevronLeft} Back to immersions</button>
    <div class="session-head">
      <img src="${im.art}" alt=""/>
      <div style="flex:1;min-width:260px">
        <h1 class="view-title" style="margin-bottom:2px">${esc(im.title)}</h1>
        <p class="view-sub" style="margin-bottom:10px">${esc(im.topic)}</p>
        <div class="tag-row">
          <button class="play-inline" onclick="UI.play('${im.audio}','${esc(im.title)}','${im.voice}')">${ICONS.play} Listen · ${im.voice}</button>
          <span class="chip">${im.duration}</span>
          <span class="chip">${im.progress}% complete</span>
        </div>
        <div class="scope-stats">
          ${Object.entries(im.scope).map(([k, v]) => `<div class="scope-stat"><b>${v}</b><span>${k}</span></div>`).join('')}
        </div>
      </div>
    </div>
    <div class="nav-group-label" style="padding-left:0;margin-top:20px">The walk</div>
    ${im.steps.map((s, k) => `
      <div class="step-item clickable${s.done ? ' done' : ''}" onclick="UI.station('${id}',${k})">
        <div class="st-ic">${s.done ? ICONS.check : ICONS[stepIcon[s.kind]]}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline">
            <b>${esc(s.title)}</b><span class="muted small">${s.minutes} min ${s.done ? '· done' : ''}</span>
          </div>
          <p class="muted small" style="margin:3px 0 0">${esc(s.body)}</p>
          ${s.quote ? `<div class="quote-block">${esc(s.quote)}<span class="src">${esc(s.source)}</span></div>` : ''}
          ${s.kind !== 'exam' ? `<button class="play-inline" style="margin-top:8px" onclick="event.stopPropagation();UI.play('${im.audio}','${esc(im.title)}: ${esc(s.title)}','${im.voice}')">${ICONS.play} ${s.done ? 'Replay' : 'Play'} step</button>` : ''}
        </div>
        <span class="step-chev">${ICONS.chevronRight}</span>
      </div>`).join('')}
    <div class="card" style="margin-top:18px;border-color:rgba(139,92,246,0.4)">
      <h3 style="display:flex;align-items:center;gap:8px">${ICONS.graduation} Final exam — sample question</h3>
      <p style="margin:8px 0 4px">${esc(im.quiz.q)}</p>
      ${im.quiz.options.map((o, k) => `<button class="quiz-opt${chosen != null ? (k === im.quiz.answer ? ' correct' : k === chosen ? ' wrong' : '') : ''}" onclick="UI.answer('${id}',${k})">${String.fromCharCode(65 + k)}. ${esc(o)}</button>`).join('')}
      ${chosen != null ? `<p class="small" style="margin:12px 0 0;color:${chosen === im.quiz.answer ? 'var(--green)' : 'var(--amber)'}">${chosen === im.quiz.answer ? 'Correct.' : 'Not quite.'} ${esc(im.quiz.explain)}</p>` : '<p class="muted small" style="margin:10px 0 0">Your answers are saved with the session, like in the app.</p>'}
    </div>`;
  }

  // Station reader — click a step to open it and navigate prev/next, like the app.
  const STATION_LABEL = { panorama: 'Panorama', station: 'Station', contrasts: 'Contrasts', frontiers: 'Frontiers', exam: 'Final exam' };
  function stationModal(imId, idx) {
    const im = D.immersions.find((x) => x.id === imId);
    const s = im.steps[idx];
    const chosen = state.quiz[imId];
    openModal(`
      ${modalHead(esc(s.title), `${STATION_LABEL[s.kind]} · step ${idx + 1} of ${im.steps.length} · ${s.minutes} min`)}
      <div class="station-body">
        <p>${esc(s.body)}</p>
        ${s.quote ? `<div class="quote-block">${esc(s.quote)}<span class="src">${esc(s.source)}</span></div>` : ''}
        ${s.kind === 'exam'
          ? `<div class="nav-group-label" style="padding-left:0">Sample question</div>
             <p style="margin:0 0 4px">${esc(im.quiz.q)}</p>
             ${im.quiz.options.map((o, k) => `<button class="quiz-opt${chosen != null ? (k === im.quiz.answer ? ' correct' : k === chosen ? ' wrong' : '') : ''}" onclick="UI.stationAnswer('${imId}',${idx},${k})">${String.fromCharCode(65 + k)}. ${esc(o)}</button>`).join('')}
             ${chosen != null ? `<p class="small" style="margin:12px 0 0;color:${chosen === im.quiz.answer ? 'var(--green)' : 'var(--amber)'}">${chosen === im.quiz.answer ? 'Correct.' : 'Not quite.'} ${esc(im.quiz.explain)}</p>` : ''}`
          : `<button class="play-inline" style="margin-top:6px" onclick="UI.play('${im.audio}','${esc(im.title)}: ${esc(s.title)}','${im.voice}')">${ICONS.play} Play narration · ${im.voice}</button>`}
      </div>
      <div class="page-nav" style="margin-top:18px">
        <button class="btn ghost small" ${idx === 0 ? 'disabled' : `onclick="UI.station('${imId}',${idx - 1})"`}>${ICONS.chevronLeft} Previous</button>
        <span class="muted small">Step ${idx + 1} of ${im.steps.length}</span>
        ${idx < im.steps.length - 1
          ? `<button class="btn primary small" onclick="UI.station('${imId}',${idx + 1})">Next ${ICONS.chevronRight}</button>`
          : `<button class="btn primary small" onclick="UI.close();UI.toast('Walk complete. In the app your progress and answers are saved to the session.')">Finish ${ICONS.check}</button>`}
      </div>`, true);
  }

  let gapTab = 'mined';
  const gapsContent = () => `
    <div class="pills">
      <button class="pill ${gapTab === 'mined' ? 'active' : ''}" onclick="UI.gapTab('mined')">Mined (${D.gaps.length})</button>
      <button class="pill ${gapTab === 'contra' ? 'active' : ''}" onclick="UI.gapTab('contra')">Contradictions (1)</button>
    </div>
    ${gapTab === 'mined' ? D.gaps.map(gapRow).join('') : contraRow()}`;
  VIEWS.gaps = () => `
    ${title('gap', 'Research gaps', 'Corpus aggregates: future work and limitations mined from the works, plus unreconciled contradictions. Click a gap for candidate sources.')}
    ${gapsContent()}`;

  function gapRow(g) {
    const [label, color] = GAP_KIND[g.id];
    const w = workById(ideaById(g.adjacent[0]).work);
    return `<div class="gap-card fade-in">
      <div class="gap-head">
        <p class="gap-text">${esc(g.question)}</p>
        <span class="gap-type" style="color:${color};border-color:${color}66;background:${color}18">${label}</span>
      </div>
      <div class="gap-actions">
        <button class="btn ghost small" onclick="window.go('graph')">${ICONS.layers} Graph</button>
        <button class="btn ghost small" onclick="UI.chat()">${ICONS.sparkle} Assistant</button>
        <button class="btn ghost small" onclick="UI.gap('${g.id}')">${ICONS.search} Find sources</button>
        <button class="btn ghost small" onclick="UI.toast('Saved to your notes. In the app this creates a linked note.')">${ICONS.note} Save to notes</button>
      </div>
      <p class="mentioned">Mentioned in 1 work(s): <span class="chip link" onclick="UI.work('${w.id}')">${esc(w.author)} ${w.year}</span></p>
    </div>`;
  }
  function contraRow() {
    const d = D.debates[0];
    return `<div class="gap-card fade-in">
      <div class="gap-head">
        <p class="gap-text">${esc(d.title)}</p>
        <span class="gap-type" style="color:#f87171;border-color:#f8717166;background:#f8717118">unresolved contradiction</span>
      </div>
      <div class="gap-actions">
        <button class="btn ghost small" onclick="window.go('debate')">${ICONS.scale} Open debate</button>
        <button class="btn ghost small" onclick="UI.chat()">${ICONS.sparkle} Assistant</button>
        <button class="btn ghost small" onclick="UI.gap('g1')">${ICONS.search} Find sources</button>
      </div>
      <p class="mentioned">Between: <span class="chip link" onclick="UI.idea('i1')">robust across materials</span> vs <span class="chip link" onclick="UI.idea('i6')">attenuates under load</span></p>
    </div>`;
  }

  const debateContent = () => {
    const d = D.debates[0];
    return `
    <div class="card"><h3 style="font-size:16px">${esc(d.title)}</h3>
      <span class="chip"><span class="dot" style="background:var(--amber)"></span>open dispute</span>
    </div>
    <div class="debate-grid" style="margin-top:14px">
      <div class="debate-col a"><b style="color:var(--green)">A · ${esc(d.positionA.label)}</b>
        <p class="small" style="margin:8px 0">${esc(d.positionA.summary)}</p>
        <div class="tag-row">${d.positionA.authors.map((a) => `<span class="chip">${a}</span>`).join('')}</div>
        ${d.positionA.evidence.map((e) => `<div class="arg-item plain" style="cursor:pointer;margin:8px 0 0" onclick="UI.idea('${e}')">${esc(ideaById(e).label)}</div>`).join('')}
      </div>
      <div class="debate-col b"><b style="color:var(--red)">B · ${esc(d.positionB.label)}</b>
        <p class="small" style="margin:8px 0">${esc(d.positionB.summary)}</p>
        <div class="tag-row">${d.positionB.authors.map((a) => `<span class="chip">${a}</span>`).join('')}</div>
        ${d.positionB.evidence.map((e) => `<div class="arg-item plain" style="cursor:pointer;margin:8px 0 0" onclick="UI.idea('${e}')">${esc(ideaById(e).label)}</div>`).join('')}
      </div>
    </div>
    <div class="card" style="margin-top:14px"><h3>Chronology</h3>
      <div class="timeline">${d.timeline.map((t) => `<div class="tl-item"><b>${t.year}</b> — <span class="muted">${esc(t.event)}</span></div>`).join('')}</div>
    </div>`;
  };
  VIEWS.debate = () => `
    ${title('scale', 'Debates', 'Each contradiction set head to head: positions, authors, evidence and the chronology of the dispute. Evidence is clickable.')}
    ${debateContent()}`;

  const coverageContent = () => `
    ${D.coverage.map((q) => `<div class="card click" onclick="UI.coverage('${q.id}')">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
        <h3>${esc(q.question)}</h3>
        <span class="chip" style="flex-shrink:0"><span class="dot" style="background:${q.status === 'covered' ? 'var(--green)' : q.status === 'partial' ? 'var(--amber)' : 'var(--red)'}"></span>${q.status}</span>
      </div>
      <p class="muted small" style="margin:6px 0 0">${esc(q.note)}</p>
    </div>`).join('')}
    <button class="btn" style="margin-top:14px" onclick="UI.toast('In the app: the assistant drafts a new coverage question from your latest gaps.')">${ICONS.plus} New coverage question</button>`;
  VIEWS.coverage = () => `
    ${title('help', 'Coverage', 'Research questions tracked against what the corpus can actually answer. Click one for its evidence.')}
    ${coverageContent()}`;

  VIEWS.research = () => {
    const panels = {
      coverage: coverageContent,
      debate: debateContent,
      gaps: gapsContent,
    };
    return `
      ${title('compass', 'State of the art', 'Coverage · Debates · Gaps')}
      <div class="workspace-tabs" role="tablist" aria-label="State of the art views">
        <button class="workspace-tab${state.researchTab === 'coverage' ? ' active' : ''}" role="tab" aria-selected="${state.researchTab === 'coverage'}" onclick="UI.researchTab('coverage')">${ICONS.help} Coverage</button>
        <button class="workspace-tab${state.researchTab === 'debate' ? ' active' : ''}" role="tab" aria-selected="${state.researchTab === 'debate'}" onclick="UI.researchTab('debate')">${ICONS.scale} Debates</button>
        <button class="workspace-tab${state.researchTab === 'gaps' ? ' active' : ''}" role="tab" aria-selected="${state.researchTab === 'gaps'}" onclick="UI.researchTab('gaps')">${ICONS.gap} Gaps</button>
      </div>
      <div class="research-workspace">${panels[state.researchTab]()}</div>`;
  };

  VIEWS.hypothesis = () => `
    ${title('flask', 'Hypotheses', 'The Hypothesis Lab turns tensions in the graph into testable statements. Click one for its test design.')}
    ${D.hypotheses.map((h) => `<div class="card click" onclick="UI.hypo('${h.id}')">
      <span class="chip"><span class="dot" style="background:var(--violet)"></span>proposed hypothesis</span>
      <h3 style="margin-top:8px">${esc(h.title)}</h3>
      <p style="margin:6px 0">${esc(h.statement)}</p>
      <p class="muted small" style="margin:8px 0 0"><b>Falsifiable:</b> ${esc(h.risk)}</p>
    </div>`).join('')}`;

  VIEWS.reading = () => `
    ${title('route', 'Reading path', 'A suggested order through the corpus — foundations first, objections when you can appreciate them. Click a stop.')}
    <div class="timeline" style="margin-left:8px">
      ${D.readingPath.map((r) => {
        const w = workById(r.work);
        return `<div class="tl-item" style="padding:10px 0;cursor:pointer" onclick="UI.work('${w.id}')">
          <b>${r.order}. ${esc(w.author)} (${w.year})</b> ${w.read ? '' : '<span class="chip" style="margin-left:6px"><span class="dot" style="background:var(--amber)"></span>unread</span>'}
          <div class="muted small">${esc(w.title)}</div>
          <div class="small" style="color:#a5b4fc;margin-top:2px">${esc(r.why)}</div>
        </div>`;
      }).join('')}
    </div>`;

  // ---- deep research ----
  VIEWS.deepResearch = () => {
    if (state.report) return reportReader(state.report);
    return `
    <div class="view-head">
      <div>${title('network', 'Deep Research', 'Your library of academic reports, generated in a queue and citing the whole corpus. Click one to read it full-screen.')}</div>
      <button class="btn primary" onclick="UI.newReport()">${ICONS.plus} New report</button>
    </div>
    <div class="pills">
      <input class="search-input" style="width:240px;padding:6px 12px;font-size:12.5px" placeholder="Search your reports…"/>
      <select class="select"><option>Most recent</option><option>Oldest</option><option>By title (A–Z)</option></select>
    </div>
    <div class="gallery">
      ${D.deepResearch.map((r) => `<div class="tile" onclick="UI.openReport('${r.id}')">
        <img src="${r.cover}" alt=""/>
        <div class="meta">
          <b>${esc(r.title)}</b>
          <p class="muted small" style="margin:4px 0 10px">${esc(r.meta)}</p>
          <div class="tag-row">
            <span class="btn small">${ICONS.book} Read</span>
            <span class="btn ghost small" onclick="event.stopPropagation();UI.newReport()">${ICONS.sync} Reuse idea</span>
            <span class="play-inline" onclick="event.stopPropagation();UI.play('${r.audio}','${esc(r.title)}','${esc(r.audioLabel)}')">${ICONS.play} Listen</span>
          </div>
        </div>
      </div>`).join('')}
    </div>`;
  };

  function reportReader(id) {
    const r = D.deepResearch.find((x) => x.id === id);
    const pg = r.pages[Math.min(state.reportPage, r.pages.length - 1)];
    const idx = Math.min(state.reportPage, r.pages.length - 1);
    return `
    <div class="report">
      <button class="back-btn" onclick="UI.closeReport()">${ICONS.chevronLeft} Back to the gallery</button>
      <img class="cover" src="${r.cover}" alt=""/>
      <div class="report-title">
        <h2>${esc(r.title)}</h2>
        <p class="muted small">${esc(r.meta)}</p>
      </div>
      <div class="reader-toolbar">
        <button class="play-inline" onclick="UI.play('${r.audio}','${esc(r.title)}','${esc(r.audioLabel)}')">${ICONS.play} Listen</button>
        <button class="btn" onclick="UI.matrixM('${r.id}')">${ICONS.grid} Support matrix</button>
        <button class="btn" onclick="UI.toast('In the app: an AI pass rewrites the report in the target language, preserving every citation link.')">${ICONS.languages} Translate</button>
        <button class="btn" onclick="UI.toast('In the app: exports to Word or PDF with the bibliography resolved from Zotero.')">${ICONS.download} Export</button>
      </div>
      <div class="page-tabs">
        ${r.pages.map((p, k) => `<button class="pill${k === idx ? ' active' : ''}" onclick="UI.reportPage(${k})">Page ${k + 1}</button>`).join('')}
      </div>
      <article class="report-body">
        <h2>${esc(pg.title)}</h2>
        ${pg.paras.map((p) => `<p>${esc(p.text)}</p>${p.cites.length ? `<div class="cite-row">${p.cites.map((c) => `<span class="cite" onclick="UI.idea('${c[1]}')" title="Open the cited idea">${esc(c[0])}</span>`).join('')}</div>` : ''}`).join('')}
      </article>
      <div class="page-nav">
        <button class="btn ghost small" ${idx === 0 ? 'disabled' : `onclick="UI.reportPage(${idx - 1})"`}>${ICONS.chevronLeft} Previous</button>
        <span class="muted small">Page ${idx + 1} of ${r.pages.length}</span>
        <button class="btn ghost small" ${idx === r.pages.length - 1 ? 'disabled' : `onclick="UI.reportPage(${idx + 1})"`}>Next ${ICONS.chevronRight}</button>
      </div>
      <div class="card" style="margin-top:20px"><h3>How this was made</h3>
        <p class="muted small" style="margin:4px 0 0">Deep Research plans the outline, pulls only ideas that exist in the graph, writes page by page, and refuses to cite anything it cannot resolve to a Zotero item. Citation chips are clickable — try one.</p>
      </div>
    </div>`;
  }

  // ---- writing ----
  VIEWS.writing = () => {
    const active = D.writing.drafts.find((d) => d.id === state.draft) || D.writing.drafts[0];
    return `
    ${title('edit', 'Writing', 'The academic workshop: drafts grounded in the graph, with verifiable citations. Try “Compose cited sentence”.')}
    <div class="write-grid">
      <div>
        <div class="nav-group-label" style="padding-left:0">Drafts</div>
        ${D.writing.drafts.map((d) => `<div class="draft-item${d.id === state.draft ? ' active' : ''}" onclick="UI.draft('${d.id}')">
          <b>${esc(d.title)}</b>
          <div class="muted" style="font-size:11px;margin-top:2px">${d.words} words · ${d.citations} cit. · ${d.status === 'verified' ? '<span style="color:var(--green)">verified</span>' : 'draft'} · ${d.updated}</div>
        </div>`).join('')}
        <button class="btn ghost small" style="margin-top:8px" onclick="UI.toast('In the app: builds a corpus snapshot, lets you pick the selection, and drafts a new section.')">${ICONS.plus} New draft</button>
      </div>
      <div>
        <div class="card" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <b>${esc(active.title)}</b>
          <span class="chip"><span class="dot" style="background:var(--green)"></span>${esc(D.writing.active.status)}</span>
        </div>
        <div class="editor" id="editor" contenteditable="true" spellcheck="false">${D.writing.active.text
          .replace(/\(([^)]+, \d{4})\)/g, '(<span class="cited">$1</span>)')}</div>
      </div>
      <div>
        <div class="card"><h3 style="display:flex;align-items:center;gap:8px">${ICONS.sparkle} Copilot</h3>
          <p class="muted small">Ideas your paragraph relates to:</p>
          <div class="arg-item support small" onclick="UI.idea('i1')">supports · Testing effect strengthens retention</div>
          <div class="arg-item objection small" onclick="UI.idea('i6')">contradicts · Effect fades with complexity</div>
          <button class="btn small" id="compose-btn" onclick="UI.compose()">${ICONS.edit} Compose cited sentence</button>
        </div>
        <div class="card" style="margin-top:12px"><h3 style="display:flex;align-items:center;gap:8px">${ICONS.word} Word add-in</h3>
          <p class="muted small" style="margin:4px 0 0">The same copilot runs inside Microsoft Word as a task pane, matching each paragraph you type against the graph in real time.</p>
        </div>
      </div>
    </div>`;
  };

  VIEWS.projects = () => `
    ${title('folder', 'Projects', 'Group works, drafts and routes around a deliverable. Click a project.')}
    <div class="grid cols-2">
      ${D.projects.map((p) => `<div class="card click" onclick="UI.project('${p.id}')">
        <h3>${esc(p.name)}</h3>
        <p class="muted small" style="margin:4px 0 8px">${esc(p.goal)}</p>
        <div class="tag-row"><span class="chip">${p.works.length} works</span><span class="chip">${p.drafts.length} drafts</span><span class="chip">${p.notes.length} notes</span></div>
        <p class="muted small" style="margin:8px 0 0">${p.updated}</p>
      </div>`).join('')}
    </div>`;

  // ---- unified workspace (notes + ideas + collections, as in the desktop app) ----
  function renderNoteBody(body) {
    return esc(body).replace(/\[(idea|debate|gap): ([^\]]+)\]/g, (m, kind, label) => {
      if (kind === 'idea') {
        const idea = D.ideas.find((i) => i.label === label);
        if (idea) return `<span class="note-link" onclick="UI.idea('${idea.id}')">${ICONS.bulb} ${esc(label)}</span>`;
      }
      if (kind === 'debate') return `<span class="note-link" onclick="window.go('debate')">${ICONS.scale} ${esc(label)}</span>`;
      if (kind === 'gap') {
        const g = D.gaps.find((x) => x.title === label);
        if (g) return `<span class="note-link" onclick="UI.gap('${g.id}')">${ICONS.gap} ${esc(label)}</span>`;
      }
      return m;
    });
  }
  VIEWS.workspace = () => {
    let sel = null;
    D.notes.forEach((f) => f.notes.forEach((n) => { if (n.id === state.note) sel = n; }));
    if (!sel) sel = D.notes[0].notes[0];
    return `
    <div class="view-head workspace-heading">
      <div>${title('notebook', 'Workspace', `${D.notes.reduce((sum, folder) => sum + folder.notes.length, 0)} notes and ideas · ${D.notes.length} collections`)}</div>
      <div class="tag-row">
        <button class="btn ghost" onclick="UI.toast('In the app: creates an idea linked to the graph.')">${ICONS.bulb} Idea</button>
        <button class="btn primary" onclick="UI.toast('In the app: creates a source-linked note in the selected collection.')">${ICONS.note} Note</button>
      </div>
    </div>
    <div class="notes-grid">
      <div class="card" style="padding:10px">
        <div class="nav-group-label" style="padding:8px 12px 4px">Collections</div>
        <div class="note-item active">${ICONS.layers} All <span class="muted" style="margin-left:auto">${D.notes.reduce((sum, folder) => sum + folder.notes.length, 0)}</span></div>
        ${D.notes.map((f) => `
          <div class="nav-group-label" style="padding:8px 12px 2px;display:flex;gap:7px;align-items:center">${ICONS.folder} ${esc(f.folder)}</div>
          ${f.notes.map((n) => `<div class="note-item${n.id === state.note ? ' active' : ''}" onclick="UI.note('${n.id}')">${ICONS.note} ${esc(n.title)}</div>`).join('')}`).join('')}
        <button class="btn ghost small" style="margin:10px 8px 4px" onclick="UI.toast('In the app: creates a note or folder; folders can carry an AI summary of their contents.')">${ICONS.plus} New note</button>
      </div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap">
          <h3 style="font-size:16px">${esc(sel.title)}</h3><span class="muted small">edited ${sel.updated}</span>
        </div>
        <div class="note-body" contenteditable="true" spellcheck="false">${renderNoteBody(sel.body)}</div>
      </div>
    </div>`;
  };
  VIEWS.notes = VIEWS.workspace;

  VIEWS.browser = () => `
    ${title('globe', 'Nodus Browser', 'Research the web without leaving Nodus and keep the current vault close at hand.')}
    <div class="browser-toolbar">
      <button class="btn ghost" aria-label="Back">${ICONS.chevronLeft}</button>
      <button class="btn ghost" aria-label="Reload">${ICONS.sync}</button>
      <div class="browser-address">${ICONS.globe}<span>Search the web or enter an address…</span></div>
      <button class="btn primary" onclick="UI.toast('In the app: saves the current academic page to your Zotero-connected library.')">${ICONS.plus} Capture source</button>
    </div>
    <div class="browser-empty card">
      ${ICONS.globe}
      <h3>Browse with your research workspace beside you</h3>
      <p class="muted">Open sources, capture bibliographic metadata and return to the graph without changing applications.</p>
    </div>`;

  VIEWS.toolkit = () => `
    ${title('tools', 'Nodus Toolkit', 'Focused utilities for documents, privacy, translation and presentation.')}
    <div class="grid cols-3 toolkit-grid">
      ${[
        ['grid', 'Nodus Apps', 'Create small tools for research, study or teaching.'],
        ['sync', 'Nodus Convert', 'Convert documents, PDFs and images locally.'],
        ['shield', 'Nodus Protect', 'Redact data, watermark files and verify copies.'],
        ['languages', 'Nodus Translate', 'Translate text and documents while preserving structure.'],
        ['play', 'Nodus Presenter', 'Present a PDF with clean controls and notes.'],
        ['search', 'OCR Workspace', 'Recover searchable text from scanned documents.'],
      ].map(([icon, name, description]) => `<button class="card click toolkit-card" onclick="UI.toast('${name} opens as a focused tool in the desktop app.')"><span class="toolkit-icon">${ICONS[icon]}</span><h3>${name}</h3><p class="muted small">${description}</p></button>`).join('')}
    </div>`;

  // ---- settings ----
  const SET_TABS = [
    ['providers', 'Providers', 'key'], ['models', 'AI models', 'wand'], ['library', 'Library', 'book'],
    ['extraction', 'Text & OCR', 'search'], ['interface', 'Interface', 'palette'], ['integrations', 'Integrations', 'link'],
    ['system', 'System', 'settings'], ['data', 'Data', 'download'],
  ];
  const sw = (key) => `<button class="switch${state.toggles[key] ? ' on' : ''}" onclick="UI.sw('${key}',this)" role="switch" aria-checked="${!!state.toggles[key]}"></button>`;
  const SET_PANELS = {
    providers: () => `
      <div class="card"><h3>${ICONS.key} AI providers</h3>
        <p class="muted small" style="margin:2px 0 10px">Bring your own key, or run fully offline with a local model. Keys are stored encrypted in your system keychain.</p>
        ${D.settings.providers.map((p) => { const local = p.desc.includes('offline'); return `<div class="set-row">
          <div class="set-prov">
            <span class="prov-badge" style="background:${local ? 'rgba(52,211,153,0.15)' : 'rgba(99,102,241,0.16)'};color:${local ? 'var(--green)' : '#a5b4fc'}">${p.name[0]}</span>
            <div class="lbl"><b>${p.name}</b><span>${p.desc}${p.key ? ` · <span class="keymask">${p.key}</span>` : ''}</span></div>
          </div>
          ${p.on ? `<span class="chip"><span class="dot" style="background:var(--green)"></span>configured</span>` : `<button class="btn ghost small" onclick="UI.toast('In the app: paste your API key (or base URL for local providers); it is validated and stored in the keychain.')">Configure</button>`}
        </div>`; }).join('')}
      </div>`,
    models: () => `
      <div class="card"><h3>${ICONS.wand} Model per task</h3>
        <p class="muted small" style="margin:2px 0 8px">Each pipeline step can use a different model, mixing cloud and local freely. Prompts auto-size to each model's real context window.</p>
        ${D.settings.models.map(([task, model]) => `<div class="set-row"><div class="lbl"><b>${task}</b></div><select class="select" onchange="UI.toast('Model preference saved (demo).')"><option>${model}</option><option>claude-sonnet-5</option><option>qwen3:8b · Ollama</option><option>gpt-5.2</option><option>gemini-3-flash</option></select></div>`).join('')}
      </div>`,
    library: () => `
      <div class="card"><h3>${ICONS.book} Zotero sync</h3>
        <div class="set-row"><div class="lbl"><b>Monitored collections</b><span>PhD corpus · Methods reading</span></div><button class="btn ghost small" onclick="UI.toast('In the app: a tree of your Zotero collections with per-collection monitoring.')">Choose</button></div>
        <div class="set-row"><div class="lbl"><b>Auto-analyze new works</b><span>Off by default: sync only brings metadata until you opt in.</span></div>${sw('autoAnalyze')}</div>
        <div class="set-row"><div class="lbl"><b>Read tag</b><span>Mark works as read via a Zotero tag ("leído").</span></div>${sw('readTag')}</div>
      </div>`,
    extraction: () => `
      <div class="card"><h3>${ICONS.search} Text & OCR</h3>
        <div class="set-row"><div class="lbl"><b>Read attached files directly</b><span>PDF, EPUB and DOCX are parsed locally — no Zotero full-text index needed.</span></div><span class="chip"><span class="dot" style="background:var(--green)"></span>always on</span></div>
        <div class="set-row"><div class="lbl"><b>OCR for scanned PDFs</b><span>Tesseract, local. Languages: English, Spanish.</span></div>${sw('ocr')}</div>
        <div class="set-row"><div class="lbl"><b>Degraded-scan recovery</b><span>Auto-retry works that only yielded an abstract.</span></div><span class="chip"><span class="dot" style="background:var(--green)"></span>automatic</span></div>
      </div>`,
    interface: () => `
      <div class="card"><h3>${ICONS.palette} Interface</h3>
        <div class="set-row"><div class="lbl"><b>Language</b><span>UI in English or Spanish.</span></div><select class="select"><option>English</option><option>Español</option></select></div>
        <div class="set-row"><div class="lbl"><b>Theme</b></div><select class="select" onchange="UI.toast('The desktop app switches instantly between dark and light.')"><option>Dark</option><option>Light</option></select></div>
        <div class="set-row"><div class="lbl"><b>Animations</b></div>${sw('animations')}</div>
        <div class="set-row"><div class="lbl"><b>Sidebar sections</b><span>Reorder or hide sections. Home stays first, Settings last.</span></div><button class="btn ghost small" onclick="UI.toast('In the app: drag to reorder sections within their group, or hide the ones you never use.')">Customize</button></div>
      </div>`,
    integrations: () => `
      <div class="card"><h3>${ICONS.link} MCP server</h3>
        <p class="muted small" style="margin:2px 0 8px">Query your graph from Claude or any MCP client — locally.</p>
        <div class="set-row"><div class="lbl"><b>Enable MCP server</b><span>stdio · read tools + writing tools</span></div>${sw('mcp')}</div>
        <div class="set-row"><div class="lbl"><b>Connection</b></div><span class="keymask">npx nodus-mcp --vault "Learning science"</span></div>
      </div>
      <div class="card"><h3>Word writing copilot <span class="chip" style="margin-left:6px">beta</span></h3>
        <p class="muted small" style="margin:2px 0 8px">A task pane inside Microsoft Word that matches each paragraph you type against the graph, live.</p>
        <div class="set-row"><div class="lbl"><b>Local HTTPS bridge</b><span>Port 4320 · own CA, auto-renewing certificate</span></div>${sw('word')}</div>
        <div class="set-row"><div class="lbl"><b>Install add-in</b></div><button class="btn ghost small" onclick="UI.toast('In the app: one click drops the manifest into Word and opens the pane.')">${ICONS.word} Install in Word</button></div>
      </div>`,
    system: () => `
      <div class="card"><h3>${ICONS.settings} System</h3>
        <div class="set-row"><div class="lbl"><b>Release</b><span>Nodus — up to date</span></div><button class="btn ghost small" onclick="UI.toast('Checking… you are on the latest release (demo).')">${ICONS.sync} Check for updates</button></div>
        <div class="set-row"><div class="lbl"><b>Pre-release channel</b></div>${sw('prerelease')}</div>
        <div class="set-row"><div class="lbl"><b>Guided tour</b><span>Replay the onboarding walkthrough.</span></div><button class="btn ghost small" onclick="UI.toast('In the app: replays the interactive tour across every section.')">Replay tour</button></div>
      </div>`,
    data: () => `
      <div class="card"><h3 style="display:flex;align-items:center;gap:8px">${ICONS.shield} Backups</h3>
        <p class="muted small" style="margin:2px 0 8px">Automatic encrypted backups with grandfather-father-son rotation. Master password lives in your system keychain.</p>
        <div class="set-row"><div class="lbl"><b>Automatic backups</b><span>Daily · keep 7 daily / 4 weekly / 6 monthly</span></div>${sw('autoBackup')}</div>
        <div class="set-row"><div class="lbl"><b>Last backup</b><span>Today 09:12 · 4.2 MB · encrypted</span></div><button class="btn ghost small" onclick="UI.toast('In the app: creates an encrypted backup right now.')">Back up now</button></div>
        <div class="set-row"><div class="lbl"><b>Sync package</b><span>Export a merge-ready .nodussync to move between machines.</span></div><button class="btn ghost small" onclick="UI.toast('In the app: exports a package that merges losslessly into another vault.')">Export</button></div>
        <div class="set-row"><div class="lbl"><b>Audit ledger</b><span>Tamper-evident log of every change to the vault.</span></div><button class="btn ghost small" onclick="UI.toast('In the app: opens the full audit trail.')">View ledger</button></div>
      </div>
      <div class="card danger-zone"><h3 style="color:var(--red)">Danger zone</h3>
        <div class="set-row"><div class="lbl"><b>Reset the graph</b><span>Ideas and relations are rebuilt on the next analysis. Works stay.</span></div><button class="btn ghost small danger" onclick="UI.toast('Relax — nothing is deleted in the demo. In the app this asks twice and makes a backup first.')">${ICONS.trash} Reset</button></div>
      </div>`,
  };
  VIEWS.settings = () => `
    ${title('settings', 'Settings', 'Providers, models, Zotero, integrations, backups — everything local-first.')}
    <div class="settings-grid">
      <div class="set-tabs">
        ${SET_TABS.map(([id, label, ic]) => `<button class="set-tab${state.settingsTab === id ? ' active' : ''}" onclick="UI.setTab('${id}')">${ICONS[ic]} ${label}</button>`).join('')}
      </div>
      <div id="set-panel">${SET_PANELS[state.settingsTab]()}</div>
    </div>`;

  // ---------- router ----------
  window.go = function (view) {
    if (view === 'coverage' || view === 'debate' || view === 'gaps') {
      state.researchTab = view === 'coverage' ? 'coverage' : view;
      view = 'research';
    }
    if (view === 'notes') view = 'workspace';
    cancelAnimationFrame(graphAnim);
    state.view = view;
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    const el = main();
    el.innerHTML = `<div class="fade-in">${VIEWS[view]()}</div>`;
    el.scrollTop = 0;
    if (view === 'graph') {
      state.graphPreset = 'Overview';
      initGraph(state.graphPreset);
      $('#graph-presets').addEventListener('click', (e) => {
        const b = e.target.closest('.pill');
        if (!b) return;
        document.querySelectorAll('#graph-presets .pill').forEach((p) => p.classList.remove('active'));
        b.classList.add('active');
        state.graphPreset = b.dataset.p;
        initGraph(state.graphPreset);
      });
    }
    if (view === 'ideas') {
      renderIdeas();
      const q = $('#idea-q'), ty = $('#idea-type'), so = $('#idea-sort');
      q.value = ideaState.q; ty.value = ideaState.filter; so.value = ideaState.sort;
      q.addEventListener('input', () => { ideaState.q = q.value; renderIdeas(); });
      ty.addEventListener('change', () => { ideaState.filter = ty.value; renderIdeas(); });
      so.addEventListener('change', () => { ideaState.sort = so.value; renderIdeas(); });
    }
    if (view === 'search') {
      runSearch('');
      const box = $('#search-box');
      box.addEventListener('input', () => runSearch(box.value));
      box.focus();
    }
    try { history.replaceState(null, '', '#' + view); } catch (e) { /* file:// */ }
  };

  // ---------- public UI actions ----------
  window.UI = {
    toast, close: closeModal,
    idea: ideaModal, work: workModal, author: authorModal, gap: gapModal,
    coverage: coverageModal, hypo: hypoModal, project: projectModal,
    study: studyModal, matrixM: matrixModal,
    flip() { study.flipped = !study.flipped; renderFlash(); },
    nextCard() {
      study.card += 1; study.flipped = false;
      if (study.card >= study.deck.cards.length) { closeModal(); toast('Deck complete. In the app, results feed the spaced-repetition schedule.'); return; }
      renderFlash();
    },
    socReveal() { study.sOpen = true; renderSocratic(); },
    socNext() {
      study.sIdx += 1; study.sOpen = false;
      if (study.sIdx >= study.deck.route.length) { closeModal(); toast('Route finished — in the app your answers are saved with the guide.'); return; }
      renderSocratic();
    },
    newImmersion: immersionComposer,
    scope: scopeScreen,
    newReport: reportComposer,
    openImmersion(id) { state.immersion = id; window.go('immersion'); },
    closeImmersion() { state.immersion = null; window.go('immersion'); },
    answer(id, k) { state.quiz[id] = k; window.go('immersion'); },
    openReport(id) { state.report = id; state.reportPage = 0; window.go('deepResearch'); },
    closeReport() { state.report = null; window.go('deepResearch'); },
    reportPage(k) { state.reportPage = k; window.go('deepResearch'); },
    draft(id) { state.draft = id; window.go('writing'); },
    note(id) { state.note = id; window.go('workspace'); },
    setTab(id) { state.settingsTab = id; window.go('settings'); },
    researchTab(id) { state.researchTab = id; window.go('research'); },
    sw(key, el) { state.toggles[key] = !state.toggles[key]; el.classList.toggle('on', state.toggles[key]); el.setAttribute('aria-checked', String(state.toggles[key])); },
    play: playTrack,
    chat() { chat.open = true; chat.view = 'chat'; renderChat(); },
    chatClose() { chat.open = false; renderChat(); },
    chatBack() { chat.view = 'chat'; renderChat(); },
    chatArchView() { chat.view = 'archive'; renderChat(); },
    gapTab(t) { gapTab = t; window.go('gaps'); },
    argToggle(id) { const el = document.getElementById('route-' + id); if (el) el.classList.toggle('open'); },
    station(imId, idx) { stationModal(imId, idx); },
    stationAnswer(imId, idx, k) { state.quiz[imId] = k; stationModal(imId, idx); },
    chatNew() {
      const cur = curConvo();
      chat.view = 'chat';
      if (cur && cur.messages.length === 0) { renderChat(); return; }
      const id = 'c' + chat.seq++;
      chat.convos.push({ id, archived: false, title: 'New conversation', messages: [] });
      chat.current = id;
      renderChat();
    },
    chatArchive() {
      const cur = curConvo();
      if (!cur || !cur.messages.length) return;
      cur.archived = true;
      const id = 'c' + chat.seq++;
      chat.convos.push({ id, archived: false, title: 'New conversation', messages: [] });
      chat.current = id;
      renderChat();
      toast('Conversation archived — find it under “Archived”.');
    },
    chatOpen(id) {
      const c = chat.convos.find((x) => x.id === id);
      if (!c) return;
      c.archived = false;
      chat.current = id;
      chat.view = 'chat';
      renderChat();
      toast('Conversation restored from the archive.');
    },
    chatSend() {
      if (chat.waiting) return;
      const inp = $('#chat-inp');
      const v = inp && inp.value.trim();
      if (!v) return;
      const convo = curConvo();
      if (convo.title === 'New conversation') convo.title = v.slice(0, 42) + (v.length > 42 ? '…' : '');
      const userMsg = { who: 'user', text: v };
      convo.messages.push(userMsg);
      inp.value = '';
      const hint = $('#chat-msgs .msg.hint'); if (hint) hint.remove();
      appendMsg(userMsg);              // insert only the new bubble — no full re-render
      chat.waiting = true;
      showTyping();
      setTimeout(() => {
        hideTyping();
        const r = CANNED[chat.replyIdx++ % CANNED.length];
        const aiMsg = { who: 'ai', text: r.text, chips: r.chips };
        convo.messages.push(aiMsg);
        appendMsg(aiMsg);
        chat.waiting = false;
        const i = $('#chat-inp'); if (i) i.focus();
      }, 950);
    },
    compose() {
      const ed = $('#editor');
      if (!ed) return;
      const html = esc(D.writing.insertion).replace(/\(([^)]+, \d{4}, p\. \d+)\)/g, '(<span class="cited">$1</span>)');
      ed.insertAdjacentHTML('beforeend', `<span class="fresh">${html}</span>`);
      ed.scrollTop = ed.scrollHeight;
      toast('Sentence composed from the graph and inserted — with a citation that resolves to a Zotero item.');
    },
  };

  // ---------- boot ----------
  const nav = $('#nav');
  nav.innerHTML = NAV.map((n) =>
    n.group !== undefined
      ? `<div class="nav-group-label">${n.group}</div>`
      : `<button class="nav-item" data-view="${n.id}">${ICONS[n.icon]}<span>${n.label}</span></button>`
  ).join('');
  nav.addEventListener('click', (e) => {
    const b = e.target.closest('.nav-item');
    if (b) { state.immersion = null; state.report = null; window.go(b.dataset.view); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('#modal-root').innerHTML) closeModal();
    else if (chat.open) UI.chatClose();
  });

  initBottomPlayer();
  const initial = (location.hash || '#home').slice(1);
  window.go(VIEWS[initial] ? initial : 'home');
  window.addEventListener('hashchange', () => {
    const v = location.hash.slice(1);
    if (VIEWS[v] && v !== state.view) { state.immersion = null; state.report = null; window.go(v); }
  });
  let graphViewportWidth = window.innerWidth;
  let graphResizeTimer = 0;
  window.addEventListener('resize', () => {
    if (state.view !== 'graph' || Math.abs(window.innerWidth - graphViewportWidth) < 20) return;
    graphViewportWidth = window.innerWidth;
    clearTimeout(graphResizeTimer);
    graphResizeTimer = setTimeout(() => initGraph(state.graphPreset), 120);
  });
})();
