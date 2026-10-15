import type { PassageDetail } from '@shared/types';
import type { ResolvedResearchScope } from '@shared/researchCorpus';
import { getDb } from '../db/database';
import { getPassageDetail } from '../db/passagesRepo';
import { getResearchNotebook, recordResearchScope } from '../db/researchNotebooksRepo';
import { researchCorpusInventory } from '../ai/researchCorpusInventory';
import { assertResearchDocument, assertResearchDocumentPermission, researchFingerprint } from '../ai/researchCorpusScope';
import { resolveResearchNotebook } from '../ai/researchNotebookService';
import { getActiveVault } from '../vaults/vaultRegistry';

type Receipt = { documentId: string; detail: PassageDetail };
type StoredScope = ResolvedResearchScope & { legacyEvidence?: Record<string, Receipt> };

/** Receipts live one per row in `research_scope_receipts`, not in the scope's JSON column, so
 *  recording one costs the receipt rather than a rewrite of the scope's whole document manifest.
 *  There is deliberately no limit: the previous in-JSON store needed one to bound that rewrite
 *  cost, and reaching it refused every passage found afterwards — silently, and for the whole
 *  life of the scope, which starved later runs of all corpus evidence. */

/** Adapt a legacy passage only after its content hash and scoped work match.
 * The immutable receipt lives with the backend scope, never in renderer input or
 * synced chat metadata. Old raw passage URLs remain a compatibility API. */
export function recordScopedLegacyPassage(scope: ResolvedResearchScope, passageId: string, current = researchCorpusInventory().documents, pending?: ScopedReceiptRow[]): PassageDetail | null {
  const detail = getPassageDetail(passageId);
  if (!detail) return null;
  const document = scope.documents.find(item => item.workId === detail.nodus_id);
  if (!document || (document.indexedSource && document.indexedSource.revision !== document.revision)) return null;
  assertResearchDocument(scope, document.id, current.find(item => item.id === document.id));
  return recordScopedSourcePassage(scope, document.id, detail, current, pending);
}

/** Preserve only backend-read bytes; no index or preparation consent is implied. A caller
 * recording several passages in one step may pass the inventory it just read. */
export function recordScopedSourcePassage(scope: ResolvedResearchScope, documentId: string, detail: PassageDetail, current = researchCorpusInventory().documents, pending?: ScopedReceiptRow[]): PassageDetail | null {
  const document = assertResearchDocument(scope, documentId, current.find(item => item.id === documentId));
  if (detail.nodus_id !== (document.workId ?? document.id)) throw new Error('research_source_not_authorized');
  const receipt: Receipt = { documentId: document.id, detail: { ...detail, revision: document.revision } };
  const key = researchFingerprint(receipt);
  recordResearchScope(scope);
  // One row, so the cost is the receipt and not the scope. Recording the same passage twice is
  // the normal case across turns of one conversation and simply keeps the first row.
  const row: ScopedReceiptRow = [scope.id, key, JSON.stringify(receipt), new Date().toISOString()];
  if (pending) pending.push(row); else insertScopedReceipts([row]);
  return { ...receipt.detail, passage_id: `scoped:${scope.id}:${key}` };
}

export type ScopedReceiptRow = [scopeId: string, key: string, receiptJson: string, createdAt: string];
/** A receipt's id is its content hash, known before the row exists, so a caller between searches
 *  may write its receipts later in one transaction. Any commit to the vault changes its
 *  `data_version`, and the vector scan worker then rebuilds every table's vectors before the
 *  next search: a receipt written between two searches of one turn cost the second a rebuild. */
export function insertScopedReceipts(rows: readonly ScopedReceiptRow[]): void {
  if (!rows.length) return;
  const insert = getDb().prepare('INSERT OR IGNORE INTO research_scope_receipts(scope_id,key,receipt_json,created_at) VALUES (?,?,?,?)');
  getDb().transaction(() => { for (const row of rows) insert.run(...row); })();
}

export function getScopedLegacyPassageDetail(id: string): PassageDetail | null {
  const match = /^scoped:([a-f0-9]{64}):([a-f0-9]{64})$/.exec(id);
  if (!match) return null;
  try {
    const row = getDb().prepare('SELECT scope_json FROM research_run_scopes WHERE id=?').get(match[1]) as { scope_json: string } | undefined;
    if (!row) return null;
    const scope: StoredScope = JSON.parse(row.scope_json);
    // The receipt's own row, or — for one written before receipts had their own table — the copy
    // still held inside this scope's JSON. Identical bytes either way, and the fingerprint below
    // is what proves it, so the two sources need no distinguishing afterwards.
    const stored = getDb().prepare('SELECT receipt_json FROM research_scope_receipts WHERE scope_id=? AND key=?')
      .get(match[1], match[2]) as { receipt_json: string } | undefined;
    const receipt: Receipt | undefined = stored ? JSON.parse(stored.receipt_json) : scope.legacyEvidence?.[match[2]];
    if (!receipt || scope.vaultId !== getActiveVault().id || researchFingerprint(receipt) !== match[2]) return null;
    const current = researchCorpusInventory().documents.find(item => item.id === receipt.documentId);
    const document = assertResearchDocumentPermission(scope, receipt.documentId, current);
    if ((document.workId ?? document.id) !== receipt.detail.nodus_id || document.revision !== receipt.detail.revision) return null;
    if (scope.notebookId && getResearchNotebook(scope.notebookId)
      && !resolveResearchNotebook(scope.notebookId).documents.some(item => item.id === document.id)) return null;
    return { ...receipt.detail, passage_id: id, historical: current?.revision !== receipt.detail.revision };
  } catch { return null; }
}
