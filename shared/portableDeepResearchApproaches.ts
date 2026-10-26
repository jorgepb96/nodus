import type {
  DeepResearchApproach,
} from '@shared/deepResearchApproaches';
import {
  normalizeDeepResearchApproach,
} from '@shared/deepResearchApproaches';
import type {
  ModelRef,
  PromptLanguage,
  WritingWorkshopIdeaCandidate,
  WritingWorkshopSnapshot,
} from '@shared/types';
import type {DeepResearchCompletionHost} from './portableDeepResearchAI';



export type DeepResearchApproachVariant = 'academic' | 'genealogy' | 'study' | 'unit' | 'client';

interface VariantRules {
  retrieval?: string[];
  planner?: string[];
  writer?: string[];
  finalizer?: string[];
}

export interface DeepResearchApproachProfile {
  id: DeepResearchApproach;
  retrievalRules: string[];
  plannerRules: string[];
  writerRules: string[];
  finalizerRules: string[];
  retrievalFacets: string[];
  variants?: Partial<Record<DeepResearchApproachVariant, VariantRules>>;
}

const GENERAL: DeepResearchApproachProfile = {
  id: 'general',
  retrievalRules: [],
  plannerRules: [],
  writerRules: [],
  finalizerRules: [],
  retrievalFacets: [],
};

const PROFILES: Record<DeepResearchApproach, DeepResearchApproachProfile> = {
  general: GENERAL,
  literature_review: {
    id: 'literature_review',
    retrievalRules: [
      'Amplía la recuperación hacia las principales interpretaciones, marcos, métodos, acuerdos y desacuerdos pertinentes al objetivo.',
      'Busca diversidad de obras y autores. No dejes que una sola obra domine cuando el corpus ofrece alternativas relevantes.',
      'Incluye cambios de interpretación entre publicaciones cuando las fechas disponibles permiten sostenerlos.',
    ],
    plannerRules: [
      'Organiza el informe por problemas, escuelas, enfoques, interpretaciones o temas. Nunca crees una sección por autor.',
      'El plan debe hacer visibles las grandes líneas interpretativas, la convergencia, el desacuerdo, las diferencias metodológicas, la evolución respaldada por fechas y las cuestiones no resueltas.',
    ],
    writerRules: [
      'Sintetiza las fuentes unas contra otras. Evita una sucesión del tipo «A dice, B dice, C dice».',
      'Distingue explícitamente los acuerdos amplios de las afirmaciones aisladas y explica cómo difieren las razones, métodos o énfasis de las fuentes.',
    ],
    finalizerRules: [
      'El resumen y la conclusión deben explicar la estructura de la literatura, sus líneas interpretativas, acuerdos, desacuerdos y preguntas no resueltas.',
      'Nunca presentes el corpus disponible en Nodus como si equivaliera a todo el campo académico.',
    ],
    retrievalFacets: ['principales enfoques', 'interpretaciones', 'diferencias metodológicas', 'acuerdos', 'desacuerdos'],
    variants: {
      genealogy: {
        retrieval: ['Da peso adicional a la bibliografía secundaria y a sus interpretaciones, manteniéndola claramente separada de la prueba archivística primaria.'],
        planner: ['Contrasta interpretaciones de la bibliografía secundaria sin convertirlas en hechos familiares probados.'],
      },
      study: {
        planner: ['Presenta como líneas interpretativas las perspectivas realmente representadas en los materiales de estudio.'],
        writer: [
          'Mantén claridad pedagógica al sintetizar perspectivas y métodos.',
          'Da por establecidos los conceptos ya explicados en previousSections. No vuelvas a definirlos ni reconstruyas su explicación; enlaza con una sola frase y dedica esta sección exclusivamente a su problema interpretativo nuevo.',
        ],
        finalizer: ['Resume únicamente perspectivas, acuerdos o desacuerdos representados en los materiales; si solo hay una perspectiva, dilo en vez de inventar un debate.'],
      },
      unit: {
        planner: ['La unidad debe enseñar las perspectivas y métodos representados en los materiales. La estructura fijada por el docente sigue teniendo prioridad absoluta.'],
      },
    },
  },
  state_of_art: {
    id: 'state_of_art',
    retrievalRules: [
      'Enriquece material sobre hallazgos establecidos, convergencia entre obras, controversias, huecos, limitaciones y métodos.',
      'Usa las fechas como contexto de desarrollo, nunca como una puntuación automática de calidad.',
      'Da peso a las ideas con respaldo en varias obras y conserva material débil o contradictorio para poder calificarlo con honestidad.',
    ],
    plannerRules: [
      'Organiza el informe en conocimiento establecido, convergencia, cuestiones discutidas, limitaciones metodológicas o probatorias y problemas abiertos.',
    ],
    writerRules: [
      'Diferencia con claridad entre lo sólidamente apoyado en el corpus, lo apoyado de forma limitada, lo discutido, lo no resuelto y lo ausente o infrarrepresentado.',
      'Nunca conviertas «Nodus no recuperó evidencia» en «el campo nunca lo ha estudiado». Usa «en el corpus disponible» cuando corresponda.',
    ],
    finalizerRules: [
      'Explicita qué puede concluirse actualmente a partir del corpus y qué no puede concluirse.',
    ],
    retrievalFacets: ['hallazgos establecidos', 'preguntas sin resolver', 'controversias actuales', 'limitaciones metodológicas', 'evidencia débil o fragmentaria'],
    variants: {
      genealogy: {
        planner: ['Distingue hechos familiares establecidos, hechos inciertos, registros conflictivos, pruebas ausentes y relaciones no resueltas.'],
        writer: ['Nunca eleves una identidad o parentesco no probado a hecho establecido.'],
      },
      study: { writer: ['Explica al estudiante el grado de respaldo de cada idea y por qué algunas respuestas siguen abiertas.'] },
      unit: { planner: ['Convierte los distintos grados de certeza en objetivos y actividades de evaluación, sin alterar la estructura fijada por el docente.'] },
    },
  },
  scholarly_debate: {
    id: 'scholarly_debate',
    retrievalRules: [
      'Trata las contradicciones como material de primera clase. Recupera evidencia de cada posición, posturas intermedias y diferencias metodológicas que expliquen el desacuerdo.',
      'No fabriques oposición. Si el corpus solo respalda un lado, registra la asimetría en lugar de equilibrarla artificialmente.',
    ],
    plannerRules: [
      'Estructura el informe alrededor de desacuerdos reales. Para cada uno identifica posiciones, alternativas intermedias, evidencia, supuestos y métodos.',
      'Distingue el desacuerdo genuino de diferencias aparentes y no fuerces todos los problemas a una oposición binaria.',
    ],
    writerRules: [
      'Atribuye cada posición de forma explícita y explica por qué discrepan las fuentes, no solo que discrepan.',
      'Un desacuerdo entre autores no es una contradicción interna del informe.',
    ],
    finalizerRules: [
      'Explica qué desacuerdos siguen abiertos, cuáles podrían reconciliarse y qué evidencia permitiría hacer avanzar el debate.',
    ],
    retrievalFacets: ['argumentos a favor', 'argumentos en contra', 'posiciones intermedias', 'supuestos en disputa', 'métodos que explican el desacuerdo'],
    variants: {
      genealogy: {
        retrieval: ['Busca registros conflictivos o interpretaciones documentadas. No conviertas una laguna probatoria en debate.'],
        writer: ['Habla de conflicto solo cuando registros o interpretaciones reales sean incompatibles, y conserva el estándar de prueba genealógico.'],
      },
      study: { planner: ['Organiza una explicación pedagógica de las explicaciones competidoras y de la evidencia usada por cada una.'] },
      unit: { planner: ['Diseña una unidad que enseñe el debate mediante evidencia y comparación de argumentos. El esquema manual del docente manda.'] },
    },
  },
  comparative: {
    id: 'comparative',
    retrievalRules: [
      'Identifica primero los comparandos dados por el objetivo. No inventes otros si ya están especificados.',
      'Recupera material por comparando y por eje importante para evitar que el lado semánticamente más próximo a la consulta domine el corpus.',
      'Si el objetivo es amplio, deriva comparandos defendibles del corpus y conserva visible cualquier asimetría de fuentes.',
    ],
    plannerRules: [
      'Usa ejes de comparación estables. Prefiere secciones que comparen directamente los casos bajo el mismo criterio antes que describir todo A y después todo B.',
    ],
    writerRules: [
      'Toda comparación importante debe indicar comparandos, criterio, similitud, diferencia, significado y fuerza probatoria de cada lado.',
      'Nunca afirmes simetría cuando la base de fuentes es asimétrica.',
    ],
    finalizerRules: [
      'Sintetiza las similitudes, diferencias y consecuencias explicativas más importantes.',
    ],
    retrievalFacets: ['comparandos', 'cronología comparada', 'conceptos', 'metodología', 'explicación causal', 'evidencia', 'contexto', 'resultados'],
    variants: {
      genealogy: { planner: ['Compara personas, ramas, hogares, migraciones o generaciones exigidos por el objetivo y nunca presupongas parentescos no probados.'] },
      study: { writer: ['Haz que los criterios de comparación sean explícitos y reutilizables como estructura de aprendizaje.'] },
      unit: { planner: ['Organiza la enseñanza mediante ejes comparativos estables sin sustituir ni reordenar un esquema fijado por el docente.'] },
    },
  },
  chronological: {
    id: 'chronological',
    retrievalRules: [
      'Prioriza obras, ideas, eventos y pasajes con información temporal explícita, además de antecedentes, transiciones, continuidades, rupturas y consecuencias.',
      'Usa únicamente fechas presentes en metadatos o contenido. Nunca inventes fechas para limpiar la periodización.',
    ],
    plannerRules: [
      'Deriva una periodización defendible de la evidencia e incluye antecedentes, emergencia, fases, puntos de inflexión, continuidades, rupturas y consecuencias.',
      'No reduzcas el informe a una cronología ni presentes resultados posteriores como inevitables.',
    ],
    writerRules: [
      'Explica por qué cambia lo que cambia y qué permanece estable. Conecta secuencia con causas, actores, estructuras e interpretaciones.',
    ],
    finalizerRules: [
      'Explicita las principales continuidades, rupturas y puntos de inflexión respaldados por el corpus.',
    ],
    retrievalFacets: ['antecedentes', 'emergencia', 'fases históricas', 'transiciones', 'puntos de inflexión', 'continuidades', 'rupturas', 'consecuencias'],
    variants: {
      genealogy: {
        retrieval: ['Prioriza eventos fechados, etapas vitales, desplazamientos y cronología documental.'],
        writer: ['Distingue la fecha del documento, la fecha del acontecimiento y cualquier fecha inferida. No inventes ninguna.'],
      },
      study: {
        planner: [
          'Convierte el desarrollo temporal en una progresión didáctica que explique causas y persistencias.',
          'Incluye únicamente materiales que formen parte de una misma secuencia temporal defendible. No unas escalas o procesos ajenos solo para usar todo el pool. Si no hay fechas, declara que se explica una secuencia de proceso —prerrequisitos, transición y consecuencias— y no una cronología histórica.',
        ],
        writer: ['Da por explicados los procesos de previousSections. No repitas sus definiciones; empieza desde el cambio o transición que corresponde a esta sección y explica qué la causa.'],
        finalizer: ['No presentes como evolución histórica una secuencia de procesos sin fechas. Nombra con precisión cuál de las dos permite sostener el material.'],
      },
      unit: { planner: ['Organiza el aprendizaje en torno al desarrollo histórico sin alterar la secuencia manual del docente.'] },
    },
  },
  conceptual: {
    id: 'conceptual',
    retrievalRules: [
      'Prioriza marcos, constructos, definiciones, afirmaciones conceptuales, conceptos metodológicos, relaciones, refinamientos, extensiones y conceptualizaciones incompatibles.',
      'Usa activamente las relaciones del grafo cuando estén disponibles para recuperar conceptos vecinos, límites y dependencias.',
    ],
    plannerRules: [
      'Organiza por problemas conceptuales y relaciones teóricas. No organices principalmente por autor o cronología salvo que sea necesario para explicar desarrollo conceptual.',
    ],
    writerRules: [
      'Para cada concepto importante explica definición, usos entre fuentes, acuerdos y diferencias, relaciones con conceptos adyacentes y consecuencias teóricas y metodológicas.',
      'No colapses conceptos parecidos pero distintos.',
    ],
    finalizerRules: [
      'Construye en prosa un mapa conceptual coherente e identifica tensiones teóricas no resueltas.',
    ],
    retrievalFacets: ['definiciones', 'orígenes teóricos', 'conceptualizaciones rivales', 'conceptos relacionados', 'límites conceptuales', 'implicaciones metodológicas'],
    variants: {
      genealogy: { planner: ['Sintetiza únicamente conceptos sociales, de parentesco, ocupación o migración respaldados por el archivo y la bibliografía. No los uses para probar vínculos familiares.'] },
      study: {
        planner: [
          'Ordena definiciones, prerrequisitos, marcos y dependencias conceptuales para facilitar su aprendizaje.',
          'No incorpores un material conceptualmente ajeno solo para aumentar el número de fuentes. Si el objetivo pertinente descansa en un solo material, acota el plan a lo que ese material permite sostener.',
        ],
        writer: ['Da por establecidas las definiciones de previousSections y haz avanzar una relación conceptual distinta en cada sección. No añadas reglas, porcentajes ni marcos que no aparezcan en allowedSources.'],
        finalizer: ['Si el objetivo se sostiene con un solo material, decláralo expresamente como limitación. Los próximos pasos no pueden introducir reglas, cifras o teorías ausentes de la evidencia recibida.'],
      },
      unit: { planner: ['Organiza la enseñanza alrededor de conceptos y relaciones, siempre dentro del esquema que haya fijado el docente.'] },
    },
  },
};

type LocalizedApproachSeed = { focus: string; facets: string[] };
type LocalizedApproachContent = Omit<DeepResearchApproachProfile, 'id' | 'variants'> & {
  variants?: Partial<Record<DeepResearchApproachVariant, VariantRules>>;
};

/* The Spanish profile above is the persisted/canonical copy.  These seeds keep
 * every approach-specific instruction in the requested language; the builder
 * below expands them into the four rule families and preserves the exact
 * variant shape of the canonical profile.  Stable approach ids and all
 * machine-readable values deliberately remain untouched. */
const NATIVE_SEEDS: Record<Exclude<PromptLanguage, 'es'>, Record<DeepResearchApproach, LocalizedApproachSeed>> = {
  en: {
    general: { focus: 'general research without a specialized lens', facets: [] },
    literature_review: { focus: 'major interpretations, frameworks, methods, agreements and disagreements across works', facets: ['major approaches', 'interpretations', 'methodological differences', 'agreements', 'disagreements'] },
    state_of_art: { focus: 'established findings, convergences, controversies, gaps, limitations and open questions', facets: ['established findings', 'unresolved questions', 'current controversies', 'methodological limitations', 'weak or fragmentary evidence'] },
    scholarly_debate: { focus: 'real scholarly disagreements, intermediate positions, evidence, assumptions and methods', facets: ['arguments for', 'arguments against', 'intermediate positions', 'contested assumptions', 'methods explaining disagreement'] },
    comparative: { focus: 'the specified comparands and stable criteria for similarity, difference, significance and evidentiary strength', facets: ['comparands', 'comparative chronology', 'concepts', 'methodology', 'causal explanation', 'evidence', 'context', 'outcomes'] },
    chronological: { focus: 'dated antecedents, emergence, phases, transitions, turning points, continuities, breaks and consequences', facets: ['antecedents', 'emergence', 'historical phases', 'transitions', 'turning points', 'continuities', 'breaks', 'consequences'] },
    conceptual: { focus: 'definitions, theoretical frameworks, constructs, neighboring concepts, relations, refinements and competing conceptualizations', facets: ['definitions', 'theoretical origins', 'rival conceptualizations', 'related concepts', 'conceptual limits', 'methodological implications'] },
  },
  fr: {
    general: { focus: 'une recherche générale sans angle spécialisé', facets: [] },
    literature_review: { focus: 'les interprétations, cadres, méthodes, accords et désaccords majeurs entre les ouvrages', facets: ['approches majeures', 'interprétations', 'différences méthodologiques', 'accords', 'désaccords'] },
    state_of_art: { focus: 'les résultats établis, convergences, controverses, lacunes, limites et questions ouvertes', facets: ['résultats établis', 'questions non résolues', 'controverses actuelles', 'limites méthodologiques', 'preuves faibles ou fragmentaires'] },
    scholarly_debate: { focus: 'les désaccords savants réels, positions intermédiaires, preuves, présupposés et méthodes', facets: ['arguments favorables', 'arguments défavorables', 'positions intermédiaires', 'présupposés contestés', 'méthodes expliquant le désaccord'] },
    comparative: { focus: 'les comparands indiqués et des critères stables de similitude, différence, signification et force probante', facets: ['comparands', 'chronologie comparée', 'concepts', 'méthodologie', 'explication causale', 'preuves', 'contexte', 'résultats'] },
    chronological: { focus: 'les antécédents, émergence, phases, transitions, tournants, continuités, ruptures et conséquences datés', facets: ['antécédents', 'émergence', 'phases historiques', 'transitions', 'tournants', 'continuités', 'ruptures', 'conséquences'] },
    conceptual: { focus: 'les définitions, cadres théoriques, construits, concepts voisins, relations, raffinements et conceptualisations rivales', facets: ['définitions', 'origines théoriques', 'conceptualisations rivales', 'concepts liés', 'limites conceptuelles', 'implications méthodologiques'] },
  },
  de: {
    general: { focus: 'allgemeine Forschung ohne spezialisierten Blickwinkel', facets: [] },
    literature_review: { focus: 'zentrale Interpretationen, Rahmen, Methoden, Übereinstimmungen und Unterschiede zwischen Werken', facets: ['zentrale Ansätze', 'Interpretationen', 'methodische Unterschiede', 'Übereinstimmungen', 'Unterschiede'] },
    state_of_art: { focus: 'gesicherte Befunde, Konvergenzen, Kontroversen, Lücken, Grenzen und offene Fragen', facets: ['gesicherte Befunde', 'offene Fragen', 'aktuelle Kontroversen', 'methodische Grenzen', 'schwache oder fragmentarische Evidenz'] },
    scholarly_debate: { focus: 'reale wissenschaftliche Meinungsverschiedenheiten, Zwischenpositionen, Belege, Annahmen und Methoden', facets: ['Argumente dafür', 'Argumente dagegen', 'Zwischenpositionen', 'umstrittene Annahmen', 'Methoden zur Erklärung der Differenz'] },
    comparative: { focus: 'die vorgegebenen Vergleichsfälle und stabile Kriterien für Ähnlichkeit, Unterschied, Bedeutung und Belegstärke', facets: ['Vergleichsfälle', 'vergleichende Chronologie', 'Begriffe', 'Methodik', 'kausale Erklärung', 'Evidenz', 'Kontext', 'Ergebnisse'] },
    chronological: { focus: 'datierte Vorgeschichte, Entstehung, Phasen, Übergänge, Wendepunkte, Kontinuitäten, Brüche und Folgen', facets: ['Vorgeschichte', 'Entstehung', 'historische Phasen', 'Übergänge', 'Wendepunkte', 'Kontinuitäten', 'Brüche', 'Folgen'] },
    conceptual: { focus: 'Definitionen, theoretische Rahmen, Konstrukte, Nachbarkonzepte, Beziehungen, Verfeinerungen und konkurrierende Konzeptualisierungen', facets: ['Definitionen', 'theoretische Ursprünge', 'konkurrierende Konzeptualisierungen', 'verwandte Begriffe', 'Begriffsgrenzen', 'methodische Folgen'] },
  },
  pt: {
    general: { focus: 'investigação geral sem um enfoque especializado', facets: [] },
    literature_review: { focus: 'as principais interpretações, quadros, métodos, acordos e desacordos entre obras', facets: ['abordagens principais', 'interpretações', 'diferenças metodológicas', 'acordos', 'desacordos'] },
    state_of_art: { focus: 'resultados estabelecidos, convergências, controvérsias, lacunas, limitações e questões abertas', facets: ['resultados estabelecidos', 'questões por resolver', 'controvérsias atuais', 'limitações metodológicas', 'evidência fraca ou fragmentária'] },
    scholarly_debate: { focus: 'desacordos académicos reais, posições intermédias, evidência, pressupostos e métodos', facets: ['argumentos a favor', 'argumentos contra', 'posições intermédias', 'pressupostos em disputa', 'métodos que explicam o desacordo'] },
    comparative: { focus: 'os comparandos indicados e critérios estáveis de semelhança, diferença, significado e força probatória', facets: ['comparandos', 'cronologia comparada', 'conceitos', 'metodologia', 'explicação causal', 'evidência', 'contexto', 'resultados'] },
    chronological: { focus: 'antecedentes, emergência, fases, transições, pontos de viragem, continuidades, ruturas e consequências datados', facets: ['antecedentes', 'emergência', 'fases históricas', 'transições', 'pontos de viragem', 'continuidades', 'ruturas', 'consequências'] },
    conceptual: { focus: 'definições, quadros teóricos, constructos, conceitos vizinhos, relações, refinamentos e conceptualizações rivais', facets: ['definições', 'origens teóricas', 'conceptualizações rivais', 'conceitos relacionados', 'limites conceptuais', 'implicações metodológicas'] },
  },
  'pt-BR': {
    general: { focus: 'pesquisa geral sem um enfoque especializado', facets: [] },
    literature_review: { focus: 'as principais interpretações, estruturas, métodos, acordos e desacordos entre obras', facets: ['abordagens principais', 'interpretações', 'diferenças metodológicas', 'acordos', 'desacordos'] },
    state_of_art: { focus: 'resultados estabelecidos, convergências, controvérsias, lacunas, limitações e questões abertas', facets: ['resultados estabelecidos', 'questões não resolvidas', 'controvérsias atuais', 'limitações metodológicas', 'evidência fraca ou fragmentária'] },
    scholarly_debate: { focus: 'desacordos acadêmicos reais, posições intermediárias, evidências, pressupostos e métodos', facets: ['argumentos a favor', 'argumentos contra', 'posições intermediárias', 'pressupostos em disputa', 'métodos que explicam o desacordo'] },
    comparative: { focus: 'os comparandos indicados e critérios estáveis de semelhança, diferença, significado e força probatória', facets: ['comparandos', 'cronologia comparada', 'conceitos', 'metodologia', 'explicação causal', 'evidência', 'contexto', 'resultados'] },
    chronological: { focus: 'antecedentes, surgimento, fases, transições, pontos de virada, continuidades, rupturas e consequências datados', facets: ['antecedentes', 'surgimento', 'fases históricas', 'transições', 'pontos de virada', 'continuidades', 'rupturas', 'consequências'] },
    conceptual: { focus: 'definições, estruturas teóricas, construtos, conceitos vizinhos, relações, refinamentos e conceituações rivais', facets: ['definições', 'origens teóricas', 'conceituações rivais', 'conceitos relacionados', 'limites conceituais', 'implicações metodológicas'] },
  },
  it: {
    general: { focus: 'ricerca generale senza una prospettiva specializzata', facets: [] },
    literature_review: { focus: 'le principali interpretazioni, cornici, metodologie, convergenze e divergenze tra le opere', facets: ['approcci principali', 'interpretazioni', 'differenze metodologiche', 'convergenze', 'divergenze'] },
    state_of_art: { focus: 'risultati consolidati, convergenze, controversie, lacune, limiti e questioni aperte', facets: ['risultati consolidati', 'questioni irrisolte', 'controversie attuali', 'limiti metodologici', 'prove deboli o frammentarie'] },
    scholarly_debate: { focus: 'disaccordi accademici reali, posizioni intermedie, prove, presupposti e metodi', facets: ['argomenti a favore', 'argomenti contrari', 'posizioni intermedie', 'presupposti contestati', 'metodi che spiegano il disaccordo'] },
    comparative: { focus: 'i comparandi indicati e criteri stabili di somiglianza, differenza, significato e forza probatoria', facets: ['comparandi', 'cronologia comparata', 'concetti', 'metodologia', 'spiegazione causale', 'prove', 'contesto', 'risultati'] },
    chronological: { focus: 'antefatti, emergenza, fasi, transizioni, svolte, continuità, rotture e conseguenze datati', facets: ['antefatti', 'emergenza', 'fasi storiche', 'transizioni', 'svolte', 'continuità', 'rotture', 'conseguenze'] },
    conceptual: { focus: 'definizioni, quadri teorici, costrutti, concetti vicini, relazioni, precisazioni e concettualizzazioni rivali', facets: ['definizioni', 'origini teoriche', 'concettualizzazioni rivali', 'concetti collegati', 'limiti concettuali', 'implicazioni metodologiche'] },
  },
  tr: {
    general: { focus: 'uzmanlaşmış bir bakış açısı olmayan genel araştırma', facets: [] },
    literature_review: { focus: 'eserler arasındaki başlıca yorumlar, çerçeveler, yöntemler, uzlaşmalar ve anlaşmazlıklar', facets: ['başlıca yaklaşımlar', 'yorumlar', 'yöntemsel farklar', 'uzlaşmalar', 'anlaşmazlıklar'] },
    state_of_art: { focus: 'yerleşik bulgular, yakınsamalar, tartışmalar, boşluklar, sınırlılıklar ve açık sorular', facets: ['yerleşik bulgular', 'çözülmemiş sorular', 'güncel tartışmalar', 'yöntemsel sınırlılıklar', 'zayıf veya parçalı kanıt'] },
    scholarly_debate: { focus: 'gerçek akademik anlaşmazlıklar, ara konumlar, kanıtlar, varsayımlar ve yöntemler', facets: ['lehte argümanlar', 'aleyhte argümanlar', 'ara konumlar', 'tartışmalı varsayımlar', 'anlaşmazlığı açıklayan yöntemler'] },
    comparative: { focus: 'belirtilen karşılaştırma birimleri ve benzerlik, fark, anlam ve kanıt gücü için sabit ölçütler', facets: ['karşılaştırma birimleri', 'karşılaştırmalı kronoloji', 'kavramlar', 'yöntem', 'nedensel açıklama', 'kanıt', 'bağlam', 'sonuçlar'] },
    chronological: { focus: 'tarihli öncüller, ortaya çıkış, evreler, geçişler, dönüm noktaları, süreklilikler, kırılmalar ve sonuçlar', facets: ['öncüller', 'ortaya çıkış', 'tarihsel evreler', 'geçişler', 'dönüm noktaları', 'süreklilikler', 'kırılmalar', 'sonuçlar'] },
    conceptual: { focus: 'tanımlar, kuramsal çerçeveler, yapılar, komşu kavramlar, ilişkiler, geliştirmeler ve rakip kavramsallaştırmalar', facets: ['tanımlar', 'kuramsal kökenler', 'rakip kavramsallaştırmalar', 'ilişkili kavramlar', 'kavramsal sınırlar', 'yöntemsel çıkarımlar'] },
  },
  'zh-Hans': {
    general: { focus: '没有专门视角的一般性研究', facets: [] },
    literature_review: { focus: '各著作之间的主要解释、框架、方法、共识与分歧', facets: ['主要路径', '解释', '方法论差异', '共识', '分歧'] },
    state_of_art: { focus: '已确立的发现、趋同、争议、空白、局限与未决问题', facets: ['已确立的发现', '未解决的问题', '当前争议', '方法论局限', '薄弱或零散的证据'] },
    scholarly_debate: { focus: '真实的学术分歧、中间立场、证据、假设与方法', facets: ['支持论据', '反对论据', '中间立场', '有争议的假设', '解释分歧的方法'] },
    comparative: { focus: '给定的比较对象以及相似性、差异、意义与证据强度的稳定标准', facets: ['比较对象', '比较时间线', '概念', '方法论', '因果解释', '证据', '语境', '结果'] },
    chronological: { focus: '有年代可考的先行背景、兴起、阶段、过渡、转折点、延续、断裂与后果', facets: ['先行背景', '兴起', '历史阶段', '过渡', '转折点', '延续', '断裂', '后果'] },
    conceptual: { focus: '定义、理论框架、建构、相邻概念、关系、细化与相互竞争的概念化', facets: ['定义', '理论渊源', '竞争性概念化', '相关概念', '概念边界', '方法论意涵'] },
  },
  'zh-Hant': {
    general: { focus: '沒有專門視角的一般性研究', facets: [] },
    literature_review: { focus: '各著作之間的主要詮釋、框架、方法、共識與分歧', facets: ['主要取徑', '詮釋', '方法論差異', '共識', '分歧'] },
    state_of_art: { focus: '已確立的發現、趨同、爭議、缺口、限制與未決問題', facets: ['已確立的發現', '未解決的問題', '當前爭議', '方法論限制', '薄弱或零散的證據'] },
    scholarly_debate: { focus: '真實的學術分歧、中間立場、證據、預設與方法', facets: ['支持論據', '反對論據', '中間立場', '有爭議的預設', '解釋分歧的方法'] },
    comparative: { focus: '指定的比較對象以及相似性、差異、意義與證據力度的穩定判準', facets: ['比較對象', '比較年表', '概念', '方法論', '因果解釋', '證據', '脈絡', '結果'] },
    chronological: { focus: '有年代可考的先行背景、興起、階段、過渡、轉折點、延續、斷裂與後果', facets: ['先行背景', '興起', '歷史階段', '過渡', '轉折點', '延續', '斷裂', '後果'] },
    conceptual: { focus: '定義、理論框架、建構、相鄰概念、關係、精煉與相互競爭的概念化', facets: ['定義', '理論淵源', '競爭性概念化', '相關概念', '概念界線', '方法論意涵'] },
  },
  vi: {
    general: { focus: 'nghiên cứu tổng quát không theo một góc nhìn chuyên biệt', facets: [] },
    literature_review: { focus: 'các cách diễn giải, khung lý thuyết, phương pháp, điểm đồng thuận và bất đồng chính giữa các công trình', facets: ['cách tiếp cận chính', 'các cách diễn giải', 'khác biệt phương pháp luận', 'đồng thuận', 'bất đồng'] },
    state_of_art: { focus: 'các phát hiện đã được xác lập, sự hội tụ, tranh luận, khoảng trống, hạn chế và câu hỏi mở', facets: ['phát hiện đã xác lập', 'câu hỏi chưa giải quyết', 'tranh luận hiện thời', 'hạn chế phương pháp luận', 'bằng chứng yếu hoặc phân tán'] },
    scholarly_debate: { focus: 'các bất đồng học thuật thực sự, lập trường trung gian, bằng chứng, giả định và phương pháp', facets: ['luận cứ ủng hộ', 'luận cứ phản đối', 'lập trường trung gian', 'giả định gây tranh cãi', 'phương pháp lý giải bất đồng'] },
    comparative: { focus: 'các đối tượng so sánh đã chỉ định và tiêu chí ổn định về tương đồng, khác biệt, ý nghĩa và độ mạnh bằng chứng', facets: ['đối tượng so sánh', 'niên đại so sánh', 'khái niệm', 'phương pháp luận', 'lý giải nhân quả', 'bằng chứng', 'bối cảnh', 'kết quả'] },
    chronological: { focus: 'tiền đề có niên đại, sự xuất hiện, các giai đoạn, chuyển tiếp, bước ngoặt, sự liên tục, đứt gãy và hệ quả', facets: ['tiền đề', 'sự xuất hiện', 'các giai đoạn lịch sử', 'chuyển tiếp', 'bước ngoặt', 'sự liên tục', 'đứt gãy', 'hệ quả'] },
    conceptual: { focus: 'định nghĩa, khung lý thuyết, cấu trúc, khái niệm lân cận, quan hệ, tinh chỉnh và các quan niệm cạnh tranh', facets: ['định nghĩa', 'nguồn gốc lý thuyết', 'quan niệm cạnh tranh', 'khái niệm liên quan', 'giới hạn khái niệm', 'hàm ý phương pháp luận'] },
  },
  ja: {
    general: { focus: '専門的な観点を置かない一般的な調査', facets: [] },
    literature_review: { focus: '諸著作間の主要な解釈、枠組み、方法、一致点と相違点', facets: ['主要なアプローチ', '解釈', '方法論上の相違', '一致点', '相違点'] },
    state_of_art: { focus: '確立された知見、収束、論争、空白、限界、未解決の問い', facets: ['確立された知見', '未解決の問い', '現在の論争', '方法論上の限界', '弱い、または断片的なエビデンス'] },
    scholarly_debate: { focus: '実際の学術的論争、中間的立場、エビデンス、前提、方法', facets: ['賛成の論拠', '反対の論拠', '中間的立場', '争われている前提', '論争を説明する方法'] },
    comparative: { focus: '指定された比較対象と、類似性・相違・意義・証拠の強さに関する安定した基準', facets: ['比較対象', '比較年表', '概念', '方法論', '因果的説明', 'エビデンス', '文脈', '結果'] },
    chronological: { focus: '年代の特定できる先行事情、出現、段階、移行、転換点、連続、断絶、帰結', facets: ['先行事情', '出現', '歴史的段階', '移行', '転換点', '連続', '断絶', '帰結'] },
    conceptual: { focus: '定義、理論的枠組み、構成概念、隣接概念、関係、精緻化、競合する概念化', facets: ['定義', '理論的起源', '競合する概念化', '関連概念', '概念的限界', '方法論的含意'] },
  },
  ru: {
    general: { focus: 'общее исследование без специализированного ракурса', facets: [] },
    literature_review: { focus: 'основные интерпретации, рамки, методы, согласия и разногласия между работами', facets: ['основные подходы', 'интерпретации', 'методологические различия', 'согласия', 'разногласия'] },
    state_of_art: { focus: 'установленные результаты, конвергенции, спорные вопросы, пробелы, ограничения и открытые вопросы', facets: ['установленные результаты', 'нерешённые вопросы', 'текущие споры', 'методологические ограничения', 'слабые или фрагментарные доказательства'] },
    scholarly_debate: { focus: 'реальные научные разногласия, промежуточные позиции, доказательства, предпосылки и методы', facets: ['аргументы за', 'аргументы против', 'промежуточные позиции', 'спорные предпосылки', 'методы, объясняющие разногласие'] },
    comparative: { focus: 'заданные объекты сравнения и устойчивые критерии сходства, различия, значимости и доказательной силы', facets: ['объекты сравнения', 'сравнительная хронология', 'понятия', 'методология', 'причинное объяснение', 'доказательства', 'контекст', 'результаты'] },
    chronological: { focus: 'датированные предпосылки, возникновение, фазы, переходы, переломные моменты, преемственность, разрывы и последствия', facets: ['предпосылки', 'возникновение', 'исторические фазы', 'переходы', 'переломные моменты', 'преемственность', 'разрывы', 'последствия'] },
    conceptual: { focus: 'определения, теоретические рамки, конструкты, смежные понятия, отношения, уточнения и конкурирующие концептуализации', facets: ['определения', 'теоретические истоки', 'конкурирующие концептуализации', 'связанные понятия', 'концептуальные границы', 'методологические следствия'] },
  },
  uk: {
    general: { focus: 'загальне дослідження без спеціалізованого ракурсу', facets: [] },
    literature_review: { focus: 'основні інтерпретації, рамки, методи, згоди та розбіжності між працями', facets: ['основні підходи', 'інтерпретації', 'методологічні відмінності', 'згоди', 'розбіжності'] },
    state_of_art: { focus: 'усталені результати, конвергенції, суперечки, прогалини, обмеження та відкриті питання', facets: ['усталені результати', 'невирішені питання', 'поточні суперечки', 'методологічні обмеження', 'слабкі або фрагментарні докази'] },
    scholarly_debate: { focus: 'реальні наукові розбіжності, проміжні позиції, докази, припущення та методи', facets: ['аргументи за', 'аргументи проти', 'проміжні позиції', 'спірні припущення', 'методи, що пояснюють розбіжність'] },
    comparative: { focus: 'задані об’єкти порівняння та сталі критерії подібності, відмінності, значущості й доказової сили', facets: ['об’єкти порівняння', 'порівняльна хронологія', 'поняття', 'методологія', 'причинне пояснення', 'докази', 'контекст', 'результати'] },
    chronological: { focus: 'датовані передумови, виникнення, фази, переходи, переломні моменти, тяглість, розриви та наслідки', facets: ['передумови', 'виникнення', 'історичні фази', 'переходи', 'переломні моменти', 'тяглість', 'розриви', 'наслідки'] },
    conceptual: { focus: 'визначення, теоретичні рамки, конструкції, суміжні поняття, зв’язки, уточнення та конкуруючі концептуалізації', facets: ['визначення', 'теоретичні витоки', 'конкуруючі концептуалізації', 'пов’язані поняття', 'концептуальні межі', 'методологічні наслідки'] },
  },
  ko: {
    general: { focus: '전문적인 관점 없이 수행하는 일반 연구', facets: [] },
    literature_review: { focus: '저작들 사이의 주요 해석, 프레임워크, 방법, 합의와 불일치', facets: ['주요 접근법', '해석', '방법론적 차이', '합의', '불일치'] },
    state_of_art: { focus: '확립된 발견, 수렴, 논쟁, 공백, 한계와 미해결 질문', facets: ['확립된 발견', '미해결 질문', '현재의 논쟁', '방법론적 한계', '취약하거나 단편적인 증거'] },
    scholarly_debate: { focus: '실제 학술적 불일치, 중간 입장, 증거, 전제와 방법', facets: ['찬성 논거', '반대 논거', '중간 입장', '쟁점이 되는 전제', '불일치를 설명하는 방법'] },
    comparative: { focus: '지정된 비교 대상과 유사성, 차이, 의의, 증거력에 관한 안정된 기준', facets: ['비교 대상', '비교 연대기', '개념', '방법론', '인과 설명', '증거', '맥락', '결과'] },
    chronological: { focus: '연대가 확인되는 선행 배경, 출현, 단계, 전환, 전환점, 연속, 단절과 결과', facets: ['선행 배경', '출현', '역사적 단계', '전환', '전환점', '연속', '단절', '결과'] },
    conceptual: { focus: '정의, 이론적 프레임워크, 구성 개념, 인접 개념, 관계, 정교화와 경쟁하는 개념화', facets: ['정의', '이론적 기원', '경쟁하는 개념화', '관련 개념', '개념적 한계', '방법론적 함의'] },
  },
};

const NATIVE_STAGE_TEMPLATES: Record<Exclude<PromptLanguage, 'es'>, {
  retrieval: (focus: string) => string;
  planner: (focus: string) => string;
  writer: (focus: string) => string;
  finalizer: (focus: string) => string;
  variant: (variant: DeepResearchApproachVariant, focus: string) => string;
}> = {
  en: {
    retrieval: (f) => `Broaden retrieval toward ${f}. Seek diverse works and authors, include dated changes when supported, and preserve weak or conflicting material so its limits can be stated honestly.`,
    planner: (f) => `Organize around ${f}. Make evidence, convergence, disagreement, methodological differences, chronology where defensible, unresolved questions and source asymmetries visible; never invent a side or a section.`,
    writer: (f) => `Synthesize the corpus around ${f}. Attribute each position, distinguish documented evidence from inference, explain mechanisms and comparisons, and state when the available corpus is incomplete or asymmetric.`,
    finalizer: (f) => `Summarize what the available corpus can establish about ${f}, what remains disputed or unresolved, and what evidence would advance the analysis. Never treat the Nodus corpus as the whole field.`,
    variant: (v, f) => `For the ${v} variant, apply the ${f} lens to its audience and materials; preserve the variant's required structure, distinguish evidence from interpretation, and never invent a missing relationship.`,
  },
  fr: {
    retrieval: (f) => `Élargissez la recherche vers ${f}. Recherchez des ouvrages et auteurs divers, incluez les évolutions datées lorsqu’elles sont étayées et conservez les éléments faibles ou contradictoires afin d’en déclarer honnêtement les limites.`,
    planner: (f) => `Organisez le rapport autour de ${f}. Rendez visibles les preuves, convergences, désaccords, différences méthodologiques, chronologies défendables, questions ouvertes et asymétries des sources; n’inventez ni côté ni section.`,
    writer: (f) => `Synthétisez le corpus autour de ${f}. Attribuez chaque position, distinguez preuve documentée et inférence, expliquez mécanismes et comparaisons et signalez les lacunes ou asymétries du corpus disponible.`,
    finalizer: (f) => `Résumez ce que le corpus disponible permet d’établir sur ${f}, ce qui reste discuté ou irrésolu et quelles preuves feraient progresser l’analyse. Le corpus de Nodus n’est jamais tout le champ.`,
    variant: (v, f) => `Pour la variante ${v}, appliquez l’angle ${f} à son public et à ses matériaux; respectez la structure requise, distinguez preuve et interprétation et n’inventez aucune relation absente.`,
  },
  de: {
    retrieval: (f) => `Erweitern Sie die Recherche auf ${f}. Suchen Sie vielfältige Werke und Autoren, beziehen Sie belegte datierte Veränderungen ein und bewahren Sie schwaches oder widersprüchliches Material, damit seine Grenzen ehrlich benannt werden können.`,
    planner: (f) => `Ordnen Sie den Bericht um ${f}. Machen Sie Belege, Konvergenzen, Differenzen, methodische Unterschiede, vertretbare Chronologie, offene Fragen und Quellenasymmetrien sichtbar; erfinden Sie weder Seite noch Abschnitt.`,
    writer: (f) => `Synthetisieren Sie das Korpus um ${f}. Schreiben Sie jede Position zu, trennen Sie dokumentierte Evidenz von Schlussfolgerung, erklären Sie Mechanismen und Vergleiche und benennen Sie Lücken oder Asymmetrien des Korpus.`,
    finalizer: (f) => `Fassen Sie zusammen, was das verfügbare Korpus zu ${f} belegen kann, was umstritten oder offen bleibt und welche Evidenz die Analyse voranbringen würde. Das Nodus-Korpus ist niemals das gesamte Fach.`,
    variant: (v, f) => `Wenden Sie für die Variante ${v} den Blickwinkel ${f} auf Zielgruppe und Materialien an; bewahren Sie die geforderte Struktur, trennen Sie Beleg und Interpretation und erfinden Sie keine fehlende Beziehung.`,
  },
  pt: {
    retrieval: (f) => `Alarga a recuperação para ${f}. Procura obras e autores diversos, inclui mudanças datadas quando sustentadas e conserva material fraco ou contraditório para declarar honestamente os seus limites.`,
    planner: (f) => `Organiza o relatório em torno de ${f}. Torna visíveis evidência, convergência, desacordo, diferenças metodológicas, cronologia defensável, questões abertas e assimetrias das fontes; não inventes lados nem secções.`,
    writer: (f) => `Sintetiza o corpus em torno de ${f}. Atribui cada posição, distingue evidência documentada de inferência, explica mecanismos e comparações e assinala lacunas ou assimetrias do corpus disponível.`,
    finalizer: (f) => `Resume o que o corpus disponível permite estabelecer sobre ${f}, o que permanece discutido ou por resolver e que evidência faria avançar a análise. O corpus do Nodus nunca equivale a todo o campo.`,
    variant: (v, f) => `Na variante ${v}, aplica o enfoque ${f} ao público e aos materiais; conserva a estrutura exigida, distingue evidência de interpretação e não inventes relações ausentes.`,
  },
  'pt-BR': {
    retrieval: (f) => `Amplie a recuperação para ${f}. Busque obras e autores diversos, inclua mudanças datadas quando sustentadas e preserve material fraco ou contraditório para declarar seus limites com honestidade.`,
    planner: (f) => `Organize o relatório em torno de ${f}. Torne visíveis evidência, convergência, desacordo, diferenças metodológicas, cronologia defensável, questões abertas e assimetrias das fontes; não invente lados nem seções.`,
    writer: (f) => `Sintetize o corpus em torno de ${f}. Atribua cada posição, diferencie evidência documentada de inferência, explique mecanismos e comparações e assinale lacunas ou assimetrias do corpus disponível.`,
    finalizer: (f) => `Resuma o que o corpus disponível permite estabelecer sobre ${f}, o que permanece discutido ou não resolvido e que evidência faria a análise avançar. O corpus do Nodus nunca equivale a todo o campo.`,
    variant: (v, f) => `Na variante ${v}, aplique o enfoque ${f} ao público e aos materiais; preserve a estrutura exigida, diferencie evidência de interpretação e não invente relações ausentes.`,
  },
  it: {
    retrieval: (f) => `Amplia il recupero verso ${f}. Cerca opere e autori diversi, includi cambiamenti datati quando comprovati e conserva il materiale debole o contraddittorio per dichiararne onestamente i limiti.`,
    planner: (f) => `Organizza il rapporto attorno a ${f}. Rendi visibili prove, convergenze, divergenze, differenze metodologiche, cronologia difendibile, questioni aperte e asimmetrie delle fonti; non inventare lati o sezioni.`,
    writer: (f) => `Sintetizza il corpus attorno a ${f}. Attribuisci ogni posizione, distingui prova documentata e inferenza, spiega meccanismi e confronti e segnala lacune o asimmetrie del corpus disponibile.`,
    finalizer: (f) => `Riassumi ciò che il corpus disponibile può stabilire su ${f}, ciò che resta discusso o irrisolto e quali prove farebbero avanzare l’analisi. Il corpus Nodus non è mai l’intero campo.`,
    variant: (v, f) => `Per la variante ${v}, applica la prospettiva ${f} al pubblico e ai materiali; conserva la struttura richiesta, distingui prova e interpretazione e non inventare relazioni assenti.`,
  },
  tr: {
    retrieval: (f) => `${f} yönünde erişimi genişletin. Çeşitli eser ve yazarları arayın, desteklenen tarihli değişimleri ekleyin ve sınırlarını dürüstçe belirtebilmek için zayıf ya da çelişkili malzemeyi koruyun.`,
    planner: (f) => `Raporu ${f} çevresinde düzenleyin. Kanıtı, yakınsamayı, anlaşmazlığı, yöntem farklarını, savunulabilir kronolojiyi, açık soruları ve kaynak asimetrilerini görünür kılın; taraf veya bölüm uydurmayın.`,
    writer: (f) => `Korpusu ${f} çevresinde sentezleyin. Her konumu atfedin, belgelenmiş kanıtı çıkarımdan ayırın, mekanizmaları ve karşılaştırmaları açıklayın, mevcut korpusun boşluklarını veya asimetrilerini belirtin.`,
    finalizer: (f) => `Mevcut korpusun ${f} hakkında neyi kanıtlayabildiğini, neyin tartışmalı ya da açık kaldığını ve hangi kanıtın analizi ilerleteceğini özetleyin. Nodus korpusu hiçbir zaman alanın tamamı değildir.`,
    variant: (v, f) => `${v} varyantında ${f} bakışını hedef kitleye ve malzemeye uygulayın; gerekli yapıyı koruyun, kanıtı yorumdan ayırın ve eksik bir ilişki uydurmayın.`,
  },
  'zh-Hans': {
    retrieval: (f) => `将检索扩展到${f}。寻找多样的著作与作者，在证据支持时纳入有年代的变化，并保留薄弱或相互矛盾的材料，以便如实说明其局限。`,
    planner: (f) => `围绕${f}组织报告。让证据、趋同、分歧、方法论差异、可辩护的年代脉络、未决问题与来源不对称清晰可见；绝不虚构某一方或某一节。`,
    writer: (f) => `围绕${f}综合语料。归属每一立场，区分有文献记录的证据与推断，解释机制与比较，并说明现有语料何时不完整或不对称。`,
    finalizer: (f) => `总结现有语料就${f}能够确立什么、哪些仍有争议或未解决，以及何种证据能推进分析。绝不可将 Nodus 语料等同于整个研究领域。`,
    variant: (v, f) => `对于 ${v} 变体，将${f}视角应用于其受众与材料；保持该变体要求的结构，区分证据与解释，绝不虚构缺失的关系。`,
  },
  'zh-Hant': {
    retrieval: (f) => `將檢索擴展至${f}。尋找多樣的著作與作者，在證據支持時納入有年代的變化，並保留薄弱或相互矛盾的材料，以便如實說明其限制。`,
    planner: (f) => `圍繞${f}組織報告。讓證據、趨同、分歧、方法論差異、可辯護的年代脈絡、未決問題與來源不對稱清晰可見；絕不虛構某一方或某一節。`,
    writer: (f) => `圍繞${f}綜合語料。歸屬每一立場，區分有文獻記錄的證據與推論，解釋機制與比較，並說明現有語料何時不完整或不對稱。`,
    finalizer: (f) => `總結現有語料就${f}能夠確立什麼、哪些仍有爭議或未解決，以及何種證據能推進分析。絕不可將 Nodus 語料等同於整個研究領域。`,
    variant: (v, f) => `對於 ${v} 變體，將${f}視角應用於其受眾與材料；保持該變體要求的結構，區分證據與詮釋，絕不虛構缺失的關係。`,
  },
  vi: {
    retrieval: (f) => `Mở rộng truy hồi theo hướng ${f}. Tìm kiếm các công trình và tác giả đa dạng, đưa vào những thay đổi có niên đại khi được chứng minh, và giữ lại tài liệu yếu hoặc mâu thuẫn để có thể nêu rõ giới hạn của nó một cách trung thực.`,
    planner: (f) => `Tổ chức báo cáo xoay quanh ${f}. Làm nổi rõ bằng chứng, sự hội tụ, bất đồng, khác biệt phương pháp luận, niên đại có thể biện luận, câu hỏi chưa giải quyết và sự bất cân xứng của nguồn; tuyệt đối không bịa ra một phe hay một mục.`,
    writer: (f) => `Tổng hợp ngữ liệu xoay quanh ${f}. Quy gán từng lập trường, phân biệt bằng chứng được ghi chép với suy luận, giải thích cơ chế và so sánh, đồng thời nêu rõ khi ngữ liệu hiện có chưa đầy đủ hoặc bất cân xứng.`,
    finalizer: (f) => `Tóm tắt những gì ngữ liệu hiện có thể xác lập về ${f}, những gì còn tranh cãi hoặc chưa giải quyết, và bằng chứng nào sẽ giúp phân tích tiến xa hơn. Không bao giờ coi ngữ liệu Nodus là toàn bộ lĩnh vực.`,
    variant: (v, f) => `Đối với biến thể ${v}, áp dụng góc nhìn ${f} cho đối tượng độc giả và tài liệu của biến thể; giữ nguyên cấu trúc bắt buộc, phân biệt bằng chứng với diễn giải và không bao giờ bịa ra một quan hệ còn thiếu.`,
  },
  ja: {
    retrieval: (f) => `${f}へと検索を広げます。多様な著作と著者を探し、裏づけのある年代変化を含め、弱い、または矛盾する資料もその限界を正直に述べられるよう保持します。`,
    planner: (f) => `${f}を中心に報告を構成します。エビデンス、収束、不一致、方法論上の相違、根拠づけられる年代、未解決の問い、資料の非対称性を可視化し、側や節を決して捏造しません。`,
    writer: (f) => `${f}を中心にコーパスを統合します。各立場を帰属させ、記録されたエビデンスと推論を区別し、機構と比較を説明し、利用可能なコーパスが不完全または非対称である場合はその旨を述べます。`,
    finalizer: (f) => `利用可能なコーパスが${f}について何を確立できるか、何がなお争われ未解決か、どのようなエビデンスが分析を前進させるかを要約します。Nodus のコーパスを研究領域全体と決して同一視しないでください。`,
    variant: (v, f) => `${v} 変種では、${f}の観点をその読者と資料に適用します。変種に求められる構造を保ち、エビデンスと解釈を区別し、欠けている関係を決して捏造しないでください。`,
  },
  ru: {
    retrieval: (f) => `Расширьте поиск в направлении: ${f}. Ищите разнообразные работы и авторов, включайте датированные изменения при наличии обоснования и сохраняйте слабый или противоречивый материал, чтобы честно обозначить его границы.`,
    planner: (f) => `Организуйте отчёт вокруг: ${f}. Сделайте видимыми доказательства, конвергенцию, разногласия, методологические различия, обоснованную хронологию, нерешённые вопросы и асимметрию источников; никогда не выдумывайте сторону или раздел.`,
    writer: (f) => `Синтезируйте корпус вокруг: ${f}. Приписывайте каждую позицию, отличайте документированные доказательства от вывода, объясняйте механизмы и сравнения и указывайте, когда доступный корпус неполон или асимметричен.`,
    finalizer: (f) => `Обобщите, что доступный корпус позволяет установить относительно: ${f}, что остаётся спорным или нерешённым и какие доказательства продвинули бы анализ. Никогда не отождествляйте корпус Nodus со всей областью.`,
    variant: (v, f) => `Для варианта ${v} примените оптику «${f}» к его аудитории и материалам; сохраняйте требуемую структуру, отличайте доказательство от интерпретации и никогда не выдумывайте отсутствующую связь.`,
  },
  uk: {
    retrieval: (f) => `Розширте пошук у напрямі: ${f}. Шукайте різноманітні праці та авторів, долучайте датовані зміни за наявності обґрунтування та зберігайте слабкий або суперечливий матеріал, щоб чесно окреслити його межі.`,
    planner: (f) => `Організуйте звіт навколо: ${f}. Зробіть видимими докази, конвергенцію, розбіжності, методологічні відмінності, обґрунтовану хронологію, невирішені питання та асиметрію джерел; ніколи не вигадуйте сторону чи розділ.`,
    writer: (f) => `Синтезуйте корпус навколо: ${f}. Приписуйте кожну позицію, відрізняйте задокументовані докази від висновку, пояснюйте механізми та порівняння й зазначайте, коли доступний корпус неповний або асиметричний.`,
    finalizer: (f) => `Підсумуйте, що доступний корпус дає змогу встановити щодо: ${f}, що залишається спірним або невирішеним і які докази просунули б аналіз. Ніколи не ототожнюйте корпус Nodus з усією галуззю.`,
    variant: (v, f) => `Для варіанта ${v} застосуйте оптику «${f}» до його аудиторії та матеріалів; зберігайте потрібну структуру, відрізняйте доказ від інтерпретації й ніколи не вигадуйте відсутній зв’язок.`,
  },
  ko: {
    retrieval: (f) => `${f} 방향으로 검색을 확장합니다. 다양한 저작과 저자를 찾고, 근거가 있을 때 연대가 확인되는 변화를 포함하며, 약하거나 상충하는 자료도 그 한계를 정직하게 밝힐 수 있도록 보존합니다.`,
    planner: (f) => `${f}을(를) 중심으로 보고서를 구성합니다. 증거, 수렴, 불일치, 방법론적 차이, 방어 가능한 연대기, 미해결 질문과 출처의 비대칭성을 드러내고, 어느 편이나 절도 결코 지어내지 마십시오.`,
    writer: (f) => `${f}을(를) 중심으로 코퍼스를 종합합니다. 각 입장을 귀속시키고, 문서화된 증거와 추론을 구분하며, 메커니즘과 비교를 설명하고, 이용 가능한 코퍼스가 불완전하거나 비대칭일 때 이를 밝힙니다.`,
    finalizer: (f) => `이용 가능한 코퍼스가 ${f}에 관해 무엇을 확립할 수 있는지, 무엇이 여전히 논쟁 중이거나 미해결인지, 어떤 증거가 분석을 진전시킬지 요약합니다. Nodus 코퍼스를 해당 분야 전체와 결코 동일시하지 마십시오.`,
    variant: (v, f) => `${v} 변형에서는 ${f} 관점을 해당 독자와 자료에 적용합니다. 변형에 요구되는 구조를 유지하고, 증거와 해석을 구분하며, 빠진 관계를 결코 지어내지 마십시오.`,
  },
};

function localizedApproachContent(language: Exclude<PromptLanguage, 'es'>, approach: DeepResearchApproach): LocalizedApproachContent {
  const seed = NATIVE_SEEDS[language][approach];
  if (approach === 'general') return { retrievalRules: [], plannerRules: [], writerRules: [], finalizerRules: [], retrievalFacets: [] };
  const template = NATIVE_STAGE_TEMPLATES[language];
  const sourceProfile = PROFILES[approach];
  const preserveClauseCount = (source: string[] | undefined, translated: string): string[] | undefined => (
    source ? source.map(() => translated) : undefined
  );
  const sourceVariants = sourceProfile.variants ?? {};
  const variants = Object.fromEntries(Object.keys(sourceVariants).map((variant) => {
    const source = sourceVariants[variant as DeepResearchApproachVariant] ?? {};
    const sentence = template.variant(variant as DeepResearchApproachVariant, seed.focus);
    return [variant, {
      ...(source.retrieval ? { retrieval: preserveClauseCount(source.retrieval, sentence) } : {}),
      ...(source.planner ? { planner: preserveClauseCount(source.planner, sentence) } : {}),
      ...(source.writer ? { writer: preserveClauseCount(source.writer, sentence) } : {}),
      ...(source.finalizer ? { finalizer: preserveClauseCount(source.finalizer, sentence) } : {}),
    }];
  })) as Partial<Record<DeepResearchApproachVariant, VariantRules>>;
  return {
    retrievalRules: preserveClauseCount(sourceProfile.retrievalRules, template.retrieval(seed.focus)) ?? [],
    plannerRules: preserveClauseCount(sourceProfile.plannerRules, template.planner(seed.focus)) ?? [],
    writerRules: preserveClauseCount(sourceProfile.writerRules, template.writer(seed.focus)) ?? [],
    finalizerRules: preserveClauseCount(sourceProfile.finalizerRules, template.finalizer(seed.focus)) ?? [],
    retrievalFacets: seed.facets,
    variants,
  };
}

const RETRIEVAL_PROMPT_BASE: Record<PromptLanguage, string[]> = {
  es: [
    'Planificas la RECUPERACIÓN suplementaria de Deep Research de Nodus. No escribes el informe.',
    'La consulta ordinaria ya se ha ejecutado y se conservará. Propón consultas adicionales que cubran material pertinente que podría faltar.',
    'No inventes fuentes, personas, fechas, comparandos ni posiciones. Derívalos del objetivo y de la vista del corpus.',
    'Cada consulta debe ser autónoma y buscable. Evita duplicar literalmente el objetivo.',
    'Devuelve SOLO JSON: {"probes":["..."],"comparands":["..."],"axes":["..."],"phases":["..."]}. Máximo 7 probes y 6 elementos en las demás listas.',
  ],
  en: [
    'You plan SUPPLEMENTARY Deep Research retrieval for Nodus. Do not write the report.',
    'The ordinary query has already run and will be preserved. Propose additional queries covering relevant material that may be missing.',
    'Do not invent sources, people, dates, comparands, or positions. Derive them from the objective and corpus view.',
    'Each query must be autonomous and searchable. Do not duplicate the objective literally.',
    'Return JSON ONLY: {"probes":["..."],"comparands":["..."],"axes":["..."],"phases":["..."]}. Maximum 7 probes and 6 items in every other list.',
  ],
  fr: [
    'Vous planifiez la recherche SUPPLÉMENTAIRE de Deep Research pour Nodus. N’écrivez pas le rapport.',
    'La requête ordinaire a déjà été exécutée et sera conservée. Proposez des requêtes supplémentaires couvrant les éléments pertinents qui pourraient manquer.',
    'N’inventez ni sources, ni personnes, ni dates, ni comparands, ni positions. Déduisez-les de l’objectif et de l’aperçu du corpus.',
    'Chaque requête doit être autonome et consultable. Ne dupliquez pas littéralement l’objectif.',
    'Retournez UNIQUEMENT le JSON : {"probes":["..."],"comparands":["..."],"axes":["..."],"phases":["..."]}. Maximum 7 probes et 6 éléments dans chaque autre liste.',
  ],
  de: [
    'Sie planen die ergänzende Deep-Research-Recherche für Nodus. Schreiben Sie nicht den Bericht.',
    'Die normale Anfrage wurde bereits ausgeführt und bleibt erhalten. Schlagen Sie zusätzliche Anfragen für möglicherweise fehlendes relevantes Material vor.',
    'Erfinden Sie keine Quellen, Personen, Daten, Vergleichsfälle oder Positionen. Leiten Sie sie aus Ziel und Korpusansicht ab.',
    'Jede Anfrage muss eigenständig und suchbar sein. Wiederholen Sie das Ziel nicht wörtlich.',
    'Geben Sie AUSSCHLIESSLICH JSON zurück: {"probes":["..."],"comparands":["..."],"axes":["..."],"phases":["..."]}. Höchstens 7 probes und 6 Elemente in jeder anderen Liste.',
  ],
  pt: [
    'Planeias a recuperação SUPLEMENTAR de Deep Research para o Nodus. Não redijas o relatório.',
    'A consulta normal já foi executada e será conservada. Propõe consultas adicionais para cobrir material relevante que possa faltar.',
    'Não inventes fontes, pessoas, datas, comparandos ou posições. Deriva-os do objetivo e da vista do corpus.',
    'Cada consulta deve ser autónoma e pesquisável. Evita duplicar literalmente o objetivo.',
    'Devolve APENAS JSON: {"probes":["..."],"comparands":["..."],"axes":["..."],"phases":["..."]}. Máximo de 7 probes e 6 elementos em cada outra lista.',
  ],
  'pt-BR': [
    'Você planeja a recuperação SUPLEMENTAR de Deep Research para o Nodus. Não escreva o relatório.',
    'A consulta normal já foi executada e será preservada. Proponha consultas adicionais para cobrir material relevante que possa faltar.',
    'Não invente fontes, pessoas, datas, comparandos ou posições. Derive-os do objetivo e da visão do corpus.',
    'Cada consulta deve ser autônoma e pesquisável. Evite duplicar literalmente o objetivo.',
    'Retorne SOMENTE JSON: {"probes":["..."],"comparands":["..."],"axes":["..."],"phases":["..."]}. Máximo de 7 probes e 6 elementos em cada outra lista.',
  ],
  it: [
    'Pianifichi il recupero SUPPLEMENTARE di Deep Research per Nodus. Non scriva il rapporto.',
    'La query ordinaria è già stata eseguita e sarà conservata. Proponga query aggiuntive per coprire il materiale pertinente eventualmente mancante.',
    'Non inventi fonti, persone, date, comparandi o posizioni. Li ricavi dall’obiettivo e dalla vista del corpus.',
    'Ogni query deve essere autonoma e ricercabile. Eviti di duplicare letteralmente l’obiettivo.',
    'Restituisca SOLO JSON: {"probes":["..."],"comparands":["..."],"axes":["..."],"phases":["..."]}. Massimo 7 probes e 6 elementi in ogni altra lista.',
  ],
  tr: [
    'Nodus için EK Deep Research erişimini planlıyorsunuz. Raporu yazmayın.',
    'Olağan sorgu zaten çalıştırıldı ve korunacak. Eksik olabilecek ilgili malzemeyi kapsayacak ek sorgular önerin.',
    'Kaynak, kişi, tarih, karşılaştırma birimi veya konum uydurmayın. Bunları amaçtan ve korpus görünümünden türetin.',
    'Her sorgu bağımsız ve aranabilir olmalıdır. Amacı kelimesi kelimesine yinelemeyin.',
    'YALNIZCA JSON döndürün: {"probes":["..."],"comparands":["..."],"axes":["..."],"phases":["..."]}. En fazla 7 probes ve diğer her listede 6 öğe.',
  ],
  'zh-Hans': [
    '你负责为 Nodus 规划补充性的 Deep Research 检索。不要撰写报告。',
    '常规查询已经执行并将被保留。请提出能够覆盖可能缺失的相关材料的补充查询。',
    '不要虚构来源、人物、日期、比较对象或立场。请从目标和语料库视图中推导它们。',
    '每条查询都必须独立且可检索。不要逐字重复目标。',
    '仅返回 JSON：{"probes":["..."],"comparands":["..."],"axes":["..."],"phases":["..."]}。probes 最多 7 条，其他每个列表最多 6 项。',
  ],
  'zh-Hant': [
    '你負責為 Nodus 規劃補充性的 Deep Research 檢索。不要撰寫報告。',
    '一般查詢已經執行並將予以保留。請提出能涵蓋可能缺失之相關材料的補充查詢。',
    '不要虛構來源、人物、日期、比較對象或立場。請從目標與語料庫視圖推導它們。',
    '每條查詢都必須獨立且可檢索。不要逐字重複目標。',
    '僅返回 JSON：{"probes":["..."],"comparands":["..."],"axes":["..."],"phases":["..."]}。probes 最多 7 條，其他每個清單最多 6 項。',
  ],
  vi: [
    'Bạn lập kế hoạch truy hồi Deep Research BỔ SUNG cho Nodus. Không viết báo cáo.',
    'Truy vấn thông thường đã được chạy và sẽ được giữ nguyên. Hãy đề xuất các truy vấn bổ sung bao quát tài liệu liên quan có thể còn thiếu.',
    'Không bịa ra nguồn, nhân vật, ngày tháng, đối tượng so sánh hay lập trường. Hãy suy ra chúng từ mục tiêu và bản xem ngữ liệu.',
    'Mỗi truy vấn phải độc lập và có thể tìm kiếm được. Không lặp lại mục tiêu nguyên văn.',
    'Chỉ trả về JSON: {"probes":["..."],"comparands":["..."],"axes":["..."],"phases":["..."]}. Tối đa 7 probes và 6 mục trong mỗi danh sách khác.',
  ],
  ja: [
    'あなたは Nodus の Deep Research 補完検索を計画します。報告書は書かないでください。',
    '通常のクエリはすでに実行済みで、そのまま保持されます。欠けている可能性のある関連資料を網羅する追加クエリを提案してください。',
    '出典、人物、日付、比較対象、立場を捏造しないでください。目的とコーパスビューから導き出してください。',
    '各クエリは自己完結し、検索可能でなければなりません。目的をそのまま繰り返さないでください。',
    'JSON のみを返してください：{"probes":["..."],"comparands":["..."],"axes":["..."],"phases":["..."]}。probes は最大 7 件、その他の各リストは最大 6 件です。',
  ],
  ru: [
    'Вы планируете ДОПОЛНИТЕЛЬНЫЙ поиск Deep Research для Nodus. Не пишите отчёт.',
    'Обычный запрос уже выполнен и будет сохранён. Предложите дополнительные запросы, охватывающие релевантный материал, которого может не хватать.',
    'Не выдумывайте источники, персоналии, даты, объекты сравнения или позиции. Выводите их из цели и обзора корпуса.',
    'Каждый запрос должен быть самостоятельным и пригодным для поиска. Не дублируйте цель дословно.',
    'Верните ТОЛЬКО JSON: {"probes":["..."],"comparands":["..."],"axes":["..."],"phases":["..."]}. Максимум 7 probes и 6 элементов в каждом другом списке.',
  ],
  uk: [
    'Ви плануєте ДОДАТКОВИЙ пошук Deep Research для Nodus. Не пишіть звіт.',
    'Звичайний запит уже виконано, і його буде збережено. Запропонуйте додаткові запити, що охоплюють релевантний матеріал, якого може бракувати.',
    'Не вигадуйте джерела, персоналії, дати, об’єкти порівняння чи позиції. Виводьте їх із мети та огляду корпусу.',
    'Кожен запит має бути самостійним і придатним для пошуку. Не дублюйте мету дослівно.',
    'Поверніть ТІЛЬКИ JSON: {"probes":["..."],"comparands":["..."],"axes":["..."],"phases":["..."]}. Максимум 7 probes і 6 елементів у кожному іншому списку.',
  ],
  ko: [
    '당신은 Nodus의 Deep Research 보충 검색을 계획합니다. 보고서를 작성하지 마십시오.',
    '일반 쿼리는 이미 실행되었으며 그대로 유지됩니다. 누락되었을 수 있는 관련 자료를 다루는 추가 쿼리를 제안하십시오.',
    '출처, 인물, 날짜, 비교 대상, 입장을 지어내지 마십시오. 목표와 코퍼스 보기에서 이끌어내십시오.',
    '각 쿼리는 독립적이고 검색 가능해야 합니다. 목표를 그대로 중복하지 마십시오.',
    'JSON만 반환하십시오: {"probes":["..."],"comparands":["..."],"axes":["..."],"phases":["..."]}. probes는 최대 7개, 나머지 각 목록은 최대 6개입니다.',
  ],
};

export function deepResearchApproachProfile(value: unknown, language: PromptLanguage = 'es'): DeepResearchApproachProfile {
  const approach = normalizeDeepResearchApproach(value);
  if (language === 'es') return PROFILES[approach];
  return { id: approach, ...localizedApproachContent(language, approach) };
}

export function approachRules(
  value: unknown,
  variant: DeepResearchApproachVariant,
  language: PromptLanguage = 'es',
): { retrieval: string[]; planner: string[]; writer: string[]; finalizer: string[] } {
  const profile = deepResearchApproachProfile(value, language);
  const extra = profile.variants?.[variant];
  return {
    retrieval: [...profile.retrievalRules, ...(extra?.retrieval ?? [])],
    planner: [...profile.plannerRules, ...(extra?.planner ?? [])],
    writer: [...profile.writerRules, ...(extra?.writer ?? [])],
    finalizer: [...profile.finalizerRules, ...(extra?.finalizer ?? [])],
  };
}

export interface ApproachRetrievalPlan {
  probes: string[];
  comparands: string[];
  axes: string[];
  phases: string[];
}

/** Specialized Genealogy citation syntax guard. It repairs only a known source id;
 * an unknown malformed id is removed instead of being allowed into the report. */
export function repairMalformedGenealogyCitations(
  markdown: string,
  sources: Array<{ id: string; title: string; label: string }>,
): string {
  const allowed = new Map(sources.map((source) => {
    const kind = source.id.startsWith('doc:') ? 'archive' : 'work';
    return [`${kind}:${source.id.replace(/^(?:doc|work):/, '')}`, { kind, source }];
  }));
  return markdown.replace(/\]?\(nodus:\/\/(archive|work)\/([^\s\])]+)\]/g, (_full, kind: string, rawId: string) => {
    let id = rawId;
    try { id = decodeURIComponent(rawId); } catch { /* keep raw */ }
    const match = allowed.get(`${kind}:${id}`);
    if (!match) return '';
    const label = match.kind === 'archive' ? match.source.title : match.source.label || match.source.title;
    return `[${label}](nodus://${kind}/${encodeURIComponent(id)})`;
  });
}

interface AiRetrievalPlan {
  probes?: unknown;
  comparands?: unknown;
  axes?: unknown;
  phases?: unknown;
}

function isAiRetrievalPlan(value: unknown): value is AiRetrievalPlan {
  return Boolean(value && typeof value === 'object');
}

function strings(value: unknown, max: number): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter((item) => item.length > 8))].slice(0, max)
    : [];
}

export function deterministicApproachRetrievalPlan(
  approachValue: unknown,
  objective: string,
  language: PromptLanguage = 'es',
): ApproachRetrievalPlan {
  const profile = deepResearchApproachProfile(approachValue, language);
  if (profile.id === 'general') return { probes: [], comparands: [], axes: [], phases: [] };
  return {
    probes: profile.retrievalFacets.slice(0, 6).map((facet) => `${objective}. ${facet}`),
    comparands: [],
    axes: profile.id === 'comparative' ? profile.retrievalFacets.slice(1, 6) : [],
    phases: profile.id === 'chronological' ? profile.retrievalFacets.slice(0, 6) : [],
  };
}

/**
 * Specialized-only retrieval planning. General never calls this function.
 * The model receives a compact view of the normal pool, so it can derive comparands,
 * phases and useful supplemental queries without inventing material outside it.
 */
export async function planApproachRetrieval(input: {
  approach: DeepResearchApproach;
  variant: DeepResearchApproachVariant;
  objective: string;
  language: PromptLanguage;
  corpusPreview: unknown;
  model: ModelRef | null;
}, completeJson:DeepResearchCompletionHost["completeJson"]): Promise<ApproachRetrievalPlan> {
  const fallback = deterministicApproachRetrievalPlan(input.approach, input.objective, input.language);
  if (input.approach === 'general') return fallback;
  const rules = approachRules(input.approach, input.variant, input.language).retrieval;
  const system = [
    ...RETRIEVAL_PROMPT_BASE[input.language],
    ...rules,
  ].join('\n');
  try {
    const result = await completeJson<AiRetrievalPlan>({
      system,
      user: JSON.stringify({ objective: input.objective, language: input.language, approach: input.approach, corpus: input.corpusPreview }, null, 2),
      temperature: 0.1,
      maxTokens: 1_400,
    }, isAiRetrievalPlan, input.model);
    return {
      probes: strings(result.probes, 7).length ? strings(result.probes, 7) : fallback.probes,
      comparands: strings(result.comparands, 6),
      axes: strings(result.axes, 6),
      phases: strings(result.phases, 6),
    };
  } catch {
    return fallback;
  }
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(item.id) && Boolean(seen.add(item.id)));
}

function interleaveSupplemental<T extends { id: string }>(ordinary: T[], supplemental: T[]): T[] {
  const baseIds = new Set(ordinary.map((item) => item.id));
  const additions = supplemental.filter((item) => !baseIds.has(item.id));
  const result: T[] = [];
  const length = Math.max(ordinary.length, additions.length);
  for (let index = 0; index < length; index += 1) {
    if (ordinary[index]) result.push(ordinary[index]);
    if (additions[index]) result.push(additions[index]);
  }
  return result;
}

function primaryAuthor(idea: WritingWorkshopIdeaCandidate): string {
  return (idea.works[0]?.authors[0] ?? idea.works[0]?.title ?? idea.id).toLocaleLowerCase();
}

function diversifyIdeas(items: WritingWorkshopIdeaCandidate[]): WritingWorkshopIdeaCandidate[] {
  const buckets = new Map<string, WritingWorkshopIdeaCandidate[]>();
  for (const item of items) {
    const key = primaryAuthor(item);
    const bucket = buckets.get(key) ?? [];
    bucket.push(item);
    buckets.set(key, bucket);
  }
  const result: WritingWorkshopIdeaCandidate[] = [];
  while (buckets.size) {
    for (const [key, bucket] of [...buckets]) {
      const next = bucket.shift();
      if (next) result.push(next);
      if (!bucket.length) buckets.delete(key);
    }
  }
  return result;
}

function diversifyWorks<T extends { id: string; authors: string[]; title: string }>(items: T[]): T[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = (item.authors[0] ?? item.title ?? item.id).toLocaleLowerCase();
    const bucket = buckets.get(key) ?? [];
    bucket.push(item);
    buckets.set(key, bucket);
  }
  const result: T[] = [];
  while (buckets.size) {
    for (const [key, bucket] of [...buckets]) {
      const next = bucket.shift();
      if (next) result.push(next);
      if (!bucket.length) buckets.delete(key);
    }
  }
  return result;
}

/** Union/deduplicate the ordinary pool with supplemental retrieval and then apply
 * approach-aware ordering. Nothing from the ordinary snapshot is deleted. */
export function mergeApproachSnapshots(
  ordinary: WritingWorkshopSnapshot,
  supplemental: WritingWorkshopSnapshot,
  approachValue: unknown,
): WritingWorkshopSnapshot {
  const approach = normalizeDeepResearchApproach(approachValue);
  const ideas = uniqueById([...ordinary.ideas, ...supplemental.ideas]);
  const works = uniqueById([...ordinary.works, ...supplemental.works]);
  const passages = uniqueById([...ordinary.passages, ...supplemental.passages]);
  const gaps = uniqueById([...ordinary.gaps, ...supplemental.gaps]);
  const contradictions = uniqueById([...ordinary.contradictions, ...supplemental.contradictions]);
  const themes = uniqueById([...ordinary.themes, ...supplemental.themes]);

  let orderedIdeas = ideas;
  let orderedWorks = works;
  if (approach === 'literature_review') {
    orderedIdeas = diversifyIdeas(ideas);
    orderedWorks = diversifyWorks(works);
  } else if (approach === 'state_of_art') {
    orderedIdeas = [...ideas].sort((a, b) => (b.workCount + b.evidenceCount) - (a.workCount + a.evidenceCount) || b.score - a.score);
    orderedWorks = [...works].sort((a, b) => b.ideaCount - a.ideaCount || (b.year ?? 0) - (a.year ?? 0) || b.score - a.score);
  } else if (approach === 'chronological') {
    orderedIdeas = [...ideas].sort((a, b) => Math.max(...b.works.map((w) => w.year ?? 0), 0) - Math.max(...a.works.map((w) => w.year ?? 0), 0) || b.score - a.score);
    orderedWorks = [...works].sort((a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity) || b.score - a.score);
  } else if (approach === 'conceptual') {
    const weight = (type: string) => type === 'framework' ? 4 : type === 'construct' ? 3 : type === 'method' ? 2 : 0;
    orderedIdeas = [...ideas].sort((a, b) => weight(b.type) - weight(a.type) || b.score - a.score);
  } else if (approach === 'comparative') {
    orderedIdeas = interleaveSupplemental(ordinary.ideas, supplemental.ideas);
    orderedWorks = interleaveSupplemental(ordinary.works, supplemental.works);
  }

  return {
    ...ordinary,
    ideas: orderedIdeas,
    themes,
    gaps: approach === 'state_of_art' ? [...gaps].sort((a, b) => b.confidence - a.confidence || b.score - a.score) : gaps,
    contradictions: approach === 'scholarly_debate' ? [...contradictions].sort((a, b) => b.confidence - a.confidence || b.score - a.score) : contradictions,
    works: orderedWorks,
    passages: approach === 'comparative'
      ? interleaveSupplemental(ordinary.passages, supplemental.passages)
      : passages,
    tutorRoutes: uniqueById([...ordinary.tutorRoutes, ...supplemental.tutorRoutes]),
  };
}

/** Relationships are supplied only to specialized Academic prompts. General never
 * performs this query, preserving its planning input byte-for-byte. */
