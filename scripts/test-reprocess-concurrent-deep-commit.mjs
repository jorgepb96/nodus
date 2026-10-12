import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--reprocess-concurrent-deep-commit')) process.exit(0);

// A reprocess pass reads which works hold each idea, spends minutes asking the model for
// themes, then rewrites every idea's theme links. Deep scans keep committing meanwhile: the
// post-batch pass runs while newly queued scans start, and the manual reprocess has no
// guard at all. The links must follow the occurrences as they are when the pass writes.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-reprocess-race-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
try {
  const db = load('electron/db/database.ts').getDb();
  const themes = load('electron/db/themesRepo.ts');
  for (const id of ['w1', 'w2']) {
    db.prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,item_type,source_type,deep_status) VALUES(?,?,?,'[]','book','text','done')").run(id, id.toUpperCase(), `Work ${id}`);
  }
  for (const id of ['shared', 'dropped']) {
    db.prepare("INSERT INTO ideas(global_id,type,label,statement) VALUES(?,'claim',?,?)").run(id, id, `Statement of ${id}`);
    db.prepare("INSERT INTO idea_occurrences(global_id,nodus_id,role,confidence) VALUES(?,'w1','principal',1)").run(id);
    themes.replaceIdeaThemeLinks(id, ['w1'], ['Tema original'], 0.8, 'explicit');
  }

  load('electron/ai/structuredHeadroom.ts').completeJsonWithHeadroom = async request => {
    // While the model answers, two deep scans commit: w2 fuses into `shared`, and a rescan
    // of w1 no longer finds `dropped` (its occurrence and links go, the idea sleeps).
    db.transaction(() => {
      db.prepare("INSERT INTO idea_occurrences(global_id,nodus_id,role,confidence) VALUES('shared','w2','principal',1)").run();
      themes.setIdeaThemeLinks('w2', 'shared', ['Tema original'], 1, 'explicit');
      db.prepare("DELETE FROM idea_occurrences WHERE global_id='dropped'").run();
      db.prepare("DELETE FROM idea_theme_links WHERE global_id='dropped'").run();
      db.prepare("UPDATE ideas SET orphaned_at=? WHERE global_id='dropped'").run(new Date().toISOString());
    })();
    const input = JSON.parse(request.user);
    return { assignments: input.ideas.map(idea => ({ id: idea.id, themes: ['Tema nuevo'] })) };
  };
  const { reprocessConnections } = load('electron/ai/reprocessConnections.ts');
  await reprocessConnections({ relations: false });

  const links = db.prepare(`SELECT l.nodus_id, l.global_id, t.label FROM idea_theme_links l JOIN themes t ON t.theme_id=l.theme_id
    ORDER BY l.global_id, l.nodus_id`).all().map(row => `${row.global_id}@${row.nodus_id}:${row.label}`);
  assert.ok(links.some(link => link.startsWith('shared@w2:')), `the work that fused in meanwhile keeps its theme link (got ${links.join(', ')})`);
  assert.ok(!links.some(link => link.startsWith('dropped@')), `an idea the rescan dropped gets no link back (got ${links.join(', ')})`);
  const hubs = db.prepare("SELECT COUNT(*) n FROM work_themes WHERE nodus_id='w2'").get().n;
  assert.ok(hubs > 0, 'the work that fused in meanwhile gets its theme hub rebuilt');
  console.log('Reprocess writes theme links for the occurrences that exist when it commits.');
} finally {
  load('electron/db/database.ts').closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
