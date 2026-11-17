import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatReleaseDate,
  loadSiteMetadata,
  personEntity,
  softwareEntity,
  websiteEntity,
} from './lib/site-metadata.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const metadata = loadSiteMetadata(repoRoot);
const siteRoot = path.join(repoRoot, 'site');

const generatedJsonLd = (graph) => `<script type="application/ld+json">\n${JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': graph,
}, null, 2).replaceAll('<', '\\u003c')}\n</script>`;

function replaceBlock(relative, name, content) {
  const file = path.join(siteRoot, relative);
  const source = fs.readFileSync(file, 'utf8');
  const start = `<!-- generated:${name}:start -->`;
  const end = `<!-- generated:${name}:end -->`;
  const pattern = new RegExp(`${start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  if (!pattern.test(source)) throw new Error(`${relative} is missing the ${name} generated block.`);
  const output = source.replace(pattern, `${start}\n${content}\n${end}`);
  fs.writeFileSync(file, output);
}

const breadcrumb = (name, url) => ({
  '@type': 'BreadcrumbList',
  '@id': `${url}#breadcrumb`,
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: metadata.projectName, item: `${metadata.siteUrl}/` },
    { '@type': 'ListItem', position: 2, name, item: url },
  ],
});

replaceBlock('index.html', 'homepage-jsonld', generatedJsonLd([
  personEntity(metadata),
  websiteEntity(metadata),
]));

const nodusUrl = `${metadata.siteUrl}/nodus/`;
replaceBlock('nodus/index.html', 'nodus-jsonld', generatedJsonLd([
  breadcrumb('Nodus Research', nodusUrl),
  {
    '@type': 'WebPage',
    '@id': `${nodusUrl}#webpage`,
    url: nodusUrl,
    name: 'Nodus Research',
    isPartOf: { '@id': metadata.websiteId },
    breadcrumb: { '@id': `${nodusUrl}#breadcrumb` },
    mainEntity: { '@id': metadata.softwareId },
  },
  softwareEntity(metadata),
]));

const appUrl = `${metadata.siteUrl}/app/`;
replaceBlock('app/index.html', 'app-jsonld', generatedJsonLd([
  breadcrumb('Nodus App', appUrl),
  {
    '@type': 'WebPage',
    '@id': `${appUrl}#webpage`,
    url: appUrl,
    name: 'Nodus App',
    isPartOf: { '@id': metadata.websiteId },
    breadcrumb: { '@id': `${appUrl}#breadcrumb` },
    mainEntity: { '@id': metadata.softwareId },
  },
  softwareEntity(metadata),
]));

const citeUrl = `${metadata.siteUrl}/cite/`;
replaceBlock('cite/index.html', 'cite-jsonld', generatedJsonLd([
  breadcrumb('Cite Nodus Research', citeUrl),
  {
    '@type': 'WebPage',
    '@id': `${citeUrl}#webpage`,
    url: citeUrl,
    name: 'Cite Nodus Research',
    description: 'DOI and software citation metadata for Nodus Research and Nodus.',
    isPartOf: { '@id': metadata.websiteId },
    breadcrumb: { '@id': `${citeUrl}#breadcrumb` },
    about: { '@id': metadata.softwareId },
  },
  softwareEntity(metadata),
]));

replaceBlock('cite/index.html', 'citation-details', `<dl class="citation-meta reveal">
      <div><dt>Project</dt><dd>${metadata.projectName}</dd></div>
      <div><dt>Software</dt><dd>${metadata.softwareName}</dd></div>
      <div><dt>Version</dt><dd>${metadata.version}</dd></div>
      <div><dt>Released</dt><dd>${formatReleaseDate(metadata.releaseDate)}</dd></div>
      <div><dt>Release tag</dt><dd><a href="${metadata.repository}/releases/tag/${metadata.releaseTag}" target="_blank" rel="noopener">${metadata.releaseTag}</a></dd></div>
      <div><dt>Author</dt><dd><a href="${metadata.orcid}" target="_blank" rel="noopener">${metadata.authorName} · ORCID</a></dd></div>
      <div><dt>Licence</dt><dd><a href="${metadata.licenseUrl}" target="_blank" rel="noopener">${metadata.license}</a></dd></div>
    </dl>`);

const versionDoiCard = metadata.versionDoi
  ? `<article class="card lit doi-card reveal" style="--delay:80ms">
        <span class="kicker">Nodus ${metadata.version} · version DOI</span>
        <h3>The exact software release</h3>
        <p>This immutable DOI resolves only to the archived ${metadata.version} release. Use it when the exact software version matters for reproducibility.</p>
        <a class="doi-value" href="https://doi.org/${metadata.versionDoi}" target="_blank" rel="noopener">${metadata.versionDoi}</a>
      </article>`
  : `<article class="card lit doi-card reveal" style="--delay:80ms">
        <span class="kicker">Nodus ${metadata.version} · archive pending</span>
        <h3>Version DOI pending</h3>
        <p>Zenodo assigns the immutable DOI after this release is archived. Until then, cite the conceptual DOI and the ${metadata.releaseTag} release tag shown here.</p>
        <a class="doi-value" href="${metadata.repository}/releases/tag/${metadata.releaseTag}" target="_blank" rel="noopener">${metadata.releaseTag}</a>
      </article>`;

replaceBlock('cite/index.html', 'citation-dois', `<div class="doi-grid">
      <article class="card lit doi-card reveal">
        <span class="kicker">All versions · conceptual DOI</span>
        <h3>Nodus Research over time</h3>
        <p>This persistent identifier represents every archived release and resolves through the complete version history.</p>
        <a class="doi-value" href="https://doi.org/${metadata.conceptDoi}" target="_blank" rel="noopener">${metadata.conceptDoi}</a>
      </article>
      ${versionDoiCard}
    </div>`);

const citationKey = `perez_burgueno_nodus_${metadata.releaseDate.slice(0, 4)}`;
replaceBlock('cite/index.html', 'citation-formats', `<div class="citation-block reveal">
      <h3>APA</h3>
      <p>Pérez Burgueño, J., &amp; Nodus contributors. (${metadata.releaseDate.slice(0, 4)}). <i>Nodus: Open-Source Research Workspace</i> (Version ${metadata.version}) [Computer software]. Zenodo. <a href="https://doi.org/${metadata.citationDoi}" target="_blank" rel="noopener">https://doi.org/${metadata.citationDoi}</a></p>
    </div>

    <div class="citation-block reveal">
      <h3>BibTeX</h3>
      <pre><code>@software{${citationKey},
  author    = {Pérez Burgueño, Jorge and Nodus contributors},
  title     = {Nodus: Open-Source Research Workspace},
  version   = {${metadata.version}},
  year      = {${metadata.releaseDate.slice(0, 4)}},
  publisher = {Zenodo},
  doi       = {${metadata.citationDoi}},
  url       = {${metadata.repository}/releases/tag/${metadata.releaseTag}},
  license   = {${metadata.license}}
}</code></pre>
    </div>`);

console.log(`Generated site metadata for Nodus ${metadata.version} (${metadata.releaseTag}).`);
