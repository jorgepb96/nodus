// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * Small, DOM-free helpers shared by the Chrome popup and Nodus Browser review
 * dialog. Page metadata is only a suggestion: these functions turn the creator
 * list into something a person can edit and back into the Library shape.
 */

/** English default for the one label this module can generate on its own. */
export const METADATA_LABELS = Object.freeze({ untitledDocument: 'Untitled document' });

function clean(value, limit = 1_000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

export function formatCreators(creators) {
  return (creators || []).map((creator) => (
    (clean(creator?.name) ? `{${clean(creator?.name)}}` : '')
    || [clean(creator?.lastName), clean(creator?.firstName)].filter(Boolean).join(', ')
  )).filter(Boolean).join('\n');
}

export function parseCreators(value, limit = 128) {
  return String(value || '').split(/\r?\n|\s*;\s*/).map((entry) => clean(entry)).filter(Boolean)
    .slice(0, limit).map((name) => {
      const institution = /^\{(.+)\}$/.exec(name);
      if (institution) return { creatorType: 'author', name: clean(institution[1]), fieldMode: 1 };
      const comma = /^([^,]+),\s*(.+)$/.exec(name);
      if (comma) {
        return { creatorType: 'author', firstName: clean(comma[2], 500), lastName: clean(comma[1], 500), fieldMode: 0 };
      }
      const parts = name.split(/\s+/).filter(Boolean);
      if (parts.length > 1) {
        return { creatorType: 'author', firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1), fieldMode: 0 };
      }
      return { creatorType: 'author', name, fieldMode: 1 };
    });
}

export function applyMetadataEdits(metadata, edits, labels = METADATA_LABELS) {
  const title = clean(edits?.title, 10_000) || clean(metadata?.title, 10_000) || labels.untitledDocument;
  const doi = clean(edits?.doi, 1_000).replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/i, '').replace(/[.,;)]+$/g, '');
  const date = clean(edits?.date, 200);
  const publicationTitle = clean(edits?.publicationTitle, 2_000);
  return {
    ...(metadata || {}),
    title,
    creators: String(edits?.creators || '').trim() === formatCreators(metadata?.creators).trim()
      ? (metadata?.creators || []).map((creator) => ({ ...creator }))
      : parseCreators(edits?.creators).map((creator, index, parsed) => {
      const originals = metadata?.creators || [];
      const matching = originals.find((original) => formatCreators([original]) === formatCreators([creator]));
      const previous = matching || (parsed.length === originals.length ? originals[index] : null);
      return previous?.creatorType ? { ...creator, creatorType: previous.creatorType } : creator;
    }),
    ...(date ? { date } : { date: undefined }),
    year: /(?:^|\D)(1[0-9]{3}|20[0-9]{2}|2100)(?:\D|$)/.test(date)
      ? Number(/(?:^|\D)(1[0-9]{3}|20[0-9]{2}|2100)(?:\D|$)/.exec(date)[1])
      : null,
    ...(publicationTitle ? { publicationTitle } : { publicationTitle: undefined }),
    ...(doi ? { doi } : { doi: undefined }),
  };
}
