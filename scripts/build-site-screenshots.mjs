/*
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

Mirrors the README and dedicated desktop screenshots the home page shows into the website's own asset
tree. The website is published from site/ alone (see build-pages-artifact.mjs),
so it cannot reach docs/screenshots at runtime: the window shown on the home page
has to be a copy that travels with the site.

The copy is derived, never hand-made. Run `npm run site:screenshots` after the
source images change and this script regenerates exactly the files the home page
references, from the original captures listed below.
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* The frames render at about 600 CSS px wide, so 1280 is a 2x copy: sharp on a
   laptop, no larger a download than the README's own JPEGs. Every source has
   a 16:10 aspect ratio, so nothing is ever cropped. */
export const SHOT_WIDTH = 1280;
export const SHOT_HEIGHT = 800;

/* One entry per screenshot the home page shows. A vault with several views
   carries all of them, in the order its scene's carousel steps through them. */
export const SITE_SHOTS = [
  { source: 'docs/screenshots/readme-academic-demo.jpg', target: 'academic-demo.webp' },
  { source: 'docs/screenshots/readme-academic-theme-relations.jpg', target: 'academic-theme-relations.webp' },
  { source: 'docs/screenshots/readme-academic-argument-map.jpg', target: 'academic-argument-map.webp' },
  { source: 'docs/screenshots/readme-academic-deep-research.jpg', target: 'academic-deep-research.webp' },
  { source: 'docs/screenshots/readme-academic-podcast.jpg', target: 'academic-podcast.webp' },
  { source: 'docs/screenshots/readme-academic-immersion.jpg', target: 'academic-immersion.webp' },
  { source: 'docs/screenshots/readme-teaching-demo.jpg', target: 'teaching-demo.webp' },
  { source: 'docs/screenshots/site/teaching-questions.png', target: 'teaching-questions.webp' },
  { source: 'docs/screenshots/site/teaching-rubrics.png', target: 'teaching-rubrics.webp' },
  { source: 'docs/screenshots/site/teaching-timetable.png', target: 'teaching-timetable.webp' },
  { source: 'docs/screenshots/site/teaching-calendar.png', target: 'teaching-calendar.webp' },
  { source: 'docs/screenshots/site/teaching-exams.png', target: 'teaching-exams.webp' },
  { source: 'docs/screenshots/site/teaching-grades.png', target: 'teaching-grades.webp' },
  { source: 'docs/screenshots/readme-study-demo.jpg', target: 'study-demo.webp' },
  { source: 'docs/screenshots/site/study-questions.png', target: 'study-questions.webp' },
  { source: 'docs/screenshots/site/study-review.png', target: 'study-review.webp' },
  { source: 'docs/screenshots/site/study-graph.png', target: 'study-graph.webp' },
  { source: 'docs/screenshots/site/study-schedule.png', target: 'study-schedule.webp' },
  { source: 'docs/screenshots/site/study-courses.png', target: 'study-courses.webp' },
  { source: 'docs/screenshots/site/study-calendar.png', target: 'study-calendar.webp' },
  { source: 'docs/screenshots/readme-databases-demo.jpg', target: 'databases-demo.webp' },
  { source: 'docs/screenshots/site/databases-analysis.png', target: 'databases-analysis.webp' },
  { source: 'docs/screenshots/site/databases-relations.png', target: 'databases-relations.webp' },
  { source: 'docs/screenshots/site/databases-record.png', target: 'databases-record.webp' },
  { source: 'docs/screenshots/site/databases-gallery.png', target: 'databases-gallery.webp' },
  { source: 'docs/screenshots/site/databases-board.png', target: 'databases-board.webp' },
  // The five modes of "More ways to work with Nodus", captured from the app by
  // scripts/capture-site-more-vaults.mjs. Genealogy carries five views rather than
  // seven: the map's OpenStreetMap tiles are refused for this client, and the social
  // graph, the Library and the search results are empty on the seeded demo.
  { source: 'docs/screenshots/more/genealogy-tree.png', target: 'genealogy-tree.webp' },
  { source: 'docs/screenshots/more/genealogy-persons.png', target: 'genealogy-persons.webp' },
  { source: 'docs/screenshots/more/genealogy-archive.png', target: 'genealogy-archive.webp' },
  { source: 'docs/screenshots/more/genealogy-map.png', target: 'genealogy-map.webp' },
  { source: 'docs/screenshots/more/genealogy-timeline.png', target: 'genealogy-timeline.webp' },
  { source: 'docs/screenshots/more/genealogy-deepResearch.png', target: 'genealogy-deep-research.webp' },
  { source: 'docs/screenshots/more/worldbuilding-characters.png', target: 'worldbuilding-characters.webp' },
  { source: 'docs/screenshots/more/worldbuilding-encyclopedia.png', target: 'worldbuilding-encyclopedia.webp' },
  { source: 'docs/screenshots/more/worldbuilding-places.png', target: 'worldbuilding-places.webp' },
  { source: 'docs/screenshots/more/worldbuilding-factions.png', target: 'worldbuilding-factions.webp' },
  { source: 'docs/screenshots/more/worldbuilding-cultures.png', target: 'worldbuilding-cultures.webp' },
  { source: 'docs/screenshots/more/worldbuilding-timeline.png', target: 'worldbuilding-timeline.webp' },
  { source: 'docs/screenshots/more/worldbuilding-scenes.png', target: 'worldbuilding-scenes.webp' },
  { source: 'docs/screenshots/more/primary-sources-archive.png', target: 'primary-sources-archive.webp' },
  { source: 'docs/screenshots/more/primary-sources-timeline.png', target: 'primary-sources-timeline.webp' },
  { source: 'docs/screenshots/more/testimony-testimonyInterviews.png', target: 'testimony-interviews.webp' },
  { source: 'docs/screenshots/more/testimony-testimonyParticipants.png', target: 'testimony-participants.webp' },
  { source: 'docs/screenshots/more/prosopography-prosopPersons.png', target: 'prosopography-persons.webp' },
  { source: 'docs/screenshots/more/prosopography-prosopPopulation.png', target: 'prosopography-population.webp' },
];

export async function buildSiteScreenshots({ root = repoRoot, quiet = false } = {}) {
  const to = path.join(root, 'site', 'assets', 'screenshots');
  fs.mkdirSync(to, { recursive: true });

  const written = [];
  for (const { source, target } of SITE_SHOTS) {
    const input = path.join(root, source);
    const output = path.join(to, target);
    const image = sharp(input);
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || metadata.width * 10 !== metadata.height * 16) {
      throw new Error(`${source} is ${metadata.width}x${metadata.height}; the site's frames require uncropped 16:10 windows.`);
    }
    const buffer = await image
      .resize({ width: SHOT_WIDTH, height: SHOT_HEIGHT, fit: 'cover' })
      .webp({ quality: 80, effort: 5 })
      .toBuffer();
    fs.writeFileSync(output, buffer);
    written.push({ target, bytes: buffer.length });
    if (!quiet) {
      console.log(`site/assets/screenshots/${target}  ${(buffer.length / 1024).toFixed(0)} KB`);
    }
  }

  /* A file that no longer has a source would keep being served forever, so the
     folder is pruned back to this list rather than appended to. */
  const expected = new Set(SITE_SHOTS.map((shot) => shot.target));
  for (const entry of fs.readdirSync(to)) {
    if (entry === 'README.md' || expected.has(entry)) continue;
    fs.rmSync(path.join(to, entry));
    if (!quiet) console.log(`removed site/assets/screenshots/${entry} (no source left)`);
  }

  return written;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const written = await buildSiteScreenshots({ root: repoRoot });
  const total = written.reduce((sum, shot) => sum + shot.bytes, 0);
  console.log(`\n${written.length} screenshots mirrored from the original desktop captures (${(total / 1024).toFixed(0)} KB total).`);
  console.log(`The frames live in site/index.html; the sources are the captures listed above.`);
}
