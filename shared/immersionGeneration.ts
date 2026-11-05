import type {PromptLanguage} from './types';
import type {ImmersionDeps,CurriculumInput,CurriculumResult,PanoramaInput,PanoramaResult,StationInput,StationResult,ContrastsInput,ContrastsResult,ExamInput,ExamResult} from '../electron/ai/immersionCore';
export type ImmersionCompletion = <T>(prompt: {system:string;user:string;temperature:number;maxTokens:number}, valid:(value:unknown)=>value is T) => Promise<T>;

export function createImmersionAIDependencies(complete: ImmersionCompletion): Omit<ImmersionDeps,'buildMaterial'> {
  return {planCurriculum:input=>aiPlanCurriculum(input,complete),writePanorama:input=>aiWritePanorama(input,complete),writeStation:input=>aiWriteStation(input,complete),writeContrasts:input=>aiWriteContrasts(input,complete),writeExam:input=>aiWriteExam(input,complete)};
}

// Every model-facing instruction for Immersion lives in this pack. JSON field
// names, enums, identifiers, citation syntax and limits are deliberately kept
// identical in every language; only the natural-language clauses are translated.
export interface ImmersionPromptPack {
  curriculum(input: CurriculumInput): string;
  panorama(input: PanoramaInput): string;
  station(input: StationInput): string;
  contrasts(input: ContrastsInput): string;
  exam(input: ExamInput): string;
}

type ImmersionPromptText = {
  language: string;
  curriculum: string[];
  panorama: string[];
  station: string[];
  contrasts: string[];
  exam: string[];
};

export const IMMERSION_PROMPT_LANGUAGES: readonly PromptLanguage[] = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-Hans', 'zh-Hant', 'vi', 'ja', 'ru', 'uk', 'ko'];
const IMMERSION_JSON = {
  curriculum: '{"title":"título breve de la inmersión","stations":[{"id":"st-1","title":"...","question":"...","ideaIds":["..."],"passageIds":["..."]}]}',
  panorama: '{"overview":"markdown","keyTerms":[{"term":"...","definition":"..."}]}',
  station: '{"context":"...","synthesis":"...","citations":[{"passageId":"...","whyItMatters":"...","commentary":"..."}],"positions":[{"author":"...","position":"...","ideaIds":["..."]}],"takeaways":["..."],"quiz":[{"kind":"choice|open","question":"...","options":["..."],"correctIndex":0,"explanation":"...","expected":"...","ideaIds":["..."]}]}' ,
  contrasts: '{"rows":[{"stationId":"...","cells":[{"author":"...","stance":"..."}]}]}',
  exam: '{"questions":[{"kind":"choice|open","question":"...","options":["..."],"correctIndex":0,"explanation":"...","expected":"...","ideaIds":["..."]}],"feynman":"..."}',
} as const;

const PROMPT_TEXT: Record<PromptLanguage, ImmersionPromptText> = {
  es: {
    language: 'español',
    curriculum: [
      'Eres el diseñador del modo Inmersión de Nodus: conviertes un tema de investigación en una RUTA de estaciones guiadas para dominarlo a fondo, de principio a fin.',
      'Tu trabajo aquí es la PLANIFICACIÓN de la ruta: defines la secuencia de estaciones y, para cada una, la sub-pregunta que responde y las ideas y pasajes del corpus que la sostienen. No redactas todavía el contenido.',
      'Apunta a unas {{count}} estaciones. Es un OBJETIVO, no una cuota: usa algunas menos si el material no da para más, o algunas más si el tema lo merece. Prioriza SIEMPRE una secuencia coherente, progresiva y sin relleno por encima de alcanzar un número exacto.',
      'ARCO PEDAGÓGICO del conjunto: abre por lo fundacional (qué está en juego, marco y conceptos base), avanza hacia los mecanismos, la evidencia y los casos, reserva las tensiones, debates y contra-lecturas para el tramo medio-final, y cierra con síntesis, límites o implicaciones. La ruta debe leerse como un curso que progresa, no como una lista de temas sueltos.',
      'PROFUNDIDAD POR CONTINUACIÓN: cuando un aspecto es rico, dedícale VARIAS estaciones CONSECUTIVAS que avancen de lo general a lo particular (p. ej. «X: panorama» → «X: mecanismos» → «X: evidencia y casos» → «X: consecuencias y tensiones»), en lugar de comprimirlo en una sola parada. Encadena las continuaciones para que cada una presuponga la anterior.',
      'Cada estación responde UNA sub-pregunta concreta y distinta, con su propio foco. No repartas la misma idea entre varias estaciones salvo que una continuación la retome deliberadamente desde un ángulo nuevo.',
      'COBERTURA: en conjunto, las estaciones deben abordar las ideas más fuertes del material y las voces y debates principales; no dejes fuera lo central del tema.',
      'Las fichas de obras son ORIENTACIÓN MACRO auditada: úsalas para decidir qué ejes son centrales y cómo ordenar la ruta, pero no como evidencia literal ni para inventar ideaIds o passageIds.',
      'Asigna a cada estación los pasajes de las mismas obras que sus ideas cuando existan, para que haya lectura literal donde corresponde.',
      'Usa EXCLUSIVAMENTE los identificadores (ideaIds, passageIds) que se te dan en el material. No inventes ids ni cites nada que no esté en la lista.',
      'Escribe los títulos y las preguntas en {{language}}: títulos breves y evocadores; preguntas concretas y respondibles con este material.',
      'Devuelve SOLO JSON válido, sin texto alrededor: {{json}}',
    ],
    panorama: [
      'Eres el redactor del panorama inicial del modo Inmersión de Nodus: el mapa mental que el lector necesita ANTES de bajar al detalle.',
      'Escribe en {{language}}.',
      'En 350-500 palabras de Markdown: qué está en juego en el tema, las 2-4 líneas o posiciones principales, qué autores las encarnan y cómo se conectan las sub-preguntas de la ruta.',
      'Usa SOLO los materiales dados. Cada afirmación sustantiva lleva una cita Markdown con la forma exacta [Autor (año)](nodus://idea/<id>) o [Autor (año)](nodus://work/<id>) usando el campo citation.',
      'El campo orientation de una obra sirve para situar su argumento global; no lo presentes como una cita literal ni inventes páginas. Prefiere las ideas para sostener afirmaciones concretas.',
      'Añade un vocabulario mínimo del campo: términos que el lector debe reconocer, con definiciones de una frase basadas en las ideas dadas.',
      'Devuelve SOLO JSON válido: {{json}}',
    ],
    station: [
      'Eres el guía de una estación del modo Inmersión de Nodus: una LECCIÓN COMPLETA sobre una sub-pregunta, para que el lector la domine de verdad en ~25-30 minutos de estudio. Nada de resúmenes superficiales.',
      'Escribe en {{language}}.',
      'Produce estos bloques:',
      '1) "context": 100-160 palabras que sitúen la sub-pregunta: por qué importa dentro del tema, qué está en juego y qué debe buscar el lector en esta estación.',
      '2) "synthesis": la lección principal, 600-900 palabras de Markdown en párrafos densos y encadenados (usa ### para 2-3 subsecciones si ayuda). Construye un argumento continuo: presenta cada posición, contrástala con las demás, señala matices, evolución y consecuencias. Cada afirmación sustantiva lleva su cita [Autor (año)](nodus://idea/<id>) o [Autor, año, p. N](nodus://passage/<id>) con el campo citation EXACTO del menú. Integra TODAS las ideas dadas que puedas sostener.',
      '3) "citations": lectura guiada. Elige los 3-5 pasajes del menú que un experto citaría de memoria. Para cada uno: "whyItMatters" (una frase: por qué es imprescindible) y "commentary" (80-140 palabras que enseñen a LEERLO: qué notar en su lenguaje, qué revela, cómo sostiene o complica el argumento de la lección). NO copies el texto del pasaje: solo su id.',
      '4) "positions": para cada autor con voz propia en esta sub-pregunta, su posición en 1-2 frases nítidas que lo distingan de los demás. Usa solo los autores dados.',
      '5) "takeaways": 4-6 frases completas que el lector debe retener de esta estación (lo que respondería un experto si le preguntan por esta sub-pregunta en un tribunal).',
      '{{quizRule}}',
      'Usa SOLO los materiales dados. No inventes obras, autores, páginas ni citas.',
      'Devuelve SOLO JSON válido: {{json}}',
    ],
    contrasts: [
      'Eres el constructor de la matriz de contrastes del modo Inmersión de Nodus: autores × sub-preguntas.',
      'Escribe en {{language}}.',
      'Para cada fila (sub-pregunta) y cada autor, escribe su postura en UNA frase que lo distinga de los demás autores de esa fila, basada SOLO en las ideas dadas para ese autor en esa fila.',
      'Si un autor no tiene ideas en una fila, su "stance" es la cadena vacía "". NUNCA inventes posturas.',
      'Devuelve SOLO JSON válido: {{json}}',
    ],
    exam: [
      'Eres el examinador final del modo Inmersión de Nodus. El lector acaba de recorrer todas las estaciones: comprueba si de verdad domina el tema.',
      'Escribe en {{language}}.',
      'Redacta {{count}} preguntas que cubran TODAS las sub-preguntas: mezcla "choice" (4 opciones, correctIndex, explanation) y "open" (con "expected"). Las mejores preguntas obligan a DISTINGUIR autores y posiciones, no a repetir definiciones.',
      'Añade "feynman": una consigna final para que el lector explique el tema completo con sus palabras.',
      'Usa SOLO las ideas dadas. Incluye ideaIds relevantes en cada pregunta.',
      'Devuelve SOLO JSON válido: {{json}}',
    ],
  },
  en: {
    language: 'English',
    curriculum: [
      'You are the designer of Nodus Immersion mode: you turn a research topic into a guided STATION ROUTE for mastering it thoroughly, from beginning to end.',
      'Your task here is ROUTE PLANNING: define the station sequence and, for each station, the sub-question it answers and the corpus ideas and passages that support it. Do not write the content yet.',
      'Aim for about {{count}} stations. This is a TARGET, not a quota: use fewer when the material cannot support more, or more when the topic deserves it. ALWAYS prioritize a coherent, progressive sequence without filler over hitting an exact number.',
      'PEDAGOGICAL ARC: begin with foundations (what is at stake, framework and basic concepts), move toward mechanisms, evidence and cases, reserve tensions, debates and counter-readings for the middle-to-late stretch, and close with synthesis, limits or implications. The route should read like a progressing course, not a list of disconnected topics.',
      'DEPTH THROUGH CONTINUATION: when an aspect is rich, devote SEVERAL CONSECUTIVE stations to it, moving from general to particular (e.g. “X: panorama” → “X: mechanisms” → “X: evidence and cases” → “X: consequences and tensions”), rather than compressing it into one stop. Chain continuations so each one presupposes the previous one.',
      'Each station answers ONE concrete, distinct sub-question with its own focus. Do not spread the same idea across stations unless a continuation deliberately revisits it from a new angle.',
      'COVERAGE: taken together, stations must address the strongest ideas in the material and the main voices and debates; do not leave out what is central to the topic.',
      'Work profiles are audited MACRO ORIENTATION: use them to decide which axes are central and how to order the route, but not as literal evidence and never to invent ideaIds or passageIds.',
      'Assign each station passages from the same works as its ideas when available, so literal reading appears where it belongs.',
      'Use EXCLUSIVELY the identifiers (ideaIds, passageIds) supplied in the material. Do not invent ids or cite anything not in the list.',
      'Write titles and questions in {{language}}: titles brief and evocative; questions concrete and answerable from this material.',
      'Return ONLY valid JSON, with no surrounding text: {{json}}',
    ],
    panorama: [
      'You are the writer of the opening panorama for Nodus Immersion: the mental map the reader needs BEFORE going into detail.',
      'Write in {{language}}.',
      'In 350–500 words of Markdown: explain what is at stake in the topic, the 2–4 main lines or positions, which authors embody them, and how the route’s sub-questions connect.',
      'Use ONLY the supplied materials. Every substantive claim must carry an exact Markdown citation of the form [Author (year)](nodus://idea/<id>) or [Author (year)](nodus://work/<id>) using the citation field.',
      'A work’s orientation field situates its overall argument; do not present it as a literal quote or invent pages. Prefer ideas to support concrete claims.',
      'Add a minimal vocabulary for the field: terms the reader must recognize, with one-sentence definitions based on the supplied ideas.',
      'Return ONLY valid JSON: {{json}}',
    ],
    station: [
      'You are the guide for a Nodus Immersion station: a COMPLETE LESSON on one sub-question, so the reader can genuinely master it in ~25–30 minutes of study. No superficial summaries.',
      'Write in {{language}}.',
      'Produce these blocks:',
      '1) "context": 100–160 words situating the sub-question: why it matters within the topic, what is at stake, and what the reader should look for in this station.',
      '2) "synthesis": the main lesson, 600–900 words of Markdown in dense, connected paragraphs (use ### for 2–3 subsections if helpful). Build a continuous argument: present each position, contrast it with the others, and note nuances, development and consequences. Every substantive claim carries its citation [Author (year)](nodus://idea/<id>) or [Author, year, p. N](nodus://passage/<id>) with the menu’s EXACT citation field. Integrate ALL supplied ideas you can support.',
      '3) "citations": guided reading. Choose the 3–5 menu passages an expert would cite from memory. For each: "whyItMatters" (one sentence: why it is indispensable) and "commentary" (80–140 words teaching how to READ it: what to notice in its language, what it reveals, and how it supports or complicates the lesson’s argument). Do NOT copy the passage text: only its id.',
      '4) "positions": for each author with a voice in this sub-question, their position in 1–2 crisp sentences distinguishing them from the others. Use only the supplied authors.',
      '5) "takeaways": 4–6 complete sentences the reader must retain from this station (what an expert would answer if asked about this sub-question in a viva).',
      '{{quizRule}}',
      'Use ONLY the supplied materials. Do not invent works, authors, pages or citations.',
      'Return ONLY valid JSON: {{json}}',
    ],
    contrasts: [
      'You are the builder of Nodus Immersion’s contrast matrix: authors × sub-questions.',
      'Write in {{language}}.',
      'For each row (sub-question) and each author, write their stance in ONE sentence distinguishing them from the other authors in that row, based ONLY on the ideas supplied for that author in that row.',
      'If an author has no ideas in a row, their "stance" is the empty string "". NEVER invent stances.',
      'Return ONLY valid JSON: {{json}}',
    ],
    exam: [
      'You are the final examiner for Nodus Immersion. The reader has just completed every station: check whether they truly master the topic.',
      'Write in {{language}}.',
      'Write {{count}} questions covering ALL sub-questions: mix "choice" (4 options, correctIndex, explanation) and "open" (with "expected"). The best questions require DISTINGUISHING authors and positions, not repeating definitions.',
      'Add "feynman": a final prompt asking the reader to explain the whole topic in their own words.',
      'Use ONLY the supplied ideas. Include relevant ideaIds in every question.',
      'Return ONLY valid JSON: {{json}}',
    ],
  },
  fr: {
    language: 'français',
    curriculum: [
      'Vous concevez le mode Immersion de Nodus : transformez un sujet de recherche en PARCOURS DE STATIONS guidées pour le maîtriser de bout en bout.',
      'Votre tâche est la PLANIFICATION DU PARCOURS : définissez la séquence des stations, la sous-question à laquelle chacune répond et les idées et passages du corpus qui la soutiennent. Ne rédigez pas encore le contenu.',
      'Visez environ {{count}} stations. C’est un OBJECTIF, pas un quota : utilisez-en moins si le matériau ne permet pas davantage, ou plus si le sujet le mérite. Privilégiez TOUJOURS une séquence cohérente, progressive et sans remplissage à un nombre exact.',
      'ARC PÉDAGOGIQUE : commencez par les fondements (enjeu, cadre et concepts de base), progressez vers les mécanismes, les preuves et les cas, réservez tensions, débats et contre-lectures au milieu et à la fin, puis concluez par une synthèse, des limites ou des implications. Le parcours doit ressembler à un cours progressif, non à une liste de thèmes isolés.',
      'PROFONDEUR PAR CONTINUATION : lorsqu’un aspect est riche, consacrez-lui PLUSIEURS stations CONSÉCUTIVES, du général au particulier (par ex. « X : panorama » → « X : mécanismes » → « X : preuves et cas » → « X : conséquences et tensions »), plutôt que de le comprimer en un seul arrêt. Enchaînez-les afin que chacune présuppose la précédente.',
      'Chaque station répond à UNE sous-question concrète et distincte, avec son propre angle. Ne répartissez pas la même idée entre plusieurs stations, sauf si une continuation la reprend volontairement sous un nouvel angle.',
      'COUVERTURE : ensemble, les stations doivent traiter les idées les plus fortes et les principales voix et débats du matériau ; ne laissez pas de côté ce qui est central.',
      'Les fiches d’ouvrages sont une ORIENTATION MACRO auditée : utilisez-les pour choisir les axes centraux et ordonner le parcours, jamais comme preuve littérale ni pour inventer des ideaIds ou passageIds.',
      'Attribuez à chaque station les passages des mêmes ouvrages que ses idées lorsqu’ils existent, afin d’insérer la lecture littérale au bon endroit.',
      'Utilisez EXCLUSIVEMENT les identifiants (ideaIds, passageIds) fournis. N’inventez aucun id et ne citez rien qui ne figure dans la liste.',
      'Écrivez les titres et les questions en {{language}} : titres brefs et évocateurs ; questions concrètes et répondables avec ce matériau.',
      'Renvoyez UNIQUEMENT du JSON valide, sans texte autour : {{json}}',
    ],
    panorama: [
      'Vous rédigez le panorama initial du mode Immersion de Nodus : la carte mentale nécessaire au lecteur AVANT le détail.',
      'Écrivez en {{language}}.',
      'En 350–500 mots de Markdown, exposez l’enjeu du sujet, les 2–4 lignes ou positions principales, les auteurs qui les incarnent et le lien entre les sous-questions du parcours.',
      'Utilisez SEULEMENT les matériaux fournis. Toute affirmation substantielle porte une citation Markdown exacte, [Auteur (année)](nodus://idea/<id>) ou [Auteur (année)](nodus://work/<id>), avec le champ citation.',
      'Le champ orientation d’un ouvrage situe son argument global ; ne le présentez pas comme une citation littérale et n’inventez pas de pages. Préférez les idées pour les affirmations concrètes.',
      'Ajoutez un vocabulaire minimal du domaine : termes à reconnaître et définitions d’une phrase fondées sur les idées fournies.',
      'Renvoyez UNIQUEMENT du JSON valide : {{json}}',
    ],
    station: [
      'Vous guidez une station du mode Immersion de Nodus : une LEÇON COMPLÈTE sur une sous-question, pour que le lecteur la maîtrise réellement en ~25–30 minutes. Aucun résumé superficiel.',
      'Écrivez en {{language}}.',
      'Produisez les blocs suivants :',
      '1) "context" : 100–160 mots situant la sous-question : son importance, l’enjeu et ce que le lecteur doit observer.',
      '2) "synthesis" : le cours principal, 600–900 mots de Markdown en paragraphes denses et liés (### pour 2–3 sous-sections si utile). Construisez un argument continu : présentez chaque position, comparez-la aux autres, relevez nuances, évolution et conséquences. Toute affirmation substantielle porte [Auteur (année)](nodus://idea/<id>) ou [Auteur, année, p. N](nodus://passage/<id>) avec le champ citation EXACT du menu. Intégrez TOUTES les idées que vous pouvez soutenir.',
      '3) "citations" : lecture guidée. Choisissez les 3–5 passages que citerait un expert. Pour chacun, "whyItMatters" (une phrase expliquant son caractère indispensable) et "commentary" (80–140 mots apprenant à le LIRE : langage, révélation, soutien ou complication de l’argument). NE copiez PAS le passage : seulement son id.',
      '4) "positions" : pour chaque auteur qui a une voix dans cette sous-question, sa position en 1–2 phrases nettes qui la distinguent. Utilisez uniquement les auteurs fournis.',
      '5) "takeaways" : 4–6 phrases complètes à retenir (ce qu’un expert répondrait à une soutenance).',
      '{{quizRule}}',
      'Utilisez SEULEMENT les matériaux fournis. N’inventez ni ouvrages, ni auteurs, ni pages, ni citations.',
      'Renvoyez UNIQUEMENT du JSON valide : {{json}}',
    ],
    contrasts: [
      'Vous construisez la matrice des contrastes du mode Immersion de Nodus : auteurs × sous-questions.',
      'Écrivez en {{language}}.',
      'Pour chaque ligne et chaque auteur, écrivez sa position en UNE phrase qui le distingue des autres, fondée UNIQUEMENT sur les idées fournies pour cet auteur dans cette ligne.',
      'Si un auteur n’a aucune idée dans une ligne, sa "stance" est la chaîne vide "". N’inventez JAMAIS de position.',
      'Renvoyez UNIQUEMENT du JSON valide : {{json}}',
    ],
    exam: [
      'Vous êtes l’examinateur final du mode Immersion de Nodus. Le lecteur vient de parcourir toutes les stations : vérifiez sa maîtrise réelle.',
      'Écrivez en {{language}}.',
      'Rédigez {{count}} questions couvrant TOUTES les sous-questions : mélangez "choice" (4 options, correctIndex, explanation) et "open" (avec "expected"). Les meilleures exigent de DISTINGUER auteurs et positions, non de réciter des définitions.',
      'Ajoutez "feynman" : une consigne finale demandant d’expliquer tout le sujet avec ses propres mots.',
      'Utilisez SEULEMENT les idées fournies. Incluez les ideaIds pertinents dans chaque question.',
      'Renvoyez UNIQUEMENT du JSON valide : {{json}}',
    ],
  },
  de: {
    language: 'Deutsch',
    curriculum: [
      'Sie entwerfen den Nodus-Modus Immersion: Verwandeln Sie ein Forschungsthema in eine geführte STATIONSROUTE, die es von Anfang bis Ende gründlich erschließt.',
      'Ihre Aufgabe ist die ROUTENPLANUNG: Legen Sie die Reihenfolge der Stationen, die jeweilige Teilfrage und die sie tragenden Korpusideen und Passagen fest. Schreiben Sie den Inhalt noch nicht.',
      'Zielen Sie auf etwa {{count}} Stationen. Das ist ein ZIEL, keine Quote: Verwenden Sie weniger, wenn das Material nicht mehr trägt, oder mehr, wenn das Thema es verdient. Eine kohärente, progressive Route ohne Füllmaterial hat IMMER Vorrang vor einer exakten Zahl.',
      'PÄDAGOGISCHER BOGEN: Beginnen Sie mit den Grundlagen (Einsatz, Rahmen und Grundbegriffe), gehen Sie zu Mechanismen, Evidenz und Fällen über, behandeln Sie Spannungen, Debatten und Gegenlektüren im mittleren bis letzten Abschnitt und schließen Sie mit Synthese, Grenzen oder Folgen. Die Route soll wie ein fortschreitender Kurs, nicht wie eine lose Themenliste wirken.',
      'TIEFE DURCH FORTSETZUNG: Widmen Sie einem reichen Aspekt MEHRERE AUFEINANDERFOLGENDE Stationen vom Allgemeinen zum Besonderen (z. B. „X: Panorama“ → „X: Mechanismen“ → „X: Evidenz und Fälle“ → „X: Folgen und Spannungen“). Verketten Sie sie so, dass jede die vorherige voraussetzt.',
      'Jede Station beantwortet EINE konkrete, eigenständige Teilfrage mit eigenem Schwerpunkt. Verteilen Sie dieselbe Idee nicht auf mehrere Stationen, außer eine Fortsetzung nimmt sie bewusst aus einem neuen Blickwinkel wieder auf.',
      'ABDECKUNG: Zusammen müssen die Stationen die stärksten Ideen sowie die wichtigsten Stimmen und Debatten des Materials behandeln. Lassen Sie nichts Zentrales aus.',
      'Werkprofile sind geprüfte MAKRO-ORIENTIERUNG: Nutzen Sie sie für zentrale Achsen und die Reihenfolge, nicht als wörtliche Evidenz und niemals zum Erfinden von ideaIds oder passageIds.',
      'Ordnen Sie jeder Station, sofern vorhanden, Passagen aus denselben Werken wie ihre Ideen zu, damit die wörtliche Lektüre am passenden Ort erfolgt.',
      'Verwenden Sie AUSSCHLIESSLICH die gelieferten Identifikatoren (ideaIds, passageIds). Erfinden Sie keine ids und zitieren Sie nichts außerhalb der Liste.',
      'Schreiben Sie Titel und Fragen auf {{language}}: kurze, einprägsame Titel sowie konkrete, mit diesem Material beantwortbare Fragen.',
      'Geben Sie NUR gültiges JSON ohne umgebenden Text zurück: {{json}}',
    ],
    panorama: [
      'Sie schreiben das Eingangspanorama des Nodus-Modus Immersion: die mentale Karte, die der Leser VOR dem Detail braucht.',
      'Schreiben Sie auf {{language}}.',
      'Erklären Sie in 350–500 Markdown-Wörtern den Einsatz des Themas, die 2–4 Hauptlinien oder Positionen, ihre Autoren und die Verbindung der Teilfragen der Route.',
      'Verwenden Sie NUR die gelieferten Materialien. Jede substanzielle Aussage erhält eine exakte Markdown-Zitation [Autor (Jahr)](nodus://idea/<id>) oder [Autor (Jahr)](nodus://work/<id>) aus dem Feld citation.',
      'Das orientation-Feld eines Werks dient zur Einordnung des Gesamtarguments; stellen Sie es nicht als wörtliches Zitat dar und erfinden Sie keine Seiten. Nutzen Sie bevorzugt Ideen für konkrete Aussagen.',
      'Fügen Sie ein minimales Fachvokabular hinzu: Begriffe mit ein-sätzigen Definitionen auf Grundlage der gelieferten Ideen.',
      'Geben Sie NUR gültiges JSON zurück: {{json}}',
    ],
    station: [
      'Sie führen eine Station des Nodus-Modus Immersion: eine VOLLSTÄNDIGE LEKTION zu einer Teilfrage, die der Leser in ~25–30 Minuten wirklich beherrschen kann. Keine oberflächlichen Zusammenfassungen.',
      'Schreiben Sie auf {{language}}.',
      'Erzeugen Sie diese Blöcke:',
      '1) "context": 100–160 Wörter zur Teilfrage: Bedeutung im Thema, Einsatz und worauf der Leser achten soll.',
      '2) "synthesis": die Hauptlektion, 600–900 Markdown-Wörter in dichten, verbundenen Absätzen (bei Bedarf ### für 2–3 Unterabschnitte). Bauen Sie ein durchgehendes Argument: Stellen Sie Positionen vor, kontrastieren Sie sie und zeigen Sie Nuancen, Entwicklung und Folgen. Jede substanzielle Aussage trägt [Autor (Jahr)](nodus://idea/<id>) oder [Autor, Jahr, S. N](nodus://passage/<id>) mit dem EXAKTEN citation-Feld des Menüs. Integrieren Sie ALLE belegbaren Ideen.',
      '3) "citations": geführte Lektüre. Wählen Sie 3–5 Passagen, die ein Experte auswendig zitieren würde. Für jede: "whyItMatters" (ein Satz zur Unverzichtbarkeit) und "commentary" (80–140 Wörter zum LESEN: Sprache, Erkenntnis, Stützung oder Problematisierung des Arguments). Kopieren Sie den Passage-Text NICHT, nur seine id.',
      '4) "positions": für jeden Autor mit eigener Stimme in dieser Teilfrage eine klare Position in 1–2 Sätzen, die ihn unterscheidet. Verwenden Sie nur die gelieferten Autoren.',
      '5) "takeaways": 4–6 vollständige Sätze, die zu behalten sind (was ein Experte in einer Prüfung antworten würde).',
      '{{quizRule}}',
      'Verwenden Sie NUR die gelieferten Materialien. Erfinden Sie keine Werke, Autoren, Seiten oder Zitate.',
      'Geben Sie NUR gültiges JSON zurück: {{json}}',
    ],
    contrasts: [
      'Sie erstellen die Kontrastmatrix des Nodus-Modus Immersion: Autoren × Teilfragen.',
      'Schreiben Sie auf {{language}}.',
      'Schreiben Sie für jede Zeile und jeden Autor dessen Haltung in EINEM Satz, der ihn von den anderen unterscheidet, ausschließlich auf Grundlage seiner Ideen in dieser Zeile.',
      'Hat ein Autor in einer Zeile keine Ideen, ist seine "stance" die leere Zeichenkette "". Erfinden Sie NIEMALS Haltungen.',
      'Geben Sie NUR gültiges JSON zurück: {{json}}',
    ],
    exam: [
      'Sie sind der Abschlussprüfer des Nodus-Modus Immersion. Der Leser hat alle Stationen absolviert: Prüfen Sie, ob er das Thema wirklich beherrscht.',
      'Schreiben Sie auf {{language}}.',
      'Verfassen Sie {{count}} Fragen zu ALLEN Teilfragen: Mischen Sie "choice" (4 Optionen, correctIndex, explanation) und "open" (mit "expected"). Die besten Fragen verlangen, Autoren und Positionen zu UNTERSCHEIDEN, statt Definitionen zu wiederholen.',
      'Fügen Sie "feynman" hinzu: eine abschließende Aufforderung, das gesamte Thema mit eigenen Worten zu erklären.',
      'Verwenden Sie NUR die gelieferten Ideen. Fügen Sie jeder Frage relevante ideaIds hinzu.',
      'Geben Sie NUR gültiges JSON zurück: {{json}}',
    ],
  },
  pt: {
    language: 'português europeu',
    curriculum: [
      'És o designer do modo Imersão do Nodus: transformas um tema de investigação num PERCURSO DE ESTAÇÕES guiadas para o dominar de princípio a fim.',
      'A tua tarefa é PLANEAR O PERCURSO: define a sequência das estações, a subquestão a que cada uma responde e as ideias e passagens do corpus que a sustentam. Ainda não redijas o conteúdo.',
      'Aponta para cerca de {{count}} estações. É um OBJETIVO, não uma quota: usa menos se o material não permitir mais, ou mais se o tema o justificar. Dá SEMPRE prioridade a uma sequência coerente, progressiva e sem enchimento em vez de atingir um número exato.',
      'ARCO PEDAGÓGICO: começa pelos fundamentos (o que está em causa, enquadramento e conceitos básicos), avança para mecanismos, evidência e casos, reserva tensões, debates e contra-leituras para a parte intermédia-final e termina com síntese, limites ou implicações. O percurso deve parecer um curso progressivo, não uma lista de temas soltos.',
      'PROFUNDIDADE POR CONTINUAÇÃO: quando um aspeto for rico, dedica-lhe VÁRIAS estações CONSECUTIVAS, do geral ao particular (por exemplo, «X: panorama» → «X: mecanismos» → «X: evidência e casos» → «X: consequências e tensões»), em vez de o comprimir numa só paragem. Liga as continuações para que cada uma pressuponha a anterior.',
      'Cada estação responde a UMA subquestão concreta e distinta, com foco próprio. Não distribuas a mesma ideia por várias estações, salvo quando uma continuação a retoma deliberadamente de um ângulo novo.',
      'COBERTURA: em conjunto, as estações devem abordar as ideias mais fortes, as principais vozes e os debates do material; não deixes de fora o que é central para o tema.',
      'As fichas das obras são ORIENTAÇÃO MACRO auditada: usa-as para decidir os eixos centrais e ordenar o percurso, mas não como evidência literal nem para inventar ideaIds ou passageIds.',
      'Atribui a cada estação passagens das mesmas obras que as suas ideias, quando existirem, para que a leitura literal apareça onde corresponde.',
      'Usa EXCLUSIVAMENTE os identificadores (ideaIds, passageIds) fornecidos no material. Não inventes ids nem cites algo que não esteja na lista.',
      'Escreve títulos e perguntas em {{language}}: títulos breves e evocadores; perguntas concretas e respondíveis com este material.',
      'Devolve APENAS JSON válido, sem texto envolvente: {{json}}',
    ],
    panorama: [
      'És o redator do panorama inicial do modo Imersão do Nodus: o mapa mental de que o leitor precisa ANTES de entrar no detalhe.',
      'Escreve em {{language}}.',
      'Em 350–500 palavras de Markdown, explica o que está em causa no tema, as 2–4 linhas ou posições principais, os autores que as representam e como se ligam as subquestões do percurso.',
      'Usa APENAS os materiais fornecidos. Cada afirmação substantiva deve ter uma citação Markdown exata [Autor (ano)](nodus://idea/<id>) ou [Autor (ano)](nodus://work/<id>) usando o campo citation.',
      'O campo orientation de uma obra serve para enquadrar o seu argumento global; não o apresentes como citação literal nem inventes páginas. Prefere as ideias para sustentar afirmações concretas.',
      'Acrescenta um vocabulário mínimo do campo: termos que o leitor deve reconhecer, definidos numa frase com base nas ideias fornecidas.',
      'Devolve APENAS JSON válido: {{json}}',
    ],
    station: [
      'És o guia de uma estação do modo Imersão do Nodus: uma LIÇÃO COMPLETA sobre uma subquestão, para que o leitor a domine realmente em ~25–30 minutos de estudo. Nada de resumos superficiais.',
      'Escreve em {{language}}.',
      'Produz estes blocos:',
      '1) "context": 100–160 palavras que situem a subquestão: a sua importância, o que está em causa e o que o leitor deve procurar nesta estação.',
      '2) "synthesis": a lição principal, 600–900 palavras de Markdown em parágrafos densos e encadeados (usa ### para 2–3 subseções se ajudar). Constrói um argumento contínuo: apresenta cada posição, contrasta-a com as demais e assinala nuances, evolução e consequências. Cada afirmação substantiva leva [Autor (ano)](nodus://idea/<id>) ou [Autor, ano, p. N](nodus://passage/<id>) com o campo citation EXATO do menu. Integra TODAS as ideias fornecidas que consigas sustentar.',
      '3) "citations": leitura guiada. Escolhe as 3–5 passagens do menu que um especialista citaria de memória. Para cada uma: "whyItMatters" (uma frase sobre a sua indispensabilidade) e "commentary" (80–140 palavras que ensinem a LÊ-LA: linguagem, revelação e modo como sustenta ou complica o argumento). NÃO copies o texto da passagem: apenas o seu id.',
      '4) "positions": para cada autor com voz própria nesta subquestão, a sua posição em 1–2 frases nítidas que o distingam dos outros. Usa apenas os autores fornecidos.',
      '5) "takeaways": 4–6 frases completas que o leitor deve reter (o que um especialista responderia numa defesa).',
      '{{quizRule}}',
      'Usa APENAS os materiais fornecidos. Não inventes obras, autores, páginas ou citações.',
      'Devolve APENAS JSON válido: {{json}}',
    ],
    contrasts: [
      'És o construtor da matriz de contrastes do modo Imersão do Nodus: autores × subquestões.',
      'Escreve em {{language}}.',
      'Para cada linha e cada autor, escreve a sua posição numa ÚNICA frase que o distinga dos restantes, baseada APENAS nas ideias fornecidas para esse autor nessa linha.',
      'Se um autor não tiver ideias numa linha, o seu "stance" é a cadeia vazia "". NUNCA inventes posições.',
      'Devolve APENAS JSON válido: {{json}}',
    ],
    exam: [
      'És o examinador final do modo Imersão do Nodus. O leitor acabou de percorrer todas as estações: verifica se domina realmente o tema.',
      'Escreve em {{language}}.',
      'Redige {{count}} perguntas que cubram TODAS as subquestões: mistura "choice" (4 opções, correctIndex, explanation) e "open" (com "expected"). As melhores exigem DISTINGUIR autores e posições, não repetir definições.',
      'Acrescenta "feynman": uma instrução final para o leitor explicar todo o tema pelas suas próprias palavras.',
      'Usa APENAS as ideias fornecidas. Inclui ideaIds relevantes em cada pergunta.',
      'Devolve APENAS JSON válido: {{json}}',
    ],
  },
  'pt-BR': {
    language: 'português do Brasil',
    curriculum: [
      'Você é o designer do modo Imersão do Nodus: transforme um tema de pesquisa em uma ROTA DE ESTAÇÕES guiadas para dominá-lo profundamente, do início ao fim.',
      'Sua tarefa é o PLANEJAMENTO DA ROTA: defina a sequência de estações, a subpergunta que cada uma responde e as ideias e passagens do corpus que a sustentam. Ainda não escreva o conteúdo.',
      'Mire em cerca de {{count}} estações. É uma META, não uma cota: use menos se o material não comportar mais, ou mais se o tema merecer. Priorize SEMPRE uma sequência coerente, progressiva e sem enchimento em vez de atingir um número exato.',
      'ARCO PEDAGÓGICO: comece pelos fundamentos (o que está em jogo, estrutura e conceitos básicos), avance para mecanismos, evidências e casos, reserve tensões, debates e contraleituras para a parte intermediária-final e encerre com síntese, limites ou implicações. A rota deve parecer um curso progressivo, não uma lista de temas desconectados.',
      'PROFUNDIDADE POR CONTINUAÇÃO: quando um aspecto for rico, dedique-lhe VÁRIAS estações CONSECUTIVAS, do geral ao particular (por exemplo, “X: panorama” → “X: mecanismos” → “X: evidências e casos” → “X: consequências e tensões”), em vez de comprimi-lo em uma parada. Encadeie as continuações para que cada uma pressuponha a anterior.',
      'Cada estação responde a UMA subpergunta concreta e distinta, com foco próprio. Não espalhe a mesma ideia por várias estações, a menos que uma continuação a retome deliberadamente de um novo ângulo.',
      'COBERTURA: juntas, as estações devem abordar as ideias mais fortes do material e as principais vozes e debates; não deixe de fora o que é central para o tema.',
      'As fichas das obras são ORIENTAÇÃO MACRO auditada: use-as para decidir os eixos centrais e ordenar a rota, mas não como evidência literal nem para inventar ideaIds ou passageIds.',
      'Atribua a cada estação passagens das mesmas obras que suas ideias, quando existirem, para que a leitura literal apareça onde corresponde.',
      'Use EXCLUSIVAMENTE os identificadores (ideaIds, passageIds) fornecidos no material. Não invente ids nem cite nada que não esteja na lista.',
      'Escreva títulos e perguntas em {{language}}: títulos breves e evocativos; perguntas concretas e respondíveis com este material.',
      'Retorne SOMENTE JSON válido, sem texto ao redor: {{json}}',
    ],
    panorama: [
      'Você é o redator do panorama inicial do modo Imersão do Nodus: o mapa mental de que o leitor precisa ANTES de entrar nos detalhes.',
      'Escreva em {{language}}.',
      'Em 350–500 palavras de Markdown, explique o que está em jogo no tema, as 2–4 principais linhas ou posições, os autores que as representam e como as subperguntas da rota se conectam.',
      'Use SOMENTE os materiais fornecidos. Toda afirmação substantiva deve ter uma citação Markdown exata [Autor (ano)](nodus://idea/<id>) ou [Autor (ano)](nodus://work/<id>) usando o campo citation.',
      'O campo orientation de uma obra serve para situar seu argumento geral; não o apresente como citação literal nem invente páginas. Prefira as ideias para sustentar afirmações concretas.',
      'Acrescente um vocabulário mínimo do campo: termos que o leitor deve reconhecer, com definições de uma frase baseadas nas ideias fornecidas.',
      'Retorne SOMENTE JSON válido: {{json}}',
    ],
    station: [
      'Você é o guia de uma estação do modo Imersão do Nodus: uma LIÇÃO COMPLETA sobre uma subpergunta, para que o leitor a domine de verdade em ~25–30 minutos de estudo. Nada de resumos superficiais.',
      'Escreva em {{language}}.',
      'Produza estes blocos:',
      '1) "context": 100–160 palavras situando a subpergunta: por que importa no tema, o que está em jogo e o que o leitor deve procurar nesta estação.',
      '2) "synthesis": a lição principal, 600–900 palavras de Markdown em parágrafos densos e encadeados (use ### para 2–3 subseções se ajudar). Construa um argumento contínuo: apresente cada posição, compare-a às demais e mostre nuances, evolução e consequências. Toda afirmação substantiva leva [Autor (ano)](nodus://idea/<id>) ou [Autor, ano, p. N](nodus://passage/<id>) com o campo citation EXATO do menu. Integre TODAS as ideias fornecidas que puder sustentar.',
      '3) "citations": leitura guiada. Escolha as 3–5 passagens do menu que um especialista citaria de memória. Para cada uma: "whyItMatters" (uma frase explicando por que é indispensável) e "commentary" (80–140 palavras ensinando a LÊ-LA: o que notar na linguagem, o que revela e como apoia ou complica o argumento). NÃO copie o texto da passagem: somente seu id.',
      '4) "positions": para cada autor com voz própria nesta subpergunta, sua posição em 1–2 frases nítidas que o diferenciem. Use apenas os autores fornecidos.',
      '5) "takeaways": 4–6 frases completas que o leitor deve guardar (o que um especialista responderia em uma banca).',
      '{{quizRule}}',
      'Use SOMENTE os materiais fornecidos. Não invente obras, autores, páginas ou citações.',
      'Retorne SOMENTE JSON válido: {{json}}',
    ],
    contrasts: [
      'Você é o construtor da matriz de contrastes do modo Imersão do Nodus: autores × subperguntas.',
      'Escreva em {{language}}.',
      'Para cada linha e cada autor, escreva sua posição em UMA frase que o diferencie dos demais, baseada SOMENTE nas ideias fornecidas para esse autor nessa linha.',
      'Se um autor não tiver ideias em uma linha, seu "stance" será a string vazia "". NUNCA invente posições.',
      'Retorne SOMENTE JSON válido: {{json}}',
    ],
    exam: [
      'Você é o examinador final do modo Imersão do Nodus. O leitor acabou de percorrer todas as estações: verifique se realmente domina o tema.',
      'Escreva em {{language}}.',
      'Redija {{count}} perguntas cobrindo TODAS as subperguntas: misture "choice" (4 opções, correctIndex, explanation) e "open" (com "expected"). As melhores exigem DISTINGUIR autores e posições, não repetir definições.',
      'Adicione "feynman": uma instrução final para o leitor explicar o tema inteiro com suas próprias palavras.',
      'Use SOMENTE as ideias fornecidas. Inclua ideaIds relevantes em cada pergunta.',
      'Retorne SOMENTE JSON válido: {{json}}',
    ],
  },
  it: {
    language: 'italiano',
    curriculum: [
      'Sei il designer della modalità Immersion di Nodus: trasformi un tema di ricerca in un PERCORSO DI STAZIONI guidate per dominarlo a fondo, dall’inizio alla fine.',
      'Qui devi PIANIFICARE IL PERCORSO: definisci la sequenza delle stazioni, la sotto-domanda a cui ciascuna risponde e le idee e i passaggi del corpus che la sostengono. Non scrivere ancora il contenuto.',
      'Punta a circa {{count}} stazioni. È un OBIETTIVO, non una quota: usane meno se il materiale non consente altro, o più se il tema lo merita. Dai SEMPRE priorità a una sequenza coerente, progressiva e senza riempitivi rispetto a un numero esatto.',
      'ARCO PEDAGOGICO: apri con i fondamenti (posta in gioco, quadro e concetti di base), passa a meccanismi, prove e casi, riserva tensioni, dibattiti e contro-letture alla parte centrale-finale e chiudi con sintesi, limiti o implicazioni. Il percorso deve sembrare un corso progressivo, non un elenco di temi scollegati.',
      'PROFONDITÀ PER CONTINUAZIONE: quando un aspetto è ricco, dedicagli PIÙ stazioni CONSECUTIVE, dal generale al particolare (per esempio «X: panorama» → «X: meccanismi» → «X: prove e casi» → «X: conseguenze e tensioni»), invece di comprimerlo in una sola tappa. Collega le continuazioni perché ciascuna presupponga la precedente.',
      'Ogni stazione risponde a UNA sotto-domanda concreta e distinta, con un proprio fuoco. Non distribuire la stessa idea tra più stazioni, salvo che una continuazione la riprenda deliberatamente da un nuovo angolo.',
      'COPERTURA: nel complesso le stazioni devono trattare le idee più forti, le voci principali e i dibattiti del materiale; non lasciare fuori ciò che è centrale.',
      'Le schede delle opere sono un ORIENTAMENTO MACRO verificato: usale per scegliere gli assi centrali e ordinare il percorso, non come prova letterale né per inventare ideaIds o passageIds.',
      'Assegna a ogni stazione, quando esistono, i passaggi delle stesse opere delle sue idee, così la lettura letterale compare nel punto giusto.',
      'Usa ESCLUSIVAMENTE gli identificatori (ideaIds, passageIds) forniti nel materiale. Non inventare ids né citare elementi assenti dalla lista.',
      'Scrivi titoli e domande in {{language}}: titoli brevi ed evocativi; domande concrete e rispondibili con questo materiale.',
      'Restituisci SOLO JSON valido, senza testo circostante: {{json}}',
    ],
    panorama: [
      'Sei l’autore del panorama iniziale della modalità Immersion di Nodus: la mappa mentale di cui il lettore ha bisogno PRIMA di entrare nei dettagli.',
      'Scrivi in {{language}}.',
      'In 350–500 parole Markdown, spiega la posta in gioco del tema, le 2–4 linee o posizioni principali, gli autori che le incarnano e come si collegano le sotto-domande del percorso.',
      'Usa SOLO i materiali forniti. Ogni affermazione sostanziale deve avere una citazione Markdown esatta [Autore (anno)](nodus://idea/<id>) o [Autore (anno)](nodus://work/<id>) usando il campo citation.',
      'Il campo orientation di un’opera serve a collocare il suo argomento complessivo; non presentarlo come citazione letterale e non inventare pagine. Preferisci le idee per sostenere affermazioni concrete.',
      'Aggiungi un vocabolario minimo del campo: termini che il lettore deve riconoscere, con definizioni di una frase basate sulle idee fornite.',
      'Restituisci SOLO JSON valido: {{json}}',
    ],
    station: [
      'Sei la guida di una stazione della modalità Immersion di Nodus: una LEZIONE COMPLETA su una sotto-domanda, perché il lettore la padroneggi davvero in ~25–30 minuti di studio. Niente riassunti superficiali.',
      'Scrivi in {{language}}.',
      'Produci questi blocchi:',
      '1) "context": 100–160 parole per situare la sotto-domanda: perché conta nel tema, cosa è in gioco e cosa il lettore deve cercare.',
      '2) "synthesis": la lezione principale, 600–900 parole Markdown in paragrafi densi e collegati (usa ### per 2–3 sottosezioni se utile). Costruisci un argomento continuo: presenta ogni posizione, confrontala con le altre e segnala sfumature, sviluppo e conseguenze. Ogni affermazione sostanziale porta [Autore (anno)](nodus://idea/<id>) oppure [Autore, anno, p. N](nodus://passage/<id>) con il campo citation ESATTO del menu. Integra TUTTE le idee sostenibili.',
      '3) "citations": lettura guidata. Scegli i 3–5 passaggi che un esperto citerebbe a memoria. Per ciascuno: "whyItMatters" (una frase sull’indispensabilità) e "commentary" (80–140 parole per insegnare a LEGGERLO: linguaggio, rivelazione e modo in cui sostiene o complica l’argomento). NON copiare il testo del passaggio: solo il suo id.',
      '4) "positions": per ogni autore con una voce in questa sotto-domanda, la sua posizione in 1–2 frasi nette che lo distinguano. Usa solo gli autori forniti.',
      '5) "takeaways": 4–6 frasi complete da ricordare (ciò che un esperto risponderebbe a un esame).',
      '{{quizRule}}',
      'Usa SOLO i materiali forniti. Non inventare opere, autori, pagine o citazioni.',
      'Restituisci SOLO JSON valido: {{json}}',
    ],
    contrasts: [
      'Sei il costruttore della matrice dei contrasti della modalità Immersion di Nodus: autori × sotto-domande.',
      'Scrivi in {{language}}.',
      'Per ogni riga e autore, scrivi la sua posizione in UNA frase che lo distingua dagli altri, basandoti SOLO sulle idee fornite per quell’autore in quella riga.',
      'Se un autore non ha idee in una riga, il suo "stance" è la stringa vuota "". NON inventare MAI posizioni.',
      'Restituisci SOLO JSON valido: {{json}}',
    ],
    exam: [
      'Sei l’esaminatore finale della modalità Immersion di Nodus. Il lettore ha appena completato tutte le stazioni: verifica che padroneggi davvero il tema.',
      'Scrivi in {{language}}.',
      'Redigi {{count}} domande che coprano TUTTE le sotto-domande: alterna "choice" (4 opzioni, correctIndex, explanation) e "open" (con "expected"). Le migliori richiedono di DISTINGUERE autori e posizioni, non di ripetere definizioni.',
      'Aggiungi "feynman": una consegna finale per spiegare l’intero tema con parole proprie.',
      'Usa SOLO le idee fornite. Includi ideaIds pertinenti in ogni domanda.',
      'Restituisci SOLO JSON valido: {{json}}',
    ],
  },
  tr: {
    language: 'Türkçe',
    curriculum: [
      'Nodus Immersion modunun tasarımcısısınız: bir araştırma konusunu, baştan sona derinlemesine öğrenmek için yönlendirilmiş İSTASYON ROTASINA dönüştürürsünüz.',
      'Buradaki göreviniz ROTA PLANLAMASIDIR: istasyonların sırasını, her istasyonun yanıtladığı alt soruyu ve onu destekleyen korpus fikirleriyle pasajlarını belirleyin. İçeriği henüz yazmayın.',
      'Yaklaşık {{count}} istasyon hedefleyin. Bu bir HEDEFTİR, kota değildir: materyal daha fazlasını desteklemiyorsa daha az, konu gerektiriyorsa daha fazla kullanın. Kesin sayıya ulaşmaktan çok tutarlı, ilerleyen ve dolgusuz bir sıraya HER ZAMAN öncelik verin.',
      'PEDAGOJİK YAY: temellerle (neyin söz konusu olduğu, çerçeve ve temel kavramlar) başlayın; mekanizmalara, kanıtlara ve örneklere ilerleyin; gerilimleri, tartışmaları ve karşı okumaları orta-son bölüme bırakın; sentez, sınırlar veya çıkarımlarla bitirin. Rota, kopuk konu listesi değil, ilerleyen bir ders gibi okunmalıdır.',
      'DEVAMLA DERİNLİK: bir boyut zenginse onu tek durakta sıkıştırmak yerine genelden özele ilerleyen BİRDEN ÇOK ARDIŞIK istasyon ayırın (ör. “X: panorama” → “X: mekanizmalar” → “X: kanıt ve örnekler” → “X: sonuçlar ve gerilimler”). Devamları birbirine bağlayın; her biri öncekini varsaysın.',
      'Her istasyon kendi odağı olan TEK, somut ve farklı bir alt soruyu yanıtlar. Bir devam istasyonu aynı fikri bilinçli biçimde yeni açıdan ele almıyorsa onu istasyonlara dağıtmayın.',
      'KAPSAM: istasyonlar birlikte materyaldeki en güçlü fikirleri, başlıca sesleri ve tartışmaları ele almalıdır; konunun merkezindekileri dışarıda bırakmayın.',
      'Eser profilleri denetlenmiş MAKRO YÖNLENDİRMEDİR: merkezi eksenleri ve rota sırasını seçmek için kullanın; kelimesi kelimesine kanıt olarak veya ideaIds/passageIds uydurmak için kullanmayın.',
      'Varsa her istasyona fikirleriyle aynı eserlerden pasajlar atayın; böylece kelimesi kelimesine okuma doğru yerde gerçekleşir.',
      'Materyalde verilen tanımlayıcıları (ideaIds, passageIds) YALNIZCA kullanın. Yeni id uydurmayın ve listede olmayan hiçbir şeyi alıntılamayın.',
      'Başlıkları ve soruları {{language}} dilinde yazın: başlıklar kısa ve çağrışımlı, sorular somut ve bu materyalle yanıtlanabilir olsun.',
      'Çevresinde metin olmadan SADECE geçerli JSON döndürün: {{json}}',
    ],
    panorama: [
      'Nodus Immersion modunun açılış panoramasını yazıyorsunuz: okuyucunun ayrıntıya inmeden ÖNCE ihtiyaç duyduğu zihinsel harita.',
      '{{language}} dilinde yazın.',
      '350–500 Markdown kelimesiyle konunun neyi gündeme getirdiğini, 2–4 ana çizgiyi veya konumu, bunları temsil eden yazarları ve rota alt sorularının nasıl bağlandığını açıklayın.',
      'YALNIZCA sağlanan materyali kullanın. Her önemli iddia, citation alanını kullanarak [Yazar (yıl)](nodus://idea/<id>) veya [Yazar (yıl)](nodus://work/<id>) biçiminde tam Markdown alıntısı taşımalıdır.',
      'Bir eserin orientation alanı genel savını konumlandırır; onu kelimesi kelimesine alıntı gibi sunmayın ve sayfa uydurmayın. Somut iddiaları desteklemek için fikirleri tercih edin.',
      'Alan için asgari bir sözlük ekleyin: okuyucunun tanıması gereken terimler ve verilen fikirlere dayalı tek cümlelik tanımlar.',
      'SADECE geçerli JSON döndürün: {{json}}',
    ],
    station: [
      'Nodus Immersion istasyonunun rehberisiniz: tek bir alt soru üzerine, okuyucunun ~25–30 dakikalık çalışmayla gerçekten uzmanlaşacağı TAM BİR DERS. Yüzeysel özetler yazmayın.',
      '{{language}} dilinde yazın.',
      'Şu blokları üretin:',
      '1) "context": alt soruyu 100–160 kelimeyle konumlandırın: konu içindeki önemi, neyin söz konusu olduğu ve okuyucunun bu istasyonda ne araması gerektiği.',
      '2) "synthesis": ana dersi, yoğun ve bağlantılı paragraflarla 600–900 Markdown kelimesi olarak yazın (gerekirse 2–3 alt bölüm için ### kullanın). Sürekli bir sav kurun: her konumu sunun, diğerleriyle karşılaştırın, nüansları, gelişimi ve sonuçları belirtin. Her önemli iddia menüdeki citation alanıyla TAM olarak [Yazar (yıl)](nodus://idea/<id>) veya [Yazar, yıl, s. N](nodus://passage/<id>) alıntısını taşımalıdır. Destekleyebildiğiniz TÜM fikirleri birleştirin.',
      '3) "citations": yönlendirilmiş okuma. Bir uzmanın ezbere alıntılayacağı 3–5 menü pasajını seçin. Her biri için "whyItMatters" (neden vazgeçilmez olduğunu belirten bir cümle) ve "commentary" (dilinde neye dikkat edileceğini, neyi açığa çıkardığını ve dersin savını nasıl desteklediğini veya karmaşıklaştırdığını ÖĞRETEN 80–140 kelime) yazın. Pasaj metnini KOPYALAMAYIN: yalnızca id’sini verin.',
      '4) "positions": bu alt soruda kendi sesi olan her yazar için, diğerlerinden ayıran 1–2 net cümlelik konumunu yazın. Yalnızca verilen yazarları kullanın.',
      '5) "takeaways": okuyucunun bu istasyondan hatırlaması gereken 4–6 tam cümle (bir uzmanın sınavda vereceği yanıt).',
      '{{quizRule}}',
      'YALNIZCA sağlanan materyali kullanın. Eser, yazar, sayfa veya alıntı uydurmayın.',
      'SADECE geçerli JSON döndürün: {{json}}',
    ],
    contrasts: [
      'Nodus Immersion modunun karşılaştırma matrisini oluşturuyorsunuz: yazarlar × alt sorular.',
      '{{language}} dilinde yazın.',
      'Her satır ve yazar için, yalnızca o satırda o yazara verilen fikirlere dayanarak, onu diğer yazarlardan ayıran TEK cümlelik tutum yazın.',
      'Bir yazarın satırda fikri yoksa "stance" değeri boş dize "" olsun. ASLA tutum uydurmayın.',
      'SADECE geçerli JSON döndürün: {{json}}',
    ],
    exam: [
      'Nodus Immersion modunun final sınavcısısınız. Okuyucu tüm istasyonları tamamladı: konuyu gerçekten öğrenip öğrenmediğini sınayın.',
      '{{language}} dilinde yazın.',
      'TÜM alt soruları kapsayan {{count}} soru yazın: "choice" (4 seçenek, correctIndex, explanation) ve "open" ("expected" ile) türlerini karıştırın. En iyi sorular tanımları tekrarlatmaz; yazarları ve konumları AYIRT ETMEYİ gerektirir.',
      'Okuyucunun tüm konuyu kendi sözleriyle açıklamasını isteyen son bir yönerge olarak "feynman" ekleyin.',
      'YALNIZCA verilen fikirleri kullanın. Her soruya ilgili ideaIds ekleyin.',
      'SADECE geçerli JSON döndürün: {{json}}',
    ],
  },
  'zh-Hans': {
    language: '简体中文',
    curriculum: [
      '你是 Nodus 沉浸模式的设计者：把一个研究主题转化为一条引导式站点路线，让读者自始至终深入掌握它。',
      '你在这里的任务是路线规划：确定站点顺序，并为每个站点指定它回答的子问题以及支撑该子问题的语料观点与段落。此时不要撰写内容。',
      '目标约为 {{count}} 个站点。这是目标而非配额：材料不足以支撑更多时就用少一些，主题值得时就用多一些。始终优先保证路线连贯、循序渐进且没有填充内容，而不是凑够某个精确数字。',
      '整体教学弧线：从基础开始（利害所在、框架与基本概念），推进到机制、证据与案例，把张力、争论与反向解读留到中后段，最后以综合、局限或影响收尾。整条路线读起来应像一门不断推进的课程，而不是零散主题的清单。',
      '以延续实现深度：当某个方面内容丰厚时，为它安排多个连续站点，从一般到具体逐步推进（例如“X：全景”→“X：机制”→“X：证据与案例”→“X：后果与张力”），而不是把它压缩成一个站点。让各延续站点环环相扣，每一站都以前一站为前提。',
      '每个站点回答一个具体而独特的子问题，各有自己的焦点。不要把同一个观点分散到多个站点，除非某个延续站点有意从新角度重新讨论它。',
      '覆盖度：所有站点合起来必须涵盖材料中最有力的观点以及主要的声音和争论；不要遗漏主题的核心内容。',
      '著作档案是经过审核的宏观定位：用它们判断哪些轴线是核心、如何安排路线顺序，但不要把它们当作原文证据，也绝不要用来编造 ideaIds 或 passageIds。',
      '在条件允许时，为每个站点分配与其观点出自同一著作的段落，让原文阅读出现在恰当的位置。',
      '只使用材料中提供的标识符（ideaIds、passageIds）。不要编造 id，也不要引用列表之外的任何内容。',
      '用{{language}}撰写标题和问题：标题简短而富有启发性；问题具体，且能用这些材料回答。',
      '只返回有效 JSON，不要附任何其他文本：{{json}}',
    ],
    panorama: [
      '你是 Nodus 沉浸模式开篇全景的撰写者：这是读者在深入细节之前需要的思维导图。',
      '用{{language}}撰写。',
      '用 350–500 词的 Markdown 说明：本主题的利害所在、2–4 条主要脉络或立场、分别由哪些作者代表，以及路线中各子问题之间的关联。',
      '只使用所提供的材料。每条实质性论断都必须带有精确的 Markdown 引用，形式为 [作者 (年份)](nodus://idea/<id>) 或 [作者 (年份)](nodus://work/<id>)，使用 citation 字段。',
      '著作的 orientation 字段用于定位其整体论点；不要把它当作原文引用，也不要编造页码。支撑具体论断时优先使用观点。',
      '添加一份最小的领域词汇表：读者必须认识的术语，并用基于所给观点的一句话定义。',
      '只返回有效 JSON：{{json}}',
    ],
    station: [
      '你是 Nodus 沉浸模式中某个站点的引导者：围绕一个子问题的一堂完整课程，让读者用约 25–30 分钟的学习真正掌握它。不要肤浅的摘要。',
      '用{{language}}撰写。',
      '生成以下区块：',
      '1) "context"：100–160 词，交代子问题的背景：它在主题中为何重要、利害何在，以及读者在本站应关注什么。',
      '2) "synthesis"：主课程，600–900 词的 Markdown，采用密集且连贯的段落（如有帮助，可用 ### 分 2–3 个小节）。构建连续的论证：呈现每种立场，与其他立场对照，指出细微差别、演变和后果。每条实质性论断都要带有引用 [作者 (年份)](nodus://idea/<id>) 或 [作者, 年份, 第 N 页](nodus://passage/<id>)，使用菜单中准确的 citation 字段。整合所有你能支撑的所给观点。',
      '3) "citations"：引导式阅读。从菜单中选择 3–5 个专家会凭记忆引用的段落。对每一段给出："whyItMatters"（一句话说明为何不可或缺）和 "commentary"（80–140 词，教读者如何阅读它：注意其语言、它揭示了什么、它如何支持或复杂化本课的论证）。不要复制段落文本：只给它的 id。',
      '4) "positions"：对在本子问题中有独立声音的每位作者，用 1–2 句鲜明的话概括其立场，以区别于他人。只使用所提供的作者。',
      '5) "takeaways"：读者必须记住的 4–6 个完整句子（若在答辩中被问到本子问题，专家会如何回答）。',
      '{{quizRule}}',
      '只使用所提供的材料。不要编造著作、作者、页码或引用。',
      '只返回有效 JSON：{{json}}',
    ],
    contrasts: [
      '你是 Nodus 沉浸模式对比矩阵的构建者：作者 × 子问题。',
      '用{{language}}撰写。',
      '对每一行（子问题）和每位作者，用一句话写出其立场，以区别于该行中的其他作者；只能基于该行中为该作者提供的观点。',
      '如果某位作者在某行没有观点，其 "stance" 为空字符串 ""。绝不要编造立场。',
      '只返回有效 JSON：{{json}}',
    ],
    exam: [
      '你是 Nodus 沉浸模式的期末考官。读者刚刚走完所有站点：检验他是否真正掌握了主题。',
      '用{{language}}撰写。',
      '撰写 {{count}} 道覆盖所有子问题的题目：混合 "choice"（4 个选项、correctIndex、explanation）与 "open"（含 "expected"）。最好的题目要求区分作者和立场，而不是复述定义。',
      '添加 "feynman"：让读者用自己的话解释整个主题的最终任务。',
      '只使用所给观点。每道题都包含相关的 ideaIds。',
      '只返回有效 JSON：{{json}}',
    ],
  },
  'zh-Hant': {
    language: '繁體中文',
    curriculum: [
      '你是 Nodus 沉浸模式的設計者：把一個研究主題轉化為一條引導式站點路線，讓讀者從頭到尾深入掌握它。',
      '你在這裡的任務是路線規劃：確定站點順序，並為每個站點指定它回答的子問題，以及支撐該子問題的語料觀點與段落。此時還不要撰寫內容。',
      '目標約為 {{count}} 個站點。這是目標而非配額：材料不足以支撐更多時就用少一些，主題值得時就用多一些。永遠優先確保路線連貫、循序漸進且沒有填充內容，而不是湊到某個精確數字。',
      '整體教學弧線：從基礎開始（利害所在、框架與基本概念），推進到機制、證據與案例，把張力、爭論與反向解讀留到中後段，最後以綜合、限制或影響收尾。整條路線讀起來應像一門不斷推進的課程，而不是零散主題的清單。',
      '以延續實現深度：當某個面向內容豐富時，為它安排多個連續站點，從一般到具體逐步推進（例如「X：全景」→「X：機制」→「X：證據與案例」→「X：後果與張力」），而不是把它壓縮成一個站點。讓各延續站點環環相扣，每一站都以前一站為前提。',
      '每個站點回答一個具體而獨特的子問題，各有自己的焦點。不要將同一個觀點分散到多個站點，除非某個延續站點刻意從新角度重新討論它。',
      '涵蓋度：所有站點合起來必須涵蓋材料中最有力的觀點以及主要的聲音和爭論；不要遺漏主題的核心內容。',
      '著作檔案是經過審核的宏觀定位：用它們判斷哪些軸線是核心、如何安排路線順序，但不要把它們當作原文證據，也絕不要用來編造 ideaIds 或 passageIds。',
      '在情況允許時，為每個站點分配與其觀點出自同一著作的段落，讓原文閱讀出現在恰當的位置。',
      '只使用材料中提供的識別碼（ideaIds、passageIds）。不要編造 id，也不要引用清單之外的任何內容。',
      '用{{language}}撰寫標題和問題：標題簡短而富有啟發性；問題具體，且能用這些材料回答。',
      '只回傳有效 JSON，不要附帶任何其他文字：{{json}}',
    ],
    panorama: [
      '你是 Nodus 沉浸模式開篇全景的撰寫者：這是讀者在深入細節之前需要的思維地圖。',
      '用{{language}}撰寫。',
      '用 350–500 字的 Markdown 說明：本主題的利害所在、2–4 條主要脈絡或立場、分別由哪些作者代表，以及路線中各子問題之間的關聯。',
      '只使用所提供的材料。每條實質性論斷都必須帶有精確的 Markdown 引用，形式為 [作者 (年份)](nodus://idea/<id>) 或 [作者 (年份)](nodus://work/<id>)，使用 citation 欄位。',
      '著作的 orientation 欄位用於定位其整體論點；不要把它當作原文引用，也不要編造頁碼。支撐具體論斷時優先使用觀點。',
      '加入一份最小的領域詞彙表：讀者必須認識的術語，並用基於所給觀點的一句話定義。',
      '只回傳有效 JSON：{{json}}',
    ],
    station: [
      '你是 Nodus 沉浸模式中某個站點的引導者：圍繞一個子問題的一堂完整課程，讓讀者用約 25–30 分鐘的學習真正掌握它。不要膚淺的摘要。',
      '用{{language}}撰寫。',
      '產生以下區塊：',
      '1) "context"：100–160 字，交代子問題的背景：它在主題中為何重要、利害何在，以及讀者在本站應關注什麼。',
      '2) "synthesis"：主課程，600–900 字的 Markdown，採用密集且連貫的段落（如有幫助，可用 ### 分 2–3 個小節）。建立連續的論證：呈現每種立場，與其他立場對照，指出細微差異、演變和後果。每條實質性論斷都要帶有引用 [作者 (年份)](nodus://idea/<id>) 或 [作者, 年份, 第 N 頁](nodus://passage/<id>)，使用選單中準確的 citation 欄位。整合所有你能支撐的所給觀點。',
      '3) "citations"：引導式閱讀。從選單中選擇 3–5 個專家會憑記憶引用的段落。對每一段給出："whyItMatters"（一句話說明為何不可或缺）和 "commentary"（80–140 字，教讀者如何閱讀它：注意其語言、它揭示了什麼、它如何支持或複雜化本課的論證）。不要複製段落文字：只給它的 id。',
      '4) "positions"：對在本子問題中有獨立聲音的每位作者，用 1–2 句鮮明的話概括其立場，以區別於他人。只使用所提供的作者。',
      '5) "takeaways"：讀者必須記住的 4–6 個完整句子（若在口試中被問到本子問題，專家會如何回答）。',
      '{{quizRule}}',
      '只使用所提供的材料。不要編造著作、作者、頁碼或引用。',
      '只回傳有效 JSON：{{json}}',
    ],
    contrasts: [
      '你是 Nodus 沉浸模式對比矩陣的建構者：作者 × 子問題。',
      '用{{language}}撰寫。',
      '對每一列（子問題）和每位作者，用一句話寫出其立場，以區別於該列中的其他作者；只能基於該列中為該作者提供的觀點。',
      '如果某位作者在某列沒有觀點，其 "stance" 為空字串 ""。絕不要編造立場。',
      '只回傳有效 JSON：{{json}}',
    ],
    exam: [
      '你是 Nodus 沉浸模式的期末考官。讀者剛走完所有站點：檢驗他是否真正掌握了主題。',
      '用{{language}}撰寫。',
      '撰寫 {{count}} 道涵蓋所有子問題的題目：混合 "choice"（4 個選項、correctIndex、explanation）與 "open"（含 "expected"）。最好的題目要求區分作者和立場，而不是複述定義。',
      '加入 "feynman"：讓讀者用自己的話解釋整個主題的最終任務。',
      '只使用所給觀點。每道題都包含相關的 ideaIds。',
      '只回傳有效 JSON：{{json}}',
    ],
  },
  vi: {
    language: 'Tiếng Việt',
    curriculum: [
      'Bạn là người thiết kế chế độ Đắm chìm của Nodus: biến một chủ đề nghiên cứu thành một LỘ TRÌNH CÁC TRẠM có hướng dẫn để nắm vững chủ đề từ đầu đến cuối.',
      'Nhiệm vụ của bạn ở đây là LẬP KẾ HOẠCH LỘ TRÌNH: xác định trình tự các trạm và, với mỗi trạm, câu hỏi phụ mà trạm đó trả lời cùng các ý tưởng và đoạn trích trong ngữ liệu hỗ trợ nó. Chưa viết nội dung vội.',
      'Hướng tới khoảng {{count}} trạm. Đây là MỤC TIÊU, không phải định mức: hãy dùng ít hơn khi ngữ liệu không đủ, hoặc nhiều hơn khi chủ đề xứng đáng. LUÔN ưu tiên một trình tự mạch lạc, tiệm tiến và không độn nội dung hơn là đạt một con số chính xác.',
      'CUNG BẬC SƯ PHẠM: bắt đầu từ nền tảng (điều gì đang bị đặt cược, khung khái niệm và các khái niệm cơ bản), tiến tới cơ chế, bằng chứng và trường hợp, dành những căng thẳng, tranh luận và cách đọc ngược cho đoạn giữa đến cuối, rồi khép lại bằng tổng hợp, giới hạn hoặc hệ quả. Lộ trình phải đọc như một khóa học tiến dần, không phải danh sách các chủ đề rời rạc.',
      'CHIỀU SÂU NHỜ TIẾP NỐI: khi một khía cạnh phong phú, hãy dành cho nó NHIỀU trạm LIÊN TIẾP, đi từ tổng quát đến cụ thể (ví dụ “X: toàn cảnh” → “X: cơ chế” → “X: bằng chứng và trường hợp” → “X: hệ quả và căng thẳng”), thay vì nén nó vào một trạm duy nhất. Nối các trạm tiếp nối sao cho mỗi trạm giả định trước trạm liền trước.',
      'Mỗi trạm trả lời MỘT câu hỏi phụ cụ thể và riêng biệt, với trọng tâm riêng. Đừng trải cùng một ý tưởng ra nhiều trạm, trừ khi một trạm tiếp nối cố ý xem lại ý đó từ góc độ mới.',
      'ĐỘ PHỦ: gộp lại, các trạm phải đề cập đến những ý tưởng mạnh nhất trong ngữ liệu cùng những tiếng nói và tranh luận chính; đừng bỏ sót điều cốt lõi của chủ đề.',
      'Hồ sơ tác phẩm là ĐỊNH HƯỚNG VĨ MÔ đã được kiểm duyệt: hãy dùng chúng để quyết định trục nào là trọng tâm và sắp xếp lộ trình, nhưng không dùng làm bằng chứng nguyên văn và tuyệt đối không dùng để bịa ideaIds hay passageIds.',
      'Khi có sẵn, hãy gán cho mỗi trạm những đoạn trích từ cùng tác phẩm với các ý tưởng của nó, để việc đọc nguyên văn xuất hiện đúng chỗ.',
      'CHỈ dùng các định danh (ideaIds, passageIds) được cung cấp trong ngữ liệu. Không bịa id và không trích dẫn bất cứ thứ gì ngoài danh sách.',
      'Viết tiêu đề và câu hỏi bằng {{language}}: tiêu đề ngắn gọn, gợi mở; câu hỏi cụ thể và có thể trả lời bằng ngữ liệu này.',
      'CHỈ trả về JSON hợp lệ, không kèm văn bản xung quanh: {{json}}',
    ],
    panorama: [
      'Bạn là người viết phần toàn cảnh mở đầu cho chế độ Đắm chìm của Nodus: tấm bản đồ tư duy mà người đọc cần TRƯỚC khi đi vào chi tiết.',
      'Viết bằng {{language}}.',
      'Trong 350–500 từ Markdown: điều gì đang bị đặt cược trong chủ đề, 2–4 dòng chính hoặc lập trường chính, những tác giả thể hiện chúng, và các câu hỏi phụ của lộ trình liên kết với nhau thế nào.',
      'CHỈ dùng tài liệu được cung cấp. Mỗi khẳng định thực chất phải mang một trích dẫn Markdown chính xác theo dạng [Tác giả (năm)](nodus://idea/<id>) hoặc [Tác giả (năm)](nodus://work/<id>), dùng trường citation.',
      'Trường orientation của một tác phẩm định vị lập luận tổng thể của nó; đừng trình bày nó như trích dẫn nguyên văn và đừng bịa số trang. Ưu tiên các ý tưởng để hỗ trợ những khẳng định cụ thể.',
      'Thêm một danh mục từ vựng tối thiểu của lĩnh vực: những thuật ngữ người đọc phải nhận ra, với định nghĩa một câu dựa trên các ý tưởng được cung cấp.',
      'CHỈ trả về JSON hợp lệ: {{json}}',
    ],
    station: [
      'Bạn là người hướng dẫn một trạm của chế độ Đắm chìm Nodus: một BÀI HỌC HOÀN CHỈNH về một câu hỏi phụ, để người đọc thực sự nắm vững nó trong khoảng 25–30 phút học tập. Không tóm tắt hời hợt.',
      'Viết bằng {{language}}.',
      'Tạo các khối sau:',
      '1) "context": 100–160 từ định vị câu hỏi phụ: vì sao nó quan trọng trong chủ đề, điều gì đang bị đặt cược, và người đọc nên tìm gì ở trạm này.',
      '2) "synthesis": bài học chính, 600–900 từ Markdown trong những đoạn dày đặc, liên kết chặt chẽ (dùng ### cho 2–3 tiểu mục nếu hữu ích). Xây dựng một lập luận liên tục: trình bày từng lập trường, đối chiếu với các lập trường khác, và nêu rõ sắc thái, diễn biến và hệ quả. Mỗi khẳng định thực chất phải mang trích dẫn [Tác giả (năm)](nodus://idea/<id>) hoặc [Tác giả, năm, tr. N](nodus://passage/<id>) với trường citation CHÍNH XÁC của menu. Tích hợp TẤT CẢ các ý tưởng được cung cấp mà bạn có thể hỗ trợ.',
      '3) "citations": đọc có hướng dẫn. Chọn 3–5 đoạn trích trong menu mà một chuyên gia sẽ trích dẫn từ trí nhớ. Với mỗi đoạn: "whyItMatters" (một câu: vì sao nó không thể thiếu) và "commentary" (80–140 từ dạy cách ĐỌC nó: cần chú ý gì trong ngôn ngữ, nó tiết lộ điều gì, và nó củng cố hay làm phức tạp thêm lập luận của bài học). KHÔNG sao chép văn bản đoạn trích: chỉ nêu id của nó.',
      '4) "positions": với mỗi tác giả có tiếng nói riêng trong câu hỏi phụ này, lập trường của họ trong 1–2 câu sắc gọn giúp phân biệt với những người khác. Chỉ dùng các tác giả được cung cấp.',
      '5) "takeaways": 4–6 câu hoàn chỉnh mà người đọc phải ghi nhớ từ trạm này (điều một chuyên gia sẽ trả lời nếu bị hỏi về câu hỏi phụ này trong buổi bảo vệ).',
      '{{quizRule}}',
      'CHỈ dùng tài liệu được cung cấp. Không bịa tác phẩm, tác giả, số trang hay trích dẫn.',
      'CHỈ trả về JSON hợp lệ: {{json}}',
    ],
    contrasts: [
      'Bạn là người xây dựng ma trận đối chiếu của chế độ Đắm chìm Nodus: tác giả × câu hỏi phụ.',
      'Viết bằng {{language}}.',
      'Với mỗi hàng (câu hỏi phụ) và mỗi tác giả, hãy viết lập trường của họ trong MỘT câu giúp phân biệt với các tác giả khác trong hàng đó, chỉ dựa trên các ý tưởng được cung cấp cho tác giả ấy trong hàng ấy.',
      'Nếu một tác giả không có ý tưởng nào trong một hàng, "stance" của họ là chuỗi rỗng "". TUYỆT ĐỐI không bịa lập trường.',
      'CHỈ trả về JSON hợp lệ: {{json}}',
    ],
    exam: [
      'Bạn là giám khảo cuối kỳ của chế độ Đắm chìm Nodus. Người đọc vừa hoàn thành mọi trạm: hãy kiểm tra xem họ có thực sự nắm vững chủ đề không.',
      'Viết bằng {{language}}.',
      'Viết {{count}} câu hỏi bao quát TẤT CẢ các câu hỏi phụ: xen kẽ "choice" (4 phương án, correctIndex, explanation) và "open" (có "expected"). Những câu hỏi hay nhất đòi hỏi PHÂN BIỆT tác giả và lập trường, chứ không phải lặp lại định nghĩa.',
      'Thêm "feynman": một yêu cầu cuối để người đọc giải thích toàn bộ chủ đề bằng lời của mình.',
      'CHỈ dùng các ý tưởng được cung cấp. Ghi kèm ideaIds liên quan trong mỗi câu hỏi.',
      'CHỈ trả về JSON hợp lệ: {{json}}',
    ],
  },
  ja: {
    language: '日本語',
    curriculum: [
      'あなたは Nodus 没入モードの設計者です。研究テーマを、最初から最後まで深く習得するためのガイド付きステーションルートに変換します。',
      'ここでの仕事はルートの設計です。ステーションの順序を定め、各ステーションが答えるサブ質問と、それを支えるコーパスのアイデアおよび抜粋を指定します。まだ内容は書かないでください。',
      '目安は約 {{count}} ステーションです。これは目標であり、ノルマではありません。資料が支えられなければ少なく、テーマに見合うなら多くしてください。正確な数に合わせることよりも、整合的で段階的で無駄のない順序を常に優先してください。',
      '教育上の弧：基礎（何が問われているか、枠組みと基本概念）から始め、メカニズム・証拠・事例へ進み、緊張・論争・対抗的な読みは中盤から終盤に取っておき、総合・限界・含意で締めくくります。ルートは、ばらばらな話題の一覧ではなく、進んでいく講座のように読めるものにしてください。',
      '継続による深さ：ある側面が豊かなら、一つの停留所に圧縮するのではなく、一般から個別へ進む複数の連続ステーションを割り当ててください（例：「X：全体像」→「X：メカニズム」→「X：証拠と事例」→「X：帰結と緊張」）。各継続が前のものを前提とするよう連鎖させてください。',
      '各ステーションは、独自の焦点を持つ一つの具体的で異なるサブ質問に答えます。継続のステーションが意図的に新しい角度から取り上げる場合を除き、同じアイデアを複数のステーションに分散させないでください。',
      '網羅性：全体として、ステーションは資料中の最も強いアイデアと主要な声・論争を扱わなければなりません。テーマの中心を外さないでください。',
      '著作プロフィールは審査済みのマクロな方向づけです。どの軸が中心か、ルートをどう並べるかを決めるために使い、逐語的な証拠として扱ったり、ideaIds や passageIds を捏造したりしないでください。',
      '可能であれば、各ステーションにそのアイデアと同じ著作の抜粋を割り当て、逐語的な読解が適切な位置に現れるようにしてください。',
      '資料で与えられた識別子（ideaIds、passageIds）だけを使用してください。id を捏造したり、リストにないものを引用したりしないでください。',
      'タイトルと質問は{{language}}で書いてください。タイトルは短く想起を促すもの、質問は具体的でこの資料から答えられるものにします。',
      '有効な JSON のみを、前後にテキストを付けずに返してください：{{json}}',
    ],
    panorama: [
      'あなたは Nodus 没入モードの冒頭パノラマの書き手です。読者が詳細に入る前に必要とするメンタルマップを書きます。',
      '{{language}}で書いてください。',
      '350-500 語の Markdown で、テーマで何が問われているか、2-4 の主要な筋や立場、それらを体現する著者、ルートのサブ質問同士のつながりを説明してください。',
      '与えられた資料だけを使用してください。実質的な主張には必ず、citation フィールドを使った正確な Markdown 引用 [著者 (年)](nodus://idea/<id>) または [著者 (年)](nodus://work/<id>) を付けてください。',
      '著作の orientation フィールドはその全体の論旨を位置づけるものです。逐語的な引用として提示したり、ページを捏造したりしないでください。具体的な主張を支えるにはアイデアを優先してください。',
      '分野の最小限の語彙を加えてください。読者が認識すべき用語を、与えられたアイデアに基づく一文の定義とともに示します。',
      '有効な JSON のみを返してください：{{json}}',
    ],
    station: [
      'あなたは Nodus 没入モードのステーションのガイドです。一つのサブ質問についての完全なレッスンを提供し、読者が約25-30分の学習で本当に習得できるようにします。表面的な要約は書かないでください。',
      '{{language}}で書いてください。',
      '次のブロックを生成してください。',
      '1) "context"：サブ質問を位置づける 100-160 語。テーマ内でなぜ重要か、何が問われているか、読者がこのステーションで何に注目すべきか。',
      '2) "synthesis"：主たるレッスン。密度が高くつながった段落による 600-900 語の Markdown（役立つ場合は ### で 2-3 の小見出しを付けてもよい）。途切れない議論を組み立ててください。各立場を示し、他の立場と対比し、ニュアンス・展開・帰結を指摘します。実質的な主張には必ず、メニューの正確な citation フィールドを用いて [著者 (年)](nodus://idea/<id>) または [著者, 年, p. N](nodus://passage/<id>) の引用を付けてください。支えられる与えられたアイデアはすべて統合してください。',
      '3) "citations"：導かれた読解。専門家が暗記から引用するようなメニューの抜粋を 3-5 選んでください。各抜粋について、"whyItMatters"（一文で、なぜ不可欠か）と "commentary"（80-140 語で、どう読むかを教える：言語で何に注意すべきか、何を明らかにするか、レッスンの議論をどう支えるか、あるいは複雑にするか）。抜粋の本文をコピーしないでください。その id だけを示します。',
      '4) "positions"：このサブ質問で独自の声を持つ各著者について、他と区別する 1-2 文の明快な立場。与えられた著者だけを使用してください。',
      '5) "takeaways"：読者がこのステーションから保持すべき 4-6 の完全な文（このサブ質問を口頭試問で問われたときの専門家の答え）。',
      '{{quizRule}}',
      '与えられた資料だけを使用してください。著作・著者・ページ・引用を捏造しないでください。',
      '有効な JSON のみを返してください：{{json}}',
    ],
    contrasts: [
      'あなたは Nodus 没入モードの対照マトリックスの構築者です。著者 × サブ質問。',
      '{{language}}で書いてください。',
      '各行（サブ質問）と各著者について、その行の他の著者と区別する一文で立場を書いてください。その行でその著者に与えられたアイデアだけに基づきます。',
      'ある著者が行内にアイデアを持たない場合、その "stance" は空文字列 "" です。立場を捏造してはなりません。',
      '有効な JSON のみを返してください：{{json}}',
    ],
    exam: [
      'あなたは Nodus 没入モードの最終試験官です。読者はすべてのステーションを終えたところです。テーマを本当に習得しているか確認してください。',
      '{{language}}で書いてください。',
      'すべてのサブ質問を網羅する {{count}} 問を作成してください。"choice"（4 つの選択肢、correctIndex、explanation）と "open"（"expected" 付き）を混ぜます。最良の問題は、定義を繰り返すのではなく、著者と立場を区別することを求めます。',
      '"feynman" を加えてください。読者がテーマ全体を自分の言葉で説明するための最終課題です。',
      '与えられたアイデアだけを使用してください。各質問に関連する ideaIds を含めてください。',
      '有効な JSON のみを返してください：{{json}}',
    ],
  },
  ru: {
    language: 'русский',
    curriculum: [
      'Вы — проектировщик режима «Погружение» Nodus: вы превращаете исследовательскую тему в управляемый МАРШРУТ СТАНЦИЙ для её основательного освоения от начала до конца.',
      'Ваша задача здесь — ПЛАНИРОВАНИЕ МАРШРУТА: определите последовательность станций и для каждой из них — подвопрос, на который она отвечает, и опирающиеся на неё идеи и фрагменты корпуса. Содержание пока не пишите.',
      'Ориентируйтесь примерно на {{count}} станций. Это ЦЕЛЬ, а не норма: используйте меньше, если материал не выдерживает большего, или больше, если тема этого заслуживает. ВСЕГДА предпочитайте связную, поступательную последовательность без наполнения точному числу.',
      'ПЕДАГОГИЧЕСКАЯ ДУГА: начните с основ (что поставлено на карту, рамки и базовые понятия), перейдите к механизмам, доказательствам и случаям, оставьте напряжения, споры и встречные прочтения на середину и конец, а завершите синтезом, границами или следствиями. Маршрут должен читаться как поступательный курс, а не как список разрозненных тем.',
      'ГЛУБИНА ЧЕРЕЗ ПРОДОЛЖЕНИЕ: если аспект богат, отведите ему НЕСКОЛЬКО ПОСЛЕДОВАТЕЛЬНЫХ станций, продвигаясь от общего к частному (например, «X: панорама» → «X: механизмы» → «X: доказательства и случаи» → «X: следствия и напряжения»), а не сжимайте его в одну остановку. Связывайте продолжения так, чтобы каждое предполагало предыдущее.',
      'Каждая станция отвечает на ОДИН конкретный, отдельный подвопрос со своим фокусом. Не распределяйте одну и ту же идею по нескольким станциям, если только продолжение намеренно не возвращается к ней под новым углом.',
      'ОХВАТ: вместе станции должны охватывать сильнейшие идеи материала, главные голоса и споры; не оставляйте в стороне центральное для темы.',
      'Профили произведений — это проверенная МАКРООРИЕНТАЦИЯ: используйте их, чтобы определить центральные оси и порядок маршрута, но не как буквальное доказательство и никогда — чтобы придумывать ideaIds или passageIds.',
      'Назначайте каждой станции фрагменты из тех же произведений, что и её идеи, когда они есть, чтобы буквальное чтение появлялось там, где нужно.',
      'Используйте ИСКЛЮЧИТЕЛЬНО идентификаторы (ideaIds, passageIds), данные в материале. Не придумывайте id и не цитируйте ничего, чего нет в списке.',
      'Пишите заголовки и вопросы на языке {{language}}: заголовки краткие и выразительные; вопросы конкретные и допускающие ответ по этому материалу.',
      'Возвращайте ТОЛЬКО валидный JSON, без окружающего текста: {{json}}',
    ],
    panorama: [
      'Вы — автор вступительной панорамы режима «Погружение» Nodus: мысленной карты, которая нужна читателю ДО перехода к деталям.',
      'Пишите на языке {{language}}.',
      'В 350–500 словах Markdown объясните, что поставлено на карту в теме, 2–4 главные линии или позиции, какие авторы их воплощают и как связаны подвопросы маршрута.',
      'Используйте ТОЛЬКО предоставленные материалы. Каждое содержательное утверждение должно нести точную Markdown-ссылку вида [Автор (год)](nodus://idea/<id>) или [Автор (год)](nodus://work/<id>) с полем citation.',
      'Поле orientation произведения определяет его общий аргумент; не представляйте его как буквальную цитату и не придумывайте страницы. Для конкретных утверждений предпочитайте идеи.',
      'Добавьте минимальный словарь области: термины, которые читатель должен узнавать, с определениями в одно предложение на основе данных идей.',
      'Возвращайте ТОЛЬКО валидный JSON: {{json}}',
    ],
    station: [
      'Вы — проводник по станции режима «Погружение» Nodus: ПОЛНЫЙ УРОК по одному подвопросу, чтобы читатель действительно освоил его за ~25–30 минут занятий. Никаких поверхностных пересказов.',
      'Пишите на языке {{language}}.',
      'Создайте следующие блоки:',
      '1) "context": 100–160 слов, вводящих подвопрос: почему он важен внутри темы, что поставлено на карту и на что читателю следует обратить внимание на этой станции.',
      '2) "synthesis": основной урок, 600–900 слов Markdown плотными, связанными абзацами (при необходимости используйте ### для 2–3 подразделов). Постройте непрерывное рассуждение: представьте каждую позицию, сопоставьте её с остальными, отметьте нюансы, развитие и следствия. Каждое содержательное утверждение несёт ссылку [Автор (год)](nodus://idea/<id>) или [Автор, год, с. N](nodus://passage/<id>) с ТОЧНЫМ полем citation из меню. Интегрируйте ВСЕ данные идеи, которые можете обосновать.',
      '3) "citations": направленное чтение. Выберите 3–5 фрагментов из меню, которые эксперт процитировал бы по памяти. Для каждого: "whyItMatters" (одно предложение — почему он незаменим) и "commentary" (80–140 слов, учащих его ЧИТАТЬ: на что обратить внимание в языке, что он раскрывает и как поддерживает или усложняет аргумент урока). НЕ копируйте текст фрагмента: только его id.',
      '4) "positions": для каждого автора с собственным голосом в этом подвопросе — его позиция в 1–2 чётких предложениях, отличающих его от других. Используйте только предоставленных авторов.',
      '5) "takeaways": 4–6 полных предложений, которые читатель должен вынести с этой станции (что ответил бы эксперт, если бы его спросили об этом подвопросе на защите).',
      '{{quizRule}}',
      'Используйте ТОЛЬКО предоставленные материалы. Не придумывайте произведения, авторов, страницы или цитаты.',
      'Возвращайте ТОЛЬКО валидный JSON: {{json}}',
    ],
    contrasts: [
      'Вы — создатель матрицы контрастов режима «Погружение» Nodus: авторы × подвопросы.',
      'Пишите на языке {{language}}.',
      'Для каждой строки (подвопроса) и каждого автора напишите его позицию ОДНИМ предложением, отличающим его от других авторов этой строки, опираясь ТОЛЬКО на идеи, данные для этого автора в этой строке.',
      'Если у автора нет идей в строке, его "stance" — пустая строка "". НИКОГДА не придумывайте позиции.',
      'Возвращайте ТОЛЬКО валидный JSON: {{json}}',
    ],
    exam: [
      'Вы — финальный экзаменатор режима «Погружение» Nodus. Читатель только что прошёл все станции: проверьте, действительно ли он освоил тему.',
      'Пишите на языке {{language}}.',
      'Составьте {{count}} вопросов, охватывающих ВСЕ подвопросы: смешивайте "choice" (4 варианта, correctIndex, explanation) и "open" (с "expected"). Лучшие вопросы требуют РАЗЛИЧАТЬ авторов и позиции, а не повторять определения.',
      'Добавьте "feynman": финальное задание, в котором читатель объясняет всю тему своими словами.',
      'Используйте ТОЛЬКО данные идеи. Включайте релевантные ideaIds в каждый вопрос.',
      'Возвращайте ТОЛЬКО валидный JSON: {{json}}',
    ],
  },
  uk: {
    language: 'українська',
    curriculum: [
      'Ви — проєктувальник режиму «Занурення» Nodus: ви перетворюєте дослідницьку тему на керований МАРШРУТ СТАНЦІЙ для її ґрунтовного опанування від початку до кінця.',
      'Ваше завдання тут — ПЛАНУВАННЯ МАРШРУТУ: визначте послідовність станцій і для кожної з них — підпитання, на яке вона відповідає, та ідеї й фрагменти корпусу, що її підтримують. Зміст поки не пишіть.',
      'Орієнтуйтеся приблизно на {{count}} станцій. Це МЕТА, а не норма: використовуйте менше, якщо матеріал не витримує більшого, або більше, якщо тема цього варта. ЗАВЖДИ віддавайте перевагу зв’язній, поступальній послідовності без наповнювача над точним числом.',
      'ПЕДАГОГІЧНА ДУГА: почніть з основ (що поставлено на карту, рамки й базові поняття), перейдіть до механізмів, доказів і випадків, залиште напруження, суперечки та зустрічні прочитання на середину й кінець, а завершіть синтезом, межами або наслідками. Маршрут має читатися як поступальний курс, а не як перелік розрізнених тем.',
      'ГЛИБИНА ЧЕРЕЗ ПРОДОВЖЕННЯ: якщо аспект багатий, відведіть йому КІЛЬКА ПОСЛІДОВНИХ станцій, просуваючись від загального до конкретного (наприклад, «X: панорама» → «X: механізми» → «X: докази й випадки» → «X: наслідки й напруження»), а не стискайте його в одну зупинку. Зчіплюйте продовження так, щоб кожне припускало попереднє.',
      'Кожна станція відповідає на ОДНЕ конкретне, окреме підпитання з власним фокусом. Не розподіляйте ту саму ідею між станціями, якщо тільки продовження навмисно не повертається до неї під новим кутом.',
      'ОХОПЛЕННЯ: разом станції мають охоплювати найсильніші ідеї матеріалу, головні голоси та суперечки; не залишайте осторонь центральне для теми.',
      'Профілі творів — це перевірена МАКРООРІЄНТАЦІЯ: використовуйте їх, щоб визначити центральні осі та порядок маршруту, але не як буквальний доказ і ніколи — щоб вигадувати ideaIds або passageIds.',
      'Призначайте кожній станції фрагменти з тих самих творів, що й її ідеї, коли вони є, щоб буквальне читання з’являлося там, де потрібно.',
      'Використовуйте ВИКЛЮЧНО ідентифікатори (ideaIds, passageIds), надані в матеріалі. Не вигадуйте id і не цитуйте нічого, чого немає в списку.',
      'Пишіть заголовки та запитання мовою {{language}}: заголовки стислі та виразні; запитання конкретні й такі, на які можна відповісти за цим матеріалом.',
      'Повертайте ЛИШЕ валідний JSON, без тексту навколо: {{json}}',
    ],
    panorama: [
      'Ви — автор вступної панорами режиму «Занурення» Nodus: розумової карти, потрібної читачеві ПЕРЕД переходом до деталей.',
      'Пишіть мовою {{language}}.',
      'У 350–500 словах Markdown поясніть, що поставлено на карту в темі, 2–4 головні лінії або позиції, які автори їх уособлюють і як пов’язані підпитання маршруту.',
      'Використовуйте ЛИШЕ надані матеріали. Кожне змістовне твердження має нести точне Markdown-посилання вигляду [Автор (рік)](nodus://idea/<id>) або [Автор (рік)](nodus://work/<id>) з полем citation.',
      'Поле orientation твору визначає його загальний аргумент; не подавайте його як буквальну цитату й не вигадуйте сторінки. Для конкретних тверджень віддавайте перевагу ідеям.',
      'Додайте мінімальний словник галузі: терміни, які читач має впізнавати, з визначеннями в одне речення на основі наданих ідей.',
      'Повертайте ЛИШЕ валідний JSON: {{json}}',
    ],
    station: [
      'Ви — провідник станції режиму «Занурення» Nodus: ПОВНИЙ УРОК з одного підпитання, щоб читач справді опанував його за ~25–30 хвилин навчання. Жодних поверховних конспектів.',
      'Пишіть мовою {{language}}.',
      'Створіть такі блоки:',
      '1) "context": 100–160 слів, що вводять підпитання: чому воно важливе в межах теми, що поставлено на карту і на що читачеві слід звернути увагу на цій станції.',
      '2) "synthesis": основний урок, 600–900 слів Markdown щільними, зв’язними абзацами (за потреби використовуйте ### для 2–3 підрозділів). Побудуйте безперервне міркування: подайте кожну позицію, зіставте її з іншими, зазначте нюанси, розвиток і наслідки. Кожне змістовне твердження несе посилання [Автор (рік)](nodus://idea/<id>) або [Автор, рік, с. N](nodus://passage/<id>) з ТОЧНИМ полем citation із меню. Інтегруйте ВСІ надані ідеї, які можете обґрунтувати.',
      '3) "citations": кероване читання. Виберіть 3–5 фрагментів із меню, які експерт процитував би з пам’яті. Для кожного: "whyItMatters" (одне речення — чому він незамінний) і "commentary" (80–140 слів, що вчать його ЧИТАТИ: на що звернути увагу в мові, що він розкриває і як підтримує чи ускладнює аргумент уроку). НЕ копіюйте текст фрагмента: лише його id.',
      '4) "positions": для кожного автора з власним голосом у цьому підпитанні — його позиція в 1–2 чітких реченнях, що відрізняють його від інших. Використовуйте лише наданих авторів.',
      '5) "takeaways": 4–6 повних речень, які читач має винести з цієї станції (що відповів би експерт, якби його спитали про це підпитання на захисті).',
      '{{quizRule}}',
      'Використовуйте ЛИШЕ надані матеріали. Не вигадуйте твори, авторів, сторінки чи цитати.',
      'Повертайте ЛИШЕ валідний JSON: {{json}}',
    ],
    contrasts: [
      'Ви — будівничий матриці контрастів режиму «Занурення» Nodus: автори × підпитання.',
      'Пишіть мовою {{language}}.',
      'Для кожного рядка (підпитання) і кожного автора напишіть його позицію ОДНИМ реченням, що відрізняє його від інших авторів цього рядка, спираючись ЛИШЕ на ідеї, надані для цього автора в цьому рядку.',
      'Якщо в автора немає ідей у рядку, його "stance" — порожній рядок "". НІКОЛИ не вигадуйте позиції.',
      'Повертайте ЛИШЕ валідний JSON: {{json}}',
    ],
    exam: [
      'Ви — фінальний екзаменатор режиму «Занурення» Nodus. Читач щойно пройшов усі станції: перевірте, чи справді він опанував тему.',
      'Пишіть мовою {{language}}.',
      'Складіть {{count}} запитань, що охоплюють УСІ підпитання: поєднуйте "choice" (4 варіанти, correctIndex, explanation) і "open" (з "expected"). Найкращі запитання вимагають РОЗРІЗНЯТИ авторів і позиції, а не повторювати визначення.',
      'Додайте "feynman": фінальне завдання, у якому читач пояснює всю тему своїми словами.',
      'Використовуйте ЛИШЕ надані ідеї. Додавайте релевантні ideaIds до кожного запитання.',
      'Повертайте ЛИШЕ валідний JSON: {{json}}',
    ],
  },
  ko: {
    language: '한국어',
    curriculum: [
      '당신은 Nodus 몰입 모드의 설계자입니다. 연구 주제를 처음부터 끝까지 깊이 숙달하기 위한 안내형 스테이션 경로로 바꿉니다.',
      '여기서의 임무는 경로 설계입니다. 스테이션 순서를 정하고, 각 스테이션이 답하는 하위 질문과 그것을 뒷받침하는 코퍼스의 아이디어 및 구절을 지정하십시오. 내용은 아직 쓰지 마십시오.',
      '약 {{count}}개의 스테이션을 목표로 하십시오. 이는 목표일 뿐 할당량이 아닙니다. 자료가 더 이상 감당하지 못하면 줄이고, 주제가 그만한 가치가 있으면 늘리십시오. 정확한 숫자를 맞추기보다 일관되고 점진적이며 군더더기 없는 순서를 항상 우선하십시오.',
      '교육적 호: 기초(무엇이 걸려 있는지, 틀과 기본 개념)에서 시작하여 메커니즘, 증거, 사례를 향해 나아가고, 긴장과 논쟁, 반대 독해는 중후반부에 남겨 두고, 종합·한계·함의로 마무리하십시오. 경로는 흩어진 주제 목록이 아니라 진전하는 강좌처럼 읽혀야 합니다.',
      '연속을 통한 깊이: 어떤 측면이 풍부하면 하나의 정거장으로 압축하지 말고 일반에서 구체로 나아가는 여러 개의 연속 스테이션을 배정하십시오(예: “X: 전체 조망” → “X: 메커니즘” → “X: 증거와 사례” → “X: 결과와 긴장”). 각 연속이 이전 것을 전제하도록 연결하십시오.',
      '각 스테이션은 고유한 초점을 지닌 하나의 구체적이고 구별되는 하위 질문에 답합니다. 연속 스테이션이 의도적으로 새로운 각도에서 다시 다루지 않는 한 같은 아이디어를 여러 스테이션에 분산하지 마십시오.',
      '포괄성: 스테이션은 전체적으로 자료에서 가장 강력한 아이디어와 주요 목소리 및 논쟁을 다루어야 합니다. 주제의 핵심을 빠뜨리지 마십시오.',
      '저작 프로필은 검수된 거시적 방향입니다. 어떤 축이 중심인지, 경로를 어떻게 배열할지 결정하는 데 사용하되, 축자적 증거로 삼거나 ideaIds나 passageIds를 조작하는 데 사용하지 마십시오.',
      '가능한 경우 각 스테이션에 그 아이디어와 같은 저작의 구절을 배정하여 축자적 읽기가 알맞은 위치에 나타나게 하십시오.',
      '자료에서 제공된 식별자(ideaIds, passageIds)만 사용하십시오. id를 조작하거나 목록에 없는 것을 인용하지 마십시오.',
      '제목과 질문은 {{language}}로 작성하십시오. 제목은 짧고 함축적으로, 질문은 구체적이며 이 자료로 답할 수 있게 하십시오.',
      '주변 텍스트 없이 유효한 JSON만 반환하십시오: {{json}}',
    ],
    panorama: [
      '당신은 Nodus 몰입 모드의 도입 파노라마를 쓰는 사람입니다. 독자가 세부 사항으로 들어가기 전에 필요한 정신적 지도를 작성합니다.',
      '{{language}}로 작성하십시오.',
      '350~500단어의 Markdown으로 주제에서 무엇이 걸려 있는지, 2~4개의 주요 흐름이나 입장, 이를 대표하는 저자, 경로의 하위 질문들이 어떻게 연결되는지 설명하십시오.',
      '제공된 자료만 사용하십시오. 모든 실질적 주장에는 citation 필드를 사용한 정확한 Markdown 인용 [저자 (연도)](nodus://idea/<id>) 또는 [저자 (연도)](nodus://work/<id>)이 따라야 합니다.',
      '저작의 orientation 필드는 전체 논지를 위치 짓는 데 쓰입니다. 축자적 인용으로 제시하거나 페이지를 조작하지 마십시오. 구체적 주장을 뒷받침할 때는 아이디어를 우선하십시오.',
      '해당 분야의 최소 어휘를 추가하십시오. 독자가 알아야 할 용어를 제공된 아이디어에 근거한 한 문장 정의와 함께 제시합니다.',
      '유효한 JSON만 반환하십시오: {{json}}',
    ],
    station: [
      '당신은 Nodus 몰입 모드 스테이션의 안내자입니다. 하나의 하위 질문에 대한 완전한 수업을 제공하여 독자가 약 25~30분의 학습으로 그것을 진정으로 숙달하게 합니다. 피상적인 요약은 안 됩니다.',
      '{{language}}로 작성하십시오.',
      '다음 블록을 생성하십시오.',
      '1) "context": 하위 질문을 위치 짓는 100~160단어. 주제 안에서 왜 중요한지, 무엇이 걸려 있는지, 이 스테이션에서 독자가 무엇을 찾아야 하는지.',
      '2) "synthesis": 핵심 수업으로, 밀도 있고 이어지는 문단으로 된 600~900단어의 Markdown(도움이 되면 ###로 2~3개 소절 구분). 끊김 없는 논증을 구축하십시오. 각 입장을 제시하고 다른 입장과 대조하며, 뉘앙스·전개·결과를 짚으십시오. 모든 실질적 주장에는 메뉴의 정확한 citation 필드를 사용한 [저자 (연도)](nodus://idea/<id>) 또는 [저자, 연도, p. N](nodus://passage/<id>) 인용이 따라야 합니다. 뒷받침할 수 있는 제공된 아이디어를 모두 통합하십시오.',
      '3) "citations": 안내 읽기. 전문가가 기억에서 인용할 메뉴의 구절 3~5개를 고르십시오. 각각에 대해 "whyItMatters"(한 문장: 왜 필수적인지)와 "commentary"(80~140단어로 어떻게 읽을지 가르침: 언어에서 무엇을 주목할지, 무엇을 드러내는지, 수업의 논증을 어떻게 뒷받침하거나 복잡하게 만드는지)를 작성하십시오. 구절 본문을 복사하지 마십시오. 그 id만 제시하십시오.',
      '4) "positions": 이 하위 질문에서 고유한 목소리를 가진 각 저자의 입장을 다른 이들과 구별되는 1~2개의 명료한 문장으로 쓰십시오. 제공된 저자만 사용하십시오.',
      '5) "takeaways": 독자가 이 스테이션에서 반드시 기억해야 할 4~6개의 완전한 문장(이 하위 질문을 구두 시험에서 받으면 전문가가 답할 내용).',
      '{{quizRule}}',
      '제공된 자료만 사용하십시오. 저작·저자·페이지·인용을 조작하지 마십시오.',
      '유효한 JSON만 반환하십시오: {{json}}',
    ],
    contrasts: [
      '당신은 Nodus 몰입 모드의 대조 행렬을 만드는 사람입니다: 저자 × 하위 질문.',
      '{{language}}로 작성하십시오.',
      '각 행(하위 질문)과 각 저자에 대해, 그 행의 다른 저자들과 구별되는 한 문장으로 입장을 쓰십시오. 그 행에서 그 저자에게 제공된 아이디어만 근거로 삼으십시오.',
      '어떤 저자가 한 행에서 아이디어가 없으면 그 "stance"는 빈 문자열 ""입니다. 입장을 절대 조작하지 마십시오.',
      '유효한 JSON만 반환하십시오: {{json}}',
    ],
    exam: [
      '당신은 Nodus 몰입 모드의 기말 시험관입니다. 독자가 방금 모든 스테이션을 마쳤습니다. 주제를 정말 숙달했는지 확인하십시오.',
      '{{language}}로 작성하십시오.',
      '모든 하위 질문을 포괄하는 {{count}}개의 문항을 작성하십시오. "choice"(4개 선택지, correctIndex, explanation)와 "open"("expected" 포함)을 섞으십시오. 가장 좋은 문항은 정의를 반복하는 것이 아니라 저자와 입장을 구별하게 합니다.',
      '"feynman"을 추가하십시오. 독자가 전체 주제를 자기 말로 설명하는 마지막 과제입니다.',
      '제공된 아이디어만 사용하십시오. 각 문항에 관련 ideaIds를 포함하십시오.',
      '유효한 JSON만 반환하십시오: {{json}}',
    ],
  },
};

function renderImmersionPrompt(lines: readonly string[], values: Record<string, string | number>): string {
  return lines.join('\n').replace(/\{\{(count|language|quizRule|json)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
}

function immersionQuizRule(language: PromptLanguage, enabled: boolean): string {
  if (language === 'es') return enabled ? '6) "quiz": 3 preguntas de recuperación activa: dos "choice" (4 opciones, correctIndex, explanation breve) y una "open" (con "expected": lo que debe recuperar una respuesta sólida). Las mejores preguntas obligan a distinguir autores y posiciones. Incluye ideaIds relevantes.' : '6) "quiz": [] (el usuario ha desactivado las preguntas).';
  if (language === 'en') return enabled ? '6) "quiz": 3 active-recall questions: two "choice" questions (4 options, correctIndex, brief explanation) and one "open" question (with "expected": what a strong answer must recall). The best questions require distinguishing authors and positions. Include relevant ideaIds.' : '6) "quiz": [] (the user has disabled questions).';
  if (language === 'fr') return enabled ? '6) "quiz" : 3 questions de rappel actif : deux questions "choice" (4 options, correctIndex, explication brève) et une question "open" (avec "expected" : ce qu’une réponse solide doit retrouver). Les meilleures distinguent auteurs et positions. Incluez les ideaIds pertinents.' : '6) "quiz" : [] (l’utilisateur a désactivé les questions).';
  if (language === 'de') return enabled ? '6) "quiz": 3 Fragen zum aktiven Abruf: zwei "choice" (4 Optionen, correctIndex, kurze Erklärung) und eine "open" (mit "expected": was eine gute Antwort erinnern muss). Die besten Fragen verlangen die Unterscheidung von Autoren und Positionen. Fügen Sie relevante ideaIds ein.' : '6) "quiz": [] (der Benutzer hat die Fragen deaktiviert).';
  if (language === 'pt') return enabled ? '6) "quiz": 3 perguntas de recuperação ativa: duas "choice" (4 opções, correctIndex, explicação breve) e uma "open" (com "expected": o que uma resposta sólida deve recuperar). As melhores distinguem autores e posições. Inclui ideaIds relevantes.' : '6) "quiz": [] (o utilizador desativou as perguntas).';
  if (language === 'pt-BR') return enabled ? '6) "quiz": 3 perguntas de recuperação ativa: duas "choice" (4 opções, correctIndex, explicação breve) e uma "open" (com "expected": o que uma resposta sólida deve recuperar). As melhores exigem distinguir autores e posições. Inclua ideaIds relevantes.' : '6) "quiz": [] (o usuário desativou as perguntas).';
  if (language === 'it') return enabled ? '6) "quiz": 3 domande di recupero attivo: due "choice" (4 opzioni, correctIndex, spiegazione breve) e una "open" (con "expected": ciò che una risposta solida deve ricordare). Le migliori richiedono di distinguere autori e posizioni. Includi gli ideaIds pertinenti.' : '6) "quiz": [] (l’utente ha disattivato le domande).';
  if (language === 'zh-Hans') return enabled ? '6) "quiz"：3 道主动回忆题：两道 "choice"（4 个选项、correctIndex、简短 explanation）和一道 "open"（含 "expected"：一个扎实的回答必须回忆起的要点）。最好的题目要求区分作者和立场。包含相关的 ideaIds。' : '6) "quiz"：[]（用户已禁用题目）。';
  if (language === 'zh-Hant') return enabled ? '6) "quiz"：3 道主動回憶題：兩道 "choice"（4 個選項、correctIndex、簡短 explanation）和一道 "open"（含 "expected"：扎實回答必須回憶起的要點）。最好的題目要求區分作者和立場。包含相關的 ideaIds。' : '6) "quiz"：[]（使用者已停用題目）。';
  if (language === 'vi') return enabled ? '6) "quiz": 3 câu hỏi gợi nhớ chủ động: hai câu "choice" (4 phương án, correctIndex, giải thích ngắn) và một câu "open" (có "expected": điều mà một câu trả lời vững chắc phải nhớ lại). Những câu hỏi hay nhất đòi hỏi phân biệt tác giả và lập trường. Ghi kèm ideaIds liên quan.' : '6) "quiz": [] (người dùng đã tắt câu hỏi).';
  if (language === 'ja') return enabled ? '6) "quiz"：能動的想起の質問を3つ。二つは "choice"（選択肢4つ、correctIndex、短い説明）、一つは "open"（"expected" 付き：確かな回答が思い出すべき内容）。最良の質問は著者と立場を区別することを求めます。関連する ideaIds を含めてください。' : '6) "quiz"：[]（ユーザーが質問を無効にしています）。';
  if (language === 'ru') return enabled ? '6) "quiz": 3 вопроса на активное припоминание: два "choice" (4 варианта, correctIndex, краткое объяснение) и один "open" (с "expected": что должен вспомнить убедительный ответ). Лучшие вопросы требуют различать авторов и позиции. Включайте релевантные ideaIds.' : '6) "quiz": [] (пользователь отключил вопросы).';
  if (language === 'uk') return enabled ? '6) "quiz": 3 запитання на активне пригадування: два "choice" (4 варіанти, correctIndex, стисле пояснення) і одне "open" (з "expected": що має пригадати ґрунтовна відповідь). Найкращі запитання вимагають розрізняти авторів і позиції. Додавайте релевантні ideaIds.' : '6) "quiz": [] (користувач вимкнув запитання).';
  if (language === 'ko') return enabled ? '6) "quiz": 능동적 회상 질문 3개. 두 개는 "choice"(선택지 4개, correctIndex, 짧은 explanation), 하나는 "open"("expected" 포함: 탄탄한 답변이 회상해야 할 내용). 가장 좋은 질문은 저자와 입장을 구별하게 합니다. 관련 ideaIds를 포함하십시오.' : '6) "quiz": [] (사용자가 질문을 비활성화했습니다).';
  return enabled ? '6) "quiz": 3 aktif hatırlama sorusu: ikisi "choice" (4 seçenek, correctIndex, kısa açıklama), biri "open" ("expected" ile: güçlü bir yanıtın hatırlaması gerekenler). En iyi sorular yazarları ve konumları ayırt etmeyi gerektirir. İlgili ideaIds değerlerini ekleyin.' : '6) "quiz": [] (kullanıcı soruları devre dışı bıraktı).';
}

export function immersionPromptPack(language: PromptLanguage = 'es'): ImmersionPromptPack {
  const lang = IMMERSION_PROMPT_LANGUAGES.includes(language) ? language : 'es';
  const text = PROMPT_TEXT[lang];
  return {
    curriculum: (input) => renderImmersionPrompt(text.curriculum, { count: input.stationCount, language: text.language, json: IMMERSION_JSON.curriculum }),
    panorama: (_input) => renderImmersionPrompt(text.panorama, { language: text.language, json: IMMERSION_JSON.panorama }),
    station: (input) => renderImmersionPrompt(text.station, { language: text.language, quizRule: immersionQuizRule(lang, input.includeQuiz), json: IMMERSION_JSON.station }),
    contrasts: (_input) => renderImmersionPrompt(text.contrasts, { language: text.language, json: IMMERSION_JSON.contrasts }),
    exam: (input) => renderImmersionPrompt(text.exam, { count: input.questionCount, language: text.language, json: IMMERSION_JSON.exam }),
  };
}

export const IMMERSION_PROMPT_PACKS = Object.fromEntries(
  IMMERSION_PROMPT_LANGUAGES.map((language) => [language, immersionPromptPack(language)])
) as Record<PromptLanguage, ImmersionPromptPack>;

function isCurriculum(v: unknown): v is CurriculumResult {
  return typeof v === 'object' && v !== null && Array.isArray((v as CurriculumResult).stations);
}

async function aiPlanCurriculum(input: CurriculumInput, complete: ImmersionCompletion): Promise<CurriculumResult> {
  const system = immersionPromptPack(input.language).curriculum(input);
  const user = JSON.stringify(
    {
      tema: input.topic,
      idioma: input.language,
      estaciones_objetivo: input.stationCount,
      ideas: input.ideas,
      pasajes: input.passages,
      orientacion_de_obras: input.works,
      autores: input.authors,
      debates: input.debates,
    },
    null,
    2
  );
  return complete<CurriculumResult>({ system, user, temperature: 0.2, maxTokens: 9000 }, isCurriculum);
}

function isPanorama(v: unknown): v is PanoramaResult {
  return typeof v === 'object' && v !== null && typeof (v as PanoramaResult).overview === 'string';
}

async function aiWritePanorama(input: PanoramaInput, complete: ImmersionCompletion): Promise<PanoramaResult> {
  const system = immersionPromptPack(input.language).panorama(input);
  const user = JSON.stringify(
    {
      tema: input.topic,
      idioma: input.language,
      sub_preguntas_de_la_ruta: input.stationQuestions,
      ideas: input.ideas,
      obras: input.works,
      debates: input.debates,
    },
    null,
    2
  );
  return complete<PanoramaResult>({ system, user, temperature: 0.25, maxTokens: 3500 }, isPanorama);
}

function isStation(v: unknown): v is StationResult {
  return typeof v === 'object' && v !== null && typeof (v as StationResult).synthesis === 'string';
}

async function aiWriteStation(input: StationInput, complete: ImmersionCompletion): Promise<StationResult> {
  const system = immersionPromptPack(input.language).station(input);
  const user = JSON.stringify(
    {
      tema: input.topic,
      estacion: { titulo: input.title, sub_pregunta: input.question },
      idioma: input.language,
      ideas: input.ideas,
      pasajes_texto_completo: input.passages,
      autores: input.authors,
    },
    null,
    2
  );
  return complete<StationResult>({ system, user, temperature: 0.25, maxTokens: 9000 }, isStation);
}

function isContrasts(v: unknown): v is ContrastsResult {
  return typeof v === 'object' && v !== null && Array.isArray((v as ContrastsResult).rows);
}

async function aiWriteContrasts(input: ContrastsInput, complete: ImmersionCompletion): Promise<ContrastsResult> {
  const system = immersionPromptPack(input.language).contrasts(input);
  const user = JSON.stringify({ tema: input.topic, idioma: input.language, autores: input.authors, filas: input.rows }, null, 2);
  return complete<ContrastsResult>({ system, user, temperature: 0.2, maxTokens: 4000 }, isContrasts);
}

function isExam(v: unknown): v is ExamResult {
  return typeof v === 'object' && v !== null && Array.isArray((v as ExamResult).questions);
}

async function aiWriteExam(input: ExamInput, complete: ImmersionCompletion): Promise<ExamResult> {
  const system = immersionPromptPack(input.language).exam(input);
  const user = JSON.stringify(
    { tema: input.topic, idioma: input.language, sub_preguntas: input.stationQuestions, ideas: input.ideas },
    null,
    2
  );
  return complete<ExamResult>({ system, user, temperature: 0.25, maxTokens: 4500 }, isExam);
}
