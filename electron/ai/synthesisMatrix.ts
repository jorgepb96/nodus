// Synthesis Matrix ("Matriz de síntesis") — the classic literature-review matrix
// every thesis supervisor asks for: rows = authors, columns = themes, each cell =
// the ideas that author develops on that theme. Reading a column tells you who
// engages a theme (and lets you spot agreement/tension at a glance); reading a
// row tells you one author's spread. The grid of counts + idea labels is pure DB
// and instant; the one-sentence per-cell "stance" is an on-demand, cached AI pass.
import { createHash } from 'crypto';
import type {
  IdeaType,
  ModelRef,
  SynthesisMatrix,
  SynthesisMatrixAuthor,
  SynthesisMatrixCell,
  SynthesisMatrixCellIdea,
  SynthesisMatrixTheme,
  PromptLanguage,
} from '@shared/types';
import { getDb } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import { completeJson } from './aiClient';
import { synthesisPromptPack } from '@shared/synthesisPromptPacks';

// The grid focuses on the most substantive authors/themes so it stays legible
// and cheap to render; a thesis corpus can otherwise be hundreds × dozens.
const MAX_AUTHORS = 40;
const MAX_THEMES = 24;
const MAX_IDEAS_PER_CELL = 8;
const STATEMENT_CLIP = 200;

function clip(value: string, max: number): string {
  const clean = (value || '').replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}…`;
}

function cellFingerprint(ideaIds: string[]): string {
  return createHash('sha1').update([...ideaIds].sort().join(',')).digest('hex').slice(0, 16);
}

/** Authors × themes matrix with idea counts/labels and any cached (fresh) stances. */
export function buildSynthesisMatrix(): SynthesisMatrix {
  const db = getDb();

  // Author footprint (distinct ideas) → pick the most substantive authors.
  const authorRows = db
    .prepare(
      `SELECT wa.author_id AS id, a.name AS name,
              COUNT(DISTINCT wa.nodus_id) AS workCount,
              COUNT(DISTINCT io.global_id) AS ideaCount
         FROM work_attributions wa
         JOIN authors a ON a.author_id = wa.author_id
         JOIN works w ON w.nodus_id = wa.nodus_id AND w.archived = 0
         JOIN idea_occurrences io ON io.nodus_id = wa.nodus_id
        GROUP BY wa.author_id
        ORDER BY ideaCount DESC, name`
    )
    .all() as { id: string; name: string; workCount: number; ideaCount: number }[];
  const authors: SynthesisMatrixAuthor[] = authorRows
    .slice(0, MAX_AUTHORS)
    .map((a) => ({ author_id: a.id, name: a.name, workCount: a.workCount }));
  const authorIds = new Set(authors.map((a) => a.author_id));

  // Themes ranked by idea-link volume → the columns worth showing.
  const themeRows = db
    .prepare(
      `SELECT t.theme_id AS id, t.label AS label, COUNT(*) AS n
         FROM idea_theme_links itl
         JOIN themes t ON t.theme_id = itl.theme_id
        GROUP BY t.theme_id
        ORDER BY n DESC, label`
    )
    .all() as { id: string; label: string; n: number }[];
  const themes: SynthesisMatrixTheme[] = themeRows
    .slice(0, MAX_THEMES)
    .map((t) => ({ theme_id: t.id, label: t.label }));
  const themeIds = new Set(themes.map((t) => t.theme_id));

  if (authors.length === 0 || themes.length === 0) {
    return { authors, themes, cells: [] };
  }

  // Every (author, theme, idea) tuple, restricted to the shown rows/columns.
  const rows = db
    .prepare(
      `SELECT DISTINCT wa.author_id AS authorId, itl.theme_id AS themeId,
              i.global_id AS gid, i.label AS label, i.type AS type
         FROM work_attributions wa
         JOIN works w ON w.nodus_id = wa.nodus_id AND w.archived = 0
         JOIN idea_theme_links itl ON itl.nodus_id = wa.nodus_id
         JOIN ideas i ON i.global_id = itl.global_id`
    )
    .all() as { authorId: string; themeId: string; gid: string; label: string; type: IdeaType }[];

  const cellMap = new Map<string, { ideas: Map<string, SynthesisMatrixCellIdea> }>();
  for (const r of rows) {
    if (!authorIds.has(r.authorId) || !themeIds.has(r.themeId)) continue;
    const key = `${r.authorId}::${r.themeId}`;
    const cur = cellMap.get(key) ?? { ideas: new Map<string, SynthesisMatrixCellIdea>() };
    if (!cur.ideas.has(r.gid)) cur.ideas.set(r.gid, { global_id: r.gid, label: r.label, type: r.type });
    cellMap.set(key, cur);
  }

  // Cached stances, kept only when the cell's idea set is unchanged.
  const stanceRows = db
    .prepare('SELECT author_id, theme_id, stance, fingerprint FROM synthesis_matrix_cell')
    .all() as { author_id: string; theme_id: string; stance: string; fingerprint: string }[];
  const stanceByKey = new Map<string, { author_id: string; theme_id: string; stance: string; fingerprint: string }>(
    stanceRows.map((s) => [`${s.author_id}::${s.theme_id}`, s])
  );

  const cells: SynthesisMatrixCell[] = [];
  for (const [key, value] of cellMap) {
    const [authorId, themeId] = key.split('::');
    const allIdeas = [...value.ideas.values()];
    const cached = stanceByKey.get(key);
    const fresh = cached && cached.fingerprint === cellFingerprint(allIdeas.map((i) => i.global_id));
    cells.push({
      authorId,
      themeId,
      ideaCount: allIdeas.length,
      ideas: allIdeas.slice(0, MAX_IDEAS_PER_CELL),
      stance: fresh ? cached!.stance : null,
    });
  }

  return { authors, themes, cells };
}

interface StanceResponse {
  stance: string;
}

function isStanceResponse(v: unknown): v is StanceResponse {
  return !!v && typeof v === 'object' && typeof (v as Record<string, unknown>).stance === 'string';
}

/** Generate and cache the one-sentence stance for a single author×theme cell. */
export function prepareMatrixCellSynthesis(
  authorId: string,
  themeId: string,
  language?:PromptLanguage
) {
  const db = getDb();
  const author = db.prepare('SELECT name FROM authors WHERE author_id = ?').get(authorId) as { name: string } | undefined;
  const theme = db.prepare('SELECT label FROM themes WHERE theme_id = ?').get(themeId) as { label: string } | undefined;
  if (!author || !theme) throw new Error('Autor o tema no encontrado');

  const ideaRows = db
    .prepare(
      `SELECT DISTINCT i.global_id AS global_id, i.label AS label, i.type AS type, i.statement AS statement
         FROM work_attributions wa
         JOIN works w ON w.nodus_id = wa.nodus_id AND w.archived = 0
         JOIN idea_theme_links itl ON itl.nodus_id = wa.nodus_id
         JOIN ideas i ON i.global_id = itl.global_id
        WHERE wa.author_id = ? AND itl.theme_id = ?`
    )
    .all(authorId, themeId) as { global_id: string; label: string; type: IdeaType; statement: string }[];

  const ideaBlock = ideaRows.map((i) => `  - ${i.label}: ${clip(i.statement, STATEMENT_CLIP)}`).join('\n');
  const prompt = synthesisPromptPack(language??getSettings().promptLanguage ?? 'es');
  const system = prompt.matrixSystem;
  const user = `${prompt.matrixAuthor}: ${author.name}\n${prompt.matrixTheme}: ${theme.label}\n\n${prompt.matrixIdeas}:\n${ideaBlock}\n\n${prompt.matrixReturn}`;

  return {authorId,themeId,ideas:ideaRows,fingerprint:cellFingerprint(ideaRows.map(i=>i.global_id)),prompt:{system,user,temperature:0.2}};
}

export function saveMatrixCellSynthesisResponse(authorId:string,themeId:string,response:unknown,chosen:ModelRef|null,fingerprint:string,generatedAt=new Date().toISOString()):SynthesisMatrixCell{
  if(!isStanceResponse(response))throw new Error('invalid_matrix_synthesis');
  const source=prepareMatrixCellSynthesis(authorId,themeId);
  if(source.fingerprint!==fingerprint)throw new Error('stale_matrix_synthesis');
  const ideaRows=source.ideas,result=response,db=getDb();
  const stance = result.stance.trim();

  db.prepare(
    `INSERT INTO synthesis_matrix_cell (author_id, theme_id, stance, model_json, fingerprint, generated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(author_id, theme_id) DO UPDATE SET
       stance = excluded.stance,
       model_json = excluded.model_json,
       fingerprint = excluded.fingerprint,
       generated_at = excluded.generated_at`
  ).run(authorId, themeId, stance, chosen ? JSON.stringify(chosen) : null, fingerprint, generatedAt);

  return {
    authorId,
    themeId,
    ideaCount: ideaRows.length,
    ideas: ideaRows.slice(0, MAX_IDEAS_PER_CELL).map((i) => ({ global_id: i.global_id, label: i.label, type: i.type })),
    stance,
  };
}

export async function synthesizeMatrixCell(authorId:string,themeId:string,model?:ModelRef|null):Promise<SynthesisMatrixCell>{
  const source=prepareMatrixCellSynthesis(authorId,themeId);
  if(!source.ideas.length)return {authorId,themeId,ideaCount:0,ideas:[],stance:null};
  const chosen=model??getSettings().synthesisModel??null;
  const result=await completeJson<StanceResponse>(source.prompt,isStanceResponse,chosen);
  return saveMatrixCellSynthesisResponse(authorId,themeId,result,chosen,source.fingerprint);
}
