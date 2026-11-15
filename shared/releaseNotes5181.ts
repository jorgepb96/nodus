import type { CategorizedReleaseHighlight } from './releaseNotes';

export const RELEASE_5_18_1_HIGHLIGHTS: CategorizedReleaseHighlight[] = [
  {
    "category": "new",
    "scope": "general",
    "es": "Descarga secciones y episodios de podcast desde Nodus Link para consultarlos sin conexión. Eliminar una descarga solo borra la copia del iPhone o iPad. Los datos del ordenador se conservan.",
    "en": "Download selected sections and podcast episodes from Nodus Link for offline use. Removing a download only deletes the iPhone or iPad copy. Desktop data is preserved.",
    "fr": "Téléchargez des sections et des épisodes de podcast depuis Nodus Link pour les consulter hors connexion. Supprimer un téléchargement efface uniquement la copie sur iPhone ou iPad. Les données de l’ordinateur sont conservées.",
    "de": "Lade ausgewählte Bereiche und Podcastfolgen in Nodus Link zur Offline-Nutzung herunter. Das Entfernen eines Downloads löscht nur die Kopie auf dem iPhone oder iPad. Die Daten auf dem Computer bleiben erhalten.",
    "pt": "Descarregue secções e episódios de podcast no Nodus Link para os consultar sem ligação. Remover uma descarga elimina apenas a cópia do iPhone ou iPad. Os dados do computador são conservados.",
    "it": "Scarica sezioni ed episodi podcast da Nodus Link per consultarli senza connessione. Rimuovere un download elimina soltanto la copia su iPhone o iPad. I dati sul computer vengono conservati.",
    "tr": "Çevrimdışı kullanım için Nodus Link’ten bölümleri ve podcast kayıtlarını indirin. Bir indirmeyi kaldırmak yalnızca iPhone veya iPad kopyasını siler. Bilgisayardaki veriler korunur.",
    "ja": "Nodus Link でセクションやポッドキャストのエピソードをダウンロードし、オフラインで参照できます。ダウンロードを削除しても、削除されるのは iPhone または iPad のコピーだけで、パソコンのデータは保持されます。",
    "ko": "Nodus Link에서 섹션과 팟캐스트 에피소드를 다운로드하여 오프라인으로 이용할 수 있습니다. 다운로드를 제거하면 iPhone이나 iPad의 사본만 삭제되며 컴퓨터의 데이터는 보존됩니다.",
    "pt-BR": "Baixe seções e episódios de podcast no Nodus Link para consultar sem conexão. Remover um download apaga apenas a cópia do iPhone ou iPad. Os dados do computador são preservados.",
    "zh-CN": "在 Nodus Link 中下载所选部分和播客节目，以便离线使用。移除下载只会删除 iPhone 或 iPad 上的副本，电脑上的数据仍会保留。",
    "zh-TW": "在 Nodus Link 中下載所選區域與 Podcast 單集，以便離線使用。移除下載只會刪除 iPhone 或 iPad 上的副本，電腦上的資料仍會保留。"
  },
  {
    "category": "fix",
    "scope": "general",
    "es": "Conexión móvil aparece en la sección Aplicación de Ajustes. También se encuentra al buscar Nodus Link, iOS, iPad o Android.",
    "en": "Mobile connection appears under Application in Settings. Searching for Nodus Link, iOS, iPad or Android also finds this section.",
    "fr": "Connexion mobile apparaît dans la section Application des Réglages. Une recherche de Nodus Link, iOS, iPad ou Android trouve également cette section.",
    "de": "Mobile Verbindung erscheint unter Anwendung in den Einstellungen. Der Bereich wird auch bei der Suche nach Nodus Link, iOS, iPad oder Android gefunden.",
    "pt": "A Ligação móvel aparece na secção Aplicação das Definições. Também pode ser encontrada ao pesquisar Nodus Link, iOS, iPad ou Android.",
    "it": "Connessione mobile compare nella sezione Applicazione delle Impostazioni. È disponibile anche cercando Nodus Link, iOS, iPad o Android.",
    "tr": "Mobil bağlantı, Ayarlar’daki Uygulama bölümünde görünür. Nodus Link, iOS, iPad veya Android aramasıyla da bulunabilir.",
    "ja": "設定の「アプリケーション」に「モバイル接続」が表示されます。Nodus Link、iOS、iPad、Android の検索でもこの項目が見つかります。",
    "ko": "설정의 애플리케이션 항목에 모바일 연결이 표시됩니다. Nodus Link, iOS, iPad 또는 Android로 검색해도 이 항목을 찾을 수 있습니다.",
    "pt-BR": "Conexão móvel aparece na seção Aplicativo das Configurações. A seção também pode ser encontrada ao buscar Nodus Link, iOS, iPad ou Android.",
    "zh-CN": "“移动连接”会显示在设置的“应用程序”部分。搜索 Nodus Link、iOS、iPad 或 Android 也能找到此项。",
    "zh-TW": "「行動連線」會顯示在設定的「應用程式」區域。搜尋 Nodus Link、iOS、iPad 或 Android 也能找到此項。"
  },
  {
    "category": "fix",
    "scope": "academic",
    "es": "El lector vinculado recibe las marcas de lectura y anotaciones personales de Deep Research. La búsqueda relacionada usa el índice configurado en el ordenador, con validación del contrato actual, sin pedir claves de proveedores en iOS.",
    "en": "The linked reader receives Deep Research read marks and personal annotations. Related search uses the computer’s configured index, validates its current contract and requires no provider keys on iOS.",
    "fr": "Le lecteur associé reçoit les marques de lecture et annotations personnelles de Deep Research. La recherche associée utilise l’index configuré sur l’ordinateur, valide son contrat actuel et ne demande aucune clé de fournisseur sur iOS.",
    "de": "Der verbundene Leser erhält Lesemarkierungen und persönliche Anmerkungen aus Deep Research. Die Suche nach verwandten Inhalten nutzt den konfigurierten Index des Computers, prüft dessen aktuellen Vertrag und benötigt keine Anbieterschlüssel auf iOS.",
    "pt": "O leitor associado recebe as marcas de leitura e anotações pessoais do Deep Research. A pesquisa relacionada usa o índice configurado no computador, valida o contrato atual e não pede chaves de fornecedores no iOS.",
    "it": "Il lettore collegato riceve i contrassegni di lettura e le annotazioni personali di Deep Research. La ricerca correlata usa l’indice configurato sul computer, ne convalida il contratto attuale e non richiede chiavi dei fornitori su iOS.",
    "tr": "Bağlı okuyucu, Deep Research okuma işaretlerini ve kişisel açıklamaları alır. İlgili arama, bilgisayarda yapılandırılmış dizini kullanır, geçerli sözleşmesini doğrular ve iOS’te sağlayıcı anahtarı gerektirmez.",
    "ja": "連携したリーダーで Deep Research の既読状態と個人の注釈を利用できます。関連検索はパソコンで設定したインデックスを使い、現在の契約情報を検証します。iOS でプロバイダーのキーを入力する必要はありません。",
    "ko": "연결된 리더에서 Deep Research의 읽음 표시와 개인 주석을 이용할 수 있습니다. 관련 검색은 컴퓨터에 설정된 인덱스를 사용하고 현재 계약 정보를 검증하며 iOS에서 제공자 키를 요구하지 않습니다.",
    "pt-BR": "O leitor vinculado recebe as marcas de leitura e anotações pessoais do Deep Research. A busca relacionada usa o índice configurado no computador, valida o contrato atual e não pede chaves de provedores no iOS.",
    "zh-CN": "已连接的阅读器可获取 Deep Research 的已读标记和个人批注。相关搜索使用电脑上配置的索引并验证其当前契约，iOS 无需提供服务商密钥。",
    "zh-TW": "已連線的閱讀器可取得 Deep Research 的已讀標記與個人註解。相關搜尋使用電腦上設定的索引並驗證目前的契約，iOS 無須提供服務商金鑰。"
  },
  {
    "category": "enhancement",
    "scope": "academic",
    "es": "Busca ideas y temas desde un único campo. Los mapas de argumentos usan la pantalla completa nativa de iOS y alinean sus controles con la barra de pestañas.",
    "en": "Search ideas and themes in one field. Argument maps use native full screen on iOS, with controls aligned to the tab bar.",
    "fr": "Recherchez idées et thèmes dans un seul champ. Les cartes d’arguments utilisent le plein écran natif sur iOS, avec des commandes alignées sur la barre d’onglets.",
    "de": "Suche Ideen und Themen in einem gemeinsamen Feld. Argumentkarten nutzen unter iOS den nativen Vollbildmodus mit Bedienelementen, die an der Tableiste ausgerichtet sind.",
    "pt": "Pesquise ideias e temas num único campo. Os mapas de argumentos usam o ecrã inteiro nativo do iOS, com controlos alinhados com a barra de separadores.",
    "it": "Cerca idee e temi in un unico campo. Le mappe argomentative usano lo schermo intero nativo di iOS, con controlli allineati alla barra delle schede.",
    "tr": "Fikirleri ve temaları tek alanda arayın. Argüman haritaları iOS’in yerel tam ekranını kullanır. Kontroller sekme çubuğuyla hizalanır.",
    "ja": "1 つの欄からアイデアとテーマを検索できます。議論マップは iOS のネイティブ全画面表示を使い、操作ボタンをタブバーに揃えます。",
    "ko": "하나의 입력란에서 아이디어와 주제를 검색할 수 있습니다. 논증 지도는 iOS의 기본 전체 화면을 사용하며 컨트롤을 탭 막대에 맞춰 배치합니다.",
    "pt-BR": "Busque ideias e temas em um único campo. Os mapas de argumentos usam a tela cheia nativa do iOS, com controles alinhados à barra de abas.",
    "zh-CN": "在同一个输入框中搜索想法和主题。论证图在 iOS 上使用原生全屏显示，控件与标签栏对齐。",
    "zh-TW": "在同一個欄位中搜尋想法與主題。論證圖在 iOS 上使用原生全螢幕顯示，控制項與分頁列對齊。"
  }
];
