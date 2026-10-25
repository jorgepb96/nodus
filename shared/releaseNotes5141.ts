import type { CategorizedReleaseHighlight } from './releaseNotes';

// Final user-visible outcomes since v5.14.0: indexed vaults keep their embeddings after the
// saved-index migration, and Settings lists embedding indexes without freezing the app.
export const RELEASE_5_14_1_HIGHLIGHTS: CategorizedReleaseHighlight[] = [
  {
    category: 'fix', scope: 'ai',
    "es": "Los vaults que ya estaban indexados conservan la búsqueda semántica al actualizar a la 5.14. La versión 5.14.0 los dejaba sin índice de embeddings activo y pedía reconstruirlo entero. Ahora Nodus reutiliza los embeddings guardados cuando proceden del modelo que el vault sigue usando, sin enviar nada nuevo al proveedor. Solo quedan pendientes los textos que cambiaron después de indexarse.",
    "en": "Vaults that were already indexed keep their semantic search after updating to 5.14. Version 5.14.0 left them without an active embedding index and asked for a full rebuild. Nodus now reuses the stored embeddings when they come from the model the vault still uses, with no new requests to the provider. Only texts that changed after they were indexed appear as pending.",
    "fr": "Les coffres déjà indexés conservent leur recherche sémantique après la mise à jour vers la 5.14. La version 5.14.0 les laissait sans index d’embeddings actif et demandait de le reconstruire entièrement. Nodus réutilise désormais les embeddings enregistrés lorsqu’ils proviennent du modèle que le coffre utilise toujours, sans nouvelle requête au fournisseur. Seuls les textes modifiés après leur indexation restent en attente.",
    "de": "Bereits indexierte Vaults behalten ihre semantische Suche nach dem Update auf 5.14. Version 5.14.0 ließ sie ohne aktiven Embedding-Index und verlangte einen vollständigen Neuaufbau. Nodus verwendet die gespeicherten Embeddings jetzt wieder, wenn sie von dem Modell stammen, das der Vault weiterhin nutzt. Dabei gehen keine neuen Anfragen an den Anbieter. Nur Texte, die sich nach der Indexierung geändert haben, bleiben ausstehend.",
    "pt": "Os cofres que já estavam indexados mantêm a pesquisa semântica após a atualização para a 5.14. A versão 5.14.0 deixava-os sem índice de embeddings ativo e pedia para o reconstruir por completo. Agora o Nodus reutiliza os embeddings guardados quando vêm do modelo que o cofre continua a usar, sem novos pedidos ao fornecedor. Só ficam pendentes os textos que mudaram depois de indexados.",
    "pt-BR": "Os cofres que já estavam indexados mantêm a busca semântica depois da atualização para a 5.14. A versão 5.14.0 os deixava sem índice de embeddings ativo e pedia para reconstruí-lo por completo. Agora o Nodus reutiliza os embeddings salvos quando eles vêm do modelo que o cofre continua usando, sem novas solicitações ao provedor. Só ficam pendentes os textos que mudaram depois de indexados.",
    "it": "I vault già indicizzati mantengono la ricerca semantica dopo l’aggiornamento alla 5.14. La versione 5.14.0 li lasciava senza un indice di embedding attivo e chiedeva di ricostruirlo da zero. Ora Nodus riutilizza gli embedding salvati quando provengono dal modello che il vault usa ancora, senza nuove richieste al fornitore. Restano in sospeso solo i testi modificati dopo l’indicizzazione.",
    "tr": "Zaten dizinlenmiş kasalar, 5.14 sürümüne güncellendikten sonra anlamsal aramalarını koruyor. 5.14.0 sürümü bu kasaları etkin bir gömme dizini olmadan bırakıyor ve dizinin baştan oluşturulmasını istiyordu. Nodus artık kayıtlı gömmeleri, kasanın hâlâ kullandığı modelden geliyorsa yeniden kullanıyor ve sağlayıcıya yeni istek göndermiyor. Yalnızca dizinlendikten sonra değişen metinler bekleyen olarak kalır.",
    "zh-CN": "已经建立索引的资料库在更新到 5.14 后会保留语义搜索。5.14.0 版本会让这些资料库没有可用的嵌入索引，并要求完整重建。现在，如果已保存的嵌入来自资料库仍在使用的模型，Nodus 会直接复用它们，不会向服务商发送新的请求。只有在建立索引后发生变化的文本会显示为待处理。",
    "zh-TW": "已經建立索引的知識庫在更新到 5.14 後會保留語意搜尋。5.14.0 版本會讓這些知識庫沒有可用的嵌入索引，並要求完整重建。現在，如果已保存的嵌入來自知識庫仍在使用的模型，Nodus 會直接重複使用它們，不會向服務供應商傳送新的請求。只有在建立索引後發生變化的文字會顯示為待處理。",
    "ja": "すでに索引済みの Vault は、5.14 に更新した後も意味検索を使えます。5.14.0 では有効な埋め込みインデックスがない状態になり、すべての再構築を求めていました。現在は、保存済みの埋め込みが Vault で引き続き使っているモデルのものであれば、そのまま再利用し、プロバイダーに新しいリクエストを送りません。索引後に変更されたテキストだけが未処理として表示されます。",
    "ko": "이미 색인된 Vault는 5.14로 업데이트한 뒤에도 의미 검색을 유지합니다. 5.14.0은 활성 임베딩 색인이 없는 상태로 남기고 전체 재구축을 요구했습니다. 이제 저장된 임베딩이 Vault가 계속 사용하는 모델에서 만든 것이면 Nodus가 그대로 재사용하며, 제공업체에 새 요청을 보내지 않습니다. 색인 후 바뀐 텍스트만 대기 중으로 표시됩니다.",
  },
  {
    category: 'fix', scope: 'ai',
    "es": "Ajustes ya no congela Nodus al mostrar los índices de embeddings. La lista lee el vault por partes y reutiliza el resultado hasta que cambia el contenido. Mientras se prepara un índice, la lista ya no se recarga después de cada lote.",
    "en": "Settings no longer freezes Nodus while it shows the embedding indexes. The list reads the vault in short steps and reuses the result until the content changes. While an index is being prepared, the list is no longer reloaded after every batch.",
    "fr": "Les Paramètres ne figent plus Nodus pendant l’affichage des index d’embeddings. La liste lit le coffre par petites étapes et réutilise le résultat tant que le contenu ne change pas. Pendant la préparation d’un index, la liste n’est plus rechargée après chaque lot.",
    "de": "Die Einstellungen frieren Nodus beim Anzeigen der Embedding-Indizes nicht mehr ein. Die Liste liest den Vault in kleinen Schritten und verwendet das Ergebnis wieder, bis sich der Inhalt ändert. Während ein Index vorbereitet wird, wird die Liste nicht mehr nach jedem Stapel neu geladen.",
    "pt": "As Definições já não bloqueiam o Nodus ao mostrar os índices de embeddings. A lista lê o cofre por partes e reutiliza o resultado até o conteúdo mudar. Enquanto se prepara um índice, a lista já não é recarregada depois de cada lote.",
    "pt-BR": "As Configurações não travam mais o Nodus ao mostrar os índices de embeddings. A lista lê o cofre em partes e reutiliza o resultado até o conteúdo mudar. Enquanto um índice é preparado, a lista não é mais recarregada depois de cada lote.",
    "it": "Le Impostazioni non bloccano più Nodus mentre mostrano gli indici di embedding. L’elenco legge il vault a piccoli passi e riutilizza il risultato finché il contenuto non cambia. Durante la preparazione di un indice, l’elenco non viene più ricaricato dopo ogni lotto.",
    "tr": "Ayarlar, gömme dizinlerini gösterirken artık Nodus’u dondurmuyor. Liste kasayı küçük adımlarla okuyor ve içerik değişene kadar sonucu yeniden kullanıyor. Bir dizin hazırlanırken liste artık her toplu işlemden sonra yeniden yüklenmiyor.",
    "zh-CN": "在设置中显示嵌入索引时，Nodus 不再卡住。列表会分成小步读取资料库，并在内容发生变化之前一直复用上一次的结果。准备索引期间，列表也不会再在每一批处理完成后重新加载。",
    "zh-TW": "在設定中顯示嵌入索引時，Nodus 不再卡住。清單會分成小步讀取知識庫，並在內容發生變化之前一直重複使用上一次的結果。準備索引期間，清單也不會再在每一批處理完成後重新載入。",
    "ja": "設定で埋め込みインデックスを表示しても、Nodus が固まらなくなりました。一覧は Vault を少しずつ読み込み、内容が変わるまでは前回の結果を再利用します。インデックスの準備中も、バッチごとに一覧を再読み込みしなくなりました。",
    "ko": "설정에서 임베딩 색인을 표시할 때 Nodus가 더 이상 멈추지 않습니다. 목록은 Vault를 조금씩 읽고, 내용이 바뀔 때까지 이전 결과를 재사용합니다. 색인을 준비하는 동안에도 목록이 배치마다 다시 로드되지 않습니다.",
  },
];
