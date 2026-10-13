import { app } from 'electron';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ArchiveDateCertainty } from '@shared/archiveTypes';
import type { ArchiveItemKind } from '@shared/types';
import { getActiveVault } from '../vaults/vaultRegistry';
import { getDb } from './database';
import { getSettings, updateSettings } from './settingsRepo';
import { recordPrimarySourceLocalMetric } from './primarySourceMetricsRepo';

const PREFIX = 'demo-ps-';
const ID = {
  repository: `${PREFIX}repository`,
  fonds: `${PREFIX}fonds`,
  seriesCorrespondence: `${PREFIX}series-correspondence`,
  seriesCommunity: `${PREFIX}series-community`,
  session: `${PREFIX}capture-session`,
  folder: `${PREFIX}working-collection`,
  personClara: `${PREFIX}person-clara`,
  personElias: `${PREFIX}person-elias`,
  personInes: `${PREFIX}person-ines`,
  placeSevilla: `${PREFIX}place-sevilla`,
  placeCarmona: `${PREFIX}place-carmona`,
  placeEcija: `${PREFIX}place-ecija`,
  placeSanMartin: `${PREFIX}place-san-martin`,
  eventAssembly: `${PREFIX}event-assembly`,
  eventFlood: `${PREFIX}event-flood`,
  relationship: `${PREFIX}relationship-correspondence`,
  noteInterpretation: `${PREFIX}note-interpretation`,
  noteContradiction: `${PREFIX}note-contradiction`,
} as const;

type DemoLocale = 'es' | 'en';
type Copy = { es: string; en: string };

const text = (locale: DemoLocale, copy: Copy): string => copy[locale];
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const DEMO_ASSET_DIR = path.join(app.getAppPath(), 'electron', 'assets', 'primary-sources-demo');
const ASSET_CACHE = new Map<string, Buffer>();

function locale(): DemoLocale {
  return getSettings().uiLanguage === 'es' ? 'es' : 'en';
}

function demoAsset(fileName: string): Buffer {
  const cached = ASSET_CACHE.get(fileName);
  if (cached) return cached;
  const bytes = fs.readFileSync(path.join(DEMO_ASSET_DIR, fileName));
  ASSET_CACHE.set(fileName, bytes);
  return bytes;
}

type DemoSource = {
  suffix: string;
  title: Copy;
  docType: string;
  dateDisplay: Copy;
  dateStart: string | null;
  dateEnd: string | null;
  dateCertainty: ArchiveDateCertainty;
  seriesId: string;
  reference: string;
  kind: ArchiveItemKind;
  fileName: string | null;
  mimeType: string | null;
  content: Buffer | null;
  description: Copy;
  metadata: Record<string, string>;
  access?: 'open' | 'private' | 'restricted' | 'unknown';
  sensitivity?: 'normal' | 'personal' | 'sensitive' | 'highly_sensitive';
};

function creatorFor(source: DemoSource, L: DemoLocale): string {
  const creators: Record<string, Copy> = {
    letter: { es: 'Clara Montes (persona ficticia)', en: 'Clara Montes (fictional person)' },
    minutes: { es: 'Secretaría de la cooperativa ficticia', en: 'Fictional cooperative secretariat' },
    photograph: { es: 'Autoría no identificada', en: 'Unidentified creator' },
    newspaper: { es: 'Redacción ficticia de La Voz del Valle', en: 'Fictional Valley Voice editorial office' },
    map: { es: 'Comisión vecinal ficticia', en: 'Fictional neighbourhood committee' },
    register: { es: 'Cooperativa vecinal ficticia', en: 'Fictional village cooperative' },
    'located-only': { es: 'Autoría por determinar', en: 'Creator to be determined' },
    restricted: { es: 'Junta ficticia de asistencia', en: 'Fictional relief board' },
    receipt: { es: 'Taller ficticio de carpintería', en: 'Fictional carpentry workshop' },
    'margin-note': { es: 'Mano no identificada', en: 'Unidentified hand' },
  };
  return text(L, creators[source.suffix]);
}

function tagsFor(source: DemoSource, L: DemoLocale): string[] {
  const common = text(L, { es: 'demo ficticia', en: 'fictional demo' });
  const topic = source.suffix === 'letter' || source.suffix === 'minutes' || source.suffix === 'receipt'
    ? text(L, { es: 'respuesta a la crecida', en: 'flood response' })
    : source.docType;
  return [common, topic, source.dateStart?.slice(0, 4) ?? text(L, { es: 'sin fecha', en: 'undated' })];
}

function sources(L: DemoLocale): DemoSource[] {
  return [
    {
      suffix: 'letter', title: { es: 'Carta de Clara Montes a Inés Vidal', en: 'Letter from Clara Montes to Inés Vidal' },
      docType: 'letter', dateDisplay: { es: 'primavera de 1894', en: 'spring 1894' },
      dateStart: '1894-03-01', dateEnd: '1894-05-31', dateCertainty: 'circa',
      seriesId: ID.seriesCorrespondence, reference: 'FCA/COR/001', kind: 'image',
      fileName: 'carta-clara-hoja-1.webp', mimeType: 'image/webp', content: demoAsset('letter-page-1.webp'),
      description: { es: 'Carta manuscrita sobre ayuda tras una crecida y una reunión vecinal.', en: 'Handwritten letter about relief after a flood and a neighbourhood meeting.' },
      metadata: {
        remitente: text(L, { es: 'Clara Montes', en: 'Clara Montes' }),
        destinatario: text(L, { es: 'Inés Vidal', en: 'Inés Vidal' }),
        fecha: '1894-05-14',
        lugar: text(L, { es: 'Aldea Clara', en: 'Clear Village' }),
        resumen: text(L, { es: 'Ayuda tras una crecida y reunión vecinal.', en: 'Relief after a flood and a neighbourhood meeting.' }),
      },
    },
    {
      suffix: 'minutes', title: { es: 'Acta de la asamblea del molino', en: 'Minutes of the mill assembly' },
      docType: 'acta_de_asociacion_sociedad', dateDisplay: { es: '17 de abril de 1894', en: '17 April 1894' },
      dateStart: '1894-04-17', dateEnd: '1894-04-17', dateCertainty: 'exact',
      seriesId: ID.seriesCommunity, reference: 'FCA/COM/002', kind: 'text',
      fileName: 'acta-asamblea.txt', mimeType: 'text/plain',
      content: Buffer.from(text(L, {
        es: 'Acta. Comparecen Clara Montes, Inés Vidal y Elías N. Se acuerda repartir harina. La fecha marginal parece decir 18, no 17.',
        en: 'Minutes. Clara Montes, Inés Vidal and Elías N. attend. Flour is to be distributed. The marginal date appears to say 18, not 17.',
      })),
      description: { es: 'Acta con una fecha marginal contradictoria.', en: 'Minutes containing a contradictory marginal date.' },
      metadata: {
        asunto: text(L, { es: 'Reparto de harina tras la crecida', en: 'Flour distribution after the flood' }),
        organismo: text(L, { es: 'Cooperativa de Aldea Clara', en: 'Clear Village Cooperative' }),
        fecha: '1894-04-17',
        personas_implicadas: 'Clara Montes, Inés Vidal, Elías N.',
        lugar: text(L, { es: 'Molino de Aldea Clara', en: 'Clear Village mill' }),
        referencia: 'FCA/COM/002',
      },
    },
    {
      suffix: 'photograph', title: { es: 'Fotografía del taller comunitario', en: 'Photograph of the community workshop' },
      docType: 'photograph', dateDisplay: { es: 'hacia 1895', en: 'circa 1895' },
      dateStart: '1894-01-01', dateEnd: '1896-12-31', dateCertainty: 'circa',
      seriesId: ID.seriesCommunity, reference: 'FCA/COM/003', kind: 'image',
      fileName: 'taller-comunitario.webp', mimeType: 'image/webp', content: demoAsset('workshop-photograph.webp'),
      description: { es: 'Cinco figuras no identificadas; la demo no usa reconocimiento facial.', en: 'Five unidentified figures; the demo does not use facial recognition.' },
      metadata: {
        personas: text(L, { es: 'Cinco personas no identificadas', en: 'Five unidentified people' }),
        fecha: '1895-01-01',
        lugar: text(L, { es: 'Taller comunitario', en: 'Community workshop' }),
        fotografo: text(L, { es: 'Autoría no identificada', en: 'Unidentified creator' }),
        ocasion: text(L, { es: 'Trabajo comunitario', en: 'Community work' }),
      },
    },
    {
      suffix: 'newspaper', title: { es: 'Página de prensa: La Voz del Valle', en: 'Newspaper page: The Valley Voice' },
      docType: 'recorte_de_hemeroteca_noticia_de_periodi', dateDisplay: { es: '3 de febrero de 1895', en: '3 February 1895' },
      dateStart: '1895-02-03', dateEnd: '1895-02-03', dateCertainty: 'exact',
      seriesId: ID.seriesCommunity, reference: 'FCA/COM/004', kind: 'image',
      fileName: 'voz-del-valle-1895.webp', mimeType: 'image/webp', content: demoAsset('valley-voice-newspaper.webp'),
      description: { es: 'Página ficticia con OCR automático y una versión revisada.', en: 'Fictional page with automatic OCR and a reviewed version.' },
      metadata: {
        titular: text(L, { es: 'La crecida moviliza al valle', en: 'Flood mobilises the valley' }),
        publicacion: text(L, { es: 'La Voz del Valle', en: 'The Valley Voice' }),
        fecha: '1895-02-03',
        lugar: text(L, { es: 'Sevilla', en: 'Seville' }),
        resumen: text(L, { es: 'Página ficticia con OCR revisado.', en: 'Fictional page with reviewed OCR.' }),
      },
    },
    {
      suffix: 'map', title: { es: 'Croquis del camino del río', en: 'Sketch map of the river road' },
      docType: 'map', dateDisplay: { es: 'sin fecha [c. 1894]', en: 'undated [c. 1894]' },
      dateStart: '1893-01-01', dateEnd: '1895-12-31', dateCertainty: 'uncertain',
      seriesId: ID.seriesCommunity, reference: 'FCA/COM/Δ-1895/07', kind: 'image',
      fileName: 'croquis-rio.webp', mimeType: 'image/webp', content: demoAsset('river-road-sketch-map.webp'),
      description: { es: 'El topónimo «San Martín» permanece ambiguo.', en: 'The place-name “San Martín” remains ambiguous.' },
      metadata: {
        titulo: text(L, { es: 'Croquis del camino del río', en: 'Sketch map of the river road' }),
        autor: text(L, { es: 'Comisión vecinal ficticia', en: 'Fictional neighbourhood committee' }),
        anio: 'c. 1894',
        lugar: 'San Martín',
        escala: text(L, { es: 'Sin escala', en: 'No scale' }),
      },
    },
    {
      suffix: 'register', title: { es: 'Registro de entregas de harina', en: 'Flour delivery register' },
      docType: 'administrative', dateDisplay: { es: '1894–1895', en: '1894–1895' },
      dateStart: '1894-01-01', dateEnd: '1895-12-31', dateCertainty: 'between',
      seriesId: ID.seriesCommunity, reference: 'FCA/COM/006', kind: 'image',
      fileName: 'registro-entregas.webp', mimeType: 'image/webp', content: demoAsset('flour-delivery-register.webp'),
      description: { es: 'Registro seriado con menciones personales.', en: 'Serial register containing personal mentions.' },
      metadata: {
        tipo_tramite: text(L, { es: 'Entrega de suministros', en: 'Supply distribution' }),
        organismo: text(L, { es: 'Cooperativa vecinal ficticia', en: 'Fictional village cooperative' }),
        fecha: '1894-01-01',
        personas_implicadas: text(L, { es: 'Familias receptoras de harina', en: 'Families receiving flour' }),
        referencia: 'FCA/COM/006',
      },
      access: 'private', sensitivity: 'personal',
    },
    {
      suffix: 'located-only', title: { es: 'Referencia a un cuaderno no digitalizado', en: 'Reference to an undigitised notebook' },
      docType: 'other_doc', dateDisplay: { es: 'Año de la gran crecida (hacia 1894)', en: 'Year of the great flood (circa 1894)' },
      dateStart: '1893-01-01', dateEnd: '1895-12-31', dateCertainty: 'circa',
      seriesId: ID.seriesCorrespondence, reference: 'FCA/COR/007', kind: 'other',
      fileName: null, mimeType: null, content: null,
      description: { es: 'Fuente localizada y descrita, todavía sin imagen.', en: 'Located and described source, not yet digitised.' },
      metadata: {
        descripcion: text(L, { es: 'Cuaderno localizado pendiente de digitalización.', en: 'Located notebook awaiting digitisation.' }),
        fecha: '1894-01-01',
        lugar: text(L, { es: 'Aldea Clara', en: 'Clear Village' }),
        referencia: 'FCA/COR/007',
      },
    },
    {
      suffix: 'restricted', title: { es: 'Expediente ficticio restringido', en: 'Fictional restricted case file' },
      docType: 'administrative', dateDisplay: { es: '1901', en: '1901' },
      dateStart: '1901-01-01', dateEnd: '1901-12-31', dateCertainty: 'exact',
      seriesId: ID.seriesCommunity, reference: 'FCA/COM/R-008', kind: 'text',
      fileName: 'expediente-restringido.txt', mimeType: 'text/plain',
      content: Buffer.from('DEMO-RESTRICTED-CONTENT: fictional and intentionally blocked.'),
      description: { es: 'Ejercicio ficticio para probar restricciones; no contiene datos reales.', en: 'Fictional exercise for testing restrictions; contains no real data.' },
      metadata: {
        tipo_tramite: text(L, { es: 'Expediente de asistencia', en: 'Relief case file' }),
        organismo: text(L, { es: 'Junta ficticia de asistencia', en: 'Fictional relief board' }),
        fecha: '1901-01-01',
        personas_implicadas: text(L, { es: 'Identidades ficticias restringidas', en: 'Restricted fictional identities' }),
        referencia: 'FCA/COM/R-008',
      },
      access: 'restricted', sensitivity: 'highly_sensitive',
    },
    {
      suffix: 'receipt', title: { es: 'Recibo de materiales para el puente', en: 'Receipt for bridge materials' },
      docType: 'carta_de_pago_recibo_de_deuda', dateDisplay: { es: 'mayo de 1894', en: 'May 1894' },
      dateStart: '1894-05-01', dateEnd: '1894-05-31', dateCertainty: 'between',
      seriesId: ID.seriesCommunity, reference: 'FCA/COM/009', kind: 'text',
      fileName: 'recibo-puente.txt', mimeType: 'text/plain',
      content: Buffer.from(text(L, { es: 'Madera, clavos y cuerda. Recibido por I. Vidal.', en: 'Timber, nails and rope. Received by I. Vidal.' })),
      description: { es: 'Recibo breve relacionado con la reparación del puente.', en: 'Short receipt related to repairing the bridge.' },
      metadata: {
        otorgantes: text(L, { es: 'Taller de carpintería e Inés Vidal', en: 'Carpentry workshop and Inés Vidal' }),
        fecha: '1894-05-01',
        lugar: text(L, { es: 'Aldea Clara', en: 'Clear Village' }),
        escribano: text(L, { es: 'No consta', en: 'Not recorded' }),
        referencia: 'FCA/COM/009',
      },
    },
    {
      suffix: 'margin-note', title: { es: 'Nota marginal sobre la fecha de la asamblea', en: 'Marginal note on the assembly date' },
      docType: 'notes', dateDisplay: { es: 'posterior a abril de 1894', en: 'after April 1894' },
      dateStart: '1894-04-18', dateEnd: null, dateCertainty: 'after',
      seriesId: ID.seriesCorrespondence, reference: 'FCA/COR/010', kind: 'text',
      fileName: 'nota-marginal.txt', mimeType: 'text/plain',
      content: Buffer.from(text(L, { es: 'La reunión fue el día dieciocho; el acta quedó fechada por error.', en: 'The meeting was on the eighteenth; the minutes were dated incorrectly.' })),
      description: { es: 'Testimonio que contradice la fecha principal del acta.', en: 'Testimony contradicting the main date in the minutes.' },
      metadata: {
        autor: text(L, { es: 'Mano no identificada', en: 'Unidentified hand' }),
        fecha: '1894-04-18',
        tema: text(L, { es: 'Corrección de la fecha de la asamblea', en: 'Correction to the assembly date' }),
        contenido: text(L, { es: 'La reunión fue el día dieciocho.', en: 'The meeting was on the eighteenth.' }),
      },
    },
  ];
}

export function hasPrimarySourcesDemoBlockingData(): boolean {
  const db = getDb();
  const value = db.prepare(
    `SELECT
      (SELECT COUNT(*) FROM archive_items)
      + (SELECT COUNT(*) FROM archive_description_units)
      + (SELECT COUNT(*) FROM persons)
      + (SELECT COUNT(*) FROM primary_source_note_profiles) AS value`
  ).get() as { value: number };
  return Number(value.value) > 0;
}

export function seedPrimarySourcesDemoData(): boolean {
  if (getActiveVault().type !== 'primary_sources' || hasPrimarySourcesDemoBlockingData()) return false;
  const started = performance.now();
  const db = getDb();
  const L = locale();
  const now = new Date().toISOString();
  const demoSources = sources(L);

  db.transaction(() => {
    db.prepare(
      `INSERT INTO archive_repositories (
        repository_id, name, short_name, identifier, country_code, access_notes,
        citation_template, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'ZZ', ?, ?, ?, ?)`
    ).run(
      ID.repository,
      text(L, { es: 'Archivo Comunitario de Aldea Clara', en: 'Clear Village Community Archive' }),
      'ACA',
      'DEMO-ACA',
      text(L, { es: 'Repositorio completamente ficticio.', en: 'Entirely fictional repository.' }),
      '{repository}, {reference}, {title}, {date}, {locator}',
      now,
      now,
    );

    const insertUnit = db.prepare(
      `INSERT INTO archive_description_units (
        unit_id, repository_id, parent_unit_id, level, reference_code, title,
        title_type, date_display, date_start_sort, date_end_sort, date_certainty,
        creator_display, extent_display, scope_content, language_codes_json,
        script_codes_json, position, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'supplied', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertUnit.run(
      ID.fonds, ID.repository, null, 'fonds', 'FCA',
      text(L, { es: 'Fondo Cooperativa de Aldea Clara', en: 'Clear Village Cooperative Fonds' }),
      '1893–1902', '1893-01-01', '1902-12-31', 'between',
      text(L, { es: 'Cooperativa vecinal ficticia', en: 'Fictional village cooperative' }),
      text(L, { es: '1 fondo', en: '1 fonds' }),
      text(L, { es: 'Documentación ficticia sobre correspondencia y vida comunitaria.', en: 'Fictional documentation about correspondence and community life.' }),
      JSON.stringify(['es']), JSON.stringify(['Latn']), 0, JSON.stringify({ demo: true }), now, now,
    );
    insertUnit.run(
      ID.seriesCorrespondence, ID.repository, ID.fonds, 'series', 'FCA/COR',
      text(L, { es: 'Correspondencia y memorias', en: 'Correspondence and memories' }),
      '1894–1898', '1894-01-01', '1898-12-31', 'between', null,
      text(L, { es: '3 unidades', en: '3 units' }),
      text(L, { es: 'Cartas, notas y referencias sin digitalizar.', en: 'Letters, notes and undigitised references.' }),
      JSON.stringify(['es', 'ar']), JSON.stringify(['Latn', 'Arab']), 0, JSON.stringify({ demo: true }), now, now,
    );
    insertUnit.run(
      ID.seriesCommunity, ID.repository, ID.fonds, 'series', 'FCA/COM',
      text(L, { es: 'Administración y vida comunitaria', en: 'Administration and community life' }),
      '1894–1901', '1894-01-01', '1901-12-31', 'between', null,
      text(L, { es: '7 unidades', en: '7 units' }),
      text(L, { es: 'Actas, prensa, imagen, mapa y registros.', en: 'Minutes, press, image, map and registers.' }),
      JSON.stringify(['es']), JSON.stringify(['Latn']), 1, JSON.stringify({ demo: true }), now, now,
    );
    db.prepare(
      `INSERT INTO archive_capture_sessions (
        session_id, repository_id, title, session_kind, started_on, ended_on,
        researcher, device, fonds_scope, reference_scope, reproduction_terms,
        naming_pattern, notes, created_at, updated_at
      ) VALUES (?, ?, ?, 'digitization', '2026-01-10', '2026-01-10', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      ID.session, ID.repository,
      text(L, { es: 'Lote demo · páginas de correspondencia', en: 'Demo batch · correspondence pages' }),
      text(L, { es: 'Investigadora ficticia', en: 'Fictional researcher' }),
      'Nodus demo scanner',
      'FCA/COR',
      '001–010',
      text(L, { es: 'Solo para demostración; no redistribuir el expediente restringido.', en: 'Demonstration only; do not redistribute the restricted case file.' }),
      'FCA_COR_{sequence}',
      text(L, { es: 'Todos los materiales y nombres son ficticios.', en: 'All materials and names are fictional.' }),
      now,
      now,
    );
    db.prepare(
      'INSERT INTO archive_folders (folder_id, name, parent_id, created_at) VALUES (?, ?, NULL, ?)'
    ).run(
      ID.folder,
      text(L, { es: 'Crecida y respuesta comunitaria', en: 'Flood and community response' }),
      now,
    );

    const insertItem = db.prepare(
      `INSERT INTO archive_items (
        item_id, folder_id, title, kind, file_name, mime_type, bytes, blob,
        extracted_text, description, source, content_hash, doc_type, metadata_json,
        created_at, updated_at
      ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertItemUnit = db.prepare(
      `INSERT INTO archive_item_units (item_id, unit_id, relation_kind, position, created_at)
       VALUES (?, ?, 'describes', 0, ?)`
    );
    const insertProfile = db.prepare(
      `INSERT INTO archive_item_profiles (
        item_id, date_certainty, access_status, sensitivity, processing_status,
        description_status, analysis_status, citation_status, capture_session_id,
        metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'ready', 'described', 'reviewed', ?, ?, ?, ?, ?)`
    );
    const insertFile = db.prepare(
      `INSERT INTO archive_item_files (
        file_id, item_id, parent_file_id, role, version_no, sequence_no, page_label,
        original_file_name, mime_type, byte_size, content_blob, external_path,
        content_hash, hash_algorithm, transformation_json, capture_metadata_json,
        created_by, created_at, verified_at, verification_status, superseded_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, NULL, ?, 'sha256', ?, ?, 'demo_fixture', ?, ?, ?, NULL)`
    );

    for (let index = 0; index < demoSources.length; index += 1) {
      const source = demoSources[index];
      const itemId = `${PREFIX}item-${source.suffix}`;
      const unitId = `${PREFIX}unit-${source.suffix}`;
      const bytes = source.content?.byteLength ?? 0;
      const digest = source.content ? sha256(source.content) : null;
      insertUnit.run(
        unitId, ID.repository, source.seriesId, 'item', source.reference,
        text(L, source.title), text(L, source.dateDisplay), source.dateStart, source.dateEnd,
        source.dateCertainty, creatorFor(source, L),
        source.content ? text(L, { es: '1 unidad digital', en: '1 digital unit' }) : text(L, { es: 'sin copia digital', en: 'no digital copy' }),
        text(L, source.description), JSON.stringify(['es']), JSON.stringify(['Latn']),
        index, JSON.stringify({ demo: true, fictional: true }), now, now,
      );
      db.prepare(
        `UPDATE archive_description_units SET
          arrangement=?, administrative_biographical_history=?, custodial_history=?,
          acquisition_info=?, access_conditions=?, reproduction_conditions=?,
          physical_characteristics=?, finding_aids=?, related_units=?
         WHERE unit_id=?`
      ).run(
        text(L, { es: 'Orden original simulado por serie y signatura.', en: 'Simulated original order by series and reference code.' }),
        text(L, { es: 'Productor y contexto enteramente ficticios, creados para ejercitar la descripción archivística.', en: 'Entirely fictional creator and context, made to exercise archival description.' }),
        text(L, { es: 'Cadena de custodia didáctica: generación sintética, ingreso local y verificación de checksum.', en: 'Teaching chain of custody: synthetic generation, local ingest, and checksum verification.' }),
        text(L, { es: 'Ingreso ficticio por transferencia de la cooperativa demo.', en: 'Fictional transfer from the demo cooperative.' }),
        source.access === 'restricted'
          ? text(L, { es: 'Acceso restringido en la demo para comprobar permisos.', en: 'Restricted in the demo to test permissions.' })
          : text(L, { es: 'Consulta abierta; material sintético sin valor histórico.', en: 'Open consultation; synthetic material with no historical value.' }),
        text(L, { es: 'Reproducción permitida únicamente como demostración de producto.', en: 'Reproduction permitted solely as a product demonstration.' }),
        source.content
          ? text(L, { es: 'Representación digital sintética; revisar texto alternativo y checksum.', en: 'Synthetic digital representation; review alternative text and checksum.' })
          : text(L, { es: 'Sin representación digital; descripción basada en un apunte ficticio de consulta.', en: 'No digital representation; description based on a fictional consultation note.' }),
        text(L, { es: 'Inventario demo integrado en Nodus.', en: 'Demo inventory integrated into Nodus.' }),
        text(L, { es: 'Véase la colección de trabajo «Crecida y respuesta comunitaria».', en: 'See the “Flood and community response” working collection.' }),
        unitId,
      );
      insertItem.run(
        itemId, text(L, source.title), source.kind, source.fileName, source.mimeType,
        bytes, source.content, text(L, source.description),
        `${ID.repository} · ${source.reference}`, digest, source.docType,
        JSON.stringify({ demo: true, fictional: true, ...source.metadata }), now, now,
      );
      insertItemUnit.run(itemId, unitId, now);
      insertProfile.run(
        itemId, source.dateCertainty, source.access ?? 'open', source.sensitivity ?? 'normal',
        source.suffix === 'letter' || source.suffix === 'minutes' ? 'ready' : 'general_locator',
        ID.session, JSON.stringify({ demo: true, fictional: true }), now, now,
      );
      db.prepare(
        `UPDATE archive_item_profiles SET rights_statement=?, reproduction_conditions=?,
          metadata_json=? WHERE item_id=?`
      ).run(
        text(L, { es: 'Documento ficticio generado para la demo; no es una fuente histórica.', en: 'Fictional document generated for the demo; it is not a historical source.' }),
        text(L, { es: 'Uso libre para probar la interfaz local de Nodus.', en: 'Free to use for testing the local Nodus interface.' }),
        JSON.stringify({
          demo: true,
          fictional: true,
          coverage: 'enriched',
          functions: ['archive', 'map', 'timeline', 'relations', 'text', 'evidence', 'integrity', 'citations'],
        }),
        itemId,
      );
      db.prepare(
        'INSERT INTO archive_item_folders (item_id, folder_id) VALUES (?, ?)'
      ).run(itemId, ID.folder);
      for (const tag of tagsFor(source, L)) {
        db.prepare(
          'INSERT OR IGNORE INTO archive_item_tags (item_id, tag) VALUES (?, ?)'
        ).run(itemId, tag);
      }
      if (source.content) {
        insertFile.run(
          `${PREFIX}file-${source.suffix}-master`, itemId, null, 'master', 0, '1',
          source.fileName, source.mimeType, bytes, source.content, digest, null,
          JSON.stringify({
            demo: true,
            alternativeText: text(L, source.description),
            fictional: true,
            synthetic: source.mimeType?.startsWith('image/') === true,
            generationDisclosure: source.mimeType?.startsWith('image/')
              ? 'AI-generated fictional demo facsimile; not historical evidence.'
              : undefined,
          }),
          now, now, source.suffix === 'map' ? 'mismatch' : 'verified',
        );
      }
    }

    // The letter is a three-page batch. Each page is an immutable master and page
    // one also has a documented access derivative.
    for (let page = 2; page <= 3; page += 1) {
      const bytes = demoAsset(`letter-page-${page}.webp`);
      insertFile.run(
        `${PREFIX}file-letter-page-${page}`, `${PREFIX}item-letter`, null, 'master',
        page - 1, String(page), `carta-clara-hoja-${page}.webp`, 'image/webp',
        bytes.byteLength, bytes, sha256(bytes), null,
        JSON.stringify({
          demo: true,
          fictional: true,
          synthetic: true,
          generationDisclosure: 'AI-generated fictional demo facsimile; not historical evidence.',
          alternativeText: text(L, {
            es: `Carta manuscrita ficticia, hoja ${page}`,
            en: `Fictional handwritten letter, page ${page}`,
          }),
        }),
        now, now, 'verified',
      );
    }
    const accessCopy = demoAsset('letter-page-1.webp');
    insertFile.run(
      `${PREFIX}file-letter-access`, `${PREFIX}item-letter`, `${PREFIX}file-letter-master`,
      'access', 0, '1', 'carta-clara-acceso.webp', 'image/webp',
      accessCopy.byteLength, accessCopy, sha256(accessCopy),
      JSON.stringify({ operation: 'demo_access_copy', sourcePreserved: true }),
      JSON.stringify({
        demo: true,
        fictional: true,
        synthetic: true,
        generationDisclosure: 'AI-generated fictional demo facsimile; not historical evidence.',
        alternativeText: text(L, demoSources[0].description),
      }),
      now, now, 'verified',
    );

    const insertText = db.prepare(
      `INSERT INTO archive_text_versions (
        text_version_id, item_id, file_id, parent_version_id, kind, language_code,
        content, status, engine, model, confidence, editorial_conventions,
        created_by, created_at, updated_at, reviewed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`
    );
    const letterText = text(L, {
      es: 'A mi estimada Inés:\\nLa crecida dañó el puente. Elías N. trajo cuerda. Nos reuniremos el diecisiete, si el tiempo lo permite.\\nClara',
      en: 'My dear Inés,\\nThe flood damaged the bridge. Elías N. brought rope. We shall meet on the seventeenth, weather permitting.\\nClara',
    });
    insertText.run(
      `${PREFIX}text-letter-diplomatic`, `${PREFIX}item-letter`, `${PREFIX}file-letter-master`,
      null, 'diplomatic', L, letterText, 'reviewed', 'human_demo', 1,
      text(L, { es: 'Ortografía y saltos preservados; [ilegible] marcaría lagunas.', en: 'Spelling and line breaks preserved; [illegible] would mark gaps.' }),
      'demo_researcher', now, now, now,
    );
    const pressAutomatic = text(L, {
      es: 'LA VOZ DEL VALLE. La asamblea se celebró el 17. La ayuda partió de Sevilla hacia las localidades del valle. إعلان تجاري [OCR dudoso].',
      en: 'THE VALLEY VOICE. The assembly was held on the 17th. Relief departed from Seville for the valley towns. إعلان تجاري [uncertain OCR].',
    });
    insertText.run(
      `${PREFIX}text-press-auto`, `${PREFIX}item-newspaper`, `${PREFIX}file-newspaper-master`,
      null, 'ocr', 'mul', pressAutomatic, 'automatic', 'demo_ocr', 0.72, null,
      'demo_fixture', now, now, null,
    );
    const pressReviewed = pressAutomatic.replace(
      L === 'es' ? 'el 17' : 'the 17th',
      L === 'es' ? 'el 18 [corrección editorial]' : 'the 18th [editorial correction]',
    );
    insertText.run(
      `${PREFIX}text-press-reviewed`, `${PREFIX}item-newspaper`, `${PREFIX}file-newspaper-master`,
      `${PREFIX}text-press-auto`, 'ocr', 'mul', pressReviewed, 'reviewed',
      'human_review', 0.98,
      text(L, { es: 'La corrección no sustituye la versión automática.', en: 'The correction does not replace the automatic version.' }),
      'demo_researcher', now, now, now,
    );
    insertText.run(
      `${PREFIX}text-located-transcription`, `${PREFIX}item-located-only`, null,
      null, 'transcription', L,
      text(L, {
        es: '[Transcripción parcial tomada durante la consulta] Se menciona una reunión en San Martín.',
        en: '[Partial transcription made during consultation] A meeting at San Martín is mentioned.',
      }),
      'in_review', 'human_demo', 0.9, null, 'demo_researcher', now, now, null,
    );

    const insertSegment = db.prepare(
      `INSERT INTO archive_text_segments (
        segment_id, text_version_id, file_id, sequence_no, page_label,
        start_offset, end_offset, content, bbox_json, confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)`
    );
    const thirds = [
      [0, Math.ceil(letterText.length / 3)],
      [Math.ceil(letterText.length / 3), Math.ceil(letterText.length * 2 / 3)],
      [Math.ceil(letterText.length * 2 / 3), letterText.length],
    ];
    for (let page = 1; page <= 3; page += 1) {
      const [start, end] = thirds[page - 1];
      insertSegment.run(
        `${PREFIX}segment-letter-${page}`, `${PREFIX}text-letter-diplomatic`,
        page === 1 ? `${PREFIX}file-letter-master` : `${PREFIX}file-letter-page-${page}`,
        page - 1, String(page), start, end, letterText.slice(start, end), now, now,
      );
    }

    const insertExcerpt = db.prepare(
      `INSERT INTO archive_excerpts (
        excerpt_id, item_id, file_id, text_version_id, segment_id,
        locator_display, locator_json, quoted_text, language_code, description,
        review_status, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reviewed', 'demo_researcher', ?, ?)`
    );
    insertExcerpt.run(
      `${PREFIX}excerpt-letter`, `${PREFIX}item-letter`, `${PREFIX}file-letter-master`,
      `${PREFIX}text-letter-diplomatic`, `${PREFIX}segment-letter-2`,
      text(L, { es: 'hoja 2, líneas 1–3', en: 'page 2, lines 1–3' }),
      JSON.stringify({ page: 2, textRange: { start: thirds[1][0], end: thirds[1][1] } }),
      text(L, { es: 'Elías N. trajo cuerda.', en: 'Elías N. brought rope.' }), L,
      text(L, { es: 'Mención de una identidad aún provisional.', en: 'Mention of an identity that remains provisional.' }),
      now, now,
    );
    insertExcerpt.run(
      `${PREFIX}excerpt-minutes`, `${PREFIX}item-minutes`, `${PREFIX}file-minutes-master`,
      null, null, text(L, { es: 'párrafo 2', en: 'paragraph 2' }),
      JSON.stringify({ page: 1 }),
      text(L, { es: 'Se acuerda repartir harina el día diecisiete.', en: 'Flour is to be distributed on the seventeenth.' }),
      L, text(L, { es: 'Fecha principal del acta.', en: 'Main date in the minutes.' }), now, now,
    );
    insertExcerpt.run(
      `${PREFIX}excerpt-margin`, `${PREFIX}item-margin-note`, `${PREFIX}file-margin-note-master`,
      null, null, text(L, { es: 'línea única', en: 'single line' }),
      JSON.stringify({ page: 1 }),
      text(L, { es: 'La reunión fue el día dieciocho.', en: 'The meeting was on the eighteenth.' }),
      L, text(L, { es: 'Contradice la fecha principal.', en: 'Contradicts the main date.' }), now, now,
    );
    insertExcerpt.run(
      `${PREFIX}excerpt-receipt`, `${PREFIX}item-receipt`, `${PREFIX}file-receipt-master`,
      null, null, text(L, { es: 'línea 1', en: 'line 1' }),
      JSON.stringify({ page: 1 }),
      text(L, { es: 'Recibido por I. Vidal.', en: 'Received by I. Vidal.' }),
      L,
      text(L, {
        es: 'Segunda evidencia contextual para la relación documental.',
        en: 'Second contextual trace for the documentary relationship.',
      }),
      now,
      now,
    );
    insertExcerpt.run(
      `${PREFIX}excerpt-photo`, `${PREFIX}item-photograph`, `${PREFIX}file-photograph-master`,
      null, null, text(L, { es: 'anverso, esquina inferior', en: 'front, lower corner' }),
      JSON.stringify({ page: 1, region: 'lower_corner' }),
      text(L, { es: 'Taller comunitario, Sevilla, hacia 1895.', en: 'Community workshop, Seville, circa 1895.' }),
      L, text(L, { es: 'Inscripción ficticia incorporada para demostrar la descripción visual.', en: 'Fictional inscription included to demonstrate visual description.' }),
      now, now,
    );
    insertExcerpt.run(
      `${PREFIX}excerpt-newspaper`, `${PREFIX}item-newspaper`, `${PREFIX}file-newspaper-master`,
      `${PREFIX}text-press-reviewed`, null, text(L, { es: 'columna 2', en: 'column 2' }),
      JSON.stringify({ page: 1, column: 2 }),
      text(L, { es: 'La ayuda partió de Sevilla hacia las localidades del valle.', en: 'Relief departed from Seville for the valley towns.' }),
      L, text(L, { es: 'Pasaje ficticio de la versión OCR revisada.', en: 'Fictional passage from the reviewed OCR version.' }),
      now, now,
    );
    insertExcerpt.run(
      `${PREFIX}excerpt-map`, `${PREFIX}item-map`, `${PREFIX}file-map-master`,
      null, null, text(L, { es: 'cuadrante central y ruta marcada', en: 'central quadrant and marked route' }),
      JSON.stringify({ page: 1, region: 'centre' }),
      text(L, { es: 'Camino de Carmona a Écija; desvío hacia “San Martín”.', en: 'Road from Carmona to Écija; turn-off towards “San Martín”.' }),
      L, text(L, { es: 'El trazado es ficticio; Carmona y Écija son autoridades geográficas reales.', en: 'The route is fictional; Carmona and Écija are real geographic authorities.' }),
      now, now,
    );
    insertExcerpt.run(
      `${PREFIX}excerpt-register`, `${PREFIX}item-register`, `${PREFIX}file-register-master`,
      null, null, text(L, { es: 'folio 3, asiento 12', en: 'folio 3, entry 12' }),
      JSON.stringify({ page: 3, entry: 12 }),
      text(L, { es: 'Entrega destinada a Écija: ocho sacos de harina.', en: 'Delivery for Écija: eight sacks of flour.' }),
      L, text(L, { es: 'Asiento ficticio para probar lugares, citas y filtros.', en: 'Fictional entry for testing places, citations, and filters.' }),
      now, now,
    );
    insertExcerpt.run(
      `${PREFIX}excerpt-located`, `${PREFIX}item-located-only`, null,
      `${PREFIX}text-located-transcription`, null, text(L, { es: 'apunte de consulta, línea 1', en: 'consultation note, line 1' }),
      JSON.stringify({ line: 1 }),
      text(L, { es: 'Cuaderno consultado en Sevilla; todavía sin reproducción digital.', en: 'Notebook consulted in Seville; still without a digital reproduction.' }),
      L, text(L, { es: 'Demuestra una fuente descrita y citable sin archivo adjunto.', en: 'Demonstrates a described and citable source without an attached file.' }),
      now, now,
    );

    const insertPerson = db.prepare(
      `INSERT INTO persons (
        person_id, display_name, sex, birth_date, birth_date_sort, death_date,
        death_date_sort, notes, identity_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`
    );
    insertPerson.run(ID.personClara, 'Clara Montes', 'female', 'c. 1860', '1860-00-00', 'Persona ficticia de la demo.', 'confirmed', now, now);
    insertPerson.run(ID.personElias, 'Elías N. (identidad provisional)', 'unknown', null, null, 'Mención ficticia sin resolver.', 'provisional', now, now);
    insertPerson.run(ID.personInes, 'Inés Vidal', 'female', 'antes de 1870', '1869-12-31', 'Persona ficticia de la demo.', 'confirmed', now, now);
    const insertName = db.prepare('INSERT INTO person_names (id, person_id, name, kind) VALUES (?, ?, ?, ?)');
    insertName.run(`${PREFIX}name-clara-1`, ID.personClara, 'Clara Montes', 'preferred');
    insertName.run(`${PREFIX}name-clara-2`, ID.personClara, 'C. Montes', 'documentary_variant');
    insertName.run(`${PREFIX}name-ines-1`, ID.personInes, 'Inés Vidal', 'preferred');
    insertName.run(`${PREFIX}name-ines-2`, ID.personInes, 'Ynes Vidal', 'historical_spelling');
    insertName.run(`${PREFIX}name-elias-1`, ID.personElias, 'Elías N.', 'unresolved_form');

    const insertMention = db.prepare(
      `INSERT INTO archive_person_mentions (
        mention_id, item_id, excerpt_id, person_id, original_label, role,
        certainty, identity_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertMention.run(`${PREFIX}mention-clara`, `${PREFIX}item-letter`, `${PREFIX}excerpt-letter`, ID.personClara, 'Clara', 'author', 1, 'confirmed', now, now);
    insertMention.run(`${PREFIX}mention-ines`, `${PREFIX}item-letter`, `${PREFIX}excerpt-letter`, ID.personInes, 'Inés', 'addressee', 0.95, 'confirmed', now, now);
    insertMention.run(`${PREFIX}mention-elias`, `${PREFIX}item-letter`, `${PREFIX}excerpt-letter`, ID.personElias, 'Elías N.', 'mentioned', 0.55, 'provisional', now, now);
    insertMention.run(`${PREFIX}mention-clara-minutes`, `${PREFIX}item-minutes`, `${PREFIX}excerpt-minutes`, ID.personClara, 'Clara Montes', 'attendee', 0.95, 'confirmed', now, now);
    insertMention.run(`${PREFIX}mention-ines-minutes`, `${PREFIX}item-minutes`, `${PREFIX}excerpt-minutes`, ID.personInes, 'Inés Vidal', 'attendee', 0.95, 'confirmed', now, now);
    insertMention.run(`${PREFIX}mention-ines-register`, `${PREFIX}item-register`, `${PREFIX}excerpt-register`, ID.personInes, 'I. Vidal', 'recipient', 0.8, 'confirmed', now, now);
    insertMention.run(`${PREFIX}mention-ines-receipt`, `${PREFIX}item-receipt`, `${PREFIX}excerpt-receipt`, ID.personInes, 'I. Vidal', 'recipient', 0.8, 'confirmed', now, now);

    const insertPlace = db.prepare(
      `INSERT INTO places (
        place_id, name, parent_id, kind, latitude, longitude, notes,
        gazetteer_id, admin1, country, country_code, coordinate_precision,
        historical_context, authority_json, sensitivity, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'normal', ?, ?)`
    );
    const realAuthority = (gazetteerId: string, name: string) => JSON.stringify({
      provider: 'offline_gazetteer',
      gazetteerId,
      name,
      demoContext: 'The locality is real; every document and historical claim in this demo is fictional.',
    });
    insertPlace.run(
      ID.placeSevilla, 'Sevilla', 'municipality', 37.3886, -5.9823,
      text(L, { es: 'Localidad real usada en un corpus documental completamente ficticio.', en: 'Real locality used in an entirely fictional documentary corpus.' }),
      'geonames:2510911', 'Andalusia', 'Spain', 'ES', 'municipality',
      text(L, { es: 'La demo no formula afirmaciones históricas sobre Sevilla.', en: 'The demo makes no historical claims about Seville.' }),
      realAuthority('geonames:2510911', 'Sevilla'), now, now,
    );
    insertPlace.run(
      ID.placeCarmona, 'Carmona', 'municipality', 37.4713, -5.6469,
      text(L, { es: 'Localidad real; los sucesos y documentos asociados son ficticios.', en: 'Real locality; the associated events and documents are fictional.' }),
      'geonames:2520118', 'Andalusia', 'Spain', 'ES', 'municipality',
      text(L, { es: 'Punto elegido para demostrar búsqueda, filtros y rutas.', en: 'Point selected to demonstrate search, filters, and routes.' }),
      realAuthority('geonames:2520118', 'Carmona'), now, now,
    );
    insertPlace.run(
      ID.placeEcija, 'Écija', 'municipality', 37.5411, -5.0824,
      text(L, { es: 'Localidad real; el reparto y la crecida de la demo son ficticios.', en: 'Real locality; the demo delivery and flood are fictional.' }),
      'geonames:2513917', 'Andalusia', 'Spain', 'ES', 'municipality',
      text(L, { es: 'Autoridad real con contexto narrativo explícitamente inventado.', en: 'Real authority with explicitly invented narrative context.' }),
      realAuthority('geonames:2513917', 'Écija'), now, now,
    );
    insertPlace.run(
      ID.placeSanMartin, 'San Martín (sin resolver)', 'unknown', null, null,
      text(L, { es: 'Topónimo ficticio y ambiguo.', en: 'Fictional and ambiguous place-name.' }),
      null, null, null, null, null,
      text(L, { es: 'Varios candidatos posibles; se conserva para probar la resolución.', en: 'Several possible candidates; retained to test resolution.' }),
      JSON.stringify({ demo: true, unresolved: true }), now, now,
    );

    // The provenance map is driven by one explicit archival field per source.
    // Mentions below remain research evidence and deliberately do not feed that map.
    const provenanceBySource: Record<string, string> = {
      letter: ID.placeCarmona,
      minutes: ID.placeCarmona,
      photograph: ID.placeSevilla,
      newspaper: ID.placeSevilla,
      map: ID.placeCarmona,
      register: ID.placeEcija,
      'located-only': ID.placeSevilla,
      restricted: ID.placeSevilla,
      receipt: ID.placeCarmona,
      'margin-note': ID.placeCarmona,
    };
    const setProvenancePlace = db.prepare(
      'UPDATE archive_item_profiles SET provenance_place_id=?, updated_at=? WHERE item_id=?'
    );
    for (const source of demoSources) {
      setProvenancePlace.run(
        provenanceBySource[source.suffix],
        now,
        `${PREFIX}item-${source.suffix}`,
      );
    }

    const insertPlaceMention = db.prepare(
      `INSERT INTO archive_place_mentions (
        mention_id, item_id, excerpt_id, place_id, original_label, role,
        certainty, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertPlaceMention.run(`${PREFIX}place-mention-letter`, `${PREFIX}item-letter`, `${PREFIX}excerpt-letter`, ID.placeCarmona, 'Carmona', 'creation', 0.95, 'resolved', now, now);
    insertPlaceMention.run(`${PREFIX}place-mention-minutes`, `${PREFIX}item-minutes`, `${PREFIX}excerpt-minutes`, ID.placeCarmona, 'Carmona', 'event', 1, 'resolved', now, now);
    insertPlaceMention.run(`${PREFIX}place-mention-photo`, `${PREFIX}item-photograph`, `${PREFIX}excerpt-photo`, ID.placeSevilla, 'Sevilla', 'creation', 0.9, 'resolved', now, now);
    insertPlaceMention.run(`${PREFIX}place-mention-newspaper`, `${PREFIX}item-newspaper`, `${PREFIX}excerpt-newspaper`, ID.placeSevilla, 'Sevilla', 'creation', 1, 'resolved', now, now);
    insertPlaceMention.run(`${PREFIX}place-mention-map-origin`, `${PREFIX}item-map`, `${PREFIX}excerpt-map`, ID.placeCarmona, 'Carmona', 'route_origin', 0.9, 'resolved', now, now);
    insertPlaceMention.run(`${PREFIX}place-mention-map-destination`, `${PREFIX}item-map`, `${PREFIX}excerpt-map`, ID.placeEcija, 'Écija', 'route_destination', 0.9, 'resolved', now, now);
    insertPlaceMention.run(`${PREFIX}place-mention-san-martin`, `${PREFIX}item-map`, `${PREFIX}excerpt-map`, ID.placeSanMartin, 'San Martín', 'mentioned', 0.4, 'proposed', now, now);
    insertPlaceMention.run(`${PREFIX}place-mention-register`, `${PREFIX}item-register`, `${PREFIX}excerpt-register`, ID.placeEcija, 'Écija', 'mentioned', 1, 'resolved', now, now);
    insertPlaceMention.run(`${PREFIX}place-mention-located`, `${PREFIX}item-located-only`, `${PREFIX}excerpt-located`, ID.placeSevilla, 'Sevilla', 'consultation', 1, 'resolved', now, now);
    insertPlaceMention.run(`${PREFIX}place-mention-receipt`, `${PREFIX}item-receipt`, `${PREFIX}excerpt-receipt`, ID.placeCarmona, 'Carmona', 'event', 0.85, 'resolved', now, now);
    insertPlaceMention.run(`${PREFIX}place-mention-margin`, `${PREFIX}item-margin-note`, `${PREFIX}excerpt-margin`, ID.placeCarmona, 'Carmona', 'mentioned', 0.75, 'resolved', now, now);

    const insertEvent = db.prepare(
      `INSERT INTO events (
        event_id, type, label, date, date_sort, date_end_sort, place_id, notes,
        date_certainty, review_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'reviewed', ?, ?)`
    );
    insertEvent.run(ID.eventAssembly, 'assembly', text(L, { es: 'Asamblea ficticia del molino', en: 'Fictional mill assembly' }), text(L, { es: '17 o 18 de abril de 1894', en: '17 or 18 April 1894' }), '1894-04-17', '1894-04-18', ID.placeCarmona, text(L, { es: 'Suceso ficticio; la fecha permanece contradictoria.', en: 'Fictional event; the date remains contradictory.' }), 'range', now, now);
    insertEvent.run(ID.eventFlood, 'flood', text(L, { es: 'Gran crecida ficticia', en: 'Fictional great flood' }), text(L, { es: 'primavera de 1894', en: 'spring 1894' }), '1894-03-01', '1894-05-31', ID.placeEcija, text(L, { es: 'Intervalo aproximado de un suceso inventado para la demo.', en: 'Approximate interval for an event invented for the demo.' }), 'approximate', now, now);
    const insertParticipant = db.prepare('INSERT INTO event_participants (id, event_id, person_id, role) VALUES (?, ?, ?, ?)');
    insertParticipant.run(`${PREFIX}participant-clara`, ID.eventAssembly, ID.personClara, 'attendee');
    insertParticipant.run(`${PREFIX}participant-ines`, ID.eventAssembly, ID.personInes, 'attendee');
    insertParticipant.run(`${PREFIX}participant-elias`, ID.eventAssembly, ID.personElias, 'mentioned');

    db.prepare(
      `INSERT INTO relationships (
        rel_id, from_person, to_person, type, provenance, subtype, notes, created_at
      ) VALUES (?, ?, ?, 'correspondent', 'user_asserted', NULL, ?, ?)`
    ).run(
      ID.relationship, ID.personClara, ID.personInes,
      text(L, { es: 'Relación documental, no parentesco.', en: 'Documented relationship, not kinship.' }),
      now,
    );

    const insertEvidence = db.prepare(
      `INSERT INTO record_evidence (
        id, target_kind, target_id, nodus_id, source_kind, quote, location,
        confidence, created_at, excerpt_id, evidence_role, certainty,
        review_status, source_version_id, created_by, updated_at
      ) VALUES (?, ?, ?, ?, 'archive', ?, ?, ?, ?, ?, ?, ?, 'reviewed', ?, 'demo_researcher', ?)`
    );
    insertEvidence.run(`${PREFIX}evidence-person-elias`, 'person', ID.personElias, `${PREFIX}item-letter`, text(L, { es: 'Elías N. trajo cuerda.', en: 'Elías N. brought rope.' }), text(L, { es: 'hoja 2', en: 'page 2' }), 0.55, now, `${PREFIX}excerpt-letter`, 'mentions', 0.55, `${PREFIX}text-letter-diplomatic`, now);
    insertEvidence.run(`${PREFIX}evidence-event-support`, 'event', ID.eventAssembly, `${PREFIX}item-minutes`, text(L, { es: 'el día diecisiete', en: 'on the seventeenth' }), text(L, { es: 'párrafo 2', en: 'paragraph 2' }), 0.9, now, `${PREFIX}excerpt-minutes`, 'supports', 0.9, null, now);
    insertEvidence.run(`${PREFIX}evidence-event-contradiction`, 'event', ID.eventAssembly, `${PREFIX}item-margin-note`, text(L, { es: 'el día dieciocho', en: 'on the eighteenth' }), text(L, { es: 'línea única', en: 'single line' }), 0.85, now, `${PREFIX}excerpt-margin`, 'contradicts', 0.85, null, now);
    insertEvidence.run(`${PREFIX}evidence-relation-letter`, 'relationship', ID.relationship, `${PREFIX}item-letter`, text(L, { es: 'A mi estimada Inés', en: 'My dear Inés' }), text(L, { es: 'hoja 1', en: 'page 1' }), 0.9, now, `${PREFIX}excerpt-letter`, 'supports', 0.9, `${PREFIX}text-letter-diplomatic`, now);
    insertEvidence.run(`${PREFIX}evidence-relation-receipt`, 'relationship', ID.relationship, `${PREFIX}item-receipt`, text(L, { es: 'Recibido por I. Vidal.', en: 'Received by I. Vidal.' }), text(L, { es: 'línea 1', en: 'line 1' }), 0.65, now, `${PREFIX}excerpt-receipt`, 'contextualizes', 0.65, null, now);
    insertEvidence.run(`${PREFIX}evidence-place-carmona-letter`, 'place', ID.placeCarmona, `${PREFIX}item-letter`, 'Carmona', text(L, { es: 'hoja 2', en: 'page 2' }), 0.95, now, `${PREFIX}excerpt-letter`, 'supports', 0.95, `${PREFIX}text-letter-diplomatic`, now);
    insertEvidence.run(`${PREFIX}evidence-place-carmona-minutes`, 'place', ID.placeCarmona, `${PREFIX}item-minutes`, 'Carmona', text(L, { es: 'párrafo 2', en: 'paragraph 2' }), 1, now, `${PREFIX}excerpt-minutes`, 'supports', 1, null, now);
    insertEvidence.run(`${PREFIX}evidence-place-sevilla-photo`, 'place', ID.placeSevilla, `${PREFIX}item-photograph`, 'Sevilla', text(L, { es: 'anverso', en: 'front' }), 0.9, now, `${PREFIX}excerpt-photo`, 'supports', 0.9, null, now);
    insertEvidence.run(`${PREFIX}evidence-place-sevilla-press`, 'place', ID.placeSevilla, `${PREFIX}item-newspaper`, 'Sevilla', text(L, { es: 'columna 2', en: 'column 2' }), 1, now, `${PREFIX}excerpt-newspaper`, 'supports', 1, `${PREFIX}text-press-reviewed`, now);
    insertEvidence.run(`${PREFIX}evidence-place-carmona-map`, 'place', ID.placeCarmona, `${PREFIX}item-map`, 'Carmona', text(L, { es: 'ruta marcada', en: 'marked route' }), 0.9, now, `${PREFIX}excerpt-map`, 'supports', 0.9, null, now);
    insertEvidence.run(`${PREFIX}evidence-place-ecija-map`, 'place', ID.placeEcija, `${PREFIX}item-map`, 'Écija', text(L, { es: 'ruta marcada', en: 'marked route' }), 0.9, now, `${PREFIX}excerpt-map`, 'supports', 0.9, null, now);
    insertEvidence.run(`${PREFIX}evidence-place-ecija-register`, 'place', ID.placeEcija, `${PREFIX}item-register`, 'Écija', text(L, { es: 'folio 3', en: 'folio 3' }), 1, now, `${PREFIX}excerpt-register`, 'supports', 1, null, now);
    insertEvidence.run(`${PREFIX}evidence-place-sevilla-located`, 'place', ID.placeSevilla, `${PREFIX}item-located-only`, 'Sevilla', text(L, { es: 'apunte de consulta', en: 'consultation note' }), 1, now, `${PREFIX}excerpt-located`, 'supports', 1, `${PREFIX}text-located-transcription`, now);
    insertEvidence.run(`${PREFIX}evidence-place-carmona-receipt`, 'place', ID.placeCarmona, `${PREFIX}item-receipt`, 'Carmona', text(L, { es: 'línea 1', en: 'line 1' }), 0.85, now, `${PREFIX}excerpt-receipt`, 'supports', 0.85, null, now);
    insertEvidence.run(`${PREFIX}evidence-event-flood`, 'event', ID.eventFlood, `${PREFIX}item-letter`, text(L, { es: 'La crecida dañó el puente.', en: 'The flood damaged the bridge.' }), text(L, { es: 'hoja 2', en: 'page 2' }), 0.85, now, `${PREFIX}excerpt-letter`, 'supports', 0.85, `${PREFIX}text-letter-diplomatic`, now);

    db.prepare(
      `INSERT INTO archive_entity_proposals (
        proposal_id, item_id, excerpt_id, proposal_kind, payload_json,
        matched_target_id, status, confidence, rationale, source_engine,
        source_model, fingerprint, created_at
      ) VALUES (?, ?, ?, 'person', ?, ?, 'pending', 0.55, ?, 'demo_fixture',
        NULL, ?, ?)`
    ).run(
      `${PREFIX}proposal-elias`, `${PREFIX}item-letter`, `${PREFIX}excerpt-letter`,
      JSON.stringify({ displayName: 'Elías Navarro?', identityStatus: 'provisional' }),
      ID.personElias,
      text(L, { es: 'Ejercicio de revisión: la semejanza no confirma identidad.', en: 'Review exercise: similarity does not confirm identity.' }),
      sha256(Buffer.from(`${PREFIX}proposal-elias`)),
      now,
    );
    db.prepare(
      `INSERT INTO archive_source_analyses (
        analysis_id, item_id, origin_notes, purpose_audience, content_form,
        perspective_bias, silences_limits, authenticity_notes, representativeness,
        corroboration, questions, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_review', ?, ?)`
    ).run(
      `${PREFIX}analysis-letter`, `${PREFIX}item-letter`,
      text(L, { es: 'Procede del fondo ficticio de la cooperativa.', en: 'Comes from the fictional cooperative fonds.' }),
      text(L, { es: 'Comunicación privada entre colaboradoras.', en: 'Private communication between collaborators.' }),
      text(L, { es: 'Carta manuscrita de tres hojas.', en: 'Three-page handwritten letter.' }),
      text(L, { es: 'Solo conserva la perspectiva de la autora.', en: 'Preserves only the author’s perspective.' }),
      text(L, { es: 'No explica quién es Elías N.', en: 'Does not explain who Elías N. is.' }),
      text(L, { es: 'Autenticidad no evaluada; corpus didáctico ficticio.', en: 'Authenticity not assessed; fictional teaching corpus.' }),
      text(L, { es: 'No representa por sí sola a toda la comunidad.', en: 'Does not represent the whole community by itself.' }),
      text(L, { es: 'El acta y el recibo aportan contexto, no una identidad definitiva.', en: 'The minutes and receipt add context, not a definitive identity.' }),
      text(L, { es: '¿La fecha 17 fue un error de copia?', en: 'Was the 17th a copying error?' }),
      now, now,
    );

    const insertNote = db.prepare(
      `INSERT INTO notes (
        id, folder_id, title, kind, content, source_json, order_idx, created_at, updated_at
      ) VALUES (?, NULL, ?, 'markdown', ?, NULL, ?, ?, ?)`
    );
    insertNote.run(
      ID.noteInterpretation,
      text(L, { es: 'Hipótesis sobre la red de ayuda', en: 'Hypothesis about the relief network' }),
      text(L, {
        es: '# Interpretación del investigador\\n\\nLa correspondencia sugiere coordinación, pero **no demuestra parentesco ni una organización formal**.',
        en: '# Researcher interpretation\\n\\nThe correspondence suggests coordination, but **does not prove kinship or a formal organisation**.',
      }),
      0, now, now,
    );
    insertNote.run(
      ID.noteContradiction,
      text(L, { es: 'Contradicción de fecha pendiente', en: 'Unresolved date contradiction' }),
      text(L, {
        es: 'El acta indica 17 de abril; la nota marginal indica 18. Se conservan ambas evidencias.',
        en: 'The minutes state 17 April; the marginal note states 18 April. Both pieces of evidence are retained.',
      }),
      1, now, now,
    );
    const insertNoteProfile = db.prepare(
      `INSERT INTO primary_source_note_profiles (
        note_id, note_type, status, collection, access_status, sensitivity,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'Demo', ?, 'normal', ?, ?)`
    );
    insertNoteProfile.run(ID.noteInterpretation, 'hypothesis', 'draft', 'private', now, now);
    insertNoteProfile.run(ID.noteContradiction, 'question', 'in_review', 'open', now, now);
    const insertNoteLink = db.prepare(
      `INSERT INTO note_links (
        link_id, nodus_id, target_kind, target_id, excerpt_id, relation_kind, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    insertNoteLink.run(`${PREFIX}note-link-letter`, ID.noteInterpretation, 'source', `${PREFIX}item-letter`, `${PREFIX}excerpt-letter`, 'interprets', now);
    insertNoteLink.run(`${PREFIX}note-link-event`, ID.noteContradiction, 'event', ID.eventAssembly, `${PREFIX}excerpt-minutes`, 'contradicts', now);

    // The expected bytes remain untouched. Only the check record (and the visible
    // status) simulate a failed verification for the preservation exercise.
    const mapHash = sha256(demoSources.find((source) => source.suffix === 'map')!.content!);
    db.prepare(
      `INSERT INTO archive_integrity_checks (
        check_id, file_id, algorithm, expected_hash, observed_hash, status,
        checked_at, details
      ) VALUES (?, ?, 'sha256', ?, ?, 'mismatch', ?, ?)`
    ).run(
      `${PREFIX}integrity-map`, `${PREFIX}file-map-master`, mapHash,
      '0'.repeat(64), now,
      text(L, {
        es: 'Incidencia simulada no destructiva: el máster conserva sus bytes y hash esperado.',
        en: 'Non-destructive simulated incident: the master retains its bytes and expected hash.',
      }),
    );

    // Loading sample records and launching product education are separate choices.
    // Preserve the user's tour state so dismissing/completing it is never undone by
    // the "Cargar corpus de aprendizaje" action.
    updateSettings({ demoMode: true });
  })();

  recordPrimarySourceLocalMetric('demo_seed', performance.now() - started, demoSources.length, true);
  return true;
}

export function clearPrimarySourcesDemoData(): void {
  const db = getDb();
  const hasRows = Number((db.prepare(
    "SELECT COUNT(*) AS value FROM archive_items WHERE item_id LIKE 'demo-ps-%'"
  ).get() as { value: number }).value) > 0;
  // `demoMode` is shared by every vault kind. When the generic cleanup dispatcher
  // calls us for (for example) a Worldbuilding demo, do not consume that other
  // module's ownership flag before it has removed its own rows.
  if (!hasRows && (getActiveVault().type !== 'primary_sources' || !getSettings().demoMode)) return;
  db.transaction(() => {
    db.prepare("DELETE FROM note_links WHERE link_id LIKE 'demo-ps-%' OR nodus_id LIKE 'demo-ps-%'").run();
    db.prepare("DELETE FROM notes WHERE id LIKE 'demo-ps-%'").run();
    db.prepare("DELETE FROM record_evidence WHERE id LIKE 'demo-ps-%' OR nodus_id LIKE 'demo-ps-%' OR target_id LIKE 'demo-ps-%'").run();
    db.prepare("DELETE FROM archive_excerpts WHERE excerpt_id LIKE 'demo-ps-%'").run();
    const deleteTextLeaves = db.prepare(
      `DELETE FROM archive_text_versions
       WHERE text_version_id LIKE 'demo-ps-%'
         AND NOT EXISTS (
           SELECT 1 FROM archive_text_versions child
            WHERE child.parent_version_id=archive_text_versions.text_version_id
         )`
    );
    while (Number((db.prepare(
      "SELECT COUNT(*) AS value FROM archive_text_versions WHERE text_version_id LIKE 'demo-ps-%'"
    ).get() as { value: number }).value) > 0) {
      if (deleteTextLeaves.run().changes === 0) {
        throw new Error('El corpus demo contiene un ciclo inesperado de versiones de texto.');
      }
    }
    db.prepare("DELETE FROM archive_item_files WHERE file_id LIKE 'demo-ps-%' AND parent_file_id IS NOT NULL").run();
    db.prepare("DELETE FROM archive_item_files WHERE file_id LIKE 'demo-ps-%'").run();
    db.prepare("DELETE FROM archive_items WHERE item_id LIKE 'demo-ps-%'").run();
    db.prepare("DELETE FROM relationships WHERE rel_id LIKE 'demo-ps-%'").run();
    db.prepare("DELETE FROM event_participants WHERE id LIKE 'demo-ps-%'").run();
    db.prepare("DELETE FROM events WHERE event_id LIKE 'demo-ps-%'").run();
    db.prepare("DELETE FROM persons WHERE person_id LIKE 'demo-ps-%'").run();
    db.prepare("DELETE FROM places WHERE place_id LIKE 'demo-ps-%'").run();
    db.prepare("DELETE FROM archive_description_units WHERE unit_id LIKE 'demo-ps-unit-%'").run();
    db.prepare("DELETE FROM archive_description_units WHERE unit_id IN (?, ?)").run(
      ID.seriesCorrespondence,
      ID.seriesCommunity,
    );
    db.prepare('DELETE FROM archive_description_units WHERE unit_id=?').run(ID.fonds);
    db.prepare('DELETE FROM archive_capture_sessions WHERE session_id=?').run(ID.session);
    db.prepare('DELETE FROM archive_folders WHERE folder_id=?').run(ID.folder);
    db.prepare('DELETE FROM archive_repositories WHERE repository_id=?').run(ID.repository);
    updateSettings({ demoMode: false });
  })();
}

export const PRIMARY_SOURCES_DEMO_IDS = ID;
