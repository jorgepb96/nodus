import type { TutorialLanguage } from './tutorialPreferences';
import { isVaultType, type VaultType } from './vaultTypes';

/**
 * The published video tutorials, and every string that describes them.
 *
 * The videos are streamed from YouTube rather than bundled: the installers already
 * weigh 460–939 MB, and ten ~15-minute captures would add gigabytes to every platform
 * for material most users watch once. Streaming also means a new tutorial reaches
 * installed copies without a release. The written guide remains the offline,
 * network-silent path — which is what makes the video path defensible.
 *
 * The catalogue is arranged on four shelves — introduction, vaults, features,
 * integrations — because a new user should meet exactly one of them: the introduction.
 * A vault's video is offered by that vault's own tour the first time it is opened, and
 * Settings → Help is the single place that holds all of them, with tabs and a search
 * box.
 *
 * The copy lives here, in the tutorial's twelve languages, instead of in the i18n
 * tables (seven UI languages) so that a reader who picked 日本語 in the cinematic
 * guide is not handed English cards. `AppLanguage` is a subset of
 * `TutorialLanguage`, so Settings can look its copy up with `settings.uiLanguage`
 * directly.
 */

export type TutorialVideoId =
  | 'essentials'
  | 'academic'
  | 'genealogy'
  | 'databases'
  | 'teaching'
  | 'nodi'
  | 'toolkit'
  | 'pdf-presenter'
  | 'word'
  | 'zotero'
  | 'mcp';

/**
 * The four shelves the catalogue is arranged on, in the order they are shown.
 *
 * `introduction` is deliberately alone: it is the only tutorial a brand-new user is
 * shown, and everything else is met later — a vault's video when that vault is created,
 * the rest from Settings → Help.
 */
export type TutorialCategory = 'introduction' | 'vaults' | 'features' | 'integrations';

export const TUTORIAL_CATEGORIES: readonly TutorialCategory[] = ['introduction', 'vaults', 'features', 'integrations'];

export function isTutorialCategory(value: unknown): value is TutorialCategory {
  return typeof value === 'string' && (TUTORIAL_CATEGORIES as readonly string[]).includes(value);
}

export interface TutorialVideo {
  /** A `TutorialVideoId` for the built-ins; any slug for entries published later. */
  id: string;
  youtubeId: string;
  /** Position within its category. Not shown: the published titles are not numbered. */
  order: number;
  /** The shelf it sits on in the grid, and the tab that filters it in. */
  category: TutorialCategory;
  /** Icon name from the renderer's `Icon` set. */
  icon: string;
  /** Poster gradient, so a card is recognisable before anything loads. */
  poster: string;
  /** The vault whose in-app tour this video can replace, when it covers one. */
  vaultType?: VaultType;
  /**
   * Its own translations, carried by catalogue entries this build predates. Built-in
   * videos leave this unset and take their copy from the table below instead.
   */
  copy?: Partial<Record<TutorialLanguage, { title: string; body: string }>>;
}

/** Frames come from the no-cookie host; keep this in step with the CSP in index.html. */
export const TUTORIAL_VIDEO_EMBED_ORIGIN = 'https://www.youtube-nocookie.com';

/** The one tutorial a fresh install is shown; everything else is met in context. */
export const TUTORIAL_INTRO_VIDEO_ID = 'essentials';

export const TUTORIAL_VIDEOS: readonly TutorialVideo[] = [
  {
    id: 'essentials',
    youtubeId: 'QqSY1_DeDRM',
    order: 1,
    category: 'introduction',
    icon: 'network',
    poster: 'linear-gradient(140deg, #0f766e 0%, #155e75 55%, #1e1b4b 100%)',
  },
  {
    id: 'academic',
    youtubeId: 'Z-5CpJBVV_I',
    order: 2,
    category: 'vaults',
    icon: 'archive',
    poster: 'linear-gradient(140deg, #3730a3 0%, #1e40af 55%, #0f172a 100%)',
    vaultType: 'academic',
  },
  {
    id: 'genealogy',
    youtubeId: 'UPz7bqN5znE',
    order: 3,
    category: 'vaults',
    icon: 'tree',
    poster: 'linear-gradient(140deg, #047857 0%, #14532d 55%, #052e16 100%)',
    vaultType: 'genealogy',
  },
  {
    id: 'databases',
    youtubeId: '4ooNmZVx0dA',
    order: 4,
    category: 'vaults',
    icon: 'table',
    poster: 'linear-gradient(140deg, #b30333 0%, #7f1d1d 55%, #1c1917 100%)',
    vaultType: 'databases',
  },
  {
    id: 'teaching',
    youtubeId: '5LsojBiM348',
    order: 5,
    category: 'vaults',
    icon: 'graduation',
    poster: 'linear-gradient(140deg, #ea580c 0%, #9a3412 55%, #1c1917 100%)',
    vaultType: 'docencia',
  },
  {
    id: 'nodi',
    youtubeId: '5OTe5CtefME',
    order: 6,
    category: 'features',
    icon: 'sparkles',
    poster: 'linear-gradient(140deg, #0369a1 0%, #4338ca 55%, #111827 100%)',
  },
  {
    id: 'toolkit',
    youtubeId: '-xhDw_Y0vpA',
    order: 7,
    category: 'features',
    icon: 'tools',
    poster: 'linear-gradient(140deg, #7c3aed 0%, #4c1d95 55%, #111827 100%)',
  },
  {
    id: 'pdf-presenter',
    youtubeId: 'e2js_u-05OA',
    order: 7.5,
    category: 'features',
    icon: 'presentation',
    poster: 'linear-gradient(140deg, #075985 0%, #4338ca 55%, #111827 100%)',
  },
  {
    id: 'word',
    youtubeId: 'GFVOJ0JNPMw',
    order: 8,
    category: 'integrations',
    icon: 'file',
    poster: 'linear-gradient(140deg, #1d4ed8 0%, #1e3a8a 55%, #0f172a 100%)',
  },
  {
    id: 'zotero',
    youtubeId: 'lMWW8JJrl2c',
    order: 9,
    category: 'integrations',
    icon: 'book',
    poster: 'linear-gradient(140deg, #9f1239 0%, #4c0519 55%, #1c1917 100%)',
  },
  {
    id: 'mcp',
    youtubeId: 'qa2xPiOmV2c',
    order: 10,
    category: 'integrations',
    icon: 'plug',
    poster: 'linear-gradient(140deg, #0f766e 0%, #134e4a 55%, #0f172a 100%)',
  },
];

export function tutorialVideo(id: string, videos: readonly TutorialVideo[] = TUTORIAL_VIDEOS): TutorialVideo | undefined {
  return videos.find((video) => video.id === id);
}

/** The video that covers a vault type, when one has been published for it. */
export function tutorialVideoForVault(
  type: VaultType | undefined,
  videos: readonly TutorialVideo[] = TUTORIAL_VIDEOS,
): TutorialVideo | undefined {
  if (!type) return undefined;
  return videos.find((video) => video.vaultType === type);
}

export function youtubeWatchUrl(video: TutorialVideo): string {
  return `https://www.youtube.com/watch?v=${video.youtubeId}`;
}

/**
 * Embed URL for the in-app player. `rel=0` keeps the end screen to this channel and
 * `modestbranding=1` drops the watermark; the player's own controls provide pause,
 * seeking, captions, speed and fullscreen.
 */
export function youtubeEmbedUrl(video: TutorialVideo, language: TutorialLanguage): string {
  const params = new URLSearchParams({
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
    autoplay: '1',
    hl: language,
  });
  return `${TUTORIAL_VIDEO_EMBED_ORIGIN}/embed/${video.youtubeId}?${params.toString()}`;
}

export interface TutorialVideoCopy {
  chooseTitle: string;
  chooseLede: string;
  videoOption: { title: string; body: string; badge: string };
  textOption: { title: string; body: string };
  gridTitle: string;
  gridLede: string;
  /** Promise that the catalogue keeps growing. Required in every language. */
  more: string;
  watched: string;
  markUnwatched: string;
  openExternal: string;
  hosting: string;
  /** Says out loud that opening the list checks the Nodus site for new tutorials. */
  catalogueNote: string;
  close: string;
  play: string;
  tourVideo: string;
  /** Shelf names — the grid's headings and the filter tabs. */
  categories: Record<TutorialCategory, string>;
  /** The tab that clears the category filter. */
  allCategories: string;
  searchPlaceholder: string;
  searchLabel: string;
  noMatches: string;
  /** The single featured tutorial on the first-run video screen. */
  startHere: string;
  startHereLede: string;
  /** …and where the other tutorials are met, said on that same screen. */
  whereVaults: { title: string; body: string };
  whereSettings: { title: string; body: string };
  videos: Record<TutorialVideoId, { title: string; body: string }>;
}

const COPY: Record<TutorialLanguage, TutorialVideoCopy> = {
  es: {
    chooseTitle: '¿Cómo prefieres aprender?',
    chooseLede: 'Elige cómo quieres conocer Nodus. La otra opción sigue disponible en Ajustes → Ayuda.',
    videoOption: { title: 'Ver los tutoriales en vídeo', body: 'Tutoriales guiados que puedes pausar y ver a pantalla completa sin salir de Nodus.', badge: 'Recomendado' },
    textOption: { title: 'Leer la guía a tu ritmo', body: 'Capítulos con enlaces y avisos, dentro de la app y sin conexión.' },
    gridTitle: 'Tutoriales en vídeo',
    gridLede: 'Abre el que quieras. Se marca como visto en cuanto lo abres.',
    more: 'Más tutoriales próximamente.',
    watched: 'Visto',
    markUnwatched: 'Marcar como no visto',
    openExternal: 'Abrir en el navegador',
    hosting: 'Los vídeos están alojados en YouTube: al abrir uno, tu conexión contacta con sus servidores. La guía en texto funciona sin conexión.',
    catalogueNote: 'Al abrir esta lista, Nodus consulta en su web si hay tutoriales nuevos.',
    close: 'Cerrar',
    play: 'Ver el vídeo',
    tourVideo: 'Ver el tutorial en vídeo',
    categories: { introduction: 'Introducción', vaults: 'Bóvedas', features: 'Funciones', integrations: 'Integraciones' },
    allCategories: 'Todos',
    searchPlaceholder: 'Buscar tutoriales…',
    searchLabel: 'Buscar entre los tutoriales',
    noMatches: 'Ningún tutorial coincide con tu búsqueda.',
    startHere: 'Empieza por aquí',
    startHereLede: 'Este es el único tutorial que necesitas ahora mismo. El resto del catálogo te espera cuando te haga falta.',
    whereVaults: { title: 'El tutorial de cada bóveda, al crearla', body: 'Cuando crees una bóveda académica, de genealogía, de bases de datos o de docencia, su vídeo te espera la primera vez que la abras.' },
    whereSettings: { title: 'Todos los tutoriales, en Ajustes', body: 'Ajustes → Ayuda reúne el catálogo completo —Introducción, Bóvedas, Funciones e Integraciones— con buscador y filtros.' },
    videos: {
      essentials: { title: 'Introducción y primeros pasos', body: 'Qué es Nodus, cómo se organiza en bóvedas y qué necesitas para empezar.' },
      academic: { title: 'La bóveda académica', body: 'De tu biblioteca a un grafo de ideas, autores y relaciones.' },
      genealogy: { title: 'La bóveda de genealogía', body: 'Árbol familiar, archivo de documentos y parentescos, cada uno con sus fuentes.' },
      databases: { title: 'La bóveda de bases de datos', body: 'Tablas, vistas, fórmulas y relaciones para organizar lo que quieras.' },
      teaching: { title: 'La bóveda de docencia', body: 'Cursos, horario, grupos, rúbricas, exámenes y cuaderno de notas.' },
      nodi: { title: 'Nodi, tu acompañante', body: 'Cómo usar a Nodi para conversar, consultar avisos y abrir la ayuda.' },
      toolkit: { title: 'El Toolkit de Nodus', body: 'Convertir archivos, presentar PDF y reconocer texto de imágenes con IA.' },
      'pdf-presenter': {"title": "Nodus Presenter", "body": "Aprende a presentar tus PDF con notas del ponente, anotaciones en directo y el móvil como mando."},
      word: { title: 'Nodus Copilot para Microsoft Word', body: 'Escribe en Word con tu corpus al lado y citas de tu biblioteca.' },
      zotero: { title: 'Zotero', body: 'Sincroniza tus colecciones y trabaja desde el plugin de Nodus dentro de Zotero.' },
      mcp: { title: 'MCP y Nodus Server', body: 'Abre tu bóveda a otros asistentes de IA y publícala en tu red.' },
    },
  },
  en: {
    chooseTitle: 'How do you prefer to learn?',
    chooseLede: 'Choose how you want to get to know Nodus. The other option stays available under Settings → Help.',
    videoOption: { title: 'Watch the video tutorials', body: 'Guided tutorials you can pause and watch fullscreen without leaving Nodus.', badge: 'Recommended' },
    textOption: { title: 'Read the guide at your own pace', body: 'Chapters with links and warnings, inside the app and offline.' },
    gridTitle: 'Video tutorials',
    gridLede: 'Open any of them. Each is marked as watched as soon as you open it.',
    more: 'More tutorials on the way.',
    watched: 'Watched',
    markUnwatched: 'Mark as unwatched',
    openExternal: 'Open in browser',
    hosting: 'The videos are hosted on YouTube: opening one connects to its servers. The written guide works offline.',
    catalogueNote: 'Opening this list asks the Nodus website whether new tutorials have been published.',
    close: 'Close',
    play: 'Watch video',
    tourVideo: 'Watch the video tutorial',
    categories: { introduction: 'Introduction', vaults: 'Vaults', features: 'Features', integrations: 'Integrations' },
    allCategories: 'All',
    searchPlaceholder: 'Search tutorials…',
    searchLabel: 'Search the tutorials',
    noMatches: 'No tutorial matches your search.',
    startHere: 'Start here',
    startHereLede: 'This is the only tutorial you need right now. The rest of the catalogue waits until you want it.',
    whereVaults: { title: 'Each vault’s tutorial, when you create it', body: 'Create an academic, genealogy, databases or teaching vault and its video is waiting the first time you open it.' },
    whereSettings: { title: 'All the tutorials, in Settings', body: 'Settings → Help holds the whole catalogue — Introduction, Vaults, Features and Integrations — with search and filters.' },
    videos: {
      essentials: { title: 'Introduction and first steps', body: 'What Nodus is, how vaults organise it and what you need to begin.' },
      academic: { title: 'The academic vault', body: 'From your library to a graph of ideas, authors and relations.' },
      genealogy: { title: 'The genealogy vault', body: 'Family tree, document archive and kinship, each backed by its sources.' },
      databases: { title: 'The databases vault', body: 'Tables, views, formulas and relations to organise anything you like.' },
      teaching: { title: 'The teaching vault', body: 'Courses, timetable, groups, rubrics, exams and the gradebook.' },
      nodi: { title: 'Nodi, your companion', body: 'How to use Nodi to chat, check notifications and open help.' },
      toolkit: { title: 'The Nodus Toolkit', body: 'Convert files, present PDFs and read text out of images with AI.' },
      'pdf-presenter': {"title": "Nodus Presenter", "body": "Learn to present your PDFs with speaker notes, live annotations and your phone as a remote."},
      word: { title: 'Nodus Copilot for Microsoft Word', body: 'Write in Word with your corpus beside you and citations from your library.' },
      zotero: { title: 'Zotero', body: 'Sync your collections and work from the Nodus plugin inside Zotero.' },
      mcp: { title: 'MCP and Nodus Server', body: 'Open your vault to other AI assistants and publish it on your network.' },
    },
  },
  fr: {
    chooseTitle: 'Comment préférez-vous apprendre ?',
    chooseLede: 'Choisissez comment découvrir Nodus. L’autre option reste disponible dans Réglages → Aide.',
    videoOption: { title: 'Voir les tutoriels en vidéo', body: 'Des tutoriels guidés que vous pouvez mettre en pause et afficher en plein écran sans quitter Nodus.', badge: 'Recommandé' },
    textOption: { title: 'Lire le guide à votre rythme', body: 'Des chapitres avec liens et avertissements, dans l’app et hors ligne.' },
    gridTitle: 'Tutoriels vidéo',
    gridLede: 'Ouvrez celui que vous voulez. Il est marqué comme vu dès l’ouverture.',
    more: 'D’autres tutoriels arrivent bientôt.',
    watched: 'Vu',
    markUnwatched: 'Marquer comme non vu',
    openExternal: 'Ouvrir dans le navigateur',
    hosting: 'Les vidéos sont hébergées sur YouTube : en ouvrir une contacte ses serveurs. Le guide écrit fonctionne hors ligne.',
    catalogueNote: 'À l’ouverture de cette liste, Nodus demande à son site si de nouveaux tutoriels existent.',
    close: 'Fermer',
    play: 'Voir la vidéo',
    tourVideo: 'Voir le tutoriel en vidéo',
    categories: { introduction: 'Introduction', vaults: 'Coffres', features: 'Fonctions', integrations: 'Intégrations' },
    allCategories: 'Tous',
    searchPlaceholder: 'Rechercher un tutoriel…',
    searchLabel: 'Rechercher parmi les tutoriels',
    noMatches: 'Aucun tutoriel ne correspond à votre recherche.',
    startHere: 'Commencez ici',
    startHereLede: 'C’est le seul tutoriel dont vous avez besoin maintenant. Le reste du catalogue vous attend quand vous en aurez envie.',
    whereVaults: { title: 'Le tutoriel de chaque coffre, à sa création', body: 'Créez un coffre académique, de généalogie, de bases de données ou d’enseignement : sa vidéo vous attend à la première ouverture.' },
    whereSettings: { title: 'Tous les tutoriels, dans Réglages', body: 'Réglages → Aide rassemble tout le catalogue — Introduction, Coffres, Fonctions et Intégrations — avec recherche et filtres.' },
    videos: {
      essentials: { title: 'Introduction et premiers pas', body: 'Ce qu’est Nodus, comment les coffres l’organisent et ce qu’il faut pour commencer.' },
      academic: { title: 'Le coffre académique', body: 'De votre bibliothèque à un graphe d’idées, d’auteurs et de relations.' },
      genealogy: { title: 'Le coffre de généalogie', body: 'Arbre familial, archives de documents et parentés, chacun adossé à ses sources.' },
      databases: { title: 'Le coffre de bases de données', body: 'Tables, vues, formules et relations pour organiser ce que vous voulez.' },
      teaching: { title: 'Le coffre d’enseignement', body: 'Cours, emploi du temps, groupes, grilles, examens et carnet de notes.' },
      nodi: { title: 'Nodi, votre compagnon', body: 'Utiliser Nodi pour discuter, consulter les avis et ouvrir l’aide.' },
      toolkit: { title: 'Le Toolkit de Nodus', body: 'Convertir des fichiers, présenter des PDF et lire du texte dans des images avec l’IA.' },
      'pdf-presenter': {"title": "Nodus Presenter", "body": "Apprenez à présenter vos PDF avec des notes, des annotations en direct et votre téléphone comme télécommande."},
      word: { title: 'Nodus Copilot pour Microsoft Word', body: 'Écrivez dans Word avec votre corpus à côté et les citations de votre bibliothèque.' },
      zotero: { title: 'Zotero', body: 'Synchronisez vos collections et travaillez depuis le plugin Nodus dans Zotero.' },
      mcp: { title: 'MCP et Nodus Server', body: 'Ouvrez votre coffre à d’autres assistants IA et publiez-le sur votre réseau.' },
    },
  },
  tr: {
    chooseTitle: 'Nasıl öğrenmeyi tercih edersiniz?',
    chooseLede: 'Nodus’u nasıl tanımak istediğinizi seçin. Diğer seçenek Ayarlar → Yardım bölümünde kalır.',
    videoOption: { title: 'Video eğitimleri izle', body: 'Nodus’tan çıkmadan duraklatabileceğiniz ve tam ekranda izleyebileceğiniz rehberli eğitimler.', badge: 'Önerilen' },
    textOption: { title: 'Kılavuzu kendi hızınızda okuyun', body: 'Bağlantılar ve uyarılarla bölümler; uygulama içinde ve çevrimdışı.' },
    gridTitle: 'Video eğitimler',
    gridLede: 'İstediğinizi açın. Açtığınız anda izlendi olarak işaretlenir.',
    more: 'Yakında daha fazla eğitim.',
    watched: 'İzlendi',
    markUnwatched: 'İzlenmedi olarak işaretle',
    openExternal: 'Tarayıcıda aç',
    hosting: 'Videolar YouTube’da barındırılıyor: birini açtığınızda bağlantınız onun sunucularına gider. Yazılı kılavuz çevrimdışı çalışır.',
    catalogueNote: 'Bu listeyi açtığınızda Nodus, yeni eğitim var mı diye kendi web sitesine bakar.',
    close: 'Kapat',
    play: 'Videoyu izle',
    tourVideo: 'Eğitimi videoda izle',
    categories: { introduction: 'Giriş', vaults: 'Kasalar', features: 'Özellikler', integrations: 'Entegrasyonlar' },
    allCategories: 'Tümü',
    searchPlaceholder: 'Eğitimlerde ara…',
    searchLabel: 'Eğitimler arasında ara',
    noMatches: 'Aramanızla eşleşen eğitim yok.',
    startHere: 'Buradan başlayın',
    startHereLede: 'Şu an ihtiyacınız olan tek eğitim bu. Kataloğun geri kalanı isteyene kadar bekler.',
    whereVaults: { title: 'Her kasanın eğitimi, onu oluşturduğunuzda', body: 'Akademik, soy ağacı, veritabanı veya öğretim kasası oluşturun; videosu ilk açtığınızda sizi bekliyor olacak.' },
    whereSettings: { title: 'Tüm eğitimler, Ayarlar’da', body: 'Ayarlar → Yardım tüm kataloğu bir arada tutar: Giriş, Kasalar, Özellikler ve Entegrasyonlar; arama ve filtrelerle.' },
    videos: {
      essentials: { title: 'Giriş ve ilk adımlar', body: 'Nodus nedir, kasalarla nasıl düzenlenir ve başlamak için ne gerekir.' },
      academic: { title: 'Akademik kasa', body: 'Kitaplığınızdan fikir, yazar ve ilişki grafiğine.' },
      genealogy: { title: 'Soy ağacı kasası', body: 'Aile ağacı, belge arşivi ve akrabalıklar; her biri kaynağıyla birlikte.' },
      databases: { title: 'Veritabanı kasası', body: 'İstediğiniz her şeyi düzenlemek için tablolar, görünümler, formüller ve ilişkiler.' },
      teaching: { title: 'Öğretim kasası', body: 'Dersler, ders programı, gruplar, rubrikler, sınavlar ve not defteri.' },
      nodi: { title: 'Nodi, yardımcınız', body: 'Sohbet etmek, bildirimlere bakmak ve yardımı açmak için Nodi’yi kullanma.' },
      toolkit: { title: 'Nodus Toolkit', body: 'Dosya dönüştürme, PDF sunumu ve yapay zekâyla görüntüden metin okuma.' },
      'pdf-presenter': {"title": "Nodus Presenter", "body": "PDF dosyalarınızı konuşmacı notları, canlı açıklamalar ve telefonunuzu uzaktan kumanda olarak kullanarak sunmayı öğrenin."},
      word: { title: 'Microsoft Word için Nodus Copilot', body: 'Word’de yazarken korpusunuz yanınızda, alıntılar kitaplığınızdan.' },
      zotero: { title: 'Zotero', body: 'Koleksiyonlarınızı eşitleyin ve Zotero içindeki Nodus eklentisinden çalışın.' },
      mcp: { title: 'MCP ve Nodus Server', body: 'Kasanızı diğer yapay zekâ asistanlarına açın ve ağınızda yayımlayın.' },
    },
  },
  de: {
    chooseTitle: 'Wie möchten Sie lernen?',
    chooseLede: 'Wählen Sie, wie Sie Nodus kennenlernen möchten. Die andere Option bleibt unter Einstellungen → Hilfe verfügbar.',
    videoOption: { title: 'Die Video-Tutorials ansehen', body: 'Geführte Tutorials, die Sie pausieren und im Vollbild ansehen können, ohne Nodus zu verlassen.', badge: 'Empfohlen' },
    textOption: { title: 'Die Anleitung in Ihrem Tempo lesen', body: 'Kapitel mit Links und Hinweisen, in der App und offline.' },
    gridTitle: 'Video-Tutorials',
    gridLede: 'Öffnen Sie eines davon. Es wird beim Öffnen als gesehen markiert.',
    more: 'Weitere Tutorials folgen bald.',
    watched: 'Gesehen',
    markUnwatched: 'Als nicht gesehen markieren',
    openExternal: 'Im Browser öffnen',
    hosting: 'Die Videos liegen auf YouTube: Wenn Sie eines öffnen, verbindet sich Ihr Gerät mit dessen Servern. Die schriftliche Anleitung funktioniert offline.',
    catalogueNote: 'Beim Öffnen dieser Liste fragt Nodus auf seiner Website nach neuen Tutorials.',
    close: 'Schließen',
    play: 'Video ansehen',
    tourVideo: 'Das Tutorial als Video ansehen',
    categories: { introduction: 'Einführung', vaults: 'Vaults', features: 'Funktionen', integrations: 'Integrationen' },
    allCategories: 'Alle',
    searchPlaceholder: 'Tutorials durchsuchen…',
    searchLabel: 'In den Tutorials suchen',
    noMatches: 'Kein Tutorial passt zu Ihrer Suche.',
    startHere: 'Hier anfangen',
    startHereLede: 'Mehr brauchen Sie jetzt nicht. Der übrige Katalog wartet, bis Sie ihn möchten.',
    whereVaults: { title: 'Das Tutorial jedes Vaults, beim Anlegen', body: 'Legen Sie einen akademischen, Genealogie-, Datenbank- oder Unterrichts-Vault an: sein Video wartet beim ersten Öffnen.' },
    whereSettings: { title: 'Alle Tutorials, in den Einstellungen', body: 'Einstellungen → Hilfe versammelt den ganzen Katalog — Einführung, Vaults, Funktionen und Integrationen — mit Suche und Filtern.' },
    videos: {
      essentials: { title: 'Einführung und erste Schritte', body: 'Was Nodus ist, wie Vaults es ordnen und was Sie zum Start brauchen.' },
      academic: { title: 'Der akademische Vault', body: 'Von Ihrer Bibliothek zu einem Graphen aus Ideen, Autoren und Beziehungen.' },
      genealogy: { title: 'Der Genealogie-Vault', body: 'Stammbaum, Dokumentenarchiv und Verwandtschaften – jeweils mit ihren Quellen.' },
      databases: { title: 'Der Datenbank-Vault', body: 'Tabellen, Ansichten, Formeln und Beziehungen, um alles zu ordnen.' },
      teaching: { title: 'Der Unterrichts-Vault', body: 'Kurse, Stundenplan, Gruppen, Rubriken, Prüfungen und Notenbuch.' },
      nodi: { title: 'Nodi, Ihre Begleitung', body: 'Wie Sie mit Nodi chatten, Hinweise sehen und die Hilfe öffnen.' },
      toolkit: { title: 'Das Nodus-Toolkit', body: 'Dateien umwandeln, PDFs präsentieren und Text aus Bildern per KI lesen.' },
      'pdf-presenter': {"title": "Nodus Presenter", "body": "Präsentieren Sie Ihre PDFs mit Vortragsnotizen, Live-Anmerkungen und Ihrem Smartphone als Fernbedienung."},
      word: { title: 'Nodus Copilot für Microsoft Word', body: 'In Word schreiben, mit Ihrem Korpus daneben und Zitaten aus Ihrer Bibliothek.' },
      zotero: { title: 'Zotero', body: 'Sammlungen synchronisieren und mit dem Nodus-Plugin in Zotero arbeiten.' },
      mcp: { title: 'MCP und Nodus Server', body: 'Öffnen Sie Ihren Vault für andere KI-Assistenten und veröffentlichen Sie ihn im Netzwerk.' },
    },
  },
  it: {
    chooseTitle: 'Come preferisci imparare?',
    chooseLede: 'Scegli come conoscere Nodus. L’altra opzione resta disponibile in Impostazioni → Aiuto.',
    videoOption: { title: 'Guarda i tutorial video', body: 'Tutorial guidati che puoi mettere in pausa e vedere a schermo intero senza uscire da Nodus.', badge: 'Consigliato' },
    textOption: { title: 'Leggi la guida al tuo ritmo', body: 'Capitoli con link e avvisi, dentro l’app e offline.' },
    gridTitle: 'Tutorial video',
    gridLede: 'Apri quello che vuoi. Viene segnato come visto appena lo apri.',
    more: 'Altri tutorial in arrivo.',
    watched: 'Visto',
    markUnwatched: 'Segna come non visto',
    openExternal: 'Apri nel browser',
    hosting: 'I video sono ospitati su YouTube: aprirne uno contatta i suoi server. La guida scritta funziona offline.',
    catalogueNote: 'Aprendo questa lista, Nodus chiede al proprio sito se ci sono nuovi tutorial.',
    close: 'Chiudi',
    play: 'Guarda il video',
    tourVideo: 'Guarda il tutorial in video',
    categories: { introduction: 'Introduzione', vaults: 'Vault', features: 'Funzioni', integrations: 'Integrazioni' },
    allCategories: 'Tutti',
    searchPlaceholder: 'Cerca tra i tutorial…',
    searchLabel: 'Cerca tra i tutorial',
    noMatches: 'Nessun tutorial corrisponde alla tua ricerca.',
    startHere: 'Comincia da qui',
    startHereLede: 'È l’unico tutorial che ti serve adesso. Il resto del catalogo aspetta finché non lo vorrai.',
    whereVaults: { title: 'Il tutorial di ogni vault, quando lo crei', body: 'Crea un vault accademico, di genealogia, di database o di didattica: il suo video ti aspetta alla prima apertura.' },
    whereSettings: { title: 'Tutti i tutorial, nelle Impostazioni', body: 'Impostazioni → Aiuto raccoglie l’intero catalogo — Introduzione, Vault, Funzioni e Integrazioni — con ricerca e filtri.' },
    videos: {
      essentials: { title: 'Introduzione e primi passi', body: 'Che cos’è Nodus, come i vault lo organizzano e cosa serve per iniziare.' },
      academic: { title: 'Il vault accademico', body: 'Dalla tua biblioteca a un grafo di idee, autori e relazioni.' },
      genealogy: { title: 'Il vault di genealogia', body: 'Albero familiare, archivio di documenti e parentele, ognuna con le sue fonti.' },
      databases: { title: 'Il vault dei database', body: 'Tabelle, viste, formule e relazioni per organizzare quello che vuoi.' },
      teaching: { title: 'Il vault della didattica', body: 'Corsi, orario, gruppi, rubriche, esami e registro dei voti.' },
      nodi: { title: 'Nodi, il tuo compagno', body: 'Come usare Nodi per conversare, vedere gli avvisi e aprire la guida.' },
      toolkit: { title: 'Il Toolkit di Nodus', body: 'Convertire file, presentare PDF e leggere testo dalle immagini con l’IA.' },
      'pdf-presenter': {"title": "Nodus Presenter", "body": "Impara a presentare i tuoi PDF con note del relatore, annotazioni dal vivo e il telefono come telecomando."},
      word: { title: 'Nodus Copilot per Microsoft Word', body: 'Scrivi in Word con il tuo corpus accanto e le citazioni della tua biblioteca.' },
      zotero: { title: 'Zotero', body: 'Sincronizza le tue collezioni e lavora dal plugin Nodus dentro Zotero.' },
      mcp: { title: 'MCP e Nodus Server', body: 'Apri il tuo vault ad altri assistenti IA e pubblicalo sulla tua rete.' },
    },
  },
  pt: {
    chooseTitle: 'Como prefere aprender?',
    chooseLede: 'Escolha como quer conhecer o Nodus. A outra opção continua disponível em Definições → Ajuda.',
    videoOption: { title: 'Ver os tutoriais em vídeo', body: 'Tutoriais guiados que pode pausar e ver em ecrã inteiro sem sair do Nodus.', badge: 'Recomendado' },
    textOption: { title: 'Ler o guia ao seu ritmo', body: 'Capítulos com ligações e avisos, dentro da app e sem ligação.' },
    gridTitle: 'Tutoriais em vídeo',
    gridLede: 'Abra o que quiser. Fica marcado como visto assim que o abre.',
    more: 'Mais tutoriais em breve.',
    watched: 'Visto',
    markUnwatched: 'Marcar como não visto',
    openExternal: 'Abrir no navegador',
    hosting: 'Os vídeos estão alojados no YouTube: ao abrir um, a sua ligação contacta os servidores dele. O guia escrito funciona sem ligação.',
    catalogueNote: 'Ao abrir esta lista, o Nodus consulta o seu site para ver se há tutoriais novos.',
    close: 'Fechar',
    play: 'Ver o vídeo',
    tourVideo: 'Ver o tutorial em vídeo',
    categories: { introduction: 'Introdução', vaults: 'Cofres', features: 'Funcionalidades', integrations: 'Integrações' },
    allCategories: 'Todos',
    searchPlaceholder: 'Procurar tutoriais…',
    searchLabel: 'Procurar entre os tutoriais',
    noMatches: 'Nenhum tutorial corresponde à sua pesquisa.',
    startHere: 'Comece por aqui',
    startHereLede: 'É o único tutorial de que precisa agora. O resto do catálogo espera até lhe fazer falta.',
    whereVaults: { title: 'O tutorial de cada cofre, ao criá-lo', body: 'Crie um cofre académico, de genealogia, de bases de dados ou de docência: o vídeo espera-o na primeira abertura.' },
    whereSettings: { title: 'Todos os tutoriais, nas Definições', body: 'Definições → Ajuda reúne o catálogo completo — Introdução, Cofres, Funcionalidades e Integrações — com pesquisa e filtros.' },
    videos: {
      essentials: { title: 'Introdução e primeiros passos', body: 'O que é o Nodus, como os cofres o organizam e o que precisa para começar.' },
      academic: { title: 'O cofre académico', body: 'Da sua biblioteca a um grafo de ideias, autores e relações.' },
      genealogy: { title: 'O cofre de genealogia', body: 'Árvore familiar, arquivo de documentos e parentescos, cada um com as suas fontes.' },
      databases: { title: 'O cofre de bases de dados', body: 'Tabelas, vistas, fórmulas e relações para organizar o que quiser.' },
      teaching: { title: 'O cofre de docência', body: 'Cursos, horário, turmas, rubricas, exames e caderno de notas.' },
      nodi: { title: 'Nodi, o seu companheiro', body: 'Como usar o Nodi para conversar, ver avisos e abrir a ajuda.' },
      toolkit: { title: 'O Toolkit do Nodus', body: 'Converter ficheiros, apresentar PDF e ler texto de imagens com IA.' },
      'pdf-presenter': {"title": "Nodus Presenter", "body": "Aprenda a apresentar os seus PDF com notas do apresentador, anotações em direto e o telemóvel como comando."},
      word: { title: 'Nodus Copilot para Microsoft Word', body: 'Escreva no Word com o seu corpus ao lado e citações da sua biblioteca.' },
      zotero: { title: 'Zotero', body: 'Sincronize as suas coleções e trabalhe a partir do plugin Nodus dentro do Zotero.' },
      mcp: { title: 'MCP e Nodus Server', body: 'Abra o seu cofre a outros assistentes de IA e publique-o na sua rede.' },
    },
  },
  'pt-BR': {
    chooseTitle: 'Como você prefere aprender?',
    chooseLede: 'Escolha como quer conhecer o Nodus. A outra opção continua disponível em Configurações → Ajuda.',
    videoOption: { title: 'Assistir aos tutoriais em vídeo', body: 'Tutoriais guiados que você pode pausar e ver em tela cheia sem sair do Nodus.', badge: 'Recomendado' },
    textOption: { title: 'Ler o guia no seu ritmo', body: 'Capítulos com links e avisos, dentro do app e offline.' },
    gridTitle: 'Tutoriais em vídeo',
    gridLede: 'Abra o que quiser. Ele é marcado como visto assim que você abre.',
    more: 'Mais tutoriais em breve.',
    watched: 'Visto',
    markUnwatched: 'Marcar como não visto',
    openExternal: 'Abrir no navegador',
    hosting: 'Os vídeos ficam no YouTube: ao abrir um, sua conexão fala com os servidores dele. O guia escrito funciona offline.',
    catalogueNote: 'Ao abrir esta lista, o Nodus consulta o site dele para ver se há tutoriais novos.',
    close: 'Fechar',
    play: 'Assistir ao vídeo',
    tourVideo: 'Assistir ao tutorial em vídeo',
    categories: { introduction: 'Introdução', vaults: 'Cofres', features: 'Recursos', integrations: 'Integrações' },
    allCategories: 'Todos',
    searchPlaceholder: 'Buscar tutoriais…',
    searchLabel: 'Buscar entre os tutoriais',
    noMatches: 'Nenhum tutorial corresponde à sua busca.',
    startHere: 'Comece por aqui',
    startHereLede: 'É o único tutorial que você precisa agora. O resto do catálogo espera até você querer.',
    whereVaults: { title: 'O tutorial de cada cofre, ao criá-lo', body: 'Crie um cofre acadêmico, de genealogia, de bancos de dados ou de docência: o vídeo espera na primeira abertura.' },
    whereSettings: { title: 'Todos os tutoriais, nas Configurações', body: 'Configurações → Ajuda reúne o catálogo completo — Introdução, Cofres, Recursos e Integrações — com busca e filtros.' },
    videos: {
      essentials: { title: 'Introdução e primeiros passos', body: 'O que é o Nodus, como os cofres organizam tudo e o que você precisa para começar.' },
      academic: { title: 'O cofre acadêmico', body: 'Da sua biblioteca a um grafo de ideias, autores e relações.' },
      genealogy: { title: 'O cofre de genealogia', body: 'Árvore genealógica, arquivo de documentos e parentescos, cada um com suas fontes.' },
      databases: { title: 'O cofre de bancos de dados', body: 'Tabelas, visões, fórmulas e relações para organizar o que você quiser.' },
      teaching: { title: 'O cofre de docência', body: 'Cursos, horário, turmas, rubricas, provas e diário de notas.' },
      nodi: { title: 'Nodi, seu companheiro', body: 'Como usar o Nodi para conversar, ver avisos e abrir a ajuda.' },
      toolkit: { title: 'O Toolkit do Nodus', body: 'Converter arquivos, apresentar PDF e ler texto de imagens com IA.' },
      'pdf-presenter': {"title": "Nodus Presenter", "body": "Aprenda a apresentar seus PDFs com notas do apresentador, anotações ao vivo e o celular como controle remoto."},
      word: { title: 'Nodus Copilot para Microsoft Word', body: 'Escreva no Word com seu corpus ao lado e citações da sua biblioteca.' },
      zotero: { title: 'Zotero', body: 'Sincronize suas coleções e trabalhe pelo plugin do Nodus dentro do Zotero.' },
      mcp: { title: 'MCP e Nodus Server', body: 'Abra seu cofre para outros assistentes de IA e publique na sua rede.' },
    },
  },
  zh: {
    chooseTitle: '你想怎么上手？',
    chooseLede: '选择你想了解 Nodus 的方式。另一种方式随时可在「设置 → 帮助」中使用。',
    videoOption: { title: '观看视频教程', body: '可暂停、可全屏的引导教程，无需离开 Nodus。', badge: '推荐' },
    textOption: { title: '按自己的节奏阅读指南', body: '带链接和提示的章节，在应用内，离线也能读。' },
    gridTitle: '视频教程',
    gridLede: '想看哪个就打开。打开后会自动标记为已看。',
    more: '更多教程即将推出。',
    watched: '已看',
    markUnwatched: '标记为未看',
    openExternal: '在浏览器中打开',
    hosting: '视频托管在 YouTube：打开任一视频都会连接其服务器。文字指南可离线使用。',
    catalogueNote: '打开这份列表时，Nodus 会向自己的网站查询是否有新教程。',
    close: '关闭',
    play: '观看视频',
    tourVideo: '观看视频教程',
    categories: { introduction: '介绍', vaults: '资料库', features: '功能', integrations: '集成' },
    allCategories: '全部',
    searchPlaceholder: '搜索教程…',
    searchLabel: '在教程中搜索',
    noMatches: '没有教程符合你的搜索。',
    startHere: '从这里开始',
    startHereLede: '现在你只需要这一个教程。其余内容会在你需要时等着你。',
    whereVaults: { title: '每个资料库的教程，在创建时出现', body: '创建学术、族谱、数据库或教学资料库后，第一次打开时它的视频就在那里。' },
    whereSettings: { title: '所有教程都在设置里', body: '「设置 → 帮助」汇集了完整目录——介绍、资料库、功能与集成——并带有搜索和筛选。' },
    videos: {
      essentials: { title: '介绍与第一步', body: 'Nodus 是什么、资料库如何组织，以及开始前需要准备什么。' },
      academic: { title: '学术资料库', body: '把你的文献库变成想法、作者与关系的图谱。' },
      genealogy: { title: '族谱资料库', body: '家族树、文献档案与亲属关系，每一项都附有来源。' },
      databases: { title: '数据库资料库', body: '用表格、视图、公式与关联整理任何内容。' },
      teaching: { title: '教学资料库', body: '课程、课表、班级、评分表、考试与成绩册。' },
      nodi: { title: '认识 Nodi', body: '用 Nodi 聊天、查看提醒并打开帮助。' },
      toolkit: { title: 'Nodus 工具箱', body: '转换文件、演示 PDF，并用 AI 识别图片中的文字。' },
      'pdf-presenter': {"title": "Nodus Presenter", "body": "学习如何演示 PDF，使用演讲者备注、实时批注和手机遥控。"},
      word: { title: 'Word 版 Nodus Copilot', body: '在 Word 中写作，语料就在旁边，引用直接来自你的文献库。' },
      zotero: { title: 'Zotero', body: '同步你的分类，并在 Zotero 内使用 Nodus 插件工作。' },
      mcp: { title: 'MCP 与 Nodus Server', body: '把资料库开放给其他 AI 助手，并在你的网络中发布。' },
    },
  },
  'zh-CN': {
    chooseTitle: '你更喜欢哪种学习方式？',
    chooseLede: '选择你想了解Nodus的方式。另一种方式随时可在「设置 → 帮助」中使用。',
    videoOption: { title: '观看视频教程', body: '可暂停、可全屏播放的引导式教程，无需离开Nodus。', badge: '推荐' },
    textOption: { title: '按自己的节奏阅读指南', body: '章节包含链接和提示，在应用内即可阅读，也支持离线。' },
    gridTitle: '视频教程',
    gridLede: '随意打开任意一个。打开后即会标记为已观看。',
    more: '更多教程即将推出。',
    watched: '已观看',
    markUnwatched: '标记为未观看',
    openExternal: '在浏览器中打开',
    hosting: '视频托管在YouTube上：打开任一视频都会连接其服务器。文字指南可离线使用。',
    catalogueNote: '打开这份列表时，Nodus会向自己的网站查询是否有新教程。',
    close: '关闭',
    play: '观看视频',
    tourVideo: '观看视频教程',
    categories: { introduction: '介绍', vaults: '资料库', features: '功能', integrations: '集成' },
    allCategories: '全部',
    searchPlaceholder: '搜索教程…',
    searchLabel: '搜索教程',
    noMatches: '没有符合搜索条件的教程。',
    startHere: '从这里开始',
    startHereLede: '现在你只需要这一个教程。其余内容会在你需要时等着你。',
    whereVaults: { title: '每个资料库的教程，会在创建时出现', body: '创建学术、族谱、数据库或教学资料库后，第一次打开时就能看到它的视频。' },
    whereSettings: { title: '所有教程都在设置里', body: '「设置 → 帮助」汇集了完整目录——介绍、资料库、功能与集成——并带有搜索和筛选。' },
    videos: {
      essentials: { title: '介绍与第一步', body: 'Nodus是什么、资料库如何组织内容，以及开始前需要准备什么。' },
      academic: { title: '学术资料库', body: '从你的文献库到由观点、作者和关系构成的图谱。' },
      genealogy: { title: '族谱资料库', body: '家族树、文献档案与亲属关系，每一项都附有来源。' },
      databases: { title: '数据库资料库', body: '用表格、视图、公式和关系整理任何内容。' },
      teaching: { title: '教学资料库', body: '课程、课表、班级、评分标准、考试和成绩册。' },
      nodi: { title: 'Nodi，你的伙伴', body: '如何使用Nodi聊天、查看通知和打开帮助。' },
      toolkit: { title: 'Nodus工具箱', body: '转换文件、演示PDF，并用AI从图片中识别文字。' },
      'pdf-presenter': { title: 'Nodus Presenter', body: '学习如何演示PDF，使用演讲者备注、实时批注和手机遥控。' },
      word: { title: 'Microsoft Word版Nodus Copilot', body: '在Word中写作，语料就在旁边，引注直接来自你的文献库。' },
      zotero: { title: 'Zotero', body: '同步你的收藏集，并在Zotero内通过Nodus插件工作。' },
      mcp: { title: 'MCP与Nodus Server', body: '把你的资料库开放给其他AI助手，并在你的网络中发布。' },
    },
  },
  'zh-TW': {
    chooseTitle: '你更喜歡哪種學習方式？',
    chooseLede: '選擇你想了解Nodus的方式。另一種方式隨時可在「設定 → 幫助」中使用。',
    videoOption: { title: '觀看影片教程', body: '可暫停、可全屏播放的引導式教程，無需離開Nodus。', badge: '推薦' },
    textOption: { title: '按自己的節奏閱讀指南', body: '章節包含連結和提示，在應用內即可閱讀，也支援離線。' },
    gridTitle: '影片教程',
    gridLede: '隨意開啟任意一個。開啟後即會標記為已觀看。',
    more: '更多教程即將推出。',
    watched: '已觀看',
    markUnwatched: '標記為未觀看',
    openExternal: '在瀏覽器中開啟',
    hosting: '影片託管在YouTube上：開啟任一影片都會連線其伺服器。文字指南可離線使用。',
    catalogueNote: '開啟這份列表時，Nodus會向自己的網站查詢是否有新教程。',
    close: '關閉',
    play: '觀看影片',
    tourVideo: '觀看影片教程',
    categories: { introduction: '介紹', vaults: '知識庫', features: '功能', integrations: '整合' },
    allCategories: '全部',
    searchPlaceholder: '搜尋教程…',
    searchLabel: '搜尋教程',
    noMatches: '沒有符合搜尋條件的教程。',
    startHere: '從這裡開始',
    startHereLede: '現在你只需要這一個教程。其餘內容會在你需要時等著你。',
    whereVaults: { title: '每個知識庫的教程，會在建立時出現', body: '建立學術、族譜、資料庫或教學知識庫後，第一次開啟時就能看到它的影片。' },
    whereSettings: { title: '所有教程都在設定裡', body: '「設定 → 幫助」彙集了完整目錄——介紹、知識庫、功能與整合——並帶有搜尋和篩選。' },
    videos: {
      essentials: { title: '介紹與第一步', body: 'Nodus是什麼、知識庫如何組織內容，以及開始前需要準備什麼。' },
      academic: { title: '學術知識庫', body: '從你的文獻庫到由觀點、作者和關係構成的圖譜。' },
      genealogy: { title: '族譜知識庫', body: '家族樹、文獻檔案與親屬關係，每一項都附有來源。' },
      databases: { title: '資料庫知識庫', body: '用表格、檢視、公式和關係整理任何內容。' },
      teaching: { title: '教學知識庫', body: '課程、課表、班級、評分標準、考試和成績冊。' },
      nodi: { title: 'Nodi，你的夥伴', body: '如何使用Nodi聊天、檢視通知和開啟幫助。' },
      toolkit: { title: 'Nodus工具箱', body: '轉換檔案、演示PDF，並用AI從圖片中識別文字。' },
      'pdf-presenter': { title: 'Nodus Presenter', body: '學習如何演示PDF，使用演講者備註、即時批註和手機遙控。' },
      word: { title: 'Microsoft Word版Nodus Copilot', body: '在Word中寫作，語料就在旁邊，引注直接來自你的文獻庫。' },
      zotero: { title: 'Zotero', body: '同步你的收藏集，並在Zotero內通過Nodus外掛工作。' },
      mcp: { title: 'MCP與Nodus Server', body: '把你的知識庫開放給其他AI助手，並在你的網路中釋出。' },
    },
  },
  ko: {
    chooseTitle: "어떻게 배우는 것을 선호하시나요?",
    chooseLede: "Nodus를 알아가는 방법을 선택하세요. 다른 옵션은 설정 → 도움말에서 계속 사용할 수 있습니다.",
    videoOption: {
    title: "비디오 튜토리얼 보기",
    body: "Nodus를 떠나지 않고도 일시 중지하고 전체 화면으로 시청할 수 있는 안내 튜토리얼입니다.",
    badge: "추천",
  },
    textOption: {
    title: "자신의 속도에 맞춰 가이드를 읽어보세요.",
    body: "앱 내부와 오프라인에서 링크와 경고가 포함된 챕터입니다.",
  },
    gridTitle: "비디오 튜토리얼",
    gridLede: "그 중 하나를여십시오. 각각은 열자마자 시청한 것으로 표시됩니다.",
    more: "가는 길에 더 많은 튜토리얼이 있습니다.",
    watched: "시청함",
    markUnwatched: "시청하지 않음으로 표시",
    openExternal: "브라우저에서 열기",
    hosting: "동영상은 YouTube에서 호스팅됩니다. 하나를 열면 해당 서버에 연결됩니다. 서면 가이드는 오프라인으로 작동합니다.",
    catalogueNote: "이 목록을 열면 Nodus 웹사이트에 새 튜토리얼이 게시되었는지 묻습니다.",
    close: "닫다",
    play: "비디오 보기",
    tourVideo: "비디오 튜토리얼 보기",
    categories: {
    introduction: "소개",
    vaults: "Vault",
    features: "특징",
    integrations: "통합",
  },
    allCategories: "모두",
    searchPlaceholder: "튜토리얼 검색…",
    searchLabel: "튜토리얼 검색",
    noMatches: "검색어와 일치하는 튜토리얼이 없습니다.",
    startHere: "여기서 시작하세요",
    startHereLede: "이것이 지금 당장 필요한 유일한 튜토리얼입니다. 나머지 카탈로그는 사용자가 원할 때까지 기다립니다.",
    whereVaults: {
    title: "각 Vault의 튜토리얼(생성 시)",
    body: "학술, 계보, 데이터베이스 또는 교육용 Vault를 생성하면 처음 열 때 비디오가 기다리고 있습니다.",
  },
    whereSettings: {
    title: "설정의 모든 튜토리얼",
    body: "설정 → 도움말에는 검색 및 필터와 함께 소개, Vault, 기능 및 통합 등 전체 카탈로그가 포함되어 있습니다.",
  },
    videos: {
    essentials: {
    title: "소개 및 첫 번째 단계",
    body: "Nodus가 무엇인지, Vault가 어떻게 구성되어 있는지, 시작하려면 무엇이 필요한지 알아보세요.",
  },
    academic: {
    title: "학술 Vault",
    body: "도서관에서 아이디어, 작가, 관계의 그래프까지.",
  },
    genealogy: {
    title: "족보 보관소",
    body: "가계도, 문서 보관소 및 친족 관계는 각각 해당 출처에 의해 뒷받침됩니다.",
  },
    databases: {
    title: "데이터베이스 저장소",
    body: "테이블, 보기, 수식 및 관계를 통해 원하는 것을 구성할 수 있습니다.",
  },
    teaching: {
    title: "가르치는 Vault",
    body: "코스, 시간표, 그룹, 기준표, 시험 및 성적표.",
  },
    nodi: {
    title: "Nodi, 당신의 동반자",
    body: "Nodi를 사용하여 채팅하고, 알림을 확인하고, 도움말을 여는 방법.",
  },
    toolkit: {
    title: "Nodus 툴킷",
    body: "AI를 사용하여 파일을 변환하고, PDF를 제시하고, 이미지에서 텍스트를 읽어보세요.",
  },
    "pdf-presenter": {
    title: "PDF 발표자",
    body: "발표자 노트, 실시간 주석, 휴대폰을 리모컨으로 사용하여 PDF를 프레젠테이션하는 방법을 알아보세요.",
  },
    word: {
    title: "Microsoft Word용 Nodus Copilot",
    body: "코퍼스와 라이브러리의 인용문을 함께 Word로 작성하세요.",
  },
    zotero: {
    title: "Zotero",
    body: "컬렉션을 동기화하고 Zotero 내부의 Nodus 플러그인에서 작업하세요.",
  },
    mcp: {
    title: "MCP 및 Nodus 서버",
    body: "다른 AI 보조자에게 Vault를 열고 네트워크에 게시하세요.",
  },
  },
  },
  ja: {
    chooseTitle: 'どの方法で学びますか？',
    chooseLede: 'Nodusを知る方法を選んでください。もう一方は「設定 → ヘルプ」からいつでも使えます。',
    videoOption: { title: '動画チュートリアルを見る', body: '一時停止も全画面もできるガイド付き動画。Nodusを離れずに視聴できます。', badge: 'おすすめ' },
    textOption: { title: '自分のペースでガイドを読む', body: 'リンクと注意書きのある章立て。アプリ内で、オフラインでも読めます。' },
    gridTitle: '動画チュートリアル',
    gridLede: '好きなものを開いてください。開いた時点で視聴済みになります。',
    more: 'チュートリアルは今後も追加されます。',
    watched: '視聴済み',
    markUnwatched: '未視聴にする',
    openExternal: 'ブラウザーで開く',
    hosting: '動画はYouTubeにあります。開くとそのサーバーに接続します。文章のガイドはオフラインでも使えます。',
    catalogueNote: 'このリストを開くと、Nodusは自身のサイトに新しいチュートリアルがあるか問い合わせます。',
    close: '閉じる',
    play: '動画を見る',
    tourVideo: 'チュートリアルを動画で見る',
    categories: { introduction: 'はじめに', vaults: 'Vault', features: '機能', integrations: '連携' },
    allCategories: 'すべて',
    searchPlaceholder: 'チュートリアルを検索…',
    searchLabel: 'チュートリアルを検索',
    noMatches: '検索に一致するチュートリアルはありません。',
    startHere: 'ここから始めましょう',
    startHereLede: '今必要なのはこれだけです。残りのチュートリアルは、必要になったときに待っています。',
    whereVaults: { title: '各Vaultのチュートリアルは作成時に', body: 'アカデミック・家系・データベース・授業のVaultを作ると、最初に開いたときにその動画が出てきます。' },
    whereSettings: { title: 'すべてのチュートリアルは設定に', body: '「設定 → ヘルプ」にカタログ全体（はじめに・Vault・機能・連携）が、検索とフィルター付きで並んでいます。' },
    videos: {
      essentials: { title: '紹介と最初の一歩', body: 'Nodusとは何か、Vaultでどう整理するか、始めるために必要なもの。' },
      academic: { title: 'アカデミックVault', body: '蔵書から、アイデア・著者・関係のグラフへ。' },
      genealogy: { title: '家系Vault', body: '家系図、資料アーカイブ、続柄。どれも出典つきで。' },
      databases: { title: 'データベースVault', body: 'テーブル、ビュー、数式、リレーションで何でも整理。' },
      teaching: { title: '授業Vault', body: 'コース、時間割、クラス、ルーブリック、試験、成績簿。' },
      nodi: { title: '相棒のNodi', body: 'Nodiで会話し、通知を確認し、ヘルプを開く方法。' },
      toolkit: { title: 'Nodusツールキット', body: 'ファイル変換、PDFのプレゼン、AIによる画像からの文字読み取り。' },
      'pdf-presenter': {"title": "Nodus Presenter", "body": "発表者ノート、ライブ注釈、スマートフォンのリモコン機能を使って PDF を発表する方法を学びましょう。"},
      word: { title: 'Microsoft Word版 Nodus Copilot', body: 'Wordで書きながら、隣にコーパス。引用は蔵書から。' },
      zotero: { title: 'Zotero', body: 'コレクションを同期し、Zotero内のNodusプラグインから作業。' },
      mcp: { title: 'MCPとNodus Server', body: 'Vaultを他のAIアシスタントに開き、ネットワークに公開。' },
    },
  },
  ru: {
    chooseTitle: 'Как вам удобнее учиться?',
    chooseLede: 'Выберите, как познакомиться с Nodus. Второй вариант всегда доступен в «Настройки → Помощь».',
    videoOption: { title: 'Смотреть видеоуроки', body: 'Уроки с пояснениями: можно ставить на паузу и открывать на весь экран, не выходя из Nodus.', badge: 'Рекомендуем' },
    textOption: { title: 'Читать руководство в своём темпе', body: 'Главы со ссылками и предупреждениями — в приложении и офлайн.' },
    gridTitle: 'Видеоуроки',
    gridLede: 'Откройте любой. Он отмечается как просмотренный сразу при открытии.',
    more: 'Скоро будут новые уроки.',
    watched: 'Просмотрен',
    markUnwatched: 'Отметить как непросмотренный',
    openExternal: 'Открыть в браузере',
    hosting: 'Видео размещены на YouTube: при открытии устройство соединяется с его серверами. Текстовое руководство работает офлайн.',
    catalogueNote: 'При открытии этого списка Nodus запрашивает у своего сайта, появились ли новые уроки.',
    close: 'Закрыть',
    play: 'Смотреть видео',
    tourVideo: 'Посмотреть урок в видео',
    categories: { introduction: 'Введение', vaults: 'Хранилища', features: 'Возможности', integrations: 'Интеграции' },
    allCategories: 'Все',
    searchPlaceholder: 'Искать среди уроков…',
    searchLabel: 'Поиск по урокам',
    noMatches: 'Ни один урок не совпадает с запросом.',
    startHere: 'Начните отсюда',
    startHereLede: 'Сейчас достаточно этого урока. Остальной каталог подождёт, пока не понадобится.',
    whereVaults: { title: 'Урок для каждого хранилища — при его создании', body: 'Создайте академическое, генеалогическое, хранилище баз данных или преподавательское: его видео появится при первом открытии.' },
    whereSettings: { title: 'Все уроки — в настройках', body: '«Настройки → Помощь» собирают весь каталог — Введение, Хранилища, Возможности и Интеграции — с поиском и фильтрами.' },
    videos: {
      essentials: { title: 'Знакомство и первые шаги', body: 'Что такое Nodus, как хранилища его организуют и что нужно для начала.' },
      academic: { title: 'Академическое хранилище', body: 'От вашей библиотеки к графу идей, авторов и связей.' },
      genealogy: { title: 'Генеалогическое хранилище', body: 'Семейное древо, архив документов и родственные связи — со ссылками на источники.' },
      databases: { title: 'Хранилище баз данных', body: 'Таблицы, представления, формулы и связи, чтобы упорядочить что угодно.' },
      teaching: { title: 'Преподавательское хранилище', body: 'Курсы, расписание, группы, рубрики, экзамены и журнал оценок.' },
      nodi: { title: 'Ноди, ваш помощник', body: 'Как общаться с Ноди, смотреть уведомления и открывать справку.' },
      toolkit: { title: 'Nodus Toolkit', body: 'Конвертация файлов, показ PDF и распознавание текста на изображениях с ИИ.' },
      'pdf-presenter': {"title": "Nodus Presenter", "body": "Узнайте, как показывать PDF с заметками докладчика, аннотациями в реальном времени и телефоном в роли пульта."},
      word: { title: 'Nodus Copilot для Microsoft Word', body: 'Пишите в Word: корпус рядом, цитаты — прямо из вашей библиотеки.' },
      zotero: { title: 'Zotero', body: 'Синхронизируйте коллекции и работайте через плагин Nodus внутри Zotero.' },
      mcp: { title: 'MCP и Nodus Server', body: 'Откройте хранилище другим ИИ-ассистентам и опубликуйте его в своей сети.' },
    },
  },
  uk: {
    chooseTitle: 'Як вам зручніше вчитися?',
    chooseLede: 'Виберіть, як познайомитися з Nodus. Другий варіант завжди доступний у «Налаштування → Довідка».',
    videoOption: { title: 'Дивитися відеоуроки', body: 'Уроки з поясненнями: можна ставити на паузу й відкривати на весь екран, не виходячи з Nodus.', badge: 'Рекомендуємо' },
    textOption: { title: 'Читати посібник у своєму темпі', body: 'Розділи з посиланнями та застереженнями — у застосунку й офлайн.' },
    gridTitle: 'Відеоуроки',
    gridLede: 'Відкрийте будь-який. Він позначається як переглянутий одразу після відкриття.',
    more: 'Скоро з’являться нові уроки.',
    watched: 'Переглянуто',
    markUnwatched: 'Позначити як непереглянутий',
    openExternal: 'Відкрити у браузері',
    hosting: 'Відео розміщені на YouTube: коли ви відкриваєте одне з них, ваш пристрій з’єднується з його серверами. Текстовий посібник працює офлайн.',
    catalogueNote: 'Коли ви відкриваєте цей список, Nodus запитує на своєму сайті, чи з’явилися нові уроки.',
    close: 'Закрити',
    play: 'Дивитися відео',
    tourVideo: 'Подивитися урок у відео',
    categories: { introduction: 'Вступ', vaults: 'Сховища', features: 'Можливості', integrations: 'Інтеграції' },
    allCategories: 'Усі',
    searchPlaceholder: 'Шукати серед уроків…',
    searchLabel: 'Пошук по уроках',
    noMatches: 'Жоден урок не відповідає запиту.',
    startHere: 'Почніть звідси',
    startHereLede: 'Наразі достатньо цього уроку. Решта каталогу зачекає, доки знадобиться.',
    whereVaults: { title: 'Урок для кожного сховища — під час створення', body: 'Створіть академічне, генеалогічне, сховище баз даних чи викладацьке: його відео з’явиться під час першого відкриття.' },
    whereSettings: { title: 'Усі уроки — у налаштуваннях', body: '«Налаштування → Довідка» збирають увесь каталог — Вступ, Сховища, Можливості та Інтеграції — з пошуком і фільтрами.' },
    videos: {
      essentials: { title: 'Знайомство та перші кроки', body: 'Що таке Nodus, як сховища його впорядковують і що потрібно для початку.' },
      academic: { title: 'Академічне сховище', body: 'Від вашої бібліотеки до графа ідей, авторів і зв’язків.' },
      genealogy: { title: 'Генеалогічне сховище', body: 'Родове дерево, архів документів і родинні зв’язки — з посиланнями на джерела.' },
      databases: { title: 'Сховище баз даних', body: 'Таблиці, подання, формули та зв’язки, щоб упорядкувати будь-що.' },
      teaching: { title: 'Викладацьке сховище', body: 'Курси, розклад, групи, рубрики, іспити та журнал оцінок.' },
      nodi: { title: 'Ноді, ваш помічник', body: 'Як спілкуватися з Ноді, дивитися повідомлення й відкривати довідку.' },
      toolkit: { title: 'Nodus Toolkit', body: 'Конвертація файлів, показ PDF і розпізнавання тексту на зображеннях за допомогою ШІ.' },
      'pdf-presenter': {"title": "Nodus Presenter", "body": "Дізнайтеся, як презентувати PDF із нотатками доповідача, анотаціями наживо та телефоном як пультом."},
      word: { title: 'Nodus Copilot для Microsoft Word', body: 'Пишіть у Word: корпус поруч, цитати — просто з вашої бібліотеки.' },
      zotero: { title: 'Zotero', body: 'Синхронізуйте колекції та працюйте через плагін Nodus усередині Zotero.' },
      mcp: { title: 'MCP і Nodus Server', body: 'Відкрийте сховище іншим ШІ-асистентам і опублікуйте його у вашій мережі.' },
    },
  },
};

export function tutorialVideoCopy(language: TutorialLanguage): TutorialVideoCopy {
  return COPY[language] ?? COPY.en;
}

/** Every language this build can serve, in the order the guide offers them. */
export const TUTORIAL_COPY_LANGUAGES = Object.keys(COPY) as TutorialLanguage[];

/** A video's title and description, wherever they come from. */
export function videoCopyFor(video: TutorialVideo, language: TutorialLanguage): { title: string; body: string } {
  if (video.copy) {
    const own = video.copy[language] ?? video.copy.en ?? Object.values(video.copy)[0];
    if (own) return own;
  }
  const table = tutorialVideoCopy(language).videos as Record<string, { title: string; body: string } | undefined>;
  // The slug is a poor title, but a card with no title at all is worse — and this is
  // only reachable for a catalogue entry that shipped without any copy.
  return table[video.id] ?? { title: video.id, body: '' };
}

// ── shelves, filtering and search ───────────────────────────────────────────────

/**
 * Accent-insensitive, case-insensitive folding, so "genealogia" finds «genealogía» and
 * "einfuhrung" finds "Einführung". `NFD` splits the accent off the letter and the range
 * strips the combining marks; scripts without them (Chinese, Japanese) are untouched.
 */
function fold(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/** Does this video answer the query, by title, description or shelf name? */
export function tutorialVideoMatches(video: TutorialVideo, language: TutorialLanguage, query: string): boolean {
  const needle = fold(query);
  if (!needle) return true;
  const meta = videoCopyFor(video, language);
  const haystack = fold(`${meta.title} ${meta.body} ${tutorialVideoCopy(language).categories[video.category]} ${video.id}`);
  // Every word has to appear somewhere, so "vault teaching" works in either order.
  return needle.split(/\s+/).every((word) => haystack.includes(word));
}

export interface TutorialVideoShelf {
  category: TutorialCategory;
  videos: TutorialVideo[];
}

/**
 * The catalogue arranged for display: introduction, then vaults, features and
 * integrations, each in `order`. Empty shelves are dropped so a filtered view never
 * shows a heading with nothing under it.
 */
export function tutorialVideoShelves(
  videos: readonly TutorialVideo[],
  options: { language?: TutorialLanguage; category?: TutorialCategory | null; query?: string } = {},
): TutorialVideoShelf[] {
  const { language = 'en', category = null, query = '' } = options;
  const kept = videos.filter((video) => (
    (!category || video.category === category) && tutorialVideoMatches(video, language, query)
  ));
  return TUTORIAL_CATEGORIES
    .map((shelf) => ({ category: shelf, videos: kept.filter((video) => video.category === shelf).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)) }))
    .filter((shelf) => shelf.videos.length > 0);
}

// ── the list, refreshable without shipping a release ────────────────────────────
//
// The three videos above are compiled in, so the grid renders instantly and offline.
// A published catalogue can add to them: the app asks for it from the MAIN process
// when a grid is opened (never at startup, and never from the renderer, which would
// mean widening the CSP for a second remote host).
//
// Everything in that file is untrusted input from the network, so it is validated
// rather than trusted: ids are slugs, video ids must have YouTube's exact shape (no
// arbitrary URL can be smuggled in), and posters are NOT taken from it at all — a
// remote CSS value in a `style` attribute could fetch a remote image and undo the
// promise that an unopened grid makes no requests.

export const TUTORIAL_CATALOGUE_URL = 'https://nodusresearch.com/tutorials.json';

const YOUTUBE_ID_SHAPE = /^[A-Za-z0-9_-]{11}$/;
const SLUG_SHAPE = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** Icons a catalogue entry may pick; anything else falls back to the play glyph. */
const CATALOGUE_ICONS = ['play', 'network', 'archive', 'sparkles', 'graduation', 'layers', 'tree', 'table', 'chartBar', 'microphone', 'image', 'tools', 'star', 'file', 'presentation', 'book', 'plug', 'puzzle', 'globe', 'link'];
/** Posters handed out, in order, to entries this build knows nothing about. */
const CATALOGUE_POSTERS = [
  'linear-gradient(140deg, #155e75 0%, #1e3a8a 55%, #111827 100%)',
  'linear-gradient(140deg, #6d28d9 0%, #1e3a8a 55%, #0f172a 100%)',
  'linear-gradient(140deg, #0f766e 0%, #3730a3 55%, #111827 100%)',
  'linear-gradient(140deg, #9d174d 0%, #4338ca 55%, #0f172a 100%)',
];

const MAX_CATALOGUE_ENTRIES = 40;
const MAX_TITLE = 120;
const MAX_BODY = 320;

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function parseEntryCopy(value: unknown): TutorialVideo['copy'] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const copy: NonNullable<TutorialVideo['copy']> = {};
  for (const [language, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!TUTORIAL_COPY_LANGUAGES.includes(language as TutorialLanguage)) continue;
    if (!entry || typeof entry !== 'object') continue;
    const title = cleanString((entry as Record<string, unknown>).title, MAX_TITLE);
    const body = cleanString((entry as Record<string, unknown>).body, MAX_BODY);
    if (!title || !body) continue;
    copy[language as TutorialLanguage] = { title, body };
  }
  return Object.keys(copy).length > 0 ? copy : null;
}

function parseEntry(value: unknown, index: number): TutorialVideo | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  const id = typeof entry.id === 'string' && SLUG_SHAPE.test(entry.id) ? entry.id : null;
  const youtubeId = typeof entry.youtubeId === 'string' && YOUTUBE_ID_SHAPE.test(entry.youtubeId) ? entry.youtubeId : null;
  if (!id || !youtubeId) return null;
  const order = typeof entry.order === 'number' && Number.isFinite(entry.order) ? entry.order : index + 1;
  const builtIn = TUTORIAL_VIDEOS.find((video) => video.id === id);
  const copy = parseEntryCopy(entry.copy);
  // A brand-new entry with no usable copy would render as a bare slug: drop it.
  if (!builtIn && !copy) return null;
  // An unlabelled entry lands on a shelf rather than vanishing: naming a vault is
  // itself the strongest signal, and everything else is a feature until told otherwise.
  const category: TutorialCategory = isTutorialCategory(entry.category)
    ? entry.category
    : builtIn?.category ?? (isVaultType(entry.vaultType) ? 'vaults' : 'features');
  return {
    id,
    youtubeId,
    order,
    category,
    icon: typeof entry.icon === 'string' && CATALOGUE_ICONS.includes(entry.icon) ? entry.icon : builtIn?.icon ?? 'play',
    poster: builtIn?.poster ?? CATALOGUE_POSTERS[index % CATALOGUE_POSTERS.length],
    ...(isVaultType(entry.vaultType) ? { vaultType: entry.vaultType } : builtIn?.vaultType ? { vaultType: builtIn.vaultType } : {}),
    ...(copy ? { copy } : {}),
  };
}

export interface TutorialCatalogueParse {
  videos: TutorialVideo[];
  /** Entries thrown away for failing validation. Logged, never silently swallowed. */
  rejected: number;
}

export function parseTutorialCatalogue(raw: unknown): TutorialCatalogueParse {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { videos?: unknown }).videos)
      ? ((raw as { videos: unknown[] }).videos)
      : null;
  if (!list) return { videos: [], rejected: 0 };
  const videos: TutorialVideo[] = [];
  let rejected = 0;
  for (const [index, item] of list.slice(0, MAX_CATALOGUE_ENTRIES).entries()) {
    const parsed = parseEntry(item, index);
    if (parsed && !videos.some((video) => video.id === parsed.id)) videos.push(parsed);
    else rejected += 1;
  }
  return { videos, rejected };
}

/**
 * Built-in list plus whatever the catalogue adds, ordered by `order`.
 *
 * A published entry can update a built-in video's copy or its vault, but it can never
 * make one disappear: a truncated or half-written file must not hide the tutorial a
 * user is looking for. Retiring a video is rare enough to ride a release.
 */
export function mergeTutorialCatalogue(remote: readonly TutorialVideo[]): TutorialVideo[] {
  const merged = new Map<string, TutorialVideo>();
  for (const video of TUTORIAL_VIDEOS) merged.set(video.id, video);
  for (const video of remote) merged.set(video.id, { ...merged.get(video.id), ...video });
  return [...merged.values()].sort((a, b) => (
    TUTORIAL_CATEGORIES.indexOf(a.category) - TUTORIAL_CATEGORIES.indexOf(b.category)
    || a.order - b.order
    || a.id.localeCompare(b.id)
  ));
}
