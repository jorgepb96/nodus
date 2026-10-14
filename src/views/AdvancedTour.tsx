import type { View } from '../navigation';
import { TourOverlay } from './tourEngine';

export interface AdvancedTourStep {
  /** A `data-tour="…"` value to spotlight. Omit for a centered, target-less step. */
  target?: string;
  /** Short eyebrow shown above the title (the workflow stage). */
  stage: string;
  title: string;
  body: string;
  /** Switch the app to this view before showing the step. */
  view?: View;
}

/**
 * Advanced, workflow-oriented walkthrough. Where {@link Tour} teaches the
 * mechanics (sync, scan, the graph), this tour follows the *arc of a research
 * project*: read with criterion → understand the corpus → find your contribution
 * → plan, converse, and write. It deliberately avoids repeating the basics and
 * is opt-in: launched from Settings, never auto-shown.
 *
 * The shared guide points at live view controls while the workflow explains
 * *when* to reach for each view, not about hunting a single button.
 */
const STEPS: AdvancedTourStep[] = [
  {
    stage: 'Flujo de investigación',
    title: 'De la biblioteca al manuscrito',
    body: 'Este recorrido avanzado asume que ya sabes escanear obras y moverte por el grafo. Ahora veremos cómo encadenar las vistas de Nodus para reproducir el ciclo real de una investigación: leer con criterio, comprender el corpus, encontrar tu aportación y escribir. Unos tres minutos; puedes salir cuando quieras.',
  },
  {
    stage: 'Paso 1 · Leer con criterio',
    view: 'library',
    title: 'Primero lee; luego deja que Nodus lea contigo',
    body: 'Nada sustituye tu lectura crítica de las fuentes. Marca como leídas las obras que ya dominas y lanza el «análisis profundo» sobre ellas: Nodus extrae temas, ideas y la evidencia textual que las sostiene. La regla de oro: solo confías en una idea del grafo cuando has visto su cita de origen.',
  },
  {
    stage: 'Paso 1 · Leer con criterio',
    view: 'ideas',
    title: 'Verifica cada idea contra su evidencia',
    body: 'En Ideas revisas, una a una, las afirmaciones que la IA ha destilado de tus lecturas. Abre el detalle de una idea para leer su evidencia y la cita exacta de la obra: así contrastas si la lectura automática coincide con la tuya. Corregir aquí tu criterio es lo que da fiabilidad a todo lo que viene después.',
  },
  {
    stage: 'Paso 2 · Comprender el corpus',
    view: 'graph',
    title: 'El Tutor te guía por el grafo',
    body: 'Cuando tengas decenas de ideas, no las leas en desorden. Activa el modo Tutor sobre el grafo: una IA de contexto largo traza recorridos —completos o a medida desde un objetivo— y te explica las ideas y sus conexiones paso a paso, como un colega que te pone al día del estado del arte sobre tu propio mapa.',
  },
  {
    stage: 'Paso 2 · Comprender el corpus',
    view: 'graph',
    title: 'Mantén el grafo limpio: fusiona duplicados',
    body: 'Tras escanear muchas obras, una misma idea puede aparecer repetida con etiquetas casi iguales e inflar el grafo. Desde Grafo → Ideas → «Duplicados», Nodus agrupa las ideas idénticas, te deja elegir cuál conservar y las fusiona sin pérdida —consolidando su evidencia y sus conexiones— tras crear una copia de seguridad automática. Un grafo más limpio se lee y se razona mejor.',
  },
  {
    stage: 'Paso 2 · Comprender el corpus',
    view: 'authors',
    title: 'Autores: quién sostiene cada idea',
    body: 'Cambia el foco de las ideas a las voces. En Autores tienes una ficha por autor —su tesis, qué aporta y cómo se posiciona— y una matriz de síntesis que cruza autores con temas para ver de un vistazo quién defiende qué. Es la forma de mapear escuelas, alianzas y disidencias antes de situar tu propia voz.',
  },
  {
    stage: 'Paso 2 · Comprender el corpus',
    view: 'argument',
    title: 'Reconstruye la arquitectura de un argumento',
    body: 'Elige una idea central y traza su mapa de argumentos: por conectividad (sin IA, siguiendo las aristas) o dejando que la IA dibuje el esquema de premisas y conclusiones. Es la forma de pasar de «qué dicen las fuentes» a «cómo razonan», y de detectar saltos lógicos antes de apoyarte en ellos.',
  },
  {
    stage: 'Paso 3 · Encontrar tu aportación',
    view: 'gaps',
    title: 'Huecos y contradicciones: tu oportunidad',
    body: 'Aquí Nodus señala preguntas abiertas, limitaciones declaradas y tensiones entre fuentes. No son errores: son los espacios donde cabe una contribución original. Un buen objeto de investigación suele nacer de un hueco bien delimitado o de una contradicción que nadie ha resuelto. Marca los que conecten con tu interés.',
  },
  {
    stage: 'Paso 3 · Encontrar tu aportación',
    view: 'debate',
    title: 'Debates: la estructura de una contradicción',
    body: 'Cada relación de contradicción o refutación se despliega como un debate de dos bandos con sus autores, evidencias y cronología. Pides una síntesis al modelo para entender la tensión y decides cómo tu trabajo puede resolverla o aprovecharla.',
  },
  {
    stage: 'Paso 3 · Encontrar tu aportación',
    view: 'research',
    title: 'Mapa de cobertura: tu pregunta descompuesta',
    body: 'Escribe tu pregunta de investigación y Nodus la desglosa en subpreguntas. Después mapea cuáles cubre tu corpus, cuáles parcialmente y cuáles quedan sin literatura. Es la herramienta para convertir una intuición vaga en un plan de búsqueda estructurado.',
  },
  {
    stage: 'Paso 3 · Encontrar tu aportación',
    view: 'hypothesis',
    title: 'Laboratorio de hipótesis: del hueco a una proposición contrastable',
    body: 'Aquí Nodus toma tus huecos, ideas y debates y propone hipótesis de investigación comprobables: cada candidata trae sus variables, métodos posibles, predicciones, objeciones y próximos pasos, siempre anclada a la evidencia de tu corpus. Es el puente entre «he detectado un hueco» y «esta es la afirmación que voy a defender».',
  },
  {
    stage: 'Paso 4 · Planificar',
    view: 'reading',
    title: 'Una ruta de lectura a la medida de tu pregunta',
    body: 'Describe tu pregunta, tus objetivos y tus prioridades, y Nodus ordena qué leer y en qué fase, justificando cada elección. Úsalo para cerrar los huecos que acabas de identificar: convierte la intuición «me falta base sobre X» en un plan de lectura concreto y priorizado.',
  },
  {
    stage: 'Paso 5 · Dialogar',
    title: 'El Asistente, anclado en tu corpus',
    body: 'Abre el Asistente (arriba a la derecha) para conversar con una IA que solo razona sobre tus fuentes, no sobre internet. Elige el contexto que le das —ideas, contradicciones, ruta de lectura, autores, el grafo entero— y pon a prueba hipótesis, pide síntesis o redacta argumentos. Cada respuesta es trazable hasta tus obras.',
  },
  {
    stage: 'Paso 6 · Escribir',
    view: 'workspace',
    title: 'Nodus Scriptor',
    body: 'Redacta, organiza y revisa artículos, tesis, notas y documentos.',
  },
  {
    stage: 'Paso 6 · Escribir',
    view: 'deepResearch',
    title: 'Deep Research: un informe citado de principio a fin',
    body: 'Deep Research es su propia sección: orquesta un informe extenso y multi-apartado sobre una pregunta —planifica las secciones, reúne la evidencia de tu corpus y redacta con citas comprobables—. Ideal cuando necesitas un estado de la cuestión sólido y trazable, no solo un párrafo suelto.',
  },
  {
    stage: 'El ciclo se repite',
    view: 'home',
    title: 'Inicio: tu panel de mando',
    body: 'Inicio resume el estado de tu corpus, los análisis pendientes y el siguiente paso recomendado. La investigación es iterativa: escaneas más obras, vuelven a aparecer ideas y huecos, refinas la ruta y el borrador. Vuelve aquí entre vueltas. Puedes relanzar este recorrido desde Ajustes → Ayuda.',
  },
];

export function AdvancedTour({ onClose, onNavigate }: { onClose: () => void; onNavigate: (v: View) => void }) {
  return <TourOverlay steps={STEPS} label="Tutorial avanzado" showUnavailableVideo={false} onClose={onClose} onNavigate={view => onNavigate(view as View)} />;
}
