import type { AppLanguage } from './types';

type Translations = Partial<Record<AppLanguage, string>> & { en: string };

// Scriptor validation and storage errors share the IPC error catalogue. Keep the
// conflict codes intact: consumers use them to retain and recover local drafts.
const languages = ['en', 'fr', 'de', 'pt', 'it', 'tr', 'zh-CN'] as const;
type ErrorRow = [string, string, string, string, string, string, string, string];
const rows: ErrorRow[] = [
  ['REVISION_CONFLICT: Guarda o recarga el manuscrito antes de exportar.', 'REVISION_CONFLICT: Save or reload the manuscript before exporting.', 'REVISION_CONFLICT: Enregistrez ou rechargez le manuscrit avant de l’exporter.', 'REVISION_CONFLICT: Speichern oder laden Sie das Manuskript vor dem Export neu.', 'REVISION_CONFLICT: Guarde ou recarregue o manuscrito antes de exportar.', 'REVISION_CONFLICT: Salva o ricarica il manoscritto prima di esportarlo.', 'REVISION_CONFLICT: Dışa aktarmadan önce el yazmasını kaydedin veya yeniden yükleyin.', 'REVISION_CONFLICT: 导出前请保存或重新加载文稿。'],
  ['REVISION_CONFLICT: El documento ha cambiado en otra sesión. El borrador se conserva.', 'REVISION_CONFLICT: The document changed in another session. Your draft is preserved.', 'REVISION_CONFLICT: Le document a changé dans une autre session. Votre brouillon est conservé.', 'REVISION_CONFLICT: Das Dokument wurde in einer anderen Sitzung geändert. Ihr Entwurf bleibt erhalten.', 'REVISION_CONFLICT: O documento foi alterado noutra sessão. O rascunho é preservado.', 'REVISION_CONFLICT: Il documento è cambiato in un’altra sessione. La bozza è conservata.', 'REVISION_CONFLICT: Belge başka bir oturumda değişti. Taslağınız korunuyor.', 'REVISION_CONFLICT: 文档已在另一会话中更改。草稿已保留。'],
  ['REVISION_CONFLICT: La nota ha cambiado en otra sesión. El borrador se conserva.', 'REVISION_CONFLICT: The note changed in another session. Your draft is preserved.', 'REVISION_CONFLICT: La note a changé dans une autre session. Votre brouillon est conservé.', 'REVISION_CONFLICT: Die Notiz wurde in einer anderen Sitzung geändert. Ihr Entwurf bleibt erhalten.', 'REVISION_CONFLICT: A nota foi alterada noutra sessão. O rascunho é preservado.', 'REVISION_CONFLICT: La nota è cambiata in un’altra sessione. La bozza è conservata.', 'REVISION_CONFLICT: Not başka bir oturumda değişti. Taslağınız korunuyor.', 'REVISION_CONFLICT: 笔记已在另一会话中更改。草稿已保留。'],
  ['REVISION_CONFLICT: La nota ha cambiado en otra sesión.', 'REVISION_CONFLICT: The note changed in another session.', 'REVISION_CONFLICT: La note a changé dans une autre session.', 'REVISION_CONFLICT: Die Notiz wurde in einer anderen Sitzung geändert.', 'REVISION_CONFLICT: A nota foi alterada noutra sessão.', 'REVISION_CONFLICT: La nota è cambiata in un’altra sessione.', 'REVISION_CONFLICT: Not başka bir oturumda değişti.', 'REVISION_CONFLICT: 笔记已在另一会话中更改。'],
  ['El adjunto supera 20 MB.', 'The attachment exceeds 20 MB.', 'La pièce jointe dépasse 20 Mo.', 'Der Anhang überschreitet 20 MB.', 'O anexo excede 20 MB.', 'L’allegato supera 20 MB.', 'Ek 20 MB sınırını aşıyor.', '附件超过 20 MB。'],
  ['Hay versiones diferentes de una fuente. Actualiza sus citas antes de exportar.', 'A source has different versions. Update its citations before exporting.', 'Une source possède plusieurs versions. Mettez à jour ses citations avant l’exportation.', 'Eine Quelle liegt in verschiedenen Versionen vor. Aktualisieren Sie ihre Zitate vor dem Export.', 'Uma fonte tem versões diferentes. Atualize as suas citações antes de exportar.', 'Una fonte ha versioni diverse. Aggiorna le sue citazioni prima di esportare.', 'Bir kaynağın farklı sürümleri var. Dışa aktarmadan önce atıflarını güncelleyin.', '同一来源存在不同版本。导出前请更新其引文。'],
  ['Revisa y reconoce las advertencias antes de exportar.', 'Review and acknowledge the warnings before exporting.', 'Vérifiez et acceptez les avertissements avant l’exportation.', 'Prüfen und bestätigen Sie die Warnungen vor dem Export.', 'Reveja e confirme os avisos antes de exportar.', 'Controlla e conferma gli avvisi prima di esportare.', 'Dışa aktarmadan önce uyarıları inceleyip onaylayın.', '导出前请查看并确认警告。'],
  ['El estilo bibliográfico no está disponible sin conexión.', 'The bibliography style is unavailable offline.', 'Le style bibliographique n’est pas disponible hors ligne.', 'Der Bibliografiestil ist offline nicht verfügbar.', 'O estilo bibliográfico não está disponível sem ligação.', 'Lo stile bibliografico non è disponibile offline.', 'Kaynakça stili çevrimdışı kullanılamıyor.', '离线时无法使用该参考文献样式。'],
  ['Instantánea académica inválida.', 'Invalid academic snapshot.', 'Instantané académique invalide.', 'Ungültiger akademischer Snapshot.', 'Instantâneo académico inválido.', 'Istantanea accademica non valida.', 'Akademik anlık görüntü geçersiz.', '学术快照无效。'],
  ['Formato académico desconocido.', 'Unknown academic format.', 'Format académique inconnu.', 'Unbekanntes akademisches Format.', 'Formato académico desconhecido.', 'Formato accademico sconosciuto.', 'Akademik biçim bilinmiyor.', '未知的学术格式。'],
  ['Metadatos académicos inválidos.', 'Invalid academic metadata.', 'Métadonnées académiques invalides.', 'Ungültige akademische Metadaten.', 'Metadados académicos inválidos.', 'Metadati accademici non validi.', 'Akademik üst veriler geçersiz.', '学术元数据无效。'],
  ['Versión académica no compatible. Conserva el borrador.', 'Unsupported academic version. Keep your draft.', 'Version académique non prise en charge. Conservez votre brouillon.', 'Nicht unterstützte akademische Version. Bewahren Sie Ihren Entwurf auf.', 'Versão académica não compatível. Conserve o rascunho.', 'Versione accademica non supportata. Conserva la bozza.', 'Akademik sürüm desteklenmiyor. Taslağınızı saklayın.', '不支持该学术版本。请保留草稿。'],
  ['Los metadatos académicos superan el límite permitido.', 'Academic metadata exceeds the allowed limit.', 'Les métadonnées académiques dépassent la limite autorisée.', 'Die akademischen Metadaten überschreiten das zulässige Limit.', 'Os metadados académicos excedem o limite permitido.', 'I metadati accademici superano il limite consentito.', 'Akademik üst veriler izin verilen sınırı aşıyor.', '学术元数据超过允许的限制。'],
  ['Preferencias bibliográficas inválidas.', 'Invalid bibliography preferences.', 'Préférences bibliographiques invalides.', 'Ungültige Bibliografieeinstellungen.', 'Preferências bibliográficas inválidas.', 'Preferenze bibliografiche non valide.', 'Kaynakça tercihleri geçersiz.', '参考文献偏好设置无效。'],
  ['El estilo CSL debe ser independiente, sin entidades externas y menor de 1 MB.', 'The CSL style must be independent, contain no external entities and be smaller than 1 MB.', 'Le style CSL doit être indépendant, sans entités externes et inférieur à 1 Mo.', 'Der CSL-Stil muss unabhängig sein, darf keine externen Entitäten enthalten und muss kleiner als 1 MB sein.', 'O estilo CSL deve ser independente, sem entidades externas e inferior a 1 MB.', 'Lo stile CSL deve essere indipendente, senza entità esterne e inferiore a 1 MB.', 'CSL stili bağımsız olmalı, dış varlık içermemeli ve 1 MB’tan küçük olmalıdır.', 'CSL 样式必须独立、不含外部实体且小于 1 MB。'],
  ['Identificador de nota inválido.', 'Invalid note identifier.', 'Identifiant de note invalide.', 'Ungültige Notizkennung.', 'O identificador da nota é inválido.', 'Identificatore della nota non valido.', 'Not tanımlayıcısı geçersiz.', '笔记标识符无效。'],
  ['Tipo de nota inválido.', 'Invalid note type.', 'Type de note invalide.', 'Ungültiger Notiztyp.', 'O tipo de nota é inválido.', 'Tipo di nota non valido.', 'Not türü geçersiz.', '笔记类型无效。'],
  ['Destino de evidencia inválido.', 'Invalid evidence target.', 'Destination de preuve invalide.', 'Ungültiges Belegziel.', 'Destino de evidência inválido.', 'Destinazione della prova non valida.', 'Kanıt hedefi geçersiz.', '证据目标无效。'],
  ['Página física inválida.', 'Invalid physical page.', 'Page physique invalide.', 'Ungültige physische Seite.', 'A página física é inválida.', 'Pagina fisica non valida.', 'Fiziksel sayfa geçersiz.', '实际页码无效。'],
  ['Anclaje de evidencia inválido.', 'Invalid evidence anchor.', 'Ancrage de preuve invalide.', 'Ungültiger Beleganker.', 'Âncora de evidência inválida.', 'Ancoraggio della prova non valido.', 'Kanıt bağlantı noktası geçersiz.', '证据锚点无效。'],
  ['Capítulo inválido.', 'Invalid chapter.', 'Chapitre invalide.', 'Ungültiges Kapitel.', 'O capítulo é inválido.', 'Capitolo non valido.', 'Bölüm geçersiz.', '章节无效。'],
  ['Datos de portada inválidos.', 'Invalid cover data.', 'Données de couverture invalides.', 'Ungültige Titelseitendaten.', 'Dados de capa inválidos.', 'Dati di copertina non validi.', 'Kapak verileri geçersiz.', '封面数据无效。'],
  ['Configuración de manuscrito inválida.', 'Invalid manuscript settings.', 'Paramètres du manuscrit invalides.', 'Ungültige Manuskripteinstellungen.', 'Configuração de manuscrito inválida.', 'Impostazioni del manoscritto non valide.', 'El yazması ayarları geçersiz.', '文稿设置无效。'],
  ['La fórmula contiene un elemento no compatible con Word:', 'The formula contains an element unsupported by Word:', 'La formule contient un élément non pris en charge par Word :', 'Die Formel enthält ein von Word nicht unterstütztes Element:', 'A fórmula contém um elemento não compatível com o Word:', 'La formula contiene un elemento non supportato da Word:', 'Formül Word tarafından desteklenmeyen bir öğe içeriyor:', '公式包含 Word 不支持的元素：'],
  ['La imagen no se puede representar sin pérdida en Word. Usa PNG o JPEG.', 'The image cannot be represented losslessly in Word. Use PNG or JPEG.', 'L’image ne peut pas être représentée sans perte dans Word. Utilisez PNG ou JPEG.', 'Das Bild kann in Word nicht verlustfrei dargestellt werden. Verwenden Sie PNG oder JPEG.', 'A imagem não pode ser representada sem perdas no Word. Use PNG ou JPEG.', 'L’immagine non può essere rappresentata senza perdita in Word. Usa PNG o JPEG.', 'Görüntü Word’de kayıpsız gösterilemiyor. PNG veya JPEG kullanın.', '无法在 Word 中无损呈现该图像。请使用 PNG 或 JPEG。'],
  ['No se pueden recuperar las dimensiones de la imagen.', 'The image dimensions could not be retrieved.', 'Impossible de récupérer les dimensions de l’image.', 'Die Bildabmessungen konnten nicht ermittelt werden.', 'Não foi possível obter as dimensões da imagem.', 'Impossibile recuperare le dimensioni dell’immagine.', 'Görüntü boyutları alınamadı.', '无法获取图像尺寸。'],
  ['Fórmula no compatible con una entrega segura.', 'The formula is unsupported for a safe submission.', 'La formule n’est pas prise en charge pour une remise fiable.', 'Die Formel wird für eine sichere Abgabe nicht unterstützt.', 'A fórmula não é compatível com uma entrega segura.', 'La formula non è supportata per una consegna sicura.', 'Formül güvenli teslim için desteklenmiyor.', '该公式不支持安全提交。'],
  ['Fórmula inválida.', 'Invalid formula.', 'Formule invalide.', 'Ungültige Formel.', 'A fórmula é inválida.', 'Formula non valida.', 'Formül geçersiz.', '公式无效。'],
  ['ACADEMIC_PROJECTION_CONFLICT: Edita las notas y la bibliografía desde el contexto académico.', 'ACADEMIC_PROJECTION_CONFLICT: Edit notes and the bibliography in the academic context panel.', 'ACADEMIC_PROJECTION_CONFLICT: Modifiez les notes et la bibliographie dans le panneau de contexte académique.', 'ACADEMIC_PROJECTION_CONFLICT: Bearbeiten Sie Notizen und Bibliografie im akademischen Kontextbereich.', 'ACADEMIC_PROJECTION_CONFLICT: Edite as notas e a bibliografia no painel de contexto académico.', 'ACADEMIC_PROJECTION_CONFLICT: Modifica le note e la bibliografia nel pannello di contesto accademico.', 'ACADEMIC_PROJECTION_CONFLICT: Notları ve kaynakçayı akademik bağlam panelinde düzenleyin.', 'ACADEMIC_PROJECTION_CONFLICT: 请在学术上下文面板中编辑注释和参考文献。'],
  ['El documento BlockNote debe ser un array.', 'The BlockNote document must be an array.', 'Le document BlockNote doit être un tableau.', 'Das BlockNote-Dokument muss ein Array sein.', 'O documento BlockNote deve ser um array.', 'Il documento BlockNote deve essere un array.', 'BlockNote belgesi bir dizi olmalıdır.', 'BlockNote 文档必须是数组。'],
  ['El documento supera el límite de 4 MB.', 'The document exceeds the 4 MB limit.', 'Le document dépasse la limite de 4 Mo.', 'Das Dokument überschreitet das Limit von 4 MB.', 'O documento excede o limite de 4 MB.', 'Il documento supera il limite di 4 MB.', 'Belge 4 MB sınırını aşıyor.', '文档超过 4 MB 的限制。'],
  ['La jerarquía del documento es demasiado profunda.', 'The document hierarchy is too deep.', 'La hiérarchie du document est trop profonde.', 'Die Dokumenthierarchie ist zu tief.', 'A hierarquia do documento é demasiado profunda.', 'La gerarchia del documento è troppo profonda.', 'Belge hiyerarşisi çok derin.', '文档层级过深。'],
  ['Identificador de bloque vacío o duplicado.', 'Empty or duplicate block identifier.', 'Identifiant de bloc vide ou dupliqué.', 'Leere oder doppelte Blockkennung.', 'Identificador de bloco vazio ou duplicado.', 'Identificatore di blocco vuoto o duplicato.', 'Blok tanımlayıcısı boş veya yinelenmiş.', '块标识符为空或重复。'],
  ['Tipo o propiedades de bloque no válidos.', 'Invalid block type or properties.', 'Type ou propriétés de bloc invalides.', 'Ungültiger Blocktyp oder ungültige Blockeigenschaften.', 'Tipo ou propriedades de bloco inválidos.', 'Tipo o proprietà di blocco non validi.', 'Blok türü veya özellikleri geçersiz.', '块类型或属性无效。'],
  ['El documento supera los 10.000 bloques.', 'The document exceeds 10,000 blocks.', 'Le document dépasse 10 000 blocs.', 'Das Dokument überschreitet 10.000 Blöcke.', 'O documento excede 10.000 blocos.', 'Il documento supera 10.000 blocchi.', 'Belge 10.000 bloğu aşıyor.', '文档超过 10,000 个块。'],
  ['Hijos de bloque no válidos.', 'Invalid block children.', 'Blocs enfants invalides.', 'Ungültige untergeordnete Blöcke.', 'Blocos filhos inválidos.', 'Blocchi figli non validi.', 'Alt bloklar geçersiz.', '子块无效。'],
  ['ACADEMIC_PROJECTION_CONFLICT: Esta edición eliminaría citas o notas estructuradas. Abre Scriptor para resolverla; el borrador se conserva.', 'ACADEMIC_PROJECTION_CONFLICT: This edit would remove structured citations or notes. Open Scriptor to resolve it; your draft is preserved.', 'ACADEMIC_PROJECTION_CONFLICT: Cette modification supprimerait des citations ou notes structurées. Ouvrez Scriptor pour la résoudre ; votre brouillon est conservé.', 'ACADEMIC_PROJECTION_CONFLICT: Diese Änderung würde strukturierte Zitate oder Notizen entfernen. Öffnen Sie Scriptor, um sie zu klären; Ihr Entwurf bleibt erhalten.', 'ACADEMIC_PROJECTION_CONFLICT: Esta edição eliminaria citações ou notas estruturadas. Abra o Scriptor para a resolver; o rascunho é preservado.', 'ACADEMIC_PROJECTION_CONFLICT: Questa modifica eliminerebbe citazioni o note strutturate. Apri Scriptor per risolverla; la bozza è conservata.', 'ACADEMIC_PROJECTION_CONFLICT: Bu düzenleme yapılandırılmış atıfları veya notları silecektir. Çözmek için Scriptor’u açın; taslağınız korunuyor.', 'ACADEMIC_PROJECTION_CONFLICT: 此编辑会删除结构化引文或注释。请打开 Scriptor 解决；草稿已保留。'],
];

export const SCRIPTOR_RUNTIME_ERRORS: Record<string, Translations> = {
  ...Object.fromEntries(rows.map(([source, ...values]) => {
    const translations = Object.fromEntries(languages.map((language, index) => [language, values[index]])) as Translations;
    translations['pt-BR'] = translations.pt;
    return [source, translations];
  })),
  'Solicitud de imagen inválida.': {
    en: 'Invalid image request.', fr: 'Demande d’image invalide.', de: 'Ungültige Bildanfrage.',
    pt: 'Pedido de imagem inválido.', 'pt-BR': 'Solicitação de imagem inválida.',
    it: 'Richiesta di immagine non valida.', tr: 'Geçersiz görsel isteği.',
    'zh-CN': '图像请求无效。', 'zh-TW': '圖像請求無效。', ja: '画像リクエストが無効です。', ko: '이미지 요청이 잘못되었습니다.',
  },
  'Describe la imagen con un máximo de 8.000 caracteres.': {
    en: 'Describe the image using no more than 8,000 characters.',
    fr: 'Décrivez l’image en 8 000 caractères maximum.', de: 'Beschreiben Sie das Bild mit höchstens 8.000 Zeichen.',
    pt: 'Descreva a imagem com um máximo de 8.000 caracteres.', 'pt-BR': 'Descreva a imagem com no máximo 8.000 caracteres.',
    it: 'Descrivi l’immagine con un massimo di 8.000 caratteri.', tr: 'Görseli en fazla 8.000 karakterle açıklayın.',
    'zh-CN': '请用不超过 8,000 个字符描述图像。', 'zh-TW': '請用不超過 8,000 個字元描述圖像。',
    ja: '画像の説明は8,000文字以内で入力してください。', ko: '이미지 설명은 8,000자 이내로 입력하세요.',
  },
  'Elige un modelo de imagen disponible.': {
    en: 'Choose an available image model.', fr: 'Choisissez un modèle d’image disponible.', de: 'Wählen Sie ein verfügbares Bildmodell.',
    pt: 'Escolha um modelo de imagem disponível.', 'pt-BR': 'Escolha um modelo de imagem disponível.',
    it: 'Scegli un modello di immagine disponibile.', tr: 'Kullanılabilir bir görsel modeli seçin.',
    'zh-CN': '请选择可用的图像模型。', 'zh-TW': '請選擇可用的圖像模型。', ja: '利用可能な画像モデルを選択してください。', ko: '사용 가능한 이미지 모델을 선택하세요.',
  },
  'La imagen supera 20 MB.': {
    en: 'The image exceeds 20 MB.', fr: 'L’image dépasse 20 Mo.', de: 'Das Bild überschreitet 20 MB.',
    pt: 'A imagem excede 20 MB.', 'pt-BR': 'A imagem excede 20 MB.', it: 'L’immagine supera 20 MB.', tr: 'Görsel 20 MB sınırını aşıyor.',
    'zh-CN': '图像超过 20 MB。', 'zh-TW': '圖像超過 20 MB。', ja: '画像が20 MBを超えています。', ko: '이미지가 20 MB를 초과합니다.',
  },
  'Las instrucciones superan el límite de 4.000 caracteres.': {
    en: 'The instructions exceed the 4,000-character limit.', fr: 'Les instructions dépassent la limite de 4 000 caractères.',
    de: 'Die Anweisungen überschreiten das Limit von 4.000 Zeichen.',
    pt: 'As instruções excedem o limite de 4.000 caracteres.', 'pt-BR': 'As instruções excedem o limite de 4.000 caracteres.',
    it: 'Le istruzioni superano il limite di 4.000 caratteri.', tr: 'Talimatlar 4.000 karakter sınırını aşıyor.',
    'zh-CN': '指令超过 4,000 个字符的限制。', 'zh-TW': '指令超過 4,000 個字元的限制。',
    ja: '指示が4,000文字の上限を超えています。', ko: '지시가 4,000자 제한을 초과합니다.',
  },
  'La IA no devolvió texto. El original no se ha modificado.': {
    en: 'AI returned no text. The original has not been modified.',
    fr: 'L’IA n’a renvoyé aucun texte. L’original n’a pas été modifié.', de: 'Die KI hat keinen Text zurückgegeben. Das Original wurde nicht geändert.',
    pt: 'A IA não devolveu texto. O original não foi alterado.', 'pt-BR': 'A IA não retornou texto. O original não foi alterado.',
    it: 'L’IA non ha restituito testo. L’originale non è stato modificato.', tr: 'Yapay zekâ metin döndürmedi. Orijinal metin değiştirilmedi.',
    'zh-CN': 'AI 未返回文本。原文未被修改。', 'zh-TW': 'AI 未傳回文字。原文未被修改。',
    ja: 'AIからテキストが返されませんでした。原文は変更されていません。', ko: 'AI가 텍스트를 반환하지 않았습니다. 원문은 변경되지 않았습니다.',
  },
  'La solicitud ya está en curso.': {
    en: 'The request is already in progress.', fr: 'La demande est déjà en cours.', de: 'Die Anfrage wird bereits bearbeitet.',
    pt: 'O pedido já está em curso.', 'pt-BR': 'A solicitação já está em andamento.', it: 'La richiesta è già in corso.', tr: 'İstek zaten devam ediyor.',
    'zh-CN': '请求已在进行中。', 'zh-TW': '請求已在進行中。', ja: 'リクエストはすでに処理中です。', ko: '요청이 이미 진행 중입니다.',
  },
};

export const SCRIPTOR_RUNTIME_ERROR_PATTERNS = [{
  pattern: /^La fórmula contiene un elemento no compatible con Word: (.+)$/,
  translate: (element: string): Translations => Object.fromEntries(Object.entries(SCRIPTOR_RUNTIME_ERRORS['La fórmula contiene un elemento no compatible con Word:']).map(([language, prefix]) => [language, `${prefix} ${element}`])) as Translations,
}];
