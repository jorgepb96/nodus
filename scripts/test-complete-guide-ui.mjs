// Complete study guide in the reader and composer: callouts render as labelled cards
// (and ordinary quotes stay quotes), guide citation links keep their locator and item,
// and the Deep Research view wires the guide mode, gallery filter and Materials entry.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const entry = `
  import { createElement } from 'react';
  import { renderToStaticMarkup } from 'react-dom/server';
  import ReactMarkdown from 'react-markdown';
  import remarkGfm from 'remark-gfm';
  import remarkMath from 'remark-math';
  import { remarkGuideCallouts } from './src/components/markdownCallouts';
  export async function render(markdown) {
    return renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkMath, remarkGuideCallouts], urlTransform: (value) => value }, markdown));
  }
`;
const built = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'cjs', platform: 'node' });
const module = { exports: {} };
new Function('module', 'exports', 'require', built.outputFiles[0].text)(module, module.exports, require_);
const { render } = module.exports;

test('guide callouts become labelled cards; AI boxes keep their own class; plain quotes stay quotes', async () => {
  const html = await render([
    '> [!definition] Definición · Presión',
    '> Fuerza por unidad de superficie, $P = F/A$.',
    '>',
    '> [A1 · p. 2](nodus://study/material/m?page=2&e=K0001)',
    '',
    '> [!ai-example] Ejemplo elaborado por IA',
    '> Un globo al sol.',
    '',
    '> [!note] Not a guide callout',
    '',
    '> Una cita normal.',
  ].join('\n'));
  assert.match(html, /<aside class="guide-callout guide-callout-definition" data-callout="definition">\s*<div class="guide-callout-title">Definición · Presión<\/div>/);
  assert.match(html, /Fuerza por unidad de superficie/);
  assert.match(html, /href="nodus:\/\/study\/material\/m\?page=2&amp;e=K0001"/);
  assert.match(html, /guide-callout-ai-example/);
  assert.match(html, /<blockquote>\s*<p>\[!note\] Not a guide callout<\/p>/, 'unknown kinds are left as quotes');
  assert.match(html, /<blockquote>\s*<p>Una cita normal\.<\/p>/);
});

test('the reader parses guide locators and routes evidence before opening', () => {
  const source = fs.readFileSync('src/components/Markdown.tsx', 'utf8');
  assert.match(source, /import 'katex\/contrib\/mhchem';/);
  assert.match(source, /remarkPlugins=\{\[remarkGfm, remarkMath, remarkGuideCallouts\]\}/);
  assert.match(source, /pageNumber: number\('page'\), slideNumber: number\('slide'\)/);
  assert.match(source, /evidence && onGuideEvidence \? onGuideEvidence\(evidence, open\) : open\(\)/);
  assert.match(source, /study\\\/doc\|note\)\\\/\(\[\^\?\]\+\)/, 'note ids stop at the query string');
  assert.match(fs.readFileSync('vite.config.ts', 'utf8'), /dedupe: \['katex'\]/, 'one KaTeX instance so \\ce{} renders');
  assert.match(fs.readFileSync('src/index.css', 'utf8'), /\.md \.guide-callout \{/);
});

test('the Deep Research view offers the guide mode only in Study vaults and wires every surface', () => {
  const view = fs.readFileSync('src/views/DeepResearchView.tsx', 'utf8');
  assert.match(view, /const guideMode = isStudy && !isTeaching && studyReportMode === 'complete_guide';/);
  assert.match(view, /studyReportMode=\{isStudy && !isTeaching \? studyReportMode : undefined\}/);
  assert.match(view, /completeGuide: \{\n\s+version: 1,\n\s+runId: `cg-\$\{crypto\.randomUUID\(\)\}`/);
  assert.match(view, /aiExamples: guideState\.aiExamples/);
  assert.match(view, /guide && isStudy && !isTeaching[\s\S]{0,200}setStudyReportMode\('complete_guide'\)/, '"Crear otra versión" restores the guide');
  assert.match(view, /testId="deep-research-kind-filter"/);
  assert.match(view, /CompleteGuideCoveragePanel meta=\{saved\.draft\.completeGuide\}/);
  assert.match(view, /CompleteGuideEvidenceDialog/);
  const study = fs.readFileSync('src/app/views/study.tsx', 'utf8');
  assert.match(study, /onCreateStudyGuide=\{ctx\.isDocencia \? undefined : \(sourceKeys\) => \{/);
  assert.match(study, /completeGuideTarget=\{ctx\.completeGuideTarget\}/);
  assert.match(fs.readFileSync('src/views/StudyMaterialsView.tsx', 'utf8'), /data-testid="study-library-create-guide"/);
});
