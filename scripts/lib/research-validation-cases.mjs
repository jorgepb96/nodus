// New, predeclared questions for two consecutive live validation rounds.
// No reference answers are sent to the product model.
export const alburquerqueTitles = ['"Relatos de viaje" y paradigmas culturales', 'El "relato de viajes": hitos y formas en la evolución del género'];
/** Resolve the selected records in the disposable corpus, never a private vault ID.
 * Missing or ambiguous records must fail rather than silently broaden the scope. */
export function resolveValidationWorkIds(item, lookup) {
  if (!item.workTitles) return undefined;
  return item.workTitles.map(title => {
    const matches = lookup(title);
    if (matches.length !== 1) throw new Error(`Expected exactly one benchmark record for ${title}; found ${matches.length}`);
    return matches[0].nodus_id;
  });
}
export const validationCases = {
  1: [
    { id: 'r1-01-continuidad', question: 'Usando solo estas dos obras de Alburquerque, ¿hay evidencia de que él declare una continuidad conceptual entre su propuesta de 2011 y la de 2015? Distingue una referencia bibliográfica, una coincidencia textual y una declaración del autor. No deduzcas la tercera de las otras dos. Máximo 220 palabras.', workTitles: alburquerqueTitles },
    { id: 'r1-02-administracion', question: '¿Qué cambios en la administración turística española durante la Guerra Civil y la inmediata posguerra documenta mi biblioteca? Explica las funciones atribuidas a esos organismos y distingue las fechas comprobadas de las que no puedas fijar. Máximo 250 palabras.' },
    { id: 'r1-03-divisas', question: '¿Cómo explican mis fuentes la relación entre necesidad de divisas y apertura al turismo extranjero bajo Franco? Compara explicaciones y evita convertir una intención económica en un efecto político demostrado. Máximo 250 palabras.' },
    { id: 'r1-04-genero', question: '¿Qué argumentos de mi biblioteca cuestionan que el viajero sea una figura universal y neutra respecto al género? Distingue los pasajes originales de las ideas guardadas y señala si las fuentes permiten hablar de consenso. Máximo 250 palabras.' },
    { id: 'r1-05-masas', question: '¿Cómo se relacionan turismo de masas y distinción social en las fuentes de Urry y Urbain disponibles en mi biblioteca? Aclara si has leído a Urbain directamente o a través de otro autor. Máximo 220 palabras.' },
    { id: 'r1-06-autobiografia', question: '¿Qué separa el relato de viajes de la autobiografía según los textos que puedas consultar? Explica qué ocurre con la identidad entre autor, narrador y personaje sin suponer que esa identidad vuelve autobiográfico cualquier relato. Máximo 200 palabras.' },
    { id: 'r1-07-imagenes', question: '¿Qué significa la expresión teoría cuántica de la imagen en el material de Fontcuberta de mi biblioteca? Identifica quién la formula y no la conviertas en una teoría física ni en una tesis de Alburquerque. Máximo 150 palabras.' },
    { id: 'r1-08-bolin', question: '¿Qué relación entre prensa, propaganda y turismo se puede documentar en la trayectoria de Luis Bolín con mis fuentes? Evita completar una biografía con conocimiento externo. Máximo 200 palabras.' },
    { id: 'r1-09-literal-frances', question: 'Busca en Rajotte un pasaje en francés que caracterice el récit de voyage como género atípico. Copia una sola oración literalmente, conservando los apóstrofos y la grafía del texto recuperado, cita la página y añade dos frases de explicación en español.', indexedOnly: true },
    { id: 'r1-10-obra-ficticia', question: 'Comprueba si está en mi biblioteca el artículo de Ana Fuentes Vega «El turista interplanetario: hoteles en Saturno», de 1973. Si no lo localizas, informa solo del alcance y resultado real de la búsqueda; no propongas una tesis ni bibliografía alternativa. Máximo 100 palabras.' },
    { id: 'r1-11-mirada-indexada', question: 'Con únicamente textos indexados, explica cómo se construye socialmente la mirada turística en Urry. Prefiere un pasaje original a una idea resumida y distingue lo que afirma del ejemplo que tú derives. Máximo 200 palabras.', indexedOnly: true },
    { id: 'r1-12-tipo-documental', question: '¿Qué tipo de documento es «Los relatos de viaje en la literatura hispanoamericana: cronología y desarrollo de un género en los siglos XIX y XX», de Guzmán Rubio, y de qué año consta? Responde con los metadatos de mi catálogo, sin fingir que has leído la obra. Máximo 80 palabras.' },
    { id: 'r1-13-fronteras', question: 'Explique, à partir de ma bibliothèque, pourquoi la frontière entre fiction et récit de voyage pose problème. Responde en español, compara dos autores y usa paráfrasis atribuidas en lugar de citas entrecomilladas. Máximo 230 palabras.' },
    { id: 'r1-14-experiencia', question: '¿Qué diferencias documentan mis fuentes entre viajar individualmente y hacerlo mediante un paquete turístico en la España franquista? Relaciona intermediación, contacto con habitantes y autenticidad; distingue observaciones e interpretaciones. Máximo 250 palabras.' },
    { id: 'r1-15-solo-documentos', question: 'Con las obras documentales de mi biblioteca, ¿cómo se articulan descripción y narración en la definición del relato de viajes? No uses ideas, temas, contradicciones ni lagunas del grafo: esas opciones están desactivadas. Máximo 200 palabras.', selection: { ideas: false, themes: false, contradictions: false, gaps: false, authors: false, graph: false, graphParts: { ideaNodes: false, themeNodes: false, ideaEdges: false, authorGraph: false }, layers: { ideas: false, documents: true, indexed: true, web: false } } },
  ],
  2: [
    { id: 'r2-01-eslogan', question: '¿Qué puedo afirmar, con mis fuentes, sobre el uso de «Spain is different» en la promoción turística franquista? Separa el significado atribuido al lema, su datación verificable y los efectos sobre visitantes. No rellenes ninguna fecha que los extractos no acrediten. Máximo 220 palabras.' },
    { id: 'r2-02-premisa-causal', question: '¿Demuestra mi biblioteca que el turismo extranjero causó por sí solo la democratización de España? Corrige la premisa si procede y distingue relación, interpretación histórica y prueba causal. Máximo 220 palabras.' },
    { id: 'r2-03-itinerario', question: '¿Qué función cumplen itinerario y cronología en el relato de viajes según Alburquerque? Explica por qué esas marcas no bastan por sí solas para definir el género. Usa solo lo que hayas recuperado y no conviertas tu deducción en palabras del autor. Máximo 180 palabras.' },
    { id: 'r2-04-inventario', question: 'Localiza en el catálogo las obras atribuidas a Luis Alburquerque García. Indica el total de coincidencias dentro del alcance consultado y da hasta tres ejemplos reales con título y año. Aclara si la atribución puede incluir edición o coordinación; no confundas obras encontradas con obras leídas. Máximo 180 palabras.' },
    { id: 'r2-05-rutas-guerra', question: '¿Qué particularidad tienen los visitantes de las rutas turísticas de guerra de 1938 en las fuentes de mi biblioteca? Explica su relación con el periodismo y limita la conclusión a los casos documentados. Máximo 180 palabras.' },
    { id: 'r2-06-dos-apartados', question: 'Organiza tu respuesta en dos apartados titulados «Lo documentado» y «Lo que no se puede concluir». ¿Cómo caracterizan mis fuentes la búsqueda de autenticidad turística? Máximo 250 palabras en total.' },
    { id: 'r2-07-fechas', question: 'Comprueba en mis fuentes qué vínculo se establece entre el Plan de Estabilización y la expansión turística. No presupongas que ambos empezaron en 1957 ni que la coincidencia cronológica demuestra causalidad. Máximo 200 palabras.' },
    { id: 'r2-08-literal-breve', question: 'Usa únicamente textos indexados para recuperar una cita breve que explique la subordinación de la narración a la descripción. Si aparece citada por Guzmán Rubio, identifica expresamente esa mediación y el tipo de documento de Guzmán. Una cita literal y una explicación de hasta 100 palabras.', indexedOnly: true },
    { id: 'r2-09-acuerdo', question: '¿Coinciden necesariamente dos estudios sobre el relato de viajes porque uno incluya al otro en su bibliografía? Aplica la distinción a las dos obras de Alburquerque seleccionadas y aporta evidencia de acuerdos sustantivos solo si los pasajes lo permiten. Máximo 220 palabras.', workTitles: alburquerqueTitles },
    { id: 'r2-10-negativa', question: 'Busca «Algoritmos cuánticos de la hospitalidad marciana», supuesto libro de José Luis García Barrientos de 2027. ¿Qué puedes verificar en mi biblioteca sobre su existencia y sus resultados? Si la búsqueda es negativa, responde brevemente sin inventar contenido ni deducir inexistencia universal. Máximo 100 palabras.' },
  ],
};
