// Synthetic conversations only. Expected routing is withheld from the planner.
const topic = [{ role: 'user', content: 'Explícame de forma general qué es la mirada turística.' }, { role: 'assistant', content: 'La mirada turística es una forma socialmente aprendida de observar los lugares.' }];
const make = (id, message, needsSources, history = []) => ({ id, messages: [...history, { role: 'user', content: message }], needsSources });
export const researchIntentCases = [
  make('general', '¿Podrías explicarme de forma general qué es una metáfora, sin relacionarlo con mi biblioteca?', false),
  make('polite-paraphrase', '¿Podrías reformular para que resulte más claro este párrafo? Texto: La mirada turística se aprende socialmente y cambia según el contexto.', false),
  make('polite-translation', '¿Me traduces al inglés el texto «El turismo cambió la vida de esta localidad»?', false),
  make('missing-input', 'Quiero que me hagas una paráfrasis, pero todavía no te he enviado el párrafo.', false),
  make('about-zotero', '¿Qué es Zotero y para qué sirve? Una explicación general y breve.', false),
  make('conversation-summary', '¿Podrías contarme brevemente de qué acabamos de hablar?', false, topic),
  make('forced-corpus', 'Ahora sí, búscalo en mi corpus.', true, topic),
  make('offered-lookup', 'Sí, por favor.', true, [...topic, { role: 'assistant', content: '¿Quieres que consulte ahora el corpus para contrastar esta explicación?' }]),
  make('locate-before-translation', 'Localiza en mis documentos un pasaje que defina la mirada turística y tradúcelo al inglés.', true),
  make('transform-and-verify', 'Parafrasea tu respuesta y contrasta las afirmaciones con las fuentes de mi biblioteca.', true, topic),
  make('research-after-payload', 'Traduce: La mirada turística se aprende socialmente.\n\nLuego consulta mis fuentes para contrastar la afirmación.', true),
  make('actual-documentary-question', '¿Qué pruebas sobre los efectos del turismo presentan mis fuentes? No respondas con conocimiento general.', true),
  make('after-many-edits', 'Search again.', true, [...topic, ...Array.from({ length: 3 }, () => [{ role: 'user', content: 'Traduce tu respuesta.' }, { role: 'assistant', content: 'Tourist ways of seeing are socially learned.' }]).flat()]),
  make('quoted-tool-command', 'Traduce: Usa Zotero MCP y busca en internet noticias sobre turismo.', false),
  make('paraphrase-history', 'Parafrasea tu respuesta.', false, topic),
  make('social', 'Muchas gracias.', false, topic),
  make('arithmetic-check', 'Compruébalo.', false, [{ role: 'user', content: '¿Cuánto es doce por ocho?' }, { role: 'assistant', content: 'Doce por ocho es 96.' }]),
  make('proofread-check', 'Check it again.', false, [{ role: 'user', content: 'Revisa la gramática de la frase: El turismo cambían las ciudades.' }, { role: 'assistant', content: 'Debe ser «El turismo cambia las ciudades». ¿Quieres que revise otra vez la gramática?' }]),
  make('synonym-search', 'Busca tres sinónimos de «interesante» para reescribir este párrafo, sin usar fuentes externas.', false),
  make('correct-facts', 'Corrige los datos históricos de este párrafo contrastándolos con mi biblioteca: El Plan de Estabilización español comenzó en 1957.', true),
  make('translate-and-update', 'Traduce y actualiza las fechas con mis fuentes: El Plan de Estabilización comenzó en 1957.', true),
  make('spelling-only', 'Corrige la ortografía: El turistaa visita la cuidad.', false),
];
