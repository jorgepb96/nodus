// "A tease of what's coming" — the 3.2.4 look at the mobile app.
//
// This announcement is unlike its neighbours in one way that matters: there is no
// tutorial chapter it could duplicate, because the app it previews does not exist in
// this build. So it must NOT carry a previousTutorialVersion guard, which would hide it
// from exactly the new installs that have never heard of the mobile app either.
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

const SHOTS = [
  '01-home', '02-library', '03-work', '04-idea', '05-search',
  '06-argument-map', '07-gaps', '08-deep-research', '09-byo-model',
];

test('the teaser belongs to 3.2.4, shows once, and is gated on nothing else', async () => {
  const [guide, pkg] = await Promise.all([read('archive/startup-announcements/MobileTeaserGuide.tsx'), read('package.json')]);
  assert.match(guide, /MOBILE_TEASER_RELEASE = '3\.2\.4'/);
  // It presents on the version it names and on no other, so shipping 3.2.5 retires it
  // rather than showing it a second time. Pin that instead of pinning the app to 3.2.4:
  // bumping the constant to follow a release is how a one-off teaser becomes permanent.
  assert.notEqual(
    JSON.parse(pkg).version,
    '3.2.4',
    'once the app moves past 3.2.4 the teaser must stay behind, not follow the release',
  );
  assert.match(guide, /nodus\.mobileTeaserSeen/);
  assert.match(guide, /__APP_VERSION__ !== MOBILE_TEASER_RELEASE/);
  // Seen once, and only when actually dismissed — a launch that never reached the
  // foreground must not consume the one showing.
  assert.match(guide, /const finish = \(\) => \{ markSeen\(\); onSettled\(\); \};/);
  assert.match(guide, /localStorage\.setItem\(SEEN_KEY, '1'\)/);
  // The trap this modal exists to avoid: no tutorial-version guard.
  assert.ok(
    !guide.includes('previousTutorialVersion'),
    'the mobile app is in no tutorial chapter, so new installs must see this too',
  );
  // onSettled must fire even when the modal declines to show, or the chain behind it stalls.
  assert.match(guide, /useEffect\(\(\) => \{ if \(!eligible\) onSettled\(\); \}, \[eligible, onSettled\]\);/);
});

test('the mobile teaser is archived and no longer participates in startup', async () => {
  const app = await read('src/App.tsx');
  assert.doesNotMatch(app, /MobileTeaserGuide|mobileTeaserSettled/);
});

test('the carousel carries all nine shipped screenshots', async () => {
  const guide = await read('archive/startup-announcements/MobileTeaserGuide.tsx');
  for (const shot of SHOTS) {
    assert.match(guide, new RegExp(`mobile-teaser/${shot}\\.webp`), `missing slide: ${shot}`);
    const asset = await stat(path.join(root, `src/assets/mobile-teaser/${shot}.webp`));
    assert.ok(asset.size > 2_000, `${shot}.webp looks empty`);
    // The App Store originals are ~580 KB each. Shipping them unresampled would put
    // 5 MB of marketing art in every installer for a modal seen once.
    assert.ok(asset.size < 80_000, `${shot}.webp is too heavy to ship: ${asset.size} bytes`);
  }
  assert.equal([...guide.matchAll(/mobile-teaser\/\d\d-[a-z-]+\.webp/g)].length, SHOTS.length);
  assert.match(guide, /data-testid="mobile-teaser-guide"/);
  assert.match(guide, /data-testid="mobile-teaser-prev"/);
  assert.match(guide, /data-testid="mobile-teaser-next"/);
  assert.match(guide, /data-testid="mobile-teaser-complete"/);
  // Wrapping in both directions, so the last shot is not a dead end.
  assert.match(guide, /\(value \+ delta \+ SHOTS\.length\) % SHOTS\.length/);
  // Picture and caption must change on the same tick. Behind AnimatePresence with
  // mode="wait" the incoming shot waits for the outgoing one to finish leaving, while
  // the caption and dots update immediately — which showed the PREVIOUS screenshot
  // under the new caption for the length of the exit animation. Verified in a browser:
  // the image stayed on slide 1 while the caption walked to slide 4.
  const code = guide.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!code.includes('AnimatePresence'), 'the carousel image must swap outright, not wait for an exit');
});

test('the survey is the one outbound link, opened in the real browser', async () => {
  const guide = await read('archive/startup-announcements/MobileTeaserGuide.tsx');
  // The canonical destination, never the forms.gle short link: that domain is a retired
  // Firebase Dynamic Links host, and a short link that fails to resolve shows Google's
  // "Invalid Dynamic Link" page instead of the form.
  assert.match(guide, /MOBILE_TEASER_SURVEY_URL =\s*'https:\/\/docs\.google\.com\/forms\/d\/e\/1FAIpQLSf-wHGtAbQV3Kc0J1hgzXBpj8oV1ky9xbuyNJMQ467X7rUYBw\/viewform'/);
  // Checked against code only: the comment above the constant names the short link in
  // order to explain why it is not used, and that mention must stay allowed.
  const code = guide.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!code.includes('forms.gle'), 'the retired short-link domain must not ship');
  assert.match(guide, /window\.nodus\.openExternal\(MOBILE_TEASER_SURVEY_URL\)/);
  // Nothing may be requested by the modal itself: the images are bundled imports and
  // the form is only reached when the user clicks.
  assert.ok(!/fetch\(|XMLHttpRequest|<iframe/.test(guide), 'the teaser must not call out on its own');
});

test('every interface language is translated, and says the images are not', async () => {
  const guide = await read('archive/startup-announcements/MobileTeaserGuide.tsx');
  const types = await read('shared/types.ts');
  const languages = [...types.slice(types.indexOf('export type AppLanguage')).slice(0, 120).matchAll(/'([a-zA-Z-]+)'/g)].map((m) => m[1]);
  assert.ok(languages.length >= 8, `the language union looks truncated: ${languages}`);

  const copy = guide.slice(guide.indexOf('const COPY: Record<AppLanguage, TeaserCopy>'), guide.indexOf('function shouldPresent'));
  for (const language of languages) {
    const key = /^[a-z]{2}$/.test(language) ? `  ${language}: {` : `  '${language}': {`;
    assert.ok(copy.includes(key), `no copy for ${language}`);
  }
  // Every language must state that the screenshots and the form stay English, or the
  // modal silently promises a localised survey it cannot deliver.
  assert.equal([...copy.matchAll(/englishNote:/g)].length, languages.length);
  assert.equal([...copy.matchAll(/surveyCta:/g)].length, languages.length);
  // And each carries its own nine slide labels.
  // The generated tables may quote with double quotes; the label itself must match.
  assert.equal([...copy.matchAll(/deepResearch: (['"])(.+)\1,/g)].filter((m) => m[2] === 'Deep Research').length, languages.length);
});
