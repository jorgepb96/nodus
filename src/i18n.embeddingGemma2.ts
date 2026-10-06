const KEYS = [
  'Texto multilingüe · perfil recomendado de esta familia. Validación de producto pendiente.',
  'Texto multilingüe · índice más pequeño. Validación de producto pendiente.',
  'Los perfiles de 256 y 512 dimensiones comparten una única descarga. Eliminarla afecta a ambos.',
  'Se eliminarán los pesos compartidos de los perfiles de 256 y 512 dimensiones.',
  'Apache-2.0 · revisar términos del recurso',
  'Experimental',
] as const;

function table(values: readonly string[]): Record<string, string> {
  if (values.length !== KEYS.length) throw new Error('EmbeddingGemma translations are incomplete.');
  return Object.fromEntries(KEYS.map((key, index) => [key, values[index]]));
}

export const EMBEDDING_GEMMA2_TRANSLATIONS = {
  en: table([
    'Multilingual text · recommended profile in this family. Product validation pending.',
    'Multilingual text · smaller index. Product validation pending.',
    'The 256- and 512-dimensional profiles share one download. Deleting it affects both.',
    'The shared weights for the 256- and 512-dimensional profiles will be deleted.',
    'Apache-2.0 · review resource terms',
    'Experimental',
  ]),
  fr: table([
    'Texte multilingue · profil recommandé de cette famille. Validation du produit en attente.',
    'Texte multilingue · index plus petit. Validation du produit en attente.',
    'Les profils de 256 et 512 dimensions partagent un seul téléchargement. Sa suppression affecte les deux.',
    'Les poids partagés des profils de 256 et 512 dimensions seront supprimés.',
    'Apache-2.0 · consulter les conditions de la ressource',
    'Expérimental',
  ]),
  de: table([
    'Mehrsprachiger Text · empfohlenes Profil dieser Familie. Produktvalidierung steht aus.',
    'Mehrsprachiger Text · kleinerer Index. Produktvalidierung steht aus.',
    'Die Profile mit 256 und 512 Dimensionen verwenden denselben Download. Das Löschen betrifft beide.',
    'Die gemeinsamen Gewichte der Profile mit 256 und 512 Dimensionen werden gelöscht.',
    'Apache-2.0 · Bedingungen der Ressource prüfen',
    'Experimentell',
  ]),
  pt: table([
    'Texto multilingue · perfil recomendado desta família. Validação do produto pendente.',
    'Texto multilingue · índice mais pequeno. Validação do produto pendente.',
    'Os perfis de 256 e 512 dimensões partilham uma única transferência. Eliminá-la afeta ambos.',
    'Os pesos partilhados dos perfis de 256 e 512 dimensões serão eliminados.',
    'Apache-2.0 · consultar os termos do recurso',
    'Experimental',
  ]),
  'pt-BR': table([
    'Texto multilíngue · perfil recomendado desta família. Validação do produto pendente.',
    'Texto multilíngue · índice menor. Validação do produto pendente.',
    'Os perfis de 256 e 512 dimensões compartilham um único download. Excluí-lo afeta ambos.',
    'Os pesos compartilhados dos perfis de 256 e 512 dimensões serão excluídos.',
    'Apache-2.0 · consultar os termos do recurso',
    'Experimental',
  ]),
  it: table([
    'Testo multilingue · profilo consigliato di questa famiglia. Validazione del prodotto in attesa.',
    'Testo multilingue · indice più piccolo. Validazione del prodotto in attesa.',
    'I profili a 256 e 512 dimensioni condividono un unico download. Eliminarlo interessa entrambi.',
    'I pesi condivisi dei profili a 256 e 512 dimensioni verranno eliminati.',
    'Apache-2.0 · consultare i termini della risorsa',
    'Sperimentale',
  ]),
  tr: table([
    'Çok dilli metin · bu ailede önerilen profil. Ürün doğrulaması bekleniyor.',
    'Çok dilli metin · daha küçük dizin. Ürün doğrulaması bekleniyor.',
    '256 ve 512 boyutlu profiller tek bir indirmeyi paylaşır. Silinmesi her ikisini de etkiler.',
    '256 ve 512 boyutlu profillerin paylaşılan ağırlıkları silinecek.',
    'Apache-2.0 · kaynağın koşullarını inceleyin',
    'Deneysel',
  ]),
  'zh-CN': table([
    '多语言文本 · 此系列的推荐配置。产品验证尚待完成。',
    '多语言文本 · 更小的索引。产品验证尚待完成。',
    '256 维和 512 维配置共用一次下载。删除后两者都会受到影响。',
    '将删除 256 维和 512 维配置共用的权重。',
    'Apache-2.0 · 查看资源条款',
    '实验性',
  ]),
  'zh-TW': table([
    '多語言文字 · 此系列的建議設定。產品驗證尚待完成。',
    '多語言文字 · 較小的索引。產品驗證尚待完成。',
    '256 維和 512 維設定共用一次下載。刪除後兩者都會受到影響。',
    '將刪除 256 維和 512 維設定共用的權重。',
    'Apache-2.0 · 查看資源條款',
    '實驗性',
  ]),
  ja: table([
    '多言語テキスト · このモデル群の推奨プロファイル。製品としての検証は未完了です。',
    '多言語テキスト · 小さなインデックス。製品としての検証は未完了です。',
    '256 次元と 512 次元のプロファイルは同じダウンロードを共有します。削除すると両方に影響します。',
    '256 次元と 512 次元のプロファイルが共有する重みを削除します。',
    'Apache-2.0 · リソースの利用条件を確認',
    '実験的',
  ]),
  ko: table([
    '다국어 텍스트 · 이 모델군의 권장 프로필. 제품 검증이 아직 완료되지 않았습니다.',
    '다국어 텍스트 · 더 작은 인덱스. 제품 검증이 아직 완료되지 않았습니다.',
    '256차원 및 512차원 프로필은 하나의 다운로드를 공유합니다. 삭제하면 두 프로필 모두에 영향을 줍니다.',
    '256차원 및 512차원 프로필이 공유하는 가중치가 삭제됩니다.',
    'Apache-2.0 · 리소스 이용 조건 확인',
    '실험적',
  ]),
} as const;
