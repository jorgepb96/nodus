import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { AppLanguage } from '@shared/types';
import { Icon } from '../../src/components/ui';
import { NodiAvatar } from '../../src/components/nodi/NodiAvatar';
import { TutorialVideoGrid } from '../../src/components/TutorialVideos';
import '../../src/components/tutorialVideos.css';

/**
 * "The tutorials are now on video too" — the one-time announcement.
 *
 * The cinematic guide asks new users whether they want the videos or the written deck,
 * so a fresh install meets the catalogue on its first run and never sees this modal.
 * Everyone who completed the guide before the videos existed was never asked, and would
 * otherwise only find them by wandering into Settings → Tutorials. This is that
 * announcement, in the chrome the other update tours use — and because the point is the
 * videos themselves, they are embedded here rather than described: the same grid, the
 * same in-app player, one click from the modal.
 *
 * The privacy promise of the grid survives: nothing is requested until a card is opened
 * (posters are local gradients), and the written guide is still named as the offline
 * path.
 */

const SEEN_KEY = 'nodus.tutorialVideosAnnouncementSeen.2026-07';

type AnnouncementCopy = {
  badge: string;
  title: string;
  summary: string;
  eyebrow: string;
  heading: string;
  lede: string;
  settingsTitle: string;
  settingsBody: string;
  toursTitle: string;
  toursBody: string;
  offline: string;
  hint: string;
  finish: string;
};

const COPY: Record<AppLanguage, AnnouncementCopy> = {
  es: {
    badge: 'NUEVO · TUTORIALES EN VÍDEO',
    title: 'Los tutoriales, ahora también en vídeo',
    summary: 'Ya viste la guía esencial en texto. Desde ahora los mismos contenidos están disponibles en vídeo, dentro de Nodus.',
    eyebrow: 'Míralos aquí mismo',
    heading: 'Tutoriales en vídeo',
    lede: 'Ábrelos sin salir de la aplicación, con pausa, subtítulos y pantalla completa. Cada uno se marca como visto en cuanto lo abres.',
    settingsTitle: 'Siempre a mano',
    settingsBody: 'Ajustes → Ayuda reúne todo el catálogo —Introducción, Bóvedas, Funciones e Integraciones— con buscador y filtros.',
    toursTitle: 'También en las visitas guiadas',
    toursBody: 'Cuando una bóveda tiene vídeo, su visita guiada lo ofrece como tercera opción.',
    offline: 'La guía escrita no desaparece: sigue dentro de la app y funciona sin conexión.',
    hint: 'Puedes volver a los vídeos cuando quieras desde Ajustes → Ayuda.',
    finish: 'Entendido',
  },
  en: {
    badge: 'NEW · VIDEO TUTORIALS',
    title: 'The tutorials are now on video too',
    summary: 'You already went through the written guide. The same material is now available as video, inside Nodus.',
    eyebrow: 'Watch them right here',
    heading: 'Video tutorials',
    lede: 'Open them without leaving the app, with pause, captions and fullscreen. Each one is marked as watched as soon as you open it.',
    settingsTitle: 'Always within reach',
    settingsBody: 'Settings → Help holds the whole catalogue — Introduction, Vaults, Features and Integrations — with search and filters.',
    toursTitle: 'In the guided tours too',
    toursBody: 'When a vault has a video, its guided tour offers it as a third way in.',
    offline: 'The written guide is not going anywhere: it stays in the app and works offline.',
    hint: 'You can come back to the videos any time from Settings → Help.',
    finish: 'Got it',
  },
  fr: {
    badge: 'NOUVEAU · TUTORIELS VIDÉO',
    title: 'Les tutoriels existent aussi en vidéo',
    summary: 'Vous avez déjà parcouru le guide écrit. Le même contenu est désormais disponible en vidéo, dans Nodus.',
    eyebrow: 'Regardez-les ici même',
    heading: 'Tutoriels vidéo',
    lede: 'Ouvrez-les sans quitter l’application, avec pause, sous-titres et plein écran. Chacun est marqué comme vu dès son ouverture.',
    settingsTitle: 'Toujours à portée de main',
    settingsBody: 'Réglages → Aide rassemble tout le catalogue — Introduction, Coffres, Fonctions et Intégrations — avec recherche et filtres.',
    toursTitle: 'Et dans les visites guidées',
    toursBody: 'Quand un coffre dispose d’une vidéo, sa visite guidée la propose comme troisième option.',
    offline: 'Le guide écrit reste en place : il vit dans l’app et fonctionne hors ligne.',
    hint: 'Vous pouvez revenir aux vidéos à tout moment depuis Réglages → Aide.',
    finish: 'J’ai compris',
  },
  de: {
    badge: 'NEU · VIDEO-TUTORIALS',
    title: 'Die Tutorials gibt es jetzt auch als Video',
    summary: 'Sie haben die schriftliche Anleitung bereits gesehen. Dieselben Inhalte gibt es ab sofort als Video – in Nodus.',
    eyebrow: 'Direkt hier ansehen',
    heading: 'Video-Tutorials',
    lede: 'Öffnen Sie sie, ohne die App zu verlassen – mit Pause, Untertiteln und Vollbild. Jedes wird beim Öffnen als gesehen markiert.',
    settingsTitle: 'Immer griffbereit',
    settingsBody: 'Einstellungen → Hilfe versammelt den ganzen Katalog — Einführung, Vaults, Funktionen und Integrationen — mit Suche und Filtern.',
    toursTitle: 'Auch in den Touren',
    toursBody: 'Hat ein Vault ein Video, bietet seine Tour es als dritten Weg an.',
    offline: 'Die schriftliche Anleitung bleibt: Sie steckt weiter in der App und funktioniert offline.',
    hint: 'Sie können jederzeit über Einstellungen → Hilfe zu den Videos zurückkehren.',
    finish: 'Verstanden',
  },
  it: {
    badge: 'NOVITÀ · TUTORIAL VIDEO',
    title: 'I tutorial ora sono anche in video',
    summary: 'Hai già seguito la guida scritta. Gli stessi contenuti sono ora disponibili in video, dentro Nodus.',
    eyebrow: 'Guardali proprio qui',
    heading: 'Tutorial video',
    lede: 'Aprili senza uscire dall’app, con pausa, sottotitoli e schermo intero. Ognuno viene segnato come visto appena lo apri.',
    settingsTitle: 'Sempre a portata di mano',
    settingsBody: 'Impostazioni → Aiuto raccoglie l’intero catalogo — Introduzione, Vault, Funzioni e Integrazioni — con ricerca e filtri.',
    toursTitle: 'Anche nei tour guidati',
    toursBody: 'Quando un vault ha un video, il suo tour lo propone come terza opzione.',
    offline: 'La guida scritta resta al suo posto: vive nell’app e funziona offline.',
    hint: 'Puoi tornare ai video quando vuoi da Impostazioni → Aiuto.',
    finish: 'Ho capito',
  },
  pt: {
    badge: 'NOVO · TUTORIAIS EM VÍDEO',
    title: 'Os tutoriais agora também estão em vídeo',
    summary: 'Já percorreu o guia escrito. Os mesmos conteúdos estão agora disponíveis em vídeo, dentro do Nodus.',
    eyebrow: 'Veja-os aqui mesmo',
    heading: 'Tutoriais em vídeo',
    lede: 'Abra-os sem sair da aplicação, com pausa, legendas e ecrã inteiro. Cada um fica marcado como visto assim que o abre.',
    settingsTitle: 'Sempre à mão',
    settingsBody: 'Definições → Ajuda reúne todo o catálogo — Introdução, Cofres, Funcionalidades e Integrações — com pesquisa e filtros.',
    toursTitle: 'Também nas visitas guiadas',
    toursBody: 'Quando um cofre tem vídeo, a sua visita guiada oferece-o como terceira opção.',
    offline: 'O guia escrito não vai a lado nenhum: continua na app e funciona sem ligação.',
    hint: 'Pode voltar aos vídeos quando quiser em Definições → Ajuda.',
    finish: 'Percebi',
  },
  'pt-BR': {
    badge: 'NOVO · TUTORIAIS EM VÍDEO',
    title: 'Os tutoriais agora também estão em vídeo',
    summary: 'Você já viu o guia escrito. O mesmo conteúdo agora está disponível em vídeo, dentro do Nodus.',
    eyebrow: 'Assista aqui mesmo',
    heading: 'Tutoriais em vídeo',
    lede: 'Abra sem sair do app, com pausa, legendas e tela cheia. Cada um é marcado como visto assim que você abre.',
    settingsTitle: 'Sempre por perto',
    settingsBody: 'Configurações → Ajuda reúne todo o catálogo — Introdução, Cofres, Recursos e Integrações — com busca e filtros.',
    toursTitle: 'Também nos tours guiados',
    toursBody: 'Quando um cofre tem vídeo, o tour dele oferece o vídeo como terceira opção.',
    offline: 'O guia escrito continua: ele fica no app e funciona offline.',
    hint: 'Você pode voltar aos vídeos quando quiser em Configurações → Ajuda.',
    finish: 'Entendi',
  },
  tr: {
    badge: 'YENİ · VİDEO DERSLER',
    title: 'Rehberler artık video olarak da mevcut',
    summary: 'Yazılı temel rehberi incelediniz. Aynı içerikler artık Nodus içinde video formatında da erişilebilir.',
    eyebrow: 'Doğrudan buradan izleyin',
    heading: 'Video rehberler',
    lede: 'Uygulamadan ayrılmadan; duraklatma, altyazı ve tam ekran desteğiyle izleyin. Her biri açıldığı anda izlendi olarak işaretlenir.',
    settingsTitle: 'Her zaman elinizin altında',
    settingsBody: 'Ayarlar → Yardım tüm kataloğu bir arada sunar: Giriş, Kasalar, Özellikler ve Entegrasyonlar; arama ve filtrelerle.',
    toursTitle: 'Rehberli turlarda da mevcut',
    toursBody: 'Bir kasanın videosu varsa, rehberli turu bunu üçüncü bir yol olarak sunar.',
    offline: 'Yazılı rehber hiçbir yere gitmiyor: uygulama içinde kalır ve çevrimdışı çalışır.',
    hint: 'Ayarlar → Yardım menüsünden istediğiniz zaman videolara dönebilirsiniz.',
    finish: 'Anlaşıldı',
  },
  'zh-CN': {
    badge: '新增 · 视频教程',
    title: '教程现在也有视频版了',
    summary: '你已完成文字版指南。现在，同样的内容在Nodus内还提供视频版。',
    eyebrow: '就在这里观看',
    heading: '视频教程',
    lede: '无需离开应用即可打开，支持暂停、字幕和全屏。每个视频一经打开即标记为已观看。',
    settingsTitle: '随时可用',
    settingsBody: '「设置 → 帮助」汇集了完整目录——介绍、资料库、功能与集成——并带有搜索和筛选。',
    toursTitle: '导览中也有',
    toursBody: '当某个资料库有视频时，其导览会将它作为第三种入口提供。',
    offline: '文字版指南不会消失：它仍留在应用内，并可离线使用。',
    hint: '你可以随时从「设置 → 帮助」返回视频。',
    finish: '知道了',
  },
  'zh-TW': {
    badge: '新增 · 影片教程',
    title: '教程現在也有影片版了',
    summary: '你已完成文字版指南。現在，同樣的內容在Nodus內還提供影片版。',
    eyebrow: '就在這裡觀看',
    heading: '影片教程',
    lede: '無需離開應用即可開啟，支援暫停、字幕和全屏。每個影片一經開啟即標記為已觀看。',
    settingsTitle: '隨時可用',
    settingsBody: '「設定 → 幫助」彙集了完整目錄——介紹、知識庫、功能與整合——並帶有搜尋和篩選。',
    toursTitle: '導覽中也有',
    toursBody: '當某個知識庫有影片時，其導覽會將它作為第三種入口提供。',
    offline: '文字版指南不會消失：它仍留在應用內，並可離線使用。',
    hint: '你可以隨時從「設定 → 幫助」返回影片。',
    finish: '知道了',
  },
  ja: {
    badge: "新しい・ビデオチュートリアル",
    title: "チュートリアルはビデオでも公開されました",
    summary: "あなたはすでに書面によるガイドを読み終えています。同じ素材が、Nodus 内でビデオとして利用できるようになりました。",
    eyebrow: "ここで視聴してください",
    heading: "ビデオチュートリアル",
    lede: "アプリを終了せずに、一時停止、キャプション、全画面表示でそれらを開きます。それぞれのファイルを開くとすぐに、視聴済みとしてマークされます。",
    settingsTitle: "いつでも手の届くところに",
    settingsBody: "[設定] → [ヘルプ] には、検索とフィルターを備えたカタログ全体 (概要、Vault、機能、統合) が含まれています。",
    toursTitle: "ガイドツアーでも",
    toursBody: "Vaultにビデオがある場合、そのガイド付きツアーでは、第3の方法としてビデオが提供されます。",
    offline: "書かれたガイドはどこにも行きません。アプリ内に留まり、オフラインでも機能します。",
    hint: "[設定] → [ヘルプ] からいつでもビデオに戻ることができます。",
    finish: "わかった",
  },
  ko: {
    badge: '신규 · 비디오 튜토리얼',
    title: '이제 튜토리얼도 비디오로 제공됩니다',
    summary: '당신은 이미 서면 가이드를 읽었습니다. 이제 동일한 자료를 Nodus 내에서 비디오로 볼 수 있습니다.',
    eyebrow: '바로 여기에서 시청하세요',
    heading: '비디오 튜토리얼',
    lede: '일시 중지, 캡션, 전체 화면 기능을 통해 앱을 종료하지 않고도 열 수 있습니다. 각 항목은 열자마자 시청한 것으로 표시됩니다.',
    settingsTitle: '항상 손이 닿는 곳에',
    settingsBody: '설정 → 도움말에는 검색 및 필터와 함께 소개, Vault, 기능 및 통합 등 전체 카탈로그가 포함되어 있습니다.',
    toursTitle: '가이드 투어에서도',
    toursBody: 'Vault에 비디오가 있는 경우 가이드 투어는 비디오를 세 번째 방법으로 제공합니다.',
    offline: '서면 가이드는 아무데도 가지 않고 앱에 남아 있으며 오프라인으로 작동합니다.',
    hint: '설정 → 도움말에서 언제든지 동영상으로 돌아올 수 있습니다.',
    finish: '알았어요',
  },
};

/**
 * The announcement is for users who met Nodus before the videos existed, so completing
 * the cinematic guide — which now asks video or text — settles it for good. Called from
 * App when the guide finishes, before the settings reload that mounts the modal's host.
 */
export function markTutorialVideosAnnouncementSeen(): void {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* storage unavailable: the modal simply appears once */ }
}

function shouldPresent(previousTutorialVersion: number): boolean {
  // Zero means the guide has not been completed: that user is about to be asked the
  // question this modal exists to replace.
  if (previousTutorialVersion <= 0) return false;
  try { return localStorage.getItem(SEEN_KEY) !== '1'; } catch { return true; }
}

export function TutorialVideosUpdateTour({
  uiLanguage,
  previousTutorialVersion,
  onSettled,
}: {
  uiLanguage: AppLanguage;
  previousTutorialVersion: number;
  onSettled: () => void;
}) {
  const [eligible] = useState(() => shouldPresent(previousTutorialVersion));
  const copy = COPY[uiLanguage] ?? COPY.en;

  useEffect(() => { if (!eligible) onSettled(); }, [eligible, onSettled]);
  if (!eligible) return null;

  const finish = () => {
    // Written only when the user actually dismisses the modal, so a launch that never
    // reached the foreground does not consume the one showing.
    markTutorialVideosAnnouncementSeen();
    onSettled();
  };

  return <motion.div className="toolkit-guide-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .22 }}>
    <motion.section
      className="toolkit-guide-cinema tutorial-videos-guide"
      data-testid="tutorial-videos-update-tour"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutorial-videos-guide-title"
      initial={{ opacity: 0, y: 28, scale: .96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: .46, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <header className="toolkit-guide-hero">
        <div className="toolkit-guide-aurora" aria-hidden="true" />
        <div className="toolkit-guide-hero-copy">
          <div className="toolkit-guide-kicker"><Icon name="play" size={14} /> {copy.badge}</div>
          <h2>{copy.title}</h2>
          <p>{copy.summary}</p>
        </div>
        <div className="toolkit-guide-nodi"><NodiAvatar state="celebrating" height={172} /></div>
      </header>

      <div className="toolkit-guide-stage">
        <div className="toolkit-guide-eyebrow"><Icon name="graduation" size={15} /> {copy.eyebrow}</div>
        <h3 id="tutorial-videos-guide-title">{copy.heading}</h3>
        <p className="toolkit-guide-summary">{copy.lede}</p>
        <div className="toolkit-guide-content">
          {/* The `panel` skin is the one that survives light mode, which this card follows.
              Its own heading is dropped: the stage above already carries the title. */}
          <TutorialVideoGrid language={uiLanguage} variant="panel" showHeading={false} />
          <div className="tutorial-videos-guide-where">
            <div>
              <Icon name="settings" size={17} />
              <div><b>{copy.settingsTitle}</b><small>{copy.settingsBody}</small></div>
            </div>
            <div>
              <Icon name="compass" size={17} />
              <div><b>{copy.toursTitle}</b><small>{copy.toursBody}</small></div>
            </div>
          </div>
          <div className="toolkit-guide-notice"><Icon name="book" size={17} /><div>{copy.offline}</div></div>
        </div>
      </div>

      <footer className="toolkit-guide-footer tutorial-videos-guide-footer">
        <span>{copy.hint}</span>
        <button className="primary" data-testid="tutorial-videos-tour-complete" onClick={finish}>
          {copy.finish} <Icon name="check" size={14} />
        </button>
      </footer>
    </motion.section>
  </motion.div>;
}
