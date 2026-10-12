import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

test('feedback offers a structured new-vault collaboration request', async () => {
  const feedback = await read('src/views/FeedbackModal.tsx');
  assert.match(feedback, /type FeedbackKind = 'feature' \| 'bug' \| 'vault' \| 'feedback'/);
  assert.match(feedback, /data-testid="feedback-new-vault-type"/);
  for (const area of ['Periodismo', 'Ciencias de la salud', 'Ciencias experimentales', 'Psicología y psiquiatría', 'Jurídico', 'Política', 'Economía y finanzas', 'Ingeniería']) {
    assert.ok(feedback.includes(`'${area}'`), `${area} is suggested`);
  }
  assert.match(feedback, /Puedo probar activamente este vault/);
  assert.match(feedback, /Soy especialista o profesional del área/);
  assert.match(feedback, /Organización y estructura del vault/);
  assert.match(feedback, /Beneficios y casos de uso/);
  assert.match(feedback, /modelos locales del usuario/);
  assert.match(feedback, /placeholders que la IA no verá/);
  assert.match(feedback, /\[Vault type\]/);
  assert.match(feedback, /data-testid="feedback-cinematic-modal"/);
  assert.match(feedback, /className="roadmap-backdrop feedback-backdrop"/);
  assert.match(feedback, /className="roadmap-hero feedback-hero"/);
  assert.match(feedback, /initial=\{\{ opacity: 0, y: 28, scale: 0\.96 \}\}/);
});

test('feedback offers an optional 0–10 product survey in one permanent thread', async () => {
  const [feedback, styles] = await Promise.all([
    read('src/views/FeedbackModal.tsx'),
    read('src/index.css'),
  ]);
  assert.match(feedback, /data-testid="feedback-product-feedback"/);
  assert.match(feedback, /kind === 'feedback'\s*\?\s*true/);
  assert.match(feedback, /const PRODUCT_FEEDBACK_THREAD = 272/);
  assert.match(feedback, /navigator\.clipboard\.writeText\(body\)/);
  assert.match(feedback, /issues\/\$\{PRODUCT_FEEDBACK_THREAD\}/);
  assert.match(feedback, /#new_comment_field/);
  assert.match(feedback, /setComposedFeedback\(body\)/);
  assert.match(feedback, /No se pudo copiar automáticamente/);
  assert.doesNotMatch(feedback, /\[Feedback\]/);
  assert.doesNotMatch(feedback, /kind === 'feedback' \? 'feedback'/);
  assert.match(feedback, /Array\.from\(\{ length: 11 \}/);
  for (const question of ['Cantidad y variedad de funciones', 'Usabilidad', 'Rendimiento', 'Estabilidad', 'Diseño visual', '¿Qué te gusta de Nodus?', '¿Qué crees que debería mejorar?']) {
    assert.ok(feedback.includes(question), `${question} is included in the survey`);
  }
  assert.match(styles, /data-score='0'.+data-score='4'/);
  assert.match(styles, /data-score='5'.+data-score='6'/);
  assert.match(styles, /data-score='7'.+data-score='8'/);
  assert.match(styles, /data-score='9'.+data-score='10'/);
});

test('roadmap follows the requested sequence and is opened from Settings › About', async () => {
  const [roadmap, roadmapSource, app, settings, english] = await Promise.all([
    read('src/views/RoadmapModal.tsx'),
    read('shared/nodiDocumentation.ts'),
    read('src/App.tsx'),
    read('src/views/Settings.tsx'),
    read('src/i18n.en.ts'),
  ]);
  const steps = [
    'Pulido y estabilidad',
    'Servidor',
    'Compartir vaults y trabajo colaborativo',
    'Apps para iOS y iPadOS',
    'Vault de docencia',
    'Vault de fuentes primarias',
    'Vault de testimonios (historia oral)',
    'Vaults sugeridos por usuarios',
    'Vault de prosopografía',
    'Vault de worldbuilding',
    'Nodus Toolkit',
    'Nodus Translate',
    'Nodus Presenter',
    'Nodus OCR Workspace',
  ];
  let previous = -1;
  for (const step of steps) {
    const current = roadmapSource.indexOf(`title: '${step}'`);
    assert.ok(current > previous, `${step} follows the requested order`);
    previous = current;
  }
  assert.match(roadmapSource, /title: 'Pulido y estabilidad'.+status: 'inProgress'/);
  assert.match(roadmapSource, /title: 'Servidor'.+status: 'planned'/);
  assert.match(roadmapSource, /title: 'Compartir vaults y trabajo colaborativo'.+status: 'planned'/);
  assert.match(roadmapSource, /title: 'Apps para iOS y iPadOS'.+status: 'planned'/);
  for (const implemented of [
    'Vault de docencia',
    'Vault de fuentes primarias',
    'Vault de testimonios (historia oral)',
    'Vaults sugeridos por usuarios',
    'Vault de prosopografía',
    'Vault de worldbuilding',
    'Nodus Toolkit',
    'Nodus Translate',
    'Nodus Presenter',
    'Nodus OCR Workspace',
  ]) {
    const itemStart = roadmapSource.indexOf(`title: '${implemented}'`);
    assert.ok(
      itemStart >= 0 && roadmapSource.slice(itemStart, itemStart + 320).includes("status: 'implemented'"),
      `${implemented} is marked as implemented`,
    );
  }
  assert.match(roadmapSource, /children: \[/, 'user-suggested vaults are rendered as a nested group');
  assert.match(roadmapSource, /Implementado: Docencia, Fuentes primarias, Testimonios/, 'implemented vault availability is documented');
  for (const description of [
    'Handy local-first tools for file conversion and document processing, built into Nodus.',
    'Present PDFs and externally authored presentations with presenter view, mobile remote control, speaker notes, and live annotation tools.',
    'AI-powered OCR for scanned PDFs and images, with page-by-page review, text cleanup, reprocessing, and direct integration with your Nodus vaults.',
  ]) {
    assert.ok(english.includes(description), `English roadmap copy is preserved: ${description}`);
  }
  assert.match(roadmap, /NODUS_ROADMAP\.map/);
  assert.match(roadmap, /data-testid="roadmap-cinematic-modal"/);
  assert.match(roadmap, /data-testid="roadmap-status-legend"/);
  assert.match(roadmap, /data-testid="roadmap-user-suggested-vaults"/);
  for (const status of ['planned', 'inProgress', 'implemented']) {
    assert.ok(roadmap.includes(status), `${status} has a visual state`);
  }
  assert.match(app, /import \{ RoadmapModal \}/);
  assert.match(app, /roadmapOpen && <RoadmapModal/);
  // The roadmap left the header rail for Settings › About Nodus; the modal still lives
  // in App, opened through the view context.
  assert.doesNotMatch(app, /label=\{t\('Roadmap'\)\}/);
  assert.match(app, /id: 'act:roadmap'/, 'the command palette still opens the roadmap');
  assert.match(settings, /data-testid="about-roadmap"/);
  assert.match(settings, /data-testid="open-roadmap"[\s\S]{0,200}onClick=\{onOpenRoadmap\}/);

  // Settings is still the rightmost action, and the notification centre sits just left
  // of it — the one place a user can always reach announcements, Nodi enabled or not.
  const notificationsAction = app.lastIndexOf(`label={t('Notificaciones')}`);
  const settingsAction = app.lastIndexOf(`label={t('Ajustes')}`);
  assert.ok(notificationsAction > 0 && settingsAction > notificationsAction, 'Settings is the rightmost action, after Notificaciones');
  assert.match(app.slice(settingsAction, settingsAction + 220), /setView\('settings'\)/);
});
