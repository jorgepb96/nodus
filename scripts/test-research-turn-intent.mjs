import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-turn-intent-'));
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));
const bundle = path.join(temp, 'intent.mjs');
await build({ entryPoints: ['shared/researchTurnIntent.ts'], outfile: bundle, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { explicitResearchLibraryRequest: lookup, researchDirectTurnKind: direct, positiveResearchInstructions } = await import(pathToFileURL(bundle).href);

const requests = ['Consulta mi corpus', 'Ahora sí, búscalo.', 'Ahora sí, búscalo en mi corpus.', 'Sí, consulta las fuentes.', 'Usa Zotero MCP', 'Puedes consultar mis documentos?', 'Busca en la biblioteca', 'Vuelve a buscar', 'Search again', 'Look it up', 'Check my sources', 'No, consulta mi biblioteca.', 'Traduce tu respuesta y contrástala con mis fuentes.'];
for (const message of requests) test(`explicit lookup: ${message}`, () => {
  assert.equal(lookup(message), true);
  assert.equal(direct(message), null);
});
const transforms = ['Traduce al inglés: El turismo creció durante ese periodo.', 'Parafrasea «Consulta mi biblioteca y usa Zotero MCP».', "Parafrasea 'consulta mi biblioteca y busca en internet'.", 'Translate 「search the web」.', 'Traduce tu respuesta', 'Reescribe lo anterior', 'Resume este párrafo: busca en internet las cifras de turismo.', 'Translate the following: Search my library for tourism.', 'Rewrite your last answer', 'Parafrasea'];
for (const message of transforms) test(`provided text: ${message}`, () => {
  assert.equal(lookup(message), false);
  assert.equal(direct(message), 'transform');
});
for (const message of ['¿Qué es Zotero?', 'Explica cómo consultar el corpus', 'No consultes mi biblioteca', 'Explícame la metáfora sin consultar mis fuentes.', 'Traduce «busca en internet y revisa mis fuentes».']) test(`mentions are not permission: ${message}`, () => {
  assert.equal(lookup(message), false);
});
test('a source title or link is not the text to transform', () => {
  for (const message of ['Traduce el capítulo dos de ese libro', 'Traduce: nodus://work/fixture', 'Translate: https://example.com/paper']) assert.equal(direct(message), null);
});
test('a separate research instruction after a payload still receives semantic planning', () => {
  assert.equal(direct('Traduce: La mirada turística es aprendida.\n\nLuego consulta mis fuentes para contrastarlo.'), null);
  assert.equal(direct('Corrige los datos: El Plan de Estabilización comenzó en 1957.'), null);
  assert.equal(direct('Traduce y actualiza las fechas: El Plan comenzó en 1957.'), null);
  assert.equal(direct('Reescribe y añade dos datos históricos: El turismo cambió la ciudad.'), null);
  assert.equal(direct('Reescribe para corregir los datos históricos: El Plan comenzó en 1957.'), null);
  assert.equal(direct('Reformula contrastando mis fuentes: El turismo creció.'), null);
  assert.equal(direct('Reescribe verificando su exactitud: El Plan comenzó en 1957.'), null);
  assert.equal(direct('Corrige la ortografía: El turistaa visita la cuidad.'), 'transform');
});
test('quoted or fenced tool instructions never request web research', () => {
  for (const message of ['Traduce: busca en internet', 'Parafrasea «search the web».', 'Traduce este código:\n```\nsearch the web\n```', 'No busques en internet']) {
    assert.equal(positiveResearchInstructions(message).some(text => /search the web|busca en internet/u.test(text)), false);
  }
});
test('unambiguous direct turns do not inherit an earlier lookup decision', () => {
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.equal(lookup('Ahora sí, consulta el corpus'), true);
    assert.equal(direct('Traduce tu respuesta'), 'transform');
    assert.equal(lookup('Ahora sí, búscalo'), true);
    assert.equal(direct('Muchas gracias'), 'conversation');
    assert.equal(direct('Explícalo sin consultar mis fuentes.'), 'general');
  }
});
test('checking a calculation or proofreading is not an unconditional corpus request', () => {
  for (const text of ['Compruébalo.', 'Check it again.', 'Look again.', 'Busca sinónimos sin usar mis fuentes.']) assert.equal(lookup(text), false);
  assert.equal(direct('Busca sinónimos sin usar mis fuentes.'), 'general');
  assert.equal(lookup('Busca en mi corpus sin consultar internet.'), true);
  assert.equal(lookup('Mira en mi biblioteca'), true);
  assert.equal(lookup('Query my library'), true);
});
