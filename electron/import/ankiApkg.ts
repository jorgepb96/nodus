import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';
import type { StudyFlashcard, StudyFlashcardInput } from '@shared/studyFlashcards';

/**
 * Anki `.apkg` support.
 *
 * Export writes a genuine legacy package (SQLite collection + media map) that Anki,
 * AnkiDroid and most Anki-compatible apps import directly. Import reads the collection,
 * resolves each note through its model so field order and cloze models are honoured, and
 * returns plain flashcard inputs. Scheduling state is intentionally not carried over:
 * a Nodus card starts its own SM-2 history.
 */

const ANKI_SCHEMA = `
CREATE TABLE col (
  id integer primary key, crt integer not null, mod integer not null, scm integer not null,
  ver integer not null, dty integer not null, usn integer not null, ls integer not null,
  conf text not null, models text not null, decks text not null, dconf text not null, tags text not null
);
CREATE TABLE notes (
  id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null,
  tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null
);
CREATE TABLE cards (
  id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null,
  usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null,
  factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null,
  odid integer not null, flags integer not null, data text not null
);
CREATE TABLE revlog (
  id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null,
  lastIvl integer not null, factor integer not null, time integer not null, type integer not null
);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn ON notes (usn);
CREATE INDEX ix_cards_usn ON cards (usn);
CREATE INDEX ix_cards_nid ON cards (nid);
CREATE INDEX ix_cards_sched ON cards (did, queue, due);
CREATE INDEX ix_revlog_usn ON revlog (usn);
CREATE INDEX ix_revlog_cid ON revlog (cid);
`;

const ANKI_CSS = '.card{font-family:arial;font-size:20px;text-align:center;color:black;background-color:white;}';

function fieldChecksum(value: string): number {
  const digest = crypto.createHash('sha1').update(value, 'utf8').digest('hex').slice(0, 8);
  return Number.parseInt(digest, 16);
}

interface AnkiField { name: string; ord: number }
interface AnkiTemplate { name: string; ord: number; qfmt: string; afmt: string }
interface AnkiModel { id: number; name: string; type: number; flds: AnkiField[]; tmpls: AnkiTemplate[]; css?: string }

function ankiModelModels(timestampSeconds: number): Record<string, AnkiModel> {
  const basic: AnkiModel = {
    id: timestampSeconds + 1, name: 'Nodus Básico', type: 0,
    flds: [
      { name: 'Anverso', ord: 0 }, { name: 'Reverso', ord: 1 }, { name: 'Pista', ord: 2 },
    ],
    tmpls: [{ name: 'Tarjeta 1', ord: 0, qfmt: '{{Anverso}}', afmt: '{{FrontSide}}<hr id=answer>{{Reverso}}' }],
    css: ANKI_CSS,
  };
  const cloze: AnkiModel = {
    id: timestampSeconds + 2, name: 'Nodus Huecos', type: 1,
    flds: [{ name: 'Texto', ord: 0 }],
    tmpls: [{ name: 'Huecos', ord: 0, qfmt: '{{cloze:Texto}}', afmt: '{{cloze:Texto}}' }],
    css: ANKI_CSS,
  };
  return { [String(basic.id)]: basic, [String(cloze.id)]: cloze };
}

function buildCollectionDatabase(cards: StudyFlashcardInput[]): Database.Database {
  const db = new Database(':memory:');
  db.exec(ANKI_SCHEMA);
  const timestampSeconds = Math.floor(Date.now() / 1000);
  const timestampMs = Date.now();
  const deckId = 1;
  const models = ankiModelModels(timestampSeconds);
  const basicModel = models[String(timestampSeconds + 1)];
  const clozeModel = models[String(timestampSeconds + 2)];
  const decks = {
    [String(deckId)]: {
      id: deckId, name: 'Nodus', mod: timestampMs, usn: -1, desc: '', dyn: 0, collapsed: false,
      browserCollapsed: false, conf: 1, extendNew: 10, extendRev: 50,
    },
  };
  const conf = {
    nextPos: 1, estTimes: true, activeDecks: [deckId], sortType: 'noteFld', timeLimit: 0, sortBackwards: false,
    addToCur: true, curDeck: deckId, newBury: true, newSpread: 0, dueCounts: true, curModel: null, collapseTime: 1200,
  };
  const dconf = {
    '1': {
      id: 1, name: 'Default', mod: timestampMs, usn: -1, maxTaken: 60, autoplay: true, timer: 0, replayq: true,
      new: { delays: [1, 10], ints: [1, 4, 7], initialFactor: 2500, separate: true, order: 1, perDay: 20 },
      rev: { perDay: 200, ease4: 1.3, ivlFct: 1, maxIvl: 36500, hardFactor: 1.2, bury: true, minSpace: 1 },
      lapse: { delays: [10], leechFails: 8, minInt: 1, leechAction: 0, mult: 0 },
      dyn: false,
    },
  };
  db.prepare('INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(timestampMs, timestampSeconds, timestampMs, timestampMs, 11, 0, -1, 0,
      JSON.stringify(conf), JSON.stringify(models), JSON.stringify(decks), JSON.stringify(dconf), '{}');
  const insertNote = db.prepare('INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  const insertCard = db.prepare('INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  cards.forEach((card, index) => {
    const timestamp = timestampMs + index;
    const isCloze = card.type === 'cloze' && /\{\{c\d+::.+?\}\}/.test(card.front);
    const model = isCloze ? clozeModel : basicModel;
    const fields = isCloze
      ? [card.front]
      : [card.front, card.back, card.hint ?? ''];
    const tagList = (card.tags ?? []).map((tag) => tag.replace(/\s+/g, '_')).filter(Boolean);
    insertNote.run(
      timestamp, crypto.randomBytes(8).toString('hex'), model.id, timestampSeconds, -1,
      tagList.length ? ` ${tagList.join(' ')} ` : '', fields.join('\u001f'), fields[0], fieldChecksum(fields[0]), 0, '',
    );
    insertCard.run(timestamp + 1, timestamp, deckId, 0, timestampSeconds, -1, 0, 0, index, 0, 0, 0, 0, 0, 0, 0, 0, '');
  });
  return db;
}

export function buildAnkiApkg(cards: StudyFlashcardInput[], options: { deckName?: string } = {}): Buffer {
  const db = buildCollectionDatabase(cards);
  try {
    if (options.deckName?.trim()) {
      const decks = JSON.parse(String((db.prepare('SELECT decks FROM col LIMIT 1').get() as { decks: string }).decks)) as Record<string, { name: string }>;
      if (decks['1']) decks['1'].name = options.deckName.trim();
      db.prepare('UPDATE col SET decks = ?').run(JSON.stringify(decks));
    }
    const bytes = db.serialize();
    const zip = new AdmZip();
    zip.addFile('collection.anki2', bytes);
    zip.addFile('media', Buffer.from('{}', 'utf8'));
    return zip.toBuffer();
  } finally {
    db.close();
  }
}

interface AnkiNoteRow { id: number; mid: number; flds: string; tags: string }
interface AnkiCardRow { nid: number; did: number }

export function parseAnkiApkg(bytes: Buffer): { cards: StudyFlashcardInput[]; warnings: string[] } {
  const warnings: string[] = [];
  const zip = new AdmZip(bytes);
  const entries = zip.getEntries();
  const collectionEntry = entries.find((entry) => /^collection\.anki2$/i.test(entry.entryName))
    ?? entries.find((entry) => /^collection\.anki21$/i.test(entry.entryName));
  if (!collectionEntry) {
    if (entries.some((entry) => /^collection\.anki21b$/i.test(entry.entryName))) {
      throw new Error('Este paquete de Anki usa el formato comprimido nuevo (anki21b). Exporta desde Anki con "Compatible con versiones anteriores".');
    }
    throw new Error('El paquete de Anki no contiene una colección válida.');
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-anki-'));
  const filePath = path.join(directory, 'collection.anki2');
  fs.writeFileSync(filePath, collectionEntry.getData());
  const db = new Database(filePath, { readonly: true });
  try {
    const modelsRow = db.prepare('SELECT models FROM col LIMIT 1').get() as { models?: string } | undefined;
    const models = modelsRow?.models ? JSON.parse(modelsRow.models) as Record<string, AnkiModel> : {};
    const notes = db.prepare('SELECT id, mid, flds, tags FROM notes').all() as unknown as AnkiNoteRow[];
    const cardRows = db.prepare('SELECT nid, did FROM cards').all() as unknown as AnkiCardRow[];
    const decksRow = db.prepare('SELECT decks FROM col LIMIT 1').get() as { decks?: string } | undefined;
    const decks = decksRow?.decks ? JSON.parse(decksRow.decks) as Record<string, { name?: string }> : {};
    const deckNameByNote = new Map<number, string>();
    for (const card of cardRows) {
      const name = decks[String(card.did)]?.name;
      if (name && !deckNameByNote.has(card.nid)) deckNameByNote.set(card.nid, name);
    }
    const fieldsOf = (note: AnkiNoteRow): { front: string; back: string; hint: string; type: StudyFlashcardInput['type'] } => {
      const fields = String(note.flds).split('\u001f');
      const model = models[String(note.mid)];
      if (model?.type === 1) {
        const clozeAnswers = [...fields[0].matchAll(/\{\{c\d+::(.+?)\}\}/g)].map((match) => match[1]);
        return { front: fields[0], back: clozeAnswers.join(' · '), hint: '', type: 'cloze' };
      }
      if (model?.flds?.length) {
        const ordered = [...model.flds].sort((left, right) => left.ord - right.ord);
        const frontIndex = ordered.findIndex((field) => /front|anverso|pregunta|question/i.test(field.name));
        const backIndex = ordered.findIndex((field) => /back|reverso|respuesta|answer|definici/i.test(field.name));
        if (frontIndex >= 0 && backIndex >= 0 && frontIndex !== backIndex) {
          // Nodus's own export writes Anverso/Reverso/Pista; dropping the third field lost
          // every hint on a round trip.
          const hintIndex = ordered.findIndex((field, index) => index !== frontIndex && index !== backIndex && /pista|hint|extra/i.test(field.name));
          return { front: fields[frontIndex] ?? '', back: fields[backIndex] ?? '', hint: hintIndex >= 0 ? fields[hintIndex] ?? '' : '', type: 'front_back' };
        }
      }
      return { front: fields[0] ?? '', back: fields.slice(1).filter(Boolean).join('\n'), hint: fields[2] ?? '', type: 'front_back' };
    };
    const cards: StudyFlashcardInput[] = [];
    for (const note of notes) {
      const parsed = fieldsOf(note);
      const front = parsed.front.trim();
      const back = parsed.back.trim();
      if (!front || !back) { warnings.push(`Nota de Anki omitida por no tener anverso o reverso.`); continue; }
      cards.push({
        type: parsed.type, front, back, hint: parsed.hint,
        tags: String(note.tags ?? '').trim() ? String(note.tags).trim().split(/\s+/).filter(Boolean) : [],
        difficulty: 'medium',
        sourceExcerpt: deckNameByNote.get(note.id) ? `Mazo: ${deckNameByNote.get(note.id)}` : '',
      });
    }
    return { cards, warnings };
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

export function apkgCardsForExport(items: Array<StudyFlashcard | StudyFlashcardInput>): StudyFlashcardInput[] {
  return items.map((card) => ({
    type: card.type ?? 'front_back', front: card.front, back: card.back, hint: (card as StudyFlashcard).hint ?? '',
    tags: card.tags ?? [], difficulty: (card as StudyFlashcard).difficulty ?? 'medium',
    sourceExcerpt: (card as StudyFlashcard).sourceExcerpt ?? '',
  }));
}
