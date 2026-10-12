const content = await fetch('./content.json?v=20260814b').then((response) => {
  if (!response.ok) throw new Error(`Documentation could not be loaded (${response.status}).`);
  return response.json();
});

const videos = await fetch('../tutorials.json')
  .then((response) => (response.ok ? response.json() : null))
  .then((data) => (Array.isArray(data?.videos) ? data.videos : []))
  .catch(() => []);

const $ = (selector, root = document) => root.querySelector(selector);
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));
const imagePath = (image) => `./assets/${image}`;
// At this width the complete chapter index already lives in the right rail.
// Below it that rail disappears, so the left-side accordion remains available.
const usesRightHandToc = matchMedia('(min-width: 1181px)');
const vaultIconPaths = {
  network: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/>',
  tree: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5V12"/><path d="M12 12H5v4.5"/><path d="M12 12h7v4.5"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  graduation: '<path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1 2.5 2.5 6 2.5s6-1.5 6-2.5v-5"/>',
  presentation: '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21l4-5 4 5"/><path d="M12 16v5"/><path d="M7 8h4"/><path d="M7 12h7"/>',
  microphone: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8"/>',
  users: '<circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="7" r="2.5"/><circle cx="12" cy="17" r="2.5"/><path d="m9 8.5 2 6M15 8.5l-2 6M9.5 7h5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9S14.4 18.5 12 21c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3Z"/>',
};

// These vaults ship in the application but do not have Wiki manuals yet. They
// belong on the home overview so the documentation never implies that Nodus is
// limited to the five currently documented workflows.
const vaultsAwaitingGuides = [
  { id: 'primary-sources', name: 'Primary Sources', accent: '#6366f1', icon: 'archive', tagline: 'Work critically with archival documents and manuscripts, keeping transcription, provenance and inference distinct.' },
  { id: 'testimony', name: 'Testimony', accent: '#0891b2', icon: 'microphone', tagline: 'Document and analyse interviews and oral history with local transcription, consent and access controls.' },
  { id: 'prosopography', name: 'Prosopography', accent: '#2563eb', icon: 'users', tagline: 'Study groups and collective trajectories while preserving name variants, uncertainty and source evidence.' },
  { id: 'worldbuilding', name: 'Worldbuilding', accent: '#7c3aed', icon: 'globe', tagline: 'Build connected worlds, characters, places and narratives while keeping canon and continuity visible.' },
];
const allVaults = [...content.vaults, ...vaultsAwaitingGuides];

function iconMarkup(icon = 'nodus') {
  const paths = vaultIconPaths[icon];
  if (!paths) return '<img class="nodus-mark" src="../assets/nodus-logo.svg" alt=""/>';
  return `<svg class="vault-icon-svg" data-icon="${icon}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function downloadIconMarkup() {
  return '<svg class="download-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';
}

const VIDEO_TITLES = {
  essentials: ['Introduction', 'Nodus | Introduction and first steps'],
  academic: ['Vault manuals', 'Academic research vault'],
  genealogy: ['Vault manuals', 'Genealogy vault'],
  databases: ['Vault manuals', 'Databases vault'],
  teaching: ['Vault manuals', 'Teaching vault'],
  nodi: ['Features', 'Meet Nodi, the companion'],
  toolkit: ['Features', 'Nodus Toolkit'],
  'pdf-presenter': ['Features', 'Nodus Presenter'],
  word: ['Integrations', 'Word and LibreOffice copilot'],
  zotero: ['Integrations', 'Zotero integration'],
  mcp: ['Integrations', 'MCP and Nodus Server'],
};

const publishedVideos = videos
  .filter((video) => VIDEO_TITLES[video.id] && /^[\w-]{11}$/.test(video.youtubeId))
  .sort((a, b) => (a.order || 0) - (b.order || 0));

const allPages = [
  { type: 'home', id: 'home', title: 'Nodus Wiki', summary: 'An overview of all nine Nodus vaults, with complete guides for five.', accent: '#8b5cf6', icon: 'nodus' },
  { type: 'videos', id: 'videos', title: 'Video tutorials', summary: 'Watch every vault, feature and integration explained on screen.', group: 'Video tutorials', accent: '#f87171', icon: 'nodus' },
  ...content.common.map((chapter) => ({ ...chapter, type: 'common', accent: '#8b5cf6', icon: 'nodus' })),
  ...content.vaults.flatMap((vault) => [
    { ...vault, type: 'vault', title: vault.name, summary: vault.tagline, accent: vault.accent },
    ...vault.chapters.map((chapter) => ({ ...chapter, type: 'chapter', vault, accent: vault.accent, icon: vault.icon })),
  ]),
];

function buildNavigation() {
  // One flat list for the core guide: its three sub-headings only added depth to
  // a rail that already nests five vaults inside it.
  const common = content.common.map((chapter) => navLink(chapter.id, chapter.title, '#8b5cf6')).join('');
  const vaults = content.vaults.map((vault) => `<details class="nav-vault" data-vault="${vault.id}"><summary style="--vault-accent:${vault.accent}"><span class="vault-mark">${iconMarkup(vault.icon)}</span>${escapeHtml(vault.name)}</summary>${navLink(vault.id, 'Overview', vault.accent)}${vault.chapters.map((chapter) => navLink(chapter.id, chapter.title, vault.accent)).join('')}</details>`).join('');
  $('#wiki-nav').innerHTML = `${navLink('home', 'Wiki home', '#8b5cf6')}${publishedVideos.length ? navLink('videos', 'Video tutorials', '#f87171') : ''}`
    + `<div class="nav-group"><b>Core guide</b>${common}</div>`
    + `<div class="nav-group"><b>Vault manuals</b>${vaults}</div>`;

  // On wide desktop the right rail already contains every chapter. The vault
  // row therefore navigates straight to the manual without duplicating that
  // index on the left. At narrower widths it remains an accordion.
  $('#wiki-nav').addEventListener('click', (event) => {
    const summary = event.target.closest('.nav-vault > summary');
    if (!summary) return;
    const vault = summary.parentElement;
    if (usesRightHandToc.matches) {
      event.preventDefault();
      syncVaultNavigation(vault.dataset.vault);
      if (location.hash === `#${vault.dataset.vault}`) render(vault.dataset.vault);
      else location.hash = vault.dataset.vault;
      return;
    }
    if (!vault.open) {
      $('#wiki-nav').querySelectorAll('.nav-vault[open]').forEach((other) => {
        if (other !== vault) other.open = false;
      });
    }
  });
}

function syncVaultNavigation(activeVaultId = null) {
  const vaults = document.querySelectorAll('.nav-vault');
  vaults.forEach((vault) => {
    const isActive = vault.dataset.vault === activeVaultId;
    const summary = $('summary', vault);
    summary?.classList.toggle('active', isActive);
    if (usesRightHandToc.matches) {
      summary?.setAttribute('role', 'link');
      if (isActive) summary?.setAttribute('aria-current', 'page');
      else summary?.removeAttribute('aria-current');
    } else {
      summary?.removeAttribute('role');
      summary?.removeAttribute('aria-current');
    }
    if (usesRightHandToc.matches || !isActive) vault.open = false;
    else vault.open = true;
  });
}

function navLink(id, title, accent) {
  return `<a class="nav-link" href="#${id}" data-page="${id}" style="--nav-accent:${accent}"><span class="nav-dot"></span>${escapeHtml(title)}</a>`;
}

function figure(image, caption) {
  if (!image) return '';
  return `<figure class="doc-figure"><img src="${imagePath(image)}" alt="${escapeHtml(caption)}" loading="lazy"/><figcaption>${escapeHtml(caption)}</figcaption></figure>`;
}

function locationFor(chapter, vault) {
  if (chapter.location) return chapter.location;
  if (vault) return `${vault.name} vault → ${chapter.title}`;
  return `Nodus → ${chapter.title}`;
}

function sectionMarkup(chapter, accent, showFigure = true, vault = null) {
  return `<section class="doc-section" id="${chapter.id}">
    <p class="section-kicker">${escapeHtml(chapter.group)}</p>
    <h2>${escapeHtml(chapter.title)}</h2>
    <p class="section-summary">${escapeHtml(chapter.summary)}</p>
    <p class="section-details">${escapeHtml(chapter.details)}</p>
    <div class="start-box"><div><span>Where to find it</span><strong>${escapeHtml(locationFor(chapter, vault))}</strong></div><div><span>What you will do</span><strong>${escapeHtml(chapter.outcome || chapter.summary)}</strong></div></div>
    <div class="section-grid"><div class="howto"><h3>Step by step</h3><ol>${chapter.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol></div>
    <aside class="tipbox"><h3>Good practice</h3><ul>${chapter.tips.map((tip) => `<li>${escapeHtml(tip)}</li>`).join('')}</ul></aside></div>
    ${showFigure ? figure(chapter.image, chapter.title) : ''}
  </section>`;
}

function homeMarkup() {
  return `<div style="--accent:#8b5cf6"><p class="eyebrow">Official documentation</p><h1>Learn Nodus from first launch to finished work.</h1>
    <p class="lead">Nodus is the desktop application developed by the Nodus Research project. Explore all nine specialised vaults, from first launch and basic terminology to evidence-aware workflows, privacy controls and finished outputs.</p>
    <div class="meta-row"><span class="pill">Nodus ${escapeHtml(content.version)}</span><span class="pill">Updated ${escapeHtml(content.updated)}</span><span class="pill">${allVaults.length} vault types</span><span class="pill">${content.vaults.reduce((n,v)=>n+v.chapters.length,0)} guided sections</span><span class="pill">Searchable offline documentation</span></div>
    <div class="hero-actions"><a class="action primary bundle-download" href="${content.manualBundle}" download>${downloadIconMarkup()}Download all PDF manuals (.zip)</a><a class="action" href="#welcome">Start with the essentials</a><a class="action" href="https://github.com/jorgepb96/nodus/releases/latest">Download Nodus</a></div>
    <section class="doc-section vault-overview"><p class="section-kicker">Choose a workspace</p><h2>${allVaults.length} vaults, one local-first engine</h2><p class="section-details">Start with the vault that matches the work, not with a generic empty canvas. Complete guides are available for five vaults; the other four already ship in Nodus and will receive their Wiki guides later.</p>
    <div class="vault-grid">${allVaults.map((vault) => {
      const hasGuide = Array.isArray(vault.chapters) && vault.chapters.length > 0;
      return `<article class="vault-card${hasGuide ? '' : ' guide-pending'}" style="--card-accent:${vault.accent}"><span class="vault-mark" style="--vault-accent:${vault.accent}">${iconMarkup(vault.icon)}</span><h2>${escapeHtml(vault.name)}</h2><p>${escapeHtml(vault.tagline)}</p><div class="vault-card-actions">${hasGuide ? `<a class="vault-guide-link" href="#${vault.id}">Open the ${escapeHtml(vault.short)} guide →</a><a class="vault-pdf-download" href="${vault.pdf}" download aria-label="Download the ${escapeHtml(vault.name)} PDF manual">${downloadIconMarkup()}<span>PDF manual</span></a>` : '<span class="guide-status">Available in Nodus · Wiki guide coming later</span>'}</div></article>`;
    }).join('')}</div></section>
    <aside class="callout"><b>Documentation principle</b><p>Every generated summary, relationship or citation remains something to inspect. Nodus helps organise reasoning; it does not turn automated output into evidence.</p></aside>
  </div>`;
}

function vaultMarkup(vault) {
  return `<div style="--accent:${vault.accent}"><p class="eyebrow">${escapeHtml(vault.name)} vault</p><h1>${escapeHtml(vault.tagline)}</h1><p class="lead">${escapeHtml(vault.description)}</p>
    <div class="meta-row"><span class="pill">For ${escapeHtml(vault.audience)}</span><span class="pill">${vault.chapters.length} complete tutorials</span><span class="pill">Step-by-step workflows</span></div>
    <div class="hero-actions"><a class="action primary" href="#${vault.chapters[0].id}">Begin the guide</a><a class="action" href="${vault.pdf}" download>${downloadIconMarkup()}Download PDF manual</a><a class="action bundle-download" href="${content.manualBundle}" download>${downloadIconMarkup()}Download all manuals</a></div>
    ${figure(`${vault.id}/home.png`, `${vault.name} vault overview`)}
    ${vault.chapters.map((chapter, index) => sectionMarkup(chapter, vault.accent, index === 0 || index % 2 === 1, vault)).join('')}
  </div>`;
}

function videosMarkup() {
  const shelves = publishedVideos.reduce((groups, video) => {
    const [shelf] = VIDEO_TITLES[video.id];
    (groups[shelf] ||= []).push(video);
    return groups;
  }, {});
  const sections = Object.entries(shelves).map(([shelf, items]) => `<section class="doc-section" id="videos-${shelf.toLowerCase().replace(/\s+/g, '-')}">
    <p class="section-kicker">Video tutorials</p><h2>${escapeHtml(shelf)}</h2>
    <div class="video-grid">${items.map((video) => {
      const [, title] = VIDEO_TITLES[video.id];
      return `<button class="video-card" type="button" data-video="${video.youtubeId}" data-title="${escapeHtml(title)}">
        <span class="video-thumb"><img src="https://i.ytimg.com/vi/${video.youtubeId}/hqdefault.jpg" alt="" loading="lazy" width="480" height="360"/>
          <span class="video-play"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7-11-7Z"/></svg></span></span>
        <span class="video-copy"><b>${escapeHtml(title)}</b></span>
      </button>`;
    }).join('')}</div></section>`).join('');

  return `<div style="--accent:#f87171"><p class="eyebrow">Video tutorials</p><h1>Watch it work, step by step.</h1>
    <p class="lead">Short guided videos for setting up each vault, discovering key features and connecting Nodus to the tools you already use. They play here, and the whole catalogue is also inside the app under Settings → Help.</p>
    <div class="meta-row"><span class="pill">${publishedVideos.length} videos</span><span class="pill">Watch without leaving the wiki</span></div>
    ${sections || '<p class="lead">The video catalogue could not be loaded. <a href="https://www.youtube.com/@nodusresearch">Open the channel</a>.</p>'}
  </div>`;
}

function openVideo(id, title) {
  let modal = $('#video-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'video-modal';
    modal.className = 'video-modal';
    modal.innerHTML = `<div class="video-dialog" role="dialog" aria-modal="true" aria-labelledby="video-modal-title">
      <div class="video-head"><h3 id="video-modal-title"></h3>
        <button class="video-close" type="button" aria-label="Close video">×</button></div>
      <div class="video-frame"><iframe title="Nodus tutorial" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>
    </div>`;
    document.body.append(modal);
    modal.addEventListener('click', (event) => {
      if (event.target === modal || event.target.closest('.video-close')) closeVideo();
    });
    addEventListener('keydown', (event) => { if (event.key === 'Escape') closeVideo(); });
  }
  $('#video-modal-title', modal).textContent = title;
  $('iframe', modal).src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1`;
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  $('.video-close', modal).focus();
}

function closeVideo() {
  const modal = $('#video-modal');
  if (!modal || !modal.classList.contains('open')) return;
  modal.classList.remove('open');
  $('iframe', modal).src = '';
  document.body.style.overflow = '';
}

function commonMarkup(chapter) {
  return `<div style="--accent:#8b5cf6"><p class="eyebrow">Core guide</p><h1>${escapeHtml(chapter.title)}</h1><p class="lead">${escapeHtml(chapter.summary)}</p>${sectionMarkup(chapter, '#8b5cf6')}</div>`;
}

function render(id) {
  const page = allPages.find((entry) => entry.id === id) || allPages[0];
  if (page.type === 'home') $('#article').innerHTML = homeMarkup();
  else if (page.type === 'videos') $('#article').innerHTML = videosMarkup();
  else if (page.type === 'vault') $('#article').innerHTML = vaultMarkup(page);
  else if (page.type === 'common') $('#article').innerHTML = commonMarkup(page);
  else $('#article').innerHTML = vaultMarkup(page.vault);
  document.documentElement.style.setProperty('--accent', page.accent || '#8b5cf6');
  document.title = page.type === 'home' ? 'Nodus Documentation | Nodus Research' : `${page.title} | Nodus Documentation`;
  document.querySelectorAll('.nav-link').forEach((link) => link.classList.toggle('active', link.dataset.page === page.id));
  const parent = page.vault || (page.type === 'vault' ? page : null);
  syncVaultNavigation(parent?.id || null);
  $('#article').querySelectorAll('.video-card').forEach((card) => {
    card.addEventListener('click', () => openVideo(card.dataset.video, card.dataset.title));
  });
  const sections = [...$('#article').querySelectorAll('.doc-section[id]')];
  $('#page-toc').innerHTML = sections.map((section) => `<a href="#${section.id}">${escapeHtml($('h2', section)?.textContent || '')}</a>`).join('');
  watchSections(sections, page);
  requestAnimationFrame(() => {
    if (page.type === 'chapter') $(`#${CSS.escape(page.id)}`)?.scrollIntoView();
    else window.scrollTo({ top: 0 });
  });
}

/* Follow the reader down the page: whichever chapter is currently being read
   lights up in the left rail and in "On this page". A vault manual is one long
   document, so without this the rail would sit on the vault name for the whole
   scroll and give no sense of place. */
let sectionSpy = null;

function watchSections(sections, page) {
  if (sectionSpy) { sectionSpy.disconnect(); sectionSpy = null; }
  if (!sections.length || !('IntersectionObserver' in window)) return;

  const ratios = new Map();
  const fallback = page.type === 'chapter' ? page.id : page.id;

  const paint = () => {
    let best = null;
    let bestRatio = 0;
    for (const section of sections) {
      const ratio = ratios.get(section.id) || 0;
      if (ratio > bestRatio) { bestRatio = ratio; best = section.id; }
    }
    // above the first chapter (the page head), keep the page itself marked
    const current = best || fallback;

    document.querySelectorAll('.nav-link').forEach((link) => {
      link.classList.toggle('active', link.dataset.page === current);
    });
    document.querySelectorAll('#page-toc a').forEach((link) => {
      link.classList.toggle('active', link.getAttribute('href') === `#${current}`);
    });
  };

  sectionSpy = new IntersectionObserver((entries) => {
    for (const entry of entries) ratios.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0);
    paint();
  }, {
    // bias towards the upper half, so the marker moves as a heading reaches the top
    rootMargin: `-${Math.round(innerHeight * 0.12)}px 0px -55% 0px`,
    threshold: [0, 0.15, 0.4, 0.75, 1],
  });
  sections.forEach((section) => sectionSpy.observe(section));
}

function search(query) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return allPages.map((page) => {
    const haystack = [page.title,page.summary,page.details,page.tagline,page.description,page.group,...(page.steps||[]),...(page.tips||[])].filter(Boolean).join(' ').toLowerCase();
    const score = terms.reduce((sum, term) => sum + (page.title.toLowerCase().includes(term) ? 8 : 0) + (haystack.split(term).length - 1), 0);
    return { page, score };
  }).filter((item) => item.score > 0).sort((a,b) => b.score-a.score).slice(0,12);
}

function showResults(value) {
  const box = $('#search-results');
  if (!value.trim()) { box.hidden = true; box.innerHTML = ''; return; }
  const results = search(value);
  box.innerHTML = results.length ? results.map(({page}) => `<a class="search-result" href="#${page.id}" style="--result-accent:${page.accent}"><span class="result-icon">${iconMarkup(page.icon || page.vault?.icon)}</span><span><b>${escapeHtml(page.title)}</b><span>${escapeHtml(page.vault?.name || (page.type === 'vault' ? page.name : page.group || 'Core guide'))} · ${escapeHtml(page.summary || page.tagline || '')}</span></span></a>`).join('') : '<div class="search-empty">No guide matches that search.</div>';
  box.hidden = false;
}

buildNavigation();
$('#version').textContent = `Nodus ${content.version}`;
render(location.hash.slice(1) || 'home');
usesRightHandToc.addEventListener('change', () => {
  const page = allPages.find((entry) => entry.id === (location.hash.slice(1) || 'home')) || allPages[0];
  const parent = page.vault || (page.type === 'vault' ? page : null);
  syncVaultNavigation(parent?.id || null);
});
function setNavigationOpen(open, restoreFocus = false) {
  document.body.classList.toggle('nav-open', open);
  $('#nav-toggle').setAttribute('aria-expanded', String(open));
  $('#nav-backdrop').hidden = !open;
  if (open) requestAnimationFrame(() => $('#nav-close').focus());
  else if (restoreFocus) $('#nav-toggle').focus();
}

addEventListener('hashchange', () => { render(location.hash.slice(1) || 'home'); $('#search-results').hidden = true; $('#search').value = ''; setNavigationOpen(false); });
$('#search').addEventListener('input', (event) => showResults(event.target.value));
$('#search').addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.target.value = ''; showResults(''); event.target.blur(); } });
addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#search').focus(); }
  else if (event.key === 'Escape' && document.body.classList.contains('nav-open')) setNavigationOpen(false, true);
});
document.addEventListener('pointerdown', (event) => { if (!event.target.closest('.wiki-search-wrap')) $('#search-results').hidden = true; });
$('#nav-toggle').addEventListener('click', () => setNavigationOpen(true));
$('#nav-close').addEventListener('click', () => setNavigationOpen(false, true));
$('#nav-backdrop').addEventListener('click', () => setNavigationOpen(false, true));
