import type { CategorizedReleaseHighlight } from './releaseNotes';

// Final user-visible outcomes since v5.15.0: the narration controls fit the header sound
// popover, and the Research Chat header Listen button only opens the Listen balloon.
export const RELEASE_5_15_1_HIGHLIGHTS: CategorizedReleaseHighlight[] = [
  {
    category: 'fix', scope: 'general',
    "es": "Los controles de narración caben dentro del globo de sonido de la cabecera. Con un título largo, como una pregunta del Chat de investigación, el botón de cerrar, la barra de progreso, la velocidad y Liberar memoria quedaban cortados. Ahora el título se acorta y el globo tiene un fondo opaco en el modo claro.",
    "en": "The narration controls fit inside the header sound popover. With a long title, such as a Research Chat question, the close button, the progress bar, the speed and Free memory were cut off. The title is now shortened, and the popover has an opaque background in light mode.",
    "fr": "Les commandes de narration tiennent dans la bulle de son de l’en-tête. Avec un titre long, comme une question du Chat de recherche, le bouton de fermeture, la barre de progression, la vitesse et Libérer la mémoire étaient coupés. Le titre est désormais raccourci et la bulle a un fond opaque en mode clair.",
    "de": "Die Steuerelemente der Vorlesefunktion passen in das Ton-Popover der Kopfzeile. Bei einem langen Titel, etwa einer Frage im Recherche-Chat, wurden die Schließen-Schaltfläche, der Fortschrittsbalken, die Geschwindigkeit und Speicher freigeben abgeschnitten. Der Titel wird jetzt gekürzt, und das Popover hat im hellen Modus einen deckenden Hintergrund.",
    "pt": "Os controlos de narração cabem no balão de som do cabeçalho. Com um título longo, como uma pergunta do Chat de investigação, o botão de fechar, a barra de progresso, a velocidade e Libertar memória ficavam cortados. Agora o título é encurtado e o balão tem um fundo opaco no modo claro.",
    "pt-BR": "Os controles de narração cabem no balão de som do cabeçalho. Com um título longo, como uma pergunta do Chat de pesquisa, o botão de fechar, a barra de progresso, a velocidade e Liberar memória ficavam cortados. Agora o título é encurtado e o balão tem um fundo opaco no modo claro.",
    "it": "I controlli della narrazione stanno all’interno del fumetto audio dell’intestazione. Con un titolo lungo, come una domanda della Chat di ricerca, il pulsante di chiusura, la barra di avanzamento, la velocità e Libera memoria venivano tagliati. Ora il titolo viene accorciato e il fumetto ha uno sfondo opaco nella modalità chiara.",
    "tr": "Seslendirme denetimleri artık başlıktaki ses balonunun içine sığıyor. Araştırma Sohbeti sorusu gibi uzun bir başlıkta kapatma düğmesi, ilerleme çubuğu, hız ve Belleği boşalt kesiliyordu. Başlık artık kısaltılıyor ve balonun açık modda opak bir arka planı var.",
    "zh-CN": "朗读控件现在可以完整显示在标题栏的声音气泡中。标题较长时，例如研究聊天中的问题，关闭按钮、进度条、速度和“释放内存”会被截断。现在标题会被缩短，浅色模式下气泡的背景也不再透明。",
    "zh-TW": "朗讀控制項現在可以完整顯示在標題列的聲音氣泡中。標題較長時，例如研究聊天中的問題，關閉按鈕、進度列、速度和「釋放記憶體」會被截斷。現在標題會被縮短，淺色模式下氣泡的背景也不再透明。",
    "ja": "読み上げのコントロールがヘッダーのサウンドバルーンに収まるようになりました。リサーチチャットの質問のような長いタイトルでは、閉じるボタン、進行バー、速度、メモリを解放が切れていました。現在はタイトルが短く表示され、ライトモードではバルーンの背景が透けなくなりました。",
    "ko": "낭독 컨트롤이 헤더의 사운드 풍선 안에 맞게 표시됩니다. 리서치 채팅 질문처럼 제목이 길면 닫기 버튼, 진행 막대, 속도, 메모리 해제가 잘렸습니다. 이제 제목이 짧게 줄여지고, 라이트 모드에서 풍선 배경이 비치지 않습니다.",
  },
  {
    category: 'fix', scope: 'general',
    "es": "El botón Escuchar de la cabecera del Chat de investigación solo abre el globo de Escuchar. Ya no empieza a reproducir ni a generar audio por su cuenta. Tampoco muestra un círculo de progreso en el botón. El progreso y los controles se ven dentro del globo.",
    "en": "The Listen button in the Research Chat header only opens the Listen balloon. It no longer starts playing or generating audio on its own. It also no longer shows a progress ring on the button. Progress and controls appear inside the balloon.",
    "fr": "Le bouton Écouter de l’en-tête du Chat de recherche ouvre seulement la bulle Écouter. Il ne lance plus la lecture ni la génération audio de lui-même. Il n’affiche plus non plus d’anneau de progression sur le bouton. La progression et les commandes apparaissent dans la bulle.",
    "de": "Die Schaltfläche Anhören in der Kopfzeile des Recherche-Chats öffnet nur noch das Anhören-Popover. Sie startet die Wiedergabe oder Audioerzeugung nicht mehr von selbst. Sie zeigt auch keinen Fortschrittsring mehr auf der Schaltfläche. Fortschritt und Steuerung erscheinen im Popover.",
    "pt": "O botão Ouvir do cabeçalho do Chat de investigação só abre o balão Ouvir. Já não começa a reproduzir nem a gerar áudio por si só. Também já não mostra um anel de progresso no botão. O progresso e os controlos aparecem dentro do balão.",
    "pt-BR": "O botão Ouvir do cabeçalho do Chat de pesquisa só abre o balão Ouvir. Ele não começa mais a reproduzir nem a gerar áudio sozinho. Também não mostra mais um anel de progresso no botão. O progresso e os controles aparecem dentro do balão.",
    "it": "Il pulsante Ascolta nell’intestazione della Chat di ricerca apre solo il fumetto Ascolta. Non avvia più da solo la riproduzione o la generazione dell’audio. Non mostra più nemmeno un anello di avanzamento sul pulsante. L’avanzamento e i controlli compaiono nel fumetto.",
    "tr": "Araştırma Sohbeti başlığındaki Dinle düğmesi artık yalnızca Dinle balonunu açıyor. Kendi başına oynatmayı veya ses üretmeyi başlatmıyor. Düğmenin üzerinde ilerleme halkası da göstermiyor. İlerleme ve denetimler balonun içinde görünüyor.",
    "zh-CN": "研究聊天标题栏中的“收听”按钮现在只会打开“收听”气泡。它不再自行开始播放或生成音频，按钮上也不再显示进度圆环。进度和控件都显示在气泡中。",
    "zh-TW": "研究聊天標題列中的「收聽」按鈕現在只會開啟「收聽」氣泡。它不再自行開始播放或產生音訊，按鈕上也不再顯示進度圓環。進度和控制項都顯示在氣泡中。",
    "ja": "リサーチチャットのヘッダーにある「聞く」ボタンは、「聞く」バルーンを開くだけになりました。自動で再生や音声の生成を始めることはありません。ボタンに進行状況のリングも表示しません。進行状況とコントロールはバルーンの中に表示されます。",
    "ko": "리서치 채팅 헤더의 듣기 버튼은 이제 듣기 풍선만 엽니다. 더 이상 스스로 재생하거나 오디오 생성을 시작하지 않습니다. 버튼에 진행 링도 표시하지 않습니다. 진행 상황과 컨트롤은 풍선 안에 표시됩니다.",
  },
];
