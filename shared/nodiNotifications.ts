/**
 * The catalogue of notifications Nodi's centre can show, as a translation key plus
 * the values that go into it.
 *
 * Notifications used to be stored as finished prose: the emitter read the UI language
 * and rendered the sentence right there. That freezes the language of whichever vault
 * happened to be open, because the notification store is a single global file while
 * `uiLanguage` is a per-vault setting — open a Spanish vault, drain the queue, switch
 * to an English one and the centre still holds Spanish. The renderer could not recover
 * it either: `tr()` only knows the Spanish keys of its own tables, and a sentence with
 * an interpolated count ("102 tareas completadas y 183 con errores.") can never match
 * one, so it either fell back to a generic "this message could not be translated" or
 * leaked Spanish verbatim when the heuristic failed to recognise it.
 *
 * A key survives all of that. The panel translates it with `tx()` every time it paints,
 * in the language that is active now, and the values stay outside the translated text.
 */

/**
 * A value substituted into a notification. `{ datetime }` carries an ISO timestamp
 * that the renderer formats in the reader's locale — a date rendered by the emitter
 * would freeze its format the same way the prose froze its language.
 */
export type NodiNotificationParam = string | number | { datetime: string };

/**
 * Spanish source strings, keyed by id. The values are what the renderer hands to
 * `tx()`, so they are ordinary translation keys: scripts/test-i18n-coverage.mjs reads
 * this table and demands a translation for every one of them in every language.
 */
export const NODI_NOTIFICATION_TEXT = {
  welcomeTitle: '¡Hola! Soy Nodi',
  welcomeBody: 'Tu nodo acompañante. Haz clic en mí para abrir el chat, tus notificaciones y la ayuda.',
  scanQueueDoneTitle: 'Cola de análisis completada',
  scanQueueDoneBody: '{done} tareas completadas. El conocimiento de la bóveda está actualizado.',
  scanQueueFailedTitle: 'La cola de análisis ha terminado con incidencias',
  scanQueueFailedBody: '{done} tareas completadas y {failed} con errores.',
  graphMaintenanceFailedTitle: 'El postprocesado del grafo está pendiente',
  graphMaintenanceFailedBody: 'Error: {error}',
  connectionsTitle: 'Nuevas conexiones en tu bóveda',
  connectionsBody: '{relations} relaciones y {themes} temas nuevos detectados.',
  graphRepairedTitle: 'Se ha reparado el grafo',
  graphRepairedThemesBody: '{works} obra(s) perdieron los temas de algunas ideas por un fallo de versiones anteriores. Puedes reasignarlos en Temas principales o en Ajustes.',
  radarUpdatesTitle: 'Nodus Radar ha encontrado novedades',
  radarUpdatesBody: 'Actualizaciones de investigación listas para revisar: {count}.',
  bridgesTitle: 'Nodi ha encontrado relaciones semánticas',
  bridgesBody: '{added} conexiones nuevas tras revisar {scanned} candidatos.',
  ideaEmbeddingsFailedTitle: 'La indexación semántica necesita atención',
  ideaEmbeddingsDoneTitle: 'Embeddings de ideas completados',
  ideaEmbeddingsDoneBody: '{ideas} ideas indexadas en {works} obra(s).',
  passageEmbeddingsFailedTitle: 'La indexación de textos necesita atención',
  passageEmbeddingsDoneTitle: 'Índice de textos completado',
  passageEmbeddingsDoneBody: '{passages} fragmentos indexados en {works} obra(s).',
  deepResearchMcpDoneTitle: 'Informe de Deep Research listo',
  deepResearchMcpDoneBody: '«{title}» se pidió desde un cliente MCP y ya está en tu galería.',
  deepResearchMcpFailedTitle: 'Un informe de Deep Research ha fallado',
  deepResearchMcpFailedBody: 'No se pudo generar «{title}», pedido desde un cliente MCP.',
  podcastDoneTitle: 'Podcast listo',
  podcastDoneBody: '«{title}» ya se puede escuchar en Podcast.',
  podcastFailedTitle: 'Un podcast ha fallado',
  podcastFailedBody: 'No se pudo generar «{title}». Puedes reintentarlo desde la cola sin repetir lo ya hecho.',
  podcastReviewTitle: 'Guion listo para revisar',
  podcastReviewBody: 'El guion de «{title}» espera tu revisión antes de grabarse.',
  studyCalendarTitle: '📅 {title}',
  studyCalendarBody: 'Comienza el {when}.',
  studyCalendarBodyWithDetail: 'Comienza el {when}. {detail}',
  studyCalendarLateBody: 'Aviso mostrado con retraso. Estaba previsto para el {when}.',
  studyCalendarLateBodyWithDetail: 'Aviso mostrado con retraso. Estaba previsto para el {when}. {detail}',
} as const;

export type NodiNotificationTextId = keyof typeof NODI_NOTIFICATION_TEXT;

/** One translatable line of a notification: a catalogue id and its values. */
export interface NodiNotificationText {
  id: NodiNotificationTextId;
  params?: Record<string, NodiNotificationParam>;
}

/** Build a notification line with its id checked against the catalogue. */
export function nodiText(
  id: NodiNotificationTextId,
  params?: Record<string, NodiNotificationParam>
): NodiNotificationText {
  return params ? { id, params } : { id };
}

/**
 * A stable identity for deduplication, derived from the key and its values rather
 * than from rendered prose (which changes with the language and so would let the same
 * notification through twice).
 */
export function nodiTextSignature(text: NodiNotificationText): string {
  const params = text.params ?? {};
  const values = Object.keys(params).sort().map((name) => {
    const value = params[name];
    return [name, typeof value === 'object' ? value.datetime : value];
  });
  return values.length ? `${text.id}:${JSON.stringify(values)}` : text.id;
}
