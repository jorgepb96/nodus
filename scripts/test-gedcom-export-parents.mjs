// GEDCOM export must keep both parents of a child when neither is recorded as male.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('both parents appear in the family whatever their recorded sex', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-gedcom-parents-'));
  try {
    const stub = path.join(temp, 'db.mjs');
    fs.writeFileSync(stub, 'export const createPerson=()=>{throw 0}; export const listPersons=()=>[]; export const findOrCreatePlace=()=>{}; export const createEvent=()=>{}; export const listEvents=()=>[]; export const addRelationship=()=>{}; export const allRelationships=()=>[];');
    const out = path.join(temp, 'gedcom.mjs');
    await build({ entryPoints: [path.join(root, 'electron/genealogy/gedcomBridge.ts')], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'error', external: ['electron', 'better-sqlite3'], tsconfig: path.join(root, 'tsconfig.json'),
      plugins: [{ name: 'stub', setup(b) { b.onResolve({ filter: /db\/(entitiesRepo|relationshipsRepo)$/ }, () => ({ path: stub })); } }] });
    const { toGedcomData } = await import(pathToFileURL(out).href);
    const person = (id, sex) => ({ personId: id, displayName: `${id} X`, sex });
    const parent = (from, to) => ({ type: 'parent', fromPerson: from, toPerson: to, subtype: null });
    for (const [a, b] of [['female', 'female'], ['unknown', 'female'], ['male', 'male'], ['male', 'female'], ['unknown', 'unknown']]) {
      const data = toGedcomData([person('pa', a), person('pb', b), person('kid', 'unknown')], [parent('pa', 'kid'), parent('pb', 'kid')], []);
      assert.equal(data.families.length, 1);
      const family = data.families[0];
      const parents = [family.husband, family.wife].filter(Boolean).sort();
      assert.equal(parents.length, 2, `${a}+${b}: both parents exported (${JSON.stringify(family)})`);
      assert.notEqual(family.husband, family.wife);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
