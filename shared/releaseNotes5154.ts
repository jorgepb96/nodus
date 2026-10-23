import type { CategorizedReleaseHighlight } from './releaseNotes';

export const RELEASE_5_15_4_HIGHLIGHTS: CategorizedReleaseHighlight[] = [
  {
    category: 'fix', scope: 'general',
    es: 'El panel Escuchar muestra las fases y el progreso de instalación del motor de voz, permite cancelarla y muestra los errores. Las descargas de modelos muestran actividad desde que pulsas el botón. Al abrir el panel se actualiza el estado, y los modelos que requieren aceptar condiciones te llevan a su sección en Ajustes.',
    en: 'The Listen panel shows voice engine installation phases and progress, lets you cancel the installation and displays errors. Model downloads show activity as soon as you click the button. Opening the panel refreshes its status, and models that require accepting terms take you to their section in Settings.',
    fr: 'Le panneau Écouter affiche les étapes et la progression de l’installation du moteur vocal, permet de l’annuler et affiche les erreurs. Les téléchargements de modèles montrent une activité dès que vous cliquez sur le bouton. L’ouverture du panneau actualise son état, et les modèles qui nécessitent l’acceptation de conditions vous dirigent vers leur section dans les paramètres.',
    de: 'Das Vorlesen-Panel zeigt die Phasen und den Fortschritt der Installation der Sprach-Engine, ermöglicht den Abbruch und zeigt Fehler an. Modelldownloads zeigen sofort nach dem Klick auf die Schaltfläche Aktivität an. Beim Öffnen wird der Status aktualisiert, und Modelle, deren Bedingungen Sie akzeptieren müssen, führen zu ihrem Bereich in den Einstellungen.',
    pt: 'O painel Ouvir mostra as fases e o progresso da instalação do motor de voz, permite cancelá-la e apresenta os erros. As transferências de modelos mostram atividade assim que clica no botão. Ao abrir o painel, o estado é atualizado, e os modelos que exigem a aceitação de condições levam à respetiva secção nas Definições.',
    'pt-BR': 'O painel Ouvir mostra as etapas e o progresso da instalação do mecanismo de voz, permite cancelá-la e exibe os erros. Os downloads de modelos mostram atividade assim que você clica no botão. Ao abrir o painel, o status é atualizado, e os modelos que exigem a aceitação de termos levam à sua seção nas Configurações.',
    it: 'Il pannello Ascolta mostra le fasi e l’avanzamento dell’installazione del motore vocale, permette di annullarla e visualizza gli errori. I download dei modelli mostrano attività appena premi il pulsante. All’apertura del pannello lo stato viene aggiornato, e i modelli che richiedono l’accettazione di condizioni portano alla loro sezione nelle impostazioni.',
    tr: 'Dinle paneli, ses motoru kurulumunun aşamalarını ve ilerlemesini gösterir, kurulumu iptal etmenizi sağlar ve hataları görüntüler. Model indirmeleri, düğmeye tıkladığınız anda etkinlik gösterir. Panel açıldığında durum yenilenir ve koşulların kabul edilmesini gerektiren modeller sizi Ayarlar’daki ilgili bölüme yönlendirir.',
    'zh-CN': '朗读面板会显示语音引擎的安装阶段和进度，支持取消安装，并显示错误。点击按钮后，模型下载会立即显示活动状态。打开面板时会刷新状态，需要接受条款的模型会引导你前往设置中的相应区域。',
    'zh-TW': '朗讀面板會顯示語音引擎的安裝階段和進度，支援取消安裝，並顯示錯誤。點擊按鈕後，模型下載會立即顯示活動狀態。開啟面板時會重新整理狀態，需要接受條款的模型會引導你前往設定中的對應區域。',
    ja: '読み上げパネルに音声エンジンのインストール段階と進行状況が表示され、インストールのキャンセルやエラーの確認ができます。モデルのダウンロードはボタンを押した時点から動作状況を表示します。パネルを開くと状態が更新され、利用条件への同意が必要なモデルは設定内の該当セクションに案内します。',
    ko: '듣기 패널에 음성 엔진의 설치 단계와 진행 상황이 표시되며, 설치를 취소하고 오류를 확인할 수 있습니다. 모델 다운로드는 버튼을 누르는 즉시 활동 상태를 표시합니다. 패널을 열면 상태가 새로 고쳐지고, 약관 동의가 필요한 모델은 설정의 해당 섹션으로 안내합니다.',
  },
  {
    category: 'fix', scope: 'general',
    es: 'En Nodus Scriptor, el botón Escuchar de la cabecera solo abre o cierra el panel. Abrirlo ya no reproduce ni genera audio automáticamente. La reproducción, la generación y la lectura del texto seleccionado se inician desde sus controles.',
    en: 'In Nodus Scriptor, the Listen button in the header only opens or closes the panel. Opening it no longer plays or generates audio automatically. Playback, generation and reading selected text start from their controls.',
    fr: 'Dans Nodus Scriptor, le bouton Écouter de l’en-tête ouvre ou ferme uniquement le panneau. Son ouverture ne lance plus automatiquement la lecture ou la génération audio. La lecture, la génération et la lecture du texte sélectionné démarrent depuis leurs commandes.',
    de: 'In Nodus Scriptor öffnet oder schließt die Vorlesen-Schaltfläche in der Kopfzeile nur das Panel. Beim Öffnen wird Audio nicht mehr automatisch abgespielt oder erzeugt. Wiedergabe, Erzeugung und Vorlesen des ausgewählten Textes starten über die jeweiligen Bedienelemente.',
    pt: 'No Nodus Scriptor, o botão Ouvir no cabeçalho apenas abre ou fecha o painel. Abri-lo já não reproduz nem gera áudio automaticamente. A reprodução, a geração e a leitura do texto selecionado são iniciadas nos respetivos controlos.',
    'pt-BR': 'No Nodus Scriptor, o botão Ouvir no cabeçalho apenas abre ou fecha o painel. Abri-lo não reproduz nem gera áudio automaticamente. A reprodução, a geração e a leitura do texto selecionado são iniciadas pelos respectivos controles.',
    it: 'In Nodus Scriptor, il pulsante Ascolta nell’intestazione apre o chiude soltanto il pannello. Aprirlo non riproduce né genera più audio automaticamente. La riproduzione, la generazione e la lettura del testo selezionato si avviano dai rispettivi controlli.',
    tr: 'Nodus Scriptor’da başlıktaki Dinle düğmesi yalnızca paneli açar veya kapatır. Paneli açmak artık otomatik olarak ses çalmaz ya da üretmez. Oynatma, üretme ve seçili metni okuma işlemleri kendi denetimlerinden başlatılır.',
    'zh-CN': '在 Nodus Scriptor 中，标题栏的朗读按钮仅用于打开或关闭面板。打开面板不再自动播放或生成音频。播放、生成和朗读所选文本均通过各自的控件启动。',
    'zh-TW': '在 Nodus Scriptor 中，標題列的朗讀按鈕僅用於開啟或關閉面板。開啟面板不再自動播放或產生音訊。播放、產生和朗讀所選文字均透過各自的控制項啟動。',
    ja: 'Nodus Scriptor のヘッダーにある読み上げボタンは、パネルを開閉するだけになりました。開くだけで音声が自動的に再生または生成されることはなくなりました。再生、生成、選択したテキストの読み上げは、それぞれの操作から開始します。',
    ko: 'Nodus Scriptor의 헤더에 있는 듣기 버튼은 패널을 열거나 닫기만 합니다. 패널을 열어도 오디오가 자동으로 재생되거나 생성되지 않습니다. 재생, 생성 및 선택한 텍스트 읽기는 각각의 컨트롤에서 시작합니다.',
  },
];
