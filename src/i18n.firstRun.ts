/**
 * First-run copy: the "bring your sources" start screen, the Zotero connection notice,
 * the embedding choice, the quick-start recovery reminder and the "stuck?" nudge.
 *
 * Kept as a feature slice (see i18n.backups.ts) so the whole first-run flow can be read
 * and changed in one place. Spanish is the source language and the key.
 */
export const FIRST_RUN_TRANSLATIONS: Record<'en' | 'fr' | 'de' | 'pt' | 'pt-BR' | 'it' | 'tr' | 'zh-CN' | 'zh-TW' | 'ja' | 'ko', Record<string, string>> = {
  en: {
    "{collections} colección(es) seleccionada(s), con sus subcolecciones. Nodus prepara primero unas pocas obras para que puedas probarlo ya.":
      "{collections} collection(s) selected, with their subcollections. Nodus prepares a few works first so you can try it right away.",
    "{n} obra(s) · {m} subcolección(es)":
      "{n} work(s) · {m} subcollection(s)",
    "{m} subcolección(es)":
      "{m} subcollection(s)",
    "{n} obra(s)":
      "{n} work(s)",
    "Ver subcolecciones de {name}":
      "Show subcollections of {name}",
    "No se pudieron leer las subcolecciones. Puedes marcar la colección completa.":
      "The subcollections could not be read. You can tick the whole collection.",
    "Nodus lo comprueba solo cada pocos segundos y este aviso cambiará en cuanto Zotero responda.":
      "Nodus checks by itself every few seconds, and this notice will change as soon as Zotero answers.",
    "Tu trabajo se guarda en {folder}, con copias cifradas automáticas. Guarda tu kit de recuperación para poder restaurarlo en otro ordenador.":
      "Your work is stored in {folder}, with automatic encrypted backups. Save your recovery kit so you can restore it on another computer.",
    "¿Te has atascado? Todavía no hay ninguna fuente en esta bóveda. Podemos retomar los primeros pasos, o puedes contarnos qué te ha frenado.":
      "Stuck? This vault has no sources yet. We can pick up the first steps again, or you can tell us what got in the way.",
    "Retomar los primeros pasos":
      "Pick up the first steps",
    "Contar qué me ha frenado":
      "Tell us what got in the way",
    "Conecta tu proveedor de IA":
      "Connect your AI provider",
    "Conecta primero un proveedor.":
      "Connect a provider first.",
    "Búsqueda en tus fuentes":
      "Search in your sources",
    "Para encontrar el pasaje exacto, Nodus prepara un índice de tus textos (embeddings). Elige dónde se calcula.":
      "To find the exact passage, Nodus builds an index of your texts (embeddings). Choose where it is computed.",
    "En este equipo":
      "On this computer",
    "Con un servicio externo (API)":
      "With an external service (API)",
    "Gratis y privado: tus textos no salen del ordenador. La primera vez descarga el modelo elegido, de unos cientos de MB.":
      "Free and private: your texts never leave the computer. The first time, it downloads the chosen model, a few hundred MB.",
    "No descarga nada y es rápido en cualquier equipo. Usa la clave de tu proveedor y tiene un coste pequeño.":
      "Nothing to download and fast on any computer. It uses your provider’s key and has a small cost.",
    "Ninguno de tus proveedores conectados ofrece este servicio. Lo ofrecen {list}: conecta uno de ellos, o elige «En este equipo».":
      "None of your connected providers offers this service. {list} do: connect one of them, or choose “On this computer”.",
    "No se ha encontrado ningún modelo en este equipo.":
      "No model was found on this computer.",
    "Buscando Zotero…":
      "Looking for Zotero…",
    "Zotero ha respondido con un error":
      "Zotero answered with an error",
    "Zotero no está conectado ahora mismo":
      "Zotero is not connected right now",
    "Nodus todavía no puede leer tu Zotero":
      "Nodus cannot read your Zotero yet",
    "Abre Zotero en este ordenador (versión 7 o posterior).":
      "Open Zotero on this computer (version 7 or later).",
    "En Zotero, ve a Ajustes → Avanzado y marca «Permitir que otras aplicaciones de este ordenador se comuniquen con Zotero».":
      "In Zotero, go to Settings → Advanced and tick “Allow other applications on this computer to communicate with Zotero”.",
    "No necesitas el plugin «Nodus for Zotero» para importar tu biblioteca: el plugin es un chat dentro de Zotero y se configura aparte.":
      "You do not need the “Nodus for Zotero” plugin to import your library: the plugin is a chat inside Zotero and is set up separately.",
    "Nodus lo comprueba solo cada pocos segundos: en cuanto Zotero responda, tu biblioteca aparecerá aquí.":
      "Nodus checks by itself every few seconds: as soon as Zotero answers, your library will appear here.",
    "Cuando lo hayas hecho, pulsa «Reintentar».":
      "When you have done it, press “Retry”.",
    "Conectado con Zotero":
      "Connected to Zotero",
    "Nodus lee tu biblioteca directamente desde Zotero, en modo solo lectura. Para importar no hace falta el plugin «Nodus for Zotero».":
      "Nodus reads your library straight from Zotero, read-only. Importing does not need the “Nodus for Zotero” plugin.",
    "Motor de IA local":
      "Local AI engine",
    "Paso {n} de {total}":
      "Step {n} of {total}",
    "¿Con qué fuentes quieres empezar?":
      "Which sources do you want to start with?",
    "Elige la IA que responderá":
      "Choose the AI that will answer",
    "Algo no ha salido bien":
      "Something went wrong",
    "Preparando tu primera respuesta":
      "Preparing your first answer",
    "Trae unas pocas fuentes. En un par de minutos podrás hacerles preguntas y ver de qué pasaje sale cada respuesta.":
      "Bring a few sources. In a couple of minutes you will be able to ask them questions and see which passage each answer comes from.",
    "Nodus usa la IA de tu proveedor: conecta tu clave y elige un modelo. El uso lo factura tu proveedor, no Nodus.":
      "Nodus uses your provider’s AI: connect your key and choose a model. Usage is billed by your provider, not by Nodus.",
    "No tienes que hacer nada: en cuanto la primera fuente esté lista se abrirá el chat con una pregunta preparada.":
      "There is nothing you need to do: as soon as the first source is ready, the chat will open with a question prepared.",
    "Mi biblioteca de Zotero":
      "My Zotero library",
    "Elige colecciones y Nodus las lee tal como están. No cambia nada en Zotero.":
      "Choose collections and Nodus reads them as they are. Nothing changes in Zotero.",
    "Zotero detectado":
      "Zotero detected",
    "Zotero no detectado":
      "Zotero not detected",
    "Archivos de mi ordenador":
      "Files on my computer",
    "PDF, EPUB, Word o texto. Puedes arrastrarlos aquí.":
      "PDF, EPUB, Word or text. You can drag them here.",
    "{n} archivo(s)":
      "{n} file(s)",
    "Un documento de ejemplo":
      "An example document",
    "Para ver cómo funciona antes de traer nada tuyo.":
      "To see how it works before bringing anything of your own.",
    "Elige una opción para continuar. Podrás añadir más fuentes de cualquier tipo cuando quieras.":
      "Choose an option to continue. You can add more sources of any kind whenever you like.",
    "Leyendo tus colecciones…":
      "Reading your collections…",
    "Tu Zotero no tiene colecciones todavía. Crea una en Zotero con unas cuantas obras y aparecerá aquí, o empieza con archivos de tu ordenador.":
      "Your Zotero has no collections yet. Create one in Zotero with a few works and it will appear here, or start with files on your computer.",
    "Marca una o varias colecciones. Para empezar basta con una pequeña: el resto de tu biblioteca podrás añadirlo después.":
      "Tick one or more collections. A small one is enough to start: you can add the rest of your library later.",
    "Arrastra aquí tus documentos o elígelos. Dos o tres bastan para la primera prueba.":
      "Drag your documents here or choose them. Two or three are enough for a first try.",
    "Añadir más":
      "Add more",
    "Prefiero una guía paso a paso":
      "I’d rather have a step-by-step guide",
    "Abrir el ejemplo":
      "Open the example",
    "Dejar lista la IA":
      "Get the AI ready",
    "Traer tus fuentes":
      "Bring in your sources",
    "Leerlas y prepararlas para buscar":
      "Read them and prepare them for search",
    "{n} fuente(s) en tu bóveda.":
      "{n} source(s) in your vault.",
    "Entrar en Nodus igualmente":
      "Enter Nodus anyway",
    "Cambiar la IA":
      "Change the AI",
    "Cambiar las fuentes":
      "Change the sources",
    "Un documento largo puede tardar unos minutos, sobre todo con un modelo en este equipo.":
      "A long document can take a few minutes, especially with a model on this computer.",
    "Seguir en segundo plano y entrar ya":
      "Continue in the background and enter now",
    "Descargando {name}. Solo ocurre la primera vez.":
      "Downloading {name}. This only happens the first time.",
    "Guardando tu elección…":
      "Saving your choice…",
    "Leyendo tus colecciones de Zotero…":
      "Reading your Zotero collections…",
    "Copiando tus archivos a la biblioteca…":
      "Copying your files to the library…",
    "Comprobando qué documentos tienen texto…":
      "Checking which documents have text…",
    "«{title}»: {done} de {total} pasajes.":
      "“{title}”: {done} of {total} passages.",
    "Leyendo «{title}»…":
      "Reading “{title}”…",
    "No se ha encontrado ningún documento en lo que has elegido. Prueba con otra colección o con archivos de tu ordenador.":
      "No document was found in what you chose. Try another collection, or files on your computer.",
    "Estas referencias no tienen un PDF u otro archivo con texto, así que no hay nada que leer. Elige obras que tengan su archivo adjunto.":
      "These references have no PDF or other file with text, so there is nothing to read. Choose works that have their file attached.",
    "Nodus no ha podido leer el texto de estos archivos. Suele pasar con PDF escaneados sin capa de texto. Prueba con otros documentos.":
      "Nodus could not read the text of these files. It usually happens with scanned PDFs that have no text layer. Try other documents.",
    "Falta el modelo que prepara la búsqueda. Vuelve al paso anterior y elige dónde calcularla.":
      "The model that prepares the search is missing. Go back one step and choose where to compute it.",
    "El servicio de IA ha rechazado la petición. Comprueba la clave y el modelo elegidos y vuelve a intentarlo.":
      "The AI service rejected the request. Check the key and the model you chose and try again.",
    "No se han podido preparar estas fuentes. Puedes reintentarlo o entrar en Nodus y prepararlas desde la Biblioteca.":
      "These sources could not be prepared. You can retry, or enter Nodus and prepare them from the Library.",
    "Una bóveda es tu espacio de trabajo: reúne tus fuentes y todo lo que hagas con ellas. Deja «Académico» si vienes a trabajar con tus lecturas. Podrás crear más bóvedas, de otros tipos, cuando quieras.":
      "A vault is your workspace: it holds your sources and everything you do with them. Leave “Academic” if you are here to work with your readings. You can create more vaults, of other types, whenever you like.",
    "Tu biblioteca está vacía":
      "Your library is empty",
    "Trae unas cuantas fuentes y podrás hacerles preguntas en el chat. Nodus solo lee tus archivos: no cambia nada en Zotero.":
      "Bring a few sources and you will be able to ask them questions in the chat. Nodus only reads your files: nothing changes in Zotero.",
    "Traer de Zotero":
      "Bring from Zotero",
    "Empezar ahora y protegerlo después":
      "Start now and protect it later",
    "Nodus usará una carpeta propia en este ordenador y te recordará guardar el kit de recuperación más adelante.":
      "Nodus will use a folder of its own on this computer and remind you to save the recovery kit later on.",
    "Este plugin es opcional y no sirve para importar. Para traer tu biblioteca de Zotero a Nodus basta con tener Zotero abierto: se hace desde Biblioteca, sin instalar nada.":
      "This plugin is optional and is not used for importing. To bring your Zotero library into Nodus you only need Zotero open: it is done from the Library, with nothing to install.",
  },
  fr: {
    "{collections} colección(es) seleccionada(s), con sus subcolecciones. Nodus prepara primero unas pocas obras para que puedas probarlo ya.":
      "{collections} collection(s) sélectionnée(s), avec leurs sous-collections. Nodus prépare d’abord quelques ouvrages pour que vous puissiez essayer tout de suite.",
    "{n} obra(s) · {m} subcolección(es)":
      "{n} ouvrage(s) · {m} sous-collection(s)",
    "{m} subcolección(es)":
      "{m} sous-collection(s)",
    "{n} obra(s)":
      "{n} ouvrage(s)",
    "Ver subcolecciones de {name}":
      "Afficher les sous-collections de {name}",
    "No se pudieron leer las subcolecciones. Puedes marcar la colección completa.":
      "Impossible de lire les sous-collections. Vous pouvez cocher la collection entière.",
    "Nodus lo comprueba solo cada pocos segundos y este aviso cambiará en cuanto Zotero responda.":
      "Nodus vérifie tout seul toutes les quelques secondes, et cet avis changera dès que Zotero répondra.",
    "Tu trabajo se guarda en {folder}, con copias cifradas automáticas. Guarda tu kit de recuperación para poder restaurarlo en otro ordenador.":
      "Votre travail est enregistré dans {folder}, avec des sauvegardes chiffrées automatiques. Enregistrez votre kit de récupération pour pouvoir le restaurer sur un autre ordinateur.",
    "¿Te has atascado? Todavía no hay ninguna fuente en esta bóveda. Podemos retomar los primeros pasos, o puedes contarnos qué te ha frenado.":
      "Bloqué ? Cet espace ne contient encore aucune source. Nous pouvons reprendre les premiers pas, ou vous pouvez nous dire ce qui vous a freiné.",
    "Retomar los primeros pasos":
      "Reprendre les premiers pas",
    "Contar qué me ha frenado":
      "Dire ce qui m’a freiné",
    "Conecta tu proveedor de IA":
      "Connectez votre fournisseur d’IA",
    "Conecta primero un proveedor.":
      "Connectez d’abord un fournisseur.",
    "Búsqueda en tus fuentes":
      "Recherche dans vos sources",
    "Para encontrar el pasaje exacto, Nodus prepara un índice de tus textos (embeddings). Elige dónde se calcula.":
      "Pour trouver le passage exact, Nodus prépare un index de vos textes (embeddings). Choisissez où il est calculé.",
    "En este equipo":
      "Sur cet ordinateur",
    "Con un servicio externo (API)":
      "Avec un service externe (API)",
    "Gratis y privado: tus textos no salen del ordenador. La primera vez descarga el modelo elegido, de unos cientos de MB.":
      "Gratuit et privé : vos textes ne quittent pas l’ordinateur. La première fois, le modèle choisi est téléchargé (quelques centaines de Mo).",
    "No descarga nada y es rápido en cualquier equipo. Usa la clave de tu proveedor y tiene un coste pequeño.":
      "Aucun téléchargement, rapide sur tout ordinateur. Utilise la clé de votre fournisseur et entraîne un faible coût.",
    "Ninguno de tus proveedores conectados ofrece este servicio. Lo ofrecen {list}: conecta uno de ellos, o elige «En este equipo».":
      "Aucun de vos fournisseurs connectés ne propose ce service. {list} le proposent : connectez l’un d’eux, ou choisissez « Sur cet ordinateur ».",
    "No se ha encontrado ningún modelo en este equipo.":
      "Aucun modèle n’a été trouvé sur cet ordinateur.",
    "Buscando Zotero…":
      "Recherche de Zotero…",
    "Zotero ha respondido con un error":
      "Zotero a répondu par une erreur",
    "Zotero no está conectado ahora mismo":
      "Zotero n’est pas connecté pour le moment",
    "Nodus todavía no puede leer tu Zotero":
      "Nodus ne peut pas encore lire votre Zotero",
    "Abre Zotero en este ordenador (versión 7 o posterior).":
      "Ouvrez Zotero sur cet ordinateur (version 7 ou ultérieure).",
    "En Zotero, ve a Ajustes → Avanzado y marca «Permitir que otras aplicaciones de este ordenador se comuniquen con Zotero».":
      "Dans Zotero, allez dans Paramètres → Avancé et cochez « Autoriser les autres applications sur cet ordinateur à communiquer avec Zotero ».",
    "No necesitas el plugin «Nodus for Zotero» para importar tu biblioteca: el plugin es un chat dentro de Zotero y se configura aparte.":
      "Vous n’avez pas besoin du plugin « Nodus for Zotero » pour importer votre bibliothèque : le plugin est un chat dans Zotero et se configure à part.",
    "Nodus lo comprueba solo cada pocos segundos: en cuanto Zotero responda, tu biblioteca aparecerá aquí.":
      "Nodus vérifie tout seul toutes les quelques secondes : dès que Zotero répond, votre bibliothèque apparaît ici.",
    "Cuando lo hayas hecho, pulsa «Reintentar».":
      "Une fois que c’est fait, cliquez sur « Réessayer ».",
    "Conectado con Zotero":
      "Connecté à Zotero",
    "Nodus lee tu biblioteca directamente desde Zotero, en modo solo lectura. Para importar no hace falta el plugin «Nodus for Zotero».":
      "Nodus lit votre bibliothèque directement depuis Zotero, en lecture seule. L’import ne nécessite pas le plugin « Nodus for Zotero ».",
    "Motor de IA local":
      "Moteur d’IA local",
    "Paso {n} de {total}":
      "Étape {n} sur {total}",
    "¿Con qué fuentes quieres empezar?":
      "Avec quelles sources voulez-vous commencer ?",
    "Elige la IA que responderá":
      "Choisissez l’IA qui répondra",
    "Algo no ha salido bien":
      "Quelque chose s’est mal passé",
    "Preparando tu primera respuesta":
      "Préparation de votre première réponse",
    "Trae unas pocas fuentes. En un par de minutos podrás hacerles preguntas y ver de qué pasaje sale cada respuesta.":
      "Apportez quelques sources. Dans quelques minutes, vous pourrez leur poser des questions et voir de quel passage vient chaque réponse.",
    "Nodus usa la IA de tu proveedor: conecta tu clave y elige un modelo. El uso lo factura tu proveedor, no Nodus.":
      "Nodus utilise l’IA de votre fournisseur : connectez votre clé et choisissez un modèle. L’utilisation est facturée par votre fournisseur, pas par Nodus.",
    "No tienes que hacer nada: en cuanto la primera fuente esté lista se abrirá el chat con una pregunta preparada.":
      "Vous n’avez rien à faire : dès que la première source est prête, le chat s’ouvre avec une question préparée.",
    "Mi biblioteca de Zotero":
      "Ma bibliothèque Zotero",
    "Elige colecciones y Nodus las lee tal como están. No cambia nada en Zotero.":
      "Choisissez des collections et Nodus les lit telles quelles. Rien ne change dans Zotero.",
    "Zotero detectado":
      "Zotero détecté",
    "Zotero no detectado":
      "Zotero non détecté",
    "Archivos de mi ordenador":
      "Fichiers de mon ordinateur",
    "PDF, EPUB, Word o texto. Puedes arrastrarlos aquí.":
      "PDF, EPUB, Word ou texte. Vous pouvez les glisser ici.",
    "{n} archivo(s)":
      "{n} fichier(s)",
    "Un documento de ejemplo":
      "Un document d’exemple",
    "Para ver cómo funciona antes de traer nada tuyo.":
      "Pour voir comment cela fonctionne avant d’apporter vos propres documents.",
    "Elige una opción para continuar. Podrás añadir más fuentes de cualquier tipo cuando quieras.":
      "Choisissez une option pour continuer. Vous pourrez ajouter d’autres sources de tout type quand vous le souhaitez.",
    "Leyendo tus colecciones…":
      "Lecture de vos collections…",
    "Tu Zotero no tiene colecciones todavía. Crea una en Zotero con unas cuantas obras y aparecerá aquí, o empieza con archivos de tu ordenador.":
      "Votre Zotero ne contient encore aucune collection. Créez-en une dans Zotero avec quelques ouvrages et elle apparaîtra ici, ou commencez avec des fichiers de votre ordinateur.",
    "Marca una o varias colecciones. Para empezar basta con una pequeña: el resto de tu biblioteca podrás añadirlo después.":
      "Cochez une ou plusieurs collections. Une petite suffit pour commencer : vous pourrez ajouter le reste de votre bibliothèque plus tard.",
    "Arrastra aquí tus documentos o elígelos. Dos o tres bastan para la primera prueba.":
      "Glissez vos documents ici ou choisissez-les. Deux ou trois suffisent pour un premier essai.",
    "Añadir más":
      "Ajouter d’autres",
    "Prefiero una guía paso a paso":
      "Je préfère un guide pas à pas",
    "Abrir el ejemplo":
      "Ouvrir l’exemple",
    "Dejar lista la IA":
      "Préparer l’IA",
    "Traer tus fuentes":
      "Importer vos sources",
    "Leerlas y prepararlas para buscar":
      "Les lire et les préparer pour la recherche",
    "{n} fuente(s) en tu bóveda.":
      "{n} source(s) dans votre espace.",
    "Entrar en Nodus igualmente":
      "Entrer dans Nodus quand même",
    "Cambiar la IA":
      "Changer l’IA",
    "Cambiar las fuentes":
      "Changer les sources",
    "Un documento largo puede tardar unos minutos, sobre todo con un modelo en este equipo.":
      "Un long document peut prendre quelques minutes, surtout avec un modèle sur cet ordinateur.",
    "Seguir en segundo plano y entrar ya":
      "Continuer en arrière-plan et entrer maintenant",
    "Descargando {name}. Solo ocurre la primera vez.":
      "Téléchargement de {name}. Cela n’arrive que la première fois.",
    "Guardando tu elección…":
      "Enregistrement de votre choix…",
    "Leyendo tus colecciones de Zotero…":
      "Lecture de vos collections Zotero…",
    "Copiando tus archivos a la biblioteca…":
      "Copie de vos fichiers dans la bibliothèque…",
    "Comprobando qué documentos tienen texto…":
      "Vérification des documents qui contiennent du texte…",
    "«{title}»: {done} de {total} pasajes.":
      "« {title} » : {done} passages sur {total}.",
    "Leyendo «{title}»…":
      "Lecture de « {title} »…",
    "No se ha encontrado ningún documento en lo que has elegido. Prueba con otra colección o con archivos de tu ordenador.":
      "Aucun document n’a été trouvé dans votre sélection. Essayez une autre collection ou des fichiers de votre ordinateur.",
    "Estas referencias no tienen un PDF u otro archivo con texto, así que no hay nada que leer. Elige obras que tengan su archivo adjunto.":
      "Ces références n’ont ni PDF ni autre fichier contenant du texte, il n’y a donc rien à lire. Choisissez des ouvrages dont le fichier est joint.",
    "Nodus no ha podido leer el texto de estos archivos. Suele pasar con PDF escaneados sin capa de texto. Prueba con otros documentos.":
      "Nodus n’a pas pu lire le texte de ces fichiers. Cela arrive souvent avec des PDF numérisés sans couche de texte. Essayez d’autres documents.",
    "Falta el modelo que prepara la búsqueda. Vuelve al paso anterior y elige dónde calcularla.":
      "Le modèle qui prépare la recherche est manquant. Revenez à l’étape précédente et choisissez où la calculer.",
    "El servicio de IA ha rechazado la petición. Comprueba la clave y el modelo elegidos y vuelve a intentarlo.":
      "Le service d’IA a refusé la requête. Vérifiez la clé et le modèle choisis, puis réessayez.",
    "No se han podido preparar estas fuentes. Puedes reintentarlo o entrar en Nodus y prepararlas desde la Biblioteca.":
      "Ces sources n’ont pas pu être préparées. Vous pouvez réessayer, ou entrer dans Nodus et les préparer depuis la Bibliothèque.",
    "Una bóveda es tu espacio de trabajo: reúne tus fuentes y todo lo que hagas con ellas. Deja «Académico» si vienes a trabajar con tus lecturas. Podrás crear más bóvedas, de otros tipos, cuando quieras.":
      "Un espace est votre lieu de travail : il réunit vos sources et tout ce que vous en faites. Laissez « Académique » si vous venez travailler avec vos lectures. Vous pourrez créer d’autres espaces, d’autres types, quand vous le souhaitez.",
    "Tu biblioteca está vacía":
      "Votre bibliothèque est vide",
    "Trae unas cuantas fuentes y podrás hacerles preguntas en el chat. Nodus solo lee tus archivos: no cambia nada en Zotero.":
      "Apportez quelques sources et vous pourrez leur poser des questions dans le chat. Nodus se contente de lire vos fichiers : rien ne change dans Zotero.",
    "Traer de Zotero":
      "Importer depuis Zotero",
    "Empezar ahora y protegerlo después":
      "Commencer maintenant et protéger plus tard",
    "Nodus usará una carpeta propia en este ordenador y te recordará guardar el kit de recuperación más adelante.":
      "Nodus utilisera son propre dossier sur cet ordinateur et vous rappellera plus tard d’enregistrer le kit de récupération.",
    "Este plugin es opcional y no sirve para importar. Para traer tu biblioteca de Zotero a Nodus basta con tener Zotero abierto: se hace desde Biblioteca, sin instalar nada.":
      "Ce plugin est facultatif et ne sert pas à importer. Pour importer votre bibliothèque Zotero dans Nodus, il suffit que Zotero soit ouvert : cela se fait depuis la Bibliothèque, sans rien installer.",
  },
  de: {
    "{collections} colección(es) seleccionada(s), con sus subcolecciones. Nodus prepara primero unas pocas obras para que puedas probarlo ya.":
      "{collections} Sammlung(en) ausgewählt, mit ihren Untersammlungen. Nodus bereitet zuerst einige Werke vor, damit du es sofort ausprobieren kannst.",
    "{n} obra(s) · {m} subcolección(es)":
      "{n} Werk(e) · {m} Untersammlung(en)",
    "{m} subcolección(es)":
      "{m} Untersammlung(en)",
    "{n} obra(s)":
      "{n} Werk(e)",
    "Ver subcolecciones de {name}":
      "Untersammlungen von {name} anzeigen",
    "No se pudieron leer las subcolecciones. Puedes marcar la colección completa.":
      "Die Untersammlungen konnten nicht gelesen werden. Du kannst die ganze Sammlung markieren.",
    "Nodus lo comprueba solo cada pocos segundos y este aviso cambiará en cuanto Zotero responda.":
      "Nodus prüft das alle paar Sekunden von selbst, und dieser Hinweis ändert sich, sobald Zotero antwortet.",
    "Tu trabajo se guarda en {folder}, con copias cifradas automáticas. Guarda tu kit de recuperación para poder restaurarlo en otro ordenador.":
      "Deine Arbeit wird in {folder} gespeichert, mit automatischen verschlüsselten Sicherungen. Speichere dein Wiederherstellungskit, um sie auf einem anderen Computer wiederherstellen zu können.",
    "¿Te has atascado? Todavía no hay ninguna fuente en esta bóveda. Podemos retomar los primeros pasos, o puedes contarnos qué te ha frenado.":
      "Hängst du fest? Dieser Vault enthält noch keine Quellen. Wir können die ersten Schritte wieder aufnehmen, oder du sagst uns, was dich aufgehalten hat.",
    "Retomar los primeros pasos":
      "Erste Schritte wieder aufnehmen",
    "Contar qué me ha frenado":
      "Sagen, was mich aufgehalten hat",
    "Conecta tu proveedor de IA":
      "Verbinde deinen KI-Anbieter",
    "Conecta primero un proveedor.":
      "Verbinde zuerst einen Anbieter.",
    "Búsqueda en tus fuentes":
      "Suche in deinen Quellen",
    "Para encontrar el pasaje exacto, Nodus prepara un índice de tus textos (embeddings). Elige dónde se calcula.":
      "Um die genaue Textstelle zu finden, erstellt Nodus einen Index deiner Texte (Embeddings). Wähle, wo er berechnet wird.",
    "En este equipo":
      "Auf diesem Computer",
    "Con un servicio externo (API)":
      "Mit einem externen Dienst (API)",
    "Gratis y privado: tus textos no salen del ordenador. La primera vez descarga el modelo elegido, de unos cientos de MB.":
      "Kostenlos und privat: Deine Texte verlassen den Computer nicht. Beim ersten Mal wird das gewählte Modell heruntergeladen, einige hundert MB.",
    "No descarga nada y es rápido en cualquier equipo. Usa la clave de tu proveedor y tiene un coste pequeño.":
      "Kein Download und auf jedem Computer schnell. Nutzt den Schlüssel deines Anbieters und verursacht geringe Kosten.",
    "Ninguno de tus proveedores conectados ofrece este servicio. Lo ofrecen {list}: conecta uno de ellos, o elige «En este equipo».":
      "Keiner deiner verbundenen Anbieter bietet diesen Dienst. {list} bieten ihn an: Verbinde einen davon oder wähle „Auf diesem Computer“.",
    "No se ha encontrado ningún modelo en este equipo.":
      "Auf diesem Computer wurde kein Modell gefunden.",
    "Buscando Zotero…":
      "Zotero wird gesucht…",
    "Zotero ha respondido con un error":
      "Zotero hat mit einem Fehler geantwortet",
    "Zotero no está conectado ahora mismo":
      "Zotero ist gerade nicht verbunden",
    "Nodus todavía no puede leer tu Zotero":
      "Nodus kann dein Zotero noch nicht lesen",
    "Abre Zotero en este ordenador (versión 7 o posterior).":
      "Öffne Zotero auf diesem Computer (Version 7 oder neuer).",
    "En Zotero, ve a Ajustes → Avanzado y marca «Permitir que otras aplicaciones de este ordenador se comuniquen con Zotero».":
      "Gehe in Zotero zu Einstellungen → Erweitert und aktiviere „Anderen Anwendungen auf diesem Computer erlauben, mit Zotero zu kommunizieren“.",
    "No necesitas el plugin «Nodus for Zotero» para importar tu biblioteca: el plugin es un chat dentro de Zotero y se configura aparte.":
      "Du brauchst das Plugin „Nodus for Zotero“ nicht, um deine Bibliothek zu importieren: Das Plugin ist ein Chat in Zotero und wird separat eingerichtet.",
    "Nodus lo comprueba solo cada pocos segundos: en cuanto Zotero responda, tu biblioteca aparecerá aquí.":
      "Nodus prüft das alle paar Sekunden von selbst: Sobald Zotero antwortet, erscheint deine Bibliothek hier.",
    "Cuando lo hayas hecho, pulsa «Reintentar».":
      "Wenn du das erledigt hast, klicke auf „Erneut versuchen“.",
    "Conectado con Zotero":
      "Mit Zotero verbunden",
    "Nodus lee tu biblioteca directamente desde Zotero, en modo solo lectura. Para importar no hace falta el plugin «Nodus for Zotero».":
      "Nodus liest deine Bibliothek direkt aus Zotero, nur lesend. Für den Import ist das Plugin „Nodus for Zotero“ nicht nötig.",
    "Motor de IA local":
      "Lokale KI-Engine",
    "Paso {n} de {total}":
      "Schritt {n} von {total}",
    "¿Con qué fuentes quieres empezar?":
      "Mit welchen Quellen möchtest du beginnen?",
    "Elige la IA que responderá":
      "Wähle die KI, die antwortet",
    "Algo no ha salido bien":
      "Etwas ist schiefgelaufen",
    "Preparando tu primera respuesta":
      "Deine erste Antwort wird vorbereitet",
    "Trae unas pocas fuentes. En un par de minutos podrás hacerles preguntas y ver de qué pasaje sale cada respuesta.":
      "Bring ein paar Quellen mit. In wenigen Minuten kannst du ihnen Fragen stellen und sehen, aus welcher Textstelle jede Antwort stammt.",
    "Nodus usa la IA de tu proveedor: conecta tu clave y elige un modelo. El uso lo factura tu proveedor, no Nodus.":
      "Nodus nutzt die KI deines Anbieters: Verbinde deinen Schlüssel und wähle ein Modell. Die Nutzung rechnet dein Anbieter ab, nicht Nodus.",
    "No tienes que hacer nada: en cuanto la primera fuente esté lista se abrirá el chat con una pregunta preparada.":
      "Du musst nichts tun: Sobald die erste Quelle bereit ist, öffnet sich der Chat mit einer vorbereiteten Frage.",
    "Mi biblioteca de Zotero":
      "Meine Zotero-Bibliothek",
    "Elige colecciones y Nodus las lee tal como están. No cambia nada en Zotero.":
      "Wähle Sammlungen, und Nodus liest sie, wie sie sind. In Zotero ändert sich nichts.",
    "Zotero detectado":
      "Zotero erkannt",
    "Zotero no detectado":
      "Zotero nicht erkannt",
    "Archivos de mi ordenador":
      "Dateien auf meinem Computer",
    "PDF, EPUB, Word o texto. Puedes arrastrarlos aquí.":
      "PDF, EPUB, Word oder Text. Du kannst sie hierher ziehen.",
    "{n} archivo(s)":
      "{n} Datei(en)",
    "Un documento de ejemplo":
      "Ein Beispieldokument",
    "Para ver cómo funciona antes de traer nada tuyo.":
      "Um zu sehen, wie es funktioniert, bevor du Eigenes mitbringst.",
    "Elige una opción para continuar. Podrás añadir más fuentes de cualquier tipo cuando quieras.":
      "Wähle eine Option, um fortzufahren. Weitere Quellen jeder Art kannst du jederzeit hinzufügen.",
    "Leyendo tus colecciones…":
      "Deine Sammlungen werden gelesen…",
    "Tu Zotero no tiene colecciones todavía. Crea una en Zotero con unas cuantas obras y aparecerá aquí, o empieza con archivos de tu ordenador.":
      "Dein Zotero hat noch keine Sammlungen. Lege in Zotero eine mit ein paar Werken an, dann erscheint sie hier, oder beginne mit Dateien von deinem Computer.",
    "Marca una o varias colecciones. Para empezar basta con una pequeña: el resto de tu biblioteca podrás añadirlo después.":
      "Markiere eine oder mehrere Sammlungen. Für den Anfang reicht eine kleine: Den Rest deiner Bibliothek kannst du später hinzufügen.",
    "Arrastra aquí tus documentos o elígelos. Dos o tres bastan para la primera prueba.":
      "Ziehe deine Dokumente hierher oder wähle sie aus. Zwei oder drei reichen für einen ersten Versuch.",
    "Añadir más":
      "Weitere hinzufügen",
    "Prefiero una guía paso a paso":
      "Lieber eine Schritt-für-Schritt-Anleitung",
    "Abrir el ejemplo":
      "Beispiel öffnen",
    "Dejar lista la IA":
      "KI bereit machen",
    "Traer tus fuentes":
      "Deine Quellen holen",
    "Leerlas y prepararlas para buscar":
      "Lesen und für die Suche vorbereiten",
    "{n} fuente(s) en tu bóveda.":
      "{n} Quelle(n) in deinem Vault.",
    "Entrar en Nodus igualmente":
      "Trotzdem zu Nodus",
    "Cambiar la IA":
      "KI ändern",
    "Cambiar las fuentes":
      "Quellen ändern",
    "Un documento largo puede tardar unos minutos, sobre todo con un modelo en este equipo.":
      "Ein langes Dokument kann einige Minuten dauern, vor allem mit einem Modell auf diesem Computer.",
    "Seguir en segundo plano y entrar ya":
      "Im Hintergrund fortsetzen und jetzt starten",
    "Descargando {name}. Solo ocurre la primera vez.":
      "{name} wird heruntergeladen. Das passiert nur beim ersten Mal.",
    "Guardando tu elección…":
      "Deine Auswahl wird gespeichert…",
    "Leyendo tus colecciones de Zotero…":
      "Deine Zotero-Sammlungen werden gelesen…",
    "Copiando tus archivos a la biblioteca…":
      "Deine Dateien werden in die Bibliothek kopiert…",
    "Comprobando qué documentos tienen texto…":
      "Es wird geprüft, welche Dokumente Text enthalten…",
    "«{title}»: {done} de {total} pasajes.":
      "„{title}“: {done} von {total} Textstellen.",
    "Leyendo «{title}»…":
      "„{title}“ wird gelesen…",
    "No se ha encontrado ningún documento en lo que has elegido. Prueba con otra colección o con archivos de tu ordenador.":
      "In deiner Auswahl wurde kein Dokument gefunden. Versuche es mit einer anderen Sammlung oder mit Dateien von deinem Computer.",
    "Estas referencias no tienen un PDF u otro archivo con texto, así que no hay nada que leer. Elige obras que tengan su archivo adjunto.":
      "Diese Einträge haben kein PDF und keine andere Datei mit Text, es gibt also nichts zu lesen. Wähle Werke, an die ihre Datei angehängt ist.",
    "Nodus no ha podido leer el texto de estos archivos. Suele pasar con PDF escaneados sin capa de texto. Prueba con otros documentos.":
      "Nodus konnte den Text dieser Dateien nicht lesen. Das passiert meist bei gescannten PDFs ohne Textebene. Versuche es mit anderen Dokumenten.",
    "Falta el modelo que prepara la búsqueda. Vuelve al paso anterior y elige dónde calcularla.":
      "Das Modell, das die Suche vorbereitet, fehlt. Gehe einen Schritt zurück und wähle, wo sie berechnet wird.",
    "El servicio de IA ha rechazado la petición. Comprueba la clave y el modelo elegidos y vuelve a intentarlo.":
      "Der KI-Dienst hat die Anfrage abgelehnt. Prüfe den Schlüssel und das gewählte Modell und versuche es erneut.",
    "No se han podido preparar estas fuentes. Puedes reintentarlo o entrar en Nodus y prepararlas desde la Biblioteca.":
      "Diese Quellen konnten nicht vorbereitet werden. Du kannst es erneut versuchen oder Nodus öffnen und sie in der Bibliothek vorbereiten.",
    "Una bóveda es tu espacio de trabajo: reúne tus fuentes y todo lo que hagas con ellas. Deja «Académico» si vienes a trabajar con tus lecturas. Podrás crear más bóvedas, de otros tipos, cuando quieras.":
      "Ein Vault ist dein Arbeitsbereich: Er enthält deine Quellen und alles, was du damit machst. Lass „Akademisch“ ausgewählt, wenn du mit deiner Lektüre arbeiten willst. Weitere Vaults anderer Typen kannst du jederzeit anlegen.",
    "Tu biblioteca está vacía":
      "Deine Bibliothek ist leer",
    "Trae unas cuantas fuentes y podrás hacerles preguntas en el chat. Nodus solo lee tus archivos: no cambia nada en Zotero.":
      "Bring ein paar Quellen mit, dann kannst du ihnen im Chat Fragen stellen. Nodus liest deine Dateien nur: In Zotero ändert sich nichts.",
    "Traer de Zotero":
      "Aus Zotero holen",
    "Empezar ahora y protegerlo después":
      "Jetzt starten und später schützen",
    "Nodus usará una carpeta propia en este ordenador y te recordará guardar el kit de recuperación más adelante.":
      "Nodus verwendet einen eigenen Ordner auf diesem Computer und erinnert dich später daran, das Wiederherstellungskit zu speichern.",
    "Este plugin es opcional y no sirve para importar. Para traer tu biblioteca de Zotero a Nodus basta con tener Zotero abierto: se hace desde Biblioteca, sin instalar nada.":
      "Dieses Plugin ist optional und dient nicht dem Import. Um deine Zotero-Bibliothek in Nodus zu holen, muss nur Zotero geöffnet sein: Das geht in der Bibliothek, ohne etwas zu installieren.",
  },
  pt: {
    "{collections} colección(es) seleccionada(s), con sus subcolecciones. Nodus prepara primero unas pocas obras para que puedas probarlo ya.":
      "{collections} coleção(ões) selecionada(s), com as suas subcoleções. O Nodus prepara primeiro algumas obras para que possas experimentar já.",
    "{n} obra(s) · {m} subcolección(es)":
      "{n} obra(s) · {m} subcoleção(ões)",
    "{m} subcolección(es)":
      "{m} subcoleção(ões)",
    "{n} obra(s)":
      "{n} obra(s)",
    "Ver subcolecciones de {name}":
      "Ver subcoleções de {name}",
    "No se pudieron leer las subcolecciones. Puedes marcar la colección completa.":
      "Não foi possível ler as subcoleções. Podes assinalar a coleção completa.",
    "Nodus lo comprueba solo cada pocos segundos y este aviso cambiará en cuanto Zotero responda.":
      "O Nodus verifica sozinho de poucos em poucos segundos e este aviso mudará assim que o Zotero responder.",
    "Tu trabajo se guarda en {folder}, con copias cifradas automáticas. Guarda tu kit de recuperación para poder restaurarlo en otro ordenador.":
      "O teu trabalho é guardado em {folder}, com cópias encriptadas automáticas. Guarda o teu kit de recuperação para o poderes restaurar noutro computador.",
    "¿Te has atascado? Todavía no hay ninguna fuente en esta bóveda. Podemos retomar los primeros pasos, o puedes contarnos qué te ha frenado.":
      "Ficaste bloqueado? Este cofre ainda não tem nenhuma fonte. Podemos retomar os primeiros passos, ou podes contar-nos o que te travou.",
    "Retomar los primeros pasos":
      "Retomar os primeiros passos",
    "Contar qué me ha frenado":
      "Contar o que me travou",
    "Conecta tu proveedor de IA":
      "Liga o teu fornecedor de IA",
    "Conecta primero un proveedor.":
      "Liga primeiro um fornecedor.",
    "Búsqueda en tus fuentes":
      "Pesquisa nas tuas fontes",
    "Para encontrar el pasaje exacto, Nodus prepara un índice de tus textos (embeddings). Elige dónde se calcula.":
      "Para encontrar o excerto exato, o Nodus prepara um índice dos teus textos (embeddings). Escolhe onde é calculado.",
    "En este equipo":
      "Neste computador",
    "Con un servicio externo (API)":
      "Com um serviço externo (API)",
    "Gratis y privado: tus textos no salen del ordenador. La primera vez descarga el modelo elegido, de unos cientos de MB.":
      "Gratuito e privado: os teus textos não saem do computador. Da primeira vez descarrega o modelo escolhido, com algumas centenas de MB.",
    "No descarga nada y es rápido en cualquier equipo. Usa la clave de tu proveedor y tiene un coste pequeño.":
      "Não descarrega nada e é rápido em qualquer computador. Usa a chave do teu fornecedor e tem um custo reduzido.",
    "Ninguno de tus proveedores conectados ofrece este servicio. Lo ofrecen {list}: conecta uno de ellos, o elige «En este equipo».":
      "Nenhum dos teus fornecedores ligados oferece este serviço. Oferecem-no {list}: liga um deles, ou escolhe «Neste computador».",
    "No se ha encontrado ningún modelo en este equipo.":
      "Não foi encontrado nenhum modelo neste computador.",
    "Buscando Zotero…":
      "A procurar o Zotero…",
    "Zotero ha respondido con un error":
      "O Zotero respondeu com um erro",
    "Zotero no está conectado ahora mismo":
      "O Zotero não está ligado neste momento",
    "Nodus todavía no puede leer tu Zotero":
      "O Nodus ainda não consegue ler o teu Zotero",
    "Abre Zotero en este ordenador (versión 7 o posterior).":
      "Abre o Zotero neste computador (versão 7 ou posterior).",
    "En Zotero, ve a Ajustes → Avanzado y marca «Permitir que otras aplicaciones de este ordenador se comuniquen con Zotero».":
      "No Zotero, vai a Definições → Avançadas e assinala «Permitir que outras aplicações neste computador comuniquem com o Zotero».",
    "No necesitas el plugin «Nodus for Zotero» para importar tu biblioteca: el plugin es un chat dentro de Zotero y se configura aparte.":
      "Não precisas do plugin «Nodus for Zotero» para importar a tua biblioteca: o plugin é um chat dentro do Zotero e configura-se à parte.",
    "Nodus lo comprueba solo cada pocos segundos: en cuanto Zotero responda, tu biblioteca aparecerá aquí.":
      "O Nodus verifica sozinho de poucos em poucos segundos: assim que o Zotero responder, a tua biblioteca aparece aqui.",
    "Cuando lo hayas hecho, pulsa «Reintentar».":
      "Quando o tiveres feito, clica em «Tentar novamente».",
    "Conectado con Zotero":
      "Ligado ao Zotero",
    "Nodus lee tu biblioteca directamente desde Zotero, en modo solo lectura. Para importar no hace falta el plugin «Nodus for Zotero».":
      "O Nodus lê a tua biblioteca diretamente do Zotero, em modo só de leitura. Para importar não é preciso o plugin «Nodus for Zotero».",
    "Motor de IA local":
      "Motor de IA local",
    "Paso {n} de {total}":
      "Passo {n} de {total}",
    "¿Con qué fuentes quieres empezar?":
      "Com que fontes queres começar?",
    "Elige la IA que responderá":
      "Escolhe a IA que vai responder",
    "Algo no ha salido bien":
      "Algo não correu bem",
    "Preparando tu primera respuesta":
      "A preparar a tua primeira resposta",
    "Trae unas pocas fuentes. En un par de minutos podrás hacerles preguntas y ver de qué pasaje sale cada respuesta.":
      "Traz algumas fontes. Em poucos minutos poderás fazer-lhes perguntas e ver de que excerto vem cada resposta.",
    "Nodus usa la IA de tu proveedor: conecta tu clave y elige un modelo. El uso lo factura tu proveedor, no Nodus.":
      "O Nodus usa a IA do teu fornecedor: liga a tua chave e escolhe um modelo. A utilização é faturada pelo teu fornecedor, não pelo Nodus.",
    "No tienes que hacer nada: en cuanto la primera fuente esté lista se abrirá el chat con una pregunta preparada.":
      "Não tens de fazer nada: assim que a primeira fonte estiver pronta, o chat abre com uma pergunta preparada.",
    "Mi biblioteca de Zotero":
      "A minha biblioteca do Zotero",
    "Elige colecciones y Nodus las lee tal como están. No cambia nada en Zotero.":
      "Escolhe coleções e o Nodus lê-as tal como estão. Nada muda no Zotero.",
    "Zotero detectado":
      "Zotero detetado",
    "Zotero no detectado":
      "Zotero não detetado",
    "Archivos de mi ordenador":
      "Ficheiros do meu computador",
    "PDF, EPUB, Word o texto. Puedes arrastrarlos aquí.":
      "PDF, EPUB, Word ou texto. Podes arrastá-los para aqui.",
    "{n} archivo(s)":
      "{n} ficheiro(s)",
    "Un documento de ejemplo":
      "Um documento de exemplo",
    "Para ver cómo funciona antes de traer nada tuyo.":
      "Para ver como funciona antes de trazeres algo teu.",
    "Elige una opción para continuar. Podrás añadir más fuentes de cualquier tipo cuando quieras.":
      "Escolhe uma opção para continuar. Poderás adicionar mais fontes de qualquer tipo quando quiseres.",
    "Leyendo tus colecciones…":
      "A ler as tuas coleções…",
    "Tu Zotero no tiene colecciones todavía. Crea una en Zotero con unas cuantas obras y aparecerá aquí, o empieza con archivos de tu ordenador.":
      "O teu Zotero ainda não tem coleções. Cria uma no Zotero com algumas obras e ela aparecerá aqui, ou começa com ficheiros do teu computador.",
    "Marca una o varias colecciones. Para empezar basta con una pequeña: el resto de tu biblioteca podrás añadirlo después.":
      "Assinala uma ou várias coleções. Para começar basta uma pequena: o resto da tua biblioteca pode ser adicionado depois.",
    "Arrastra aquí tus documentos o elígelos. Dos o tres bastan para la primera prueba.":
      "Arrasta para aqui os teus documentos ou escolhe-os. Dois ou três bastam para a primeira experiência.",
    "Añadir más":
      "Adicionar mais",
    "Prefiero una guía paso a paso":
      "Prefiro um guia passo a passo",
    "Abrir el ejemplo":
      "Abrir o exemplo",
    "Dejar lista la IA":
      "Deixar a IA pronta",
    "Traer tus fuentes":
      "Trazer as tuas fontes",
    "Leerlas y prepararlas para buscar":
      "Lê-las e prepará-las para a pesquisa",
    "{n} fuente(s) en tu bóveda.":
      "{n} fonte(s) no teu cofre.",
    "Entrar en Nodus igualmente":
      "Entrar no Nodus mesmo assim",
    "Cambiar la IA":
      "Mudar a IA",
    "Cambiar las fuentes":
      "Mudar as fontes",
    "Un documento largo puede tardar unos minutos, sobre todo con un modelo en este equipo.":
      "Um documento longo pode demorar alguns minutos, sobretudo com um modelo neste computador.",
    "Seguir en segundo plano y entrar ya":
      "Continuar em segundo plano e entrar já",
    "Descargando {name}. Solo ocurre la primera vez.":
      "A descarregar {name}. Só acontece da primeira vez.",
    "Guardando tu elección…":
      "A guardar a tua escolha…",
    "Leyendo tus colecciones de Zotero…":
      "A ler as tuas coleções do Zotero…",
    "Copiando tus archivos a la biblioteca…":
      "A copiar os teus ficheiros para a biblioteca…",
    "Comprobando qué documentos tienen texto…":
      "A verificar que documentos têm texto…",
    "«{title}»: {done} de {total} pasajes.":
      "«{title}»: {done} de {total} excertos.",
    "Leyendo «{title}»…":
      "A ler «{title}»…",
    "No se ha encontrado ningún documento en lo que has elegido. Prueba con otra colección o con archivos de tu ordenador.":
      "Não foi encontrado nenhum documento no que escolheste. Experimenta outra coleção ou ficheiros do teu computador.",
    "Estas referencias no tienen un PDF u otro archivo con texto, así que no hay nada que leer. Elige obras que tengan su archivo adjunto.":
      "Estas referências não têm um PDF nem outro ficheiro com texto, por isso não há nada para ler. Escolhe obras que tenham o ficheiro anexado.",
    "Nodus no ha podido leer el texto de estos archivos. Suele pasar con PDF escaneados sin capa de texto. Prueba con otros documentos.":
      "O Nodus não conseguiu ler o texto destes ficheiros. Costuma acontecer com PDF digitalizados sem camada de texto. Experimenta outros documentos.",
    "Falta el modelo que prepara la búsqueda. Vuelve al paso anterior y elige dónde calcularla.":
      "Falta o modelo que prepara a pesquisa. Volta ao passo anterior e escolhe onde a calcular.",
    "El servicio de IA ha rechazado la petición. Comprueba la clave y el modelo elegidos y vuelve a intentarlo.":
      "O serviço de IA rejeitou o pedido. Verifica a chave e o modelo escolhidos e tenta novamente.",
    "No se han podido preparar estas fuentes. Puedes reintentarlo o entrar en Nodus y prepararlas desde la Biblioteca.":
      "Não foi possível preparar estas fontes. Podes tentar novamente ou entrar no Nodus e prepará-las a partir da Biblioteca.",
    "Una bóveda es tu espacio de trabajo: reúne tus fuentes y todo lo que hagas con ellas. Deja «Académico» si vienes a trabajar con tus lecturas. Podrás crear más bóvedas, de otros tipos, cuando quieras.":
      "Um cofre é o teu espaço de trabalho: reúne as tuas fontes e tudo o que fizeres com elas. Deixa «Académico» se vens trabalhar com as tuas leituras. Poderás criar mais cofres, de outros tipos, quando quiseres.",
    "Tu biblioteca está vacía":
      "A tua biblioteca está vazia",
    "Trae unas cuantas fuentes y podrás hacerles preguntas en el chat. Nodus solo lee tus archivos: no cambia nada en Zotero.":
      "Traz algumas fontes e poderás fazer-lhes perguntas no chat. O Nodus apenas lê os teus ficheiros: nada muda no Zotero.",
    "Traer de Zotero":
      "Trazer do Zotero",
    "Empezar ahora y protegerlo después":
      "Começar agora e proteger depois",
    "Nodus usará una carpeta propia en este ordenador y te recordará guardar el kit de recuperación más adelante.":
      "O Nodus usará uma pasta própria neste computador e lembrar-te-á mais tarde de guardar o kit de recuperação.",
    "Este plugin es opcional y no sirve para importar. Para traer tu biblioteca de Zotero a Nodus basta con tener Zotero abierto: se hace desde Biblioteca, sin instalar nada.":
      "Este plugin é opcional e não serve para importar. Para trazer a tua biblioteca do Zotero para o Nodus basta ter o Zotero aberto: faz-se a partir da Biblioteca, sem instalar nada.",
  },
  "pt-BR": {
    "{collections} colección(es) seleccionada(s), con sus subcolecciones. Nodus prepara primero unas pocas obras para que puedas probarlo ya.":
      "{collections} coleção(ões) selecionada(s), com suas subcoleções. O Nodus prepara primeiro algumas obras para que você possa testar já.",
    "{n} obra(s) · {m} subcolección(es)":
      "{n} obra(s) · {m} subcoleção(ões)",
    "{m} subcolección(es)":
      "{m} subcoleção(ões)",
    "{n} obra(s)":
      "{n} obra(s)",
    "Ver subcolecciones de {name}":
      "Ver subcoleções de {name}",
    "No se pudieron leer las subcolecciones. Puedes marcar la colección completa.":
      "Não foi possível ler as subcoleções. Você pode marcar a coleção inteira.",
    "Nodus lo comprueba solo cada pocos segundos y este aviso cambiará en cuanto Zotero responda.":
      "O Nodus verifica sozinho a cada poucos segundos e este aviso mudará assim que o Zotero responder.",
    "Tu trabajo se guarda en {folder}, con copias cifradas automáticas. Guarda tu kit de recuperación para poder restaurarlo en otro ordenador.":
      "Seu trabalho é salvo em {folder}, com backups criptografados automáticos. Salve seu kit de recuperação para poder restaurá-lo em outro computador.",
    "¿Te has atascado? Todavía no hay ninguna fuente en esta bóveda. Podemos retomar los primeros pasos, o puedes contarnos qué te ha frenado.":
      "Ficou travado? Este cofre ainda não tem nenhuma fonte. Podemos retomar os primeiros passos, ou você pode nos contar o que atrapalhou.",
    "Retomar los primeros pasos":
      "Retomar os primeiros passos",
    "Contar qué me ha frenado":
      "Contar o que atrapalhou",
    "Conecta tu proveedor de IA":
      "Conecte seu provedor de IA",
    "Conecta primero un proveedor.":
      "Conecte primeiro um provedor.",
    "Búsqueda en tus fuentes":
      "Busca nas suas fontes",
    "Para encontrar el pasaje exacto, Nodus prepara un índice de tus textos (embeddings). Elige dónde se calcula.":
      "Para encontrar o trecho exato, o Nodus prepara um índice dos seus textos (embeddings). Escolha onde ele é calculado.",
    "En este equipo":
      "Neste computador",
    "Con un servicio externo (API)":
      "Com um serviço externo (API)",
    "Gratis y privado: tus textos no salen del ordenador. La primera vez descarga el modelo elegido, de unos cientos de MB.":
      "Gratuito e privado: seus textos não saem do computador. Na primeira vez, baixa o modelo escolhido, com algumas centenas de MB.",
    "No descarga nada y es rápido en cualquier equipo. Usa la clave de tu proveedor y tiene un coste pequeño.":
      "Não baixa nada e é rápido em qualquer computador. Usa a chave do seu provedor e tem um custo pequeno.",
    "Ninguno de tus proveedores conectados ofrece este servicio. Lo ofrecen {list}: conecta uno de ellos, o elige «En este equipo».":
      "Nenhum dos seus provedores conectados oferece este serviço. {list} oferecem: conecte um deles ou escolha “Neste computador”.",
    "No se ha encontrado ningún modelo en este equipo.":
      "Nenhum modelo foi encontrado neste computador.",
    "Buscando Zotero…":
      "Procurando o Zotero…",
    "Zotero ha respondido con un error":
      "O Zotero respondeu com um erro",
    "Zotero no está conectado ahora mismo":
      "O Zotero não está conectado no momento",
    "Nodus todavía no puede leer tu Zotero":
      "O Nodus ainda não consegue ler seu Zotero",
    "Abre Zotero en este ordenador (versión 7 o posterior).":
      "Abra o Zotero neste computador (versão 7 ou posterior).",
    "En Zotero, ve a Ajustes → Avanzado y marca «Permitir que otras aplicaciones de este ordenador se comuniquen con Zotero».":
      "No Zotero, vá em Configurações → Avançado e marque “Permitir que outros aplicativos neste computador se comuniquem com o Zotero”.",
    "No necesitas el plugin «Nodus for Zotero» para importar tu biblioteca: el plugin es un chat dentro de Zotero y se configura aparte.":
      "Você não precisa do plugin “Nodus for Zotero” para importar sua biblioteca: o plugin é um chat dentro do Zotero e é configurado à parte.",
    "Nodus lo comprueba solo cada pocos segundos: en cuanto Zotero responda, tu biblioteca aparecerá aquí.":
      "O Nodus verifica sozinho a cada poucos segundos: assim que o Zotero responder, sua biblioteca aparecerá aqui.",
    "Cuando lo hayas hecho, pulsa «Reintentar».":
      "Quando tiver feito isso, clique em “Tentar novamente”.",
    "Conectado con Zotero":
      "Conectado ao Zotero",
    "Nodus lee tu biblioteca directamente desde Zotero, en modo solo lectura. Para importar no hace falta el plugin «Nodus for Zotero».":
      "O Nodus lê sua biblioteca diretamente do Zotero, em modo somente leitura. Para importar não é preciso o plugin “Nodus for Zotero”.",
    "Motor de IA local":
      "Motor de IA local",
    "Paso {n} de {total}":
      "Passo {n} de {total}",
    "¿Con qué fuentes quieres empezar?":
      "Com quais fontes você quer começar?",
    "Elige la IA que responderá":
      "Escolha a IA que vai responder",
    "Algo no ha salido bien":
      "Algo não deu certo",
    "Preparando tu primera respuesta":
      "Preparando sua primeira resposta",
    "Trae unas pocas fuentes. En un par de minutos podrás hacerles preguntas y ver de qué pasaje sale cada respuesta.":
      "Traga algumas fontes. Em poucos minutos você poderá fazer perguntas a elas e ver de qual trecho vem cada resposta.",
    "Nodus usa la IA de tu proveedor: conecta tu clave y elige un modelo. El uso lo factura tu proveedor, no Nodus.":
      "O Nodus usa a IA do seu provedor: conecte sua chave e escolha um modelo. O uso é cobrado pelo seu provedor, não pelo Nodus.",
    "No tienes que hacer nada: en cuanto la primera fuente esté lista se abrirá el chat con una pregunta preparada.":
      "Você não precisa fazer nada: assim que a primeira fonte estiver pronta, o chat abrirá com uma pergunta preparada.",
    "Mi biblioteca de Zotero":
      "Minha biblioteca do Zotero",
    "Elige colecciones y Nodus las lee tal como están. No cambia nada en Zotero.":
      "Escolha coleções e o Nodus as lê como estão. Nada muda no Zotero.",
    "Zotero detectado":
      "Zotero detectado",
    "Zotero no detectado":
      "Zotero não detectado",
    "Archivos de mi ordenador":
      "Arquivos do meu computador",
    "PDF, EPUB, Word o texto. Puedes arrastrarlos aquí.":
      "PDF, EPUB, Word ou texto. Você pode arrastá-los para cá.",
    "{n} archivo(s)":
      "{n} arquivo(s)",
    "Un documento de ejemplo":
      "Um documento de exemplo",
    "Para ver cómo funciona antes de traer nada tuyo.":
      "Para ver como funciona antes de trazer algo seu.",
    "Elige una opción para continuar. Podrás añadir más fuentes de cualquier tipo cuando quieras.":
      "Escolha uma opção para continuar. Você poderá adicionar mais fontes de qualquer tipo quando quiser.",
    "Leyendo tus colecciones…":
      "Lendo suas coleções…",
    "Tu Zotero no tiene colecciones todavía. Crea una en Zotero con unas cuantas obras y aparecerá aquí, o empieza con archivos de tu ordenador.":
      "Seu Zotero ainda não tem coleções. Crie uma no Zotero com algumas obras e ela aparecerá aqui, ou comece com arquivos do seu computador.",
    "Marca una o varias colecciones. Para empezar basta con una pequeña: el resto de tu biblioteca podrás añadirlo después.":
      "Marque uma ou mais coleções. Para começar basta uma pequena: o restante da sua biblioteca pode ser adicionado depois.",
    "Arrastra aquí tus documentos o elígelos. Dos o tres bastan para la primera prueba.":
      "Arraste seus documentos para cá ou escolha-os. Dois ou três bastam para o primeiro teste.",
    "Añadir más":
      "Adicionar mais",
    "Prefiero una guía paso a paso":
      "Prefiro um guia passo a passo",
    "Abrir el ejemplo":
      "Abrir o exemplo",
    "Dejar lista la IA":
      "Deixar a IA pronta",
    "Traer tus fuentes":
      "Trazer suas fontes",
    "Leerlas y prepararlas para buscar":
      "Ler e preparar para a busca",
    "{n} fuente(s) en tu bóveda.":
      "{n} fonte(s) no seu cofre.",
    "Entrar en Nodus igualmente":
      "Entrar no Nodus mesmo assim",
    "Cambiar la IA":
      "Trocar a IA",
    "Cambiar las fuentes":
      "Trocar as fontes",
    "Un documento largo puede tardar unos minutos, sobre todo con un modelo en este equipo.":
      "Um documento longo pode levar alguns minutos, principalmente com um modelo neste computador.",
    "Seguir en segundo plano y entrar ya":
      "Continuar em segundo plano e entrar agora",
    "Descargando {name}. Solo ocurre la primera vez.":
      "Baixando {name}. Isso só acontece na primeira vez.",
    "Guardando tu elección…":
      "Salvando sua escolha…",
    "Leyendo tus colecciones de Zotero…":
      "Lendo suas coleções do Zotero…",
    "Copiando tus archivos a la biblioteca…":
      "Copiando seus arquivos para a biblioteca…",
    "Comprobando qué documentos tienen texto…":
      "Verificando quais documentos têm texto…",
    "«{title}»: {done} de {total} pasajes.":
      "“{title}”: {done} de {total} trechos.",
    "Leyendo «{title}»…":
      "Lendo “{title}”…",
    "No se ha encontrado ningún documento en lo que has elegido. Prueba con otra colección o con archivos de tu ordenador.":
      "Nenhum documento foi encontrado no que você escolheu. Tente outra coleção ou arquivos do seu computador.",
    "Estas referencias no tienen un PDF u otro archivo con texto, así que no hay nada que leer. Elige obras que tengan su archivo adjunto.":
      "Estas referências não têm um PDF nem outro arquivo com texto, então não há nada para ler. Escolha obras que tenham o arquivo anexado.",
    "Nodus no ha podido leer el texto de estos archivos. Suele pasar con PDF escaneados sin capa de texto. Prueba con otros documentos.":
      "O Nodus não conseguiu ler o texto destes arquivos. Costuma acontecer com PDFs digitalizados sem camada de texto. Tente outros documentos.",
    "Falta el modelo que prepara la búsqueda. Vuelve al paso anterior y elige dónde calcularla.":
      "Falta o modelo que prepara a busca. Volte ao passo anterior e escolha onde calculá-la.",
    "El servicio de IA ha rechazado la petición. Comprueba la clave y el modelo elegidos y vuelve a intentarlo.":
      "O serviço de IA rejeitou a solicitação. Verifique a chave e o modelo escolhidos e tente novamente.",
    "No se han podido preparar estas fuentes. Puedes reintentarlo o entrar en Nodus y prepararlas desde la Biblioteca.":
      "Não foi possível preparar estas fontes. Você pode tentar novamente ou entrar no Nodus e prepará-las pela Biblioteca.",
    "Una bóveda es tu espacio de trabajo: reúne tus fuentes y todo lo que hagas con ellas. Deja «Académico» si vienes a trabajar con tus lecturas. Podrás crear más bóvedas, de otros tipos, cuando quieras.":
      "Um cofre é o seu espaço de trabalho: reúne suas fontes e tudo o que você fizer com elas. Deixe “Acadêmico” se você veio trabalhar com suas leituras. Você poderá criar mais cofres, de outros tipos, quando quiser.",
    "Tu biblioteca está vacía":
      "Sua biblioteca está vazia",
    "Trae unas cuantas fuentes y podrás hacerles preguntas en el chat. Nodus solo lee tus archivos: no cambia nada en Zotero.":
      "Traga algumas fontes e você poderá fazer perguntas a elas no chat. O Nodus apenas lê seus arquivos: nada muda no Zotero.",
    "Traer de Zotero":
      "Trazer do Zotero",
    "Empezar ahora y protegerlo después":
      "Começar agora e proteger depois",
    "Nodus usará una carpeta propia en este ordenador y te recordará guardar el kit de recuperación más adelante.":
      "O Nodus usará uma pasta própria neste computador e lembrará você mais tarde de salvar o kit de recuperação.",
    "Este plugin es opcional y no sirve para importar. Para traer tu biblioteca de Zotero a Nodus basta con tener Zotero abierto: se hace desde Biblioteca, sin instalar nada.":
      "Este plugin é opcional e não serve para importar. Para trazer sua biblioteca do Zotero para o Nodus basta ter o Zotero aberto: isso é feito pela Biblioteca, sem instalar nada.",
  },
  it: {
    "{collections} colección(es) seleccionada(s), con sus subcolecciones. Nodus prepara primero unas pocas obras para que puedas probarlo ya.":
      "{collections} collezione/i selezionata/e, con le relative sottocollezioni. Nodus prepara prima alcune opere, così puoi provarlo subito.",
    "{n} obra(s) · {m} subcolección(es)":
      "{n} opera/e · {m} sottocollezione/i",
    "{m} subcolección(es)":
      "{m} sottocollezione/i",
    "{n} obra(s)":
      "{n} opera/e",
    "Ver subcolecciones de {name}":
      "Mostra le sottocollezioni di {name}",
    "No se pudieron leer las subcolecciones. Puedes marcar la colección completa.":
      "Impossibile leggere le sottocollezioni. Puoi selezionare l’intera collezione.",
    "Nodus lo comprueba solo cada pocos segundos y este aviso cambiará en cuanto Zotero responda.":
      "Nodus controlla da solo ogni pochi secondi e questo avviso cambierà appena Zotero risponde.",
    "Tu trabajo se guarda en {folder}, con copias cifradas automáticas. Guarda tu kit de recuperación para poder restaurarlo en otro ordenador.":
      "Il tuo lavoro è salvato in {folder}, con copie cifrate automatiche. Salva il kit di ripristino per poterlo ripristinare su un altro computer.",
    "¿Te has atascado? Todavía no hay ninguna fuente en esta bóveda. Podemos retomar los primeros pasos, o puedes contarnos qué te ha frenado.":
      "Ti sei bloccato? Questo vault non contiene ancora nessuna fonte. Possiamo riprendere i primi passi, oppure puoi dirci che cosa ti ha frenato.",
    "Retomar los primeros pasos":
      "Riprendi i primi passi",
    "Contar qué me ha frenado":
      "Dire che cosa mi ha frenato",
    "Conecta tu proveedor de IA":
      "Collega il tuo fornitore di IA",
    "Conecta primero un proveedor.":
      "Collega prima un fornitore.",
    "Búsqueda en tus fuentes":
      "Ricerca nelle tue fonti",
    "Para encontrar el pasaje exacto, Nodus prepara un índice de tus textos (embeddings). Elige dónde se calcula.":
      "Per trovare il passaggio esatto, Nodus prepara un indice dei tuoi testi (embeddings). Scegli dove viene calcolato.",
    "En este equipo":
      "Su questo computer",
    "Con un servicio externo (API)":
      "Con un servizio esterno (API)",
    "Gratis y privado: tus textos no salen del ordenador. La primera vez descarga el modelo elegido, de unos cientos de MB.":
      "Gratuito e privato: i tuoi testi non lasciano il computer. La prima volta scarica il modello scelto, di qualche centinaio di MB.",
    "No descarga nada y es rápido en cualquier equipo. Usa la clave de tu proveedor y tiene un coste pequeño.":
      "Non scarica nulla ed è veloce su qualsiasi computer. Usa la chiave del tuo fornitore e ha un costo ridotto.",
    "Ninguno de tus proveedores conectados ofrece este servicio. Lo ofrecen {list}: conecta uno de ellos, o elige «En este equipo».":
      "Nessuno dei fornitori collegati offre questo servizio. Lo offrono {list}: collegane uno, oppure scegli «Su questo computer».",
    "No se ha encontrado ningún modelo en este equipo.":
      "Nessun modello trovato su questo computer.",
    "Buscando Zotero…":
      "Ricerca di Zotero…",
    "Zotero ha respondido con un error":
      "Zotero ha risposto con un errore",
    "Zotero no está conectado ahora mismo":
      "Zotero non è collegato in questo momento",
    "Nodus todavía no puede leer tu Zotero":
      "Nodus non riesce ancora a leggere il tuo Zotero",
    "Abre Zotero en este ordenador (versión 7 o posterior).":
      "Apri Zotero su questo computer (versione 7 o successiva).",
    "En Zotero, ve a Ajustes → Avanzado y marca «Permitir que otras aplicaciones de este ordenador se comuniquen con Zotero».":
      "In Zotero, vai su Impostazioni → Avanzate e seleziona «Consenti ad altre applicazioni su questo computer di comunicare con Zotero».",
    "No necesitas el plugin «Nodus for Zotero» para importar tu biblioteca: el plugin es un chat dentro de Zotero y se configura aparte.":
      "Non serve il plugin «Nodus for Zotero» per importare la tua biblioteca: il plugin è una chat dentro Zotero e si configura a parte.",
    "Nodus lo comprueba solo cada pocos segundos: en cuanto Zotero responda, tu biblioteca aparecerá aquí.":
      "Nodus controlla da solo ogni pochi secondi: appena Zotero risponde, la tua biblioteca comparirà qui.",
    "Cuando lo hayas hecho, pulsa «Reintentar».":
      "Quando hai fatto, premi «Riprova».",
    "Conectado con Zotero":
      "Collegato a Zotero",
    "Nodus lee tu biblioteca directamente desde Zotero, en modo solo lectura. Para importar no hace falta el plugin «Nodus for Zotero».":
      "Nodus legge la tua biblioteca direttamente da Zotero, in sola lettura. Per importare non serve il plugin «Nodus for Zotero».",
    "Motor de IA local":
      "Motore di IA locale",
    "Paso {n} de {total}":
      "Passaggio {n} di {total}",
    "¿Con qué fuentes quieres empezar?":
      "Con quali fonti vuoi iniziare?",
    "Elige la IA que responderá":
      "Scegli l’IA che risponderà",
    "Algo no ha salido bien":
      "Qualcosa non è andato bene",
    "Preparando tu primera respuesta":
      "Preparazione della tua prima risposta",
    "Trae unas pocas fuentes. En un par de minutos podrás hacerles preguntas y ver de qué pasaje sale cada respuesta.":
      "Porta alcune fonti. In un paio di minuti potrai fare loro domande e vedere da quale passaggio proviene ogni risposta.",
    "Nodus usa la IA de tu proveedor: conecta tu clave y elige un modelo. El uso lo factura tu proveedor, no Nodus.":
      "Nodus usa l’IA del tuo fornitore: collega la tua chiave e scegli un modello. L’utilizzo è fatturato dal fornitore, non da Nodus.",
    "No tienes que hacer nada: en cuanto la primera fuente esté lista se abrirá el chat con una pregunta preparada.":
      "Non devi fare nulla: appena la prima fonte è pronta, la chat si aprirà con una domanda già preparata.",
    "Mi biblioteca de Zotero":
      "La mia biblioteca Zotero",
    "Elige colecciones y Nodus las lee tal como están. No cambia nada en Zotero.":
      "Scegli le collezioni e Nodus le legge così come sono. In Zotero non cambia nulla.",
    "Zotero detectado":
      "Zotero rilevato",
    "Zotero no detectado":
      "Zotero non rilevato",
    "Archivos de mi ordenador":
      "File del mio computer",
    "PDF, EPUB, Word o texto. Puedes arrastrarlos aquí.":
      "PDF, EPUB, Word o testo. Puoi trascinarli qui.",
    "{n} archivo(s)":
      "{n} file",
    "Un documento de ejemplo":
      "Un documento di esempio",
    "Para ver cómo funciona antes de traer nada tuyo.":
      "Per vedere come funziona prima di portare qualcosa di tuo.",
    "Elige una opción para continuar. Podrás añadir más fuentes de cualquier tipo cuando quieras.":
      "Scegli un’opzione per continuare. Potrai aggiungere altre fonti di qualsiasi tipo quando vuoi.",
    "Leyendo tus colecciones…":
      "Lettura delle tue collezioni…",
    "Tu Zotero no tiene colecciones todavía. Crea una en Zotero con unas cuantas obras y aparecerá aquí, o empieza con archivos de tu ordenador.":
      "Il tuo Zotero non ha ancora collezioni. Creane una in Zotero con alcune opere e comparirà qui, oppure inizia con i file del tuo computer.",
    "Marca una o varias colecciones. Para empezar basta con una pequeña: el resto de tu biblioteca podrás añadirlo después.":
      "Seleziona una o più collezioni. Per iniziare ne basta una piccola: il resto della biblioteca potrai aggiungerlo dopo.",
    "Arrastra aquí tus documentos o elígelos. Dos o tres bastan para la primera prueba.":
      "Trascina qui i tuoi documenti o sceglili. Due o tre bastano per una prima prova.",
    "Añadir más":
      "Aggiungi altri",
    "Prefiero una guía paso a paso":
      "Preferisco una guida passo passo",
    "Abrir el ejemplo":
      "Apri l’esempio",
    "Dejar lista la IA":
      "Preparare l’IA",
    "Traer tus fuentes":
      "Importare le tue fonti",
    "Leerlas y prepararlas para buscar":
      "Leggerle e prepararle per la ricerca",
    "{n} fuente(s) en tu bóveda.":
      "{n} fonte/i nel tuo vault.",
    "Entrar en Nodus igualmente":
      "Entra comunque in Nodus",
    "Cambiar la IA":
      "Cambia l’IA",
    "Cambiar las fuentes":
      "Cambia le fonti",
    "Un documento largo puede tardar unos minutos, sobre todo con un modelo en este equipo.":
      "Un documento lungo può richiedere alcuni minuti, soprattutto con un modello su questo computer.",
    "Seguir en segundo plano y entrar ya":
      "Continua in background ed entra subito",
    "Descargando {name}. Solo ocurre la primera vez.":
      "Download di {name}. Succede solo la prima volta.",
    "Guardando tu elección…":
      "Salvataggio della tua scelta…",
    "Leyendo tus colecciones de Zotero…":
      "Lettura delle tue collezioni Zotero…",
    "Copiando tus archivos a la biblioteca…":
      "Copia dei tuoi file nella biblioteca…",
    "Comprobando qué documentos tienen texto…":
      "Verifica di quali documenti hanno testo…",
    "«{title}»: {done} de {total} pasajes.":
      "«{title}»: {done} di {total} passaggi.",
    "Leyendo «{title}»…":
      "Lettura di «{title}»…",
    "No se ha encontrado ningún documento en lo que has elegido. Prueba con otra colección o con archivos de tu ordenador.":
      "Non è stato trovato alcun documento in ciò che hai scelto. Prova con un’altra collezione o con i file del tuo computer.",
    "Estas referencias no tienen un PDF u otro archivo con texto, así que no hay nada que leer. Elige obras que tengan su archivo adjunto.":
      "Questi riferimenti non hanno un PDF o un altro file con testo, quindi non c’è nulla da leggere. Scegli opere che abbiano il file allegato.",
    "Nodus no ha podido leer el texto de estos archivos. Suele pasar con PDF escaneados sin capa de texto. Prueba con otros documentos.":
      "Nodus non è riuscito a leggere il testo di questi file. Succede di solito con PDF scansionati senza livello di testo. Prova con altri documenti.",
    "Falta el modelo que prepara la búsqueda. Vuelve al paso anterior y elige dónde calcularla.":
      "Manca il modello che prepara la ricerca. Torna al passaggio precedente e scegli dove calcolarla.",
    "El servicio de IA ha rechazado la petición. Comprueba la clave y el modelo elegidos y vuelve a intentarlo.":
      "Il servizio di IA ha rifiutato la richiesta. Controlla la chiave e il modello scelti e riprova.",
    "No se han podido preparar estas fuentes. Puedes reintentarlo o entrar en Nodus y prepararlas desde la Biblioteca.":
      "Non è stato possibile preparare queste fonti. Puoi riprovare oppure entrare in Nodus e prepararle dalla Biblioteca.",
    "Una bóveda es tu espacio de trabajo: reúne tus fuentes y todo lo que hagas con ellas. Deja «Académico» si vienes a trabajar con tus lecturas. Podrás crear más bóvedas, de otros tipos, cuando quieras.":
      "Un vault è il tuo spazio di lavoro: raccoglie le tue fonti e tutto ciò che ne fai. Lascia «Accademico» se vuoi lavorare con le tue letture. Potrai creare altri vault, di altri tipi, quando vuoi.",
    "Tu biblioteca está vacía":
      "La tua biblioteca è vuota",
    "Trae unas cuantas fuentes y podrás hacerles preguntas en el chat. Nodus solo lee tus archivos: no cambia nada en Zotero.":
      "Porta alcune fonti e potrai fare loro domande nella chat. Nodus legge soltanto i tuoi file: in Zotero non cambia nulla.",
    "Traer de Zotero":
      "Importa da Zotero",
    "Empezar ahora y protegerlo después":
      "Inizia ora e proteggi dopo",
    "Nodus usará una carpeta propia en este ordenador y te recordará guardar el kit de recuperación más adelante.":
      "Nodus userà una propria cartella su questo computer e più avanti ti ricorderà di salvare il kit di ripristino.",
    "Este plugin es opcional y no sirve para importar. Para traer tu biblioteca de Zotero a Nodus basta con tener Zotero abierto: se hace desde Biblioteca, sin instalar nada.":
      "Questo plugin è facoltativo e non serve per importare. Per portare la tua biblioteca Zotero in Nodus basta avere Zotero aperto: si fa dalla Biblioteca, senza installare nulla.",
  },
  tr: {
    "{collections} colección(es) seleccionada(s), con sus subcolecciones. Nodus prepara primero unas pocas obras para que puedas probarlo ya.":
      "Alt koleksiyonlarıyla birlikte {collections} koleksiyon seçildi. Hemen deneyebilmen için Nodus önce birkaç eseri hazırlar.",
    "{n} obra(s) · {m} subcolección(es)":
      "{n} eser · {m} alt koleksiyon",
    "{m} subcolección(es)":
      "{m} alt koleksiyon",
    "{n} obra(s)":
      "{n} eser",
    "Ver subcolecciones de {name}":
      "{name} alt koleksiyonlarını göster",
    "No se pudieron leer las subcolecciones. Puedes marcar la colección completa.":
      "Alt koleksiyonlar okunamadı. Koleksiyonun tamamını işaretleyebilirsin.",
    "Nodus lo comprueba solo cada pocos segundos y este aviso cambiará en cuanto Zotero responda.":
      "Nodus birkaç saniyede bir kendiliğinden kontrol eder ve Zotero yanıt verir vermez bu uyarı değişir.",
    "Tu trabajo se guarda en {folder}, con copias cifradas automáticas. Guarda tu kit de recuperación para poder restaurarlo en otro ordenador.":
      "Çalışmaların {folder} klasöründe, otomatik şifreli yedeklerle saklanıyor. Başka bir bilgisayarda geri yükleyebilmek için kurtarma kitini kaydet.",
    "¿Te has atascado? Todavía no hay ninguna fuente en esta bóveda. Podemos retomar los primeros pasos, o puedes contarnos qué te ha frenado.":
      "Takıldın mı? Bu kasada henüz hiç kaynak yok. İlk adımlara geri dönebiliriz ya da seni neyin durdurduğunu bize anlatabilirsin.",
    "Retomar los primeros pasos":
      "İlk adımlara dön",
    "Contar qué me ha frenado":
      "Beni neyin durdurduğunu anlat",
    "Conecta tu proveedor de IA":
      "Yapay zekâ sağlayıcını bağla",
    "Conecta primero un proveedor.":
      "Önce bir sağlayıcı bağla.",
    "Búsqueda en tus fuentes":
      "Kaynaklarında arama",
    "Para encontrar el pasaje exacto, Nodus prepara un índice de tus textos (embeddings). Elige dónde se calcula.":
      "Tam bölümü bulmak için Nodus metinlerinin bir dizinini (embedding) hazırlar. Nerede hesaplanacağını seç.",
    "En este equipo":
      "Bu bilgisayarda",
    "Con un servicio externo (API)":
      "Harici bir hizmetle (API)",
    "Gratis y privado: tus textos no salen del ordenador. La primera vez descarga el modelo elegido, de unos cientos de MB.":
      "Ücretsiz ve gizli: metinlerin bilgisayardan çıkmaz. İlk seferde seçilen model indirilir (birkaç yüz MB).",
    "No descarga nada y es rápido en cualquier equipo. Usa la clave de tu proveedor y tiene un coste pequeño.":
      "Hiçbir şey indirmez ve her bilgisayarda hızlıdır. Sağlayıcının anahtarını kullanır ve küçük bir maliyeti vardır.",
    "Ninguno de tus proveedores conectados ofrece este servicio. Lo ofrecen {list}: conecta uno de ellos, o elige «En este equipo».":
      "Bağlı sağlayıcılarından hiçbiri bu hizmeti sunmuyor. {list} sunuyor: bunlardan birini bağla ya da “Bu bilgisayarda” seçeneğini seç.",
    "No se ha encontrado ningún modelo en este equipo.":
      "Bu bilgisayarda hiçbir model bulunamadı.",
    "Buscando Zotero…":
      "Zotero aranıyor…",
    "Zotero ha respondido con un error":
      "Zotero bir hatayla yanıt verdi",
    "Zotero no está conectado ahora mismo":
      "Zotero şu anda bağlı değil",
    "Nodus todavía no puede leer tu Zotero":
      "Nodus henüz Zotero’nu okuyamıyor",
    "Abre Zotero en este ordenador (versión 7 o posterior).":
      "Bu bilgisayarda Zotero’yu aç (sürüm 7 veya üzeri).",
    "En Zotero, ve a Ajustes → Avanzado y marca «Permitir que otras aplicaciones de este ordenador se comuniquen con Zotero».":
      "Zotero’da Ayarlar → Gelişmiş bölümüne git ve “Bu bilgisayardaki diğer uygulamaların Zotero ile iletişim kurmasına izin ver” seçeneğini işaretle.",
    "No necesitas el plugin «Nodus for Zotero» para importar tu biblioteca: el plugin es un chat dentro de Zotero y se configura aparte.":
      "Kütüphaneni içe aktarmak için “Nodus for Zotero” eklentisine ihtiyacın yok: eklenti Zotero içinde bir sohbettir ve ayrı olarak kurulur.",
    "Nodus lo comprueba solo cada pocos segundos: en cuanto Zotero responda, tu biblioteca aparecerá aquí.":
      "Nodus birkaç saniyede bir kendiliğinden kontrol eder: Zotero yanıt verir vermez kütüphanen burada görünür.",
    "Cuando lo hayas hecho, pulsa «Reintentar».":
      "Bunu yaptıktan sonra “Yeniden dene”ye bas.",
    "Conectado con Zotero":
      "Zotero’ya bağlı",
    "Nodus lee tu biblioteca directamente desde Zotero, en modo solo lectura. Para importar no hace falta el plugin «Nodus for Zotero».":
      "Nodus kütüphaneni doğrudan Zotero’dan, salt okunur olarak okur. İçe aktarmak için “Nodus for Zotero” eklentisi gerekmez.",
    "Motor de IA local":
      "Yerel yapay zekâ motoru",
    "Paso {n} de {total}":
      "Adım {n} / {total}",
    "¿Con qué fuentes quieres empezar?":
      "Hangi kaynaklarla başlamak istersin?",
    "Elige la IA que responderá":
      "Yanıt verecek yapay zekâyı seç",
    "Algo no ha salido bien":
      "Bir şeyler ters gitti",
    "Preparando tu primera respuesta":
      "İlk yanıtın hazırlanıyor",
    "Trae unas pocas fuentes. En un par de minutos podrás hacerles preguntas y ver de qué pasaje sale cada respuesta.":
      "Birkaç kaynak getir. Birkaç dakika içinde onlara soru sorabilecek ve her yanıtın hangi bölümden geldiğini görebileceksin.",
    "Nodus usa la IA de tu proveedor: conecta tu clave y elige un modelo. El uso lo factura tu proveedor, no Nodus.":
      "Nodus sağlayıcının yapay zekâsını kullanır: anahtarını bağla ve bir model seç. Kullanımı Nodus değil, sağlayıcın faturalandırır.",
    "No tienes que hacer nada: en cuanto la primera fuente esté lista se abrirá el chat con una pregunta preparada.":
      "Hiçbir şey yapmana gerek yok: ilk kaynak hazır olur olmaz sohbet, hazırlanmış bir soruyla açılacak.",
    "Mi biblioteca de Zotero":
      "Zotero kütüphanem",
    "Elige colecciones y Nodus las lee tal como están. No cambia nada en Zotero.":
      "Koleksiyonları seç, Nodus onları olduğu gibi okusun. Zotero’da hiçbir şey değişmez.",
    "Zotero detectado":
      "Zotero algılandı",
    "Zotero no detectado":
      "Zotero algılanmadı",
    "Archivos de mi ordenador":
      "Bilgisayarımdaki dosyalar",
    "PDF, EPUB, Word o texto. Puedes arrastrarlos aquí.":
      "PDF, EPUB, Word veya metin. Buraya sürükleyebilirsin.",
    "{n} archivo(s)":
      "{n} dosya",
    "Un documento de ejemplo":
      "Örnek bir belge",
    "Para ver cómo funciona antes de traer nada tuyo.":
      "Kendi belgelerini getirmeden önce nasıl çalıştığını görmek için.",
    "Elige una opción para continuar. Podrás añadir más fuentes de cualquier tipo cuando quieras.":
      "Devam etmek için bir seçenek seç. İstediğin zaman her türden başka kaynak ekleyebilirsin.",
    "Leyendo tus colecciones…":
      "Koleksiyonların okunuyor…",
    "Tu Zotero no tiene colecciones todavía. Crea una en Zotero con unas cuantas obras y aparecerá aquí, o empieza con archivos de tu ordenador.":
      "Zotero’nda henüz koleksiyon yok. Zotero’da birkaç eserle bir koleksiyon oluştur, burada görünecek; ya da bilgisayarındaki dosyalarla başla.",
    "Marca una o varias colecciones. Para empezar basta con una pequeña: el resto de tu biblioteca podrás añadirlo después.":
      "Bir veya birkaç koleksiyon işaretle. Başlamak için küçük bir tanesi yeter: kütüphanenin geri kalanını sonra ekleyebilirsin.",
    "Arrastra aquí tus documentos o elígelos. Dos o tres bastan para la primera prueba.":
      "Belgelerini buraya sürükle ya da seç. İlk deneme için iki üç tanesi yeter.",
    "Añadir más":
      "Daha fazla ekle",
    "Prefiero una guía paso a paso":
      "Adım adım bir rehber tercih ederim",
    "Abrir el ejemplo":
      "Örneği aç",
    "Dejar lista la IA":
      "Yapay zekâyı hazırla",
    "Traer tus fuentes":
      "Kaynaklarını getir",
    "Leerlas y prepararlas para buscar":
      "Okuyup arama için hazırla",
    "{n} fuente(s) en tu bóveda.":
      "Kasanda {n} kaynak var.",
    "Entrar en Nodus igualmente":
      "Yine de Nodus’a gir",
    "Cambiar la IA":
      "Yapay zekâyı değiştir",
    "Cambiar las fuentes":
      "Kaynakları değiştir",
    "Un documento largo puede tardar unos minutos, sobre todo con un modelo en este equipo.":
      "Uzun bir belge, özellikle bu bilgisayardaki bir modelle birkaç dakika sürebilir.",
    "Seguir en segundo plano y entrar ya":
      "Arka planda devam et ve şimdi gir",
    "Descargando {name}. Solo ocurre la primera vez.":
      "{name} indiriliyor. Bu yalnızca ilk seferde olur.",
    "Guardando tu elección…":
      "Seçimin kaydediliyor…",
    "Leyendo tus colecciones de Zotero…":
      "Zotero koleksiyonların okunuyor…",
    "Copiando tus archivos a la biblioteca…":
      "Dosyaların kütüphaneye kopyalanıyor…",
    "Comprobando qué documentos tienen texto…":
      "Hangi belgelerde metin olduğu kontrol ediliyor…",
    "«{title}»: {done} de {total} pasajes.":
      "“{title}”: {total} bölümden {done}.",
    "Leyendo «{title}»…":
      "“{title}” okunuyor…",
    "No se ha encontrado ningún documento en lo que has elegido. Prueba con otra colección o con archivos de tu ordenador.":
      "Seçtiklerinde hiçbir belge bulunamadı. Başka bir koleksiyon ya da bilgisayarındaki dosyaları dene.",
    "Estas referencias no tienen un PDF u otro archivo con texto, así que no hay nada que leer. Elige obras que tengan su archivo adjunto.":
      "Bu kaynakçalarda PDF ya da metin içeren başka bir dosya yok, bu yüzden okunacak bir şey yok. Dosyası ekli olan eserleri seç.",
    "Nodus no ha podido leer el texto de estos archivos. Suele pasar con PDF escaneados sin capa de texto. Prueba con otros documentos.":
      "Nodus bu dosyaların metnini okuyamadı. Genellikle metin katmanı olmayan taranmış PDF’lerde olur. Başka belgelerle dene.",
    "Falta el modelo que prepara la búsqueda. Vuelve al paso anterior y elige dónde calcularla.":
      "Aramayı hazırlayan model eksik. Önceki adıma dön ve nerede hesaplanacağını seç.",
    "El servicio de IA ha rechazado la petición. Comprueba la clave y el modelo elegidos y vuelve a intentarlo.":
      "Yapay zekâ hizmeti isteği reddetti. Seçtiğin anahtarı ve modeli kontrol edip yeniden dene.",
    "No se han podido preparar estas fuentes. Puedes reintentarlo o entrar en Nodus y prepararlas desde la Biblioteca.":
      "Bu kaynaklar hazırlanamadı. Yeniden deneyebilir ya da Nodus’a girip onları Kütüphane’den hazırlayabilirsin.",
    "Una bóveda es tu espacio de trabajo: reúne tus fuentes y todo lo que hagas con ellas. Deja «Académico» si vienes a trabajar con tus lecturas. Podrás crear más bóvedas, de otros tipos, cuando quieras.":
      "Kasa senin çalışma alanındır: kaynaklarını ve onlarla yaptığın her şeyi bir arada tutar. Okumalarınla çalışmak için geldiysen “Akademik” seçili kalsın. İstediğin zaman başka türlerde yeni kasalar oluşturabilirsin.",
    "Tu biblioteca está vacía":
      "Kütüphanen boş",
    "Trae unas cuantas fuentes y podrás hacerles preguntas en el chat. Nodus solo lee tus archivos: no cambia nada en Zotero.":
      "Birkaç kaynak getir, sohbette onlara soru sorabilirsin. Nodus dosyalarını yalnızca okur: Zotero’da hiçbir şey değişmez.",
    "Traer de Zotero":
      "Zotero’dan getir",
    "Empezar ahora y protegerlo después":
      "Şimdi başla, sonra koru",
    "Nodus usará una carpeta propia en este ordenador y te recordará guardar el kit de recuperación más adelante.":
      "Nodus bu bilgisayarda kendi klasörünü kullanacak ve kurtarma kitini kaydetmeni daha sonra hatırlatacak.",
    "Este plugin es opcional y no sirve para importar. Para traer tu biblioteca de Zotero a Nodus basta con tener Zotero abierto: se hace desde Biblioteca, sin instalar nada.":
      "Bu eklenti isteğe bağlıdır ve içe aktarmak için kullanılmaz. Zotero kütüphaneni Nodus’a getirmek için Zotero’nun açık olması yeterlidir: bu işlem Kütüphane’den, hiçbir şey kurmadan yapılır.",
  },
  "zh-CN": {
    "{collections} colección(es) seleccionada(s), con sus subcolecciones. Nodus prepara primero unas pocas obras para que puedas probarlo ya.":
      "已选择 {collections} 个合集（含其子合集）。Nodus 会先准备其中几份文献，让你马上就能试用。",
    "{n} obra(s) · {m} subcolección(es)":
      "{n} 份文献 · {m} 个子合集",
    "{m} subcolección(es)":
      "{m} 个子合集",
    "{n} obra(s)":
      "{n} 份文献",
    "Ver subcolecciones de {name}":
      "查看 {name} 的子合集",
    "No se pudieron leer las subcolecciones. Puedes marcar la colección completa.":
      "无法读取子合集。你可以勾选整个合集。",
    "Nodus lo comprueba solo cada pocos segundos y este aviso cambiará en cuanto Zotero responda.":
      "Nodus 每隔几秒会自动检查，Zotero 一有响应，此提示就会更新。",
    "Tu trabajo se guarda en {folder}, con copias cifradas automáticas. Guarda tu kit de recuperación para poder restaurarlo en otro ordenador.":
      "你的工作保存在 {folder} 中，并自动创建加密备份。请保存恢复工具包，以便在另一台电脑上恢复。",
    "¿Te has atascado? Todavía no hay ninguna fuente en esta bóveda. Podemos retomar los primeros pasos, o puedes contarnos qué te ha frenado.":
      "遇到困难了吗？这个资料库里还没有任何来源。我们可以重新开始最初的步骤，你也可以告诉我们是什么阻碍了你。",
    "Retomar los primeros pasos":
      "重新开始最初的步骤",
    "Contar qué me ha frenado":
      "说明是什么阻碍了我",
    "Conecta tu proveedor de IA":
      "连接你的 AI 服务商",
    "Conecta primero un proveedor.":
      "请先连接一个服务商。",
    "Búsqueda en tus fuentes":
      "在你的来源中搜索",
    "Para encontrar el pasaje exacto, Nodus prepara un índice de tus textos (embeddings). Elige dónde se calcula.":
      "为了找到确切的段落，Nodus 会为你的文本建立索引（嵌入）。请选择在哪里计算。",
    "En este equipo":
      "在这台电脑上",
    "Con un servicio externo (API)":
      "使用外部服务（API）",
    "Gratis y privado: tus textos no salen del ordenador. La primera vez descarga el modelo elegido, de unos cientos de MB.":
      "免费且私密：你的文本不会离开电脑。首次使用时会下载所选模型，大小约几百 MB。",
    "No descarga nada y es rápido en cualquier equipo. Usa la clave de tu proveedor y tiene un coste pequeño.":
      "无需下载，在任何电脑上都很快。使用你的服务商密钥，会产生少量费用。",
    "Ninguno de tus proveedores conectados ofrece este servicio. Lo ofrecen {list}: conecta uno de ellos, o elige «En este equipo».":
      "你已连接的服务商都不提供此服务。提供此服务的有 {list}：请连接其中之一，或选择“在这台电脑上”。",
    "No se ha encontrado ningún modelo en este equipo.":
      "在这台电脑上未找到任何模型。",
    "Buscando Zotero…":
      "正在查找 Zotero…",
    "Zotero ha respondido con un error":
      "Zotero 返回了错误",
    "Zotero no está conectado ahora mismo":
      "Zotero 当前未连接",
    "Nodus todavía no puede leer tu Zotero":
      "Nodus 还无法读取你的 Zotero",
    "Abre Zotero en este ordenador (versión 7 o posterior).":
      "在这台电脑上打开 Zotero（7 或更高版本）。",
    "En Zotero, ve a Ajustes → Avanzado y marca «Permitir que otras aplicaciones de este ordenador se comuniquen con Zotero».":
      "在 Zotero 中打开 设置 → 高级，勾选“允许此计算机上的其他应用程序与 Zotero 通讯”。",
    "No necesitas el plugin «Nodus for Zotero» para importar tu biblioteca: el plugin es un chat dentro de Zotero y se configura aparte.":
      "导入文献库不需要“Nodus for Zotero”插件：该插件是 Zotero 内的聊天功能，需单独设置。",
    "Nodus lo comprueba solo cada pocos segundos: en cuanto Zotero responda, tu biblioteca aparecerá aquí.":
      "Nodus 每隔几秒会自动检查：Zotero 一有响应，你的文献库就会显示在这里。",
    "Cuando lo hayas hecho, pulsa «Reintentar».":
      "完成后，请点击“重试”。",
    "Conectado con Zotero":
      "已连接到 Zotero",
    "Nodus lee tu biblioteca directamente desde Zotero, en modo solo lectura. Para importar no hace falta el plugin «Nodus for Zotero».":
      "Nodus 以只读方式直接从 Zotero 读取你的文献库。导入不需要“Nodus for Zotero”插件。",
    "Motor de IA local":
      "本地 AI 引擎",
    "Paso {n} de {total}":
      "第 {n} 步，共 {total} 步",
    "¿Con qué fuentes quieres empezar?":
      "你想从哪些来源开始？",
    "Elige la IA que responderá":
      "选择用来回答的 AI",
    "Algo no ha salido bien":
      "出了点问题",
    "Preparando tu primera respuesta":
      "正在准备你的第一个回答",
    "Trae unas pocas fuentes. En un par de minutos podrás hacerles preguntas y ver de qué pasaje sale cada respuesta.":
      "带来几份来源。几分钟后，你就可以向它们提问，并看到每个回答出自哪个段落。",
    "Nodus usa la IA de tu proveedor: conecta tu clave y elige un modelo. El uso lo factura tu proveedor, no Nodus.":
      "Nodus 使用你的服务商提供的 AI：连接密钥并选择模型。使用费用由服务商收取，而非 Nodus。",
    "No tienes que hacer nada: en cuanto la primera fuente esté lista se abrirá el chat con una pregunta preparada.":
      "你无需进行任何操作：第一份来源准备好后，聊天会自动打开并填好一个问题。",
    "Mi biblioteca de Zotero":
      "我的 Zotero 文献库",
    "Elige colecciones y Nodus las lee tal como están. No cambia nada en Zotero.":
      "选择合集，Nodus 会按原样读取。Zotero 中不会有任何更改。",
    "Zotero detectado":
      "已检测到 Zotero",
    "Zotero no detectado":
      "未检测到 Zotero",
    "Archivos de mi ordenador":
      "我电脑上的文件",
    "PDF, EPUB, Word o texto. Puedes arrastrarlos aquí.":
      "PDF、EPUB、Word 或文本。可以拖到这里。",
    "{n} archivo(s)":
      "{n} 个文件",
    "Un documento de ejemplo":
      "一份示例文档",
    "Para ver cómo funciona antes de traer nada tuyo.":
      "在带来自己的资料之前，先看看它是如何工作的。",
    "Elige una opción para continuar. Podrás añadir más fuentes de cualquier tipo cuando quieras.":
      "请选择一个选项以继续。之后可以随时添加任何类型的更多来源。",
    "Leyendo tus colecciones…":
      "正在读取你的合集…",
    "Tu Zotero no tiene colecciones todavía. Crea una en Zotero con unas cuantas obras y aparecerá aquí, o empieza con archivos de tu ordenador.":
      "你的 Zotero 还没有合集。请在 Zotero 中创建一个并放入几份文献，它就会显示在这里；也可以从电脑上的文件开始。",
    "Marca una o varias colecciones. Para empezar basta con una pequeña: el resto de tu biblioteca podrás añadirlo después.":
      "勾选一个或多个合集。开始时选一个小的就够了：文献库的其余部分可以之后再添加。",
    "Arrastra aquí tus documentos o elígelos. Dos o tres bastan para la primera prueba.":
      "把文档拖到这里，或选择文档。初次试用两三份就够了。",
    "Añadir más":
      "添加更多",
    "Prefiero una guía paso a paso":
      "我想要分步指南",
    "Abrir el ejemplo":
      "打开示例",
    "Dejar lista la IA":
      "准备好 AI",
    "Traer tus fuentes":
      "导入你的来源",
    "Leerlas y prepararlas para buscar":
      "读取并为搜索做好准备",
    "{n} fuente(s) en tu bóveda.":
      "资料库中有 {n} 份来源。",
    "Entrar en Nodus igualmente":
      "仍然进入 Nodus",
    "Cambiar la IA":
      "更换 AI",
    "Cambiar las fuentes":
      "更换来源",
    "Un documento largo puede tardar unos minutos, sobre todo con un modelo en este equipo.":
      "较长的文档可能需要几分钟，尤其是使用这台电脑上的模型时。",
    "Seguir en segundo plano y entrar ya":
      "在后台继续并立即进入",
    "Descargando {name}. Solo ocurre la primera vez.":
      "正在下载 {name}。仅首次需要。",
    "Guardando tu elección…":
      "正在保存你的选择…",
    "Leyendo tus colecciones de Zotero…":
      "正在读取你的 Zotero 合集…",
    "Copiando tus archivos a la biblioteca…":
      "正在将你的文件复制到文献库…",
    "Comprobando qué documentos tienen texto…":
      "正在检查哪些文档包含文本…",
    "«{title}»: {done} de {total} pasajes.":
      "“{title}”：已完成 {done} / {total} 个段落。",
    "Leyendo «{title}»…":
      "正在读取“{title}”…",
    "No se ha encontrado ningún documento en lo que has elegido. Prueba con otra colección o con archivos de tu ordenador.":
      "在你选择的内容中未找到任何文档。请尝试其他合集，或使用电脑上的文件。",
    "Estas referencias no tienen un PDF u otro archivo con texto, así que no hay nada que leer. Elige obras que tengan su archivo adjunto.":
      "这些条目没有 PDF 或其他包含文本的文件，因此没有可读取的内容。请选择带有附件的文献。",
    "Nodus no ha podido leer el texto de estos archivos. Suele pasar con PDF escaneados sin capa de texto. Prueba con otros documentos.":
      "Nodus 无法读取这些文件的文本。这通常发生在没有文本层的扫描版 PDF 上。请尝试其他文档。",
    "Falta el modelo que prepara la búsqueda. Vuelve al paso anterior y elige dónde calcularla.":
      "缺少用于准备搜索的模型。请返回上一步，选择在哪里计算。",
    "El servicio de IA ha rechazado la petición. Comprueba la clave y el modelo elegidos y vuelve a intentarlo.":
      "AI 服务拒绝了请求。请检查所选的密钥和模型后重试。",
    "No se han podido preparar estas fuentes. Puedes reintentarlo o entrar en Nodus y prepararlas desde la Biblioteca.":
      "无法准备这些来源。你可以重试，或进入 Nodus 后在文献库中准备。",
    "Una bóveda es tu espacio de trabajo: reúne tus fuentes y todo lo que hagas con ellas. Deja «Académico» si vienes a trabajar con tus lecturas. Podrás crear más bóvedas, de otros tipos, cuando quieras.":
      "资料库是你的工作空间：它汇集你的来源以及你用它们完成的一切。如果你是来处理自己的阅读材料，请保留“学术”。之后可以随时创建其他类型的资料库。",
    "Tu biblioteca está vacía":
      "你的文献库是空的",
    "Trae unas cuantas fuentes y podrás hacerles preguntas en el chat. Nodus solo lee tus archivos: no cambia nada en Zotero.":
      "带来几份来源，就可以在聊天中向它们提问。Nodus 只读取你的文件：Zotero 中不会有任何更改。",
    "Traer de Zotero":
      "从 Zotero 导入",
    "Empezar ahora y protegerlo después":
      "立即开始，稍后再设置保护",
    "Nodus usará una carpeta propia en este ordenador y te recordará guardar el kit de recuperación más adelante.":
      "Nodus 将在这台电脑上使用自己的文件夹，并在之后提醒你保存恢复工具包。",
    "Este plugin es opcional y no sirve para importar. Para traer tu biblioteca de Zotero a Nodus basta con tener Zotero abierto: se hace desde Biblioteca, sin instalar nada.":
      "此插件为可选项，并不用于导入。要将 Zotero 文献库导入 Nodus，只需保持 Zotero 打开：在文献库中即可完成，无需安装任何东西。",
  },
  "zh-TW": {
    "{collections} colección(es) seleccionada(s), con sus subcolecciones. Nodus prepara primero unas pocas obras para que puedas probarlo ya.":
      "已選擇 {collections} 個合集（含其子合集）。Nodus 會先準備其中幾份文獻，讓你馬上就能試用。",
    "{n} obra(s) · {m} subcolección(es)":
      "{n} 份文獻 · {m} 個子合集",
    "{m} subcolección(es)":
      "{m} 個子合集",
    "{n} obra(s)":
      "{n} 份文獻",
    "Ver subcolecciones de {name}":
      "查看 {name} 的子合集",
    "No se pudieron leer las subcolecciones. Puedes marcar la colección completa.":
      "無法讀取子合集。你可以勾選整個合集。",
    "Nodus lo comprueba solo cada pocos segundos y este aviso cambiará en cuanto Zotero responda.":
      "Nodus 每隔幾秒會自動檢查，Zotero 一有回應，此提示就會更新。",
    "Tu trabajo se guarda en {folder}, con copias cifradas automáticas. Guarda tu kit de recuperación para poder restaurarlo en otro ordenador.":
      "你的工作儲存在 {folder} 中，並自動建立加密備份。請儲存恢復工具包，以便在另一台電腦上恢復。",
    "¿Te has atascado? Todavía no hay ninguna fuente en esta bóveda. Podemos retomar los primeros pasos, o puedes contarnos qué te ha frenado.":
      "遇到困難了嗎？這個知識庫裡還沒有任何來源。我們可以重新開始最初的步驟，你也可以告訴我們是什麼阻礙了你。",
    "Retomar los primeros pasos":
      "重新開始最初的步驟",
    "Contar qué me ha frenado":
      "說明是什麼阻礙了我",
    "Conecta tu proveedor de IA":
      "連接你的 AI 服務商",
    "Conecta primero un proveedor.":
      "請先連接一個服務商。",
    "Búsqueda en tus fuentes":
      "在你的來源中搜尋",
    "Para encontrar el pasaje exacto, Nodus prepara un índice de tus textos (embeddings). Elige dónde se calcula.":
      "為了找到確切的段落，Nodus 會為你的文字建立索引（嵌入）。請選擇在哪裡計算。",
    "En este equipo":
      "在這台電腦上",
    "Con un servicio externo (API)":
      "使用外部服務（API）",
    "Gratis y privado: tus textos no salen del ordenador. La primera vez descarga el modelo elegido, de unos cientos de MB.":
      "免費且私密：你的文字不會離開電腦。首次使用時會下載所選模型，大小約幾百 MB。",
    "No descarga nada y es rápido en cualquier equipo. Usa la clave de tu proveedor y tiene un coste pequeño.":
      "無需下載，在任何電腦上都很快。使用你的服務商金鑰，會產生少量費用。",
    "Ninguno de tus proveedores conectados ofrece este servicio. Lo ofrecen {list}: conecta uno de ellos, o elige «En este equipo».":
      "你已連接的服務商都不提供此服務。提供此服務的有 {list}：請連接其中之一，或選擇「在這台電腦上」。",
    "No se ha encontrado ningún modelo en este equipo.":
      "在這台電腦上未找到任何模型。",
    "Buscando Zotero…":
      "正在尋找 Zotero…",
    "Zotero ha respondido con un error":
      "Zotero 回傳了錯誤",
    "Zotero no está conectado ahora mismo":
      "Zotero 目前未連接",
    "Nodus todavía no puede leer tu Zotero":
      "Nodus 還無法讀取你的 Zotero",
    "Abre Zotero en este ordenador (versión 7 o posterior).":
      "在這台電腦上開啟 Zotero（7 或更新版本）。",
    "En Zotero, ve a Ajustes → Avanzado y marca «Permitir que otras aplicaciones de este ordenador se comuniquen con Zotero».":
      "在 Zotero 中開啟 設定 → 進階，勾選「允許此電腦上的其他應用程式與 Zotero 通訊」。",
    "No necesitas el plugin «Nodus for Zotero» para importar tu biblioteca: el plugin es un chat dentro de Zotero y se configura aparte.":
      "匯入文獻庫不需要「Nodus for Zotero」外掛：該外掛是 Zotero 內的聊天功能，需另外設定。",
    "Nodus lo comprueba solo cada pocos segundos: en cuanto Zotero responda, tu biblioteca aparecerá aquí.":
      "Nodus 每隔幾秒會自動檢查：Zotero 一有回應，你的文獻庫就會顯示在這裡。",
    "Cuando lo hayas hecho, pulsa «Reintentar».":
      "完成後，請點擊「重試」。",
    "Conectado con Zotero":
      "已連接到 Zotero",
    "Nodus lee tu biblioteca directamente desde Zotero, en modo solo lectura. Para importar no hace falta el plugin «Nodus for Zotero».":
      "Nodus 以唯讀方式直接從 Zotero 讀取你的文獻庫。匯入不需要「Nodus for Zotero」外掛。",
    "Motor de IA local":
      "本機 AI 引擎",
    "Paso {n} de {total}":
      "第 {n} 步，共 {total} 步",
    "¿Con qué fuentes quieres empezar?":
      "你想從哪些來源開始？",
    "Elige la IA que responderá":
      "選擇用來回答的 AI",
    "Algo no ha salido bien":
      "出了點問題",
    "Preparando tu primera respuesta":
      "正在準備你的第一個回答",
    "Trae unas pocas fuentes. En un par de minutos podrás hacerles preguntas y ver de qué pasaje sale cada respuesta.":
      "帶來幾份來源。幾分鐘後，你就可以向它們提問，並看到每個回答出自哪個段落。",
    "Nodus usa la IA de tu proveedor: conecta tu clave y elige un modelo. El uso lo factura tu proveedor, no Nodus.":
      "Nodus 使用你的服務商提供的 AI：連接金鑰並選擇模型。使用費用由服務商收取，而非 Nodus。",
    "No tienes que hacer nada: en cuanto la primera fuente esté lista se abrirá el chat con una pregunta preparada.":
      "你無需進行任何操作：第一份來源準備好後，聊天會自動開啟並填好一個問題。",
    "Mi biblioteca de Zotero":
      "我的 Zotero 文獻庫",
    "Elige colecciones y Nodus las lee tal como están. No cambia nada en Zotero.":
      "選擇合集，Nodus 會按原樣讀取。Zotero 中不會有任何變更。",
    "Zotero detectado":
      "已偵測到 Zotero",
    "Zotero no detectado":
      "未偵測到 Zotero",
    "Archivos de mi ordenador":
      "我電腦上的檔案",
    "PDF, EPUB, Word o texto. Puedes arrastrarlos aquí.":
      "PDF、EPUB、Word 或文字。可以拖到這裡。",
    "{n} archivo(s)":
      "{n} 個檔案",
    "Un documento de ejemplo":
      "一份範例文件",
    "Para ver cómo funciona antes de traer nada tuyo.":
      "在帶來自己的資料之前，先看看它是如何運作的。",
    "Elige una opción para continuar. Podrás añadir más fuentes de cualquier tipo cuando quieras.":
      "請選擇一個選項以繼續。之後可以隨時新增任何類型的更多來源。",
    "Leyendo tus colecciones…":
      "正在讀取你的合集…",
    "Tu Zotero no tiene colecciones todavía. Crea una en Zotero con unas cuantas obras y aparecerá aquí, o empieza con archivos de tu ordenador.":
      "你的 Zotero 還沒有合集。請在 Zotero 中建立一個並放入幾份文獻，它就會顯示在這裡；也可以從電腦上的檔案開始。",
    "Marca una o varias colecciones. Para empezar basta con una pequeña: el resto de tu biblioteca podrás añadirlo después.":
      "勾選一個或多個合集。開始時選一個小的就夠了：文獻庫的其餘部分可以之後再新增。",
    "Arrastra aquí tus documentos o elígelos. Dos o tres bastan para la primera prueba.":
      "把文件拖到這裡，或選擇文件。初次試用兩三份就夠了。",
    "Añadir más":
      "新增更多",
    "Prefiero una guía paso a paso":
      "我想要逐步指南",
    "Abrir el ejemplo":
      "開啟範例",
    "Dejar lista la IA":
      "準備好 AI",
    "Traer tus fuentes":
      "匯入你的來源",
    "Leerlas y prepararlas para buscar":
      "讀取並為搜尋做好準備",
    "{n} fuente(s) en tu bóveda.":
      "知識庫中有 {n} 份來源。",
    "Entrar en Nodus igualmente":
      "仍然進入 Nodus",
    "Cambiar la IA":
      "更換 AI",
    "Cambiar las fuentes":
      "更換來源",
    "Un documento largo puede tardar unos minutos, sobre todo con un modelo en este equipo.":
      "較長的文件可能需要幾分鐘，尤其是使用這台電腦上的模型時。",
    "Seguir en segundo plano y entrar ya":
      "在背景繼續並立即進入",
    "Descargando {name}. Solo ocurre la primera vez.":
      "正在下載 {name}。僅首次需要。",
    "Guardando tu elección…":
      "正在儲存你的選擇…",
    "Leyendo tus colecciones de Zotero…":
      "正在讀取你的 Zotero 合集…",
    "Copiando tus archivos a la biblioteca…":
      "正在將你的檔案複製到文獻庫…",
    "Comprobando qué documentos tienen texto…":
      "正在檢查哪些文件包含文字…",
    "«{title}»: {done} de {total} pasajes.":
      "「{title}」：已完成 {done} / {total} 個段落。",
    "Leyendo «{title}»…":
      "正在讀取「{title}」…",
    "No se ha encontrado ningún documento en lo que has elegido. Prueba con otra colección o con archivos de tu ordenador.":
      "在你選擇的內容中未找到任何文件。請嘗試其他合集，或使用電腦上的檔案。",
    "Estas referencias no tienen un PDF u otro archivo con texto, así que no hay nada que leer. Elige obras que tengan su archivo adjunto.":
      "這些條目沒有 PDF 或其他包含文字的檔案，因此沒有可讀取的內容。請選擇附有檔案的文獻。",
    "Nodus no ha podido leer el texto de estos archivos. Suele pasar con PDF escaneados sin capa de texto. Prueba con otros documentos.":
      "Nodus 無法讀取這些檔案的文字。這通常發生在沒有文字層的掃描版 PDF 上。請嘗試其他文件。",
    "Falta el modelo que prepara la búsqueda. Vuelve al paso anterior y elige dónde calcularla.":
      "缺少用於準備搜尋的模型。請返回上一步，選擇在哪裡計算。",
    "El servicio de IA ha rechazado la petición. Comprueba la clave y el modelo elegidos y vuelve a intentarlo.":
      "AI 服務拒絕了請求。請檢查所選的金鑰和模型後重試。",
    "No se han podido preparar estas fuentes. Puedes reintentarlo o entrar en Nodus y prepararlas desde la Biblioteca.":
      "無法準備這些來源。你可以重試，或進入 Nodus 後在文獻庫中準備。",
    "Una bóveda es tu espacio de trabajo: reúne tus fuentes y todo lo que hagas con ellas. Deja «Académico» si vienes a trabajar con tus lecturas. Podrás crear más bóvedas, de otros tipos, cuando quieras.":
      "知識庫是你的工作空間：它匯集你的來源以及你用它們完成的一切。如果你是來處理自己的閱讀材料，請保留「學術」。之後可以隨時建立其他類型的知識庫。",
    "Tu biblioteca está vacía":
      "你的文獻庫是空的",
    "Trae unas cuantas fuentes y podrás hacerles preguntas en el chat. Nodus solo lee tus archivos: no cambia nada en Zotero.":
      "帶來幾份來源，就可以在聊天中向它們提問。Nodus 只讀取你的檔案：Zotero 中不會有任何變更。",
    "Traer de Zotero":
      "從 Zotero 匯入",
    "Empezar ahora y protegerlo después":
      "立即開始，稍後再設定保護",
    "Nodus usará una carpeta propia en este ordenador y te recordará guardar el kit de recuperación más adelante.":
      "Nodus 將在這台電腦上使用自己的資料夾，並在之後提醒你儲存恢復工具包。",
    "Este plugin es opcional y no sirve para importar. Para traer tu biblioteca de Zotero a Nodus basta con tener Zotero abierto: se hace desde Biblioteca, sin instalar nada.":
      "此外掛為選用項目，並不用於匯入。要將 Zotero 文獻庫匯入 Nodus，只需保持 Zotero 開啟：在文獻庫中即可完成，無需安裝任何東西。",
  },
  ja: {
    "{collections} colección(es) seleccionada(s), con sus subcolecciones. Nodus prepara primero unas pocas obras para que puedas probarlo ya.":
      "コレクション {collections} 件を選択しました（サブコレクションを含む）。すぐに試せるよう、Nodus はまず数件の資料を準備します。",
    "{n} obra(s) · {m} subcolección(es)":
      "資料 {n} 件 · サブコレクション {m} 件",
    "{m} subcolección(es)":
      "サブコレクション {m} 件",
    "{n} obra(s)":
      "資料 {n} 件",
    "Ver subcolecciones de {name}":
      "{name} のサブコレクションを表示",
    "No se pudieron leer las subcolecciones. Puedes marcar la colección completa.":
      "サブコレクションを読み込めませんでした。コレクション全体を選択できます。",
    "Nodus lo comprueba solo cada pocos segundos y este aviso cambiará en cuanto Zotero responda.":
      "Nodus が数秒ごとに自動で確認し、Zotero が応答するとこの表示が切り替わります。",
    "Tu trabajo se guarda en {folder}, con copias cifradas automáticas. Guarda tu kit de recuperación para poder restaurarlo en otro ordenador.":
      "作業内容は {folder} に保存され、暗号化バックアップが自動で作成されます。別のコンピューターで復元できるよう、リカバリーキットを保存してください。",
    "¿Te has atascado? Todavía no hay ninguna fuente en esta bóveda. Podemos retomar los primeros pasos, o puedes contarnos qué te ha frenado.":
      "行き詰まっていますか？この Vault にはまだ出典がありません。最初の手順をやり直すことも、何が妨げになったかを教えていただくこともできます。",
    "Retomar los primeros pasos":
      "最初の手順をやり直す",
    "Contar qué me ha frenado":
      "何が妨げになったか伝える",
    "Conecta tu proveedor de IA":
      "AI プロバイダーを接続",
    "Conecta primero un proveedor.":
      "先にプロバイダーを接続してください。",
    "Búsqueda en tus fuentes":
      "出典内の検索",
    "Para encontrar el pasaje exacto, Nodus prepara un índice de tus textos (embeddings). Elige dónde se calcula.":
      "正確な箇所を見つけるため、Nodus はテキストの索引（埋め込み）を作成します。どこで計算するかを選んでください。",
    "En este equipo":
      "このコンピューターで",
    "Con un servicio externo (API)":
      "外部サービスで（API）",
    "Gratis y privado: tus textos no salen del ordenador. La primera vez descarga el modelo elegido, de unos cientos de MB.":
      "無料でプライベート：テキストはコンピューターの外に出ません。初回は選択したモデル（数百 MB）をダウンロードします。",
    "No descarga nada y es rápido en cualquier equipo. Usa la clave de tu proveedor y tiene un coste pequeño.":
      "ダウンロード不要で、どのコンピューターでも高速です。プロバイダーのキーを使用し、少額の費用がかかります。",
    "Ninguno de tus proveedores conectados ofrece este servicio. Lo ofrecen {list}: conecta uno de ellos, o elige «En este equipo».":
      "接続済みのプロバイダーはこのサービスを提供していません。{list} が提供しています。いずれかを接続するか、「このコンピューターで」を選んでください。",
    "No se ha encontrado ningún modelo en este equipo.":
      "このコンピューターにモデルが見つかりませんでした。",
    "Buscando Zotero…":
      "Zotero を探しています…",
    "Zotero ha respondido con un error":
      "Zotero がエラーを返しました",
    "Zotero no está conectado ahora mismo":
      "Zotero は現在接続されていません",
    "Nodus todavía no puede leer tu Zotero":
      "Nodus はまだ Zotero を読み取れません",
    "Abre Zotero en este ordenador (versión 7 o posterior).":
      "このコンピューターで Zotero を開きます（バージョン 7 以降）。",
    "En Zotero, ve a Ajustes → Avanzado y marca «Permitir que otras aplicaciones de este ordenador se comuniquen con Zotero».":
      "Zotero で 設定 → 詳細 を開き、「このコンピューター上の他のアプリケーションが Zotero と通信することを許可する」にチェックを入れます。",
    "No necesitas el plugin «Nodus for Zotero» para importar tu biblioteca: el plugin es un chat dentro de Zotero y se configura aparte.":
      "ライブラリのインポートに「Nodus for Zotero」プラグインは必要ありません。プラグインは Zotero 内のチャットで、別途設定します。",
    "Nodus lo comprueba solo cada pocos segundos: en cuanto Zotero responda, tu biblioteca aparecerá aquí.":
      "Nodus が数秒ごとに自動で確認します。Zotero が応答すると、ライブラリがここに表示されます。",
    "Cuando lo hayas hecho, pulsa «Reintentar».":
      "完了したら「再試行」を押してください。",
    "Conectado con Zotero":
      "Zotero に接続済み",
    "Nodus lee tu biblioteca directamente desde Zotero, en modo solo lectura. Para importar no hace falta el plugin «Nodus for Zotero».":
      "Nodus は Zotero からライブラリを読み取り専用で直接読み込みます。インポートに「Nodus for Zotero」プラグインは不要です。",
    "Motor de IA local":
      "ローカル AI エンジン",
    "Paso {n} de {total}":
      "ステップ {n} / {total}",
    "¿Con qué fuentes quieres empezar?":
      "どの出典から始めますか？",
    "Elige la IA que responderá":
      "回答する AI を選ぶ",
    "Algo no ha salido bien":
      "問題が発生しました",
    "Preparando tu primera respuesta":
      "最初の回答を準備しています",
    "Trae unas pocas fuentes. En un par de minutos podrás hacerles preguntas y ver de qué pasaje sale cada respuesta.":
      "出典をいくつか取り込みましょう。数分で質問できるようになり、各回答がどの箇所に基づくかを確認できます。",
    "Nodus usa la IA de tu proveedor: conecta tu clave y elige un modelo. El uso lo factura tu proveedor, no Nodus.":
      "Nodus はプロバイダーの AI を使用します。キーを接続してモデルを選んでください。利用料金は Nodus ではなくプロバイダーが請求します。",
    "No tienes que hacer nada: en cuanto la primera fuente esté lista se abrirá el chat con una pregunta preparada.":
      "操作は不要です。最初の出典の準備ができると、質問が入力された状態でチャットが開きます。",
    "Mi biblioteca de Zotero":
      "自分の Zotero ライブラリ",
    "Elige colecciones y Nodus las lee tal como están. No cambia nada en Zotero.":
      "コレクションを選ぶと、Nodus がそのまま読み取ります。Zotero 側は何も変わりません。",
    "Zotero detectado":
      "Zotero を検出",
    "Zotero no detectado":
      "Zotero 未検出",
    "Archivos de mi ordenador":
      "自分のコンピューターのファイル",
    "PDF, EPUB, Word o texto. Puedes arrastrarlos aquí.":
      "PDF、EPUB、Word、テキスト。ここにドラッグできます。",
    "{n} archivo(s)":
      "{n} 件のファイル",
    "Un documento de ejemplo":
      "サンプル文書",
    "Para ver cómo funciona antes de traer nada tuyo.":
      "自分の資料を取り込む前に、動作を確認できます。",
    "Elige una opción para continuar. Podrás añadir más fuentes de cualquier tipo cuando quieras.":
      "続けるには選択肢を選んでください。出典は種類を問わず、いつでも追加できます。",
    "Leyendo tus colecciones…":
      "コレクションを読み込んでいます…",
    "Tu Zotero no tiene colecciones todavía. Crea una en Zotero con unas cuantas obras y aparecerá aquí, o empieza con archivos de tu ordenador.":
      "Zotero にまだコレクションがありません。Zotero でいくつかの資料を入れたコレクションを作成するとここに表示されます。コンピューターのファイルから始めることもできます。",
    "Marca una o varias colecciones. Para empezar basta con una pequeña: el resto de tu biblioteca podrás añadirlo después.":
      "コレクションを 1 つ以上選んでください。最初は小さなものが 1 つあれば十分です。残りのライブラリは後から追加できます。",
    "Arrastra aquí tus documentos o elígelos. Dos o tres bastan para la primera prueba.":
      "文書をここにドラッグするか、選択してください。最初は 2、3 件で十分です。",
    "Añadir más":
      "さらに追加",
    "Prefiero una guía paso a paso":
      "ステップごとのガイドを使う",
    "Abrir el ejemplo":
      "サンプルを開く",
    "Dejar lista la IA":
      "AI を準備",
    "Traer tus fuentes":
      "出典を取り込む",
    "Leerlas y prepararlas para buscar":
      "読み取り、検索できるよう準備",
    "{n} fuente(s) en tu bóveda.":
      "Vault に {n} 件の出典があります。",
    "Entrar en Nodus igualmente":
      "このまま Nodus に進む",
    "Cambiar la IA":
      "AI を変更",
    "Cambiar las fuentes":
      "出典を変更",
    "Un documento largo puede tardar unos minutos, sobre todo con un modelo en este equipo.":
      "長い文書は数分かかることがあります。このコンピューター上のモデルを使う場合は特にそうです。",
    "Seguir en segundo plano y entrar ya":
      "バックグラウンドで続行して今すぐ開く",
    "Descargando {name}. Solo ocurre la primera vez.":
      "{name} をダウンロードしています。初回のみです。",
    "Guardando tu elección…":
      "選択を保存しています…",
    "Leyendo tus colecciones de Zotero…":
      "Zotero コレクションを読み込んでいます…",
    "Copiando tus archivos a la biblioteca…":
      "ファイルをライブラリにコピーしています…",
    "Comprobando qué documentos tienen texto…":
      "テキストを含む文書を確認しています…",
    "«{title}»: {done} de {total} pasajes.":
      "「{title}」：{total} 箇所中 {done} 箇所。",
    "Leyendo «{title}»…":
      "「{title}」を読み込んでいます…",
    "No se ha encontrado ningún documento en lo que has elegido. Prueba con otra colección o con archivos de tu ordenador.":
      "選択した内容に文書が見つかりませんでした。別のコレクションか、コンピューターのファイルをお試しください。",
    "Estas referencias no tienen un PDF u otro archivo con texto, así que no hay nada que leer. Elige obras que tengan su archivo adjunto.":
      "これらの文献には PDF などテキストを含むファイルがないため、読み取る内容がありません。ファイルが添付された資料を選んでください。",
    "Nodus no ha podido leer el texto de estos archivos. Suele pasar con PDF escaneados sin capa de texto. Prueba con otros documentos.":
      "Nodus はこれらのファイルのテキストを読み取れませんでした。テキストレイヤーのないスキャン PDF でよく起こります。別の文書をお試しください。",
    "Falta el modelo que prepara la búsqueda. Vuelve al paso anterior y elige dónde calcularla.":
      "検索を準備するモデルがありません。前のステップに戻り、どこで計算するかを選んでください。",
    "El servicio de IA ha rechazado la petición. Comprueba la clave y el modelo elegidos y vuelve a intentarlo.":
      "AI サービスがリクエストを拒否しました。選択したキーとモデルを確認して、もう一度お試しください。",
    "No se han podido preparar estas fuentes. Puedes reintentarlo o entrar en Nodus y prepararlas desde la Biblioteca.":
      "これらの出典を準備できませんでした。再試行するか、Nodus に入ってライブラリから準備できます。",
    "Una bóveda es tu espacio de trabajo: reúne tus fuentes y todo lo que hagas con ellas. Deja «Académico» si vienes a trabajar con tus lecturas. Podrás crear más bóvedas, de otros tipos, cuando quieras.":
      "Vault は作業スペースです。出典と、それを使って行うすべての作業をまとめます。読んだ文献を扱う場合は「学術」のままにしてください。他の種類の Vault はいつでも追加で作成できます。",
    "Tu biblioteca está vacía":
      "ライブラリは空です",
    "Trae unas cuantas fuentes y podrás hacerles preguntas en el chat. Nodus solo lee tus archivos: no cambia nada en Zotero.":
      "出典をいくつか取り込むと、チャットで質問できるようになります。Nodus はファイルを読み取るだけで、Zotero 側は何も変わりません。",
    "Traer de Zotero":
      "Zotero から取り込む",
    "Empezar ahora y protegerlo después":
      "今すぐ始めて、保護は後で設定",
    "Nodus usará una carpeta propia en este ordenador y te recordará guardar el kit de recuperación más adelante.":
      "Nodus はこのコンピューター上の専用フォルダーを使用し、後でリカバリーキットの保存をお知らせします。",
    "Este plugin es opcional y no sirve para importar. Para traer tu biblioteca de Zotero a Nodus basta con tener Zotero abierto: se hace desde Biblioteca, sin instalar nada.":
      "このプラグインは任意で、インポートには使いません。Zotero ライブラリを Nodus に取り込むには Zotero を開いておくだけで十分です。ライブラリから行え、インストールは不要です。",
  },
  ko: {
    "{collections} colección(es) seleccionada(s), con sus subcolecciones. Nodus prepara primero unas pocas obras para que puedas probarlo ya.":
      "하위 컬렉션을 포함해 컬렉션 {collections}개를 선택했습니다. 바로 사용해 볼 수 있도록 Nodus가 먼저 자료 몇 개를 준비합니다.",
    "{n} obra(s) · {m} subcolección(es)":
      "자료 {n}개 · 하위 컬렉션 {m}개",
    "{m} subcolección(es)":
      "하위 컬렉션 {m}개",
    "{n} obra(s)":
      "자료 {n}개",
    "Ver subcolecciones de {name}":
      "{name}의 하위 컬렉션 보기",
    "No se pudieron leer las subcolecciones. Puedes marcar la colección completa.":
      "하위 컬렉션을 읽지 못했습니다. 컬렉션 전체를 선택할 수 있습니다.",
    "Nodus lo comprueba solo cada pocos segundos y este aviso cambiará en cuanto Zotero responda.":
      "Nodus가 몇 초마다 자동으로 확인하며, Zotero가 응답하는 즉시 이 안내가 바뀝니다.",
    "Tu trabajo se guarda en {folder}, con copias cifradas automáticas. Guarda tu kit de recuperación para poder restaurarlo en otro ordenador.":
      "작업 내용은 {folder}에 저장되고 암호화된 백업이 자동으로 만들어집니다. 다른 컴퓨터에서 복원할 수 있도록 복구 키트를 저장하세요.",
    "¿Te has atascado? Todavía no hay ninguna fuente en esta bóveda. Podemos retomar los primeros pasos, o puedes contarnos qué te ha frenado.":
      "막히셨나요? 이 Vault에는 아직 출처가 없습니다. 첫 단계를 다시 진행하거나, 무엇이 걸림돌이었는지 알려 주실 수 있습니다.",
    "Retomar los primeros pasos":
      "첫 단계 다시 진행",
    "Contar qué me ha frenado":
      "걸림돌 알려 주기",
    "Conecta tu proveedor de IA":
      "AI 제공업체 연결",
    "Conecta primero un proveedor.":
      "먼저 제공업체를 연결하세요.",
    "Búsqueda en tus fuentes":
      "내 출처에서 검색",
    "Para encontrar el pasaje exacto, Nodus prepara un índice de tus textos (embeddings). Elige dónde se calcula.":
      "정확한 구절을 찾기 위해 Nodus는 텍스트의 색인(임베딩)을 만듭니다. 어디에서 계산할지 선택하세요.",
    "En este equipo":
      "이 컴퓨터에서",
    "Con un servicio externo (API)":
      "외부 서비스 사용(API)",
    "Gratis y privado: tus textos no salen del ordenador. La primera vez descarga el modelo elegido, de unos cientos de MB.":
      "무료이며 비공개: 텍스트가 컴퓨터 밖으로 나가지 않습니다. 처음에는 선택한 모델(수백 MB)을 내려받습니다.",
    "No descarga nada y es rápido en cualquier equipo. Usa la clave de tu proveedor y tiene un coste pequeño.":
      "아무것도 내려받지 않으며 어떤 컴퓨터에서도 빠릅니다. 제공업체 키를 사용하며 소액의 비용이 듭니다.",
    "Ninguno de tus proveedores conectados ofrece este servicio. Lo ofrecen {list}: conecta uno de ellos, o elige «En este equipo».":
      "연결된 제공업체 중 이 서비스를 제공하는 곳이 없습니다. {list}에서 제공합니다. 그중 하나를 연결하거나 “이 컴퓨터에서”를 선택하세요.",
    "No se ha encontrado ningún modelo en este equipo.":
      "이 컴퓨터에서 모델을 찾지 못했습니다.",
    "Buscando Zotero…":
      "Zotero를 찾는 중…",
    "Zotero ha respondido con un error":
      "Zotero가 오류로 응답했습니다",
    "Zotero no está conectado ahora mismo":
      "지금은 Zotero가 연결되어 있지 않습니다",
    "Nodus todavía no puede leer tu Zotero":
      "Nodus가 아직 Zotero를 읽을 수 없습니다",
    "Abre Zotero en este ordenador (versión 7 o posterior).":
      "이 컴퓨터에서 Zotero를 엽니다(버전 7 이상).",
    "En Zotero, ve a Ajustes → Avanzado y marca «Permitir que otras aplicaciones de este ordenador se comuniquen con Zotero».":
      "Zotero에서 설정 → 고급으로 이동해 “이 컴퓨터의 다른 애플리케이션이 Zotero와 통신하도록 허용”을 선택합니다.",
    "No necesitas el plugin «Nodus for Zotero» para importar tu biblioteca: el plugin es un chat dentro de Zotero y se configura aparte.":
      "라이브러리를 가져오는 데 “Nodus for Zotero” 플러그인은 필요하지 않습니다. 플러그인은 Zotero 안의 채팅이며 따로 설정합니다.",
    "Nodus lo comprueba solo cada pocos segundos: en cuanto Zotero responda, tu biblioteca aparecerá aquí.":
      "Nodus가 몇 초마다 자동으로 확인합니다. Zotero가 응답하는 즉시 라이브러리가 여기에 표시됩니다.",
    "Cuando lo hayas hecho, pulsa «Reintentar».":
      "완료한 뒤 “다시 시도”를 누르세요.",
    "Conectado con Zotero":
      "Zotero에 연결됨",
    "Nodus lee tu biblioteca directamente desde Zotero, en modo solo lectura. Para importar no hace falta el plugin «Nodus for Zotero».":
      "Nodus는 Zotero에서 라이브러리를 읽기 전용으로 직접 읽습니다. 가져오기에 “Nodus for Zotero” 플러그인은 필요하지 않습니다.",
    "Motor de IA local":
      "로컬 AI 엔진",
    "Paso {n} de {total}":
      "{total}단계 중 {n}단계",
    "¿Con qué fuentes quieres empezar?":
      "어떤 출처로 시작할까요?",
    "Elige la IA que responderá":
      "답변할 AI 선택",
    "Algo no ha salido bien":
      "문제가 발생했습니다",
    "Preparando tu primera respuesta":
      "첫 답변을 준비하는 중",
    "Trae unas pocas fuentes. En un par de minutos podrás hacerles preguntas y ver de qué pasaje sale cada respuesta.":
      "출처를 몇 개 가져오세요. 몇 분 뒤면 질문을 하고 각 답변이 어느 구절에서 나왔는지 확인할 수 있습니다.",
    "Nodus usa la IA de tu proveedor: conecta tu clave y elige un modelo. El uso lo factura tu proveedor, no Nodus.":
      "Nodus는 제공업체의 AI를 사용합니다. 키를 연결하고 모델을 선택하세요. 사용 요금은 Nodus가 아니라 제공업체가 청구합니다.",
    "No tienes que hacer nada: en cuanto la primera fuente esté lista se abrirá el chat con una pregunta preparada.":
      "아무것도 하지 않아도 됩니다. 첫 출처가 준비되는 즉시 질문이 준비된 채로 채팅이 열립니다.",
    "Mi biblioteca de Zotero":
      "내 Zotero 라이브러리",
    "Elige colecciones y Nodus las lee tal como están. No cambia nada en Zotero.":
      "컬렉션을 선택하면 Nodus가 그대로 읽습니다. Zotero에서는 아무것도 바뀌지 않습니다.",
    "Zotero detectado":
      "Zotero 감지됨",
    "Zotero no detectado":
      "Zotero 감지되지 않음",
    "Archivos de mi ordenador":
      "내 컴퓨터의 파일",
    "PDF, EPUB, Word o texto. Puedes arrastrarlos aquí.":
      "PDF, EPUB, Word 또는 텍스트. 여기로 끌어다 놓을 수 있습니다.",
    "{n} archivo(s)":
      "파일 {n}개",
    "Un documento de ejemplo":
      "예제 문서",
    "Para ver cómo funciona antes de traer nada tuyo.":
      "내 자료를 가져오기 전에 어떻게 작동하는지 확인합니다.",
    "Elige una opción para continuar. Podrás añadir más fuentes de cualquier tipo cuando quieras.":
      "계속하려면 옵션을 선택하세요. 언제든지 어떤 종류의 출처든 더 추가할 수 있습니다.",
    "Leyendo tus colecciones…":
      "컬렉션을 읽는 중…",
    "Tu Zotero no tiene colecciones todavía. Crea una en Zotero con unas cuantas obras y aparecerá aquí, o empieza con archivos de tu ordenador.":
      "Zotero에 아직 컬렉션이 없습니다. Zotero에서 자료 몇 개로 컬렉션을 만들면 여기에 표시됩니다. 컴퓨터의 파일로 시작할 수도 있습니다.",
    "Marca una o varias colecciones. Para empezar basta con una pequeña: el resto de tu biblioteca podrás añadirlo después.":
      "컬렉션을 하나 이상 선택하세요. 처음에는 작은 것 하나면 충분합니다. 나머지 라이브러리는 나중에 추가할 수 있습니다.",
    "Arrastra aquí tus documentos o elígelos. Dos o tres bastan para la primera prueba.":
      "문서를 여기로 끌어다 놓거나 선택하세요. 첫 시도에는 두세 개면 충분합니다.",
    "Añadir más":
      "더 추가",
    "Prefiero una guía paso a paso":
      "단계별 안내를 원합니다",
    "Abrir el ejemplo":
      "예제 열기",
    "Dejar lista la IA":
      "AI 준비",
    "Traer tus fuentes":
      "출처 가져오기",
    "Leerlas y prepararlas para buscar":
      "읽고 검색할 수 있게 준비",
    "{n} fuente(s) en tu bóveda.":
      "Vault에 출처 {n}개가 있습니다.",
    "Entrar en Nodus igualmente":
      "그래도 Nodus로 들어가기",
    "Cambiar la IA":
      "AI 변경",
    "Cambiar las fuentes":
      "출처 변경",
    "Un documento largo puede tardar unos minutos, sobre todo con un modelo en este equipo.":
      "긴 문서는 몇 분이 걸릴 수 있으며, 이 컴퓨터의 모델을 사용할 때 특히 그렇습니다.",
    "Seguir en segundo plano y entrar ya":
      "백그라운드에서 계속하고 지금 들어가기",
    "Descargando {name}. Solo ocurre la primera vez.":
      "{name}을(를) 내려받는 중입니다. 처음 한 번만 진행됩니다.",
    "Guardando tu elección…":
      "선택을 저장하는 중…",
    "Leyendo tus colecciones de Zotero…":
      "Zotero 컬렉션을 읽는 중…",
    "Copiando tus archivos a la biblioteca…":
      "파일을 라이브러리로 복사하는 중…",
    "Comprobando qué documentos tienen texto…":
      "텍스트가 있는 문서를 확인하는 중…",
    "«{title}»: {done} de {total} pasajes.":
      "“{title}”: 구절 {total}개 중 {done}개.",
    "Leyendo «{title}»…":
      "“{title}” 읽는 중…",
    "No se ha encontrado ningún documento en lo que has elegido. Prueba con otra colección o con archivos de tu ordenador.":
      "선택한 항목에서 문서를 찾지 못했습니다. 다른 컬렉션이나 컴퓨터의 파일로 시도해 보세요.",
    "Estas referencias no tienen un PDF u otro archivo con texto, así que no hay nada que leer. Elige obras que tengan su archivo adjunto.":
      "이 참고문헌에는 PDF나 텍스트가 있는 다른 파일이 없어 읽을 내용이 없습니다. 파일이 첨부된 자료를 선택하세요.",
    "Nodus no ha podido leer el texto de estos archivos. Suele pasar con PDF escaneados sin capa de texto. Prueba con otros documentos.":
      "Nodus가 이 파일들의 텍스트를 읽지 못했습니다. 텍스트 레이어가 없는 스캔 PDF에서 흔히 발생합니다. 다른 문서로 시도해 보세요.",
    "Falta el modelo que prepara la búsqueda. Vuelve al paso anterior y elige dónde calcularla.":
      "검색을 준비하는 모델이 없습니다. 이전 단계로 돌아가 어디에서 계산할지 선택하세요.",
    "El servicio de IA ha rechazado la petición. Comprueba la clave y el modelo elegidos y vuelve a intentarlo.":
      "AI 서비스가 요청을 거부했습니다. 선택한 키와 모델을 확인한 뒤 다시 시도하세요.",
    "No se han podido preparar estas fuentes. Puedes reintentarlo o entrar en Nodus y prepararlas desde la Biblioteca.":
      "이 출처들을 준비하지 못했습니다. 다시 시도하거나 Nodus에 들어가 라이브러리에서 준비할 수 있습니다.",
    "Una bóveda es tu espacio de trabajo: reúne tus fuentes y todo lo que hagas con ellas. Deja «Académico» si vienes a trabajar con tus lecturas. Podrás crear más bóvedas, de otros tipos, cuando quieras.":
      "Vault는 작업 공간입니다. 출처와 그것으로 하는 모든 작업을 한데 모읍니다. 읽은 자료로 작업하려면 “학술”을 그대로 두세요. 다른 유형의 Vault는 언제든지 더 만들 수 있습니다.",
    "Tu biblioteca está vacía":
      "라이브러리가 비어 있습니다",
    "Trae unas cuantas fuentes y podrás hacerles preguntas en el chat. Nodus solo lee tus archivos: no cambia nada en Zotero.":
      "출처를 몇 개 가져오면 채팅에서 질문할 수 있습니다. Nodus는 파일을 읽기만 하며 Zotero에서는 아무것도 바뀌지 않습니다.",
    "Traer de Zotero":
      "Zotero에서 가져오기",
    "Empezar ahora y protegerlo después":
      "지금 시작하고 보호는 나중에",
    "Nodus usará una carpeta propia en este ordenador y te recordará guardar el kit de recuperación más adelante.":
      "Nodus는 이 컴퓨터의 전용 폴더를 사용하며, 나중에 복구 키트를 저장하도록 알려 드립니다.",
    "Este plugin es opcional y no sirve para importar. Para traer tu biblioteca de Zotero a Nodus basta con tener Zotero abierto: se hace desde Biblioteca, sin instalar nada.":
      "이 플러그인은 선택 사항이며 가져오기에는 쓰이지 않습니다. Zotero 라이브러리를 Nodus로 가져오려면 Zotero를 열어 두기만 하면 됩니다. 라이브러리에서 진행하며 아무것도 설치할 필요가 없습니다.",
  },
};
