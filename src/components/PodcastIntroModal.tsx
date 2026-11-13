// SPDX-License-Identifier: AGPL-3.0-only
// One-time announcement of Podcast (beta). Shown once, after the release notes and Nodi's
// style choice, in the vault types that have Podcast; dismissing or trying it marks it seen
// for good. The copy lives here per interface language, like the other update guides.
import { useEffect } from 'react';
import type { AppLanguage } from '@shared/types';
import { Icon } from './ui';
import { t } from '../i18n';

export const PODCAST_INTRO_SEEN_KEY = 'nodus.podcastIntroSeen.v1';

export function podcastIntroSeen(): boolean {
  try { return localStorage.getItem(PODCAST_INTRO_SEEN_KEY) === '1'; } catch { return true; }
}

export function markPodcastIntroSeen(): void {
  try { localStorage.setItem(PODCAST_INTRO_SEEN_KEY, '1'); } catch { /* private storage: shown again next time */ }
}

interface IntroCopy {
  kicker: string;
  title: string;
  summary: string;
  features: [string, string][];
  note: string;
  later: string;
  tryIt: string;
}

const COPY: Record<string, IntroCopy> = {
  es: {
    kicker: 'NUEVO · BETA',
    title: 'Tu vault, convertido en podcast',
    summary: 'Elige un tema y Nodus lo investiga en tus fuentes, escribe un guion y lo graba con voces que funcionan en tu equipo.',
    features: [
      ['Investiga de verdad', 'El guion sale de tus obras, ideas y materiales. Sin inventar.'],
      ['Una o dos voces', 'Conversación, debate, clase o ensayo narrado. De 5 a 30 minutos.'],
      ['Escúchalo donde quieras', 'Sigue sonando al cambiar de sección. Descárgalo en M4A.'],
    ],
    note: 'Está en beta: revisa el guion antes de grabar si vas a publicarlo.',
    later: 'Ahora no',
    tryIt: 'Probar Podcast',
  },
  en: {
    kicker: 'NEW · BETA',
    title: 'Your vault, turned into a podcast',
    summary: 'Pick a topic and Nodus researches it in your sources, writes a script and records it with voices that run on your computer.',
    features: [
      ['Real research', 'The script comes from your works, ideas and materials. Nothing made up.'],
      ['One or two voices', 'Conversation, debate, lesson or narrated essay. From 5 to 30 minutes.'],
      ['Listen anywhere', 'It keeps playing when you switch sections. Download it as M4A.'],
    ],
    note: 'It is in beta: review the script before recording if you plan to publish it.',
    later: 'Not now',
    tryIt: 'Try Podcast',
  },
  fr: {
    kicker: 'NOUVEAU · BÊTA',
    title: 'Votre vault devient un podcast',
    summary: 'Choisissez un sujet : Nodus le documente dans vos sources, écrit un script et l’enregistre avec des voix qui tournent sur votre ordinateur.',
    features: [
      ['Une vraie recherche', 'Le script vient de vos œuvres, idées et supports. Rien d’inventé.'],
      ['Une ou deux voix', 'Conversation, débat, cours ou essai raconté. De 5 à 30 minutes.'],
      ['Écoutez partout', 'L’audio continue quand vous changez de section. Téléchargez-le en M4A.'],
    ],
    note: 'C’est une bêta : relisez le script avant l’enregistrement si vous comptez le publier.',
    later: 'Plus tard',
    tryIt: 'Essayer Podcast',
  },
  de: {
    kicker: 'NEU · BETA',
    title: 'Dein Vault als Podcast',
    summary: 'Wähle ein Thema. Nodus recherchiert es in deinen Quellen, schreibt ein Skript und nimmt es mit Stimmen auf, die auf deinem Computer laufen.',
    features: [
      ['Echte Recherche', 'Das Skript stammt aus deinen Werken, Ideen und Materialien. Nichts erfunden.'],
      ['Eine oder zwei Stimmen', 'Gespräch, Debatte, Lektion oder erzähltes Essay. 5 bis 30 Minuten.'],
      ['Überall hören', 'Es läuft weiter, wenn du den Bereich wechselst. Als M4A herunterladen.'],
    ],
    note: 'Noch in der Beta: Prüfe das Skript vor der Aufnahme, wenn du es veröffentlichen willst.',
    later: 'Später',
    tryIt: 'Podcast ausprobieren',
  },
  pt: {
    kicker: 'NOVO · BETA',
    title: 'O seu vault, transformado em podcast',
    summary: 'Escolha um tema e o Nodus pesquisa-o nas suas fontes, escreve um guião e grava-o com vozes que funcionam no seu computador.',
    features: [
      ['Pesquisa a sério', 'O guião sai das suas obras, ideias e materiais. Nada inventado.'],
      ['Uma ou duas vozes', 'Conversa, debate, aula ou ensaio narrado. De 5 a 30 minutos.'],
      ['Ouça onde quiser', 'Continua a tocar ao mudar de secção. Transfira-o em M4A.'],
    ],
    note: 'Está em beta: reveja o guião antes de gravar se o for publicar.',
    later: 'Agora não',
    tryIt: 'Experimentar Podcast',
  },
  'pt-BR': {
    kicker: 'NOVO · BETA',
    title: 'Seu vault virou podcast',
    summary: 'Escolha um tema e o Nodus pesquisa nas suas fontes, escreve um roteiro e grava com vozes que rodam no seu computador.',
    features: [
      ['Pesquisa de verdade', 'O roteiro sai das suas obras, ideias e materiais. Nada inventado.'],
      ['Uma ou duas vozes', 'Conversa, debate, aula ou ensaio narrado. De 5 a 30 minutos.'],
      ['Ouça onde quiser', 'Continua tocando quando você muda de seção. Baixe em M4A.'],
    ],
    note: 'Está em beta: revise o roteiro antes de gravar se for publicá-lo.',
    later: 'Agora não',
    tryIt: 'Experimentar Podcast',
  },
  it: {
    kicker: 'NOVITÀ · BETA',
    title: 'Il tuo vault diventa un podcast',
    summary: 'Scegli un argomento: Nodus lo ricerca nelle tue fonti, scrive un copione e lo registra con voci che girano sul tuo computer.',
    features: [
      ['Ricerca vera', 'Il copione nasce dalle tue opere, idee e materiali. Niente di inventato.'],
      ['Una o due voci', 'Conversazione, dibattito, lezione o saggio narrato. Da 5 a 30 minuti.'],
      ['Ascolta ovunque', 'Continua a suonare quando cambi sezione. Scaricalo in M4A.'],
    ],
    note: 'È in beta: rivedi il copione prima di registrare se vuoi pubblicarlo.',
    later: 'Non ora',
    tryIt: 'Prova Podcast',
  },
  tr: {
    kicker: 'YENİ · BETA',
    title: 'Kasan artık bir podcast',
    summary: 'Bir konu seç. Nodus onu kaynaklarında araştırır, bir senaryo yazar ve bilgisayarında çalışan seslerle kaydeder.',
    features: [
      ['Gerçek araştırma', 'Senaryo eserlerinden, fikirlerinden ve materyallerinden çıkar. Uydurma yok.'],
      ['Bir ya da iki ses', 'Sohbet, tartışma, ders veya anlatımlı deneme. 5 ila 30 dakika.'],
      ['Her yerde dinle', 'Bölüm değiştirince çalmaya devam eder. M4A olarak indir.'],
    ],
    note: 'Beta aşamasında: yayımlayacaksan kaydetmeden önce senaryoyu incele.',
    later: 'Şimdi değil',
    tryIt: "Podcast'i dene",
  },
  'zh-CN': {
    kicker: '新功能 · 测试版',
    title: '把你的知识库变成播客',
    summary: '选择一个主题，Nodus 会在你的来源中研究、撰写脚本，并用在你电脑上运行的声音录制。',
    features: [
      ['真正的研究', '脚本来自你的作品、观点和资料。不编造。'],
      ['一个或两个声音', '对谈、辩论、课程或叙述式随笔。5 到 30 分钟。'],
      ['随处收听', '切换板块时继续播放。可下载为 M4A。'],
    ],
    note: '目前为测试版：如要发布，请在录制前审阅脚本。',
    later: '以后再说',
    tryIt: '试用播客',
  },
  'zh-TW': {
    kicker: '新功能 · 測試版',
    title: '把你的知識庫變成 Podcast',
    summary: '選擇一個主題，Nodus 會在你的來源中研究、撰寫腳本，並以在你電腦上執行的聲音錄製。',
    features: [
      ['真正的研究', '腳本來自你的作品、觀點與資料。不憑空捏造。'],
      ['一個或兩個聲音', '對談、辯論、課程或敘事隨筆。5 到 30 分鐘。'],
      ['隨處收聽', '切換區塊時持續播放。可下載為 M4A。'],
    ],
    note: '目前為測試版：若要發布，請在錄製前審閱腳本。',
    later: '稍後再說',
    tryIt: '試用 Podcast',
  },
  ja: {
    kicker: '新機能 · ベータ',
    title: 'あなたの Vault がポッドキャストに',
    summary: 'テーマを選ぶと、Nodus が資料を調べて台本を書き、あなたのコンピューターで動く声で録音します。',
    features: [
      ['本物のリサーチ', '台本はあなたの著作、アイデア、資料から作られます。作り話はしません。'],
      ['1 つまたは 2 つの声', '対談、討論、授業、語りのエッセイ。5〜30 分。'],
      ['どこでも聴ける', 'セクションを移っても再生が続きます。M4A でダウンロードできます。'],
    ],
    note: 'ベータ版です。公開する場合は録音前に台本を確認してください。',
    later: 'あとで',
    tryIt: 'ポッドキャストを試す',
  },
  ko: {
    kicker: '새 기능 · 베타',
    title: '내 Vault가 팟캐스트로',
    summary: '주제를 고르면 Nodus가 내 자료에서 조사하고 대본을 쓴 뒤 내 컴퓨터에서 실행되는 목소리로 녹음합니다.',
    features: [
      ['진짜 조사', '대본은 내 저작, 아이디어, 자료에서 나옵니다. 지어내지 않습니다.'],
      ['목소리 하나 또는 둘', '대화, 토론, 수업, 내레이션 에세이. 5분에서 30분까지.'],
      ['어디서나 듣기', '다른 섹션으로 옮겨도 계속 재생됩니다. M4A로 내려받을 수 있습니다.'],
    ],
    note: '베타 단계입니다. 게시할 예정이라면 녹음 전에 대본을 검토하세요.',
    later: '나중에',
    tryIt: '팟캐스트 사용해 보기',
  },
};

const FEATURE_ICONS = ['telescope', 'users', 'headphones'] as const;
const WAVE_BARS = [0.35, 0.7, 0.5, 0.95, 0.6, 0.8, 0.4, 1, 0.55, 0.75, 0.45, 0.9, 0.5, 0.65, 0.3];

export function PodcastIntroModal({ uiLanguage, onClose, onTry }: { uiLanguage: AppLanguage | string; onClose: () => void; onTry: () => void }) {
  const copy = COPY[uiLanguage] ?? COPY[String(uiLanguage).split('-')[0]] ?? COPY.en;
  const close = () => { markPodcastIntroSeen(); onClose(); };
  const tryIt = () => { markPodcastIntroSeen(); onTry(); };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="podcast-intro-backdrop" onMouseDown={close} data-testid="podcast-intro">
      <section role="dialog" aria-modal="true" aria-label={copy.title} className="podcast-intro-card" onMouseDown={(event) => event.stopPropagation()}>
        <header className="podcast-intro-hero">
          <div className="podcast-intro-glow" aria-hidden="true" />
          <div className="podcast-intro-waves" aria-hidden="true">
            {WAVE_BARS.map((height, index) => (
              <span key={index} style={{ height: `${Math.round(height * 100)}%`, animationDelay: `${(index % 5) * 0.13 + Math.floor(index / 5) * 0.07}s` }} />
            ))}
          </div>
          <div className="podcast-intro-badge" aria-hidden="true">
            <span className="podcast-intro-ring" />
            <span className="podcast-intro-ring podcast-intro-ring-late" />
            <Icon name="headphones" size={46} />
          </div>
          <p className="podcast-intro-kicker"><Icon name="sparkles" size={12} /> {copy.kicker}</p>
          <h2>{copy.title}</h2>
          <p className="podcast-intro-summary">{copy.summary}</p>
          <button className="podcast-intro-close" onClick={close} aria-label={t('Cerrar')} title={t('Cerrar')}><Icon name="x" size={16} /></button>
        </header>
        <div className="podcast-intro-body">
          <ul className="podcast-intro-features">
            {copy.features.map(([title, text], index) => (
              <li key={title}>
                <span className="podcast-intro-feature-icon"><Icon name={FEATURE_ICONS[index]} size={17} /></span>
                <strong>{title}</strong>
                <span>{text}</span>
              </li>
            ))}
          </ul>
          <p className="podcast-intro-note"><Icon name="info" size={13} /> {copy.note}</p>
        </div>
        <footer className="podcast-intro-actions">
          <button className="btn btn-ghost" onClick={close}>{copy.later}</button>
          <button className="btn btn-primary gap-1.5" onClick={tryIt} data-testid="podcast-intro-try" autoFocus>
            <Icon name="headphones" size={15} /> {copy.tryIt}
          </button>
        </footer>
      </section>
    </div>
  );
}
