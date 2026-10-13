import { motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import type { AppLanguage } from '@shared/types';
import { Icon } from '../../src/components/ui';
import { NodiAvatar } from '../../src/components/nodi/NodiAvatar';
import homeShot from '../../src/assets/mobile-teaser/01-home.webp';
import libraryShot from '../../src/assets/mobile-teaser/02-library.webp';
import workShot from '../../src/assets/mobile-teaser/03-work.webp';
import ideaShot from '../../src/assets/mobile-teaser/04-idea.webp';
import searchShot from '../../src/assets/mobile-teaser/05-search.webp';
import argumentShot from '../../src/assets/mobile-teaser/06-argument-map.webp';
import gapsShot from '../../src/assets/mobile-teaser/07-gaps.webp';
import deepResearchShot from '../../src/assets/mobile-teaser/08-deep-research.webp';
import byoModelShot from '../../src/assets/mobile-teaser/09-byo-model.webp';

/**
 * "A tease of what's coming" — the one-time look at Nodus on a phone.
 *
 * Unlike the other update tours, this one announces something that does NOT exist in
 * the app yet, so there is no tutorial version to gate it against: a fresh 3.2.4
 * install has seen no more of the mobile app than a five-year user has. It is gated on
 * the release alone plus its own sentinel, and shows exactly once.
 *
 * The screenshots are the App Store set, each carrying its English headline burnt into
 * the image. They are not re-rendered per language — the store listing they feed is
 * English only — so the interface around them says so and carries the translated label
 * for the screen being shown. The survey is a Google Form, also English only, and it is
 * the one outbound link here: nothing is sent anywhere until the user clicks it.
 *
 * Source images are 1320 x 2868 (~580 KB each); these are resampled to 420 px wide
 * WebP, which is ~20 KB each and still resolves the headline at the size the carousel
 * shows them.
 */

/** Only this release presents it. A later version must not resurrect the teaser. */
export const MOBILE_TEASER_RELEASE = '3.2.4';
const SEEN_KEY = `nodus.mobileTeaserSeen.${MOBILE_TEASER_RELEASE}`;
/**
 * The canonical form URL, NOT the forms.gle short link it was shared as.
 *
 * `forms.gle` is a Firebase Dynamic Links domain, and that service has been retired: a
 * short link that fails to resolve does not fall back to the form, it lands on Google's
 * "Invalid Dynamic Link" error page. Resolving it once here and shipping the destination
 * removes the indirection entirely — one hop, no third-party redirector, and the link
 * cannot rot separately from the form it points at.
 */
export const MOBILE_TEASER_SURVEY_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSf-wHGtAbQV3Kc0J1hgzXBpj8oV1ky9xbuyNJMQ467X7rUYBw/viewform';

/** The slide order is the App Store order: what the app is, then what it can do. */
const SHOTS: readonly { src: string; key: SlideKey }[] = [
  { src: homeShot, key: 'home' },
  { src: libraryShot, key: 'library' },
  { src: workShot, key: 'work' },
  { src: ideaShot, key: 'idea' },
  { src: searchShot, key: 'search' },
  { src: argumentShot, key: 'argument' },
  { src: gapsShot, key: 'gaps' },
  { src: deepResearchShot, key: 'deepResearch' },
  { src: byoModelShot, key: 'model' },
];

type SlideKey = 'home' | 'library' | 'work' | 'idea' | 'search' | 'argument' | 'gaps' | 'deepResearch' | 'model';

interface TeaserCopy {
  badge: string;
  title: string;
  summary: string;
  eyebrow: string;
  heading: string;
  lede: string;
  status: string;
  surveyTitle: string;
  surveyBody: string;
  surveyCta: string;
  englishNote: string;
  previous: string;
  next: string;
  finish: string;
  slides: Record<SlideKey, string>;
}

const COPY: Record<AppLanguage, TeaserCopy> = {
  es: {
    badge: 'UN ADELANTO',
    title: 'Un adelanto de lo que viene',
    summary: 'Nodus está llegando al móvil. Esto es un vistazo a la aplicación, todavía sin fecha.',
    eyebrow: 'Nodus en el móvil',
    heading: 'Tu bóveda, en el bolsillo',
    lede: 'Publicas una bóveda desde el escritorio y la lees donde estés: obras, ideas, temas y autores, con su evidencia. La lectura es de solo lectura y lo que escribas en el teléfono se queda en el teléfono.',
    status: 'Todavía no se puede descargar. Estas capturas son de una versión en desarrollo y pueden cambiar.',
    surveyTitle: '¿Te interesaría?',
    surveyBody: 'Dinos si la usarías y qué esperarías de ella. Son dos minutos y ayuda a decidir qué se construye primero.',
    surveyCta: 'Responder la encuesta',
    englishNote: 'Las capturas y la encuesta están solo en inglés.',
    previous: 'Anterior',
    next: 'Siguiente',
    finish: 'Entendido',
    slides: {
      home: 'Inicio de la bóveda',
      library: 'Biblioteca',
      work: 'Ficha de una obra',
      idea: 'Una idea y su evidencia',
      search: 'Búsqueda',
      argument: 'Mapa de argumentos',
      gaps: 'Huecos',
      deepResearch: 'Deep Research',
      model: 'Tu propio modelo',
    },
  },
  en: {
    badge: 'SNEAK PEEK',
    title: 'A tease of what’s coming',
    summary: 'Nodus is coming to mobile. Here is a look at the app, with no date yet.',
    eyebrow: 'Nodus on your phone',
    heading: 'Your vault, in your pocket',
    lede: 'Publish a vault from the desktop and read it anywhere: works, ideas, themes and authors, with the evidence behind them. Reading is read-only, and whatever you write on the phone stays on the phone.',
    status: 'It is not downloadable yet. These captures come from a build in progress and may change.',
    surveyTitle: 'Would you use it?',
    surveyBody: 'Tell us whether you would use it and what you would expect from it. It takes two minutes and it helps decide what gets built first.',
    surveyCta: 'Take the survey',
    englishNote: 'The screenshots and the survey are in English only.',
    previous: 'Back',
    next: 'Next',
    finish: 'Got it',
    slides: {
      home: 'Vault home',
      library: 'Library',
      work: 'A work in detail',
      idea: 'An idea and its evidence',
      search: 'Search',
      argument: 'Argument map',
      gaps: 'Gaps',
      deepResearch: 'Deep Research',
      model: 'Bring your own model',
    },
  },
  fr: {
    badge: 'AVANT-GOÛT',
    title: 'Un avant-goût de ce qui arrive',
    summary: 'Nodus arrive sur mobile. Voici un aperçu de l’application, sans date pour l’instant.',
    eyebrow: 'Nodus sur votre téléphone',
    heading: 'Votre coffre, dans votre poche',
    lede: 'Publiez un coffre depuis le bureau et lisez-le où que vous soyez : œuvres, idées, thèmes et auteurs, avec les preuves qui les soutiennent. La lecture est en lecture seule, et ce que vous écrivez sur le téléphone y reste.',
    status: 'L’application n’est pas encore téléchargeable. Ces captures proviennent d’une version en cours et peuvent changer.',
    surveyTitle: 'Cela vous intéresserait-il ?',
    surveyBody: 'Dites-nous si vous l’utiliseriez et ce que vous en attendriez. Deux minutes suffisent, et cela aide à décider quoi construire en premier.',
    surveyCta: 'Répondre à l’enquête',
    englishNote: 'Les captures et l’enquête sont uniquement en anglais.',
    previous: 'Précédent',
    next: 'Suivant',
    finish: 'Compris',
    slides: {
      home: 'Accueil du coffre',
      library: 'Bibliothèque',
      work: 'Une œuvre en détail',
      idea: 'Une idée et ses preuves',
      search: 'Recherche',
      argument: 'Carte des arguments',
      gaps: 'Lacunes',
      deepResearch: 'Deep Research',
      model: 'Votre propre modèle',
    },
  },
  de: {
    badge: 'VORGESCHMACK',
    title: 'Ein Vorgeschmack auf das, was kommt',
    summary: 'Nodus kommt aufs Handy. Hier ein Blick auf die App, noch ohne Datum.',
    eyebrow: 'Nodus auf dem Handy',
    heading: 'Dein Tresor, in der Hosentasche',
    lede: 'Veröffentliche einen Tresor vom Desktop aus und lies ihn überall: Werke, Ideen, Themen und Autoren, samt der Belege dahinter. Gelesen wird nur lesend, und was du auf dem Handy schreibst, bleibt auf dem Handy.',
    status: 'Herunterladen lässt sie sich noch nicht. Diese Aufnahmen stammen aus einem laufenden Build und können sich ändern.',
    surveyTitle: 'Wäre das etwas für dich?',
    surveyBody: 'Sag uns, ob du sie nutzen würdest und was du von ihr erwartest. Zwei Minuten, und es hilft zu entscheiden, was zuerst gebaut wird.',
    surveyCta: 'An der Umfrage teilnehmen',
    englishNote: 'Die Screenshots und die Umfrage sind nur auf Englisch.',
    previous: 'Zurück',
    next: 'Weiter',
    finish: 'Verstanden',
    slides: {
      home: 'Tresor-Start',
      library: 'Bibliothek',
      work: 'Ein Werk im Detail',
      idea: 'Eine Idee und ihr Beleg',
      search: 'Suche',
      argument: 'Argumentkarte',
      gaps: 'Lücken',
      deepResearch: 'Deep Research',
      model: 'Dein eigenes Modell',
    },
  },
  pt: {
    badge: 'ANTEVISÃO',
    title: 'Uma antevisão do que aí vem',
    summary: 'O Nodus está a chegar ao telemóvel. Isto é um vislumbre da aplicação, ainda sem data.',
    eyebrow: 'O Nodus no telemóvel',
    heading: 'O teu cofre, no bolso',
    lede: 'Publicas um cofre a partir do computador e lê-lo onde estiveres: obras, ideias, temas e autores, com a evidência que os sustenta. A leitura é apenas de leitura, e o que escreveres no telemóvel fica no telemóvel.',
    status: 'Ainda não está disponível para descarregar. Estas capturas vêm de uma versão em curso e podem mudar.',
    surveyTitle: 'Terias interesse?',
    surveyBody: 'Diz-nos se a usarias e o que esperarias dela. São dois minutos e ajuda a decidir o que se constrói primeiro.',
    surveyCta: 'Responder ao inquérito',
    englishNote: 'As capturas e o inquérito estão apenas em inglês.',
    previous: 'Anterior',
    next: 'Seguinte',
    finish: 'Entendido',
    slides: {
      home: 'Início do cofre',
      library: 'Biblioteca',
      work: 'Uma obra em detalhe',
      idea: 'Uma ideia e a sua evidência',
      search: 'Pesquisa',
      argument: 'Mapa de argumentos',
      gaps: 'Lacunas',
      deepResearch: 'Deep Research',
      model: 'O teu próprio modelo',
    },
  },
  'pt-BR': {
    badge: 'PRÉVIA',
    title: 'Uma prévia do que vem por aí',
    summary: 'O Nodus está chegando ao celular. Isto é uma espiada no aplicativo, ainda sem data.',
    eyebrow: 'O Nodus no celular',
    heading: 'Seu cofre, no bolso',
    lede: 'Você publica um cofre no computador e lê onde estiver: obras, ideias, temas e autores, com a evidência por trás deles. A leitura é somente leitura, e o que você escrever no celular fica no celular.',
    status: 'Ainda não dá para baixar. Estas capturas vêm de uma versão em andamento e podem mudar.',
    surveyTitle: 'Você usaria?',
    surveyBody: 'Conte se usaria e o que esperaria dele. São dois minutos e ajuda a decidir o que construir primeiro.',
    surveyCta: 'Responder à pesquisa',
    englishNote: 'As capturas e a pesquisa estão apenas em inglês.',
    previous: 'Anterior',
    next: 'Próximo',
    finish: 'Entendi',
    slides: {
      home: 'Início do cofre',
      library: 'Biblioteca',
      work: 'Uma obra em detalhe',
      idea: 'Uma ideia e sua evidência',
      search: 'Busca',
      argument: 'Mapa de argumentos',
      gaps: 'Lacunas',
      deepResearch: 'Deep Research',
      model: 'Seu próprio modelo',
    },
  },
  it: {
    badge: 'ANTEPRIMA',
    title: 'Un assaggio di quel che arriva',
    summary: 'Nodus sta arrivando sul telefono. Ecco uno sguardo all’app, ancora senza data.',
    eyebrow: 'Nodus sul telefono',
    heading: 'Il tuo deposito, in tasca',
    lede: 'Pubblichi un deposito dal computer e lo leggi ovunque: opere, idee, temi e autori, con le prove che li sostengono. La lettura è di sola lettura, e quello che scrivi sul telefono resta sul telefono.',
    status: 'Non è ancora scaricabile. Queste immagini vengono da una versione in lavorazione e possono cambiare.',
    surveyTitle: 'Ti interesserebbe?',
    surveyBody: 'Dicci se la useresti e che cosa ti aspetteresti. Bastano due minuti e aiuta a decidere che cosa costruire per primo.',
    surveyCta: 'Rispondi al sondaggio',
    englishNote: 'Le immagini e il sondaggio sono solo in inglese.',
    previous: 'Indietro',
    next: 'Avanti',
    finish: 'Ho capito',
    slides: {
      home: 'Home del deposito',
      library: 'Biblioteca',
      work: 'Un’opera in dettaglio',
      idea: 'Un’idea e la sua prova',
      search: 'Ricerca',
      argument: 'Mappa degli argomenti',
      gaps: 'Lacune',
      deepResearch: 'Deep Research',
      model: 'Il tuo modello',
    },
  },
  tr: {
    badge: 'İLK BAKIŞ',
    title: 'Gelecek olanlardan bir tat',
    summary: 'Nodus telefona geliyor. Bu, uygulamaya bir bakış, henüz tarihi yok.',
    eyebrow: 'Telefonunuzda Nodus',
    heading: 'Kasanız, cebinizde',
    lede: 'Masaüstünden bir kasa yayımlayın ve nerede olursanız olun okuyun: eserler, fikirler, temalar ve yazarlar, arkalarındaki kanıtlarla birlikte. Okuma salt okunurdur ve telefonda yazdığınız her şey telefonda kalır.',
    status: 'Henüz indirilemiyor. Bu görüntüler geliştirilmekte olan bir sürümden geliyor ve değişebilir.',
    surveyTitle: 'İlginizi çeker miydi?',
    surveyBody: 'Kullanır mıydınız ve ondan ne beklerdiniz, bize söyleyin. İki dakika sürüyor ve önce neyin yapılacağına karar vermeye yardım ediyor.',
    surveyCta: 'Ankete katılın',
    englishNote: 'Ekran görüntüleri ve anket yalnızca İngilizcedir.',
    previous: 'Geri',
    next: 'İleri',
    finish: 'Anlaşıldı',
    slides: {
      home: 'Kasa ana ekranı',
      library: 'Kütüphane',
      work: 'Bir eser ayrıntısıyla',
      idea: 'Bir fikir ve kanıtı',
      search: 'Arama',
      argument: 'Argüman haritası',
      gaps: 'Boşluklar',
      deepResearch: 'Deep Research',
      model: 'Kendi modeliniz',
    },
  },
  'zh-CN': {
    badge: '先睹为快',
    title: '抢先一睹即将推出的新功能',
    summary: 'Nodus即将登陆移动端。以下是应用的预览，目前尚无发布日期。',
    eyebrow: '手机上的Nodus',
    heading: '把资料库装进口袋',
    lede: '从桌面端发布资料库，即可随处阅读：文献、观点、主题和作者，以及支撑它们的证据。阅读为只读模式，你在手机上写下的内容也只会留在手机里。',
    status: '目前尚无法下载。这些截图来自开发中的版本，可能会发生变化。',
    surveyTitle: '你会使用它吗？',
    surveyBody: '告诉我们你是否会使用它，以及你对它的期待。只需两分钟，有助于决定优先开发哪些功能。',
    surveyCta: '参与问卷调查',
    englishNote: '截图和问卷调查仅提供英文。',
    previous: '上一个',
    next: '下一个',
    finish: '知道了',
    slides: {
      home: '资料库首页',
      library: '文献库',
      work: '文献详情',
      idea: '观点及其证据',
      search: '搜索',
      argument: '论证图谱',
      gaps: '空白',
      deepResearch: 'Deep Research',
      model: '使用你自己的模型',
    },
  },
  'zh-TW': {
    badge: '先睹為快',
    title: '搶先一睹即將推出的新功能',
    summary: 'Nodus即將登陸移動端。以下是應用的預覽，目前尚無釋出日期。',
    eyebrow: '手機上的Nodus',
    heading: '把知識庫裝進口袋',
    lede: '從桌面端釋出知識庫，即可隨處閱讀：文獻、觀點、主題和作者，以及支撐它們的證據。閱讀為只讀模式，你在手機上寫下的內容也只會留在手機裡。',
    status: '目前尚無法下載。這些截圖來自開發中的版本，可能會發生變化。',
    surveyTitle: '你會使用它嗎？',
    surveyBody: '告訴我們你是否會使用它，以及你對它的期待。只需兩分鐘，有助於決定優先開發哪些功能。',
    surveyCta: '參與問卷調查',
    englishNote: '截圖和問卷調查僅提供英文。',
    previous: '上一個',
    next: '下一個',
    finish: '知道了',
    slides: {
      home: '知識庫首頁',
      library: '文獻庫',
      work: '文獻詳情',
      idea: '觀點及其證據',
      search: '搜尋',
      argument: '論證圖譜',
      gaps: '空白',
      deepResearch: 'Deep Research',
      model: '使用你自己的模型',
    },
  },
  ja: {
    badge: "スニークピーク",
    title: "これからのことをからかう",
    summary: "Nodus がモバイルに登場します。アプリの概要は次のとおりですが、日付はまだ決まっていません。",
    eyebrow: "携帯電話のNodus",
    heading: "あなたのVaultをポケットの中に",
    lede: "デスクトップからVaultを公開し、作品、アイデア、テーマ、著者を、その背後にある証拠とともにどこでも読むことができます。読み取りは読み取り専用で、携帯電話に書き込んだものはすべて携帯電話に残ります。",
    status: "まだダウンロードできません。これらのキャプチャは進行中のビルドから取得されたものであり、変更される可能性があります。",
    surveyTitle: "使ってみませんか？",
    surveyBody: "それを使用するかどうか、そしてそれに何を期待するかを教えてください。所要時間は2分で、何を最初に構築するかを決定するのに役立ちます。",
    surveyCta: "アンケートに回答してください",
    englishNote: "スクリーンショットとアンケートは英語のみです。",
    previous: "戻る",
    next: "次",
    finish: "わかった",
    slides: {
    home: "Vaultホーム",
    library: "ライブラリ",
    work: "詳しい作品",
    idea: "アイデアとその証拠",
    search: "検索",
    argument: "引数マップ",
    gaps: "ギャップ",
    deepResearch: "Deep Research",
    model: "自分のモデルを持ち込む",
  },
  },
  ko: {
    badge: '미리보기',
    title: '앞으로 나올 일에 대한 예고',
    summary: 'Nodus가 모바일로 출시됩니다. 아직 날짜가 표시되지 않은 앱을 살펴보세요.',
    eyebrow: '휴대전화의 Nodus',
    heading: '주머니 속 Vault',
    lede: '데스크톱에서 Vault를 게시하고 작품, 아이디어, 테마, 작가 등 어디에서나 그 뒤에 있는 증거와 함께 읽을 수 있습니다. 읽기는 읽기 전용이며 휴대전화에 쓴 내용은 휴대전화에 그대로 남아 있습니다.',
    status: '아직 다운로드할 수 없습니다. 이러한 캡처는 진행 중인 빌드에서 제공되며 변경될 수 있습니다.',
    surveyTitle: '그것을 사용하시겠습니까?',
    surveyBody: '당신이 그것을 사용할지 여부와 그것으로부터 무엇을 기대하는지 알려주십시오. 2분 정도 소요되며 무엇을 먼저 빌드할지 결정하는 데 도움이 됩니다.',
    surveyCta: '설문조사에 참여하세요',
    englishNote: '스크린샷과 설문조사는 영어로만 제공됩니다.',
    previous: '뒤로',
    next: '다음',
    finish: '알았어요',
    slides: {
    home: 'Vault 홈',
    library: '도서관',
    work: '작품을 자세히',
    idea: '아이디어와 그 증거',
    search: '검색',
    argument: '인수 맵',
    gaps: '격차',
    deepResearch: 'Deep Research',
    model: '자신의 모델을 가져와',
  },
  },
};

function shouldPresent(): boolean {
  if (__APP_VERSION__ !== MOBILE_TEASER_RELEASE) return false;
  try { return localStorage.getItem(SEEN_KEY) !== '1'; } catch { return true; }
}

function markSeen(): void {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* storage unavailable: it simply shows once more */ }
}

export function MobileTeaserGuide({
  uiLanguage,
  onSettled,
}: {
  uiLanguage: AppLanguage;
  onSettled: () => void;
}) {
  const [eligible] = useState(shouldPresent);
  const [index, setIndex] = useState(0);
  const copy = COPY[uiLanguage] ?? COPY.en;

  // Wraps in both directions: a carousel that dead-ends on the last shot invites the
  // reader to think the modal is stuck rather than finished.
  const step = useCallback((delta: number) => {
    setIndex((value) => (value + delta + SHOTS.length) % SHOTS.length);
  }, []);

  useEffect(() => { if (!eligible) onSettled(); }, [eligible, onSettled]);

  useEffect(() => {
    if (!eligible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') step(1);
      if (event.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [eligible, step]);

  if (!eligible) return null;

  const finish = () => { markSeen(); onSettled(); };
  const shot = SHOTS[index];

  return <motion.div className="toolkit-guide-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .22 }}>
    <motion.section
      className="toolkit-guide-cinema mobile-teaser-guide"
      data-testid="mobile-teaser-guide"
      data-teaser-slide={index}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-teaser-title"
      initial={{ opacity: 0, y: 28, scale: .96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: .46, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <header className="toolkit-guide-hero">
        <div className="toolkit-guide-aurora" aria-hidden="true" />
        <div className="toolkit-guide-hero-copy">
          <div className="toolkit-guide-kicker"><Icon name="sparkles" size={14} /> {copy.badge}</div>
          <h2 id="mobile-teaser-title">{copy.title}</h2>
          <p>{copy.summary}</p>
        </div>
        <div className="toolkit-guide-nodi"><NodiAvatar state="discovering" height={172} /></div>
      </header>

      <div className="toolkit-guide-stage mobile-teaser-stage">
        <div className="mobile-teaser-layout">
          <figure className="mobile-teaser-frame">
            {/*
              Keyed and mounted directly, NOT wrapped in AnimatePresence. With
              `mode="wait"` the incoming shot only mounts once the outgoing one has
              finished leaving, while the caption and the dots below update on the same
              tick as the click — so every slide change opened a window where the caption
              named one screen and the image still showed the previous one. Swapping the
              element outright keeps picture and caption in step, and the fade-in still
              softens the change.
            */}
            <motion.img
              key={shot.key}
              src={shot.src}
              alt={copy.slides[shot.key]}
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: .22 }}
              draggable={false}
            />
            <figcaption>{copy.slides[shot.key]}</figcaption>
            <div className="mobile-teaser-controls">
              <button type="button" aria-label={copy.previous} data-testid="mobile-teaser-prev" onClick={() => step(-1)}>
                <Icon name="chevronLeft" size={15} />
              </button>
              <div className="mobile-teaser-dots" role="tablist" aria-label={copy.eyebrow}>
                {SHOTS.map((item, dot) => (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    aria-selected={dot === index}
                    aria-label={copy.slides[item.key]}
                    className={dot === index ? 'active' : ''}
                    onClick={() => setIndex(dot)}
                  />
                ))}
              </div>
              <button type="button" aria-label={copy.next} data-testid="mobile-teaser-next" onClick={() => step(1)}>
                <Icon name="chevronRight" size={15} />
              </button>
            </div>
          </figure>

          <div className="mobile-teaser-copy">
            <div className="toolkit-guide-eyebrow"><Icon name="phone" size={15} /> {copy.eyebrow}</div>
            <h3>{copy.heading}</h3>
            <p className="toolkit-guide-summary">{copy.lede}</p>
            <div className="toolkit-guide-notice"><Icon name="clock" size={17} /><div>{copy.status}</div></div>
            <div className="mobile-teaser-survey">
              <b>{copy.surveyTitle}</b>
              <small>{copy.surveyBody}</small>
              <button
                type="button"
                className="mobile-teaser-survey-cta"
                data-testid="mobile-teaser-survey"
                onClick={() => void window.nodus.openExternal(MOBILE_TEASER_SURVEY_URL)}
              >
                <Icon name="external" size={14} /> {copy.surveyCta}
              </button>
            </div>
          </div>
        </div>
      </div>

      <footer className="toolkit-guide-footer mobile-teaser-footer">
        <span>{copy.englishNote}</span>
        <button className="primary" data-testid="mobile-teaser-complete" onClick={finish}>
          {copy.finish} <Icon name="check" size={14} />
        </button>
      </footer>
    </motion.section>
  </motion.div>;
}
