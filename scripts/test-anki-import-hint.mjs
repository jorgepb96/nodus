// Importing a deck with Anverso/Reverso/Pista fields (Nodus's own export) keeps the hint.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

test('the hint field survives an Anki import', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-anki-hint-'));
  try {
    // better-sqlite3 is built for Electron; node:sqlite stands in for it here.
    const shim = path.join(temp, 'shim.cjs');
    fs.writeFileSync(shim, `const {DatabaseSync}=require('node:sqlite');module.exports=class{constructor(f,o){this.d=new DatabaseSync(f,{readOnly:!!(o&&o.readonly)})}prepare(s){const st=this.d.prepare(s);return{get:(...a)=>st.get(...a),all:(...a)=>st.all(...a),run:(...a)=>st.run(...a)}}exec(s){this.d.exec(s)}close(){this.d.close()}}`);
    const out = path.join(temp, 'anki.cjs');
    await build({ entryPoints: [path.join(root, 'electron/import/ankiApkg.ts')], outfile: out, bundle: true, format: 'cjs', platform: 'node', logLevel: 'error', tsconfig: path.join(root, 'tsconfig.json'),
      plugins: [{ name: 'shim', setup(b) { b.onResolve({ filter: /^better-sqlite3$/ }, () => ({ path: shim })); } }] });
    const { parseAnkiApkg } = require(out);
    const AdmZip = require('adm-zip');
    const file = path.join(temp, 'collection.anki2');
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE col (models text, decks text); CREATE TABLE notes (id integer, mid integer, flds text, tags text); CREATE TABLE cards (nid integer, did integer);');
    db.prepare('INSERT INTO col VALUES (?,?)').run(JSON.stringify({ 11: { id: 11, name: 'Nodus Básico', type: 0, flds: [{ name: 'Anverso', ord: 0 }, { name: 'Reverso', ord: 1 }, { name: 'Pista', ord: 2 }], tmpls: [] } }), JSON.stringify({ 1: { name: 'Nodus' } }));
    db.prepare('INSERT INTO notes VALUES (?,?,?,?)').run(1, 11, ['Front text', 'Back text', 'The hint'].join('\u001f'), '');
    db.prepare('INSERT INTO cards VALUES (?,?)').run(1, 1);
    db.close();
    const zip = new AdmZip(); zip.addFile('collection.anki2', fs.readFileSync(file));
    const card = parseAnkiApkg(zip.toBuffer()).cards[0];
    assert.equal(card.front, 'Front text');
    assert.equal(card.back, 'Back text');
    assert.equal(card.hint, 'The hint');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
