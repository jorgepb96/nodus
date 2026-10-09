// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Human-facing "what's new" notes shown once after the app updates to a new
// version. Newest first. Each highlight covers every supported UI language so
// the modal follows the interface. Keep these short and user-facing — they are
// product notes, not a changelog. Add a new entry at the top whenever the app
// version bumps.

import { RELEASE_5_4_0_ADDITIONS } from './releaseNotes540';
import { RELEASE_5_4_2_HIGHLIGHTS } from './releaseNotes542';
import { RELEASE_5_4_3_HIGHLIGHTS } from './releaseNotes543';
import { RELEASE_5_4_4_HIGHLIGHTS } from './releaseNotes544';
import { RELEASE_5_4_5_HIGHLIGHTS } from './releaseNotes545';
import { RELEASE_5_6_0_HIGHLIGHTS } from './releaseNotes560';
import { RELEASE_5_7_0_HIGHLIGHTS } from './releaseNotes570';
import { RELEASE_5_7_2_HIGHLIGHTS } from './releaseNotes572';
import { RELEASE_5_8_1_HIGHLIGHTS } from './releaseNotes581';
import { RELEASE_5_8_0_HIGHLIGHTS } from './releaseNotes580';
import { RELEASE_5_7_4_HIGHLIGHTS } from './releaseNotes574';
import { RELEASE_5_7_3_HIGHLIGHTS } from './releaseNotes573';
import type { ReleaseCategory } from './releaseNotesPresentation';
import { RELEASE_5_5_0_HIGHLIGHTS } from './releaseNotes550';
import type { VaultType } from './vaultTypes';
import { RELEASE_NOTES_IT } from './releaseNotes.it';
import { RELEASE_NOTES_TR } from './releaseNotes.tr';
import { RELEASE_NOTES_ZH } from './releaseNotes.zh-CN';
import { RELEASE_NOTES_ZH_TW } from './releaseNotes.zh-TW';
import { RELEASE_NOTES_JA } from './releaseNotes.ja';
import { RELEASE_NOTES_KO } from './releaseNotes.ko';

// Beyond the vault types, a highlight can belong to a cross-vault surface with an
// identity of its own: the MCP server, the Nodi mascot, the tools hub or a new
// interface language. They get their own icon and colour instead of dissolving
// into 'general'.
export type ReleaseNoteScope =
  | 'general'
  | VaultType
  | 'ai'
  | 'library'
  | 'server'
  | 'word'
  | 'zotero'
  | 'connector'
  | 'mcp'
  | 'nodi'
  | 'toolkit'
  | 'drift'
  | 'plugin'
  | 'marketplace'
  | 'languages'
  | 'browser'
  | 'radar'
  | 'apple';

interface RawReleaseHighlight {
  /** Required for v5 and future releases. Earlier history retains its original layout. */
  category?: ReleaseCategory;
  es: string;
  en: string;
  fr: string;
  de: string;
  pt: string;
  'pt-BR': string;
  /** Drives the vault/general icon and colour shown beside this highlight. */
  scope: ReleaseNoteScope;
}

export interface ReleaseHighlight extends RawReleaseHighlight { it: string; tr: string; 'zh-CN': string; 'zh-TW': string; ja: string; ko: string }

export interface CategorizedReleaseHighlight extends ReleaseHighlight { category: ReleaseCategory }

export interface ReleaseNote {
  version: string;
  /** ISO date (YYYY-MM-DD) the version shipped. */
  date: string;
  highlights: ReleaseHighlight[];
}

interface RawReleaseNote extends Omit<ReleaseNote, 'highlights'> { highlights: RawReleaseHighlight[] }

/**
 * 3.0.4: Deep Research reaches MCP clients as a queue instead of a held-open
 * call, and two things that silently repeated themselves — a retry that went
 * back to the engine that had just refused, and an argument map that redrew
 * every hub as a star — stop doing it.
 */
/**
 * v3.1.0 — Nodus Server stops being a read-only shop window.
 *
 * Written for someone who has never seen the server: what changes for THEM, not which
 * modules moved. The three entries are the three things a person will actually notice:
 * a vault that lives on somebody else's server, what their account may do with it, and a
 * correction to what we had promised about embeddings.
 *
 * From this release on, a highlight is written in short, plain sentences with NO
 * semicolons and NO em dashes. Both invite the winding subordinate clauses these notes
 * had grown into, and this modal is read once, in a hurry, by somebody who just wanted
 * to get back to work. `scripts/test-release-notes.mjs` enforces it for 3.1.0 and above.
 */
const RELEASE_3_1_0_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'general',
    es: 'Una bóveda puede vivir en un servidor y copiarse entera en tu equipo. Al crearla eliges entre local, como siempre, o conectada. Escribes la dirección del servidor y tus credenciales, y te traes el espacio al que tengas acceso. Es una base de datos real en tu disco, así que todo funciona igual y también sin conexión. Se actualiza sola en segundo plano.',
    en: 'A vault can live on a server and be copied whole onto your machine. When you create one you choose between local, as always, and connected. You type the server address and your credentials, and you pull down the space you have access to. It is a real database on your disk, so everything works the same, offline too. It refreshes itself in the background.',
    fr: 'Un coffre peut vivre sur un serveur et être copié en entier sur votre machine. À la création, vous choisissez entre local, comme toujours, et connecté. Vous saisissez l’adresse du serveur et vos identifiants, et vous récupérez l’espace auquel vous avez accès. C’est une vraie base de données sur votre disque, donc tout fonctionne pareil, même hors ligne. Elle se met à jour toute seule en arrière-plan.',
    de: 'Ein Tresor kann auf einem Server liegen und vollständig auf Ihren Rechner kopiert werden. Beim Anlegen wählen Sie zwischen lokal, wie bisher, und verbunden. Sie geben die Serveradresse und Ihre Zugangsdaten ein und holen sich den Bereich, auf den Sie Zugriff haben. Es ist eine echte Datenbank auf Ihrer Platte, also funktioniert alles genauso, auch offline. Sie aktualisiert sich im Hintergrund von selbst.',
    pt: 'Um cofre pode viver num servidor e ser copiado inteiro para o seu computador. Ao criá-lo escolhe entre local, como sempre, ou ligado. Escreve o endereço do servidor e as suas credenciais e traz o espaço a que tem acesso. É uma base de dados real no seu disco, por isso tudo funciona igual, mesmo sem ligação. Atualiza-se sozinho em segundo plano.',
    'pt-BR': 'Um cofre pode viver em um servidor e ser copiado inteiro para o seu computador. Ao criá-lo você escolhe entre local, como sempre, ou conectado. Digita o endereço do servidor e suas credenciais e baixa o espaço a que tem acesso. É um banco de dados real no seu disco, então tudo funciona igual, inclusive sem conexão. Ele se atualiza sozinho em segundo plano.',
  },
  {
    scope: 'general',
    es: 'Cada cuenta tiene un nivel de acceso en cada espacio, y ese nivel decide dónde acaba tu trabajo. Con lectura, todo lo que escribas o generes se queda en tu equipo y no sale nunca. Con escritura, tus notas e informes viajan al vault principal la próxima vez que su propietario se conecte, y mientras tanto la pantalla te dice cuántos cambios esperan. Si te retiran el acceso, la bóveda se queda entera en tu equipo y solo deja de sincronizarse. Ahora también se comparten las bóvedas de genealogía, docencia, estudio y bases de datos.',
    en: 'Every account has an access level in each space, and that level decides where your work ends up. With read access, anything you write or generate stays on your machine and never leaves. With write access, your notes and reports travel to the main vault the next time its owner connects, and meanwhile the screen tells you how many changes are waiting. If your access is withdrawn, the vault stays whole on your machine and simply stops syncing. Genealogy, teaching, study and database vaults can now be shared too.',
    fr: 'Chaque compte a un niveau d’accès dans chaque espace, et ce niveau décide où finit votre travail. En lecture, tout ce que vous écrivez ou générez reste sur votre machine et n’en sort jamais. En écriture, vos notes et vos rapports rejoignent le coffre principal à la prochaine connexion de son propriétaire, et en attendant l’écran indique combien de modifications patientent. Si votre accès est retiré, le coffre reste entier sur votre machine et cesse simplement de se synchroniser. Les coffres de généalogie, d’enseignement, d’étude et de bases de données se partagent désormais aussi.',
    de: 'Jedes Konto hat in jedem Bereich eine Zugriffsstufe, und diese Stufe entscheidet, wo Ihre Arbeit landet. Mit Lesezugriff bleibt alles, was Sie schreiben oder erzeugen, auf Ihrem Rechner und verlässt ihn nie. Mit Schreibzugriff gelangen Ihre Notizen und Berichte in den Haupttresor, sobald dessen Eigentümer sich das nächste Mal verbindet, und bis dahin zeigt der Bildschirm, wie viele Änderungen warten. Wird Ihr Zugriff entzogen, bleibt der Tresor vollständig auf Ihrem Rechner und hört nur auf zu synchronisieren. Auch Genealogie-, Unterrichts-, Studien- und Datenbanktresore lassen sich jetzt teilen.',
    pt: 'Cada conta tem um nível de acesso em cada espaço, e esse nível decide onde acaba o seu trabalho. Com leitura, tudo o que escrever ou gerar fica no seu computador e nunca sai. Com escrita, as suas notas e relatórios seguem para o cofre principal na próxima vez que o proprietário se ligar, e entretanto o ecrã diz quantas alterações aguardam. Se lhe retirarem o acesso, o cofre fica inteiro no seu computador e apenas deixa de sincronizar. Passam a partilhar-se também os cofres de genealogia, ensino, estudo e bases de dados.',
    'pt-BR': 'Cada conta tem um nível de acesso em cada espaço, e esse nível decide onde termina o seu trabalho. Com leitura, tudo o que você escrever ou gerar fica no seu computador e nunca sai. Com escrita, suas notas e relatórios seguem para o cofre principal na próxima vez que o proprietário se conectar, e enquanto isso a tela informa quantas alterações aguardam. Se retirarem o seu acesso, o cofre fica inteiro no seu computador e apenas para de sincronizar. Passam a ser compartilhados também os cofres de genealogia, ensino, estudo e bancos de dados.',
  },
  {
    scope: 'general',
    es: 'Este equipo puede ser el servidor, sin Docker ni dominio. En Ajustes eliges el modo básico y Nodus lo arranca por su cuenta. La tarjeta te dice en todo momento quién puede conectarse, solo este ordenador, tu red local o tu Tailscale, y nunca sirve nada sin cifrar. Para conectar el móvil hay un código corto y legible, sin letras que se confundan entre sí.',
    en: 'This computer can be the server, with no Docker and no domain. You pick the basic mode in Settings and Nodus starts it on its own. The card tells you at all times who can reach it, only this computer, your local network or your Tailscale, and it never serves anything unencrypted. To connect your phone there is a short pairing code with no letters that look alike.',
    fr: 'Cet ordinateur peut être le serveur, sans Docker ni domaine. Vous choisissez le mode simple dans les Paramètres et Nodus le démarre tout seul. La carte indique à tout moment qui peut s’y connecter, cet ordinateur seul, votre réseau local ou votre Tailscale, et rien n’est jamais servi en clair. Pour connecter le téléphone, un code court et lisible, sans lettres qui se ressemblent.',
    de: 'Dieser Rechner kann der Server sein, ohne Docker und ohne Domain. In den Einstellungen wählen Sie den einfachen Modus, und Nodus startet ihn von selbst. Die Karte sagt jederzeit, wer ihn erreichen kann, nur dieser Rechner, Ihr lokales Netz oder Ihr Tailscale, und nichts wird je unverschlüsselt ausgeliefert. Zum Verbinden des Telefons gibt es einen kurzen Kopplungscode ohne Buchstaben, die sich ähneln.',
    pt: 'Este computador pode ser o servidor, sem Docker nem domínio. Nas Definições escolhe o modo básico e o Nodus arranca-o por si. O cartão diz a todo o momento quem se pode ligar, só este computador, a sua rede local ou o seu Tailscale, e nunca serve nada sem cifrar. Para ligar o telemóvel há um código curto e legível, sem letras que se confundam.',
    'pt-BR': 'Este computador pode ser o servidor, sem Docker nem domínio. Nas Configurações você escolhe o modo básico e o Nodus sobe o servidor sozinho. O card diz a todo momento quem consegue se conectar, só este computador, sua rede local ou seu Tailscale, e nunca serve nada sem criptografia. Para conectar o celular há um código curto e legível, sem letras que se confundem.',
  },
  {
    scope: 'general',
    es: 'Corregimos lo que la política de privacidad decía sobre los embeddings. Afirmaba que nunca se suben, y desde que existe la búsqueda semántica compartida eso había dejado de ser cierto. Los vectores de las ideas sí viajan, para poder buscar por significado desde una réplica o desde el móvil. El documento ya lo cuenta, y hay un interruptor nuevo, «Incluir vectores semánticos», que lo corta de verdad. Además, una bóveda de estudio o docencia compartida ya no envía grabaciones de clase, intentos ni calificaciones.',
    en: 'We corrected what the privacy policy said about embeddings. It claimed they are never uploaded, and since shared semantic search arrived that had stopped being true. Idea vectors do travel, so that you can search by meaning from a replica or from your phone. The document now says so, and a new switch, “Include semantic vectors”, really stops it. A shared study or teaching vault also no longer sends class recordings, attempts or grades.',
    fr: 'Nous avons corrigé ce que la politique de confidentialité disait des embeddings. Elle affirmait qu’ils ne sont jamais envoyés, et depuis l’arrivée de la recherche sémantique partagée ce n’était plus vrai. Les vecteurs des idées circulent bien, pour pouvoir chercher par le sens depuis une réplique ou depuis le téléphone. Le document le dit désormais, et un nouvel interrupteur, « Inclure les vecteurs sémantiques », l’arrête vraiment. Un coffre d’étude ou d’enseignement partagé n’envoie plus non plus les enregistrements de cours, les tentatives ni les notes.',
    de: 'Wir haben korrigiert, was die Datenschutzerklärung über Embeddings sagte. Sie behauptete, sie würden nie hochgeladen, und seit es die geteilte semantische Suche gibt, stimmte das nicht mehr. Die Vektoren der Ideen reisen sehr wohl mit, damit Sie von einem Replikat oder vom Telefon aus nach Bedeutung suchen können. Das Dokument sagt es jetzt, und ein neuer Schalter, „Semantische Vektoren einbeziehen“, stoppt es wirklich. Ein geteilter Studien- oder Unterrichtstresor schickt außerdem keine Unterrichtsaufnahmen, Versuche und Noten mehr.',
    pt: 'Corrigimos o que a política de privacidade dizia sobre os embeddings. Afirmava que nunca são enviados, e desde que existe a pesquisa semântica partilhada isso deixara de ser verdade. Os vetores das ideias viajam mesmo, para poder pesquisar por significado a partir de uma réplica ou do telemóvel. O documento já o conta, e há um interruptor novo, «Incluir vetores semânticos», que o corta a sério. Além disso, um cofre de estudo ou ensino partilhado já não envia gravações de aula, tentativas nem notas.',
    'pt-BR': 'Corrigimos o que a política de privacidade dizia sobre os embeddings. Afirmava que nunca são enviados, e desde que existe a busca semântica compartilhada isso deixara de ser verdade. Os vetores das ideias viajam mesmo, para você poder buscar por significado a partir de uma réplica ou do celular. O documento já conta isso, e há um interruptor novo, “Incluir vetores semânticos”, que corta de verdade. Além disso, um cofre de estudo ou ensino compartilhado não envia mais gravações de aula, tentativas nem notas.',
  },
];

const RELEASE_3_0_4_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'mcp',
    es: 'Un cliente MCP puede encolar informes de Deep Research. Hasta ahora el cliente que pedía uno tenía que mantener la llamada abierta durante toda la generación —varios minutos en los que cualquier cosa podía caducar— y podía chocar con un informe que hubieras lanzado tú desde la aplicación. Ahora lo encola y vuelve a consultarlo cuando quiera: Nodus tiene un único carril de generación compartido con la ventana, así que nunca corren dos informes a la vez; la tira de la cola marca con una insignia MCP los que vienen de un cliente y Nodi te avisa cuando uno acaba o falla, porque quien lo pidió puede haberse desconectado ya. Cada trabajo queda atado a la bóveda en la que se encoló, y cambiar de bóveda cancela lo que siguiera esperando por otra.',
    en: 'An MCP client can queue Deep Research reports. Until now a client that asked for one had to hold the call open for the whole generation — several minutes in which anything could time out — and could collide with a report you had started in the app. It now enqueues the report and checks back whenever it likes: Nodus runs a single generation lane shared with the window, so two reports never run at once; the queue strip marks client-requested ones with an MCP badge, and Nodi tells you when one finishes or fails, because whoever asked for it may have disconnected by then. Each job stays bound to the vault it was queued in, and switching vault cancels anything still waiting for a different one.',
    fr: 'Un client MCP peut mettre des rapports Deep Research en file d’attente. Jusqu’ici, le client qui en demandait un devait garder l’appel ouvert pendant toute la génération — plusieurs minutes où tout pouvait expirer — et risquait d’entrer en collision avec un rapport lancé depuis l’application. Il le met désormais en file et revient le consulter quand il veut : Nodus dispose d’une seule voie de génération partagée avec la fenêtre, donc jamais deux rapports à la fois ; la bande de file d’attente marque d’un badge MCP ceux qui viennent d’un client, et Nodi vous prévient quand l’un se termine ou échoue, car son demandeur peut s’être déconnecté entre-temps. Chaque tâche reste liée au coffre où elle a été mise en file, et changer de coffre annule ce qui attendait encore pour un autre.',
    de: 'Ein MCP-Client kann Deep-Research-Berichte in die Warteschlange stellen. Bisher musste ein Client, der einen Bericht anforderte, den Aufruf über die gesamte Erstellung offen halten — mehrere Minuten, in denen alles Mögliche ablaufen konnte — und konnte mit einem Bericht kollidieren, den Sie selbst in der App gestartet hatten. Jetzt reiht er den Bericht ein und fragt nach, wann er will: Nodus hat eine einzige Erzeugungsspur, die es sich mit dem Fenster teilt, also laufen nie zwei Berichte gleichzeitig; der Warteschlangenstreifen kennzeichnet die von einem Client angeforderten mit einem MCP-Abzeichen, und Nodi meldet, wenn einer fertig ist oder fehlschlägt — denn wer ihn angefordert hat, kann längst getrennt sein. Jeder Auftrag bleibt an den Tresor gebunden, in dem er eingereiht wurde, und ein Tresorwechsel bricht alles ab, was noch auf einen anderen wartete.',
    pt: 'Um cliente MCP pode pôr relatórios de Deep Research em fila. Até agora, o cliente que pedia um tinha de manter a chamada aberta durante toda a geração — vários minutos em que tudo podia expirar — e podia chocar com um relatório que você tivesse lançado na aplicação. Agora põe-no em fila e volta a consultá-lo quando quiser: o Nodus tem uma única via de geração partilhada com a janela, por isso nunca correm dois relatórios ao mesmo tempo; a faixa da fila marca com um emblema MCP os que vêm de um cliente e o Nodi avisa quando um termina ou falha, porque quem o pediu pode já se ter desligado. Cada tarefa fica ligada ao cofre em que foi posta em fila, e mudar de cofre cancela o que continuasse à espera de outro.',
    'pt-BR': 'Um cliente MCP pode colocar relatórios de Deep Research na fila. Até agora, o cliente que pedia um tinha de manter a chamada aberta durante toda a geração — vários minutos em que qualquer coisa podia expirar — e podia colidir com um relatório que você tivesse iniciado no aplicativo. Agora ele enfileira o relatório e volta a consultá-lo quando quiser: o Nodus tem uma única faixa de geração compartilhada com a janela, então nunca rodam dois relatórios ao mesmo tempo; a tira da fila marca com um selo MCP os que vêm de um cliente e o Nodi avisa quando um termina ou falha, porque quem pediu pode já ter se desconectado. Cada tarefa fica presa ao cofre em que entrou na fila, e trocar de cofre cancela o que ainda esperava por outro.',
  },
  {
    scope: 'academic',
    es: 'Una imagen fallida se puede reintentar con otro motor. El reintento reutilizaba el proveedor y el modelo guardados en la imagen que acababa de negarse, así que un informe encallado en «no se pudo generar la imagen» volvía una y otra vez al mismo motor, y cambiar el proveedor en Ajustes no le servía de nada. Ahora el motor sale de lo que pides o de Ajustes: una imagen fallida se abre con el predeterminado actual, una ya generada conserva el suyo, y el modal de diseño estrena un selector de modelo con todo el catálogo y su precio por imagen, mientras el pie indica lo que va a usar el botón. Además, el motivo real del fallo encabeza el mensaje traducido a los siete idiomas, en lugar de quedar debajo de un titular genérico que lo contradecía.',
    en: 'A failed image can be retried with a different engine. The retry reused the provider and model stored on the image that had just refused, so a report stuck on “the image could not be generated” kept going back to the same engine, and changing the provider in Settings did nothing for it. The engine now comes from what you ask for, or from Settings: a failed image opens on the current default, an already generated one keeps its own, and the design modal gains a model picker listing the whole catalogue with its per-image price, while the footer states what the button is about to use. The real reason a generation failed also leads the message, translated into all seven languages, instead of sitting under a generic headline that contradicted it.',
    fr: 'Une image en échec peut être relancée avec un autre moteur. La nouvelle tentative réutilisait le fournisseur et le modèle enregistrés sur l’image qui venait de refuser : un rapport bloqué sur « l’image n’a pas pu être générée » retournait donc au même moteur, et changer de fournisseur dans les Paramètres n’y changeait rien. Le moteur vient désormais de ce que vous demandez, ou des Paramètres : une image en échec s’ouvre sur le moteur par défaut actuel, une image déjà générée garde le sien, et la fenêtre de conception gagne un sélecteur de modèle listant tout le catalogue avec son prix par image, tandis que le pied de page annonce ce que le bouton va utiliser. La vraie raison de l’échec ouvre aussi le message, traduite dans les sept langues, au lieu de figurer sous un titre générique qui la contredisait.',
    de: 'Ein fehlgeschlagenes Bild lässt sich mit einer anderen Engine erneut versuchen. Der Wiederholungsversuch nutzte den Anbieter und das Modell, die auf dem soeben gescheiterten Bild gespeichert waren — ein Bericht, der auf „Das Bild konnte nicht erzeugt werden“ feststeckte, landete also immer wieder bei derselben Engine, und ein Anbieterwechsel in den Einstellungen half ihm nicht. Die Engine kommt jetzt aus Ihrer Anfrage oder aus den Einstellungen: Ein fehlgeschlagenes Bild öffnet sich mit der aktuellen Voreinstellung, ein bereits erzeugtes behält seine eigene, und der Entwurfsdialog erhält eine Modellauswahl mit dem gesamten Katalog samt Preis pro Bild, während die Fußzeile nennt, was die Schaltfläche verwenden wird. Auch der tatsächliche Grund des Fehlschlags steht nun — in alle sieben Sprachen übersetzt — an erster Stelle, statt unter einer allgemeinen Überschrift, die ihm widersprach.',
    pt: 'Uma imagem falhada pode ser repetida com outro motor. A repetição reutilizava o fornecedor e o modelo guardados na imagem que acabara de recusar, por isso um relatório encalhado em «não foi possível gerar a imagem» voltava sempre ao mesmo motor, e mudar de fornecedor nas Definições não lhe servia de nada. O motor vem agora do que você pede ou das Definições: uma imagem falhada abre com o predefinido atual, uma já gerada mantém o seu, e o modal de desenho ganha um seletor de modelo com todo o catálogo e o preço por imagem, enquanto o rodapé indica o que o botão vai usar. O motivo real da falha encabeça também a mensagem, traduzido nos sete idiomas, em vez de ficar debaixo de um título genérico que o contradizia.',
    'pt-BR': 'Uma imagem que falhou pode ser refeita com outro motor. A nova tentativa reaproveitava o provedor e o modelo salvos na imagem que acabara de recusar, então um relatório travado em “não foi possível gerar a imagem” voltava sempre ao mesmo motor, e trocar o provedor nas Configurações não adiantava nada. O motor agora vem do que você pede ou das Configurações: uma imagem que falhou abre com o padrão atual, uma já gerada mantém o seu, e o modal de design ganha um seletor de modelo com o catálogo inteiro e o preço por imagem, enquanto o rodapé diz o que o botão vai usar. O motivo real da falha também encabeça a mensagem, traduzido nos sete idiomas, em vez de ficar embaixo de um título genérico que o contradizia.',
  },
  {
    scope: 'academic',
    es: 'El mapa de argumentos dibuja una idea bien conectada tal como es. Abrir una idea central la aplanaba en una estrella: el recorrido recortaba sus ideas en el orden de la base de datos antes de ordenarlas por relevancia, así que se caían en silencio algunos de sus debates más fuertes, y solo conservaba los enlaces que él mismo había cruzado, de modo que ninguna rama podía ramificarse por mucha profundidad que hubieras configurado. Ahora se expande por el enlace más fuerte primero, conserva todos los enlaces entre las ideas que muestra, reparte cada nivel entre debates, apoyos y el resto en lugar de dejar que los debates se lleven todos los huecos, y la cabecera cuenta las conexiones reales de la idea y cuántos enlaces se quedaron sin dibujar.',
    en: 'The argument map draws a well-connected idea as it really is. Opening a hub idea flattened it into a star: the walk capped its ideas in database order before ranking them by relevance, so some of its strongest debates silently dropped out, and it kept only the links it had crossed itself, so no branch could ramify however deep you set the tree. It now expands strongest link first, keeps every link between the ideas it shows, splits each level between debates, support and the rest instead of letting debates take every slot, and the header counts the idea’s real connections plus how many links were left undrawn.',
    fr: 'La carte d’arguments dessine une idée bien reliée telle qu’elle est. Ouvrir une idée centrale l’aplatissait en étoile : le parcours plafonnait ses idées dans l’ordre de la base avant de les classer par pertinence, si bien que certains de ses débats les plus forts disparaissaient en silence, et il ne gardait que les liens qu’il avait lui-même traversés, de sorte qu’aucune branche ne pouvait se ramifier, quelle que soit la profondeur configurée. Il s’étend désormais par le lien le plus fort d’abord, conserve tous les liens entre les idées affichées, répartit chaque niveau entre débats, appuis et le reste au lieu de laisser les débats prendre toutes les places, et l’en-tête compte les connexions réelles de l’idée ainsi que le nombre de liens non dessinés.',
    de: 'Die Argumentkarte zeichnet eine gut vernetzte Idee so, wie sie wirklich ist. Eine zentrale Idee zu öffnen, plättete sie zu einem Stern: Der Durchlauf begrenzte ihre Ideen in Datenbankreihenfolge, bevor er sie nach Relevanz sortierte — einige ihrer stärksten Debatten fielen also stillschweigend heraus —, und er behielt nur die Verbindungen, die er selbst überquert hatte, sodass sich kein Ast verzweigen konnte, welche Tiefe Sie auch einstellten. Jetzt wird zuerst entlang der stärksten Verbindung erweitert, jede Verbindung zwischen den gezeigten Ideen bleibt erhalten, jede Ebene verteilt sich auf Debatten, Zustimmung und den Rest, statt dass Debatten alle Plätze belegen, und die Kopfzeile zählt die tatsächlichen Verbindungen der Idee sowie die Zahl der nicht gezeichneten Kanten.',
    pt: 'O mapa de argumentos desenha uma ideia bem ligada tal como ela é. Abrir uma ideia central achatava-a numa estrela: o percurso cortava as suas ideias pela ordem da base de dados antes de as ordenar por relevância, pelo que alguns dos seus debates mais fortes caíam em silêncio, e só guardava as ligações que ele próprio tinha atravessado, de modo que nenhum ramo se podia ramificar por muita profundidade que tivesse configurado. Agora expande-se primeiro pela ligação mais forte, guarda todas as ligações entre as ideias que mostra, reparte cada nível entre debates, apoios e o resto em vez de deixar os debates ficarem com todos os lugares, e o cabeçalho conta as ligações reais da ideia e quantas ficaram por desenhar.',
    'pt-BR': 'O mapa de argumentos desenha uma ideia bem conectada como ela é. Abrir uma ideia central a achatava numa estrela: o percurso cortava suas ideias na ordem do banco de dados antes de ordená-las por relevância, então alguns dos seus debates mais fortes sumiam em silêncio, e ele só guardava as ligações que tinha atravessado, de modo que nenhum galho conseguia ramificar por mais profundidade que você configurasse. Agora ele expande primeiro pela ligação mais forte, mantém todas as ligações entre as ideias que mostra, divide cada nível entre debates, apoios e o resto em vez de deixar os debates ficarem com todas as vagas, e o cabeçalho conta as conexões reais da ideia e quantas ligações ficaram sem desenhar.',
  },
];

/**
 * 3.0.3: reports leave Deep Research in bulk, and a button that did nothing now
 * does what it says. Both bugs behind it were invisible while they happened, so
 * each highlight says what you saw before, not only what changed.
 */
const RELEASE_3_0_3_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'academic',
    es: 'Los informes salen de Deep Research en bloque, y también desde su tarjeta. Antes todo lo que producía la galería se descargaba de uno en uno y desde el lector: una biblioteca de treinta informes eran treinta diálogos de guardado, y una tarjeta no se podía descargar sin abrirla. Ahora el botón Descargar de la cabecera reutiliza el modo de selección —con seleccionar todo—, te deja elegir Markdown, PDF o ambos y entrega un único ZIP; cada tarjeta y cada fila tienen además su icono de descarga. Los PDF se imprimen de uno en uno con una barra de progreso, porque esa pasada puede durar un minuto y un minuto en silencio parece un cuelgue.',
    en: 'Reports leave Deep Research in bulk, and from their card too. Everything the gallery produced used to leave one at a time through the reader: a library of thirty reports meant thirty save dialogs, and a card could not be downloaded without opening it first. The header’s Download button now reuses selection mode — select-all included — lets you pick Markdown, PDF or both, and hands back a single ZIP; every card and list row also gains a download icon. PDFs are printed one at a time behind a progress bar, because that pass can run for a minute and a silent minute reads as a hang.',
    fr: 'Les rapports quittent Deep Research en lot, et depuis leur fiche. Tout ce que produisait la galerie sortait un par un, via le lecteur : une bibliothèque de trente rapports, c’étaient trente boîtes de dialogue d’enregistrement, et une fiche ne pouvait pas être téléchargée sans être ouverte. Le bouton Télécharger de l’en-tête réutilise désormais le mode de sélection — tout sélectionner compris —, vous laisse choisir Markdown, PDF ou les deux, et renvoie une seule archive ZIP ; chaque fiche et chaque ligne gagnent aussi une icône de téléchargement. Les PDF sont imprimés un par un derrière une barre de progression, car ce passage peut durer une minute et une minute silencieuse ressemble à un blocage.',
    de: 'Berichte verlassen Deep Research jetzt im Bündel — und auch direkt von ihrer Karte. Alles, was die Galerie erzeugte, ging bisher einzeln über den Leser hinaus: eine Bibliothek mit dreißig Berichten bedeutete dreißig Speicherdialoge, und eine Karte ließ sich nicht herunterladen, ohne sie zu öffnen. Die Schaltfläche „Herunterladen“ in der Kopfzeile nutzt nun den Auswahlmodus — samt Alles auswählen —, lässt Markdown, PDF oder beides wählen und liefert ein einziges ZIP; jede Karte und jede Listenzeile erhält zudem ein Download-Symbol. PDFs werden nacheinander hinter einem Fortschrittsbalken gedruckt, denn dieser Durchlauf kann eine Minute dauern, und eine stille Minute wirkt wie ein Absturz.',
    pt: 'Os relatórios saem do Deep Research em bloco, e também a partir do seu cartão. Tudo o que a galeria produzia saía um de cada vez, pelo leitor: uma biblioteca de trinta relatórios eram trinta caixas de gravação, e um cartão não se podia descarregar sem o abrir. O botão Descarregar do cabeçalho reutiliza agora o modo de seleção — incluindo selecionar tudo —, deixa escolher Markdown, PDF ou ambos e devolve um único ZIP; cada cartão e cada linha ganham também um ícone de descarga. Os PDF são impressos um a um com uma barra de progresso, porque essa passagem pode demorar um minuto e um minuto em silêncio parece um bloqueio.',
    'pt-BR': 'Os relatórios saem do Deep Research em lote, e também pelo próprio card. Tudo o que a galeria produzia saía um por vez, pelo leitor: uma biblioteca de trinta relatórios eram trinta caixas de salvamento, e um card não dava para baixar sem abrir. O botão Baixar do cabeçalho agora reaproveita o modo de seleção — com selecionar tudo —, deixa escolher Markdown, PDF ou os dois e devolve um único ZIP; cada card e cada linha ganham também um ícone de download. Os PDFs são impressos um a um com barra de progresso, porque essa passagem pode levar um minuto e um minuto em silêncio parece travamento.',
  },
  {
    scope: 'academic',
    es: 'El diseño de imagen de un informe puede sugerirte la escena. «Sugerir con IA» escribe en el cuadro del prompt una descripción visual a partir del resumen del propio informe, la misma que el generador se habría escrito para sí y que hasta ahora nunca veías. Puedes editarla, y no se guarda nada hasta que generas con ella.',
    en: 'A report’s image design can now suggest the scene for you. “Suggest with AI” streams a visual description written from the report’s own summary into the prompt box — the same one the generator would have written for itself, which until now you never saw. You can edit it, and nothing is saved until you generate with it.',
    fr: 'La conception d’image d’un rapport peut désormais vous suggérer la scène. « Suggérer avec l’IA » écrit dans le champ du prompt une description visuelle tirée du résumé du rapport lui-même — celle-là même que le générateur se serait écrite et que vous ne voyiez jamais. Vous pouvez la modifier, et rien n’est enregistré tant que vous ne générez pas avec elle.',
    de: 'Der Bildentwurf eines Berichts kann die Szene jetzt vorschlagen. „Mit KI vorschlagen“ schreibt eine visuelle Beschreibung aus der Zusammenfassung des Berichts selbst in das Prompt-Feld — genau die, die sich der Generator selbst geschrieben hätte und die bisher unsichtbar blieb. Sie lässt sich bearbeiten, und nichts wird gespeichert, bis Sie damit generieren.',
    pt: 'O desenho de imagem de um relatório pode agora sugerir-lhe a cena. «Sugerir com IA» escreve na caixa do prompt uma descrição visual feita a partir do resumo do próprio relatório — a mesma que o gerador teria escrito para si e que até agora nunca via. Pode editá-la, e nada é guardado até gerar com ela.',
    'pt-BR': 'O design de imagem de um relatório pode sugerir a cena para você. “Sugerir com IA” escreve na caixa do prompt uma descrição visual feita a partir do resumo do próprio relatório — a mesma que o gerador teria escrito para si e que até agora você nunca via. Dá para editar, e nada é salvo até você gerar com ela.',
  },
  {
    scope: 'general',
    es: 'Cancelar una narración ahora la cancela de verdad. El botón no hacía nada visible: el trabajo seguía hasta el final de la sección —minutos de espera, o para siempre si la voz no llegaba a responder— y se quedaba atascado el resto de la sesión sin manera de empezar de nuevo. Ahora el clic se acusa al instante, el fragmento en curso se descarta y una voz local deja de consumir un núcleo para terminar una narración que nadie va a escuchar.',
    en: 'Cancelling a narration now actually cancels it. The button did nothing visible: the job ran on to the end of the section — minutes of waiting, or forever if the voice never answered — and then stayed stuck for the rest of the session with no way to start over. The click is now acknowledged straight away, the segment in flight is dropped, and a local voice stops burning a core to finish a narration nobody will hear.',
    fr: 'Annuler une narration l’annule désormais vraiment. Le bouton ne produisait rien de visible : le travail se poursuivait jusqu’à la fin de la section — plusieurs minutes d’attente, ou indéfiniment si la voix ne répondait jamais — puis restait bloqué pour le reste de la session, sans possibilité de recommencer. Le clic est maintenant pris en compte immédiatement, le segment en cours est abandonné, et une voix locale cesse de consommer un cœur pour terminer une narration que personne n’écoutera.',
    de: 'Das Abbrechen einer Erzählung bricht sie jetzt wirklich ab. Die Schaltfläche bewirkte nichts Sichtbares: Der Auftrag lief bis zum Ende des Abschnitts weiter — minutenlanges Warten, oder endlos, wenn die Stimme nie antwortete — und blieb dann für den Rest der Sitzung hängen, ohne Möglichkeit, neu zu beginnen. Der Klick wird nun sofort bestätigt, das laufende Segment verworfen, und eine lokale Stimme verbraucht keinen Kern mehr, um eine Erzählung zu Ende zu bringen, die niemand hören wird.',
    pt: 'Cancelar uma narração passa a cancelá-la mesmo. O botão não fazia nada de visível: o trabalho seguia até ao fim da secção — minutos de espera, ou para sempre se a voz nunca chegasse a responder — e depois ficava preso o resto da sessão, sem forma de recomeçar. Agora o clique é reconhecido de imediato, o segmento em curso é descartado e uma voz local deixa de consumir um núcleo para terminar uma narração que ninguém vai ouvir.',
    'pt-BR': 'Cancelar uma narração agora cancela de verdade. O botão não fazia nada visível: o trabalho seguia até o fim da seção — minutos de espera, ou para sempre se a voz nunca respondesse — e depois ficava travado pelo resto da sessão, sem como recomeçar. Agora o clique é reconhecido na hora, o trecho em andamento é descartado e uma voz local deixa de consumir um núcleo para terminar uma narração que ninguém vai ouvir.',
  },
];

/**
 * 3.0.2 is the Deep Research release: the report now proves what it claims,
 * says which claims are worth a second look, and stops freezing the argument
 * views. One highlight per user-visible change, not one per commit.
 */
const RELEASE_3_0_2_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'academic',
    es: 'Deep Research ya no afirma más de lo que puede sostener. Cada cita se comprueba contra lo que su fuente dice de verdad, y la que no lo sostiene desaparece del texto y de la bibliografía. El redactor recibe ahora el contenido real de lo que cita —el enunciado de cada idea, lo que afirma cada hueco, quién sostiene cada lado de un debate y el texto literal de cada pasaje con su página—, de modo que los desacuerdos entre autores se argumentan con nombres en vez de mencionarse de pasada. La cobertura que declara el informe es la que realmente cita, no la que tenía asignada.',
    en: 'Deep Research no longer claims more than it can support. Every citation is checked against what its source actually says, and one the source does not support disappears from the text and from the bibliography. The writer now receives the real content of what it cites — each idea’s statement, what each gap claims, who holds each side of a debate and the literal text of each passage with its page — so disagreements between authors are argued with names instead of mentioned in passing. The coverage the report declares is what it really cites, not what it was assigned.',
    fr: 'Deep Research n’affirme plus au-delà de ce qu’il peut étayer. Chaque citation est confrontée à ce que sa source dit réellement, et celle qui n’est pas étayée disparaît du texte et de la bibliographie. Le rédacteur reçoit désormais le contenu réel de ce qu’il cite — l’énoncé de chaque idée, ce qu’affirme chaque lacune, qui défend chaque position d’un débat et le texte littéral de chaque passage avec sa page —, si bien que les désaccords entre auteurs sont argumentés avec des noms au lieu d’être évoqués en passant. La couverture annoncée est celle qui est réellement citée, non celle qui avait été assignée.',
    de: 'Deep Research behauptet nicht mehr, als es belegen kann. Jede Quellenangabe wird daran geprüft, was ihre Quelle tatsächlich sagt; was sie nicht stützt, verschwindet aus dem Text und aus dem Literaturverzeichnis. Der Schreiber erhält jetzt den echten Inhalt dessen, was er zitiert — die Aussage jeder Idee, was jede Forschungslücke behauptet, wer welche Seite einer Debatte vertritt und den wörtlichen Text jeder Passage mit Seitenangabe —, sodass Meinungsverschiedenheiten zwischen Autoren mit Namen ausgetragen statt nebenbei erwähnt werden. Die angegebene Abdeckung ist die tatsächlich zitierte, nicht die zugewiesene.',
    pt: 'O Deep Research deixou de afirmar mais do que consegue sustentar. Cada citação é confrontada com o que a fonte realmente diz, e a que não a sustenta desaparece do texto e da bibliografia. O redator recebe agora o conteúdo real do que cita — o enunciado de cada ideia, o que afirma cada lacuna, quem defende cada lado de um debate e o texto literal de cada passagem com a sua página —, pelo que os desacordos entre autores são argumentados com nomes em vez de referidos de passagem. A cobertura declarada é a realmente citada, não a atribuída.',
    'pt-BR': 'O Deep Research não afirma mais do que consegue sustentar. Cada citação é checada contra o que a fonte realmente diz, e a que não sustenta some do texto e da bibliografia. O redator agora recebe o conteúdo real do que cita — o enunciado de cada ideia, o que afirma cada lacuna, quem defende cada lado de um debate e o texto literal de cada passagem com sua página —, então divergências entre autores são argumentadas com nomes em vez de citadas de passagem. A cobertura declarada é a realmente citada, não a atribuída.',
  },
  {
    scope: 'academic',
    es: 'Un panel nuevo te dice qué afirmaciones conviene comprobar antes de citarlas. Un tercio de las citas que sobreviven a la verificación tienen respaldo parcial: la fuente sostiene una versión más débil de lo que la frase afirma. El informe las lista junto al texto de su fuente y el autor y año que abrir, así que contrastar un informe pasa de leerse las obras enteras a comparar un puñado de pares.',
    en: 'A new panel tells you which claims to check before citing them. A third of the citations that survive verification are only partially supported: the source backs a weaker version of the sentence than the sentence claims. The report lists them next to the text of their source and the author and year to open, so checking a report goes from reading whole works to comparing a handful of pairs.',
    fr: 'Un nouveau panneau indique quelles affirmations vérifier avant de les citer. Un tiers des citations qui passent la vérification ne sont qu’en partie étayées : la source soutient une version plus faible que ce qu’affirme la phrase. Le rapport les liste à côté du texte de leur source et de l’auteur et de l’année à ouvrir ; vérifier un rapport passe donc de la lecture d’ouvrages entiers à la comparaison de quelques paires.',
    de: 'Ein neues Panel zeigt, welche Aussagen vor dem Zitieren zu prüfen sind. Ein Drittel der Belege, die die Prüfung überstehen, ist nur teilweise gedeckt: Die Quelle stützt eine schwächere Fassung als der Satz behauptet. Der Bericht listet sie neben dem Text ihrer Quelle sowie Autor und Jahr zum Nachschlagen, sodass die Prüfung eines Berichts vom Lesen ganzer Werke zum Vergleich weniger Paare wird.',
    pt: 'Um novo painel indica que afirmações convém verificar antes de as citar. Um terço das citações que sobrevivem à verificação tem apoio parcial: a fonte sustenta uma versão mais fraca do que a frase afirma. O relatório lista-as junto ao texto da sua fonte e ao autor e ano a abrir, pelo que conferir um relatório passa de ler obras inteiras a comparar um punhado de pares.',
    'pt-BR': 'Um painel novo mostra quais afirmações conferir antes de citá-las. Um terço das citações que passam na verificação tem apoio parcial: a fonte sustenta uma versão mais fraca do que a frase afirma. O relatório as lista junto ao texto da fonte e ao autor e ano a abrir, então conferir um relatório passa de ler obras inteiras a comparar alguns pares.',
  },
  {
    scope: 'academic',
    es: 'El mapa de argumentos y los debates ya no congelan la ventana. Pintaban de golpe decenas de miles de elementos y la aplicación entera se quedaba bloqueada uno o dos segundos al abrirlos; ahora se dibujan por tramos a medida que bajas. Además, el mapa se despliega rama a rama en vez de abrirse entero, así que puedes seguir una línea de argumentación sin perderte.',
    en: 'The argument map and debates no longer freeze the window. They painted tens of thousands of elements at once and the whole app locked up for a second or two when you opened them; now they draw in chunks as you scroll. The map also unfolds one branch at a time instead of opening whole, so you can follow a line of argument without losing your place.',
    fr: 'La carte d’arguments et les débats ne figent plus la fenêtre. Ils affichaient d’un coup des dizaines de milliers d’éléments et toute l’application se bloquait une ou deux secondes à l’ouverture ; ils se dessinent désormais par tranches au fil du défilement. La carte se déplie aussi branche par branche au lieu de s’ouvrir entièrement, ce qui permet de suivre un fil argumentatif sans se perdre.',
    de: 'Argumentkarte und Debatten frieren das Fenster nicht mehr ein. Sie zeichneten Zehntausende Elemente auf einmal und die ganze App blockierte beim Öffnen für ein bis zwei Sekunden; jetzt wird beim Scrollen abschnittsweise gezeichnet. Die Karte klappt zudem Zweig für Zweig auf, statt sich vollständig zu öffnen, sodass man einer Argumentationslinie folgen kann, ohne den Faden zu verlieren.',
    pt: 'O mapa de argumentos e os debates deixaram de bloquear a janela. Desenhavam de uma vez dezenas de milhares de elementos e a aplicação inteira ficava presa um ou dois segundos ao abri-los; agora desenham-se por troços à medida que percorre. O mapa também se desdobra ramo a ramo em vez de abrir por completo, para poder seguir uma linha de argumentação sem se perder.',
    'pt-BR': 'O mapa de argumentos e os debates não travam mais a janela. Eles desenhavam dezenas de milhares de elementos de uma vez e o aplicativo inteiro ficava travado um ou dois segundos ao abri-los; agora desenham em trechos conforme você rola. O mapa também se abre galho por galho em vez de tudo de uma vez, para você seguir uma linha de argumentação sem se perder.',
  },
  {
    scope: 'worldbuilding',
    es: 'Los personajes entrevistados hablan en vez de recitar. En el modo demostración respondían con la ficha del personaje leída en voz alta; ahora contestan desde su propia voz, con su carácter y sus silencios, como una entrevista de verdad.',
    en: 'Interviewed characters speak instead of reciting. In demo mode they answered by reading their character sheet aloud; now they reply in their own voice, with their temperament and their silences, like a real interview.',
    fr: 'Les personnages interviewés parlent au lieu de réciter. En mode démonstration, ils répondaient en lisant leur fiche à voix haute ; ils répondent désormais avec leur propre voix, leur tempérament et leurs silences, comme dans un véritable entretien.',
    de: 'Befragte Figuren sprechen, statt zu rezitieren. Im Demomodus antworteten sie, indem sie ihr Datenblatt vorlasen; jetzt antworten sie mit eigener Stimme, mit ihrem Temperament und ihren Pausen, wie in einem echten Interview.',
    pt: 'As personagens entrevistadas falam em vez de recitar. No modo demonstração respondiam lendo a sua ficha em voz alta; agora respondem com a sua própria voz, com o seu carácter e os seus silêncios, como numa entrevista a sério.',
    'pt-BR': 'Os personagens entrevistados falam em vez de recitar. No modo demonstração respondiam lendo a ficha em voz alta; agora respondem com a própria voz, com seu temperamento e seus silêncios, como numa entrevista de verdade.',
  },
  {
    scope: 'toolkit',
    es: 'El runtime de Codex incluido en Nodus también genera imágenes, así que puedes crear ilustraciones sin configurar ninguna clave adicional si ya tienes conectada tu suscripción de ChatGPT. Y la generación con Google vuelve a funcionar: se le pedía un formato de imagen que ya no acepta.',
    en: 'The Codex runtime bundled with Nodus now generates images too, so you can create illustrations without setting up any extra key if your ChatGPT subscription is already connected. Generation with Google works again as well: it was being asked for an image format it no longer accepts.',
    fr: 'Le runtime Codex fourni avec Nodus génère aussi des images : vous pouvez créer des illustrations sans configurer de clé supplémentaire si votre abonnement ChatGPT est déjà connecté. La génération avec Google refonctionne également : on lui demandait un format d’image qu’il n’accepte plus.',
    de: 'Die mit Nodus gelieferte Codex-Laufzeit erzeugt jetzt auch Bilder, sodass Sie Illustrationen ohne zusätzlichen Schlüssel erstellen können, wenn Ihr ChatGPT-Abo bereits verbunden ist. Auch die Erzeugung mit Google funktioniert wieder: Es wurde ein Bildformat angefordert, das nicht mehr akzeptiert wird.',
    pt: 'O runtime do Codex incluído no Nodus também gera imagens, pelo que pode criar ilustrações sem configurar qualquer chave adicional se já tiver ligada a sua subscrição do ChatGPT. E a geração com o Google volta a funcionar: pedia-se-lhe um formato de imagem que já não aceita.',
    'pt-BR': 'O runtime do Codex incluído no Nodus também gera imagens, então você pode criar ilustrações sem configurar nenhuma chave extra se sua assinatura do ChatGPT já estiver conectada. E a geração com o Google voltou a funcionar: pedia-se um formato de imagem que ele não aceita mais.',
  },
  {
    scope: 'general',
    es: 'Las actualizaciones de macOS vuelven a instalarse solas. Nodus descargaba la versión nueva y después no llegaba a cerrarse, así que el instalador se quedaba esperando indefinidamente; al forzar el cierre se lo llevaba por delante y volvías a abrir en la versión anterior, sin un solo aviso. Ahora la salida se completa siempre, el instalador termina el trabajo aunque fuerces el cierre, y si una actualización no llega a instalarse Nodus te lo dice al arrancar en vez de reintentarla en silencio.',
    en: 'macOS updates install themselves again. Nodus downloaded the new version and then never finished quitting, so the installer waited indefinitely; forcing the app to quit took the installer down with it, and you reopened on the previous version without a single warning. The quit now always completes, the installer finishes the job even if you force quit, and if an update fails to install Nodus tells you at startup instead of silently retrying it.',
    fr: 'Les mises à jour macOS s’installent de nouveau toutes seules. Nodus téléchargeait la nouvelle version puis ne parvenait pas à se fermer : l’installateur attendait indéfiniment, et forcer la fermeture l’emportait avec lui — vous rouvriez sur l’ancienne version sans le moindre avertissement. La fermeture aboutit désormais toujours, l’installateur termine son travail même si vous forcez la sortie, et si une mise à jour échoue Nodus vous le dit au démarrage au lieu de la relancer en silence.',
    de: 'macOS-Updates installieren sich wieder von selbst. Nodus lud die neue Version herunter und beendete sich dann nicht mehr, sodass das Installationsprogramm endlos wartete; ein erzwungenes Beenden riss es mit, und du startetest wieder in der alten Version — ohne jeden Hinweis. Das Beenden gelingt jetzt immer, das Installationsprogramm bringt die Arbeit auch nach einem erzwungenen Beenden zu Ende, und wenn ein Update scheitert, sagt Nodus es dir beim Start, statt es stillschweigend zu wiederholen.',
    pt: 'As atualizações no macOS voltam a instalar-se sozinhas. O Nodus descarregava a versão nova e depois não chegava a fechar, por isso o instalador ficava à espera indefinidamente; ao forçar o encerramento levava-o à frente e reabrias na versão anterior, sem um único aviso. O encerramento conclui-se agora sempre, o instalador termina o trabalho mesmo que forces a saída, e se uma atualização não chegar a instalar-se o Nodus avisa-te ao arrancar em vez de a repetir em silêncio.',
    'pt-BR': 'As atualizações no macOS voltam a se instalar sozinhas. O Nodus baixava a versão nova e depois não terminava de fechar, então o instalador ficava esperando indefinidamente; forçar o encerramento levava o instalador junto e você reabria na versão anterior, sem nenhum aviso. O encerramento agora sempre se completa, o instalador termina o trabalho mesmo se você forçar a saída, e se uma atualização não instalar o Nodus avisa na inicialização em vez de repetir em silêncio.',
  },
];

/**
 * 3.0.1 is a performance release: no new surface, three things that were making
 * the app feel slow on a large vault. One highlight per cause, not one per query.
 */
const RELEASE_3_0_1_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'academic',
    es: 'Las secciones que se quedaban pensando ahora abren de inmediato. El grafo, el mapa de argumentos, los debates, la ruta de lectura y las fichas de autor cargaban recorriendo la biblioteca entera y bloqueaban la aplicación entera mientras lo hacían; ahora piden solo lo que muestran. En una bóveda de casi 10.000 ideas, el grafo pasa de 2,7 segundos de congelación a menos de 0,2.',
    en: 'Sections that used to hang now open straight away. The graph, argument map, debates, reading path and author dossiers each loaded by walking the whole library, freezing the entire app while they did it; now they ask only for what they show. On a vault of nearly 10,000 ideas the graph went from 2.7 seconds of frozen window to under 0.2.',
    fr: 'Les sections qui restaient bloquées s’ouvrent désormais immédiatement. Le graphe, la carte d’arguments, les débats, le parcours de lecture et les fiches d’auteur se chargeaient en parcourant toute la bibliothèque et figeaient l’application entière ; ils ne demandent plus que ce qu’ils affichent. Sur une bibliothèque de près de 10 000 idées, le graphe passe de 2,7 secondes de fenêtre figée à moins de 0,2.',
    de: 'Abschnitte, die sich aufhängten, öffnen jetzt sofort. Graph, Argumentkarte, Debatten, Lesepfad und Autorendossiers luden jeweils die gesamte Bibliothek und blockierten dabei die ganze Anwendung; jetzt fragen sie nur noch ab, was sie anzeigen. In einem Tresor mit fast 10.000 Ideen sank der Graph von 2,7 Sekunden eingefrorenem Fenster auf unter 0,2.',
    pt: 'As secções que ficavam a pensar abrem agora de imediato. O grafo, o mapa de argumentos, os debates, o percurso de leitura e as fichas de autor carregavam percorrendo toda a biblioteca e bloqueavam a aplicação inteira enquanto o faziam; agora pedem apenas o que mostram. Num cofre com quase 10 000 ideias, o grafo passou de 2,7 segundos de janela congelada para menos de 0,2.',
    'pt-BR': 'As seções que ficavam travadas agora abrem na hora. O grafo, o mapa de argumentos, os debates, a trilha de leitura e as fichas de autor carregavam percorrendo a biblioteca inteira e travavam o aplicativo todo enquanto isso; agora pedem apenas o que exibem. Em um cofre com quase 10.000 ideias, o grafo caiu de 2,7 segundos de janela congelada para menos de 0,2.',
  },
  {
    scope: 'nodi',
    es: 'Nodi se queda quieto cuando no tiene nada que decir, y vuelve a moverse en cuanto lo tiene. Su animación no paraba nunca, ni siquiera con la aplicación en reposo: eso costaba la mitad de un núcleo de forma permanente y calentaba el equipo. Ahora mantiene la pose unos segundos después de la última actividad y despierta al pasar el ratón, al cambiar de estado o al llegar un aviso. Ninguna animación se ha eliminado.',
    en: 'Nodi holds its pose when it has nothing to say, and moves again the moment it does. Its animation never stopped, not even with the app idle: that cost half a core permanently and warmed the machine. It now settles a few seconds after the last activity and wakes on hover, on a change of state or on a notification. No animation was removed.',
    fr: 'Nodi garde la pose quand il n’a rien à dire, et repart dès qu’il a quelque chose. Son animation ne s’arrêtait jamais, même application au repos : cela coûtait en permanence un demi-cœur et chauffait la machine. Il se fige désormais quelques secondes après la dernière activité et se réveille au survol, à un changement d’état ou à une notification. Aucune animation n’a été supprimée.',
    de: 'Nodi hält seine Pose, wenn es nichts zu sagen hat, und bewegt sich wieder, sobald doch. Seine Animation hörte nie auf, auch nicht bei ruhender App: das kostete dauerhaft einen halben Kern und erwärmte das Gerät. Jetzt kommt es einige Sekunden nach der letzten Aktivität zur Ruhe und erwacht beim Überfahren, bei einem Zustandswechsel oder bei einer Benachrichtigung. Es wurde keine Animation entfernt.',
    pt: 'O Nodi mantém a pose quando não tem nada a dizer e volta a mover-se assim que tem. A sua animação nunca parava, nem com a aplicação em repouso: isso custava permanentemente meio núcleo e aquecia o equipamento. Agora assenta alguns segundos após a última atividade e acorda ao passar o rato, ao mudar de estado ou ao chegar um aviso. Nenhuma animação foi removida.',
    'pt-BR': 'O Nodi mantém a pose quando não tem nada a dizer e volta a se mexer assim que tem. Sua animação nunca parava, nem com o aplicativo em repouso: isso custava meio núcleo permanentemente e esquentava a máquina. Agora ele descansa alguns segundos após a última atividade e acorda ao passar o mouse, ao mudar de estado ou ao chegar um aviso. Nenhuma animação foi removida.',
  },
  {
    scope: 'general',
    es: 'La caché de texto extraído de los PDF ya tiene un tope. Se escribía sin borrarse nunca y llegaba a ocupar una cuarta parte del archivo de la bóveda, que además se copia entera en cada copia de seguridad. Ahora se limita a 64 MB conservando lo más reciente; nada se pierde, porque cualquier texto descartado se vuelve a extraer del PDF cuando hace falta.',
    en: 'The cache of text extracted from PDFs is now bounded. It was written and never pruned, growing to a quarter of the vault file — which is copied whole into every backup. It is now capped at 64 MB keeping the most recent; nothing is lost, because any discarded text is extracted from its PDF again when needed.',
    fr: 'Le cache du texte extrait des PDF est désormais borné. Il était écrit sans jamais être purgé et atteignait un quart du fichier de la bibliothèque, lui-même copié en entier dans chaque sauvegarde. Il est maintenant limité à 64 Mo en conservant le plus récent ; rien n’est perdu, car tout texte écarté est réextrait de son PDF au besoin.',
    de: 'Der Cache des aus PDFs extrahierten Texts ist jetzt begrenzt. Er wurde geschrieben und nie bereinigt und erreichte ein Viertel der Tresordatei, die vollständig in jede Sicherung kopiert wird. Er ist nun auf 64 MB begrenzt und behält das Neueste; nichts geht verloren, denn verworfener Text wird bei Bedarf erneut aus seinem PDF extrahiert.',
    pt: 'A cache do texto extraído dos PDF passa a ter um limite. Era escrita sem nunca ser purgada e chegava a ocupar um quarto do ficheiro do cofre, que é copiado por inteiro em cada cópia de segurança. Agora está limitada a 64 MB mantendo o mais recente; nada se perde, porque qualquer texto descartado é extraído de novo do PDF quando for preciso.',
    'pt-BR': 'O cache do texto extraído dos PDFs agora tem limite. Ele era gravado e nunca podado, chegando a ocupar um quarto do arquivo do cofre, que é copiado inteiro em cada backup. Agora está limitado a 64 MB mantendo o mais recente; nada se perde, porque qualquer texto descartado é extraído do PDF de novo quando necessário.',
  },
];

// v2.6.0 shipped with only three Zotero highlights, silently dropping every other
// change merged since 2.5.4 (Nodus Apps, Nodus Translate, local image generation,
// professional PDF exports, the experimental Nodus Server, and the rest of the
// Zotero add-on work). v2.6.1 republishes the complete list and backfills it onto
// the 2.6.0 entry too, so the version picker's history stays accurate. Both
// versions intentionally share this exact array — do not fork it.
const RELEASE_2_6_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'plugin',
    es: 'Nodus para Zotero incorpora búsqueda semántica multilingüe completamente local con E5 small cuantizado. El modelo se descarga una sola vez, se ejecuta en el dispositivo y elimina la configuración y el coste de una API de embeddings; los índices persisten comprimidos junto a sus vectores en el perfil de Zotero.',
    en: 'Nodus for Zotero now includes fully local multilingual semantic search with a quantised E5 small model. The model downloads once, runs on-device, and removes embedding API setup and cost; compressed indexes and their vectors persist in the Zotero profile.',
    fr: 'Nodus pour Zotero intègre désormais une recherche sémantique multilingue entièrement locale avec un modèle E5 small quantifié. Le modèle n’est téléchargé qu’une fois, s’exécute sur l’appareil et supprime la configuration et le coût d’une API d’embeddings ; les index compressés et leurs vecteurs sont conservés dans le profil Zotero.',
    de: 'Nodus für Zotero bietet jetzt eine vollständig lokale, mehrsprachige semantische Suche mit einem quantisierten E5-small-Modell. Das Modell wird einmal heruntergeladen, läuft auf dem Gerät und macht Einrichtung und Kosten einer Embedding-API überflüssig; komprimierte Indizes und ihre Vektoren bleiben im Zotero-Profil erhalten.',
    pt: 'O Nodus para Zotero inclui agora pesquisa semântica multilingue totalmente local com um modelo E5 small quantizado. O modelo é descarregado uma única vez, executa-se no dispositivo e elimina a configuração e o custo de uma API de embeddings; os índices comprimidos e os respetivos vetores ficam guardados no perfil do Zotero.',
    'pt-BR': 'O Nodus para Zotero agora inclui busca semântica multilíngue totalmente local com um modelo E5 small quantizado. O modelo é baixado uma única vez, roda no dispositivo e elimina a configuração e o custo de uma API de embeddings; os índices compactados e seus vetores ficam salvos no perfil do Zotero.',
  },
  {
    scope: 'plugin',
    es: 'Los PDF largos se reconstruyen por páginas, columnas y párrafos, eliminando encabezados y pies repetidos y conservando coordenadas para citas y resaltados exactos. Un recuperador acotado puede reformular la búsqueda, inspeccionar rangos de páginas y ampliar la evidencia en dos rondas antes de responder, con OCR y análisis visual cuando hacen falta.',
    en: 'Long PDFs are reconstructed by page, column and paragraph, removing repeated headers and footers while retaining coordinates for exact citations and highlights. A bounded retriever can reformulate searches, inspect page ranges and expand evidence for two rounds before answering, with OCR and visual analysis when needed.',
    fr: 'Les PDF longs sont reconstruits par page, colonne et paragraphe, avec suppression des en-têtes et pieds de page répétés et conservation des coordonnées pour des citations et surlignages exacts. Un moteur de récupération limité peut reformuler les recherches, inspecter des plages de pages et enrichir les preuves pendant deux tours avant de répondre, avec OCR et analyse visuelle si nécessaire.',
    de: 'Lange PDFs werden nach Seiten, Spalten und Absätzen rekonstruiert; wiederkehrende Kopf- und Fußzeilen werden entfernt, Koordinaten für genaue Zitate und Markierungen bleiben erhalten. Eine begrenzte Suche kann Anfragen neu formulieren, Seitenbereiche prüfen und die Evidenz in zwei Runden erweitern, bevor sie antwortet – bei Bedarf mit OCR und visueller Analyse.',
    pt: 'Os PDF longos são reconstruídos por página, coluna e parágrafo, removendo cabeçalhos e rodapés repetidos e preservando coordenadas para citações e destaques exatos. Um recuperador limitado pode reformular pesquisas, inspecionar intervalos de páginas e ampliar a evidência em duas rondas antes de responder, com OCR e análise visual quando necessário.',
    'pt-BR': 'PDFs longos são reconstruídos por página, coluna e parágrafo, removendo cabeçalhos e rodapés repetidos e preservando coordenadas para citações e destaques exatos. Um recuperador limitado pode reformular buscas, inspecionar intervalos de páginas e ampliar as evidências por duas rodadas antes de responder, com OCR e análise visual quando necessário.',
  },
  {
    scope: 'plugin',
    es: 'En el modal de Novedades, la N conectada de Nodus gira para formar una Z e identifica de un vistazo las mejoras del complemento. Dentro de Zotero, el complemento conserva la N normal de Nodus.',
    en: 'In the What’s New modal, Nodus’s connected N rotates into a Z to identify add-on improvements at a glance. Inside Zotero, the add-on keeps the normal Nodus N.',
    fr: 'Dans la fenêtre Nouveautés, le N connecté de Nodus pivote pour former un Z et identifier d’un coup d’œil les améliorations de l’extension. Dans Zotero, l’extension conserve le N normal de Nodus.',
    de: 'Im Neuigkeiten-Dialog dreht sich das verbundene N von Nodus zu einem Z, damit Verbesserungen des Add-ons sofort erkennbar sind. In Zotero selbst behält das Add-on das normale N von Nodus.',
    pt: 'No modal Novidades, o N ligado do Nodus roda para formar um Z e identificar de imediato as melhorias do complemento. Dentro do Zotero, o complemento mantém o N normal do Nodus.',
    'pt-BR': 'No modal Novidades, o N conectado do Nodus gira para formar um Z e identificar de imediato as melhorias do complemento. Dentro do Zotero, o complemento mantém o N normal do Nodus.',
  },
  {
    scope: 'toolkit',
    es: 'Herramientas estrena Nodus Apps: crea con IA miniaplicaciones completas y funcionales —juegos, calculadoras, planificadores, encuestas— con un catálogo inicial ya incluido. Cada app se puede compartir en directo con un código QR o un PIN para que otras personas participen desde su móvil.',
    en: 'Tools introduces Nodus Apps: use AI to build complete, working mini apps — games, calculators, planners, polls — with an initial catalogue ready to use. Each app can be shared live with a QR code or PIN so others can join in from their phone.',
    fr: 'Outils inaugure Nodus Apps : créez avec l’IA des mini-applications complètes et fonctionnelles — jeux, calculatrices, planificateurs, sondages — avec un catalogue initial déjà inclus. Chaque application peut être partagée en direct via un code QR ou un code PIN pour que d’autres personnes participent depuis leur téléphone.',
    de: 'Werkzeuge führt Nodus Apps ein: Erstelle mit KI vollständige, funktionsfähige Mini-Apps – Spiele, Rechner, Planer, Umfragen – mit einem bereits enthaltenen Startkatalog. Jede App lässt sich live per QR-Code oder PIN teilen, damit andere vom Smartphone aus teilnehmen können.',
    pt: 'Ferramentas estreia o Nodus Apps: crie com IA miniaplicações completas e funcionais — jogos, calculadoras, planeadores, sondagens — com um catálogo inicial já incluído. Cada aplicação pode ser partilhada ao vivo através de um código QR ou de um PIN para que outras pessoas participem a partir do telemóvel.',
    'pt-BR': 'Ferramentas estreia o Nodus Apps: crie com IA miniaplicativos completos e funcionais — jogos, calculadoras, planejadores, enquetes — com um catálogo inicial já incluído. Cada app pode ser compartilhado ao vivo com um código QR ou um PIN para que outras pessoas participem pelo celular.',
  },
  {
    scope: 'toolkit',
    es: 'Nueva herramienta Nodus Translate: traduce texto pegado, archivos y adjuntos de Zotero con el modelo de IA que elijas. Conserva la estructura de DOCX y EPUB, e incluye un modo facsímil para PDF que mantiene el diseño, las imágenes y la geometría de página mientras sustituye el texto visible.',
    en: 'New Nodus Translate tool: translate pasted text, files and Zotero attachments with the AI model of your choice. It preserves DOCX and EPUB structure, and includes a PDF facsimile mode that keeps the layout, images and page geometry while replacing the visible text.',
    fr: 'Nouvel outil Nodus Translate : traduisez du texte collé, des fichiers et des pièces jointes Zotero avec le modèle d’IA de votre choix. Il conserve la structure des DOCX et EPUB, et inclut un mode fac-similé pour les PDF qui préserve la mise en page, les images et la géométrie des pages tout en remplaçant le texte visible.',
    de: 'Neues Werkzeug Nodus Translate: Übersetze eingefügten Text, Dateien und Zotero-Anhänge mit dem KI-Modell deiner Wahl. Es bewahrt die Struktur von DOCX und EPUB und bietet einen PDF-Faksimile-Modus, der Layout, Bilder und Seitengeometrie beibehält, während der sichtbare Text ersetzt wird.',
    pt: 'Nova ferramenta Nodus Translate: traduza texto colado, ficheiros e anexos do Zotero com o modelo de IA que escolher. Conserva a estrutura de DOCX e EPUB, e inclui um modo fac-símile para PDF que mantém o design, as imagens e a geometria da página enquanto substitui o texto visível.',
    'pt-BR': 'Nova ferramenta Nodus Translate: traduza texto colado, arquivos e anexos do Zotero com o modelo de IA que você escolher. Ela preserva a estrutura de DOCX e EPUB, e inclui um modo fac-símile para PDF que mantém o layout, as imagens e a geometria da página enquanto substitui o texto visível.',
  },
  {
    scope: 'general',
    es: 'Generación de imágenes local con FLUX.2 Klein: descarga opcional de un modelo bajo licencia Apache-2.0 que crea imágenes en tu propio equipo, sin API, sin coste por uso y sin enviar tus prompts a terceros.',
    en: 'Local image generation with FLUX.2 Klein: an optional, Apache-2.0-licensed model download that creates images right on your own machine, with no API, no per-use cost and no prompts sent to third parties.',
    fr: 'Génération d’images locale avec FLUX.2 Klein : un modèle téléchargeable en option, sous licence Apache 2.0, qui crée des images directement sur votre propre ordinateur, sans API, sans coût à l’usage et sans envoi de vos prompts à des tiers.',
    de: 'Lokale Bildgenerierung mit FLUX.2 Klein: ein optional herunterladbares, Apache-2.0-lizenziertes Modell, das Bilder direkt auf deinem eigenen Gerät erzeugt – ohne API, ohne Kosten pro Nutzung und ohne Weitergabe deiner Prompts an Dritte.',
    pt: 'Geração de imagens local com o FLUX.2 Klein: transferência opcional de um modelo com licença Apache-2.0 que cria imagens no seu próprio equipamento, sem API, sem custo por utilização e sem enviar os seus prompts a terceiros.',
    'pt-BR': 'Geração de imagens local com o FLUX.2 Klein: download opcional de um modelo com licença Apache-2.0 que cria imagens no seu próprio computador, sem API, sem custo por uso e sem enviar seus prompts a terceiros.',
  },
  {
    scope: 'general',
    es: 'Deep Research, Inmersión y el Taller de escritura exportan ahora informes en PDF con un diseño profesional: portada, tabla de contenidos navegable, métricas destacadas y secciones numeradas.',
    en: 'Deep Research, Immersion and the Writing Workshop now export reports as professionally designed PDFs, with a cover page, a navigable table of contents, highlighted metrics and numbered sections.',
    fr: 'Deep Research, Immersion et l’Atelier d’écriture exportent désormais des rapports en PDF au design professionnel : page de couverture, table des matières navigable, indicateurs mis en avant et sections numérotées.',
    de: 'Deep Research, Immersion und die Schreibwerkstatt exportieren Berichte jetzt als professionell gestaltete PDFs mit Deckblatt, navigierbarem Inhaltsverzeichnis, hervorgehobenen Kennzahlen und nummerierten Abschnitten.',
    pt: 'O Deep Research, a Imersão e a Oficina de escrita passam a exportar relatórios em PDF com um design profissional: capa, índice navegável, métricas em destaque e secções numeradas.',
    'pt-BR': 'O Deep Research, a Imersão e a Oficina de escrita agora exportam relatórios em PDF com um design profissional: capa, sumário navegável, métricas em destaque e seções numeradas.',
  },
  {
    scope: 'mcp',
    es: 'Nodus Server, experimental: comparte una copia filtrada y de solo lectura de una bóveda con un grupo de trabajo o clase, con acceso remoto desde ChatGPT o Claude mediante un túnel MCP protegido por OAuth. Se despliega en tu propio Docker, exige una contraseña de administración segura y solo recibe tráfico HTTPS saliente de Nodus Desktop.',
    en: 'Experimental Nodus Server: share a filtered, read-only copy of a vault with a class or working group, with remote access from ChatGPT or Claude through an OAuth-protected MCP tunnel. It runs on your own Docker host, requires a secure admin password, and only accepts outbound HTTPS traffic from Nodus Desktop.',
    fr: 'Nodus Server, expérimental : partagez une copie filtrée et en lecture seule d’un espace avec un groupe de travail ou une classe, avec un accès distant depuis ChatGPT ou Claude via un tunnel MCP protégé par OAuth. Il se déploie sur votre propre Docker, exige un mot de passe d’administration sécurisé et ne reçoit que du trafic HTTPS sortant de Nodus Desktop.',
    de: 'Experimenteller Nodus Server: Teile eine gefilterte, schreibgeschützte Kopie eines Arbeitsbereichs mit einer Klasse oder Arbeitsgruppe, mit Fernzugriff von ChatGPT oder Claude über einen OAuth-geschützten MCP-Tunnel. Er läuft auf deinem eigenen Docker-Host, verlangt ein sicheres Administratorpasswort und akzeptiert nur ausgehenden HTTPS-Verkehr von Nodus Desktop.',
    pt: 'Nodus Server, experimental: partilhe uma cópia filtrada e só de leitura de um espaço com uma turma ou grupo de trabalho, com acesso remoto a partir do ChatGPT ou do Claude através de um túnel MCP protegido por OAuth. É implementado no seu próprio Docker, exige uma palavra-passe de administração segura e só recebe tráfego HTTPS de saída do Nodus Desktop.',
    'pt-BR': 'Nodus Server, experimental: compartilhe uma cópia filtrada e somente leitura de um espaço com uma turma ou grupo de trabalho, com acesso remoto a partir do ChatGPT ou do Claude por um túnel MCP protegido por OAuth. Ele roda no seu próprio Docker, exige uma senha de administração segura e só recebe tráfego HTTPS de saída do Nodus Desktop.',
  },
  {
    scope: 'plugin',
    es: 'El asistente de Nodus para Zotero se vuelve mucho más completo: aparece también en el lector emergente, responde sobre el documento abierto o varios elementos seleccionados, puede resaltar automáticamente los pasajes más relevantes y guardar la conversación como una nota de Zotero.',
    en: 'The Nodus for Zotero assistant becomes far more capable: it also appears in the reader popup, answers about the open document or several selected items, can automatically highlight the most relevant passages, and saves the conversation as a Zotero note.',
    fr: 'L’assistant Nodus pour Zotero devient beaucoup plus complet : il apparaît aussi dans la fenêtre du lecteur, répond sur le document ouvert ou plusieurs éléments sélectionnés, peut surligner automatiquement les passages les plus pertinents et enregistrer la conversation comme note Zotero.',
    de: 'Der Nodus-Assistent für Zotero wird deutlich leistungsfähiger: Er erscheint jetzt auch im Reader-Popup, beantwortet Fragen zum geöffneten Dokument oder mehreren ausgewählten Elementen, kann die relevantesten Passagen automatisch markieren und die Unterhaltung als Zotero-Notiz speichern.',
    pt: 'O assistente do Nodus para o Zotero torna-se muito mais completo: aparece também na janela do leitor, responde sobre o documento aberto ou vários itens selecionados, pode destacar automaticamente as passagens mais relevantes e guardar a conversa como nota do Zotero.',
    'pt-BR': 'O assistente do Nodus para o Zotero fica muito mais completo: ele também aparece no pop-up do leitor, responde sobre o documento aberto ou vários itens selecionados, pode destacar automaticamente as passagens mais relevantes e salvar a conversa como uma nota do Zotero.',
  },
  {
    scope: 'plugin',
    es: 'Nuevo modo agente en Nodus para Zotero: propone crear notas, resaltados, etiquetas o cambios de campos a partir de la conversación, y pide tu confirmación antes de aplicar cada acción.',
    en: 'New agent mode in Nodus for Zotero: it proposes creating notes, highlights, tags or field changes from the conversation, and asks for your confirmation before applying each action.',
    fr: 'Nouveau mode agent dans Nodus pour Zotero : il propose de créer des notes, des surlignages, des étiquettes ou des modifications de champs à partir de la conversation, et demande votre confirmation avant d’appliquer chaque action.',
    de: 'Neuer Agentenmodus in Nodus für Zotero: Er schlägt aus der Unterhaltung heraus Notizen, Markierungen, Schlagwörter oder Feldänderungen vor und fragt vor jeder Aktion um deine Bestätigung.',
    pt: 'Novo modo agente no Nodus para o Zotero: propõe criar notas, destaques, etiquetas ou alterações de campos a partir da conversa, e pede a sua confirmação antes de aplicar cada ação.',
    'pt-BR': 'Novo modo agente no Nodus para o Zotero: ele propõe criar notas, destaques, etiquetas ou alterações de campos a partir da conversa, e pede sua confirmação antes de aplicar cada ação.',
  },
  {
    scope: 'plugin',
    es: 'El complemento Nodus para Zotero se instala y se actualiza directamente desde Ajustes, y también se publica como archivo .xpi en cada versión de Nodus para quien prefiera instalarlo manualmente en Zotero.',
    en: 'The Nodus for Zotero add-on can now be installed and updated straight from Settings, and is also published as an .xpi file with every Nodus release for anyone who prefers to install it manually in Zotero.',
    fr: 'L’extension Nodus pour Zotero s’installe et se met à jour directement depuis les Paramètres, et est aussi publiée sous forme de fichier .xpi à chaque version de Nodus pour celles et ceux qui préfèrent l’installer manuellement dans Zotero.',
    de: 'Das Add-on Nodus für Zotero lässt sich jetzt direkt aus den Einstellungen installieren und aktualisieren und wird außerdem bei jeder Nodus-Version als .xpi-Datei veröffentlicht, für alle, die es lieber manuell in Zotero installieren möchten.',
    pt: 'O complemento Nodus para o Zotero instala-se e atualiza-se diretamente a partir das Definições, e é também publicado como ficheiro .xpi em cada versão do Nodus para quem preferir instalá-lo manualmente no Zotero.',
    'pt-BR': 'O complemento Nodus para o Zotero agora se instala e se atualiza diretamente pelas Configurações, e também é publicado como arquivo .xpi em cada versão do Nodus para quem preferir instalá-lo manualmente no Zotero.',
  },
  {
    scope: 'general',
    es: 'Nueva guía de bienvenida sobre flujos conectados: explica con claridad cuándo usar el servidor MCP local, cuándo el nuevo Nodus Server, cómo trabajar dentro de Zotero y qué ofrece el Toolkit completo.',
    en: 'New connected-workflows onboarding guide: it clearly explains when to use the local MCP server, when to use the new Nodus Server, how to work inside Zotero, and what the complete Toolkit offers.',
    fr: 'Nouveau guide d’accueil sur les flux connectés : il explique clairement quand utiliser le serveur MCP local, quand utiliser le nouveau Nodus Server, comment travailler dans Zotero et ce que propose le Toolkit complet.',
    de: 'Neuer Einführungsguide zu verbundenen Arbeitsabläufen: Er erklärt klar, wann der lokale MCP-Server und wann der neue Nodus Server genutzt werden sollte, wie man in Zotero arbeitet und was das vollständige Toolkit bietet.',
    pt: 'Novo guia de boas-vindas sobre fluxos ligados: explica com clareza quando usar o servidor MCP local, quando usar o novo Nodus Server, como trabalhar dentro do Zotero e o que oferece o Toolkit completo.',
    'pt-BR': 'Novo guia de boas-vindas sobre fluxos conectados: explica com clareza quando usar o servidor MCP local, quando usar o novo Nodus Server, como trabalhar dentro do Zotero e o que o Toolkit completo oferece.',
  },
];

const RELEASE_2_6_2_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'plugin',
    es: 'El complemento de Zotero divide la indexación en un índice rápido —extrae y fragmenta el texto casi al instante— y uno completo que calcula embeddings en segundo plano sin bloquear el asistente. El OCR es ahora bajo demanda en lugar de ejecutarse siempre, y al leer un único documento se usa todo el texto en contexto directamente, igualando la velocidad de otras herramientas de lectura.',
    en: 'The Zotero add-on now splits indexing into a Quick index —extracts and chunks text almost instantly— and a Full index that computes embeddings in the background without blocking the assistant. OCR is now on-demand instead of always running, and when reading a single document, full text is used in context directly, matching the speed of other reading tools.',
    fr: "L'extension Zotero divise désormais l'indexation en un index rapide —extrait et segmente le texte presque instantanément— et un index complet qui calcule les embeddings en arrière-plan sans bloquer l'assistant. L'OCR est désormais à la demande au lieu de s'exécuter en permanence, et lors de la lecture d'un seul document, tout le texte est utilisé en contexte directement, égalant la vitesse des autres outils de lecture.",
    de: 'Das Zotero-Add-on teilt die Indexierung jetzt in einen schnellen Index —extrahiert und segmentiert Text fast sofort— und einen vollständigen Index, der Embeddings im Hintergrund berechnet, ohne den Assistenten zu blockieren. OCR läuft jetzt nur bei Bedarf statt immer, und beim Lesen eines einzelnen Dokuments wird der gesamte Text direkt im Kontext verwendet — genauso schnell wie andere Lesewerkzeuge.',
    pt: 'O complemento do Zotero divide agora a indexação num índice rápido —extrai e fragmenta o texto quase de imediato— e num índice completo que calcula embeddings em segundo plano sem bloquear o assistente. O OCR é agora a pedido em vez de ser executado sempre, e ao ler um único documento todo o texto é usado em contexto diretamente, igualando a velocidade de outras ferramentas de leitura.',
    'pt-BR': 'O complemento do Zotero agora divide a indexação em um índice rápido —extrai e fragmenta o texto quase na hora— e um índice completo que calcula embeddings em segundo plano sem bloquear o assistente. O OCR agora é sob demanda em vez de sempre ativo, e ao ler um único documento todo o texto é usado em contexto diretamente, igualando a velocidade de outras ferramentas de leitura.',
  },
  {
    scope: 'plugin',
    es: 'La búsqueda semántica es más eficiente: se evitan llamadas extra al modelo cuando hay pocos resultados, la reparación de citas es configurable y las rondas de búsqueda agente se pueden ajustar (1 por defecto). El OCR se procesa en paralelo y los embeddings locales usan WebGPU cuando está disponible, con respaldo en Wasm.',
    en: 'Semantic search is more efficient: extra model calls are skipped when there are few results, citation repair is configurable, and agentic search rounds are adjustable (1 by default). OCR processes in parallel and local embeddings use WebGPU when available, falling back to Wasm.',
    fr: "La recherche sémantique est plus efficace : les appels supplémentaires au modèle sont évités quand il y a peu de résultats, la réparation des citations est configurable et les tours de recherche agent sont réglables (1 par défaut). L'OCR est traité en parallèle et les embeddings locaux utilisent WebGPU quand il est disponible, avec repli sur Wasm.",
    de: 'Die semantische Suche ist effizienter: Zusätzliche Modellaufrufe entfallen bei wenigen Ergebnissen, die Zitatreparatur ist konfigurierbar und die agentenbasierten Suchrunden sind einstellbar (standardmäßig 1). OCR wird parallel verarbeitet und lokale Embeddings nutzen WebGPU, wenn verfügbar, mit Wasm als Fallback.',
    pt: 'A pesquisa semântica é mais eficiente: evitam-se chamadas extra ao modelo quando há poucos resultados, a reparação de citações é configurável e as rondas de pesquisa agente são ajustáveis (1 por defeito). O OCR é processado em paralelo e os embeddings locais usam WebGPU quando disponível, com recurso a Wasm como alternativa.',
    'pt-BR': 'A busca semântica é mais eficiente: chamadas extras ao modelo são evitadas quando há poucos resultados, a reparação de citações é configurável e as rodadas de busca agente são ajustáveis (1 por padrão). O OCR processa em paralelo e os embeddings locais usam WebGPU quando disponível, com fallback para Wasm.',
  },
];

const RELEASE_2_6_3_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'plugin',
    es: 'El complemento Nodus para Zotero se mantiene actualizado por sí solo: se registra en el actualizador de complementos del propio Zotero e instala cada nueva versión automáticamente desde la última publicación de GitHub, verificada por Zotero y aplicada al reiniciar. Viene activado y puedes desactivarlo en Ajustes, que primero te pide confirmación.',
    en: 'The Nodus for Zotero add-on now keeps itself up to date: it registers with Zotero’s own add-on updater and installs each new release automatically from the latest GitHub Release, verified by Zotero and applied on restart. It is on by default and can be turned off in Settings, which asks for confirmation first.',
    fr: 'L’extension Nodus pour Zotero se maintient à jour toute seule : elle s’enregistre auprès du gestionnaire de mises à jour de Zotero et installe chaque nouvelle version automatiquement depuis la dernière publication GitHub, vérifiée par Zotero et appliquée au redémarrage. Activée par défaut, elle peut être désactivée dans les Paramètres, qui demandent d’abord confirmation.',
    de: 'Das Add-on Nodus für Zotero hält sich jetzt selbst aktuell: Es registriert sich beim Add-on-Updater von Zotero und installiert jede neue Version automatisch aus dem neuesten GitHub-Release, von Zotero geprüft und beim Neustart angewendet. Standardmäßig aktiviert, lässt es sich in den Einstellungen abschalten, die zuvor um Bestätigung bitten.',
    pt: 'O complemento Nodus para o Zotero mantém-se atualizado sozinho: regista-se no atualizador de complementos do próprio Zotero e instala cada nova versão automaticamente a partir da última publicação do GitHub, verificada pelo Zotero e aplicada ao reiniciar. Vem ativado e pode ser desativado nas Definições, que pedem confirmação primeiro.',
    'pt-BR': 'O complemento Nodus para o Zotero se mantém atualizado sozinho: ele se registra no atualizador de complementos do próprio Zotero e instala cada nova versão automaticamente a partir da última publicação do GitHub, verificada pelo Zotero e aplicada ao reiniciar. Vem ativado e pode ser desativado nas Configurações, que pedem confirmação primeiro.',
  },
  {
    scope: 'plugin',
    es: 'El asistente de Nodus para Zotero responde con precisión sobre PDF largos: un mapa del documento le aporta datos reales de páginas —total, página actual, primera y última— para no inventarlos, y las preguntas por «página actual», «última página» o «página N» recuperan esas páginas exactas. Además, la primera respuesta ya no espera a indexar todo el documento: se calculan solo los embeddings imprescindibles y el resto continúa en segundo plano.',
    en: 'The Nodus for Zotero assistant answers accurately about long PDFs: a document map gives it real page facts —total, current, first and last— so it no longer guesses them, and questions about the “current page”, “last page” or “page N” fetch those exact pages. The first answer also no longer waits for the whole document to be indexed: only the essential embeddings are computed and the rest continues in the background.',
    fr: 'L’assistant Nodus pour Zotero répond avec précision sur les PDF longs : une carte du document lui fournit des données de pages réelles —total, page actuelle, première et dernière— pour ne pas les inventer, et les questions sur la « page actuelle », la « dernière page » ou la « page N » récupèrent ces pages exactes. La première réponse n’attend plus l’indexation de tout le document : seuls les embeddings indispensables sont calculés et le reste se poursuit en arrière-plan.',
    de: 'Der Nodus-Assistent für Zotero beantwortet Fragen zu langen PDFs präzise: Eine Dokumentkarte liefert ihm echte Seitendaten – Gesamtzahl, aktuelle, erste und letzte Seite –, sodass er sie nicht mehr errät, und Fragen nach „aktueller Seite“, „letzter Seite“ oder „Seite N“ rufen genau diese Seiten ab. Die erste Antwort wartet außerdem nicht mehr auf die Indexierung des gesamten Dokuments: Nur die nötigen Embeddings werden berechnet, der Rest läuft im Hintergrund weiter.',
    pt: 'O assistente do Nodus para o Zotero responde com precisão sobre PDF longos: um mapa do documento dá-lhe dados reais de páginas —total, página atual, primeira e última— para não os inventar, e as perguntas por «página atual», «última página» ou «página N» recuperam essas páginas exatas. A primeira resposta já não espera pela indexação de todo o documento: calculam-se apenas os embeddings indispensáveis e o resto continua em segundo plano.',
    'pt-BR': 'O assistente do Nodus para o Zotero responde com precisão sobre PDFs longos: um mapa do documento dá a ele dados reais de páginas —total, página atual, primeira e última— para não inventá-los, e as perguntas por “página atual”, “última página” ou “página N” recuperam essas páginas exatas. A primeira resposta também não espera mais pela indexação de todo o documento: apenas os embeddings essenciais são calculados e o restante continua em segundo plano.',
  },
  {
    scope: 'mcp',
    es: 'Nodus Server mantiene publicadas en segundo plano todas las bóvedas conectadas, no solo la que tengas abierta: al cambiar de bóveda las demás siguen sincronizándose y sirviéndose, sin quedarse obsoletas. Ajustes muestra ahora todas tus conexiones con su estado y puedes sincronizar o desconectar cada una por separado.',
    en: 'Nodus Server now keeps every connected vault published in the background, not just the one you have open: switching vaults no longer leaves the others stale, since they keep syncing and serving. Settings now lists all your connections with their status, and you can sync or disconnect each one individually.',
    fr: 'Nodus Server garde désormais publiés en arrière-plan tous les espaces connectés, pas seulement celui qui est ouvert : changer d’espace ne laisse plus les autres obsolètes, car ils continuent à se synchroniser et à être servis. Les Paramètres affichent maintenant toutes vos connexions avec leur statut, et vous pouvez synchroniser ou déconnecter chacune séparément.',
    de: 'Nodus Server hält jetzt alle verbundenen Arbeitsbereiche im Hintergrund veröffentlicht, nicht nur den geöffneten: Ein Wechsel des Arbeitsbereichs lässt die anderen nicht mehr veralten, da sie weiter synchronisiert und bereitgestellt werden. Die Einstellungen listen nun alle Verbindungen mit ihrem Status auf, und du kannst jede einzeln synchronisieren oder trennen.',
    pt: 'O Nodus Server mantém publicados em segundo plano todos os espaços ligados, não apenas o que tem aberto: ao mudar de espaço os restantes continuam a sincronizar e a ser servidos, sem ficarem desatualizados. As Definições mostram agora todas as suas ligações com o respetivo estado e pode sincronizar ou desligar cada uma separadamente.',
    'pt-BR': 'O Nodus Server agora mantém publicados em segundo plano todos os espaços conectados, não só o que você tem aberto: ao trocar de espaço os demais continuam sincronizando e sendo servidos, sem ficarem desatualizados. As Configurações agora mostram todas as suas conexões com o respectivo status, e você pode sincronizar ou desconectar cada uma separadamente.',
  },
  {
    scope: 'general',
    es: 'La generación de audio es más fiable: la narración continúa aunque salgas de la vista y recupera su progreso al volver, el resumen de un informe de Deep Research ya no se lee dos veces y los fragmentos largos dejan de cortarse a mitad de palabra. La transcripción con Whisper local también termina en segundo plano en lugar de cancelarse al cambiar de pantalla.',
    en: 'Audio generation is more reliable: narration keeps going even if you leave the view and restores its progress when you return, a Deep Research report summary is no longer read twice, and long segments no longer cut off mid-word. Local Whisper transcription now also finishes in the background instead of being cancelled when you switch screens.',
    fr: 'La génération audio est plus fiable : la narration se poursuit même si vous quittez la vue et retrouve sa progression au retour, le résumé d’un rapport Deep Research n’est plus lu deux fois et les longs segments ne se coupent plus au milieu d’un mot. La transcription avec Whisper local se termine désormais en arrière-plan au lieu d’être annulée lorsque vous changez d’écran.',
    de: 'Die Audioerzeugung ist zuverlässiger: Die Erzählung läuft weiter, auch wenn du die Ansicht verlässt, und stellt beim Zurückkehren ihren Fortschritt wieder her; die Zusammenfassung eines Deep-Research-Berichts wird nicht mehr doppelt vorgelesen und lange Abschnitte brechen nicht mehr mitten im Wort ab. Auch die lokale Whisper-Transkription wird jetzt im Hintergrund fertiggestellt, statt beim Bildschirmwechsel abgebrochen zu werden.',
    pt: 'A geração de áudio é mais fiável: a narração continua mesmo que saia da vista e recupera o seu progresso ao voltar, o resumo de um relatório de Deep Research já não é lido duas vezes e os fragmentos longos deixam de ser cortados a meio de uma palavra. A transcrição com Whisper local também termina em segundo plano em vez de ser cancelada ao mudar de ecrã.',
    'pt-BR': 'A geração de áudio é mais confiável: a narração continua mesmo que você saia da tela e recupera seu progresso ao voltar, o resumo de um relatório de Deep Research não é mais lido duas vezes e os trechos longos deixam de ser cortados no meio de uma palavra. A transcrição com Whisper local também termina em segundo plano em vez de ser cancelada ao trocar de tela.',
  },
  {
    scope: 'general',
    es: 'Los informes PDF de Deep Research estrenan un diseño más cuidado: portada limpia con la marca de Nodus, resumen ejecutivo centrado, numeración automática de secciones y una matriz de trazabilidad compacta en forma de tabla.',
    en: 'Deep Research PDF reports get a more polished design: a clean cover page with the Nodus brand mark, a centred executive summary, automatic section numbering and a compact, table-based traceability matrix.',
    fr: 'Les rapports PDF de Deep Research adoptent un design plus soigné : page de couverture épurée avec la marque Nodus, résumé exécutif centré, numérotation automatique des sections et une matrice de traçabilité compacte sous forme de tableau.',
    de: 'Die PDF-Berichte von Deep Research erhalten ein feineres Design: eine aufgeräumte Titelseite mit der Nodus-Bildmarke, eine zentrierte Zusammenfassung, automatische Abschnittsnummerierung und eine kompakte, tabellenbasierte Nachverfolgbarkeitsmatrix.',
    pt: 'Os relatórios PDF do Deep Research estreiam um design mais cuidado: capa limpa com a marca do Nodus, resumo executivo centrado, numeração automática de secções e uma matriz de rastreabilidade compacta em forma de tabela.',
    'pt-BR': 'Os relatórios PDF do Deep Research estreiam um design mais caprichado: capa limpa com a marca do Nodus, resumo executivo centralizado, numeração automática de seções e uma matriz de rastreabilidade compacta em forma de tabela.',
  },
];

// v3.0.0 is the first release of this major, and it absorbs the highlights that were
// briefly authored as "2.8.0": that version was never published, so shipping it as a
// separate entry would invent a release nobody can be updating from. The four vaults
// that arrived in this cycle — Prosopography, Primary Sources, Testimony and
// Worldbuilding — are why the major moves.
//
// Each of those four gets ONE highlight: the vault itself. They had seven, two, one
// and six, and the extra ones described refinements *within* a vault nobody reading
// this modal has opened yet — an audience that cannot tell an improvement from the
// thing being improved. What a new vault needs here is an invitation, not a
// changelog. The detail belongs in the docs, where someone goes after deciding to
// try it.
//
// Order follows VAULT_TYPES in shared/vaultTypes.ts, so the modal lists vaults the
// way the rest of the app does: the four new ones first, then the ones that gained
// something, then the cross-vault surfaces, then what applies everywhere.
const RELEASE_3_0_0_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'prosopography',
    es: 'Nueva bóveda de Prosopografía, para estudiar poblaciones históricas persona a persona. Captura y crítica de fuentes, resolución de identidades, factoides con su evidencia, poblaciones, cohortes y cuestionarios, búsqueda, análisis de redes por capas e intercambio de datos: la evidencia va pegada al dato en lugar de quedar detrás de él.',
    en: 'A new Prosopography vault, for studying historical populations person by person. Source capture and criticism, identity resolution, factoids with their evidence, populations, cohorts and questionnaires, search, layered network analysis and data interchange: the evidence is attached to the datum rather than sitting behind it.',
    fr: 'Nouveau coffre Prosopographie, pour étudier des populations historiques personne par personne. Capture et critique des sources, résolution d’identités, factoïdes avec leur preuve, populations, cohortes et questionnaires, recherche, analyse de réseaux par couches et échange de données : la preuve est attachée à la donnée au lieu de rester derrière elle.',
    de: 'Ein neuer Prosopografie-Tresor, um historische Populationen Person für Person zu untersuchen. Quellenerfassung und -kritik, Identitätsauflösung, Faktoide mit ihrer Evidenz, Populationen, Kohorten und Fragebögen, Suche, geschichtete Netzwerkanalyse und Datenaustausch: Die Evidenz hängt am Datum, statt dahinter zu liegen.',
    pt: 'Novo cofre de Prosopografia, para estudar populações históricas pessoa a pessoa. Captura e crítica de fontes, resolução de identidades, factoides com a sua evidência, populações, coortes e questionários, pesquisa, análise de redes por camadas e intercâmbio de dados: a evidência vai colada ao dado em vez de ficar atrás dele.',
    'pt-BR': 'Novo cofre de Prosopografia, para estudar populações históricas pessoa a pessoa. Captura e crítica de fontes, resolução de identidades, factoides com sua evidência, populações, coortes e questionários, busca, análise de redes por camadas e intercâmbio de dados: a evidência vai colada ao dado em vez de ficar atrás dele.',
  },
  {
    scope: 'primary_sources',
    es: 'Nueva bóveda de Fuentes primarias, para trabajar con archivos históricos. Repositorios y jerarquía archivística, sesiones de captura, colecciones de trabajo, plantillas, ficheros con su imagen, texto revisado, extractos y enlaces de evidencia, más mapa, cronología, personas, relaciones, notas e investigación. Incluye un corpus documental de demostración reversible, con documentos sintéticos, imágenes generadas y lugares reales de gazetteer.',
    en: 'A new Primary Sources vault, for working with historical archives. Repositories and archival hierarchy, capture sessions, working collections, templates, files with their images, reviewed text, excerpts and evidence links, plus a map, a timeline, people, relations, notes and research. It ships with a reversible documentary demo corpus of synthetic documents, generated images and real gazetteer-backed places.',
    fr: 'Nouveau coffre Sources primaires, pour travailler avec des archives historiques. Dépôts et hiérarchie archivistique, sessions de capture, collections de travail, modèles, fichiers avec leur image, texte relu, extraits et liens de preuve, plus une carte, une chronologie, des personnes, des relations, des notes et de la recherche. Il est livré avec un corpus documentaire de démonstration réversible : documents synthétiques, images générées et lieux réels issus d’un gazetteer.',
    de: 'Ein neuer Primärquellen-Tresor für die Arbeit mit historischen Archiven. Repositorien und archivische Hierarchie, Erfassungssitzungen, Arbeitssammlungen, Vorlagen, Dateien mit ihrem Bild, geprüfter Text, Auszüge und Evidenzverknüpfungen, dazu Karte, Zeitleiste, Personen, Beziehungen, Notizen und Recherche. Enthalten ist ein umkehrbares dokumentarisches Demo-Korpus mit synthetischen Dokumenten, erzeugten Bildern und echten, per Gazetteer belegten Orten.',
    pt: 'Novo cofre de Fontes primárias, para trabalhar com arquivos históricos. Repositórios e hierarquia arquivística, sessões de captura, coleções de trabalho, modelos, ficheiros com a sua imagem, texto revisto, excertos e ligações de evidência, mais mapa, cronologia, pessoas, relações, notas e investigação. Inclui um corpus documental de demonstração reversível, com documentos sintéticos, imagens geradas e lugares reais de gazetteer.',
    'pt-BR': 'Novo cofre de Fontes primárias, para trabalhar com arquivos históricos. Repositórios e hierarquia arquivística, sessões de captura, coleções de trabalho, modelos, arquivos com sua imagem, texto revisado, trechos e links de evidência, mais mapa, cronologia, pessoas, relações, notas e pesquisa. Inclui um corpus documental de demonstração reversível, com documentos sintéticos, imagens geradas e lugares reais de gazetteer.',
  },
  {
    scope: 'testimonios',
    es: 'Nueva bóveda de Testimonios, para historia oral y periodismo. Su unidad no es la grabación ni la transcripción: es la entrevista completa, con su preparación, sus participantes, sus sesiones, sus archivos originales, sus transcripciones y el acuerdo con el que se hizo. El menú se queda en ocho entradas —Inicio, Buscar, Entrevistas, Participantes, Contrastes, Notas, Toolkit y Ajustes— porque todo lo demás sucede dentro de cada entrevista.',
    en: 'A new Testimony vault, for oral history and journalism. Its unit is neither the recording nor the transcript: it is the whole interview, with its preparation, its participants, its sessions, its master files, its transcripts and the agreement it was made under. The menu stays at eight entries — Home, Search, Interviews, Participants, Comparisons, Notes, Toolkit and Settings — because everything else happens inside each interview.',
    fr: 'Nouveau coffre Témoignages, pour l’histoire orale et le journalisme. Son unité n’est ni l’enregistrement ni la transcription : c’est l’entretien complet, avec sa préparation, ses participants, ses séances, ses fichiers originaux, ses transcriptions et l’accord sous lequel il a été mené. Le menu se limite à huit entrées — Accueil, Rechercher, Entretiens, Participants, Comparaisons, Notes, Toolkit et Réglages — parce que tout le reste se passe à l’intérieur de chaque entretien.',
    de: 'Ein neuer Zeitzeugnis-Tresor für Oral History und Journalismus. Seine Einheit ist weder die Aufnahme noch die Transkription: Es ist das ganze Interview, mit Vorbereitung, Beteiligten, Sitzungen, Originaldateien, Transkriptionen und der Vereinbarung, unter der es entstand. Das Menü bleibt bei acht Einträgen – Start, Suchen, Interviews, Beteiligte, Vergleiche, Notizen, Toolkit und Einstellungen –, weil alles Übrige innerhalb des jeweiligen Interviews geschieht.',
    pt: 'Novo cofre de Testemunhos, para história oral e jornalismo. A sua unidade não é a gravação nem a transcrição: é a entrevista completa, com a sua preparação, os seus participantes, as suas sessões, os seus ficheiros originais, as suas transcrições e o acordo com que foi feita. O menu fica em oito entradas — Início, Procurar, Entrevistas, Participantes, Contrastes, Notas, Toolkit e Definições — porque todo o resto acontece dentro de cada entrevista.',
    'pt-BR': 'Novo cofre de Depoimentos, para história oral e jornalismo. Sua unidade não é a gravação nem a transcrição: é a entrevista completa, com sua preparação, seus participantes, suas sessões, seus arquivos originais, suas transcrições e o acordo com que foi feita. O menu fica em oito entradas — Início, Buscar, Entrevistas, Participantes, Contrastes, Notas, Toolkit e Configurações — porque todo o resto acontece dentro de cada entrevista.',
  },
  {
    scope: 'worldbuilding',
    es: 'Nueva bóveda de Worldbuilding, para inventar mundos y escribir en ellos. Personajes con su ficha completa, lugares en árbol con 37 tipos, facciones y culturas, escenas con doble orden —el día del mundo y el orden del relato—, secretos que registran quién los sabe y desde cuándo, y un calendario propio con sus eras y sus meses. Un personaje es una persona con una capa de ficción encima, así que hereda parentesco, hechos vitales, lugares y retrato sin una segunda ontología.',
    en: 'A new Worldbuilding vault, for inventing worlds and writing in them. Characters with a full sheet, places as a tree of 37 kinds, factions and cultures, scenes with two independent orderings — the world day and the order of the telling —, secrets that record who knows them and since when, and a calendar of your own with its eras and months. A character is a person with a fiction layer on top, so it inherits kinship, life events, places and portrait without a second ontology.',
    fr: 'Nouveau coffre Worldbuilding, pour inventer des mondes et y écrire. Des personnages avec leur fiche complète, des lieux en arbre avec 37 types, des factions et des cultures, des scènes à double ordre —le jour du monde et l’ordre du récit—, des secrets qui enregistrent qui les connaît et depuis quand, et un calendrier propre avec ses ères et ses mois. Un personnage est une personne avec une couche de fiction par-dessus : il hérite donc de la parenté, des événements de vie, des lieux et du portrait sans seconde ontologie.',
    de: 'Ein neuer Worldbuilding-Tresor, um Welten zu erfinden und in ihnen zu schreiben. Figuren mit vollständigem Steckbrief, Orte als Baum mit 37 Arten, Fraktionen und Kulturen, Szenen mit doppelter Ordnung – dem Welttag und der Reihenfolge des Erzählens –, Geheimnisse, die festhalten, wer sie kennt und seit wann, und ein eigener Kalender mit Ären und Monaten. Eine Figur ist eine Person mit einer Fiktionsschicht darüber und erbt daher Verwandtschaft, Lebensereignisse, Orte und Porträt ohne zweite Ontologie.',
    pt: 'Novo cofre de Worldbuilding, para inventar mundos e escrever neles. Personagens com a sua ficha completa, lugares em árvore com 37 tipos, fações e culturas, cenas com ordem dupla —o dia do mundo e a ordem da narração—, segredos que registam quem os sabe e desde quando, e um calendário próprio com as suas eras e meses. Uma personagem é uma pessoa com uma camada de ficção por cima, pelo que herda parentesco, factos de vida, lugares e retrato sem uma segunda ontologia.',
    'pt-BR': 'Novo cofre de Worldbuilding, para inventar mundos e escrever neles. Personagens com sua ficha completa, lugares em árvore com 37 tipos, facções e culturas, cenas com ordem dupla —o dia do mundo e a ordem da narrativa—, segredos que registram quem os sabe e desde quando, e um calendário próprio com suas eras e meses. Um personagem é uma pessoa com uma camada de ficção em cima, então herda parentesco, fatos da vida, lugares e retrato sem uma segunda ontologia.',
  },
  {
    scope: 'academic',
    es: 'La Biblioteca académica se ordena en torno a una sola pregunta: ¿puedo usar ya esta obra? Los cinco estados de la tubería se resumen en un Estado legible, doce columnas pasan a ocho, cada fila tiene un verbo principal, los filtros son ajustes rápidos que consultan el corpus entero, y un desglose por obra permite reintentar cada paso por separado. Los dos índices se llaman por lo que dan —búsqueda semántica y texto citable— y una obra analizada desde su resumen deja de contarse como «sin texto».',
    en: 'The academic Library is organised around one question: can I use this work yet? The five pipeline states collapse into one readable Status, twelve columns become eight, each row has one primary verb, the filters are one-click presets that query the whole corpus, and a per-work breakdown lets each step be retried on its own. The two indexes are named for what they give you — semantic search and citable text — and a work analysed from its abstract is no longer reported as having no text.',
    fr: 'La Bibliothèque académique s’organise autour d’une seule question : puis-je déjà utiliser cette œuvre ? Les cinq états du pipeline se résument en un Statut lisible, douze colonnes passent à huit, chaque ligne a un verbe principal, les filtres sont des préréglages qui interrogent tout le corpus, et un détail par œuvre permet de relancer chaque étape séparément. Les deux index sont nommés d’après ce qu’ils apportent —recherche sémantique et texte citable— et une œuvre analysée depuis son résumé n’est plus comptée comme «sans texte».',
    de: 'Die akademische Bibliothek ordnet sich um eine einzige Frage: Kann ich dieses Werk schon nutzen? Die fünf Pipeline-Zustände werden zu einem lesbaren Status, zwölf Spalten werden acht, jede Zeile hat ein Hauptverb, die Filter sind Voreinstellungen, die das gesamte Korpus abfragen, und eine Aufschlüsselung pro Werk lässt jeden Schritt einzeln wiederholen. Die zwei Indizes heißen nach dem, was sie liefern – semantische Suche und zitierfähiger Text – und ein aus dem Abstract analysiertes Werk gilt nicht mehr als „ohne Text“.',
    pt: 'A Biblioteca académica organiza-se em torno de uma única pergunta: já posso usar esta obra? Os cinco estados do pipeline resumem-se num Estado legível, doze colunas passam a oito, cada linha tem um verbo principal, os filtros são predefinições que consultam o corpus inteiro, e um detalhe por obra permite repetir cada passo em separado. Os dois índices chamam-se pelo que dão —pesquisa semântica e texto citável— e uma obra analisada a partir do seu resumo deixa de ser contada como «sem texto».',
    'pt-BR': 'A Biblioteca acadêmica se organiza em torno de uma única pergunta: já posso usar esta obra? Os cinco estados do pipeline se resumem em um Status legível, doze colunas passam a oito, cada linha tem um verbo principal, os filtros são presets que consultam o corpus inteiro, e um detalhamento por obra permite repetir cada etapa em separado. Os dois índices se chamam pelo que dão —busca semântica e texto citável— e uma obra analisada a partir do resumo deixa de ser contada como “sem texto”.',
  },
  {
    scope: 'genealogy',
    es: 'Genealogía gana control sobre lo que se ve: puedes ocultar y mostrar ramas del árbol, crear tipos de hecho propios que además son buscables, elegir o crear un lugar ya configurado al registrar un hecho, y el calendario dibuja por fin los eventos de varios días como una barra continua.',
    en: 'Genealogy gains control over what is shown: you can hide and show branches of the tree, create your own fact types that are also searchable, pick or create an already configured place while recording a fact, and the calendar finally draws multi-day events as one continuous bar.',
    fr: 'Généalogie gagne du contrôle sur ce qui s’affiche : vous pouvez masquer et afficher des branches de l’arbre, créer vos propres types de faits, également cherchables, choisir ou créer un lieu déjà configuré en enregistrant un fait, et le calendrier dessine enfin les événements de plusieurs jours comme une barre continue.',
    de: 'Genealogie gewinnt Kontrolle darüber, was zu sehen ist: Du kannst Zweige des Baums aus- und einblenden, eigene, ebenfalls durchsuchbare Faktentypen anlegen, beim Erfassen eines Faktums einen schon konfigurierten Ort wählen oder erstellen, und der Kalender zeichnet mehrtägige Ereignisse endlich als einen durchgehenden Balken.',
    pt: 'Genealogia ganha controlo sobre o que se vê: pode ocultar e mostrar ramos da árvore, criar tipos de facto próprios que além disso são pesquisáveis, escolher ou criar um lugar já configurado ao registar um facto, e o calendário desenha finalmente os eventos de vários dias como uma barra contínua.',
    'pt-BR': 'Genealogia ganha controle sobre o que se vê: você pode ocultar e mostrar ramos da árvore, criar tipos de fato próprios que também são buscáveis, escolher ou criar um lugar já configurado ao registrar um fato, e o calendário desenha finalmente os eventos de vários dias como uma barra contínua.',
  },
  {
    scope: 'docencia',
    es: 'Docencia estrena Analizar —Chat, Ideas y Grafo sobre el corpus del propio curso— y convierte «Unidades didácticas» en un Deep Research con audiencia: el mismo material produce un plan para quien da la clase o unos apuntes listos para el alumnado, y la audiencia atraviesa los tres prompts en los siete idiomas en lugar de añadirse al final.',
    en: 'Teaching gains an Analyse group — Chat, Ideas and Graph over the course’s own corpus — and turns “Unit design” into a Deep Research with an audience: the same material produces either a plan for whoever runs the lesson or notes ready to hand to students, and the audience runs through all three prompts in the seven languages instead of being appended at the end.',
    fr: 'Enseignement inaugure Analyser —Chat, Idées et Graphe sur le corpus du cours lui-même— et transforme «Unités didactiques» en un Deep Research avec audience : le même matériau produit soit un plan pour qui donne le cours, soit des notes prêtes à remettre aux élèves, et l’audience traverse les trois prompts dans les sept langues au lieu d’être ajoutée à la fin.',
    de: 'Lehre erhält die Gruppe Analysieren – Chat, Ideen und Graph über das eigene Kurskorpus – und macht aus „Unterrichtseinheiten“ ein Deep Research mit Zielgruppe: dasselbe Material ergibt entweder einen Plan für die unterrichtende Person oder Notizen, die den Lernenden direkt gegeben werden können, und die Zielgruppe läuft durch alle drei Prompts in den sieben Sprachen, statt am Ende angehängt zu werden.',
    pt: 'Docência estreia Analisar —Chat, Ideias e Grafo sobre o corpus do próprio curso— e converte «Unidades didáticas» num Deep Research com audiência: o mesmo material produz um plano para quem dá a aula ou apontamentos prontos para os alunos, e a audiência atravessa os três prompts nos sete idiomas em vez de se acrescentar ao final.',
    'pt-BR': 'Docência estreia Analisar —Chat, Ideias e Grafo sobre o corpus do próprio curso— e converte “Unidades didáticas” em um Deep Research com audiência: o mesmo material produz um plano para quem dá a aula ou anotações prontas para os alunos, e a audiência atravessa os três prompts nos sete idiomas em vez de ser acrescentada ao final.',
  },
  {
    scope: 'mcp',
    es: 'El servidor MCP y Nodus Server llegan a paridad con las bóvedas nuevas: Worldbuilding, Fuentes primarias, Prosopografía y Testimonios aparecen ya en los snapshots, exponen sus herramientas y pasan las mismas validaciones que el resto.',
    en: 'The MCP server and Nodus Server reach parity with the new vaults: Worldbuilding, Primary Sources, Prosopography and Testimony now appear in snapshots, expose their tools and pass the same validations as the rest.',
    fr: 'Le serveur MCP et Nodus Server atteignent la parité avec les nouveaux coffres : Worldbuilding, Sources primaires, Prosopographie et Témoignages apparaissent désormais dans les snapshots, exposent leurs outils et passent les mêmes validations que les autres.',
    de: 'Der MCP-Server und Nodus Server erreichen Gleichstand mit den neuen Tresoren: Worldbuilding, Primärquellen, Prosopografie und Zeitzeugnisse erscheinen nun in den Snapshots, stellen ihre Werkzeuge bereit und bestehen dieselben Prüfungen wie die übrigen.',
    pt: 'O servidor MCP e o Nodus Server chegam a paridade com os cofres novos: Worldbuilding, Fontes primárias, Prosopografia e Testemunhos aparecem já nos snapshots, expõem as suas ferramentas e passam as mesmas validações que os restantes.',
    'pt-BR': 'O servidor MCP e o Nodus Server chegam à paridade com os cofres novos: Worldbuilding, Fontes primárias, Prosopografia e Depoimentos já aparecem nos snapshots, expõem suas ferramentas e passam pelas mesmas validações que os demais.',
  },
  {
    scope: 'plugin',
    es: 'La barra de Nodus en Zotero se conecta sola. Antes leía su configuración una única vez al arrancar, así que si abrías Zotero antes que Nodus te quedabas en «sin conexión» hasta pulsar «Probar conexión» a mano; ahora reintenta con espera creciente, al volver a Zotero, al abrir sus ajustes y antes de enviar un mensaje, y sigue a un Nodus que se reinicia en otro puerto o rota su token. Complemento 3.0.0.',
    en: 'The Nodus sidebar in Zotero connects on its own. It used to read its configuration once at startup, so opening Zotero before Nodus left you on “not connected” until you pressed “Test connection” by hand; now it retries with a growing backoff, when Zotero regains focus, when you open its settings and before sending a message, and it follows a Nodus that restarts on another port or rotates its token. Add-on 3.0.0.',
    fr: 'La barre latérale de Nodus dans Zotero se connecte toute seule. Elle ne lisait sa configuration qu’une fois au démarrage : ouvrir Zotero avant Nodus vous laissait donc «non connecté» jusqu’à appuyer manuellement sur «Tester la connexion». Elle réessaie désormais avec une attente croissante, au retour dans Zotero, à l’ouverture de ses paramètres et avant l’envoi d’un message, et elle suit un Nodus qui redémarre sur un autre port ou change de jeton. Extension 3.0.0.',
    de: 'Die Nodus-Seitenleiste in Zotero verbindet sich von selbst. Sie las ihre Konfiguration nur einmal beim Start, also blieb man beim Öffnen von Zotero vor Nodus auf „nicht verbunden“, bis man „Verbindung testen“ von Hand drückte; jetzt versucht sie es erneut mit wachsender Wartezeit, bei Rückkehr zu Zotero, beim Öffnen ihrer Einstellungen und vor dem Senden einer Nachricht, und sie folgt einem Nodus, der auf einem anderen Port neu startet oder sein Token wechselt. Add-on 3.0.0.',
    pt: 'A barra do Nodus no Zotero liga-se sozinha. Antes lia a sua configuração uma única vez ao arrancar, pelo que abrir o Zotero antes do Nodus deixava-o em «sem ligação» até premir «Testar ligação» à mão; agora repete com espera crescente, ao voltar ao Zotero, ao abrir as suas definições e antes de enviar uma mensagem, e segue um Nodus que reinicia noutra porta ou roda o seu token. Complemento 3.0.0.',
    'pt-BR': 'A barra do Nodus no Zotero se conecta sozinha. Antes ela lia sua configuração uma única vez ao iniciar, então abrir o Zotero antes do Nodus deixava você em “sem conexão” até apertar “Testar conexão” na mão; agora ela tenta de novo com espera crescente, ao voltar ao Zotero, ao abrir suas configurações e antes de enviar uma mensagem, e acompanha um Nodus que reinicia em outra porta ou troca seu token. Complemento 3.0.0.',
  },
  {
    scope: 'plugin',
    es: 'El copiloto de Word arregla su navegación y se ve por fin en tu idioma. Y el asistente de configuración deja de prometer «la API local de Zotero 7»: lo que Nodus usa es la implementación local de la Web API v3 de Zotero, que es lo que ahora dice, en los siete idiomas.',
    en: 'The Word copilot fixes its navigation and is finally localized. And the setup assistant stops promising “the local Zotero 7 API”: what Nodus talks to is Zotero’s local implementation of Web API v3, which is what it now says, in all seven languages.',
    fr: 'Le copilote Word corrige sa navigation et s’affiche enfin dans votre langue. Et l’assistant de configuration cesse de promettre «l’API locale de Zotero 7» : ce que Nodus utilise est l’implémentation locale de la Web API v3 de Zotero, ce qu’il indique désormais, dans les sept langues.',
    de: 'Der Word-Copilot behebt seine Navigation und erscheint endlich in deiner Sprache. Und der Einrichtungsassistent verspricht nicht länger „die lokale Zotero-7-API“: Nodus spricht mit Zoteros lokaler Implementierung der Web API v3, und genau das sagt er nun, in allen sieben Sprachen.',
    pt: 'O copiloto do Word corrige a sua navegação e vê-se finalmente no seu idioma. E o assistente de configuração deixa de prometer «a API local do Zotero 7»: o que o Nodus usa é a implementação local da Web API v3 do Zotero, que é o que agora diz, nos sete idiomas.',
    'pt-BR': 'O copiloto do Word corrige sua navegação e aparece finalmente no seu idioma. E o assistente de configuração deixa de prometer “a API local do Zotero 7”: o que o Nodus usa é a implementação local da Web API v3 do Zotero, que é o que agora diz, nos sete idiomas.',
  },
  {
    scope: 'nodi',
    es: 'Nodi sabe por fin lo que Nodus tiene de verdad: describe el Toolkit ya implementado, las bóvedas disponibles, la hoja de ruta del servidor, la colaboración y las aplicaciones para iOS e iPadOS que están planificadas. En Worldbuilding, además, responde con la misma base y las mismas citas que el chat del mundo.',
    en: 'Nodi finally knows what Nodus actually has: it describes the Toolkit as implemented, the available vaults, the server roadmap, collaboration and the planned iOS and iPadOS apps. In Worldbuilding it also answers from the same grounding and the same citations as the world chat.',
    fr: 'Nodi sait enfin ce que Nodus contient réellement : il décrit le Toolkit déjà implémenté, les coffres disponibles, la feuille de route du serveur, la collaboration et les applications iOS et iPadOS prévues. Dans Worldbuilding, il répond en outre sur la même base et avec les mêmes citations que le chat du monde.',
    de: 'Nodi weiß endlich, was Nodus wirklich hat: Es beschreibt das umgesetzte Toolkit, die verfügbaren Tresore, den Fahrplan des Servers, die Zusammenarbeit und die geplanten Apps für iOS und iPadOS. In Worldbuilding antwortet es zudem auf derselben Grundlage und mit denselben Zitaten wie der Welt-Chat.',
    pt: 'O Nodi sabe finalmente o que o Nodus tem a sério: descreve o Toolkit já implementado, os cofres disponíveis, o roteiro do servidor, a colaboração e as aplicações para iOS e iPadOS que estão planeadas. Em Worldbuilding, além disso, responde com a mesma base e as mesmas citações que o chat do mundo.',
    'pt-BR': 'O Nodi sabe finalmente o que o Nodus tem de verdade: descreve o Toolkit já implementado, os cofres disponíveis, o roteiro do servidor, a colaboração e os aplicativos para iOS e iPadOS que estão planejados. Em Worldbuilding, além disso, responde com a mesma base e as mesmas citações que o chat do mundo.',
  },
  {
    scope: 'languages',
    es: 'El turco es el séptimo idioma completo de Nodus, incluida la terminología de parentesco, y todas las superficies del Toolkit quedan por fin traducidas.',
    en: 'Turkish is Nodus’s seventh complete language, kinship terminology included, and every Toolkit surface is finally translated.',
    fr: 'Le turc est la septième langue complète de Nodus, terminologie de parenté incluse, et toutes les surfaces du Toolkit sont enfin traduites.',
    de: 'Türkisch ist die siebte vollständige Sprache von Nodus, Verwandtschaftsterminologie inklusive, und alle Oberflächen des Toolkits sind endlich übersetzt.',
    pt: 'O turco é o sétimo idioma completo do Nodus, incluindo a terminologia de parentesco, e todas as superfícies do Toolkit ficam finalmente traduzidas.',
    'pt-BR': 'O turco é o sétimo idioma completo do Nodus, incluindo a terminologia de parentesco, e todas as superfícies do Toolkit ficam finalmente traduzidas.',
  },
  {
    scope: 'general',
    es: 'El primer arranque cambia: la guía enseña la introducción sola y te dice dónde está el resto, y después una pantalla te deja nombrar tu primera bóveda y elegir su modo en lugar de entregarte una académica llamada «Principal». Los diez tutoriales publicados viven en Ajustes, en cuatro estantes con pestañas y buscador, y el de cada bóveda aparece cuando la creas.',
    en: 'First run changes: the guide shows the introduction on its own and tells you where the rest are, and then a screen lets you name your first vault and pick its mode instead of handing you an academic one called “Main”. The ten published tutorials live in Settings, on four shelves with tabs and a search box, and each vault’s own tutorial appears when you create it.',
    fr: 'Le premier lancement change : le guide montre l’introduction seule et vous dit où sont les autres, puis un écran vous laisse nommer votre premier coffre et choisir son mode au lieu de vous remettre un coffre académique appelé «Principal». Les dix tutoriels publiés vivent dans les Paramètres, sur quatre étagères avec onglets et champ de recherche, et celui de chaque coffre apparaît quand vous le créez.',
    de: 'Der erste Start ändert sich: Die Anleitung zeigt die Einführung allein und sagt dir, wo die übrigen liegen, und danach lässt dich ein Bildschirm deinen ersten Tresor benennen und seinen Modus wählen, statt dir einen akademischen namens „Haupt“ zu übergeben. Die zehn veröffentlichten Tutorials leben in den Einstellungen, auf vier Regalen mit Tabs und Suchfeld, und das des jeweiligen Tresors erscheint, wenn du ihn erstellst.',
    pt: 'O primeiro arranque muda: o guia mostra a introdução sozinha e diz-lhe onde está o resto, e depois um ecrã deixa-o nomear o seu primeiro cofre e escolher o seu modo em vez de lhe entregar um académico chamado «Principal». Os dez tutoriais publicados vivem nas Definições, em quatro estantes com separadores e campo de pesquisa, e o de cada cofre aparece quando o cria.',
    'pt-BR': 'A primeira execução muda: o guia mostra a introdução sozinha e diz onde está o resto, e depois uma tela deixa você nomear seu primeiro cofre e escolher o modo dele em vez de entregar um acadêmico chamado “Principal”. Os dez tutoriais publicados vivem nas Configurações, em quatro estantes com abas e campo de busca, e o de cada cofre aparece quando você o cria.',
  },
  {
    scope: 'general',
    es: 'Configurar la IA ya se puede dejar para después, y una descarga de modelo que ya no quieres se cancela desde donde se lanzó.',
    en: 'Setting up AI can now be left for later, and a model download you no longer want can be cancelled from where it started.',
    fr: 'La configuration de l’IA peut désormais être remise à plus tard, et un téléchargement de modèle dont vous ne voulez plus s’annule là où il a été lancé.',
    de: 'Die KI-Einrichtung lässt sich jetzt auf später verschieben, und ein Modell-Download, den du nicht mehr willst, wird dort abgebrochen, wo er gestartet wurde.',
    pt: 'Configurar a IA já se pode deixar para depois, e uma transferência de modelo que já não quer cancela-se de onde foi lançada.',
    'pt-BR': 'Configurar a IA já pode ficar para depois, e um download de modelo que você não quer mais é cancelado de onde foi iniciado.',
  },
  {
    scope: 'general',
    es: 'Sugerir o reportar incluye ahora una encuesta opcional de 0 a 10 —cobertura, usabilidad, rendimiento, estabilidad y diseño— con espacio para escribir lo que quieras. Todas las respuestas van a un único hilo público compartido en lugar de abrir un asunto nuevo cada vez, con tu versión de Nodus y tu sistema operativo ya rellenados.',
    en: 'Suggest or report now includes an optional 0–10 survey — coverage, usability, performance, stability and design — with room to write whatever you like. Every response goes to one shared public thread instead of opening a new issue each time, with your Nodus version and operating system already filled in.',
    fr: 'Suggérer ou signaler inclut désormais une enquête facultative de 0 à 10 —couverture, ergonomie, performance, stabilité et design— avec de la place pour écrire ce que vous voulez. Toutes les réponses vont dans un unique fil public partagé au lieu d’ouvrir un nouveau ticket chaque fois, avec votre version de Nodus et votre système d’exploitation déjà renseignés.',
    de: 'Vorschlagen oder melden enthält jetzt eine optionale Umfrage von 0 bis 10 – Abdeckung, Bedienbarkeit, Leistung, Stabilität und Gestaltung – mit Platz für freien Text. Alle Antworten gehen in einen einzigen gemeinsamen öffentlichen Thread, statt jedes Mal ein neues Ticket zu eröffnen, mit deiner Nodus-Version und deinem Betriebssystem schon eingetragen.',
    pt: 'Sugerir ou reportar inclui agora um inquérito opcional de 0 a 10 —cobertura, usabilidade, desempenho, estabilidade e design— com espaço para escrever o que quiser. Todas as respostas vão para um único tópico público partilhado em vez de abrir um assunto novo de cada vez, com a sua versão do Nodus e o seu sistema operativo já preenchidos.',
    'pt-BR': 'Sugerir ou reportar inclui agora uma pesquisa opcional de 0 a 10 —cobertura, usabilidade, desempenho, estabilidade e design— com espaço para escrever o que quiser. Todas as respostas vão para um único tópico público compartilhado em vez de abrir um assunto novo cada vez, com sua versão do Nodus e seu sistema operacional já preenchidos.',
  },
  {
    scope: 'general',
    es: 'Tres arreglos que se notan a diario: los informes en PDF unifican su marca por bóveda y pierden las bandas grises que algunos lectores dibujaban alrededor de la imagen de portada, la personalización de la barra lateral es por bóveda en lugar de global, y las imágenes se cargan por la caché nativa y se pueden descargar en su resolución original.',
    en: 'Three fixes you notice daily: PDF reports unify their per-vault branding and lose the gray bands some viewers drew around the cover image, sidebar customization is per vault instead of global, and images load through the native cache and can be downloaded at their original resolution.',
    fr: 'Trois corrections qui se remarquent au quotidien : les rapports PDF unifient leur identité par coffre et perdent les bandes grises que certains lecteurs dessinaient autour de l’image de couverture, la personnalisation de la barre latérale se fait par coffre au lieu d’être globale, et les images se chargent via le cache natif et peuvent être téléchargées dans leur résolution d’origine.',
    de: 'Drei Korrekturen, die man täglich merkt: PDF-Berichte vereinheitlichen ihr Erscheinungsbild pro Tresor und verlieren die grauen Bänder, die manche Betrachter um das Titelbild zeichneten, die Anpassung der Seitenleiste gilt pro Tresor statt global, und Bilder laden über den nativen Cache und lassen sich in ihrer Originalauflösung herunterladen.',
    pt: 'Três correções que se notam todos os dias: os relatórios em PDF unificam a sua marca por cofre e perdem as bandas cinzentas que alguns leitores desenhavam em volta da imagem de capa, a personalização da barra lateral é por cofre em vez de global, e as imagens carregam pela cache nativa e podem ser transferidas na sua resolução original.',
    'pt-BR': 'Três correções que se notam todos os dias: os relatórios em PDF unificam sua marca por cofre e perdem as faixas cinzas que alguns leitores desenhavam em volta da imagem de capa, a personalização da barra lateral é por cofre em vez de global, e as imagens carregam pelo cache nativo e podem ser baixadas na resolução original.',
  },
];

const RELEASE_2_7_0_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'general',
    es: 'Los tutoriales de Nodus ya se pueden ver en vídeo sin salir de la aplicación. El primer arranque te pregunta cómo prefieres aprender —ver los tutoriales o leer la guía— y Ajustes → Tutoriales abre la misma parrilla, con reproductor integrado, marca de «visto» compartida entre bóvedas y la guía escrita siempre a un clic como camino sin conexión. Los recorridos guiados de cada bóveda ofrecen también su vídeo, y el catálogo se actualiza solo cuando publicamos uno nuevo.',
    en: 'Nodus tutorials can now be watched as video without leaving the app. First run asks how you prefer to learn — watch the tutorials or read the guide — and Settings → Tutorials opens the same grid, with a built-in player, a watched flag shared across vaults and the written guide always one click away as the offline path. Each vault’s guided tour offers its video too, and the catalogue refreshes on its own whenever we publish a new one.',
    fr: 'Les tutoriels de Nodus peuvent désormais être regardés en vidéo sans quitter l’application. Le premier lancement vous demande comment vous préférez apprendre — regarder les tutoriels ou lire le guide — et Paramètres → Tutoriels ouvre la même grille, avec lecteur intégré, marque « vu » partagée entre les espaces et le guide écrit toujours à un clic comme voie hors ligne. Les visites guidées de chaque espace proposent aussi leur vidéo, et le catalogue se met à jour tout seul dès que nous en publions un nouveau.',
    de: 'Die Nodus-Tutorials lassen sich jetzt als Video ansehen, ohne die App zu verlassen. Beim ersten Start wirst du gefragt, wie du lieber lernst – Tutorials ansehen oder die Anleitung lesen –, und Einstellungen → Tutorials öffnet dieselbe Übersicht, mit eingebautem Player, einer über alle Arbeitsbereiche geteilten „Gesehen“-Markierung und der schriftlichen Anleitung stets einen Klick entfernt als Offline-Weg. Auch die geführten Touren jedes Arbeitsbereichs bieten ihr Video an, und der Katalog aktualisiert sich von selbst, sobald wir ein neues veröffentlichen.',
    pt: 'Os tutoriais do Nodus já podem ser vistos em vídeo sem sair da aplicação. O primeiro arranque pergunta como prefere aprender — ver os tutoriais ou ler o guia — e Definições → Tutoriais abre a mesma grelha, com reprodutor integrado, marca de «visto» partilhada entre espaços e o guia escrito sempre a um clique como caminho sem ligação. As visitas guiadas de cada espaço oferecem também o seu vídeo, e o catálogo atualiza-se sozinho sempre que publicamos um novo.',
    'pt-BR': 'Os tutoriais do Nodus já podem ser assistidos em vídeo sem sair do aplicativo. A primeira execução pergunta como você prefere aprender — assistir aos tutoriais ou ler o guia — e Configurações → Tutoriais abre a mesma grade, com player integrado, marca de “assistido” compartilhada entre espaços e o guia escrito sempre a um clique como caminho offline. Os tours guiados de cada espaço também oferecem seu vídeo, e o catálogo se atualiza sozinho sempre que publicamos um novo.',
  },
  {
    scope: 'general',
    es: 'Las copias de seguridad automáticas ya no congelan la aplicación. El archivo se comprime y cifra sin bloquear el proceso principal, de modo que una biblioteca grande deja de dar tirones cada media hora; la sincronización con Nodus Server hace lo mismo con su comprimido. El formato de las copias no cambia y las existentes se restauran igual.',
    en: 'Automatic backups no longer freeze the app. The archive is now compressed and encrypted without blocking the main process, so a large library stops stuttering every half hour; Nodus Server sync does the same with its own compression. The backup format is unchanged and existing backups restore exactly as before.',
    fr: 'Les sauvegardes automatiques ne figent plus l’application. L’archive est désormais compressée et chiffrée sans bloquer le processus principal, de sorte qu’une grande bibliothèque cesse de saccader toutes les demi-heures ; la synchronisation avec Nodus Server fait de même avec sa compression. Le format des sauvegardes ne change pas et les sauvegardes existantes se restaurent comme avant.',
    de: 'Automatische Sicherungen frieren die App nicht mehr ein. Das Archiv wird jetzt komprimiert und verschlüsselt, ohne den Hauptprozess zu blockieren, sodass eine große Bibliothek nicht mehr alle halbe Stunde stockt; die Synchronisierung mit Nodus Server macht dasselbe mit ihrer Komprimierung. Das Sicherungsformat bleibt unverändert und vorhandene Sicherungen lassen sich genauso wiederherstellen.',
    pt: 'As cópias de segurança automáticas já não congelam a aplicação. O arquivo passa a ser comprimido e cifrado sem bloquear o processo principal, pelo que uma biblioteca grande deixa de dar solavancos a cada meia hora; a sincronização com o Nodus Server faz o mesmo com a sua compressão. O formato das cópias não muda e as existentes restauram-se tal como antes.',
    'pt-BR': 'Os backups automáticos não travam mais o aplicativo. O arquivo passa a ser compactado e criptografado sem bloquear o processo principal, então uma biblioteca grande deixa de engasgar a cada meia hora; a sincronização com o Nodus Server faz o mesmo com sua compactação. O formato dos backups não muda e os existentes são restaurados igual.',
  },
  {
    scope: 'nodi',
    es: 'Nodi vuelve a responder al instante y sus listas se comportan. Las notas rápidas y el chat ya hacen scroll en lugar de aplastar sus filas y cortar el texto por la mitad, y la mascota deja de quedarse congelada mientras el proceso principal está ocupado.',
    en: 'Nodi is instantly responsive again and its lists behave. Quick notes and chat now scroll instead of squashing their rows and clipping the text through the middle, and the mascot no longer freezes while the main process is busy.',
    fr: 'Nodi répond de nouveau instantanément et ses listes se tiennent. Les notes rapides et le chat défilent désormais au lieu d’écraser leurs lignes et de couper le texte en son milieu, et la mascotte ne se fige plus pendant que le processus principal est occupé.',
    de: 'Nodi reagiert wieder sofort und seine Listen benehmen sich. Schnellnotizen und Chat scrollen jetzt, statt ihre Zeilen zu stauchen und den Text mittendurch abzuschneiden, und das Maskottchen friert nicht mehr ein, während der Hauptprozess beschäftigt ist.',
    pt: 'O Nodi volta a responder num instante e as suas listas comportam-se. As notas rápidas e o chat já fazem deslocamento em vez de esmagar as linhas e cortar o texto a meio, e a mascote deixa de ficar congelada enquanto o processo principal está ocupado.',
    'pt-BR': 'O Nodi volta a responder na hora e suas listas se comportam. As notas rápidas e o chat agora rolam em vez de esmagar as linhas e cortar o texto pela metade, e o mascote deixa de ficar congelado enquanto o processo principal está ocupado.',
  },
  {
    scope: 'general',
    es: 'Dos retoques de interfaz: el botón Actualizar del encabezado deja de ir resaltado en color y se iguala al resto de la barra, y en la ficha de persona los botones de añadir (relaciones, lugares, variantes del nombre y hechos vitales) se recogen en un icono con su descripción al pasar el ratón, así que el título y la descripción de cada sección vuelven a caber en una línea.',
    en: 'Two interface touch-ups: the header’s Sync button is no longer filled with the accent colour and now matches the rest of the rail, and in the person dossier the add buttons (relations, places, name variants and life events) collapse to an icon with a tooltip, so each section’s title and description fit on one line again.',
    fr: 'Deux retouches d’interface : le bouton Actualiser de l’en-tête n’est plus rempli de la couleur d’accent et s’aligne sur le reste de la barre, et dans la fiche de personne les boutons d’ajout (relations, lieux, variantes du nom et événements de vie) se réduisent à une icône avec une infobulle, de sorte que le titre et la description de chaque section tiennent de nouveau sur une ligne.',
    de: 'Zwei Feinschliffe an der Oberfläche: Die Schaltfläche „Aktualisieren“ in der Kopfzeile ist nicht mehr in der Akzentfarbe gefüllt und passt sich dem Rest der Leiste an, und im Personendossier schrumpfen die Hinzufügen-Schaltflächen (Beziehungen, Orte, Namensvarianten und Lebensereignisse) auf ein Symbol mit Kurzinfo, sodass Titel und Beschreibung jedes Abschnitts wieder in eine Zeile passen.',
    pt: 'Dois retoques de interface: o botão Atualizar do cabeçalho deixa de estar preenchido com a cor de destaque e iguala-se ao resto da barra, e na ficha de pessoa os botões de adicionar (relações, lugares, variantes do nome e factos de vida) recolhem-se num ícone com descrição ao passar o rato, pelo que o título e a descrição de cada secção voltam a caber numa linha.',
    'pt-BR': 'Dois retoques de interface: o botão Atualizar do cabeçalho deixa de ficar preenchido com a cor de destaque e se iguala ao resto da barra, e na ficha de pessoa os botões de adicionar (relações, lugares, variantes do nome e fatos da vida) se recolhem em um ícone com dica ao passar o mouse, então o título e a descrição de cada seção voltam a caber em uma linha.',
  },
  {
    scope: 'plugin',
    es: 'Instalar el copiloto de Word ya no toca la caché de complementos de Office. Antes se borraban archivos sueltos de esa caché —algo que Microsoft desaconseja— y podía dejar sin cargar todos los complementos de Word; ahora basta con reinstalar desde Ajustes y abrir Word de nuevo. El manual del complemento explica el proceso real de instalación y cómo distinguirlo de un fallo propio de Office.',
    en: 'Installing the Word copilot no longer touches Office’s add-in cache. It used to delete individual files from that cache — which Microsoft advises against — and could leave every Word add-in failing to load; reinstalling from Settings and reopening Word is now enough. The add-in manual documents the real install flow and how to tell it apart from an Office-side failure.',
    fr: 'L’installation du copilote Word ne touche plus au cache des compléments d’Office. Auparavant, des fichiers isolés de ce cache étaient supprimés — ce que Microsoft déconseille — au risque d’empêcher le chargement de tous les compléments Word ; il suffit désormais de réinstaller depuis les Paramètres et de rouvrir Word. Le manuel du complément décrit la véritable procédure d’installation et comment la distinguer d’une panne propre à Office.',
    de: 'Die Installation des Word-Copiloten rührt den Add-in-Cache von Office nicht mehr an. Zuvor wurden einzelne Dateien aus diesem Cache gelöscht – wovon Microsoft abrät – und dadurch konnten sämtliche Word-Add-ins nicht mehr laden; jetzt genügt es, aus den Einstellungen neu zu installieren und Word erneut zu öffnen. Das Add-in-Handbuch beschreibt den tatsächlichen Installationsablauf und wie er sich von einem Office-eigenen Fehler unterscheiden lässt.',
    pt: 'Instalar o copiloto do Word já não mexe na cache de suplementos do Office. Antes eram apagados ficheiros soltos dessa cache — algo que a Microsoft desaconselha — e podia deixar todos os suplementos do Word sem carregar; agora basta reinstalar a partir das Definições e abrir o Word de novo. O manual do suplemento explica o processo real de instalação e como distingui-lo de uma falha do próprio Office.',
    'pt-BR': 'Instalar o copiloto do Word não mexe mais no cache de suplementos do Office. Antes eram apagados arquivos avulsos desse cache — algo que a Microsoft desaconselha — e isso podia deixar todos os suplementos do Word sem carregar; agora basta reinstalar pelas Configurações e abrir o Word de novo. O manual do suplemento explica o processo real de instalação e como distingui-lo de uma falha do próprio Office.',
  },
];

/**
 * 3.2.0 is about work that takes minutes and what the app does with you while it runs.
 *
 * The first two are for whoever runs a Nodus Server, and are the same thing said twice: a
 * server that stopped being a good neighbour to itself the moment it had work to do. The
 * three after them are the desktop half of that story, in Deep Research: a queue that says
 * where it is, reports that arrive by themselves, and a window that keeps moving while a
 * report is written. More may land beside them before this ships.
 */
const RELEASE_3_2_0_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'general',
    es: 'Buscar por significado en un servidor de Nodus ya no lo deja sin atender a nadie más. Antes, mientras resolvía una búsqueda, el resto de peticiones esperaban su turno. Ahora ese cálculo va en hilos aparte y el servidor sigue respondiendo. Se nota sobre todo cuando varias personas consultan a la vez.',
    en: 'A meaning-based search on a Nodus server no longer leaves it unable to answer anybody else. Until now, while it worked out one search, every other request waited its turn. That arithmetic runs on separate threads and the server keeps replying. It shows most when several people ask at once.',
    fr: 'Une recherche par le sens sur un serveur Nodus ne l’empêche plus de répondre aux autres. Jusqu’ici, pendant qu’il traitait une recherche, toutes les autres requêtes attendaient leur tour. Ce calcul s’exécute désormais sur des fils séparés et le serveur continue de répondre. Cela se voit surtout quand plusieurs personnes interrogent en même temps.',
    de: 'Eine Suche nach Bedeutung auf einem Nodus-Server blockiert nicht mehr alle anderen Anfragen. Bisher wartete jede weitere Anfrage, solange eine Suche berechnet wurde. Diese Rechenarbeit läuft jetzt in eigenen Threads und der Server antwortet weiter. Am deutlichsten ist das, wenn mehrere Personen gleichzeitig fragen.',
    pt: 'Procurar por significado num servidor Nodus já não o deixa sem responder a mais ninguém. Até agora, enquanto resolvia uma procura, todos os outros pedidos esperavam a sua vez. Esse cálculo passa a correr em fios separados e o servidor continua a responder. Nota-se sobretudo quando várias pessoas consultam ao mesmo tempo.',
    'pt-BR': 'Buscar por significado em um servidor Nodus não o deixa mais sem responder a ninguém. Até agora, enquanto resolvia uma busca, todos os outros pedidos esperavam a sua vez. Esse cálculo passa a rodar em threads separadas e o servidor continua respondendo. Aparece principalmente quando várias pessoas consultam ao mesmo tempo.',
  },
  {
    scope: 'general',
    es: 'El servidor ya no reserva memoria a ciegas. Guardaba tres bóvedas publicadas en memoria, del tamaño que fueran, y con un corpus grande eso pasaba del gigabyte. Ahora el límite se mide en memoria y no en número de bóvedas. Quien administre un servidor puede subirlo si su máquina da para más.',
    en: 'The server no longer sets memory aside blindly. It kept three published vaults in memory whatever their size, which for a large corpus went past a gigabyte. The ceiling is now measured in memory rather than in a count of vaults. Anyone running a server can raise it if their machine has the room.',
    fr: 'Le serveur ne réserve plus de mémoire à l’aveugle. Il gardait trois coffres publiés en mémoire quelle que soit leur taille, ce qui dépassait le gigaoctet pour un grand corpus. Le plafond se mesure désormais en mémoire et non en nombre de coffres. Qui administre un serveur peut l’augmenter si sa machine le permet.',
    de: 'Der Server reserviert Speicher nicht mehr blind. Er hielt drei veröffentlichte Tresore im Speicher, unabhängig von ihrer Größe, was bei einem großen Korpus über ein Gigabyte war. Die Obergrenze wird jetzt in Speicher gemessen und nicht in einer Anzahl von Tresoren. Wer einen Server betreibt, kann sie anheben, wenn die Maschine Platz hat.',
    pt: 'O servidor já não reserva memória às cegas. Guardava três cofres publicados em memória, fosse qual fosse o tamanho, o que num corpus grande passava do gigabyte. O limite passa a medir-se em memória e não num número de cofres. Quem administra um servidor pode aumentá-lo se a máquina der para mais.',
    'pt-BR': 'O servidor não reserva mais memória às cegas. Ele mantinha três cofres publicados na memória, de qualquer tamanho, o que em um corpus grande passava do gigabyte. O limite passa a ser medido em memória, e não em número de cofres. Quem administra um servidor pode aumentá-lo se a máquina tiver espaço.',
  },
  {
    scope: 'general',
    es: 'La cola de Deep Research ya dice por dónde va. El informe que se está generando lleva una barra con su porcentaje real, y los que esperan indican cuántos tienen por delante. Antes solo giraba un icono, sin forma de distinguir uno que acababa de empezar de otro a punto de terminar.',
    en: 'The Deep Research queue now says where it stands. The report being generated carries a bar with its real percentage, and the ones waiting say how many are ahead of them. Before there was only a spinning icon, with no way to tell one that had just started from one about to finish.',
    fr: 'La file de Deep Research indique désormais où elle en est. Le rapport en cours de génération porte une barre avec son pourcentage réel, et ceux qui attendent indiquent combien les précèdent. Auparavant, une icône tournait sans permettre de distinguer un rapport qui venait de commencer d’un autre sur le point de finir.',
    de: 'Die Deep-Research-Warteschlange sagt jetzt, wo sie steht. Der Bericht, der gerade erzeugt wird, trägt einen Balken mit seinem tatsächlichen Prozentsatz, und die wartenden nennen die Anzahl vor ihnen. Vorher drehte sich nur ein Symbol, ohne Unterschied zwischen einem eben gestarteten und einem fast fertigen Bericht.',
    pt: 'A fila do Deep Research já diz por onde vai. O relatório que está a ser gerado tem uma barra com a sua percentagem real, e os que esperam indicam quantos têm à frente. Antes apenas rodava um ícone, sem forma de distinguir um que tinha acabado de começar de outro prestes a terminar.',
    'pt-BR': 'A fila do Deep Research agora diz onde está. O relatório que está sendo gerado tem uma barra com a porcentagem real, e os que esperam indicam quantos estão à frente deles. Antes só girava um ícone, sem como distinguir um que tinha acabado de começar de outro prestes a terminar.',
  },
  {
    scope: 'general',
    es: 'Un informe terminado aparece solo en la galería. Si encolabas varios, todos menos el último se quedaban fuera hasta que salías de la sección y volvías a entrar. Y un informe que se genera pero no se puede guardar ahora lo dice, en vez de desaparecer sin dejar rastro.',
    en: 'A finished report now appears in the gallery by itself. With several queued, all but the last stayed out of it until you left the section and came back. And a report that generates but cannot be saved now says so, instead of disappearing without a trace.',
    fr: 'Un rapport terminé apparaît désormais tout seul dans la galerie. Quand plusieurs étaient en file, tous sauf le dernier en restaient absents jusqu’à ce que vous quittiez la section et y reveniez. Et un rapport qui se génère mais ne peut pas être enregistré le dit maintenant, au lieu de disparaître sans laisser de trace.',
    de: 'Ein fertiger Bericht erscheint jetzt von selbst in der Galerie. Standen mehrere in der Warteschlange, blieben alle außer dem letzten draußen, bis man den Bereich verließ und zurückkam. Und ein Bericht, der erzeugt, aber nicht gespeichert werden kann, sagt das jetzt, statt spurlos zu verschwinden.',
    pt: 'Um relatório terminado aparece sozinho na galeria. Quando havia vários em fila, todos menos o último ficavam de fora até sair da secção e voltar a entrar. E um relatório que se gera mas não pode ser guardado agora di-lo, em vez de desaparecer sem deixar rasto.',
    'pt-BR': 'Um relatório terminado aparece sozinho na galeria. Quando havia vários na fila, todos menos o último ficavam de fora até você sair da seção e voltar. E um relatório que é gerado mas não pode ser salvo agora avisa, em vez de sumir sem deixar rastro.',
  },
  {
    scope: 'general',
    es: 'Generar un informe ya no congela la ventana. Nodus recorre el corpus entero varias veces por informe, y cada una de esas búsquedas dejaba la aplicación parada mientras duraba. Ahora van por partes y devuelven el control entre una y otra, así que puedes seguir trabajando mientras se escribe.',
    en: 'Generating a report no longer freezes the window. Nodus goes through the whole corpus several times per report, and each of those searches left the app stuck for as long as it took. They now run in parts and hand control back between them, so you can carry on working while a report is written.',
    fr: 'Générer un rapport ne fige plus la fenêtre. Nodus parcourt tout le corpus plusieurs fois par rapport, et chacune de ces recherches laissait l’application bloquée le temps qu’elle durait. Elles se font désormais par morceaux et rendent la main entre chacun, vous pouvez donc continuer à travailler pendant la rédaction.',
    de: 'Einen Bericht zu erzeugen friert das Fenster nicht mehr ein. Nodus durchläuft pro Bericht mehrmals den gesamten Korpus, und jede dieser Suchen ließ die Anwendung so lange stehen, wie sie dauerte. Sie laufen jetzt in Teilen und geben zwischendurch die Kontrolle zurück, sodass Sie weiterarbeiten können, während geschrieben wird.',
    pt: 'Gerar um relatório já não congela a janela. O Nodus percorre todo o corpus várias vezes por relatório, e cada uma dessas procuras deixava a aplicação parada enquanto durava. Agora fazem-se por partes e devolvem o controlo entre elas, por isso pode continuar a trabalhar enquanto o relatório se escreve.',
    'pt-BR': 'Gerar um relatório não congela mais a janela. O Nodus percorre todo o corpus várias vezes por relatório, e cada uma dessas buscas deixava o aplicativo parado enquanto durava. Agora elas são feitas por partes e devolvem o controle entre uma e outra, então você pode continuar trabalhando enquanto o relatório é escrito.',
  },
];

/**
 * 3.2.1 is one bug, told from both ends.
 *
 * The Deep Research a phone or a colleague's machine writes is a single row carrying the whole
 * report, and the server would not take a row that large. Nothing about it was visible from
 * either side: the limit was not published, the refusal carried no numbers, and a queue that
 * did not fit gave up quietly and retried forever. The first note is the limit, the second is
 * everything that made the limit impossible to diagnose.
 */
const RELEASE_3_2_1_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'general',
    es: 'Un informe de Deep Research escrito en el móvil o en otro equipo ya llega a la bóveda. El servidor solo aceptaba cambios de 64 KB y un informe de quince páginas ocupa casi el triple, así que se rechazaba siempre. El límite sube a 256 KB por cambio y quien administre un servidor puede ajustarlo.',
    en: 'A Deep Research report written on the phone or on another machine now reaches the vault. The server only accepted changes of 64 KB and a fifteen-page report is nearly three times that, so it was refused every time. The limit rises to 256 KB per change and anyone running a server can adjust it.',
    fr: 'Un rapport Deep Research rédigé sur le téléphone ou sur une autre machine parvient désormais au coffre. Le serveur n’acceptait que des modifications de 64 Ko et un rapport de quinze pages en fait presque le triple, il était donc toujours refusé. La limite passe à 256 Ko par modification et qui administre un serveur peut l’ajuster.',
    de: 'Ein Deep-Research-Bericht, der auf dem Telefon oder auf einem anderen Rechner entsteht, erreicht jetzt den Tresor. Der Server nahm nur Änderungen von 64 KB an, und ein Bericht über fünfzehn Seiten ist fast dreimal so groß, also wurde er jedes Mal abgewiesen. Die Grenze steigt auf 256 KB pro Änderung und wer einen Server betreibt, kann sie anpassen.',
    pt: 'Um relatório de Deep Research escrito no telemóvel ou noutro equipamento já chega ao cofre. O servidor só aceitava alterações de 64 KB e um relatório de quinze páginas ocupa quase o triplo, por isso era sempre recusado. O limite sobe para 256 KB por alteração e quem administra um servidor pode ajustá-lo.',
    'pt-BR': 'Um relatório de Deep Research escrito no celular ou em outro computador agora chega ao cofre. O servidor só aceitava mudanças de 64 KB e um relatório de quinze páginas ocupa quase o triplo, então era sempre recusado. O limite sobe para 256 KB por mudança e quem administra um servidor pode ajustá-lo.',
  },
  {
    scope: 'general',
    es: 'Un cambio que el servidor no puede aceptar ya explica por qué. Antes solo decía que era demasiado grande, sin decir cuánto ocupaba ni cuál era el máximo. Y una cola de cambios que no cabía en un envío se quedaba atascada para siempre. Ahora se reparte en envíos más pequeños hasta vaciarse.',
    en: 'A change the server cannot accept now explains why. Before it only said the change was too large, without saying how large it was or what the maximum is. And a queue of changes too big for one delivery used to get stuck forever. It is now split into smaller deliveries until it empties.',
    fr: 'Une modification que le serveur ne peut pas accepter explique désormais pourquoi. Auparavant, elle indiquait seulement qu’elle était trop volumineuse, sans dire sa taille ni le maximum. Et une file de modifications trop grosse pour un seul envoi restait bloquée pour toujours. Elle se répartit maintenant en envois plus petits jusqu’à se vider.',
    de: 'Eine Änderung, die der Server nicht annehmen kann, erklärt jetzt warum. Vorher hieß es nur, sie sei zu groß, ohne ihre Größe und ohne das Maximum zu nennen. Und eine Warteschlange, die nicht in eine Sendung passte, blieb für immer stecken. Sie wird jetzt auf kleinere Sendungen verteilt, bis sie leer ist.',
    pt: 'Uma alteração que o servidor não pode aceitar já explica porquê. Antes apenas dizia que era demasiado grande, sem dizer quanto ocupava nem qual era o máximo. E uma fila de alterações que não cabia num envio ficava encravada para sempre. Agora reparte-se em envios mais pequenos até esvaziar.',
    'pt-BR': 'Uma mudança que o servidor não pode aceitar agora explica por quê. Antes só dizia que era grande demais, sem dizer quanto ocupava nem qual era o máximo. E uma fila de mudanças que não cabia em um envio ficava travada para sempre. Agora ela é dividida em envios menores até esvaziar.',
  },
];

/**
 * 3.2.2 is one line of the interface telling the truth again.
 *
 * A server that answers badly for a moment is ordinary and says so; a panel that goes on saying
 * it long after the server recovered is not, because nothing on screen tells the two apart. The
 * message was written on failure and never taken back.
 */
const RELEASE_3_2_2_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'general',
    es: 'Un error de sincronización que ya se ha resuelto deja de mostrarse. El panel del vault podía enseñar un fallo del servidor durante el resto de la sesión, justo al lado de una publicación que había ido bien. El aviso se retira en cuanto la sincronización vuelve a funcionar.',
    en: 'A sync error that has already been resolved stops being shown. The vault panel could display a server failure for the rest of the session, right beside a publication that had gone through. The notice now clears as soon as syncing works again.',
    fr: 'Une erreur de synchronisation déjà résolue cesse de s’afficher. Le panneau du coffre pouvait montrer une panne du serveur pendant tout le reste de la session, juste à côté d’une publication qui avait réussi. L’avis disparaît dès que la synchronisation refonctionne.',
    de: 'Ein Synchronisationsfehler, der längst behoben ist, wird nicht mehr angezeigt. Das Panel des Tresors konnte einen Serverfehler für den Rest der Sitzung zeigen, direkt neben einer Veröffentlichung, die gelungen war. Der Hinweis verschwindet jetzt, sobald die Synchronisation wieder funktioniert.',
    pt: 'Um erro de sincronização já resolvido deixa de ser mostrado. O painel do cofre podia exibir uma falha do servidor durante o resto da sessão, mesmo ao lado de uma publicação que tinha corrido bem. O aviso desaparece assim que a sincronização volta a funcionar.',
    'pt-BR': 'Um erro de sincronização já resolvido deixa de ser mostrado. O painel do cofre podia exibir uma falha do servidor pelo resto da sessão, bem ao lado de uma publicação que tinha dado certo. O aviso some assim que a sincronização volta a funcionar.',
  },
];

/**
 * 3.2.3 is search on a connected phone answering at all, and three things a reader can now do
 * with what they are reading.
 *
 * The search: each result carries the identifier of the row it found, and for a theme, a
 * character or a scene the server had none to give — those rows are keyed on a column of their
 * own, and the generic guess came up empty. The app cannot read a result without one, so it
 * discarded the whole answer, and a single theme whose name contained the query took every other
 * result down with it.
 *
 * The other three are about reading rather than finding: a report can be marked as read, a
 * passage on the phone can be kept as the place you stopped, and a work on the phone leads back
 * to its item in Zotero.
 */
const RELEASE_3_2_3_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'general',
    es: 'La búsqueda en el móvil deja de fallar cuando lo que se busca aparece en un tema, un personaje o una escena. Bastaba con que una de esas fichas coincidiera para que la app no pudiera leer la respuesta del servidor y no mostrara ningún resultado. Ahora cada resultado llega identificado y la lista se abre entera.',
    en: 'Search on the phone stops failing when what you are looking for appears in a theme, a character or a scene. One matching card was enough for the app to be unable to read the answer, so it showed no results at all. Every result now arrives properly identified and the list opens in full.',
    fr: 'La recherche sur le téléphone cesse d’échouer quand ce que vous cherchez apparaît dans un thème, un personnage ou une scène. Il suffisait d’une seule de ces fiches pour que l’application ne puisse pas lire la réponse et n’affiche aucun résultat. Chaque résultat arrive désormais identifié et la liste s’ouvre en entier.',
    de: 'Die Suche auf dem Telefon scheitert nicht mehr, wenn das Gesuchte in einem Thema, einer Figur oder einer Szene vorkommt. Eine einzige solche Karte reichte, damit die App die Antwort nicht lesen konnte und gar keine Ergebnisse zeigte. Jedes Ergebnis kommt jetzt eindeutig benannt an und die Liste öffnet sich vollständig.',
    pt: 'A pesquisa no telemóvel deixa de falhar quando o que procura aparece num tema, numa personagem ou numa cena. Bastava uma dessas fichas coincidir para a aplicação não conseguir ler a resposta e não mostrar resultado nenhum. Agora cada resultado chega identificado e a lista abre por inteiro.',
    'pt-BR': 'A busca no celular deixa de falhar quando o que você procura aparece em um tema, um personagem ou uma cena. Bastava uma dessas fichas coincidir para o aplicativo não conseguir ler a resposta e não mostrar resultado nenhum. Agora cada resultado chega identificado e a lista abre por inteiro.',
  },
  {
    scope: 'general',
    es: 'Un informe de Deep Research se puede marcar como leído, en el escritorio y en el móvil. La galería lo dice de un vistazo, con una insignia sobre la portada y el título un punto más ligero, así que ya no hay que abrir veinte informes para saber cuál queda pendiente.',
    en: 'A Deep Research report can be marked as read, on the desktop and on the phone. The gallery says so at a glance, with a badge over the cover and a lighter title, so you no longer have to open twenty reports to find out which one is still waiting.',
    fr: 'Un rapport de Deep Research peut être marqué comme lu, sur l’ordinateur comme sur le téléphone. La galerie le dit d’un coup d’œil, avec une pastille sur la couverture et un titre plus léger, et il n’y a plus besoin d’ouvrir vingt rapports pour savoir lequel attend encore.',
    de: 'Ein Deep-Research-Bericht lässt sich als gelesen markieren, am Schreibtisch und am Telefon. Die Galerie zeigt es auf einen Blick, mit einer Plakette über dem Titelbild und einem leichteren Titel. So müssen Sie nicht mehr zwanzig Berichte öffnen, um zu sehen, welcher noch wartet.',
    pt: 'Um relatório de Deep Research pode ser marcado como lido, no computador e no telemóvel. A galeria di-lo num relance, com um selo sobre a capa e o título mais leve, por isso já não é preciso abrir vinte relatórios para saber qual ainda está por ler.',
    'pt-BR': 'Um relatório de Deep Research pode ser marcado como lido, no computador e no celular. A galeria mostra isso num relance, com um selo sobre a capa e o título mais leve, então não é mais preciso abrir vinte relatórios para saber qual ainda está esperando.',
  },
  {
    scope: 'general',
    es: 'En el móvil, selecciona un pasaje de un informe y guárdalo como marcador de lectura. Solo hay uno por informe, se ve marcado en el propio texto y, al volver a abrir el informe, se abre justo ahí. Tocando el pasaje marcado puedes quitarlo.',
    en: 'On the phone, select a passage in a report and keep it as a reading bookmark. There is only one per report, it is marked in the text itself, and reopening the report takes you straight to it. Tapping the marked passage offers to remove it.',
    fr: 'Sur le téléphone, sélectionnez un passage d’un rapport et gardez-le comme marque-page de lecture. Il n’y en a qu’un par rapport, il est signalé dans le texte, et rouvrir le rapport vous y ramène directement. Toucher le passage marqué propose de l’enlever.',
    de: 'Wählen Sie am Telefon eine Passage in einem Bericht aus und behalten Sie sie als Lesezeichen. Es gibt nur eines pro Bericht, es ist im Text selbst markiert, und beim erneuten Öffnen landen Sie genau dort. Ein Tippen auf die markierte Stelle bietet an, sie zu entfernen.',
    pt: 'No telemóvel, selecione uma passagem de um relatório e guarde-a como marcador de leitura. Só existe um por relatório, fica assinalado no próprio texto e, ao reabrir o relatório, este abre precisamente aí. Tocar na passagem marcada permite removê-la.',
    'pt-BR': 'No celular, selecione um trecho de um relatório e guarde como marcador de leitura. Só existe um por relatório, ele fica marcado no próprio texto e, ao reabrir o relatório, ele abre exatamente ali. Tocar no trecho marcado permite removê-lo.',
  },
  {
    scope: 'general',
    es: 'Cada obra en el móvil lleva ahora un botón que la abre en Zotero para iPhone y iPad. La clave de Zotero deja de ser un dato muerto de la ficha y pasa a ser el camino de vuelta al PDF, a las notas y a las anotaciones que están en la otra aplicación.',
    en: 'Every work on the phone now carries a control that opens it in Zotero for iPhone and iPad. The Zotero key stops being a dead line of the record and becomes the way back to the PDF, the notes and the annotations that live in the other app.',
    fr: 'Chaque œuvre sur le téléphone porte désormais un bouton qui l’ouvre dans Zotero pour iPhone et iPad. La clé Zotero cesse d’être une ligne morte de la fiche et devient le chemin de retour vers le PDF, les notes et les annotations qui vivent dans l’autre application.',
    de: 'Jedes Werk auf dem Telefon hat jetzt eine Schaltfläche, die es in Zotero für iPhone und iPad öffnet. Der Zotero-Schlüssel ist keine tote Zeile des Datensatzes mehr, sondern der Weg zurück zum PDF, zu den Notizen und zu den Anmerkungen in der anderen App.',
    pt: 'Cada obra no telemóvel passa a ter um botão que a abre no Zotero para iPhone e iPad. A chave do Zotero deixa de ser uma linha morta da ficha e passa a ser o caminho de volta ao PDF, às notas e às anotações que estão na outra aplicação.',
    'pt-BR': 'Cada obra no celular agora tem um botão que a abre no Zotero para iPhone e iPad. A chave do Zotero deixa de ser uma linha morta da ficha e vira o caminho de volta ao PDF, às notas e às anotações que estão no outro aplicativo.',
  },
];

/**
 * 3.2.4 — the header stops being a shelf, and Nodus gains a way to say something.
 *
 * The first four entries are that change: a button that always reaches the notification
 * centre, a channel that can warn about something between releases, a rail with three
 * fewer icons, and an inbox that only shows up when it holds something. Then the links
 * to the project's accounts, the first look at Nodus on a phone and what changed in
 * reading a report there, and the two fixes that arrived on their own: the local AI
 * engine addressed on the wrong interface once it was already running, and the buttons
 * that were laying out without their icon.
 */
/**
 * v3.2.7 — Deep Research annotations synchronize with mobile, the library and graph
 * become easier to navigate, and assistant activity is visible while replies stream.
 */
const RELEASE_3_2_7_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'academic',
    es: 'Deep Research estrena subrayados en seis colores, comentarios laterales y un subrayador que puede quedarse encendido. Los marcadores también pasan al margen. Todo se guarda en el vault y se sincroniza por Nodus Server entre el escritorio y el móvil, incluso si el teléfono pierde la conexión mientras anotas.',
    en: 'Deep Research gains highlights in six colors, margin comments, and a highlighter that can stay on. Bookmarks move to the margin too. Everything is stored in the vault and synchronized through Nodus Server between desktop and mobile, even if the phone loses its connection while you annotate.',
    fr: 'Deep Research accueille des surlignages en six couleurs, des commentaires en marge et un surligneur qui peut rester actif. Les marque-pages passent eux aussi dans la marge. Tout est conservé dans le coffre et synchronisé par Nodus Server entre l’ordinateur et le mobile, même si le téléphone perd sa connexion pendant que vous annotez.',
    de: 'Deep Research erhält Hervorhebungen in sechs Farben, Randkommentare und einen Textmarker, der eingeschaltet bleiben kann. Auch Lesezeichen wandern an den Rand. Alles wird im Tresor gespeichert und über Nodus Server zwischen Desktop und Mobilgerät synchronisiert, selbst wenn das Telefon beim Annotieren die Verbindung verliert.',
    pt: 'O Deep Research ganha sublinhados em seis cores, comentários laterais e um marcador que pode ficar ligado. Os marcadores de leitura também passam para a margem. Tudo fica guardado no cofre e é sincronizado pelo Nodus Server entre o computador e o telemóvel, mesmo que o telefone perca a ligação enquanto anota.',
    'pt-BR': 'O Deep Research ganha destaques em seis cores, comentários laterais e um marcador que pode ficar ligado. Os marcadores de leitura também passam para a margem. Tudo fica salvo no cofre e é sincronizado pelo Nodus Server entre o computador e o celular, mesmo que o telefone perca a conexão enquanto você anota.',
  },
  {
    scope: 'academic',
    es: 'Volver a un informe es más fácil. La biblioteca puede separar los informes leídos de los pendientes, y sus distintivos se leen igual de bien en claro y oscuro. El marcador te lleva al pasaje exacto desde la barra y se elimina desde su icono del margen. Los subrayados se borran con un clic y los comentarios se pueden editar o eliminar con confirmación.',
    en: 'Returning to a report is easier. The library can separate read reports from those still waiting, and their badges remain clear in light and dark mode. The bookmark takes you to the exact passage from the toolbar and can be removed from its margin icon. Highlights disappear with one click, while comments can be edited or deleted with confirmation.',
    fr: 'Revenir à un rapport est plus simple. La bibliothèque peut séparer les rapports lus de ceux qui restent à lire, et leurs badges restent lisibles en mode clair comme sombre. Le marque-page ramène au passage exact depuis la barre et se retire par son icône en marge. Les surlignages se suppriment en un clic, tandis que les commentaires se modifient ou se suppriment après confirmation.',
    de: 'Zu einem Bericht zurückzukehren ist einfacher. Die Bibliothek kann gelesene Berichte von noch offenen trennen, und ihre Kennzeichen bleiben im hellen wie im dunklen Modus gut lesbar. Das Lesezeichen führt über die Leiste zur genauen Passage und lässt sich über sein Randsymbol entfernen. Hervorhebungen verschwinden mit einem Klick, Kommentare lassen sich bearbeiten oder nach Bestätigung löschen.',
    pt: 'Voltar a um relatório é mais fácil. A biblioteca pode separar os relatórios lidos dos que ainda aguardam, e os seus distintivos continuam legíveis nos modos claro e escuro. O marcador leva à passagem exata a partir da barra e remove-se pelo ícone da margem. Os sublinhados apagam-se com um clique, enquanto os comentários podem ser editados ou eliminados com confirmação.',
    'pt-BR': 'Voltar a um relatório ficou mais fácil. A biblioteca pode separar os relatórios lidos dos que ainda aguardam, e seus indicadores continuam legíveis nos modos claro e escuro. O marcador leva ao trecho exato pela barra e pode ser removido pelo ícone da margem. Os destaques são apagados com um clique, enquanto os comentários podem ser editados ou excluídos com confirmação.',
  },
  {
    scope: 'academic',
    es: 'El Grafo abre ahora como un atlas legible del corpus. Primero muestra una constelación de temas, al entrar en uno enseña sus ideas más conectadas y las vistas de contradicciones, lectura, pendientes y autores presentan escenas acotadas. Los corpus grandes cargan por niveles en vez de convertirse en una maraña.',
    en: 'The Graph now opens as a readable atlas of the corpus. It first shows a constellation of themes, entering one reveals its most connected ideas, and the contradiction, reading, waiting, and author views present bounded scenes. Large corpora load in levels instead of turning into a hairball.',
    fr: 'Le Graphe s’ouvre désormais comme un atlas lisible du corpus. Il montre d’abord une constellation de thèmes, entrer dans l’un révèle ses idées les plus connectées, et les vues des contradictions, de lecture, d’attente et des auteurs présentent des scènes limitées. Les grands corpus se chargent par niveaux au lieu de devenir un enchevêtrement.',
    de: 'Der Graph öffnet sich jetzt als lesbarer Atlas des Korpus. Zuerst zeigt er eine Konstellation von Themen, beim Öffnen eines Themas erscheinen dessen am stärksten vernetzte Ideen, und die Ansichten für Widersprüche, Lesen, Offenes und Autoren zeigen begrenzte Szenen. Große Korpora laden stufenweise, statt zu einem unlesbaren Knäuel zu werden.',
    pt: 'O Grafo abre agora como um atlas legível do corpus. Primeiro mostra uma constelação de temas, entrar num deles revela as ideias mais ligadas, e as vistas de contradições, leitura, pendentes e autores apresentam cenas limitadas. Os corpora grandes carregam por níveis em vez de se transformarem num emaranhado.',
    'pt-BR': 'O Grafo agora abre como um atlas legível do corpus. Primeiro mostra uma constelação de temas, entrar em um deles revela as ideias mais conectadas, e as telas de contradições, leitura, pendentes e autores apresentam cenas limitadas. Os corpus grandes carregam por níveis em vez de virarem um emaranhado.',
  },
  {
    scope: 'nodi',
    es: 'Las respuestas en curso ya no se confunden con un mensaje vacío. Nodi y el Asistente de investigación muestran el mismo indicador animado de tres puntos mientras piensan, adaptado a la ventana principal y a la flotante.',
    en: 'Replies in progress no longer look like an empty message. Nodi and the Research Assistant show the same animated three-dot indicator while they think, adapted to both the main window and the floating one.',
    fr: 'Les réponses en cours ne ressemblent plus à un message vide. Nodi et l’Assistant de recherche affichent le même indicateur animé à trois points pendant leur réflexion, adapté à la fenêtre principale comme à la fenêtre flottante.',
    de: 'Laufende Antworten sehen nicht mehr wie eine leere Nachricht aus. Nodi und der Forschungsassistent zeigen beim Denken denselben animierten Dreipunkt-Indikator, angepasst an das Hauptfenster und das schwebende Fenster.',
    pt: 'As respostas em curso deixam de parecer uma mensagem vazia. O Nodi e o Assistente de investigação mostram o mesmo indicador animado de três pontos enquanto pensam, adaptado à janela principal e à flutuante.',
    'pt-BR': 'As respostas em andamento não parecem mais uma mensagem vazia. O Nodi e o Assistente de pesquisa mostram o mesmo indicador animado de três pontos enquanto pensam, adaptado à janela principal e à flutuante.',
  },
];

/**
 * v3.2.6 — each job owns its reasoning level, Nodi becomes a real report reader,
 * authors can be kept on a shelf, startup modals settle down, and MCP clients can
 * retrieve every readable layer and every saved Deep Research report.
 */
const RELEASE_3_2_6_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'general',
    es: 'El nivel de razonamiento ya es de cada tarea. Antes, subirlo en Inmersión lo subía también en Deep Research y en todas las demás que usaran ese modelo. Ahora cada tarea guarda el suyo, y en Proveedores sigues fijando el predeterminado del modelo.',
    en: 'The reasoning level now belongs to each job. Raising it on Immersion used to raise it on Deep Research and on every other job running that model. Each job now keeps its own, and Providers still sets the default for the model.',
    fr: 'Le niveau de raisonnement appartient désormais à chaque tâche. L’augmenter sur Immersion l’augmentait aussi sur Deep Research et sur toutes les autres tâches utilisant ce modèle. Chaque tâche garde maintenant le sien, et Fournisseurs fixe toujours la valeur par défaut du modèle.',
    de: 'Die Reasoning-Stufe gehört jetzt zu jeder Aufgabe. Sie bei Immersion anzuheben hob sie auch bei Deep Research und bei jeder anderen Aufgabe mit demselben Modell. Jede Aufgabe behält nun ihre eigene, und unter Anbieter legen Sie weiterhin die Vorgabe des Modells fest.',
    pt: 'O nível de raciocínio passa a ser de cada tarefa. Antes, subi-lo na Imersão subia-o também no Deep Research e em todas as outras que usassem esse modelo. Agora cada tarefa guarda o seu, e em Fornecedores continua a fixar a predefinição do modelo.',
    'pt-BR': 'O nível de raciocínio agora é de cada tarefa. Antes, aumentá-lo na Imersão aumentava também no Deep Research e em todas as outras que usassem esse modelo. Agora cada tarefa guarda o seu, e em Provedores você continua fixando o padrão do modelo.',
  },
  {
    scope: 'academic',
    es: 'Ese nivel manda también en los escaneos. La extracción, los resúmenes y la fusión lo ignoraban por completo y corrían siempre al nivel más barato dijera lo que dijera el selector. Si no eliges ninguno, siguen yendo sin razonamiento y exactamente igual de rápido.',
    en: 'That level now governs the scans too. Extraction, summaries and fusion ignored it entirely and always ran at the cheapest level, whatever the selector said. Choose none and they still run without reasoning, exactly as fast as before.',
    fr: 'Ce niveau gouverne désormais aussi les analyses. L’extraction, les résumés et la fusion l’ignoraient totalement et tournaient toujours au niveau le moins cher, quoi qu’affiche le sélecteur. Sans choix de votre part, elles tournent toujours sans raisonnement et tout aussi vite.',
    de: 'Diese Stufe bestimmt jetzt auch die Scans. Extraktion, Zusammenfassungen und Fusion ignorierten sie völlig und liefen immer auf der günstigsten Stufe, was der Auswahlfeld auch anzeigte. Wählen Sie keine, laufen sie weiterhin ohne Reasoning und genauso schnell.',
    pt: 'Esse nível manda também nas análises. A extração, os resumos e a fusão ignoravam-no por completo e corriam sempre no nível mais barato, dissesse o que dissesse o seletor. Se não escolher nenhum, continuam a correr sem raciocínio e exatamente à mesma velocidade.',
    'pt-BR': 'Esse nível manda também nas varreduras. A extração, os resumos e a fusão o ignoravam por completo e rodavam sempre no nível mais barato, dissesse o que dissesse o seletor. Se você não escolher nenhum, continuam rodando sem raciocínio e exatamente na mesma velocidade.',
  },
  {
    scope: 'academic',
    es: 'Ideas vuelve a consultar el vault cada vez que entras. Si un escaneo terminaba mientras estabas en otra sección, al volver podía enseñar durante mucho tiempo el recuento anterior. Ahora la primera carga siempre trae las ideas y el total actuales.',
    en: 'Ideas now checks the vault every time you enter. If a scan finished while you were in another section, returning could keep showing the previous count for a long time. The first load now always brings back the current ideas and total.',
    fr: 'Idées consulte désormais le coffre chaque fois que vous y entrez. Si une analyse finissait pendant que vous étiez ailleurs, le retour pouvait longtemps afficher l’ancien total. Le premier chargement récupère maintenant toujours les idées et le total actuels.',
    de: 'Ideen fragt den Tresor jetzt bei jedem Öffnen neu ab. Endete ein Scan in einem anderen Bereich, konnte nach der Rückkehr lange noch der alte Stand erscheinen. Der erste Ladevorgang holt nun immer die aktuellen Ideen und ihre richtige Anzahl.',
    pt: 'Ideias volta a consultar o cofre sempre que entra. Se uma análise terminasse enquanto estava noutra secção, ao regressar podia continuar a mostrar a contagem anterior durante muito tempo. O primeiro carregamento traz agora sempre as ideias e o total atuais.',
    'pt-BR': 'Ideias volta a consultar o cofre sempre que você entra. Se uma varredura terminasse enquanto você estava em outra seção, ao voltar podia continuar mostrando a contagem anterior por muito tempo. O primeiro carregamento agora sempre traz as ideias e o total atuais.',
  },
  {
    scope: 'nodi',
    es: 'Vaciar notificaciones funciona igual desde Nodi y desde la cabecera. Con una confirmación elimina la actividad reciente y descarta los avisos que ya estaban visibles, pero los avisos futuros pueden llegar. Las vistas previas de citas de la ventana flotante también dejan de quedarse cargando.',
    en: 'Clearing notifications now works the same from Nodi and from the header. After confirmation it removes recent activity and dismisses notices already on screen, while future notices can still arrive. Citation previews in the floating window also stop getting stuck on Loading.',
    fr: 'Vider les notifications fonctionne désormais de la même façon depuis Nodi et depuis l’en-tête. Après confirmation, l’activité récente disparaît et les annonces déjà visibles sont écartées, tandis que les futures peuvent encore arriver. Les aperçus de citations de la fenêtre flottante ne restent plus bloqués sur le chargement.',
    de: 'Benachrichtigungen lassen sich nun in Nodi und in der Kopfzeile auf dieselbe Weise leeren. Nach einer Bestätigung verschwinden letzte Aktivitäten und bereits sichtbare Hinweise, neue Hinweise können aber weiter ankommen. Zitatvorschauen im schwebenden Fenster bleiben außerdem nicht mehr beim Laden hängen.',
    pt: 'Limpar notificações funciona agora da mesma forma no Nodi e no cabeçalho. Depois de confirmar, remove a atividade recente e dispensa os avisos já visíveis, mas os avisos futuros continuam a poder chegar. As pré-visualizações de citações da janela flutuante também deixam de ficar presas no carregamento.',
    'pt-BR': 'Limpar notificações agora funciona da mesma forma no Nodi e no cabeçalho. Depois da confirmação, remove a atividade recente e dispensa os avisos já visíveis, mas avisos futuros ainda podem chegar. As prévias de citações da janela flutuante também deixam de ficar presas no carregamento.',
  },
  {
    scope: 'nodi',
    es: 'Nodi puede leer completos los informes de Deep Research y las inmersiones de la vista actual. Al seleccionar un pasaje aparece una barra para copiarlo, dejar un marcador persistente o preguntarle a Nodi con esas palabras ya citadas. Funciona tanto dentro de Nodus como en la ventana flotante.',
    en: 'Nodi can now read complete Deep Research reports and Immersion sessions from the current view. Selecting a passage opens a bar to copy it, leave a persistent bookmark, or ask Nodi with those words already quoted. It works inside Nodus and in the floating window.',
    fr: 'Nodi peut désormais lire en entier les rapports Deep Research et les immersions de la vue actuelle. Sélectionner un passage ouvre une barre pour le copier, poser un signet persistant ou interroger Nodi avec ces mots déjà cités. Cela fonctionne dans Nodus comme dans la fenêtre flottante.',
    de: 'Nodi kann jetzt vollständige Deep-Research-Berichte und Immersionen aus der aktuellen Ansicht lesen. Beim Markieren einer Passage erscheint eine Leiste zum Kopieren, für ein dauerhaftes Lesezeichen oder für eine Frage an Nodi mit dem bereits zitierten Text. Das funktioniert in Nodus und im schwebenden Fenster.',
    pt: 'O Nodi já pode ler por inteiro os relatórios de Deep Research e as imersões da vista atual. Ao selecionar uma passagem aparece uma barra para a copiar, deixar um marcador persistente ou perguntar ao Nodi com essas palavras já citadas. Funciona dentro do Nodus e na janela flutuante.',
    'pt-BR': 'O Nodi agora pode ler por inteiro os relatórios de Deep Research e as imersões da tela atual. Ao selecionar uma passagem aparece uma barra para copiá-la, deixar um marcador persistente ou perguntar ao Nodi com essas palavras já citadas. Funciona dentro do Nodus e na janela flutuante.',
  },
  {
    scope: 'academic',
    es: 'Autores estrena una vista de guardados junto a las fichas y la matriz. Puedes guardar a alguien desde su tarjeta o su dossier y encontrarlo allí incluso después de volver a escanear el vault. La búsqueda, los filtros, la exportación y el grafo siguen disponibles dentro de esa selección.',
    en: 'Authors gains a Saved view beside cards and the synthesis matrix. You can save someone from their card or dossier and find them there even after scanning the vault again. Search, filters, export, and graph navigation all remain available inside that selection.',
    fr: 'Auteurs gagne une vue Enregistrés à côté des fiches et de la matrice de synthèse. Vous pouvez enregistrer une personne depuis sa fiche ou son dossier et la retrouver même après une nouvelle analyse du coffre. La recherche, les filtres, l’exportation et le graphe restent disponibles dans cette sélection.',
    de: 'Autoren erhält neben Karten und Synthesematrix eine Ansicht Gespeichert. Sie können jemanden auf der Karte oder im Dossier speichern und auch nach einem erneuten Scan des Tresors dort wiederfinden. Suche, Filter, Export und Graphnavigation bleiben in dieser Auswahl verfügbar.',
    pt: 'Autores ganha uma vista de Guardados junto às fichas e à matriz de síntese. Pode guardar alguém a partir da ficha ou do dossiê e voltar a encontrá-lo mesmo depois de analisar novamente o cofre. A pesquisa, os filtros, a exportação e o grafo continuam disponíveis nessa seleção.',
    'pt-BR': 'Autores ganha uma tela de Salvos junto aos cartões e à matriz de síntese. Você pode salvar alguém pelo cartão ou dossiê e encontrá-lo ali mesmo depois de analisar novamente o cofre. A busca, os filtros, a exportação e o grafo continuam disponíveis nessa seleção.',
  },
  {
    scope: 'general',
    es: 'Novedades y la actualización dejan de gastar recursos después de presentarse. Las animaciones decorativas se detienen, el progreso de descarga se actualiza a un ritmo razonable y la ventana de actualización se desmonta al cerrarla. La antigua galería del móvil tampoco vuelve a aparecer en versiones posteriores.',
    en: 'What’s New and the updater stop spending resources after presenting themselves. Decorative animations settle, download progress updates at a sensible rate, and the update window unmounts when closed. The old mobile gallery also stays retired on later versions.',
    fr: 'Nouveautés et la mise à jour cessent de consommer des ressources après leur présentation. Les animations décoratives s’arrêtent, la progression du téléchargement suit un rythme raisonnable et la fenêtre de mise à jour se démonte à la fermeture. L’ancienne galerie mobile ne réapparaît pas non plus dans les versions suivantes.',
    de: 'Neuigkeiten und die Aktualisierung verbrauchen nach ihrer Anzeige keine weiteren Ressourcen. Dekorative Animationen enden, der Downloadfortschritt wird in vernünftigem Takt aktualisiert und das Aktualisierungsfenster wird beim Schließen entfernt. Auch die alte Mobilgalerie bleibt in späteren Versionen verschwunden.',
    pt: 'As Novidades e a atualização deixam de gastar recursos depois de se apresentarem. As animações decorativas param, o progresso da transferência atualiza-se a um ritmo razoável e a janela de atualização é desmontada ao fechar. A antiga galeria do telemóvel também não volta a aparecer em versões posteriores.',
    'pt-BR': 'As Novidades e a atualização deixam de gastar recursos depois de aparecerem. As animações decorativas param, o progresso do download é atualizado em um ritmo razoável e a janela de atualização é desmontada ao fechar. A antiga galeria do celular também não volta a aparecer em versões posteriores.',
  },
  {
    scope: 'mcp',
    es: 'Los asistentes conectados por MCP pueden consultar todas las capas de lectura del vault activo, aunque hayas cambiado de tipo de vault y el cliente conserve su catálogo anterior. También pueden enumerar los Deep Research guardados y abrir el contenido completo de cada informe. Las bibliotecas grandes se recorren por páginas sin chocar con el límite de respuesta.',
    en: 'Assistants connected through MCP can query every readable layer of the active vault, even after changing vault type when the client keeps an older catalogue. They can also list saved Deep Research reports and open the complete contents of each one. Large libraries are traversed page by page without hitting the response limit.',
    fr: 'Les assistants connectés par MCP peuvent consulter toutes les couches lisibles du coffre actif, même après un changement de type de coffre lorsque le client conserve un ancien catalogue. Ils peuvent aussi lister les rapports Deep Research enregistrés et ouvrir le contenu complet de chacun. Les grandes bibliothèques se parcourent page par page sans atteindre la limite de réponse.',
    de: 'Über MCP verbundene Assistenten können jede lesbare Ebene des aktiven Tresors abfragen, auch nach einem Wechsel des Tresortyps, wenn der Client einen älteren Katalog behält. Sie können gespeicherte Deep-Research-Berichte auflisten und jeden vollständig öffnen. Große Bibliotheken werden seitenweise durchlaufen, ohne das Antwortlimit zu erreichen.',
    pt: 'Os assistentes ligados por MCP podem consultar todas as camadas de leitura do cofre ativo, mesmo depois de mudar o tipo de cofre quando o cliente conserva um catálogo anterior. Também podem listar os Deep Research guardados e abrir o conteúdo completo de cada relatório. As bibliotecas grandes percorrem-se página a página sem atingir o limite de resposta.',
    'pt-BR': 'Os assistentes conectados por MCP podem consultar todas as camadas de leitura do cofre ativo, mesmo depois de mudar o tipo de cofre quando o cliente conserva um catálogo anterior. Também podem listar os Deep Research salvos e abrir o conteúdo completo de cada relatório. Bibliotecas grandes são percorridas página por página sem atingir o limite de resposta.',
  },
];

const RELEASE_3_2_5_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'academic',
    es: 'Los escaneos vuelven a crear ideas nuevas en corpus grandes. Al pasar de 9.999 ideas, Nodus ya no sabía numerar la siguiente y el análisis profundo de cada obra fallaba al final, cuando ya se había gastado todo el trabajo de IA. Un corpus que llevaba semanas sin crecer vuelve a crecer.',
    en: 'Scans can create new ideas again in large corpora. Past 9,999 ideas Nodus could no longer number the next one, and the deep analysis of every work failed at the very end, once all of the AI work had been spent. A corpus that had quietly stopped growing grows again.',
    fr: 'Les analyses créent de nouveau des idées dans les grands corpus. Au-delà de 9 999 idées, Nodus ne savait plus numéroter la suivante et l’analyse approfondie de chaque œuvre échouait tout à la fin, une fois tout le travail de l’IA dépensé. Un corpus qui avait cessé de grandir grandit à nouveau.',
    de: 'Scans legen in großen Korpora wieder neue Ideen an. Ab 9.999 Ideen konnte Nodus die nächste nicht mehr nummerieren, und die Tiefenanalyse jedes Werks scheiterte ganz am Ende, wenn die gesamte KI-Arbeit bereits verbraucht war. Ein Korpus, das still stehen geblieben war, wächst wieder.',
    pt: 'As análises voltam a criar ideias novas em corpora grandes. A partir de 9999 ideias, o Nodus já não sabia numerar a seguinte e a análise profunda de cada obra falhava mesmo no fim, quando já se tinha gasto todo o trabalho de IA. Um corpus que há semanas não crescia volta a crescer.',
    'pt-BR': 'As análises voltam a criar ideias novas em corpora grandes. A partir de 9999 ideias, o Nodus não sabia mais numerar a seguinte e a análise profunda de cada obra falhava bem no fim, quando já tinha gasto todo o trabalho de IA. Um corpus que havia semanas não crescia volta a crescer.',
  },
  {
    scope: 'academic',
    es: 'La cola de escaneo dice por qué ha fallado algo. Antes solo ponía «Fallido» y el motivo se quedaba en la consola de desarrollo, donde nadie iba a mirar. Ahora el estado de una obra fallida lleva el mensaje encima, sin salir de la barra.',
    en: 'The scan queue now says why something failed. It used to say only "Failed", with the reason left in the developer console, where nobody was going to look. The state of a failed work now carries the message on hover, without leaving the bar.',
    fr: 'La file d’analyse dit pourquoi quelque chose a échoué. Elle n’affichait que «Échec», la raison restant dans la console de développement, où personne n’allait regarder. L’état d’une œuvre en échec porte désormais le message au survol, sans quitter la barre.',
    de: 'Die Scan-Warteschlange sagt jetzt, warum etwas fehlgeschlagen ist. Vorher stand dort nur «Fehlgeschlagen», und der Grund blieb in der Entwicklerkonsole, wo niemand nachsehen würde. Der Status eines gescheiterten Werks trägt die Meldung nun beim Überfahren, ohne die Leiste zu verlassen.',
    pt: 'A fila de análise diz porque é que algo falhou. Antes mostrava apenas «Falhou» e o motivo ficava na consola de desenvolvimento, onde ninguém ia ver. O estado de uma obra falhada passa a trazer a mensagem por cima, sem sair da barra.',
    'pt-BR': 'A fila de análise diz por que algo falhou. Antes mostrava apenas «Falhou» e o motivo ficava no console de desenvolvimento, onde ninguém ia olhar. O estado de uma obra que falhou passa a trazer a mensagem por cima, sem sair da barra.',
  },
  {
    scope: 'general',
    es: 'El nivel de razonamiento se elige donde se elige el modelo. En Ajustes › Modelos, cada tarea que usa un modelo de Codex lleva su nivel al lado, de Bajo a Máximo. Menos razonamiento contesta antes, y en un escaneo largo esa diferencia se mide en horas.',
    en: 'The reasoning level is chosen where the model is chosen. In Settings › Models, every job running a Codex model now carries its level beside it, from Low to Max. Less reasoning answers sooner, and across a long scan that difference is measured in hours.',
    fr: 'Le niveau de raisonnement se choisit là où se choisit le modèle. Dans Paramètres › Modèles, chaque tâche qui utilise un modèle Codex porte son niveau à côté, de Bas à Maximum. Moins de raisonnement répond plus vite, et sur une longue analyse cet écart se compte en heures.',
    de: 'Die Reasoning-Stufe wird dort gewählt, wo das Modell gewählt wird. Unter Einstellungen › Modelle trägt jede Aufgabe mit einem Codex-Modell ihre Stufe daneben, von Niedrig bis Maximal. Weniger Reasoning antwortet schneller, und über einen langen Scan macht das Stunden aus.',
    pt: 'O nível de raciocínio escolhe-se onde se escolhe o modelo. Em Definições › Modelos, cada tarefa que usa um modelo Codex passa a ter o seu nível ao lado, de Baixo a Máximo. Menos raciocínio responde mais depressa, e numa análise longa essa diferença mede-se em horas.',
    'pt-BR': 'O nível de raciocínio é escolhido onde o modelo é escolhido. Em Configurações › Modelos, cada tarefa que usa um modelo Codex passa a ter seu nível ao lado, de Baixo a Máximo. Menos raciocínio responde mais rápido, e numa análise longa essa diferença se mede em horas.',
  },
  {
    scope: 'general',
    es: 'Ese nivel pertenece al modelo, no a la tarea. Elegirlo en Modelos o en Proveedores es elegir lo mismo, y todas las tareas que usen ese modelo lo leen igual. Si lo dejas en Predeterminado, sigue la recomendación del propio modelo aunque Codex la cambie.',
    en: 'That level belongs to the model, not to the job. Choosing it in Models or in Providers is the same choice, and every job running that model reads back the same value. Left on Default, it keeps following the model own recommendation even when Codex changes it.',
    fr: 'Ce niveau appartient au modèle, pas à la tâche. Le choisir dans Modèles ou dans Fournisseurs revient au même, et toutes les tâches qui utilisent ce modèle lisent la même valeur. Laissé sur Par défaut, il suit la recommandation du modèle lui-même, même si Codex la change.',
    de: 'Diese Stufe gehört zum Modell, nicht zur Aufgabe. Sie in Modelle oder in Anbieter zu wählen ist dieselbe Wahl, und jede Aufgabe mit diesem Modell liest denselben Wert zurück. Auf Standard belassen, folgt sie weiter der Empfehlung des Modells selbst, auch wenn Codex sie ändert.',
    pt: 'Esse nível pertence ao modelo, não à tarefa. Escolhê-lo em Modelos ou em Fornecedores é a mesma escolha, e todas as tarefas que usem esse modelo leem o mesmo valor. Deixado em Predefinido, continua a seguir a recomendação do próprio modelo mesmo que o Codex a mude.',
    'pt-BR': 'Esse nível pertence ao modelo, não à tarefa. Escolhê-lo em Modelos ou em Provedores é a mesma escolha, e todas as tarefas que usem esse modelo leem o mesmo valor. Deixado em Padrão, continua seguindo a recomendação do próprio modelo mesmo que o Codex a mude.',
  },
];

const RELEASE_3_2_4_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'general',
    es: 'Las notificaciones tienen su propio botón en la cabecera, justo antes de Ajustes. Abre las mismas dos listas que enseña Nodi: los avisos publicados por Nodus y lo que ha estado haciendo la aplicación. Funciona con la mascota desactivada, que era justo cuando no había forma de llegar a ellas.',
    en: 'Notifications now have their own button in the header, right before Settings. It opens the same two lists Nodi shows: the announcements published by Nodus and what the app has been doing. It works with the mascot turned off, which was exactly when there was no way to reach them.',
    fr: 'Les notifications ont désormais leur propre bouton dans l’en-tête, juste avant Paramètres. Il ouvre les deux mêmes listes que Nodi affiche: les annonces publiées par Nodus et ce que l’application a fait. Il fonctionne avec la mascotte désactivée, ce qui était justement le cas où rien n’y donnait accès.',
    de: 'Benachrichtigungen haben jetzt eine eigene Schaltfläche in der Kopfzeile, direkt vor Einstellungen. Sie öffnet dieselben zwei Listen, die Nodi zeigt: die von Nodus veröffentlichten Mitteilungen und das, was die App getan hat. Sie funktioniert auch bei abgeschalteter Maskottchenfigur, und genau dann kam man vorher gar nicht heran.',
    pt: 'As notificações passam a ter um botão próprio no cabeçalho, mesmo antes de Definições. Abre as mesmas duas listas que o Nodi mostra: os avisos publicados pelo Nodus e o que a aplicação tem andado a fazer. Funciona com a mascote desativada, que era precisamente quando não havia forma de lá chegar.',
    'pt-BR': 'As notificações agora têm um botão próprio no cabeçalho, logo antes de Configurações. Ele abre as mesmas duas listas que o Nodi mostra: os avisos publicados pelo Nodus e o que o aplicativo andou fazendo. Funciona com o mascote desativado, que era justamente quando não havia como chegar até elas.',
  },
  {
    scope: 'general',
    es: 'Nodus ya puede avisarte de algo entre una versión y la siguiente: una encuesta, un problema conocido, un cambio importante. Cada aviso llega en tu idioma, puede traer un enlace y sigue sin leer hasta que lo lees, uno a uno. Se desactiva en Ajustes, y al desactivarlo Nodus deja de pedirlo.',
    en: 'Nodus can now tell you something between one release and the next: a survey, a known problem, an important change. Each notice arrives in your language, may carry a link, and stays unread until you read it, one at a time. You can turn it off in Settings, and once it is off Nodus stops asking for it.',
    fr: 'Nodus peut désormais vous signaler quelque chose entre deux versions: une enquête, un problème connu, un changement important. Chaque annonce arrive dans votre langue, peut contenir un lien et reste non lue tant que vous ne l’avez pas lue, une par une. Elle se désactive dans les Paramètres, et Nodus cesse alors de la demander.',
    de: 'Nodus kann dir jetzt zwischen zwei Versionen etwas mitteilen: eine Umfrage, ein bekanntes Problem, eine wichtige Änderung. Jede Mitteilung kommt in deiner Sprache an, kann einen Link enthalten und bleibt ungelesen, bis du sie liest, eine nach der anderen. In den Einstellungen lässt sich das abschalten, und dann fragt Nodus gar nicht mehr danach.',
    pt: 'O Nodus já pode avisar-te de algo entre uma versão e a seguinte: um inquérito, um problema conhecido, uma alteração importante. Cada aviso chega no teu idioma, pode trazer uma ligação e continua por ler até o leres, um a um. Desativa-se nas Definições, e a partir daí o Nodus deixa de o pedir.',
    'pt-BR': 'O Nodus já pode avisar você de algo entre uma versão e a seguinte: uma pesquisa, um problema conhecido, uma mudança importante. Cada aviso chega no seu idioma, pode trazer um link e continua não lido até você lê-lo, um a um. Dá para desativar nas Configurações, e aí o Nodus para de pedir.',
  },
  {
    scope: 'general',
    es: 'La cabecera se queda con menos iconos. Bóvedas, Colecciones y Roadmap salen del extremo derecho. La bóveda activa se abre desde la insignia del centro, que ahora se ve en cualquier anchura de ventana. Colecciones vive en la paleta de comandos y el roadmap está en Ajustes, dentro de Acerca de Nodus.',
    en: 'The header keeps fewer icons. Vaults, Collections and Roadmap leave the right rail. The active vault opens from the badge in the centre, which is now shown at every window width. Collections lives in the command palette, and the roadmap is in Settings, under About Nodus.',
    fr: 'L’en-tête garde moins d’icônes. Coffres, Collections et Feuille de route quittent la barre de droite. Le coffre actif s’ouvre depuis le badge central, désormais visible quelle que soit la largeur de la fenêtre. Collections vit dans la palette de commandes et la feuille de route se trouve dans les Paramètres, sous À propos de Nodus.',
    de: 'Die Kopfzeile behält weniger Symbole. Tresore, Sammlungen und Roadmap verlassen die rechte Leiste. Der aktive Tresor öffnet sich über das Abzeichen in der Mitte, das jetzt bei jeder Fensterbreite sichtbar ist. Sammlungen liegt in der Befehlspalette, und die Roadmap steht in den Einstellungen unter Über Nodus.',
    pt: 'O cabeçalho fica com menos ícones. Cofres, Coleções e Roadmap saem da barra da direita. O cofre ativo abre a partir do emblema do centro, que passa a ver-se em qualquer largura de janela. Coleções vive na paleta de comandos e o roadmap está nas Definições, dentro de Acerca do Nodus.',
    'pt-BR': 'O cabeçalho fica com menos ícones. Cofres, Coleções e Roadmap saem da barra da direita. O cofre ativo abre pelo selo do centro, que agora aparece em qualquer largura de janela. Coleções vive na paleta de comandos e o roadmap está nas Configurações, dentro de Sobre o Nodus.',
  },
  {
    scope: 'general',
    es: 'La bandeja solo aparece cuando ha llegado algo desde otro dispositivo. En un equipo sin bóvedas conectadas era un icono permanentemente vacío al lado de otro que nunca lo está. Además, el botón de actualizar deja de mostrarse en las bóvedas de fuentes primarias, que no sincronizan con Zotero.',
    en: 'The inbox only appears once something has arrived from another device. On a machine with no connected vaults it was a permanently empty icon sitting next to one that never is. The refresh button also stops showing in primary-sources vaults, which do not sync with Zotero.',
    fr: 'La boîte de réception n’apparaît que lorsque quelque chose est arrivé d’un autre appareil. Sur une machine sans coffre connecté, c’était une icône vide en permanence à côté d’une autre qui ne l’est jamais. Le bouton d’actualisation disparaît aussi des coffres de sources primaires, qui ne se synchronisent pas avec Zotero.',
    de: 'Der Posteingang erscheint erst, wenn etwas von einem anderen Gerät angekommen ist. Auf einem Rechner ohne verbundene Tresore war er ein dauerhaft leeres Symbol neben einem, das es nie ist. Auch die Aktualisieren-Schaltfläche verschwindet aus Tresoren für Primärquellen, die sich nicht mit Zotero abgleichen.',
    pt: 'A caixa de entrada só aparece quando chegou algo de outro dispositivo. Num computador sem cofres ligados era um ícone permanentemente vazio ao lado de outro que nunca está. O botão de atualizar também deixa de aparecer nos cofres de fontes primárias, que não sincronizam com o Zotero.',
    'pt-BR': 'A caixa de entrada só aparece quando chegou algo de outro dispositivo. Em um computador sem cofres conectados era um ícone permanentemente vazio ao lado de outro que nunca está. O botão de atualizar também deixa de aparecer nos cofres de fontes primárias, que não sincronizam com o Zotero.',
  },
  {
    scope: 'general',
    es: 'Nodus ya dice dónde encontrarlo fuera de la aplicación. El modal de novedades y Ajustes, en Acerca de Nodus, llevan a Reddit, YouTube y X con el icono de cada red. Los enlaces se abren en tu navegador y la aplicación no envía nada a esas redes.',
    en: 'Nodus now says where to find it outside the application. The release modal and Settings, under About Nodus, lead to Reddit, YouTube and X with each network’s own icon. The links open in your browser and the application sends nothing to those networks.',
    fr: 'Nodus indique enfin où le trouver en dehors de l’application. Le modal des nouveautés et les Paramètres, dans À propos de Nodus, mènent à Reddit, YouTube et X avec l’icône de chaque réseau. Les liens s’ouvrent dans votre navigateur et l’application n’envoie rien à ces réseaux.',
    de: 'Nodus sagt jetzt, wo es außerhalb der Anwendung zu finden ist. Das Neuigkeiten-Fenster und die Einstellungen unter Über Nodus führen zu Reddit, YouTube und X mit dem Symbol des jeweiligen Netzwerks. Die Links öffnen sich in Ihrem Browser und die Anwendung sendet nichts an diese Netzwerke.',
    pt: 'O Nodus passa a dizer onde encontrá-lo fora da aplicação. O modal de novidades e as Definições, em Acerca do Nodus, levam ao Reddit, ao YouTube e ao X com o ícone de cada rede. As ligações abrem no seu navegador e a aplicação não envia nada para essas redes.',
    'pt-BR': 'O Nodus agora diz onde encontrá-lo fora do aplicativo. O modal de novidades e as Configurações, em Sobre o Nodus, levam ao Reddit, ao YouTube e ao X com o ícone de cada rede. Os links abrem no seu navegador e o aplicativo não envia nada para essas redes.',
  },
  {
    scope: 'general',
    es: 'Nodus enseña cómo se ve en el móvil. Una galería que aparece una sola vez recorre nueve pantallas de la aplicación para el teléfono, cuenta qué hace ya y qué todavía no, y enlaza una encuesta corta sobre si la quieres. Las capturas y el formulario están en inglés, y la propia galería lo advierte.',
    en: 'Nodus shows what it looks like on a phone. A gallery that appears once walks through nine screens of the mobile app, says what it already does and what it does not do yet, and links to a short survey about whether you want it. The screenshots and the form are in English, and the gallery says so.',
    fr: 'Nodus montre à quoi il ressemble sur un téléphone. Une galerie qui n’apparaît qu’une fois parcourt neuf écrans de l’application mobile, dit ce qu’elle fait déjà et ce qu’elle ne fait pas encore, et renvoie vers un court sondage sur votre envie de l’avoir. Les captures et le formulaire sont en anglais, et la galerie le précise.',
    de: 'Nodus zeigt, wie es auf einem Telefon aussieht. Eine Galerie, die einmal erscheint, führt durch neun Bildschirme der mobilen App, sagt, was sie schon kann und was noch nicht, und verweist auf eine kurze Umfrage dazu, ob Sie sie haben wollen. Die Aufnahmen und das Formular sind auf Englisch, und die Galerie sagt das auch.',
    pt: 'O Nodus mostra o aspeto que tem num telemóvel. Uma galeria que aparece uma única vez percorre nove ecrãs da aplicação para o telefone, diz o que já faz e o que ainda não faz, e liga a um inquérito curto sobre se a quer. As capturas e o formulário estão em inglês, e a própria galeria avisa.',
    'pt-BR': 'O Nodus mostra como ele fica no celular. Uma galeria que aparece uma única vez percorre nove telas do aplicativo para o telefone, diz o que ele já faz e o que ainda não faz, e leva a uma pesquisa curta sobre se você o quer. As capturas e o formulário estão em inglês, e a própria galeria avisa.',
  },
  {
    scope: 'general',
    es: 'Leer un informe en el móvil cambia en tres cosas. Selecciona un pasaje y pregunta por él: las palabras entran en la conversación de ese informe como cita. Marcador y Preguntar van ahora los primeros del menú de selección, antes que Copiar. Una fuente se abre en el instante en que se pulsa, y las citas que habían dejado de responder vuelven a abrirse.',
    en: 'Reading a report on the phone changes in three ways. Select a passage and ask about it, and the words enter that report’s conversation as a quotation. Bookmark and Ask now come first in the selection menu, ahead of Copy. A source opens the instant it is pressed, and citations that had stopped responding open again.',
    fr: 'Lire un rapport sur le téléphone change de trois façons. Sélectionnez un passage et posez une question à son sujet: les mots entrent dans la conversation de ce rapport sous forme de citation. Marque-page et Demander passent en tête du menu de sélection, avant Copier. Une source s’ouvre à l’instant où on la presse, et les citations qui ne répondaient plus s’ouvrent de nouveau.',
    de: 'Das Lesen eines Berichts am Telefon ändert sich in drei Punkten. Wählen Sie eine Passage aus und fragen Sie danach, und die Worte gehen als Zitat in das Gespräch zu diesem Bericht. Lesezeichen und Fragen stehen jetzt vorn im Auswahlmenü, vor Kopieren. Eine Quelle öffnet sich in dem Augenblick, in dem man sie drückt, und Zitate, die nicht mehr reagierten, öffnen wieder.',
    pt: 'Ler um relatório no telemóvel muda em três pontos. Selecione uma passagem e pergunte sobre ela: as palavras entram na conversa desse relatório como citação. Marcador e Perguntar passam a vir primeiro no menu de seleção, antes de Copiar. Uma fonte abre no instante em que é premida, e as citações que tinham deixado de responder voltam a abrir.',
    'pt-BR': 'Ler um relatório no celular muda em três pontos. Selecione um trecho e pergunte sobre ele: as palavras entram na conversa daquele relatório como citação. Marcador e Perguntar agora vêm primeiro no menu de seleção, antes de Copiar. Uma fonte abre no instante em que é tocada, e as citações que tinham parado de responder voltam a abrir.',
  },
  {
    scope: 'general',
    es: 'El motor de IA local de Nodus deja de contestar en la dirección equivocada cuando ya estaba en marcha. La petición que arrancaba el servidor llegaba a la interfaz buena, las que lo encontraban encendido no, y de ahí salían vectores vacíos sin ningún aviso. Ahora las dos rutas leen la misma dirección y hay una prueba que las mantiene juntas.',
    en: 'The local AI engine in Nodus stops answering at the wrong address once it is already running. The request that started the server reached the right interface, the ones that found it running did not, and that is where empty vectors came from, with nothing said about it. Both paths now read the same address, and a test keeps them together.',
    fr: 'Le moteur d’IA locale de Nodus cesse de répondre à la mauvaise adresse quand il tourne déjà. La requête qui démarrait le serveur atteignait la bonne interface, celles qui le trouvaient allumé non, et c’est de là que venaient des vecteurs vides, sans le moindre avertissement. Les deux chemins lisent désormais la même adresse, et un test les garde ensemble.',
    de: 'Die lokale KI-Engine von Nodus antwortet nicht mehr an der falschen Adresse, wenn sie schon läuft. Die Anfrage, die den Server startete, erreichte die richtige Schnittstelle, die folgenden nicht, und daher kamen leere Vektoren, ohne dass etwas dazu gesagt wurde. Beide Wege lesen jetzt dieselbe Adresse, und ein Test hält sie zusammen.',
    pt: 'O motor de IA local do Nodus deixa de responder no endereço errado quando já estava a correr. O pedido que arrancava o servidor chegava à interface certa, os que o encontravam ligado não, e era daí que vinham vetores vazios, sem aviso nenhum. Agora os dois caminhos leem o mesmo endereço, e há um teste que os mantém juntos.',
    'pt-BR': 'O motor de IA local do Nodus deixa de responder no endereço errado quando já estava rodando. O pedido que iniciava o servidor chegava à interface certa, os que o encontravam ligado não, e era daí que vinham vetores vazios, sem aviso nenhum. Agora os dois caminhos leem o mesmo endereço, e um teste os mantém juntos.',
  },
  {
    scope: 'general',
    es: 'Los botones que llegaban sin su icono ya lo tienen. Un nombre que el juego de iconos no tiene no dibuja nada, así que el botón se colocaba y se pulsaba enseñando un hueco, como le pasaba a Siguiente en Huecos al lado de un Anterior que sí tenía flecha. Doce nombres repartidos por veintiséis sitios vuelven a estar dibujados, y una prueba rechaza cualquier icono que no exista.',
    en: 'Buttons that were arriving without their icon now have one. A name the icon set does not have draws nothing, so the button laid out and clicked while showing a gap, as Next did in Gaps beside a Previous that had its arrow. Twelve names across twenty-six places are drawn again, and a test refuses any icon that does not exist.',
    fr: 'Les boutons qui arrivaient sans leur icône en ont une. Un nom que le jeu d’icônes ne possède pas ne dessine rien, si bien que le bouton se plaçait et se cliquait en montrant un vide, comme Suivant dans Lacunes à côté d’un Précédent qui avait sa flèche. Douze noms répartis sur vingt-six endroits sont de nouveau dessinés, et un test refuse toute icône inexistante.',
    de: 'Schaltflächen, die ohne ihr Symbol ankamen, haben jetzt eines. Ein Name, den der Symbolsatz nicht hat, zeichnet gar nichts, also lag die Schaltfläche da und ließ sich anklicken, zeigte aber eine Lücke, wie Weiter in Lücken neben einem Zurück mit Pfeil. Zwölf Namen an sechsundzwanzig Stellen sind wieder gezeichnet, und ein Test weist jedes Symbol zurück, das es nicht gibt.',
    pt: 'Os botões que chegavam sem o seu ícone passam a tê-lo. Um nome que o conjunto de ícones não tem não desenha nada, por isso o botão ficava colocado e clicável a mostrar um espaço vazio, como acontecia a Seguinte em Lacunas ao lado de um Anterior que tinha seta. Doze nomes espalhados por vinte e seis sítios voltam a estar desenhados, e um teste recusa qualquer ícone que não exista.',
    'pt-BR': 'Os botões que chegavam sem o seu ícone agora o têm. Um nome que o conjunto de ícones não tem não desenha nada, então o botão ficava posicionado e clicável mostrando um espaço vazio, como acontecia com Próximo em Lacunas ao lado de um Anterior que tinha seta. Doze nomes espalhados por vinte e seis lugares voltam a ser desenhados, e um teste recusa qualquer ícone que não exista.',
  },
  {
    scope: 'academic',
    es: 'Un vault académico abre con menos secciones. Huecos pasa a ser una pestaña dentro de Cobertura, porque un hueco solo significa algo mirando qué le falta a tu pregunta. Hipótesis y Ruta de lectura quedan ocultas de entrada, ya que con un corpus recién sincronizado respondían con ruido. Las dos vuelven desde Ajustes.',
    en: 'An academic vault opens with fewer sections. Gaps becomes a tab inside Coverage, because a gap only means something when you are looking at what your own question is missing. Hypotheses and Reading path start hidden, since on a freshly synced corpus they answered with noise. Both come back from Settings.',
    fr: 'Un coffre académique s’ouvre avec moins de sections. Lacunes devient un onglet dans Couverture, car une lacune n’a de sens que face à ce qui manque à votre propre question. Hypothèses et Parcours de lecture sont masqués au départ, car sur un corpus fraîchement synchronisé ils répondaient par du bruit. Les deux reviennent depuis les Paramètres.',
    de: 'Ein akademischer Tresor öffnet mit weniger Abschnitten. Lücken wird zu einem Reiter innerhalb von Abdeckung, denn eine Lücke bedeutet nur etwas im Blick darauf, was der eigenen Frage fehlt. Hypothesen und Lesepfad sind anfangs ausgeblendet, da sie bei einem frisch synchronisierten Korpus mit Rauschen antworteten. Beide kommen über die Einstellungen zurück.',
    pt: 'Um cofre académico abre com menos secções. Lacunas passa a ser um separador dentro de Cobertura, porque uma lacuna só significa algo olhando para o que falta à sua pergunta. Hipóteses e Percurso de leitura ficam ocultos à partida, já que num corpus acabado de sincronizar respondiam com ruído. Ambos voltam a partir das Definições.',
    'pt-BR': 'Um cofre acadêmico abre com menos seções. Lacunas passa a ser uma aba dentro de Cobertura, porque uma lacuna só significa algo olhando para o que falta à sua pergunta. Hipóteses e Caminho de leitura começam ocultos, já que em um corpus recém-sincronizado respondiam com ruído. Os dois voltam pelas Configurações.',
  },
];

/**
 * 4.1.3 — 4.1.2 taught the lists to remember where you left them. This one teaches the
 * three sections you stay inside to reopen the thing you had open, and a report to
 * reopen at the paragraph you had reached. Short sentences, no semicolons, no em dashes.
 */
const RELEASE_4_1_3_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'general',
    es: 'Las secciones donde se lee vuelven a abrirse por dentro. Deep Research, Inmersión y las pestañas de la Biblioteca recuperan el informe, la inmersión o el documento que tenías abierto, además de la búsqueda y el orden de la lista. Una inmersión vuelve al paso en el que la dejaste. Lo que estabas escribiendo no se restaura, porque eso es trabajo y no un sitio.',
    en: 'The sections you read inside now reopen inside. Deep Research, Immersion and the Library tabs bring back the report, the immersion or the document you had open, along with the search and ordering of the list. An immersion returns to the step you left it on. What you were writing is not restored, because that is work and not a place.',
    fr: 'Les sections où l’on lit se rouvrent de l’intérieur. Deep Research, Immersion et les onglets de la Bibliothèque retrouvent le rapport, l’immersion ou le document que vous aviez ouvert, ainsi que la recherche et le tri de la liste. Une immersion revient à l’étape où vous l’aviez laissée. Ce que vous étiez en train d’écrire n’est pas restauré, car c’est du travail et non un endroit.',
    de: 'Die Bereiche, in denen gelesen wird, öffnen sich wieder von innen. Deep Research, Immersion und die Reiter der Bibliothek holen den Bericht, die Immersion oder das Dokument zurück, das Sie offen hatten, dazu die Suche und die Sortierung der Liste. Eine Immersion kehrt zu dem Schritt zurück, an dem Sie sie verlassen haben. Was Sie gerade geschrieben haben, wird nicht wiederhergestellt, denn das ist Arbeit und kein Ort.',
    pt: 'As secções onde se lê voltam a abrir por dentro. Deep Research, Imersão e os separadores da Biblioteca recuperam o relatório, a imersão ou o documento que tinha aberto, além da pesquisa e da ordem da lista. Uma imersão volta ao passo em que a deixou. O que estava a escrever não é reposto, porque isso é trabalho e não um sítio.',
    'pt-BR': 'As seções onde se lê voltam a abrir por dentro. Deep Research, Imersão e as abas da Biblioteca recuperam o relatório, a imersão ou o documento que você tinha aberto, além da busca e da ordem da lista. Uma imersão volta ao passo em que você a deixou. O que você estava escrevendo não é restaurado, porque isso é trabalho e não um lugar.',
  },
  {
    scope: 'general',
    es: 'Un informe se abre por donde ibas leyendo. Nodus guarda qué bloque tenías arriba del todo en lugar de una posición en píxeles, así que cambiar el ancho de la ventana o la tipografía ya no lo mueve. El sitio se conserva mientras el informe termina de crecer y deja de tocarse en cuanto tocas la rueda o el teclado. Si habías aplicado una traducción, el sitio se descarta en vez de aproximarse, porque esa es otra maquetación.',
    en: 'A report reopens where you had got to. Nodus stores which block was under the top edge instead of a pixel position, so changing the window width or the font no longer moves it. The place is held while the report finishes growing and is let go the moment you touch the wheel or the keyboard. If you had applied a translation, the place is dropped rather than approximated, because that is a different rendering.',
    fr: 'Un rapport se rouvre là où vous en étiez. Nodus enregistre quel bloc se trouvait tout en haut plutôt qu’une position en pixels, si bien que changer la largeur de la fenêtre ou la police ne le déplace plus. La place est maintenue pendant que le rapport finit de grandir et elle est relâchée dès que vous touchez la molette ou le clavier. Si vous aviez appliqué une traduction, la place est abandonnée au lieu d’être approchée, car c’est une autre mise en page.',
    de: 'Ein Bericht öffnet wieder dort, wo Sie waren. Nodus speichert, welcher Block unter der oberen Kante stand, statt einer Pixelposition, sodass eine andere Fensterbreite oder Schrift ihn nicht mehr verschiebt. Die Stelle wird gehalten, während der Bericht zu Ende wächst, und losgelassen, sobald Sie Rad oder Tastatur berühren. Hatten Sie eine Übersetzung angewendet, wird die Stelle verworfen statt angenähert, denn das ist ein anderer Satz.',
    pt: 'Um relatório abre por onde ia a ler. O Nodus guarda que bloco estava no topo em vez de uma posição em píxeis, por isso mudar a largura da janela ou a tipografia já não o move. O lugar mantém-se enquanto o relatório acaba de crescer e é largado assim que toca na roda ou no teclado. Se tinha aplicado uma tradução, o lugar é descartado em vez de aproximado, porque essa é outra composição.',
    'pt-BR': 'Um relatório abre onde você parou de ler. O Nodus guarda qual bloco estava no topo em vez de uma posição em pixels, então mudar a largura da janela ou a fonte já não o move. O lugar se mantém enquanto o relatório termina de crescer e é solto assim que você toca na roda ou no teclado. Se você tinha aplicado uma tradução, o lugar é descartado em vez de aproximado, porque essa é outra composição.',
  },
];

/**
 * 4.2.3 — Clearer Deep Research reading, trustworthy authorship and citations,
 * and small but visible Browser and wiki repairs.
 */
const RELEASE_4_2_3_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'academic',
    es: 'Deep Research estrena una lectura a pantalla completa con una columna de informe más ancha. Una barra fina muestra cuánto has leído y el encabezado reaparece al volver hacia arriba. Las fuentes se adaptan mejor a la altura disponible y cada autor citado abre su ficha directamente.',
    en: 'Deep Research gains a full-screen reading view with a wider report column. A slim bar shows how far you have read and the header returns when you move back up. Sources fit the available height better and every cited author opens their dossier directly.',
    fr: 'Deep Research propose une lecture en plein écran avec une colonne de rapport plus large. Une barre fine indique votre progression et l’en-tête réapparaît lorsque vous remontez. Les sources s’adaptent mieux à la hauteur disponible et chaque auteur cité ouvre directement sa fiche.',
    de: 'Deep Research erhält eine Vollbild-Leseansicht mit einer breiteren Berichtsspalte. Eine schmale Leiste zeigt den Lesefortschritt und die Kopfzeile kehrt beim Hochscrollen zurück. Quellen nutzen die verfügbare Höhe besser und jeder zitierte Autor öffnet direkt sein Dossier.',
    pt: 'O Deep Research ganha uma leitura em ecrã inteiro com uma coluna de relatório mais larga. Uma barra fina mostra quanto já leu e o cabeçalho reaparece ao voltar para cima. As fontes adaptam-se melhor à altura disponível e cada autor citado abre diretamente a respetiva ficha.',
    'pt-BR': 'O Deep Research ganha uma leitura em tela cheia com uma coluna de relatório mais larga. Uma barra fina mostra quanto você já leu e o cabeçalho reaparece ao voltar para cima. As fontes se adaptam melhor à altura disponível e cada autor citado abre diretamente o respectivo dossiê.',
  },
  {
    scope: 'academic',
    es: 'Las citas de los informes vuelven a comprobarse contra el corpus cada vez que los abres. Si la autoría o el año de una obra se corrigieron después de generar el informe, Nodus actualiza las citas, la matriz y la bibliografía al mostrarlas sin alterar el informe guardado.',
    en: 'Report citations are checked against the corpus each time you open them. If a work’s authorship or year was corrected after the report was generated, Nodus refreshes its citations, matrix and bibliography as they are displayed without changing the saved report.',
    fr: 'Les citations des rapports sont vérifiées dans le corpus à chaque ouverture. Si l’auteur ou l’année d’une œuvre a été corrigé après la création du rapport, Nodus actualise les citations, la matrice et la bibliographie à l’affichage sans modifier le rapport enregistré.',
    de: 'Berichtszitate werden bei jedem Öffnen mit dem Korpus abgeglichen. Wenn Urheberschaft oder Jahr eines Werks nach der Berichtserstellung korrigiert wurden, aktualisiert Nodus Zitate, Matrix und Literaturverzeichnis bei der Anzeige, ohne den gespeicherten Bericht zu verändern.',
    pt: 'As citações dos relatórios são verificadas no corpus sempre que os abre. Se a autoria ou o ano de uma obra foram corrigidos depois de gerar o relatório, o Nodus atualiza as citações, a matriz e a bibliografia ao apresentá-las sem alterar o relatório guardado.',
    'pt-BR': 'As citações dos relatórios são verificadas no corpus sempre que você os abre. Se a autoria ou o ano de uma obra foram corrigidos depois da geração, o Nodus atualiza as citações, a matriz e a bibliografia ao exibi-las sem alterar o relatório salvo.',
  },
  {
    scope: 'academic',
    es: 'Autores y editores ya no se confunden. Los capítulos atribuyen sus ideas a quien los escribió, los volúmenes sin autor pueden aparecer bajo su editor con una marca provisional y las fichas separan obras escritas de obras editadas. Al actualizar, Nodus repara también las firmas ya guardadas.',
    en: 'Authors and editors are no longer confused. Chapters credit their ideas to the people who wrote them, authorless volumes can appear under an editor with a provisional marker, and dossiers separate authored from edited works. On update, Nodus also repairs bylines already stored in the vault.',
    fr: 'Auteurs et éditeurs ne sont plus confondus. Les chapitres attribuent leurs idées à la personne qui les a écrits, les volumes sans auteur peuvent apparaître sous leur éditeur avec une mention provisoire et les fiches séparent les œuvres écrites des œuvres dirigées. La mise à jour répare aussi les signatures déjà enregistrées.',
    de: 'Autoren und Herausgeber werden nicht mehr verwechselt. Kapitel schreiben ihre Ideen den Verfassern zu, Bände ohne Autor können mit einer vorläufigen Markierung beim Herausgeber erscheinen und Dossiers trennen verfasste von herausgegebenen Werken. Beim Update repariert Nodus auch bereits gespeicherte Verfasserzeilen.',
    pt: 'Autores e editores deixam de ser confundidos. Os capítulos atribuem as ideias a quem os escreveu, os volumes sem autor podem aparecer sob o editor com uma marca provisória e as fichas separam obras escritas de obras editadas. Ao atualizar, o Nodus também repara as autorias já guardadas.',
    'pt-BR': 'Autores e editores não são mais confundidos. Os capítulos atribuem as ideias a quem os escreveu, os volumes sem autor podem aparecer sob o editor com uma marca provisória e os dossiês separam obras escritas de obras editadas. Na atualização, o Nodus também repara as autorias já salvas.',
  },
  {
    scope: 'browser',
    es: 'Nodus Browser trata mejor el inicio de sesión con Google. Lo detiene antes de la página de bloqueo, explica que debe completarse en el navegador del sistema y conserva el sitio de origen para que puedas continuar allí. Al cerrar el aviso recuperas la página anterior o el inicio de Nodus, y Atrás vuelve correctamente a Marcadores o Research Atlas.',
    en: 'Nodus Browser handles Google sign-in more clearly. It stops before the block page, explains that sign-in must finish in the system browser and keeps the originating site so you can continue there. Dismissing the notice restores the previous page or Nodus start page, and Back now returns correctly to Bookmarks or Research Atlas.',
    fr: 'Le navigateur Nodus gère plus clairement la connexion Google. Il s’arrête avant la page de blocage, explique que la connexion doit se terminer dans le navigateur système et conserve le site d’origine pour y poursuivre. Fermer l’avis rétablit la page précédente ou l’accueil de Nodus, et Retour ramène correctement aux Signets ou à Research Atlas.',
    de: 'Nodus Browser behandelt die Google-Anmeldung verständlicher. Er stoppt vor der Sperrseite, erklärt den Abschluss im Systembrowser und merkt sich die Ausgangsseite, damit Sie dort fortfahren können. Beim Schließen des Hinweises kehrt die vorherige Seite oder die Nodus-Startseite zurück, und Zurück führt korrekt zu Lesezeichen oder Research Atlas.',
    pt: 'O Nodus Browser trata o início de sessão com o Google de forma mais clara. Interrompe antes da página de bloqueio, explica que deve terminar no navegador do sistema e conserva o site de origem para continuar aí. Fechar o aviso repõe a página anterior ou o início do Nodus, e Voltar regressa corretamente aos Marcadores ou ao Research Atlas.',
    'pt-BR': 'O Nodus Browser trata o login com o Google de forma mais clara. Ele para antes da página de bloqueio, explica que o processo deve terminar no navegador do sistema e preserva o site de origem para você continuar lá. Fechar o aviso restaura a página anterior ou o início do Nodus, e Voltar retorna corretamente aos Favoritos ou ao Research Atlas.',
  },
  {
    scope: 'general',
    es: 'La wiki integrada vuelve a sentirse parte de Nodus. Sus barras laterales ya no forman bloques de otro color y ahora comparten el fondo del contenido central tanto dentro de la aplicación como en la web, también al cambiar entre tema claro y oscuro.',
    en: 'The integrated wiki feels like part of Nodus again. Its sidebars no longer form blocks in a different colour and now share the central content background both inside the app and on the web, including when switching between light and dark themes.',
    fr: 'Le wiki intégré retrouve sa place dans Nodus. Ses barres latérales ne forment plus des blocs d’une autre couleur et partagent désormais le fond du contenu central dans l’application comme sur le web, y compris lors du passage entre les thèmes clair et sombre.',
    de: 'Das integrierte Wiki wirkt wieder wie ein Teil von Nodus. Seine Seitenleisten bilden keine andersfarbigen Blöcke mehr und teilen nun in der App und im Web den Hintergrund des Hauptinhalts, auch beim Wechsel zwischen hellem und dunklem Design.',
    pt: 'A wiki integrada volta a parecer parte do Nodus. As barras laterais deixam de formar blocos de outra cor e passam a partilhar o fundo do conteúdo central tanto na aplicação como na web, também ao alternar entre os temas claro e escuro.',
    'pt-BR': 'A wiki integrada volta a parecer parte do Nodus. As barras laterais não formam mais blocos de outra cor e agora compartilham o fundo do conteúdo central tanto no aplicativo quanto na web, inclusive ao alternar entre os temas claro e escuro.',
  },
];

/**
 * 4.2.2 — Browser search, stable transitions and source workspace polish.
 */
const RELEASE_4_2_2_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'browser',
    es: 'Nodus Browser ahora busca dentro de la página. Pulsa Cmd o Ctrl más F para abrir la barra, escribe y recorre las coincidencias con Enter o con los botones Anterior y Siguiente. La lupa entre Marcadores e Historial abre el mismo panel y la búsqueda puede distinguir mayúsculas.',
    en: 'Nodus Browser now searches inside the page. Press Cmd or Ctrl plus F to open the bar, type and move between matches with Enter or the Previous and Next buttons. The magnifying glass between Bookmarks and History opens the same panel and the search can be case-sensitive.',
    fr: 'Le navigateur Nodus cherche désormais dans la page. Appuyez sur Cmd ou Ctrl plus F pour ouvrir la barre, saisissez votre terme et naviguez entre les occurrences avec Entrée ou les boutons Précédent et Suivant. La loupe entre Signets et Historique ouvre le même panneau et la recherche peut respecter la casse.',
    de: 'Nodus Browser sucht jetzt innerhalb der Seite. Drücken Sie Cmd oder Strg plus F, um die Leiste zu öffnen, tippen Sie und wechseln Sie mit Enter oder den Schaltflächen Zurück und Weiter zwischen den Treffern. Die Lupe zwischen Lesezeichen und Verlauf öffnet dasselbe Panel und die Suche kann Groß- und Kleinschreibung beachten.',
    pt: 'O Nodus Browser agora procura dentro da página. Prima Cmd ou Ctrl mais F para abrir a barra, escreva e percorra as ocorrências com Enter ou com os botões Anterior e Seguinte. A lupa entre Marcadores e Histórico abre o mesmo painel e a pesquisa pode distinguir maiúsculas.',
    'pt-BR': 'O Nodus Browser agora busca dentro da página. Pressione Cmd ou Ctrl mais F para abrir a barra, digite e navegue entre as ocorrências com Enter ou com os botões Anterior e Seguinte. A lupa entre Favoritos e Histórico abre o mesmo painel e a busca pode diferenciar maiúsculas.',
  },
  {
    scope: 'browser',
    es: 'Cerrar la última pestaña ya no deja el navegador vacío ni abre dos páginas de inicio. La pestaña de inicio se recupera automáticamente y el selector de bóvedas aparece delante desde el primer instante. Al pasar del navegador a Ajustes ya no se superpone la página que estaba abierta.',
    en: 'Closing the last tab no longer leaves the browser empty or opens two home pages. The home tab is restored automatically and the vault switcher appears in front from the first instant. Moving from the browser to Settings no longer leaves the previous page over the new section.',
    fr: 'Fermer le dernier onglet ne laisse plus le navigateur vide et n’ouvre plus deux pages d’accueil. L’onglet d’accueil est rétabli automatiquement et le sélecteur de coffres apparaît devant dès le premier instant. Le passage du navigateur aux Paramètres ne laisse plus l’ancienne page recouvrir la nouvelle section.',
    de: 'Das Schließen des letzten Tabs lässt den Browser nicht mehr leer und öffnet nicht mehr zwei Startseiten. Der Start-Tab wird automatisch wiederhergestellt und der Tresor-Umschalter erscheint vom ersten Moment an im Vordergrund. Beim Wechsel vom Browser zu den Einstellungen bleibt die vorherige Seite nicht mehr über dem neuen Bereich liegen.',
    pt: 'Fechar o último separador já não deixa o navegador vazio nem abre duas páginas iniciais. O separador inicial é recuperado automaticamente e o seletor de cofres aparece à frente desde o primeiro instante. Ao passar do navegador para as Definições, a página anterior já não fica sobreposta à nova secção.',
    'pt-BR': 'Fechar a última aba já não deixa o navegador vazio nem abre duas páginas iniciais. A aba inicial é recuperada automaticamente e o seletor de cofres aparece na frente desde o primeiro instante. Ao passar do navegador para as Configurações, a página anterior não fica mais sobre a nova seção.',
  },
  {
    scope: 'academic',
    es: 'El modal de fuentes de Deep Research e Inmersión vuelve a desplazarse. La ventana mantiene un tamaño fijo, no salta al cambiar de pestaña y en el tema claro ya no hereda el fondo oscuro. Las pestañas conservan su estado al moverte entre ideas, obras y autores.',
    en: 'The sources modal in Deep Research and Immersion scrolls again. The window keeps a fixed size, does not jump when switching tabs and no longer inherits the dark background in light theme. Tabs keep their state when moving between ideas, works and authors.',
    fr: 'La fenêtre des sources de Deep Research et Immersion défile à nouveau. La fenêtre conserve une taille fixe, ne saute plus lors du changement d’onglet et n’hérite plus du fond sombre en thème clair. Les onglets conservent leur état lors du passage entre idées, œuvres et auteurs.',
    de: 'Das Quellen-Modal in Deep Research und Immersion lässt sich wieder scrollen. Das Fenster behält eine feste Größe, springt beim Tab-Wechsel nicht mehr und übernimmt im hellen Design nicht mehr den dunklen Hintergrund. Tabs behalten ihren Zustand beim Wechsel zwischen Ideen, Werken und Autoren.',
    pt: 'O modal de fontes do Deep Research e da Imersão volta a deslocar-se. A janela mantém um tamanho fixo, não salta ao mudar de separador e no tema claro já não herda o fundo escuro. Os separadores mantêm o seu estado ao mover-se entre ideias, obras e autores.',
    'pt-BR': 'O modal de fontes do Deep Research e da Imersão volta a rolar. A janela mantém um tamanho fixo, não pula ao trocar de aba e no tema claro não herda mais o fundo escuro. As abas mantêm seu estado ao navegar entre ideias, obras e autores.',
  },
  {
    scope: 'browser',
    es: 'Google no admite iniciar sesión desde un navegador integrado como Nodus Browser. Nodus ahora detiene esos intentos antes de la pantalla de bloqueo, explica la limitación y permite abrir el sitio en el navegador del sistema. Esa sesión externa no se comparte con Nodus.',
    en: 'Google does not allow sign-in from an embedded browser such as Nodus Browser. Nodus now stops those attempts before the block page, explains the limitation and lets you open the site in the system browser. That external session is not shared with Nodus.',
    fr: 'Google n’autorise pas la connexion depuis un navigateur intégré tel que Nodus Browser. Nodus interrompt désormais ces tentatives avant la page de blocage, explique la limitation et permet d’ouvrir le site dans le navigateur système. Cette session externe n’est pas partagée avec Nodus.',
    de: 'Google erlaubt keine Anmeldung aus einem eingebetteten Browser wie Nodus Browser. Nodus stoppt solche Versuche jetzt vor der Sperrseite, erklärt die Einschränkung und ermöglicht das Öffnen der Website im Systembrowser. Diese externe Sitzung wird nicht mit Nodus geteilt.',
    pt: 'O Google não permite iniciar sessão a partir de um navegador integrado como o Nodus Browser. O Nodus interrompe agora essas tentativas antes da página de bloqueio, explica a limitação e permite abrir o site no navegador do sistema. Essa sessão externa não é partilhada com o Nodus.',
    'pt-BR': 'O Google não permite fazer login em um navegador integrado como o Nodus Browser. O Nodus agora interrompe essas tentativas antes da página de bloqueio, explica a limitação e permite abrir o site no navegador do sistema. Essa sessão externa não é compartilhada com o Nodus.',
  },
];

/**
 * 4.2.0 — Browser and Radar become first-class research surfaces, while databases,
 * Deep Research, reading, Nodi and large backup restores gain substantial new workflows.
 */
const RELEASE_4_2_0_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'browser',
    es: 'Nodus Browser llega como navegador de investigación integrado y seguro con varias pestañas, descargas, controles multimedia y permisos por sitio. Incluye Research Atlas, marcadores e historial locales, acciones de Nodi sobre páginas y selecciones, y captura directa de referencias y PDF en la Biblioteca mediante Nodus Connector.',
    en: 'Nodus Browser arrives as a secure, integrated research browser with multiple tabs, downloads, media controls and per-site permissions. It includes Research Atlas, local bookmarks and history, Nodi actions for pages and selections, and direct capture of references and PDFs into the Library through Nodus Connector.',
    fr: 'Nodus Browser devient un navigateur de recherche intégré et sécurisé avec plusieurs onglets, des téléchargements, des commandes multimédias et des autorisations par site. Il comprend Research Atlas, des favoris et un historique locaux, des actions de Nodi sur les pages et les sélections, ainsi que la capture directe de références et de PDF dans la Bibliothèque grâce à Nodus Connector.',
    de: 'Nodus Browser ist ein integrierter und sicherer Forschungsbrowser mit mehreren Tabs, Downloads, Mediensteuerung und Berechtigungen pro Website. Er umfasst Research Atlas, lokale Lesezeichen und einen lokalen Verlauf, Nodi-Aktionen für Seiten und Textauswahlen sowie die direkte Übernahme von Referenzen und PDFs in die Bibliothek über Nodus Connector.',
    pt: 'O Nodus Browser chega como navegador de investigação integrado e seguro, com vários separadores, transferências, controlos multimédia e permissões por site. Inclui o Research Atlas, marcadores e histórico locais, ações do Nodi sobre páginas e seleções e a captura direta de referências e PDF para a Biblioteca através do Nodus Connector.',
    'pt-BR': 'O Nodus Browser chega como navegador de pesquisa integrado e seguro, com várias abas, downloads, controles de mídia e permissões por site. Inclui o Research Atlas, favoritos e histórico locais, ações do Nodi sobre páginas e seleções e a captura direta de referências e PDFs na Biblioteca por meio do Nodus Connector.',
  },
  {
    scope: 'radar',
    es: 'Puedes seguir temas, búsquedas, autores, revistas, artículos, fuentes RSS y sitios web con revisiones diarias o semanales. Las novedades se reúnen en una bandeja global, llegan al centro de notificaciones y a Nodi, y pueden abrirse o guardarse directamente en la Biblioteca.',
    en: 'You can follow topics, searches, authors, journals, papers, RSS feeds and websites with daily or weekly checks. Updates gather in a global inbox, reach the notification centre and Nodi, and can be opened or saved directly to the Library.',
    fr: 'Vous pouvez suivre des sujets, des recherches, des auteurs, des revues, des articles, des flux RSS et des sites web avec des vérifications quotidiennes ou hebdomadaires. Les nouveautés se rassemblent dans une boîte de réception globale, arrivent dans le centre de notifications et auprès de Nodi, et peuvent être ouvertes ou enregistrées directement dans la Bibliothèque.',
    de: 'Sie können Themen, Suchanfragen, Autoren, Zeitschriften, Aufsätze, RSS-Feeds und Websites mit täglichen oder wöchentlichen Prüfungen verfolgen. Neuigkeiten sammeln sich in einem globalen Posteingang, erreichen die Benachrichtigungszentrale und Nodi und lassen sich direkt öffnen oder in der Bibliothek speichern.',
    pt: 'Pode seguir temas, pesquisas, autores, revistas, artigos, fontes RSS e sites com verificações diárias ou semanais. As novidades reúnem-se numa caixa de entrada global, chegam ao centro de notificações e ao Nodi e podem ser abertas ou guardadas diretamente na Biblioteca.',
    'pt-BR': 'Você pode acompanhar temas, pesquisas, autores, periódicos, artigos, feeds RSS e sites com verificações diárias ou semanais. As novidades se reúnem em uma caixa de entrada global, chegam à central de notificações e ao Nodi e podem ser abertas ou salvas diretamente na Biblioteca.',
  },
  {
    scope: 'databases',
    es: 'Las Bases de datos estrenan páginas y bloques, propiedades avanzadas, fórmulas, relaciones, rollups, plantillas, tareas, automatizaciones, formularios, comentarios, historial y permisos. La búsqueda y las vistas virtualizadas mantienen la fluidez incluso con cientos de miles de filas, y la importación desde Notion es mucho más fiel.',
    en: 'Databases gain pages and blocks, advanced properties, formulas, relations, rollups, templates, tasks, automations, forms, comments, history and permissions. Search and virtualized views stay responsive even with hundreds of thousands of rows, and importing from Notion is much more faithful.',
    fr: 'Les Bases de données accueillent des pages et des blocs, des propriétés avancées, des formules, des relations, des agrégations, des modèles, des tâches, des automatisations, des formulaires, des commentaires, un historique et des autorisations. La recherche et les vues virtualisées restent fluides même avec des centaines de milliers de lignes, et l’importation depuis Notion est bien plus fidèle.',
    de: 'Datenbanken erhalten Seiten und Blöcke, erweiterte Eigenschaften, Formeln, Beziehungen, Rollups, Vorlagen, Aufgaben, Automatisierungen, Formulare, Kommentare, Verlauf und Berechtigungen. Suche und virtualisierte Ansichten bleiben auch bei Hunderttausenden von Zeilen flüssig, und der Import aus Notion ist deutlich originalgetreuer.',
    pt: 'As Bases de dados passam a ter páginas e blocos, propriedades avançadas, fórmulas, relações, rollups, modelos, tarefas, automatizações, formulários, comentários, histórico e permissões. A pesquisa e as vistas virtualizadas mantêm-se fluidas mesmo com centenas de milhares de linhas, e a importação do Notion é muito mais fiel.',
    'pt-BR': 'Os Bancos de dados ganham páginas e blocos, propriedades avançadas, fórmulas, relações, rollups, modelos, tarefas, automações, formulários, comentários, histórico e permissões. A busca e as visualizações virtualizadas continuam fluidas mesmo com centenas de milhares de linhas, e a importação do Notion é muito mais fiel.',
  },
  {
    scope: 'academic',
    es: 'Deep Research permite elegir entre investigación general, revisión de la literatura, estado de la cuestión, debate académico, análisis comparativo, análisis cronológico y síntesis conceptual o teórica. Cada opción adapta la búsqueda, la planificación y la redacción al objetivo, y el informe conserva el enfoque y el modelo utilizados.',
    en: 'Deep Research lets you choose general research, literature review, state of the art, scholarly debate, comparative analysis, chronological analysis or conceptual and theoretical synthesis. Each option adapts retrieval, planning and writing to the goal, and the report keeps the approach and model used to create it.',
    fr: 'Deep Research permet de choisir entre recherche générale, revue de la littérature, état de l’art, débat scientifique, analyse comparative, analyse chronologique et synthèse conceptuelle ou théorique. Chaque option adapte la recherche documentaire, la planification et la rédaction à l’objectif, et le rapport conserve l’approche et le modèle utilisés.',
    de: 'Deep Research bietet allgemeine Forschung, Literaturübersicht, Forschungsstand, wissenschaftliche Debatte, vergleichende Analyse, chronologische Analyse und begriffliche oder theoretische Synthese. Jede Option passt Recherche, Planung und Ausarbeitung an das Ziel an, und der Bericht bewahrt den verwendeten Ansatz und das verwendete Modell.',
    pt: 'O Deep Research permite escolher entre investigação geral, revisão da literatura, estado da arte, debate académico, análise comparativa, análise cronológica e síntese conceptual ou teórica. Cada opção adapta a pesquisa, o planeamento e a redação ao objetivo, e o relatório conserva a abordagem e o modelo utilizados.',
    'pt-BR': 'O Deep Research permite escolher entre pesquisa geral, revisão da literatura, estado da arte, debate acadêmico, análise comparativa, análise cronológica e síntese conceitual ou teórica. Cada opção adapta a busca, o planejamento e a redação ao objetivo, e o relatório preserva a abordagem e o modelo utilizados.',
  },
  {
    scope: 'academic',
    es: 'Deep Research e Inmersión comparten un sistema completo de subrayados, comentarios y marcadores persistentes. El nuevo espacio de fuentes permite explorar ideas, autores y obras en pestañas sin abandonar el informe, y abrir las referencias disponibles en Zotero o en la Biblioteca de Nodus.',
    en: 'Deep Research and Immersion now share a complete system of persistent highlights, comments and bookmarks. The new source workspace lets you explore ideas, authors and works in tabs without leaving the report, and open available references in Zotero or the Nodus Library.',
    fr: 'Deep Research et Immersion partagent désormais un système complet de surlignages, de commentaires et de signets persistants. Le nouvel espace des sources permet d’explorer des idées, des auteurs et des œuvres dans des onglets sans quitter le rapport, et d’ouvrir les références disponibles dans Zotero ou dans la Bibliothèque de Nodus.',
    de: 'Deep Research und Immersion teilen jetzt ein vollständiges System für dauerhafte Hervorhebungen, Kommentare und Lesezeichen. Im neuen Quellenbereich können Sie Ideen, Autoren und Werke in Tabs erkunden, ohne den Bericht zu verlassen, und verfügbare Referenzen in Zotero oder der Nodus-Bibliothek öffnen.',
    pt: 'O Deep Research e a Imersão partilham agora um sistema completo de realces, comentários e marcadores persistentes. O novo espaço de fontes permite explorar ideias, autores e obras em separadores sem sair do relatório e abrir as referências disponíveis no Zotero ou na Biblioteca do Nodus.',
    'pt-BR': 'O Deep Research e a Imersão agora compartilham um sistema completo de destaques, comentários e marcadores persistentes. O novo espaço de fontes permite explorar ideias, autores e obras em abas sem sair do relatório e abrir as referências disponíveis no Zotero ou na Biblioteca do Nodus.',
  },
  {
    scope: 'general',
    es: 'Puedes mantener abiertos varios autores, ideas y mapas argumentales para compararlos sin que una selección sustituya a la anterior. Las búsquedas ya no fallan cuando encuentran registros importados con metadatos incompletos.',
    en: 'You can keep several authors, ideas and argument maps open for comparison without each selection replacing the previous one. Searches no longer fail when they encounter imported records with incomplete metadata.',
    fr: 'Vous pouvez garder plusieurs auteurs, idées et cartes argumentatives ouverts afin de les comparer sans que chaque sélection remplace la précédente. Les recherches n’échouent plus lorsqu’elles rencontrent des fiches importées dont les métadonnées sont incomplètes.',
    de: 'Sie können mehrere Autoren, Ideen und Argumentkarten zum Vergleichen geöffnet halten, ohne dass jede Auswahl die vorherige ersetzt. Suchvorgänge schlagen nicht mehr fehl, wenn sie auf importierte Einträge mit unvollständigen Metadaten treffen.',
    pt: 'Pode manter vários autores, ideias e mapas argumentativos abertos para os comparar sem que cada seleção substitua a anterior. As pesquisas já não falham quando encontram registos importados com metadados incompletos.',
    'pt-BR': 'Você pode manter vários autores, ideias e mapas argumentativos abertos para compará-los sem que cada seleção substitua a anterior. As buscas não falham mais quando encontram registros importados com metadados incompletos.',
  },
  {
    scope: 'academic',
    es: 'Las acciones principales de cada registro están ahora disponibles en la cabecera de la Biblioteca Global, sin necesidad de desplazarse. El editor de metadatos es más claro y revelar un adjunto en Finder funciona de forma fiable desde cualquiera de sus accesos.',
    en: 'The main actions for each record are now available in the Global Library header without scrolling. The metadata editor is clearer, and revealing an attachment in Finder works reliably from either place that offers the action.',
    fr: 'Les actions principales de chaque fiche sont désormais disponibles dans l’en-tête de la Bibliothèque globale sans avoir à faire défiler la page. L’éditeur de métadonnées est plus clair, et afficher une pièce jointe dans le Finder fonctionne de manière fiable depuis chacun des accès proposés.',
    de: 'Die wichtigsten Aktionen für jeden Eintrag stehen jetzt ohne Scrollen in der Kopfzeile der Globalen Bibliothek bereit. Der Metadateneditor ist übersichtlicher, und das Anzeigen eines Anhangs im Finder funktioniert an beiden Stellen, die diese Aktion anbieten, zuverlässig.',
    pt: 'As ações principais de cada registo estão agora disponíveis no cabeçalho da Biblioteca Global, sem ser necessário deslocar a página. O editor de metadados é mais claro, e revelar um anexo no Finder funciona de forma fiável a partir de qualquer um dos acessos.',
    'pt-BR': 'As principais ações de cada registro agora ficam disponíveis no cabeçalho da Biblioteca Global, sem necessidade de rolar a página. O editor de metadados está mais claro, e revelar um anexo no Finder funciona de forma confiável em qualquer um dos acessos.',
  },
  {
    scope: 'nodi',
    es: 'El tamaño original de Nodi es ahora el máximo y puedes reducirlo hasta el 40 % para ajustarlo a tu escritorio. Cuando una respuesta llega progresivamente, el chat ya no te arrastra al final y permite leer desde el principio.',
    en: 'Nodi’s original size is now the maximum, and you can reduce it to 40% to fit your desktop. When an answer streams in, the chat no longer pulls you to the bottom and lets you read from the beginning.',
    fr: 'La taille d’origine de Nodi est désormais le maximum, et vous pouvez la réduire jusqu’à 40 % pour l’adapter à votre bureau. Lorsqu’une réponse arrive progressivement, le chat ne vous entraîne plus vers le bas et vous permet de lire depuis le début.',
    de: 'Nodis ursprüngliche Größe ist jetzt das Maximum, und Sie können ihn für Ihren Desktop bis auf 40 % verkleinern. Wenn eine Antwort schrittweise eintrifft, zieht der Chat Sie nicht mehr nach unten und lässt Sie von Anfang an lesen.',
    pt: 'O tamanho original do Nodi passa a ser o máximo, e pode reduzi-lo até 40% para o adaptar ao seu ambiente de trabalho. Quando uma resposta chega progressivamente, o chat já não o arrasta para o fim e permite ler desde o início.',
    'pt-BR': 'O tamanho original do Nodi agora é o máximo, e você pode reduzi-lo até 40% para ajustá-lo à sua área de trabalho. Quando uma resposta chega progressivamente, o chat não arrasta mais você para o fim e permite ler desde o começo.',
  },
  {
    scope: 'general',
    es: 'Las copias de seguridad de gran tamaño se restauran usando mucha menos memoria. La pantalla muestra el progreso real durante el descifrado, la verificación y la extracción, manteniendo la copia de seguridad previa y el mecanismo de recuperación.',
    en: 'Large backups now restore with much less memory. The screen shows real progress during decryption, verification and extraction while preserving the pre-restore safety snapshot and the existing recovery mechanism.',
    fr: 'Les sauvegardes volumineuses sont désormais restaurées avec beaucoup moins de mémoire. L’écran affiche la progression réelle pendant le déchiffrement, la vérification et l’extraction, tout en conservant la copie de sécurité préalable et le mécanisme de récupération existant.',
    de: 'Große Sicherungen werden jetzt mit deutlich weniger Speicher wiederhergestellt. Der Bildschirm zeigt den tatsächlichen Fortschritt beim Entschlüsseln, Prüfen und Extrahieren, während die vorherige Sicherheitskopie und der bestehende Wiederherstellungsmechanismus erhalten bleiben.',
    pt: 'As cópias de segurança de grande dimensão passam a ser restauradas com muito menos memória. O ecrã mostra o progresso real durante a desencriptação, a verificação e a extração, mantendo a cópia de segurança anterior e o mecanismo de recuperação existente.',
    'pt-BR': 'Backups grandes agora são restaurados usando muito menos memória. A tela mostra o progresso real durante a descriptografia, a verificação e a extração, preservando a cópia de segurança anterior e o mecanismo de recuperação existente.',
  },
];

/**
 * 4.1.6 — the Zotero import finishes what it started, and the two reading galleries
 * stop forgetting how they were set and stop flashing on the way back in.
 */
const RELEASE_4_1_6_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'academic',
    es: 'La importación de Zotero vuelve a copiar los adjuntos. Catalogaba todos los documentos y se paraba justo antes de copiar el primero, así que terminaba con cero adjuntos y un fallo por biblioteca en todos los intentos, también al reanudar. Ahora recorre la biblioteca entera y trae las notas y los archivos. Cuando algo falla, el aviso da el motivo real en lugar de decir siempre que Zotero no está disponible.',
    en: 'The Zotero import copies attachments again. It catalogued every document and then stopped just before copying the first one, so it ended with zero attachments and one failure per library on every attempt, Resume included. It now walks the whole library and brings the notes and the files across. When something does fail, the message gives the real reason instead of always saying that Zotero is unavailable.',
    fr: 'L’importation Zotero copie de nouveau les pièces jointes. Elle cataloguait tous les documents puis s’arrêtait juste avant de copier la première, terminant donc avec zéro pièce jointe et un échec par bibliothèque à chaque tentative, reprises comprises. Elle parcourt désormais toute la bibliothèque et rapporte les notes et les fichiers. En cas d’échec, le message donne la vraie raison au lieu de toujours dire que Zotero n’est pas disponible.',
    de: 'Der Zotero-Import kopiert wieder die Anhänge. Er katalogisierte jedes Dokument und hielt dann kurz vor dem ersten Kopiervorgang an, endete also bei jedem Versuch mit null Anhängen und einem Fehler pro Bibliothek, auch beim Fortsetzen. Jetzt durchläuft er die gesamte Bibliothek und holt Notizen und Dateien herüber. Schlägt doch etwas fehl, nennt die Meldung den wirklichen Grund, statt immer zu sagen, Zotero sei nicht verfügbar.',
    pt: 'A importação do Zotero volta a copiar os anexos. Catalogava todos os documentos e parava mesmo antes de copiar o primeiro, por isso terminava com zero anexos e uma falha por biblioteca em todas as tentativas, incluindo ao retomar. Agora percorre a biblioteca inteira e traz as notas e os ficheiros. Quando algo falha, o aviso dá o motivo real em vez de dizer sempre que o Zotero não está disponível.',
    'pt-BR': 'A importação do Zotero volta a copiar os anexos. Ela catalogava todos os documentos e parava logo antes de copiar o primeiro, então terminava com zero anexos e uma falha por biblioteca em todas as tentativas, inclusive ao retomar. Agora ela percorre a biblioteca inteira e traz as notas e os arquivos. Quando algo falha, o aviso dá o motivo real em vez de dizer sempre que o Zotero não está disponível.',
  },
  {
    scope: 'academic',
    es: 'La segunda sincronización con Zotero ya no aborta. En cuanto una importación terminaba bien, la siguiente se detenía antes de leer un solo elemento diciendo que la biblioteca ya no existe, porque Nodus preguntaba por los elementos eliminados a un servicio que la aplicación de Zotero no ofrece. A cambio, lo que borres en Zotero no desaparece del catálogo local hasta que rehagas la importación completa. Y el aviso de sincronización interrumpida deja de quedarse fijo: antes bastaba un fallo antiguo para que una importación posterior, aunque terminara limpia, se presentara como interrumpida.',
    en: 'The second Zotero sync no longer aborts. As soon as one import finished cleanly, the next one stopped before reading a single item and said the library no longer exists, because Nodus asked for deleted items from a service the Zotero application does not offer. The cost is that whatever you delete in Zotero stays in the local catalogue until you run a full import again. The interrupted sync banner also stops sticking around: one old failure used to be enough for a later import to present itself as interrupted even when it finished cleanly.',
    fr: 'La deuxième synchronisation Zotero ne s’interrompt plus. Dès qu’une importation se terminait correctement, la suivante s’arrêtait avant de lire le moindre élément en annonçant que la bibliothèque n’existe plus, car Nodus demandait les éléments supprimés à un service que l’application Zotero ne propose pas. En contrepartie, ce que vous supprimez dans Zotero reste dans le catalogue local jusqu’à une nouvelle importation complète. Le bandeau de synchronisation interrompue cesse aussi de rester affiché : un seul échec ancien suffisait pour qu’une importation ultérieure se présente comme interrompue, même terminée proprement.',
    de: 'Die zweite Zotero-Synchronisierung bricht nicht mehr ab. Sobald ein Import sauber durchgelaufen war, hielt der nächste an, bevor er ein einziges Element gelesen hatte, und meldete, die Bibliothek existiere nicht mehr, weil Nodus die gelöschten Einträge bei einem Dienst abfragte, den die Zotero-Anwendung nicht anbietet. Der Preis dafür ist, dass in Zotero Gelöschtes im lokalen Katalog bleibt, bis Sie einen vollständigen Import wiederholen. Auch der Hinweis auf eine unterbrochene Synchronisierung bleibt nicht mehr hängen: Ein einziger alter Fehler genügte, damit ein späterer Import sich als unterbrochen ausgab, obwohl er sauber endete.',
    pt: 'A segunda sincronização com o Zotero já não aborta. Assim que uma importação terminava bem, a seguinte parava antes de ler um único elemento e dizia que a biblioteca já não existe, porque o Nodus pedia os elementos eliminados a um serviço que a aplicação do Zotero não oferece. Em troca, o que apagar no Zotero fica no catálogo local até refazer a importação completa. O aviso de sincronização interrompida também deixa de ficar fixo: bastava uma falha antiga para que uma importação posterior se apresentasse como interrompida, mesmo terminando limpa.',
    'pt-BR': 'A segunda sincronização com o Zotero já não aborta. Assim que uma importação terminava bem, a seguinte parava antes de ler um único item e dizia que a biblioteca não existe mais, porque o Nodus pedia os itens excluídos a um serviço que o aplicativo do Zotero não oferece. Em troca, o que você excluir no Zotero fica no catálogo local até refazer a importação completa. O aviso de sincronização interrompida também deixa de ficar fixo: bastava uma falha antiga para que uma importação posterior se apresentasse como interrompida, mesmo terminando limpa.',
  },
  {
    scope: 'general',
    es: 'Las galerías recuerdan cómo las dejaste. El orden, el filtro de leídos y la elección entre cuadrícula y lista se guardan por bóveda y siguen ahí en el siguiente arranque, tanto en Deep Research como en las unidades de docencia y en Inmersión. La búsqueda escrita y el informe abierto siguen sin conservarse entre sesiones, porque son un momento y no una preferencia.',
    en: 'The galleries remember how you left them. The ordering, the read filter and the choice between grid and list are stored per vault and are still there on the next launch, in Deep Research as well as in the teaching units and in Immersion. The typed search and the open report are still not kept between runs, because they are a moment rather than a preference.',
    fr: 'Les galeries se souviennent de la manière dont vous les avez laissées. Le tri, le filtre de lecture et le choix entre grille et liste sont enregistrés par coffre et sont encore là au lancement suivant, aussi bien dans Deep Research que dans les unités d’enseignement et dans Immersion. La recherche saisie et le rapport ouvert ne sont toujours pas conservés d’une session à l’autre, car ils relèvent de l’instant et non de la préférence.',
    de: 'Die Galerien merken sich, wie Sie sie verlassen haben. Die Sortierung, der Gelesen-Filter und die Wahl zwischen Raster und Liste werden pro Tresor gespeichert und sind beim nächsten Start noch da, in Deep Research ebenso wie in den Unterrichtseinheiten und in der Immersion. Die eingegebene Suche und der geöffnete Bericht werden weiterhin nicht über Sitzungen hinweg bewahrt, denn sie sind ein Moment und keine Vorliebe.',
    pt: 'As galerias lembram-se de como as deixou. A ordenação, o filtro de lidos e a escolha entre grelha e lista ficam guardadas por cofre e continuam lá no arranque seguinte, tanto no Deep Research como nas unidades de ensino e na Imersão. A pesquisa escrita e o relatório aberto continuam a não ser conservados entre sessões, porque são um momento e não uma preferência.',
    'pt-BR': 'As galerias lembram como você as deixou. A ordenação, o filtro de lidos e a escolha entre grade e lista ficam salvas por cofre e continuam lá na próxima inicialização, tanto no Deep Research quanto nas unidades de ensino e na Imersão. A busca digitada e o relatório aberto continuam sem ser guardados entre sessões, porque são um momento e não uma preferência.',
  },
  {
    scope: 'general',
    es: 'Volver a un informe o a una inmersión abiertos ya no pasa por la galería. Al salir de la sección y regresar, Nodus tenía que releer el elemento antes de poder dibujarlo, y mientras tanto pintaba la lista, como si la aplicación se abriera y pulsara ella sola sobre tu informe. Ahora el panel espera en silencio y solo muestra un indicador si la espera se alarga. Una sesión que ya no existe termina en la galería en vez de dejar el panel vacío.',
    en: 'Returning to an open report or immersion no longer goes through the gallery. Leaving the section and coming back meant reading the item again before it could be drawn, and what was drawn meanwhile was the list, as if the app were opening it and clicking your report by itself. The pane now waits quietly and only shows a spinner if the wait grows. A session that no longer exists lands on the gallery instead of leaving the pane empty.',
    fr: 'Revenir à un rapport ou à une immersion ouverts ne passe plus par la galerie. Quitter la section puis y retourner obligeait à relire l’élément avant de pouvoir l’afficher, et ce qui s’affichait entre-temps était la liste, comme si l’application l’ouvrait et cliquait toute seule sur votre rapport. Le volet attend désormais en silence et n’affiche un indicateur que si l’attente se prolonge. Une session qui n’existe plus aboutit à la galerie au lieu de laisser le volet vide.',
    de: 'Die Rückkehr zu einem geöffneten Bericht oder einer Immersion führt nicht mehr über die Galerie. Beim Verlassen des Bereichs und der Rückkehr musste der Eintrag erst erneut gelesen werden, bevor er gezeichnet werden konnte, und gezeichnet wurde derweil die Liste, als würde die App sie öffnen und von selbst auf Ihren Bericht klicken. Der Bereich wartet jetzt still und zeigt nur dann eine Anzeige, wenn das Warten länger dauert. Eine Sitzung, die es nicht mehr gibt, landet in der Galerie, statt den Bereich leer zu lassen.',
    pt: 'Voltar a um relatório ou a uma imersão abertos já não passa pela galeria. Ao sair da secção e regressar, o elemento tinha de ser lido outra vez antes de poder ser desenhado, e o que aparecia entretanto era a lista, como se a aplicação a abrisse e carregasse sozinha no seu relatório. O painel espera agora em silêncio e só mostra um indicador se a espera se prolongar. Uma sessão que já não existe acaba na galeria em vez de deixar o painel vazio.',
    'pt-BR': 'Voltar a um relatório ou a uma imersão abertos já não passa pela galeria. Ao sair da seção e voltar, o item precisava ser lido de novo antes de poder ser desenhado, e o que aparecia enquanto isso era a lista, como se o aplicativo a abrisse e clicasse sozinho no seu relatório. O painel agora espera em silêncio e só mostra um indicador se a espera se alongar. Uma sessão que já não existe termina na galeria em vez de deixar o painel vazio.',
  },
  {
    scope: 'estudio',
    es: 'El título de la vista de organización de estudio y docencia ya se traduce. Con la interfaz en otro idioma, el encabezado seguía leyéndose «Cursos y asignaturas» en español entre un antetítulo y una ruta que sí estaban traducidos. Ahora los tres títulos posibles salen en los ocho idiomas de la interfaz.',
    en: 'The heading of the study and teaching organisation view is now translated. With the interface in another language it still read «Cursos y asignaturas» in Spanish, between an eyebrow and a breadcrumb that were translated. All three possible headings now appear in the eight interface languages.',
    fr: 'Le titre de la vue d’organisation des études et de l’enseignement est désormais traduit. Avec l’interface dans une autre langue, il affichait encore « Cursos y asignaturas » en espagnol, entre un surtitre et un fil d’Ariane qui, eux, étaient traduits. Les trois titres possibles apparaissent maintenant dans les huit langues de l’interface.',
    de: 'Die Überschrift der Organisationsansicht von Studium und Unterricht wird jetzt übersetzt. Mit der Oberfläche in einer anderen Sprache stand dort weiterhin „Cursos y asignaturas“ auf Spanisch, zwischen einer Dachzeile und einem Pfad, die übersetzt waren. Alle drei möglichen Überschriften erscheinen nun in den acht Sprachen der Oberfläche.',
    pt: 'O título da vista de organização de estudo e ensino passa a estar traduzido. Com a interface noutro idioma, o cabeçalho continuava a ler-se «Cursos y asignaturas» em espanhol, entre um antetítulo e um caminho que estavam traduzidos. Os três títulos possíveis aparecem agora nos oito idiomas da interface.',
    'pt-BR': 'O título da visão de organização de estudo e ensino agora é traduzido. Com a interface em outro idioma, o cabeçalho continuava aparecendo como «Cursos y asignaturas» em espanhol, entre um antetítulo e um caminho que estavam traduzidos. Os três títulos possíveis agora saem nos oito idiomas da interface.',
  },
];

/**
 * 4.1.5 — the selection ribbon lands where the hand left it, and the two remaining
 * places that stopped the window while it thought stop doing it.
 */
const RELEASE_4_1_5_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'general',
    es: 'La cinta de opciones aparece ahora donde soltaste el ratón. Antes se colocaba sobre la primera línea de la selección, así que arrastrar un párrafo de arriba abajo la dejaba lejos de donde estabas mirando. También espera a que sueltes en lugar de seguir a la selección mientras crece. Si seleccionas con el teclado, la cinta sigue al cursor. Vale igual para el lector y para los editores de notas del espacio de trabajo, de estudio y de docencia.',
    en: 'The options ribbon now appears where you released the pointer. It used to sit above the first line of the selection, so dragging a paragraph downwards left it far from where you were looking. It also waits for you to let go instead of following the selection as it grows. A selection made with the keyboard follows the caret instead. This applies to the reader and to the note editors in the workspace, study and teaching.',
    fr: 'Le ruban d’options apparaît désormais là où vous avez relâché le pointeur. Il se plaçait avant au-dessus de la première ligne de la sélection, si bien que faire glisser un paragraphe vers le bas le laissait loin de votre regard. Il attend aussi que vous relâchiez au lieu de suivre la sélection pendant qu’elle grandit. Une sélection faite au clavier suit le curseur de texte. Cela vaut pour le lecteur comme pour les éditeurs de notes de l’espace de travail, des études et de l’enseignement.',
    de: 'Das Optionsband erscheint jetzt dort, wo Sie den Zeiger losgelassen haben. Früher saß es über der ersten Zeile der Auswahl, sodass es beim Ziehen eines Absatzes nach unten weit weg von Ihrem Blick lag. Es wartet außerdem auf das Loslassen, statt der wachsenden Auswahl zu folgen. Eine mit der Tastatur getroffene Auswahl folgt stattdessen der Schreibmarke. Das gilt für den Reader ebenso wie für die Notizeditoren in Arbeitsbereich, Studium und Unterricht.',
    pt: 'A fita de opções aparece agora onde largou o rato. Antes ficava sobre a primeira linha da seleção, por isso arrastar um parágrafo de cima para baixo deixava-a longe de onde estava a olhar. Também espera que largue, em vez de seguir a seleção enquanto ela cresce. Se selecionar com o teclado, a fita segue o cursor de texto. Vale tanto para o leitor como para os editores de notas do espaço de trabalho, do estudo e do ensino.',
    'pt-BR': 'A faixa de opções aparece agora onde você soltou o mouse. Antes ela ficava sobre a primeira linha da seleção, então arrastar um parágrafo de cima para baixo a deixava longe de onde você estava olhando. Ela também espera você soltar, em vez de seguir a seleção enquanto cresce. Se você selecionar com o teclado, a faixa segue o cursor de texto. Vale tanto para o leitor quanto para os editores de notas do espaço de trabalho, do estudo e do ensino.',
  },
  {
    scope: 'academic',
    es: 'Al pulsar un subrayado guardado vuelve a abrirse la cinta completa. Antes solo ofrecía borrarlo. Ahora tienes los colores, el comentario, copiar, el marcador y citar en Nodi, con el color que ya tiene marcado y la papelera al final. Cambiar de color un subrayado ya funciona desde ahí.',
    en: 'Clicking a stored highlight now reopens the whole ribbon. It used to offer deletion alone. You get the colours, the comment, copy, the bookmark and quoting in Nodi, with the colour it already has marked and the bin at the end. Recolouring a highlight now works from there.',
    fr: 'Cliquer sur un surlignage enregistré rouvre désormais le ruban entier. Il ne proposait avant que la suppression. Vous retrouvez les couleurs, le commentaire, la copie, le signet et la citation dans Nodi, avec la couleur qu’il a déjà cochée et la corbeille à la fin. Changer la couleur d’un surlignage se fait maintenant de là.',
    de: 'Ein Klick auf eine gespeicherte Markierung öffnet jetzt das ganze Band. Zuvor bot es nur das Löschen an. Sie erhalten die Farben, den Kommentar, Kopieren, das Lesezeichen und das Zitieren in Nodi, mit der bereits vorhandenen Farbe markiert und dem Papierkorb am Ende. Die Farbe einer Markierung lässt sich nun von dort ändern.',
    pt: 'Ao carregar num sublinhado guardado, a fita completa volta a abrir. Antes só oferecia apagá-lo. Agora tem as cores, o comentário, copiar, o marcador e citar no Nodi, com a cor que já tem assinalada e o caixote no fim. Mudar a cor de um sublinhado passa a fazer-se a partir daí.',
    'pt-BR': 'Ao clicar em um destaque salvo, a faixa completa volta a abrir. Antes ela só oferecia excluí-lo. Agora você tem as cores, o comentário, copiar, o marcador e citar no Nodi, com a cor que ele já tem assinalada e a lixeira no fim. Mudar a cor de um destaque passa a ser feito ali mesmo.',
  },
  {
    scope: 'nodi',
    es: 'Preguntar a Nodi o al chat de investigación ya no congela la ventana. La búsqueda por similitud recorría todo el corpus de una sola vez y dejaba la aplicación quieta hasta que empezaba a llegar la respuesta. Ahora lo recorre por tramos y devuelve exactamente los mismos resultados. Además, un chat nuevo empieza con la bóveda activa ya seleccionada, porque casi siempre preguntas por ella. Todas las bóvedas sigue estando a un clic.',
    en: 'Asking Nodi or the research chat no longer freezes the window. The similarity search walked the whole corpus in one go and left the app still until the answer started arriving. It now walks it in stages and returns exactly the same results. A new chat also starts with the current vault already selected, because that is nearly always what you are asking about. All vaults stays one click away.',
    fr: 'Poser une question à Nodi ou au chat de recherche ne fige plus la fenêtre. La recherche par similarité parcourait tout le corpus d’un seul coup et laissait l’application immobile jusqu’à l’arrivée de la réponse. Elle le parcourt désormais par tranches et renvoie exactement les mêmes résultats. Un nouveau chat démarre aussi avec le coffre actif déjà sélectionné, car c’est presque toujours celui dont vous parlez. Tous les coffres reste à un clic.',
    de: 'Eine Frage an Nodi oder den Recherche-Chat friert das Fenster nicht mehr ein. Die Ähnlichkeitssuche durchlief das gesamte Korpus in einem Zug und ließ die App stillstehen, bis die Antwort einzutreffen begann. Jetzt durchläuft sie es in Abschnitten und liefert genau dieselben Ergebnisse. Ein neuer Chat startet außerdem mit dem aktiven Tresor bereits ausgewählt, denn fast immer geht es um diesen. Alle Tresore bleibt einen Klick entfernt.',
    pt: 'Perguntar ao Nodi ou ao chat de investigação já não congela a janela. A pesquisa por semelhança percorria todo o corpus de uma só vez e deixava a aplicação parada até a resposta começar a chegar. Agora percorre-o por troços e devolve exatamente os mesmos resultados. Além disso, um chat novo começa com o cofre ativo já selecionado, porque é quase sempre sobre ele que pergunta. Todos os cofres continua a um clique.',
    'pt-BR': 'Perguntar ao Nodi ou ao chat de pesquisa já não congela a janela. A busca por semelhança percorria todo o corpus de uma só vez e deixava o aplicativo parado até a resposta começar a chegar. Agora ele o percorre por trechos e devolve exatamente os mesmos resultados. Além disso, um chat novo começa com o cofre ativo já selecionado, porque é quase sempre sobre ele que você pergunta. Todos os cofres continua a um clique.',
  },
  {
    scope: 'mcp',
    es: 'Las búsquedas que hace un cliente MCP dejan de bloquear la ventana de Nodus. Buscar ideas o pasajes desde otra aplicación congelaba Nodus por detrás, sin nada en pantalla que lo explicara, y otra vez por cada búsqueda del turno. Ahora esas dos búsquedas recorren el corpus por tramos y devuelven el mismo orden de resultados.',
    en: 'Searches made by an MCP client no longer block the Nodus window. Searching ideas or passages from another application froze Nodus behind it, with nothing on screen to explain it, and again for every search in a turn. Those two searches now walk the corpus in stages and return the same ranking.',
    fr: 'Les recherches lancées par un client MCP ne bloquent plus la fenêtre de Nodus. Chercher des idées ou des passages depuis une autre application figeait Nodus à l’arrière-plan, sans rien à l’écran pour l’expliquer, et de nouveau à chaque recherche du tour. Ces deux recherches parcourent maintenant le corpus par tranches et renvoient le même classement.',
    de: 'Suchen eines MCP-Clients blockieren das Nodus-Fenster nicht mehr. Das Suchen von Ideen oder Passagen aus einer anderen Anwendung ließ Nodus im Hintergrund einfrieren, ohne dass etwas auf dem Bildschirm es erklärte, und erneut bei jeder Suche im selben Zug. Diese beiden Suchen durchlaufen das Korpus nun in Abschnitten und liefern dieselbe Reihenfolge.',
    pt: 'As pesquisas feitas por um cliente MCP deixam de bloquear a janela do Nodus. Procurar ideias ou passagens a partir de outra aplicação congelava o Nodus por trás, sem nada no ecrã que o explicasse, e outra vez a cada pesquisa do turno. Essas duas pesquisas percorrem agora o corpus por troços e devolvem a mesma ordem de resultados.',
    'pt-BR': 'As buscas feitas por um cliente MCP deixam de bloquear a janela do Nodus. Procurar ideias ou passagens a partir de outro aplicativo congelava o Nodus por trás, sem nada na tela que explicasse, e de novo a cada busca do turno. Essas duas buscas percorrem agora o corpus por trechos e devolvem a mesma ordem de resultados.',
  },
];

/** 4.1.4 — a new public home and a desktop that stays responsive during upkeep. */
const RELEASE_4_1_4_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'general',
    es: 'Nodus estrena casa en nodusresearch.com. La nueva web reúne la wiki, los manuales, las demos interactivas, las preguntas frecuentes, el blog y una página para contribuir. Está rediseñada para orientarte desde el primer vistazo y funciona mejor en pantallas pequeñas. La aplicación te avisará una sola vez y el centro de notificaciones abrirá la nueva dirección.',
    en: 'Nodus has a new home at nodusresearch.com. The new website brings together the wiki, manuals, interactive demos, frequently asked questions, the blog and a page for contributing. It has been redesigned to orient you at first glance and works better on small screens. The app will tell you once, and the notification centre will open the new address.',
    fr: 'Nodus a une nouvelle adresse, nodusresearch.com. Le nouveau site réunit le wiki, les manuels, les démos interactives, les questions fréquentes, le blog et une page pour contribuer. Il a été repensé pour vous orienter dès le premier regard et fonctionne mieux sur les petits écrans. L’application vous préviendra une seule fois et le centre de notifications ouvrira la nouvelle adresse.',
    de: 'Nodus hat unter nodusresearch.com ein neues Zuhause. Die neue Website vereint Wiki, Handbücher, interaktive Demos, häufige Fragen, Blog und eine Seite zum Mitmachen. Sie wurde neu gestaltet, damit Sie sich auf den ersten Blick zurechtfinden, und funktioniert besser auf kleinen Bildschirmen. Die App weist Sie einmal darauf hin und die Mitteilungszentrale öffnet die neue Adresse.',
    pt: 'O Nodus tem uma nova casa em nodusresearch.com. O novo site reúne a wiki, os manuais, as demonstrações interativas, as perguntas frequentes, o blogue e uma página para contribuir. Foi redesenhado para orientar à primeira vista e funciona melhor em ecrãs pequenos. A aplicação avisará uma única vez e o centro de notificações abrirá o novo endereço.',
    'pt-BR': 'O Nodus tem uma nova casa em nodusresearch.com. O novo site reúne a wiki, os manuais, as demonstrações interativas, as perguntas frequentes, o blog e uma página para contribuir. Ele foi redesenhado para orientar logo de início e funciona melhor em telas pequenas. O aplicativo avisará uma única vez e a central de notificações abrirá o novo endereço.',
  },
  {
    scope: 'general',
    es: 'Las copias de seguridad automáticas y la publicación de bóvedas conectadas dejan de bloquear la aplicación. El trabajo pesado ocurre ahora fuera de la ventana principal, usa memoria de forma acotada y se detiene si un proceso externo queda colgado. Puedes seguir usando Nodus mientras una bóveda grande se cifra, comprime o envía al servidor. Los fallos de publicación esperan antes de volver a intentarlo y los datos sin cambios no se reconstruyen.',
    en: 'Automatic backups and publishing connected vaults no longer block the app. Heavy work now runs outside the main window, uses bounded memory and stops if an external process hangs. You can keep using Nodus while a large vault is encrypted, compressed or sent to the server. Failed publications wait before trying again, and unchanged data is not rebuilt.',
    fr: 'Les sauvegardes automatiques et la publication des coffres connectés ne bloquent plus l’application. Le travail lourd s’effectue désormais hors de la fenêtre principale, utilise une quantité de mémoire limitée et s’arrête si un processus externe se fige. Vous pouvez continuer à utiliser Nodus pendant le chiffrement, la compression ou l’envoi au serveur d’un grand coffre. Les publications échouées attendent avant de réessayer et les données inchangées ne sont pas reconstruites.',
    de: 'Automatische Sicherungen und die Veröffentlichung verbundener Tresore blockieren die App nicht mehr. Aufwendige Arbeit läuft nun außerhalb des Hauptfensters, nutzt begrenzten Speicher und wird beendet, falls ein externer Prozess hängen bleibt. Sie können Nodus weiterverwenden, während ein großer Tresor verschlüsselt, komprimiert oder an den Server gesendet wird. Fehlgeschlagene Veröffentlichungen warten vor dem nächsten Versuch und unveränderte Daten werden nicht neu aufgebaut.',
    pt: 'As cópias de segurança automáticas e a publicação de cofres ligados deixam de bloquear a aplicação. O trabalho pesado passa a decorrer fora da janela principal, usa memória de forma limitada e termina se um processo externo ficar bloqueado. Pode continuar a usar o Nodus enquanto um cofre grande é cifrado, comprimido ou enviado para o servidor. As publicações falhadas aguardam antes de tentar novamente e os dados inalterados não são reconstruídos.',
    'pt-BR': 'Os backups automáticos e a publicação de cofres conectados não bloqueiam mais o aplicativo. O trabalho pesado agora acontece fora da janela principal, usa memória de forma limitada e é interrompido se um processo externo travar. Você pode continuar usando o Nodus enquanto um cofre grande é criptografado, compactado ou enviado ao servidor. As publicações com falha aguardam antes de tentar novamente e os dados inalterados não são reconstruídos.',
  },
  {
    scope: 'general',
    es: 'El despliegue de Nodus Cloud en Cloudflare ya puede crear su primera cuenta de administración. El servicio real rechazaba la operación de contraseña que aceptaba el entorno de prueba, por lo que el asistente terminaba siempre con un error 500 y no dejaba iniciar el servidor. La configuración respeta ahora el límite de Cloudflare, conserva la compatibilidad con las contraseñas existentes y muestra el motivo que devuelve el servidor cuando algo falla.',
    en: 'A Nodus Cloud deployment on Cloudflare can now create its first administrator account. The production service rejected a password operation that the test environment accepted, so the wizard always ended with a 500 error and could not initialise the server. The setup now respects Cloudflare’s limit, remains compatible with existing passwords and shows the reason returned by the server when something fails.',
    fr: 'Un déploiement de Nodus Cloud sur Cloudflare peut désormais créer son premier compte administrateur. Le service de production refusait une opération de mot de passe acceptée par l’environnement de test. L’assistant se terminait donc toujours par une erreur 500 et ne pouvait pas initialiser le serveur. La configuration respecte maintenant la limite de Cloudflare, reste compatible avec les mots de passe existants et affiche la raison renvoyée par le serveur en cas d’échec.',
    de: 'Eine Nodus-Cloud-Bereitstellung auf Cloudflare kann jetzt ihr erstes Administratorkonto anlegen. Der Produktionsdienst lehnte einen Passwortvorgang ab, den die Testumgebung akzeptierte. Deshalb endete der Assistent immer mit Fehler 500 und konnte den Server nicht initialisieren. Die Einrichtung hält nun das Cloudflare-Limit ein, bleibt mit vorhandenen Passwörtern kompatibel und zeigt bei einem Fehler den vom Server zurückgegebenen Grund an.',
    pt: 'Uma instalação do Nodus Cloud na Cloudflare já pode criar a primeira conta de administração. O serviço de produção recusava uma operação de palavra-passe que o ambiente de teste aceitava. Por isso, o assistente terminava sempre com um erro 500 e não conseguia iniciar o servidor. A configuração respeita agora o limite da Cloudflare, mantém a compatibilidade com as palavras-passe existentes e mostra o motivo devolvido pelo servidor quando algo falha.',
    'pt-BR': 'Uma implantação do Nodus Cloud na Cloudflare agora pode criar a primeira conta de administração. O serviço de produção recusava uma operação de senha aceita pelo ambiente de teste. Por isso, o assistente sempre terminava com um erro 500 e não conseguia iniciar o servidor. A configuração agora respeita o limite da Cloudflare, mantém a compatibilidade com as senhas existentes e mostra o motivo devolvido pelo servidor quando algo falha.',
  },
  {
    scope: 'nodi',
    es: 'Actualizar el centro de notificaciones ya da una respuesta clara. Después de pulsar el botón, Nodus indica si la lista se ha actualizado, si no hay novedades, si los avisos están desactivados o si no ha podido consultar la fuente. La lista sigue conservando la última copia válida cuando la red falla.',
    en: 'Refreshing the notification centre now gives a clear answer. After you press the button, Nodus says whether the list was updated, there is nothing new, announcements are disabled or the source could not be reached. The list keeps its last valid copy when the network fails.',
    fr: 'L’actualisation du centre de notifications donne désormais une réponse claire. Après avoir appuyé sur le bouton, Nodus indique si la liste a été mise à jour, s’il n’y a rien de nouveau, si les annonces sont désactivées ou si la source n’a pas pu être consultée. La liste conserve sa dernière copie valide en cas de panne du réseau.',
    de: 'Das Aktualisieren der Mitteilungszentrale liefert jetzt eine klare Rückmeldung. Nach dem Drücken der Schaltfläche sagt Nodus, ob die Liste aktualisiert wurde, ob es nichts Neues gibt, ob Hinweise deaktiviert sind oder ob die Quelle nicht erreicht werden konnte. Bei einem Netzfehler behält die Liste ihre letzte gültige Kopie.',
    pt: 'Atualizar o centro de notificações passa a dar uma resposta clara. Depois de premir o botão, o Nodus indica se a lista foi atualizada, se não há novidades, se os avisos estão desativados ou se não foi possível consultar a fonte. A lista conserva a última cópia válida quando a rede falha.',
    'pt-BR': 'Atualizar a central de notificações agora dá uma resposta clara. Depois de apertar o botão, o Nodus informa se a lista foi atualizada, se não há novidades, se os avisos estão desativados ou se não foi possível consultar a fonte. A lista mantém a última cópia válida quando a rede falha.',
  },
];

/**
 * 4.1.2 — the author dossier gets read in a sensible order and stops flashing its own
 * seams, every section remembers where you left it, and the Cloudflare wizard from 4.1.1
 * catches up to the other seven interface languages.
 */
const RELEASE_4_1_2_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'academic',
    es: 'El dosier de un autor mejora en varios frentes. Sus obras aparecen ahora antes que sus ideas, como conviene al acercarse a alguien por primera vez. La lista de autores conectados muestra las cinco relaciones más fuertes y abre la lista completa en un modal aparte, y ya se ve bien en modo claro. Los modales que abre el dosier tampoco dejan una franja de color por encima de la barra de título.',
    en: 'The author dossier improves on several fronts. Their works now appear before their ideas, the way you approach someone for the first time. The connected authors list shows the five strongest relations and opens the full list in its own modal, and it now reads correctly in light mode. The modals the dossier opens no longer leave a bright strip above the title bar.',
    fr: 'Le dossier d’un auteur s’améliore sur plusieurs points. Ses œuvres apparaissent désormais avant ses idées, comme il convient en découvrant quelqu’un pour la première fois. La liste des auteurs connectés affiche les cinq relations les plus fortes et ouvre la liste complète dans une fenêtre à part, et elle s’affiche enfin correctement en mode clair. Les fenêtres ouvertes depuis le dossier ne laissent plus de bande colorée au-dessus de la barre de titre.',
    de: 'Das Autorendossier verbessert sich an mehreren Stellen. Seine Werke erscheinen jetzt vor seinen Ideen, so wie man jemandem zum ersten Mal begegnet. Die Liste verbundener Autoren zeigt die fünf stärksten Beziehungen und öffnet die vollständige Liste in einem eigenen Fenster, und sie sieht im hellen Modus jetzt richtig aus. Die vom Dossier geöffneten Fenster lassen keinen farbigen Streifen mehr über der Titelleiste.',
    pt: 'O dossiê de um autor melhora em várias frentes. As suas obras aparecem agora antes das suas ideias, como convém ao conhecer alguém pela primeira vez. A lista de autores ligados mostra as cinco relações mais fortes e abre a lista completa numa janela própria, e já se vê bem em modo claro. As janelas que o dossiê abre também deixam de ter uma faixa colorida acima da barra de título.',
    'pt-BR': 'O dossiê de um autor melhora em várias frentes. As obras dele agora aparecem antes das ideias, como convém ao conhecer alguém pela primeira vez. A lista de autores conectados mostra as cinco relações mais fortes e abre a lista completa em uma janela própria, e agora aparece corretamente no modo claro. As janelas que o dossiê abre também deixam de ter uma faixa colorida acima da barra de título.',
  },
  {
    scope: 'general',
    es: 'Cada sección recuerda dónde la dejaste. Al volver a Ideas, Autores, Biblioteca global, Mapa de argumentos o Espacio de trabajo, se restauran los filtros, el orden, la pestaña activa y la fila donde estabas. Cambiar de bóveda no arrastra ese recuerdo de otra distinta.',
    en: 'Every section remembers where you left it. Returning to Ideas, Authors, the Global Library, the Argument Map, or the Workspace restores your filters, sort order, active tab, and the row you were on. Switching vaults never carries over another vault’s memory.',
    fr: 'Chaque section se souvient où vous l’avez laissée. En revenant sur Idées, Auteurs, la Bibliothèque globale, la Carte des arguments ou l’Espace de travail, les filtres, l’ordre, l’onglet actif et la ligne où vous étiez sont restaurés. Changer de coffre n’importe jamais le souvenir d’un autre coffre.',
    de: 'Jeder Bereich merkt sich, wo Sie ihn verlassen haben. Bei der Rückkehr zu Ideen, Autoren, der globalen Bibliothek, der Argumentkarte oder dem Arbeitsbereich werden Filter, Sortierung, aktiver Reiter und die Zeile, bei der Sie waren, wiederhergestellt. Ein Tresorwechsel überträgt nie die Erinnerung eines anderen Tresors.',
    pt: 'Cada secção recorda onde a deixou. Ao voltar a Ideias, Autores, Biblioteca global, Mapa de argumentos ou Espaço de trabalho, os filtros, a ordem, o separador ativo e a linha onde estava são repostos. Mudar de cofre nunca arrasta a memória de outro cofre.',
    'pt-BR': 'Cada seção lembra onde você a deixou. Ao voltar para Ideias, Autores, Biblioteca global, Mapa de argumentos ou Espaço de trabalho, os filtros, a ordem, a aba ativa e a linha em que você estava são restaurados. Trocar de cofre nunca traz a memória de outro cofre.',
  },
  {
    scope: 'general',
    es: 'La cinta de selección del lector se adapta al modo claro. Sus botones ya no conservan el resaltado oscuro de antes y los discos de color recuperan un borde visible sobre fondo blanco.',
    en: 'The reader’s selection ribbon now adapts to light mode. Its buttons no longer keep the previous dark highlight, and the colour discs regain a visible edge against a white bar.',
    fr: 'Le ruban de sélection du lecteur s’adapte désormais au mode clair. Ses boutons ne gardent plus le surlignage sombre d’avant, et les disques de couleur retrouvent un contour visible sur fond blanc.',
    de: 'Das Auswahlband des Readers passt sich jetzt dem hellen Modus an. Seine Schaltflächen behalten nicht mehr die vorherige dunkle Hervorhebung, und die Farbkreise erhalten wieder einen sichtbaren Rand auf weißem Grund.',
    pt: 'A fita de seleção do leitor adapta-se agora ao modo claro. Os seus botões deixam de manter o realce escuro anterior e os discos de cor recuperam um contorno visível sobre fundo branco.',
    'pt-BR': 'A faixa de seleção do leitor agora se adapta ao modo claro. Os botões deixam de manter o realce escuro anterior e os discos de cor recuperam um contorno visível sobre fundo branco.',
  },
  {
    scope: 'general',
    es: 'El asistente de despliegue en Cloudflare habla ahora tus ocho idiomas. Antes de aceptar el proyecto, Nodus muestra qué crea exactamente en tu cuenta y qué permisos concede, todo traducido.',
    en: 'The Cloudflare deployment wizard now speaks all eight interface languages. Before you accept the project, Nodus shows exactly what it creates in your account and what permissions it grants, fully translated.',
    fr: 'L’assistant de déploiement Cloudflare parle désormais vos huit langues. Avant d’accepter le projet, Nodus affiche exactement ce qu’il crée dans votre compte et les autorisations accordées, entièrement traduit.',
    de: 'Der Cloudflare-Bereitstellungsassistent spricht jetzt alle acht Oberflächensprachen. Bevor Sie das Projekt annehmen, zeigt Nodus genau, was in Ihrem Konto erstellt wird und welche Berechtigungen erteilt werden, vollständig übersetzt.',
    pt: 'O assistente de implementação na Cloudflare fala agora os seus oito idiomas. Antes de aceitar o projeto, o Nodus mostra exatamente o que cria na sua conta e que permissões concede, tudo traduzido.',
    'pt-BR': 'O assistente de implantação na Cloudflare agora fala seus oito idiomas. Antes de aceitar o projeto, o Nodus mostra exatamente o que cria na sua conta e quais permissões concede, tudo traduzido.',
  },
];

/**
 * 4.1.1 — the patch that follows 4.1, written for someone who never saw the pull requests.
 *
 * Three corrections inside a vault, then three things that appear outside it: your own
 * Cloudflare deployment, the website wiki, and the small editor and window details that
 * 4.1 shipped with. Short sentences, no semicolons, no em dashes.
 */
const RELEASE_4_1_1_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'academic',
    es: 'La Biblioteca global estrena su propia ventana de opciones. Decides cómo se nombran los archivos que añades, con tres formatos a partir de autor, año y título, y a qué tipos se aplica. También puedes desactivar la preparación automática de la copia legible. Borrar una nota ahora pide confirmación.',
    en: 'The Global Library gains its own settings window. You decide how added files are named, with three formats built from author, year and title, and which file types it applies to. You can also turn off the automatic preparation of the readable copy. Deleting a note now asks for confirmation.',
    fr: 'La Bibliothèque globale reçoit sa propre fenêtre d’options. Vous décidez comment sont nommés les fichiers ajoutés, avec trois formats construits à partir de l’auteur, de l’année et du titre, et à quels types ils s’appliquent. Vous pouvez aussi désactiver la préparation automatique de la copie lisible. La suppression d’une note demande désormais confirmation.',
    de: 'Die globale Bibliothek erhält ein eigenes Einstellungsfenster. Sie legen fest, wie hinzugefügte Dateien benannt werden, mit drei Formaten aus Autor, Jahr und Titel, und für welche Dateitypen das gilt. Auch die automatische Aufbereitung der lesbaren Kopie lässt sich abschalten. Das Löschen einer Notiz fragt jetzt nach.',
    pt: 'A Biblioteca global passa a ter a sua própria janela de opções. Decide como são nomeados os ficheiros que adiciona, com três formatos a partir de autor, ano e título, e a que tipos se aplica. Também pode desativar a preparação automática da cópia legível. Apagar uma nota passa a pedir confirmação.',
    'pt-BR': 'A Biblioteca global ganha sua própria janela de opções. Você decide como são nomeados os arquivos que adiciona, com três formatos a partir de autor, ano e título, e a quais tipos se aplica. Também pode desativar a preparação automática da cópia legível. Excluir uma nota agora pede confirmação.',
  },
  {
    scope: 'academic',
    es: 'Cobertura recupera tus preguntas guardadas al abrir el vault activo. Puedes lanzar varias seguidas y se procesan en orden, una detrás de otra, sin pisarse. Borrar una pregunta pide confirmación antes de hacerlo.',
    en: 'Coverage brings back your saved questions when you open the active vault. You can launch several in a row and they are processed in order, one after another, without colliding. Deleting a question asks for confirmation first.',
    fr: 'Couverture retrouve vos questions enregistrées à l’ouverture du coffre actif. Vous pouvez en lancer plusieurs de suite et elles sont traitées dans l’ordre, l’une après l’autre, sans se gêner. La suppression d’une question demande confirmation au préalable.',
    de: 'Abdeckung holt Ihre gespeicherten Fragen zurück, wenn Sie den aktiven Tresor öffnen. Sie können mehrere hintereinander starten, und sie werden der Reihe nach abgearbeitet, ohne sich zu stören. Das Löschen einer Frage fragt vorher nach.',
    pt: 'A Cobertura recupera as suas perguntas guardadas ao abrir o cofre ativo. Pode lançar várias seguidas e são processadas por ordem, uma a seguir à outra, sem se atropelarem. Apagar uma pergunta pede confirmação antes.',
    'pt-BR': 'A Cobertura recupera suas perguntas salvas ao abrir o cofre ativo. Você pode lançar várias seguidas e elas são processadas em ordem, uma após a outra, sem se atropelar. Excluir uma pergunta pede confirmação antes.',
  },
  {
    scope: 'academic',
    es: 'Contradicciones se dibuja ahora en el atlas semántico, igual que el resto del grafo. La vista mantiene un tamaño acotado y conserva las dos partes de cada debate que muestra. Antes podía quedarse con un solo lado de la discusión.',
    en: 'Contradictions is now drawn in the semantic atlas, like the rest of the graph. The view stays within a bounded size and keeps both sides of every debate it shows. Before, it could end up holding only one side of the argument.',
    fr: 'Contradictions se dessine désormais dans l’atlas sémantique, comme le reste du graphe. La vue conserve une taille bornée et garde les deux côtés de chaque débat affiché. Auparavant, elle pouvait ne retenir qu’un seul côté de la discussion.',
    de: 'Widersprüche wird jetzt im semantischen Atlas gezeichnet, wie der übrige Graph. Die Ansicht bleibt in ihrer Größe begrenzt und behält beide Seiten jeder gezeigten Debatte. Zuvor konnte nur eine Seite der Auseinandersetzung übrig bleiben.',
    pt: 'As Contradições passam a desenhar-se no atlas semântico, como o resto do grafo. A vista mantém um tamanho limitado e conserva os dois lados de cada debate que mostra. Antes podia ficar apenas com um lado da discussão.',
    'pt-BR': 'As Contradições agora são desenhadas no atlas semântico, como o resto do grafo. A visualização mantém um tamanho limitado e conserva os dois lados de cada debate que mostra. Antes podia ficar só com um lado da discussão.',
  },
  {
    scope: 'general',
    es: 'Se corrigen tres detalles del editor y de las ventanas. El botón de sinónimos ya no se queda con un contorno marcado después de usarlo. Las marcas internas que protegen citas y enlaces dejan de aparecer en las mejoras de texto y en el documento. Nodi se dibuja de inmediato en las ventanas de actualización y novedades, y los marcadores de tipo de idea vuelven a ser redondos.',
    en: 'Three details of the editor and the windows are corrected. The synonyms button no longer keeps a marked outline after you use it. The internal marks that protect citations and links stop appearing in text improvements and in the document. Nodi is drawn immediately in the update and what’s-new windows, and idea type markers are round again.',
    fr: 'Trois détails de l’éditeur et des fenêtres sont corrigés. Le bouton des synonymes ne conserve plus un contour marqué après usage. Les marques internes qui protègent citations et liens cessent d’apparaître dans les améliorations de texte et dans le document. Nodi se dessine immédiatement dans les fenêtres de mise à jour et de nouveautés, et les marqueurs de type d’idée redeviennent ronds.',
    de: 'Drei Details des Editors und der Fenster sind korrigiert. Die Synonym-Schaltfläche behält nach der Nutzung keinen markierten Rahmen mehr. Die internen Marken, die Zitate und Links schützen, erscheinen nicht mehr in Textverbesserungen und im Dokument. Nodi wird in den Update- und Neuigkeitenfenstern sofort gezeichnet, und die Ideentyp-Markierungen sind wieder rund.',
    pt: 'Corrigem-se três pormenores do editor e das janelas. O botão de sinónimos deixa de ficar com um contorno marcado depois de o usar. As marcas internas que protegem citações e ligações deixam de aparecer nas melhorias de texto e no documento. O Nodi é desenhado de imediato nas janelas de atualização e novidades, e os marcadores de tipo de ideia voltam a ser redondos.',
    'pt-BR': 'Três detalhes do editor e das janelas foram corrigidos. O botão de sinônimos não fica mais com um contorno marcado depois de usado. As marcas internas que protegem citações e links deixam de aparecer nas melhorias de texto e no documento. O Nodi é desenhado de imediato nas janelas de atualização e novidades, e os marcadores de tipo de ideia voltam a ser redondos.',
  },
  {
    scope: 'general',
    es: 'Puedes montar tu propio Nodus Cloud en tu cuenta de Cloudflare. Desde Ajustes se abre el asistente oficial de Cloudflare, que crea la base de datos y el almacenamiento y publica una dirección gratuita. Nodus no recibe tus credenciales ni permisos sobre esa cuenta. El código desplegado es tuyo y se actualiza cuando tú quieras.',
    en: 'You can run your own Nodus Cloud on your Cloudflare account. Settings opens the official Cloudflare wizard, which creates the database and the storage and publishes a free address. Nodus never receives your credentials or any permission over that account. The deployed code is yours and updates when you decide.',
    fr: 'Vous pouvez héberger votre propre Nodus Cloud sur votre compte Cloudflare. Les Paramètres ouvrent l’assistant officiel de Cloudflare, qui crée la base de données et le stockage puis publie une adresse gratuite. Nodus ne reçoit jamais vos identifiants ni aucune autorisation sur ce compte. Le code déployé vous appartient et se met à jour quand vous le décidez.',
    de: 'Sie können Ihr eigenes Nodus Cloud in Ihrem Cloudflare-Konto betreiben. Die Einstellungen öffnen den offiziellen Cloudflare-Assistenten, der Datenbank und Speicher anlegt und eine kostenlose Adresse veröffentlicht. Nodus erhält niemals Ihre Zugangsdaten oder Rechte an diesem Konto. Der bereitgestellte Code gehört Ihnen und wird aktualisiert, wenn Sie es möchten.',
    pt: 'Pode montar o seu próprio Nodus Cloud na sua conta Cloudflare. As Definições abrem o assistente oficial da Cloudflare, que cria a base de dados e o armazenamento e publica um endereço gratuito. O Nodus nunca recebe as suas credenciais nem permissões sobre essa conta. O código publicado é seu e atualiza-se quando quiser.',
    'pt-BR': 'Você pode montar o seu próprio Nodus Cloud na sua conta Cloudflare. As Configurações abrem o assistente oficial da Cloudflare, que cria o banco de dados e o armazenamento e publica um endereço gratuito. O Nodus nunca recebe suas credenciais nem permissões sobre essa conta. O código publicado é seu e se atualiza quando você quiser.',
  },
  {
    scope: 'general',
    es: 'La web de Nodus estrena una wiki completa con manuales por tipo de bóveda. Cada sección explica las pantallas con capturas reales y se puede leer desde el móvil. Los manuales también se descargan en PDF.',
    en: 'The Nodus website gains a complete wiki with manuals for each vault type. Every section explains the screens with real captures and reads well on a phone. The manuals can also be downloaded as PDF.',
    fr: 'Le site de Nodus inaugure un wiki complet avec des manuels par type de coffre. Chaque section explique les écrans avec de vraies captures et se lit depuis un téléphone. Les manuels se téléchargent aussi en PDF.',
    de: 'Die Nodus-Website erhält ein vollständiges Wiki mit Handbüchern für jeden Tresortyp. Jeder Abschnitt erklärt die Bildschirme mit echten Aufnahmen und liest sich auch auf dem Telefon gut. Die Handbücher lassen sich zudem als PDF herunterladen.',
    pt: 'O site do Nodus estreia uma wiki completa com manuais por tipo de cofre. Cada secção explica os ecrãs com capturas reais e lê-se a partir do telemóvel. Os manuais também podem ser descarregados em PDF.',
    'pt-BR': 'O site do Nodus estreia uma wiki completa com manuais por tipo de cofre. Cada seção explica as telas com capturas reais e pode ser lida no celular. Os manuais também podem ser baixados em PDF.',
  },
];

const RELEASE_4_1_0_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'academic',
    es: 'Autores, Ideas y Mapa de argumentos adoptan la vista de Biblioteca. La lista reúne metadatos, etiquetas y filtros, y cada elemento abre una pestaña ordenada con su síntesis, relaciones y contenido. Estado de la cuestión reúne Cobertura, Debates y Huecos en ese mismo lenguaje visual.',
    en: 'Authors, Ideas and Argument Map now use the Library view. Their lists bring metadata, tags and filters together, and each item opens an ordered tab with its synthesis, relations and content. State of the Question combines Coverage, Debates and Gaps in the same visual language.',
    fr: 'Auteurs, Idées et Carte d’arguments adoptent la vue Bibliothèque. Leurs listes réunissent métadonnées, étiquettes et filtres, et chaque élément ouvre un onglet ordonné avec sa synthèse, ses relations et son contenu. État de la recherche regroupe Couverture, Débats et Lacunes dans le même langage visuel.',
    de: 'Autoren, Ideen und Argumentationskarte verwenden jetzt die Bibliotheksansicht. Die Listen bündeln Metadaten, Tags und Filter, und jedes Element öffnet einen geordneten Reiter mit Synthese, Beziehungen und Inhalt. Der Forschungsstand vereint Abdeckung, Debatten und Lücken in derselben Gestaltung.',
    pt: 'Autores, Ideias e Mapa de argumentos adotam a vista da Biblioteca. As listas reúnem metadados, etiquetas e filtros, e cada elemento abre um separador organizado com síntese, relações e conteúdo. O Estado da arte reúne Cobertura, Debates e Lacunas na mesma linguagem visual.',
    'pt-BR': 'Autores, Ideias e Mapa de argumentos agora usam a visualização da Biblioteca. As listas reúnem metadados, etiquetas e filtros, e cada item abre uma aba organizada com síntese, relações e conteúdo. O Estado da arte reúne Cobertura, Debates e Lacunas na mesma linguagem visual.',
  },
  {
    scope: 'academic',
    es: 'Espacio de trabajo se comporta como una biblioteca de notas e ideas en todos los vaults. Permite añadir etiquetas, filtrar por ellas, seleccionar varios elementos, abrir acciones con el botón derecho y recuperar lo eliminado desde la Papelera.',
    en: 'Workspace now behaves like a library of notes and ideas in every vault. You can add tags, filter by them, select several items, open actions with a right click, and recover deleted work from Trash.',
    fr: 'L’Espace de travail fonctionne désormais comme une bibliothèque de notes et d’idées dans chaque coffre. Vous pouvez ajouter des étiquettes, les filtrer, sélectionner plusieurs éléments, ouvrir les actions par clic droit et récupérer le contenu supprimé depuis la Corbeille.',
    de: 'Der Arbeitsbereich verhält sich jetzt in jedem Tresor wie eine Bibliothek für Notizen und Ideen. Tags lassen sich hinzufügen und filtern, mehrere Elemente gemeinsam auswählen, Aktionen per Rechtsklick öffnen und gelöschte Inhalte aus dem Papierkorb wiederherstellen.',
    pt: 'O Espaço de trabalho funciona agora como uma biblioteca de notas e ideias em todos os cofres. Pode adicionar etiquetas, filtrá-las, selecionar vários elementos, abrir ações com o botão direito e recuperar o que foi eliminado a partir do Lixo.',
    'pt-BR': 'O Espaço de trabalho agora funciona como uma biblioteca de notas e ideias em todos os cofres. Você pode adicionar etiquetas, filtrar por elas, selecionar vários itens, abrir ações com o botão direito e recuperar o que foi excluído na Lixeira.',
  },
  {
    scope: 'academic',
    es: 'La Biblioteca publicada llega al móvil con sus colecciones jerárquicas, metadatos y referencias. Puedes leer y subrayar el Markdown limpio, ver sus imágenes, conservar documentos sin conexión y borrar una selección o todas las descargas. El original aparece identificado y queda reservado para una versión futura.',
    en: 'Published Library reaches mobile with hierarchical collections, metadata and references. You can read and highlight clean Markdown, view its images, keep documents offline, and delete selected or all downloads. The original is identified and remains reserved for a future release.',
    fr: 'La Bibliothèque publiée arrive sur mobile avec ses collections hiérarchiques, ses métadonnées et ses références. Vous pouvez lire et surligner le Markdown propre, voir ses images, conserver des documents hors ligne et supprimer une sélection ou tous les téléchargements. L’original est identifié et reste réservé à une prochaine version.',
    de: 'Die veröffentlichte Bibliothek kommt mit hierarchischen Sammlungen, Metadaten und Referenzen aufs Mobilgerät. Bereinigtes Markdown lässt sich lesen und markieren, Bilder sind sichtbar, Dokumente bleiben offline verfügbar und ausgewählte oder alle Downloads können gelöscht werden. Das Original ist gekennzeichnet und bleibt einer späteren Version vorbehalten.',
    pt: 'A Biblioteca publicada chega ao telemóvel com coleções hierárquicas, metadados e referências. Pode ler e sublinhar o Markdown limpo, ver as imagens, guardar documentos sem ligação e apagar uma seleção ou todas as transferências. O original fica identificado e reservado para uma versão futura.',
    'pt-BR': 'A Biblioteca publicada chega ao celular com coleções hierárquicas, metadados e referências. Você pode ler e destacar o Markdown limpo, ver as imagens, manter documentos offline e apagar uma seleção ou todos os downloads. O original aparece identificado e fica reservado para uma versão futura.',
  },
  {
    scope: 'academic',
    es: 'El editor comparte herramientas profesionales entre escritorio y móvil. Al seleccionar texto aparecen formato, enlaces, color, encabezados y mejoras de IA con iconos reales. El selector de modelos incorpora búsqueda, evita el desplazamiento horizontal y mantiene legibles las opciones en cualquier ancho.',
    en: 'The editor shares professional writing tools between desktop and mobile. Selecting text reveals formatting, links, colour, headings and AI improvements with proper icons. The model picker includes search, removes horizontal scrolling, and keeps every option readable at any width.',
    fr: 'L’éditeur partage des outils d’écriture professionnels entre ordinateur et mobile. La sélection de texte révèle formatage, liens, couleur, titres et améliorations par IA avec de vraies icônes. Le sélecteur de modèles intègre la recherche, supprime le défilement horizontal et garde chaque option lisible à toute largeur.',
    de: 'Der Editor teilt professionelle Schreibwerkzeuge zwischen Desktop und Mobilgerät. Eine Textauswahl zeigt Formatierung, Links, Farbe, Überschriften und KI-Verbesserungen mit echten Symbolen. Die Modellauswahl bietet Suche, entfernt horizontales Scrollen und hält jede Option bei jeder Breite lesbar.',
    pt: 'O editor partilha ferramentas de escrita profissionais entre computador e telemóvel. Ao selecionar texto surgem formatação, ligações, cor, títulos e melhorias de IA com ícones reais. O seletor de modelos inclui pesquisa, elimina o deslocamento horizontal e mantém todas as opções legíveis em qualquer largura.',
    'pt-BR': 'O editor compartilha ferramentas profissionais de escrita entre desktop e celular. Ao selecionar texto aparecem formatação, links, cor, títulos e melhorias de IA com ícones reais. O seletor de modelos inclui busca, elimina a rolagem horizontal e mantém todas as opções legíveis em qualquer largura.',
  },
  {
    scope: 'general',
    es: 'Nodus Server mejora la administración de personas y espacios. Una cuenta puede acceder a varios vaults con permisos distintos, y esos accesos se editan después. También puedes renombrar espacios, copiar sus identificadores y direcciones, cambiar el correo tras confirmar tu contraseña y distinguir cada tipo de vault por su color real.',
    en: 'Nodus Server improves account and space administration. One account can access several vaults with different permissions, and those grants remain editable. You can also rename spaces, copy their identifiers and addresses, change an email after confirming your password, and recognise each vault type by its real colour.',
    fr: 'Nodus Server améliore l’administration des comptes et des espaces. Un compte peut accéder à plusieurs coffres avec des autorisations différentes, qui restent modifiables. Vous pouvez aussi renommer les espaces, copier leurs identifiants et adresses, changer un courriel après confirmation du mot de passe et reconnaître chaque type de coffre à sa vraie couleur.',
    de: 'Nodus Server verbessert die Verwaltung von Konten und Bereichen. Ein Konto kann mit unterschiedlichen Rechten auf mehrere Tresore zugreifen, und diese Freigaben bleiben bearbeitbar. Bereiche lassen sich umbenennen, Kennungen und Adressen kopieren, E-Mail-Adressen nach Passwortbestätigung ändern und Tresortypen an ihrer echten Farbe erkennen.',
    pt: 'O Nodus Server melhora a administração de contas e espaços. Uma conta pode aceder a vários cofres com permissões diferentes, e esses acessos continuam editáveis. Também pode mudar o nome dos espaços, copiar identificadores e endereços, alterar o email após confirmar a palavra-passe e reconhecer cada tipo de cofre pela cor real.',
    'pt-BR': 'O Nodus Server melhora a administração de contas e espaços. Uma conta pode acessar vários cofres com permissões diferentes, e esses acessos continuam editáveis. Você também pode renomear espaços, copiar identificadores e endereços, alterar o e-mail após confirmar a senha e reconhecer cada tipo de cofre pela cor real.',
  },
  {
    scope: 'general',
    es: 'La navegación responde mejor a ventanas estrechas. El sidebar puede reducirse a iconos sin perder la N centrada, usa el color de acento del vault en su barra de desplazamiento y mantiene visibles los controles importantes. También se corrigen solapamientos, campos de búsqueda y superficies que conservaban colores del modo equivocado.',
    en: 'Navigation now responds better to narrow windows. The sidebar can shrink to icons without losing the centred N, uses the vault accent on its scrollbar, and keeps important controls visible. Overlaps, search fields and surfaces that retained colours from the wrong theme are corrected too.',
    fr: 'La navigation répond mieux aux fenêtres étroites. La barre latérale peut se réduire aux icônes sans perdre le N centré, reprend la couleur d’accent du coffre dans sa barre de défilement et garde les commandes importantes visibles. Les chevauchements, champs de recherche et surfaces restées dans le mauvais thème sont aussi corrigés.',
    de: 'Die Navigation passt sich schmalen Fenstern besser an. Die Seitenleiste kann auf Symbole schrumpfen, ohne das zentrierte N zu verlieren, nutzt die Tresorfarbe für ihre Bildlaufleiste und hält wichtige Bedienelemente sichtbar. Überlagerungen, Suchfelder und Flächen mit Farben aus dem falschen Design sind ebenfalls korrigiert.',
    pt: 'A navegação responde melhor a janelas estreitas. A barra lateral pode reduzir-se a ícones sem perder o N centrado, usa a cor de destaque do cofre na barra de deslocamento e mantém visíveis os controlos importantes. Também foram corrigidas sobreposições, campos de pesquisa e superfícies que mantinham cores do tema errado.',
    'pt-BR': 'A navegação responde melhor a janelas estreitas. A barra lateral pode se reduzir a ícones sem perder o N centralizado, usa a cor de destaque do cofre na barra de rolagem e mantém os controles importantes visíveis. Também foram corrigidos sobreposições, campos de busca e superfícies que mantinham cores do tema errado.',
  },
  {
    scope: 'general',
    es: 'Las notificaciones se pueden actualizar manualmente desde la cabecera y desde Nodi. Los cambios de un mismo documento o informe se agrupan en una tarjeta desplegable, en lugar de llenar la bandeja con cada subrayado. Los modales de actualización y novedades conservan su diseño usando menos trabajo gráfico y memoria.',
    en: 'Notifications can be refreshed manually from the header and from Nodi. Changes from the same document or report are grouped in one expandable card instead of filling the inbox with every highlight. The update and what’s-new modals keep their design while using less graphical work and memory.',
    fr: 'Les notifications peuvent être actualisées manuellement depuis l’en-tête et depuis Nodi. Les modifications d’un même document ou rapport sont regroupées dans une carte dépliable au lieu de remplir la boîte avec chaque surlignage. Les fenêtres de mise à jour et de nouveautés gardent leur design en utilisant moins de travail graphique et de mémoire.',
    de: 'Benachrichtigungen lassen sich über die Kopfzeile und über Nodi manuell aktualisieren. Änderungen desselben Dokuments oder Berichts werden in einer aufklappbaren Karte gebündelt, statt den Posteingang mit jeder Markierung zu füllen. Update- und Neuigkeitenfenster behalten ihr Design bei geringerem Grafik- und Speicheraufwand.',
    pt: 'As notificações podem ser atualizadas manualmente no cabeçalho e no Nodi. As alterações do mesmo documento ou relatório ficam agrupadas num cartão expansível, em vez de encher a caixa com cada sublinhado. Os modais de atualização e novidades mantêm o desenho com menos trabalho gráfico e memória.',
    'pt-BR': 'As notificações podem ser atualizadas manualmente no cabeçalho e no Nodi. As alterações do mesmo documento ou relatório ficam agrupadas em um cartão expansível, em vez de encher a caixa com cada destaque. Os modais de atualização e novidades mantêm o visual usando menos trabalho gráfico e memória.',
  },
  {
    scope: 'plugin',
    es: 'El conector de Chrome recomienda la instalación desde Chrome Web Store y conserva el ZIP manual. Mantiene el emparejamiento automático y resuelve enlaces académicos al PDF real. En Word se corrigen el modo oscuro y los pasajes dañados, y el selector CSL busca entre los estilos instalados en Nodus y se actualiza en tiempo real.',
    en: 'The Chrome connector recommends installation from Chrome Web Store and keeps the manual ZIP. It preserves automatic pairing and resolves scholarly links to the real PDF. In Word, dark mode and damaged passages are fixed, while the CSL picker searches styles installed in Nodus and refreshes them in real time.',
    fr: 'Le connecteur Chrome recommande l’installation depuis Chrome Web Store et conserve le ZIP manuel. Il préserve l’association automatique et résout les liens universitaires vers le vrai PDF. Dans Word, le mode sombre et les passages endommagés sont corrigés, tandis que le sélecteur CSL recherche les styles installés dans Nodus et les actualise en temps réel.',
    de: 'Der Chrome-Connector empfiehlt die Installation aus dem Chrome Web Store und behält das manuelle ZIP. Automatische Verbindung und Auflösung wissenschaftlicher Links zur echten PDF-Datei bleiben erhalten. In Word sind Dunkelmodus und beschädigte Passagen korrigiert, während die CSL-Auswahl installierte Nodus-Stile durchsucht und in Echtzeit aktualisiert.',
    pt: 'O conector do Chrome recomenda a instalação pela Chrome Web Store e mantém o ZIP manual. Preserva a ligação automática e resolve ligações académicas para o PDF real. No Word são corrigidos o modo escuro e os excertos danificados, enquanto o seletor CSL pesquisa os estilos instalados no Nodus e os atualiza em tempo real.',
    'pt-BR': 'O conector do Chrome recomenda a instalação pela Chrome Web Store e mantém o ZIP manual. Ele preserva a conexão automática e resolve links acadêmicos para o PDF real. No Word foram corrigidos o modo escuro e os trechos danificados, enquanto o seletor CSL busca os estilos instalados no Nodus e os atualiza em tempo real.',
  },
  {
    scope: 'toolkit',
    es: 'Nodus Toolkit queda como una sola entrada del sidebar. Sus aplicaciones comparten la misma cabecera y presentación visual, sin etiquetas de desarrollo, y el sitio aplica el mismo encabezado a la portada y a los demos tanto en escritorio como en móvil.',
    en: 'Nodus Toolkit remains a single sidebar entry. Its applications share the same header and visual presentation without development labels, and the website applies the same header to the home page and demos on both desktop and mobile.',
    fr: 'Nodus Toolkit reste une seule entrée dans la barre latérale. Ses applications partagent le même en-tête et la même présentation visuelle sans étiquettes de développement, et le site applique le même en-tête à l’accueil et aux démos sur ordinateur comme sur mobile.',
    de: 'Nodus Toolkit bleibt ein einzelner Eintrag in der Seitenleiste. Seine Anwendungen teilen dieselbe Kopfzeile und visuelle Präsentation ohne Entwicklungshinweise, und die Website verwendet auf Startseite und Demos dieselbe Kopfzeile auf Desktop und Mobilgerät.',
    pt: 'O Nodus Toolkit fica como uma única entrada na barra lateral. As aplicações partilham o mesmo cabeçalho e apresentação visual sem etiquetas de desenvolvimento, e o site aplica o mesmo cabeçalho à página inicial e às demos no computador e no telemóvel.',
    'pt-BR': 'O Nodus Toolkit fica como uma única entrada na barra lateral. Os aplicativos compartilham o mesmo cabeçalho e apresentação visual sem etiquetas de desenvolvimento, e o site aplica o mesmo cabeçalho à página inicial e às demos no desktop e no celular.',
  },
];

const RELEASE_4_0_1_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'plugin',
    es: 'El conector de Chrome se enlaza solo cuando lo activas en Nodus. Ya no aparece un aviso nativo redundante, y si revocas el token el navegador obtiene uno nuevo al volver a abrir el conector.',
    en: 'The Chrome connector now pairs automatically after you enable it in Nodus. The redundant native prompt is gone, and if you revoke its token the browser obtains a fresh one when you open the connector again.',
    fr: 'Le connecteur Chrome s’associe désormais automatiquement après son activation dans Nodus. La boîte de dialogue native redondante disparaît, et si vous révoquez son jeton le navigateur en obtient un nouveau à la prochaine ouverture.',
    de: 'Der Chrome-Connector verbindet sich nun automatisch, sobald Sie ihn in Nodus aktivieren. Die überflüssige native Nachfrage entfällt, und nach dem Widerruf seines Tokens erhält der Browser beim nächsten Öffnen selbstständig ein neues.',
    pt: 'O conector do Chrome passa a emparelhar automaticamente depois de o ativar no Nodus. O aviso nativo redundante desaparece e, se revogar o token, o navegador obtém outro quando voltar a abrir o conector.',
    'pt-BR': 'O conector do Chrome agora emparelha automaticamente depois que você o ativa no Nodus. O aviso nativo redundante desapareceu e, se o token for revogado, o navegador obtém outro ao abrir o conector novamente.',
  },
  {
    scope: 'academic',
    es: 'Los enlaces académicos de texto completo ya se siguen aunque no terminen en PDF. Nodus atraviesa páginas como Dialnet y OJS, valida la firma del PDF real y prepara el Markdown limpio desde el artículo, no desde el snapshot HTML.',
    en: 'Academic full-text links are now followed even when their address does not end in PDF. Nodus crosses pages such as Dialnet and OJS, validates the real PDF signature, and prepares clean Markdown from the paper instead of the HTML snapshot.',
    fr: 'Les liens universitaires en texte intégral sont désormais suivis même si leur adresse ne se termine pas par PDF. Nodus traverse des pages comme Dialnet et OJS, valide la signature du vrai PDF et prépare le Markdown depuis l’article plutôt que depuis l’instantané HTML.',
    de: 'Akademische Volltextlinks werden jetzt auch verfolgt, wenn ihre Adresse nicht auf PDF endet. Nodus folgt Seiten wie Dialnet und OJS, prüft die Signatur der echten PDF-Datei und erstellt das bereinigte Markdown aus dem Aufsatz statt aus dem HTML-Schnappschuss.',
    pt: 'As ligações académicas de texto integral passam a ser seguidas mesmo sem terminarem em PDF. O Nodus atravessa páginas como Dialnet e OJS, valida a assinatura do PDF real e prepara o Markdown limpo a partir do artigo, não do snapshot HTML.',
    'pt-BR': 'Os links acadêmicos de texto completo agora são seguidos mesmo sem terminarem em PDF. O Nodus atravessa páginas como Dialnet e OJS, valida a assinatura do PDF real e prepara o Markdown limpo a partir do artigo, não do snapshot HTML.',
  },
];

const RELEASE_4_0_0_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'academic',
    es: 'Biblioteca reúne Global y Este vault en una sola pantalla. Quien actualiza desde Nodus 3 conserva de entrada su corpus, filtros, análisis y colecciones monitorizadas, y puede activar la biblioteca transversal cuando quiera.',
    en: 'Library brings Global and This vault into one screen. People updating from Nodus 3 initially keep their corpus, filters, analyses and monitored collections, and can enable the cross-vault library whenever they choose.',
    fr: 'Bibliothèque réunit Global et Ce coffre sur un seul écran. Après une mise à jour depuis Nodus 3, le corpus, les filtres, les analyses et les collections surveillées restent disponibles, et la bibliothèque transversale peut être activée à tout moment.',
    de: 'Bibliothek vereint Global und Dieser Tresor in einer Ansicht. Nach einem Update von Nodus 3 bleiben Korpus, Filter, Analysen und überwachte Sammlungen zunächst erhalten, und die tresorübergreifende Bibliothek kann jederzeit aktiviert werden.',
    pt: 'Biblioteca reúne Global e Este cofre num único ecrã. Quem atualiza a partir do Nodus 3 mantém inicialmente o corpus, os filtros, as análises e as coleções monitorizadas, podendo ativar a biblioteca transversal quando quiser.',
    'pt-BR': 'Biblioteca reúne Global e Este cofre em uma única tela. Quem atualiza do Nodus 3 mantém inicialmente o corpus, os filtros, as análises e as coleções monitoradas, podendo ativar a biblioteca transversal quando quiser.',
  },
  {
    scope: 'general',
    es: 'La migración global es opcional, muestra inventario, espacio y progreso, y se puede cancelar, reanudar o revertir sin tocar los vaults fuente. Antes de convertir datos, el primer inicio de Nodus 4 crea y verifica una copia de recuperación pre-v4.',
    en: 'Global migration is optional, shows inventory, space and progress, and can be cancelled, resumed or rolled back without changing source vaults. Before converting data, the first Nodus 4 launch creates and verifies a pre-v4 recovery copy.',
    fr: 'La migration globale est facultative, affiche l’inventaire, l’espace et la progression, et peut être annulée, reprise ou inversée sans modifier les coffres sources. Avant toute conversion, le premier lancement de Nodus 4 crée et vérifie une copie de récupération pré-v4.',
    de: 'Die globale Migration ist optional, zeigt Bestand, Speicherbedarf und Fortschritt und kann abgebrochen, fortgesetzt oder zurückgerollt werden, ohne Quelltresore zu ändern. Vor der Konvertierung erstellt und prüft der erste Start von Nodus 4 eine Vor-v4-Sicherung.',
    pt: 'A migração global é opcional, mostra inventário, espaço e progresso e pode ser cancelada, retomada ou revertida sem alterar os cofres de origem. Antes de converter dados, o primeiro arranque do Nodus 4 cria e verifica uma cópia de recuperação pré-v4.',
    'pt-BR': 'A migração global é opcional, mostra inventário, espaço e progresso e pode ser cancelada, retomada ou revertida sem alterar os cofres de origem. Antes de converter dados, a primeira inicialização do Nodus 4 cria e verifica uma cópia de recuperação pré-v4.',
  },
  {
    scope: 'academic',
    es: 'Nodus ya puede mantener una biblioteca sin Zotero. Crea y edita referencias, autores, etiquetas, relaciones, adjuntos y colecciones, añade búsquedas inteligentes y papelera, resuelve identificadores y produce importaciones, exportaciones y citas sin red.',
    en: 'Nodus can now maintain a library without Zotero. Create and edit references, authors, tags, relations, attachments and collections, add smart searches and trash, resolve identifiers, and produce offline imports, exports and citations.',
    fr: 'Nodus peut maintenant gérer une bibliothèque sans Zotero. Créez et modifiez les références, auteurs, étiquettes, relations, pièces jointes et collections, utilisez les recherches intelligentes et la corbeille, résolvez les identifiants et produisez des imports, exports et citations hors ligne.',
    de: 'Nodus kann jetzt eine Bibliothek ohne Zotero verwalten. Referenzen, Urheber, Tags, Beziehungen, Anhänge und Sammlungen lassen sich erstellen und bearbeiten. Hinzu kommen intelligente Suchen, Papierkorb, Kennungsauflösung sowie Offline-Importe, Exporte und Zitate.',
    pt: 'O Nodus pode agora manter uma biblioteca sem o Zotero. Crie e edite referências, autores, etiquetas, relações, anexos e coleções, use pesquisas inteligentes e o lixo, resolva identificadores e produza importações, exportações e citações sem rede.',
    'pt-BR': 'O Nodus agora pode manter uma biblioteca sem o Zotero. Crie e edite referências, autores, etiquetas, relações, anexos e coleções, use pesquisas inteligentes e a lixeira, resolva identificadores e produza importações, exportações e citações sem rede.',
  },
  {
    scope: 'academic',
    es: 'La Biblioteca se adapta al trabajo diario. Arrastra archivos a una colección, abre acciones con el botón derecho, configura y mueve columnas y deja que Nodus infiera la ficha. Los documentos breves muestran progreso y los largos pasan a una cola en segundo plano mientras se abre el original.',
    en: 'Library now fits everyday work. Drop files into a collection, open actions with a right click, configure and move columns, and let Nodus infer the record. Short documents show progress while long ones enter a background queue and open the original.',
    fr: 'La Bibliothèque s’adapte au travail quotidien. Déposez des fichiers dans une collection, ouvrez les actions par clic droit, configurez et déplacez les colonnes et laissez Nodus déduire la notice. Les documents courts affichent leur progression et les longs rejoignent une file en arrière-plan pendant l’ouverture de l’original.',
    de: 'Die Bibliothek passt zum Arbeitsalltag. Dateien lassen sich in Sammlungen ziehen, Aktionen per Rechtsklick öffnen und Spalten konfigurieren und verschieben. Nodus leitet den Datensatz ab. Kurze Dokumente zeigen Fortschritt, lange gehen in eine Hintergrundwarteschlange und öffnen das Original.',
    pt: 'A Biblioteca adapta-se ao trabalho diário. Arraste ficheiros para uma coleção, abra ações com o botão direito, configure e mova colunas e deixe o Nodus inferir o registo. Documentos curtos mostram progresso e os longos entram numa fila em segundo plano enquanto o original abre.',
    'pt-BR': 'A Biblioteca se adapta ao trabalho diário. Arraste arquivos para uma coleção, abra ações com o botão direito, configure e mova colunas e deixe o Nodus inferir o registro. Documentos curtos mostram progresso e os longos entram numa fila em segundo plano enquanto o original abre.',
  },
  {
    scope: 'academic',
    es: 'El lector limpio conserva el original por separado y enlaza texto, páginas, imágenes, tablas y figuras. Permite subrayar, anotar, marcar secciones y preguntar al chat, mientras las huellas exactas impiden mostrar análisis obsoletos como actuales.',
    en: 'The clean reader keeps the original separate and links text, pages, images, tables and figures. It supports highlights, notes, section bookmarks and chat questions, while exact fingerprints prevent stale analysis from appearing current.',
    fr: 'Le lecteur propre conserve l’original séparé et relie texte, pages, images, tableaux et figures. Il permet de surligner, annoter, marquer des sections et interroger le chat, tandis que des empreintes exactes empêchent une analyse obsolète de paraître actuelle.',
    de: 'Der bereinigte Reader hält das Original getrennt und verknüpft Text, Seiten, Bilder, Tabellen und Abbildungen. Markierungen, Notizen, Abschnittslesezeichen und Chatfragen sind möglich, während exakte Fingerabdrücke veraltete Analysen kenntlich machen.',
    pt: 'O leitor limpo mantém o original separado e liga texto, páginas, imagens, tabelas e figuras. Permite sublinhar, anotar, marcar secções e perguntar ao chat, enquanto impressões digitais exatas impedem que análises obsoletas pareçam atuais.',
    'pt-BR': 'O leitor limpo mantém o original separado e liga texto, páginas, imagens, tabelas e figuras. Permite destacar, anotar, marcar seções e perguntar ao chat, enquanto impressões digitais exatas impedem que análises obsoletas pareçam atuais.',
  },
  {
    scope: 'academic',
    es: 'El lector abre Markdown limpio, PDF, EPUB, documentos, hojas de cálculo e imágenes en pestañas compactas. La búsqueda funciona en todos los formatos, las vistas continua e individual conservan subrayados al ampliar y el chat comparte las capacidades de Nodi para citar el documento y el vault.',
    en: 'The reader opens clean Markdown, PDF, EPUB, documents, spreadsheets, and images in compact tabs. Search works across formats, continuous and single-page views preserve highlights while zooming, and chat shares Nodi capabilities for citing the document and vault.',
    fr: 'Le lecteur ouvre Markdown propre, PDF, EPUB, documents, feuilles de calcul et images dans des onglets compacts. La recherche fonctionne dans tous les formats, les vues continue et page unique conservent les surlignages au zoom et le chat partage les capacités de Nodi pour citer le document et le coffre.',
    de: 'Der Reader öffnet bereinigtes Markdown, PDF, EPUB, Dokumente, Tabellen und Bilder in kompakten Reitern. Die Suche funktioniert in allen Formaten, fortlaufende und Einzelseitenansicht bewahren Markierungen beim Zoomen und der Chat nutzt Nodi-Fähigkeiten für Belege aus Dokument und Tresor.',
    pt: 'O leitor abre Markdown limpo, PDF, EPUB, documentos, folhas de cálculo e imagens em separadores compactos. A pesquisa funciona em todos os formatos, as vistas contínua e individual preservam os sublinhados ao ampliar e o chat partilha as capacidades do Nodi para citar o documento e o cofre.',
    'pt-BR': 'O leitor abre Markdown limpo, PDF, EPUB, documentos, planilhas e imagens em abas compactas. A pesquisa funciona em todos os formatos, as vistas contínua e individual preservam destaques ao ampliar e o chat compartilha os recursos do Nodi para citar o documento e o cofre.',
  },
  {
    scope: 'plugin',
    es: 'Las citas llegan a Biblioteca, Word y LibreOffice con referencias vivas, notas y bibliografías. Los selectores buscan sin depender de guiones o acentos y el gestor instala estilos del repositorio oficial CSL o de tu Zotero conservando su licencia. El conector del navegador añade páginas y archivos con colección y etiquetas.',
    en: 'Citations reach Library, Word, and LibreOffice with live references, notes, and bibliographies. Style pickers search without depending on hyphens or accents and the manager installs styles from the official CSL repository or your Zotero while preserving their license. The browser connector adds pages and files with collections and tags.',
    fr: 'Les citations arrivent dans Bibliothèque, Word et LibreOffice avec références actives, notes et bibliographies. Les sélecteurs recherchent sans dépendre des traits d’union ou accents et le gestionnaire installe les styles du dépôt CSL officiel ou de votre Zotero en préservant leur licence. Le connecteur du navigateur ajoute pages et fichiers avec collection et étiquettes.',
    de: 'Zitate kommen mit lebenden Referenzen, Fußnoten und Bibliografien in Bibliothek, Word und LibreOffice. Die Stilsuche hängt nicht von Bindestrichen oder Akzenten ab und installiert Stile aus dem offiziellen CSL-Repository oder Zotero unter Erhalt der Lizenz. Der Browser-Connector fügt Seiten und Dateien mit Sammlung und Tags hinzu.',
    pt: 'As citações chegam à Biblioteca, Word e LibreOffice com referências vivas, notas e bibliografias. Os seletores pesquisam sem depender de hífenes ou acentos e o gestor instala estilos do repositório CSL oficial ou do seu Zotero preservando a licença. O conector do navegador adiciona páginas e ficheiros com coleção e etiquetas.',
    'pt-BR': 'As citações chegam à Biblioteca, Word e LibreOffice com referências vivas, notas e bibliografias. Os seletores pesquisam sem depender de hífens ou acentos e o gerenciador instala estilos do repositório CSL oficial ou do seu Zotero preservando a licença. O conector do navegador adiciona páginas e arquivos com coleção e etiquetas.',
  },
  {
    scope: 'general',
    es: 'Nodus 4 se publica bajo AGPL-3.0 exclusivamente. Acerca de Nodus muestra la licencia y el código fuente exacto de la versión, y Nodus Server ofrece el mismo enlace a toda persona que lo usa por red.',
    en: 'Nodus 4 is released exclusively under AGPL-3.0. About Nodus shows the license and exact source code for this version, and Nodus Server offers the same link to everyone who uses it over a network.',
    fr: 'Nodus 4 est publié exclusivement sous AGPL-3.0. À propos de Nodus affiche la licence et le code source exact de cette version, et Nodus Server propose le même lien à toute personne qui l’utilise par le réseau.',
    de: 'Nodus 4 wird ausschließlich unter AGPL-3.0 veröffentlicht. Über Nodus zeigt die Lizenz und den genauen Quellcode dieser Version, und Nodus Server bietet denselben Link allen an, die ihn über ein Netzwerk nutzen.',
    pt: 'O Nodus 4 é publicado exclusivamente sob AGPL-3.0. Acerca do Nodus mostra a licença e o código-fonte exato desta versão, e o Nodus Server oferece a mesma ligação a todas as pessoas que o usam pela rede.',
    'pt-BR': 'O Nodus 4 é publicado exclusivamente sob AGPL-3.0. Sobre o Nodus mostra a licença e o código-fonte exato desta versão, e o Nodus Server oferece o mesmo link a todas as pessoas que o usam pela rede.',
  },
];

const RELEASE_4_2_4_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'browser',
    es: 'El botón de medios del navegador vuelve a decir la verdad y a obedecer. Antes daba por pausada una pestaña en cuanto cualquier reproductor de repuesto de la página se detenía, así que ofrecía Reproducir sobre algo que ya sonaba y pulsarlo no hacía nada. Ahora Nodus mira toda la página, incluidos marcos del mismo sitio y componentes propios, y actúa sobre la pista que realmente estás escuchando.',
    en: 'The browser media button tells the truth again, and obeys. It used to call a tab paused as soon as any spare player on the page stopped, so it offered Play for audio that was already running and pressing it did nothing. Nodus now looks at the whole page, including same-site frames and custom components, and acts on the track you are actually listening to.',
    fr: 'Le bouton multimédia du navigateur redit la vérité et obéit. Il considérait un onglet en pause dès qu’un lecteur de réserve de la page s’arrêtait, proposait donc Lecture sur un son qui jouait déjà et rester sans effet. Nodus examine désormais toute la page, y compris les cadres du même site et les composants propres, et agit sur la piste que vous écoutez vraiment.',
    de: 'Die Medienschaltfläche im Browser sagt wieder die Wahrheit und gehorcht. Sie hielt einen Tab für pausiert, sobald irgendein Reserve-Player der Seite stoppte, bot also Wiedergabe für bereits laufenden Ton an und tat beim Drücken nichts. Nodus betrachtet jetzt die ganze Seite, samt Rahmen derselben Site und eigener Komponenten, und wirkt auf den Titel, den Sie wirklich hören.',
    pt: 'O botão de multimédia do navegador volta a dizer a verdade e a obedecer. Dava uma aba por pausada assim que qualquer leitor sobresselente da página parava, por isso oferecia Reproduzir sobre som que já tocava e premi-lo não fazia nada. O Nodus olha agora para a página inteira, incluindo molduras do mesmo sítio e componentes próprios, e atua sobre a faixa que está mesmo a ouvir.',
    'pt-BR': 'O botão de mídia do navegador volta a dizer a verdade e a obedecer. Ele dava uma aba como pausada assim que qualquer player reserva da página parava, então oferecia Reproduzir sobre um áudio que já tocava e apertá-lo não fazia nada. O Nodus agora olha a página inteira, incluindo quadros do mesmo site e componentes próprios, e age sobre a faixa que você está realmente ouvindo.',
  },
  {
    scope: 'browser',
    es: 'Abrir el panel de medios ya no hace desaparecer la web. La página se congela en su sitio mientras el panel está abierto y reaparece intacta al cerrarlo.',
    en: 'Opening the media panel no longer makes the website vanish. The page freezes in place while the panel is open and comes back untouched when it closes.',
    fr: 'Ouvrir le panneau multimédia ne fait plus disparaître le site. La page se fige à sa place tant que le panneau est ouvert et revient intacte à sa fermeture.',
    de: 'Das Öffnen des Medienpanels lässt die Website nicht mehr verschwinden. Die Seite friert an Ort und Stelle ein, solange das Panel offen ist, und kehrt beim Schließen unverändert zurück.',
    pt: 'Abrir o painel de multimédia já não faz o site desaparecer. A página congela no lugar enquanto o painel está aberto e regressa intacta quando se fecha.',
    'pt-BR': 'Abrir o painel de mídia não faz mais o site sumir. A página congela no lugar enquanto o painel está aberto e volta intacta quando ele fecha.',
  },
  {
    scope: 'browser',
    es: 'El menú del botón derecho ofrece Cortar, Copiar y Pegar en los campos de texto, en ese orden. La barra de direcciones y el resto de campos de Nodus también tienen ya su propio menú, que antes no aparecía.',
    en: 'The right-click menu offers Cut, Copy and Paste in text fields, in that order. The address bar and every other Nodus field now have their own menu too, where none appeared before.',
    fr: 'Le menu contextuel propose Couper, Copier et Coller dans les champs de texte, dans cet ordre. La barre d’adresse et les autres champs de Nodus ont aussi leur propre menu, là où aucun n’apparaissait.',
    de: 'Das Kontextmenü bietet in Textfeldern Ausschneiden, Kopieren und Einfügen, in dieser Reihenfolge. Auch die Adressleiste und alle anderen Felder in Nodus haben jetzt ein eigenes Menü, wo zuvor keines erschien.',
    pt: 'O menu do botão direito oferece Cortar, Copiar e Colar nos campos de texto, por esta ordem. A barra de endereços e os restantes campos do Nodus passam a ter também o seu próprio menu, que antes não aparecia.',
    'pt-BR': 'O menu do botão direito oferece Recortar, Copiar e Colar nos campos de texto, nessa ordem. A barra de endereços e os demais campos do Nodus agora também têm seu próprio menu, que antes não aparecia.',
  },
  {
    scope: 'browser',
    es: 'Cmd o Ctrl más T abre una pestaña nueva, también mientras estás leyendo una página. Y si pulsas Atrás o Adelante con Cmd o Ctrl, o con el botón central, esa página se abre en una pestaña nueva sin mover la actual.',
    en: 'Cmd or Ctrl plus T opens a new tab, including while you are reading a page. And clicking Back or Forward with Cmd or Ctrl, or with the middle button, opens that page in a new tab without moving the current one.',
    fr: 'Cmd ou Ctrl plus T ouvre un nouvel onglet, y compris pendant la lecture d’une page. Et cliquer sur Précédent ou Suivant avec Cmd ou Ctrl, ou avec le bouton du milieu, ouvre cette page dans un nouvel onglet sans déplacer l’onglet courant.',
    de: 'Cmd oder Strg plus T öffnet einen neuen Tab, auch während Sie eine Seite lesen. Und ein Klick auf Zurück oder Vorwärts mit Cmd oder Strg oder mit der mittleren Taste öffnet diese Seite in einem neuen Tab, ohne den aktuellen zu bewegen.',
    pt: 'Cmd ou Ctrl mais T abre um separador novo, mesmo enquanto está a ler uma página. E clicar em Retroceder ou Avançar com Cmd ou Ctrl, ou com o botão do meio, abre essa página num separador novo sem mexer no atual.',
    'pt-BR': 'Cmd ou Ctrl mais T abre uma aba nova, inclusive enquanto você está lendo uma página. E clicar em Voltar ou Avançar com Cmd ou Ctrl, ou com o botão do meio, abre essa página em uma aba nova sem mexer na atual.',
  },
];

const RELEASE_4_2_5_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    scope: 'general',
    es: 'Nodus deja de instalarse dos veces en macOS. Cada actualización apartaba la versión anterior y la dejaba ahí para siempre, y macOS la seguía viendo como una aplicación más. De ahí venían los dos iconos de Nodus en el Dock. Al abrir esta versión, esa copia se borra sola y recuperas casi 2 GB de disco.',
    en: 'Nodus stops installing itself twice on macOS. Every update set the previous version aside and left it there for good, and macOS went on seeing it as another application. That is where the two Nodus icons in the Dock came from. Opening this version deletes that copy on its own and gives you back nearly 2 GB of disk.',
    fr: 'Nodus cesse de s’installer en double sur macOS. Chaque mise à jour mettait la version précédente de côté et l’y laissait pour de bon, et macOS continuait de la voir comme une application à part entière. D’où les deux icônes Nodus dans le Dock. Ouvrir cette version supprime cette copie toute seule et vous rend près de 2 Go de disque.',
    de: 'Nodus installiert sich auf macOS nicht mehr doppelt. Jedes Update stellte die vorherige Version beiseite und ließ sie dort für immer, und macOS sah sie weiterhin als eigene Anwendung. Daher die zwei Nodus-Symbole im Dock. Beim Öffnen dieser Version wird diese Kopie von selbst gelöscht und gibt fast 2 GB Speicher frei.',
    pt: 'O Nodus deixa de se instalar duas vezes no macOS. Cada atualização punha a versão anterior de lado e deixava-a lá para sempre, e o macOS continuava a vê-la como mais uma aplicação. Era daí que vinham os dois ícones do Nodus na Dock. Ao abrir esta versão, essa cópia apaga-se sozinha e recupera quase 2 GB de disco.',
    'pt-BR': 'O Nodus para de se instalar duas vezes no macOS. Cada atualização punha a versão anterior de lado e a deixava ali para sempre, e o macOS continuava enxergando ela como mais um aplicativo. Era daí que vinham os dois ícones do Nodus no Dock. Ao abrir esta versão, essa cópia se apaga sozinha e você recupera quase 2 GB de disco.',
  },
];

/**
 * v5.1.0 groups the user-visible result of every merged pull request from #599
 * through #623 by product surface. Infrastructure-only work stays inside the
 * surface it repaired instead of becoming a separate, repetitive announcement.
 * Keep this list aligned by index with the Italian and Turkish tables.
 */
const RELEASE_5_1_0_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    category: 'enhancement',
    scope: 'ai',
    es: 'El modo Automático reparte el trabajo de IA en paralelo y ajusta el ritmo según cada proveedor, modelo y credencial. En las pruebas certificadas, la indexación terminó más del doble de rápido sin perder citas, orden ni controles de integridad. Las barras de proceso muestran ahora el tiempo total y el de cada elemento. Si necesitas limitar la carga, puedes elegir entre 1 y 8 tareas simultáneas.',
    en: 'Automatic mode now runs AI work in parallel and adjusts its pace for each provider, model, and credential. In certified tests, indexing finished more than twice as fast without losing citations, ordering, or integrity checks. Processing bars now show both total time and time per item. If you need to limit the load, you can choose between 1 and 8 simultaneous tasks.',
    fr: 'Le mode Automatique répartit désormais le travail de l’IA en parallèle et adapte son rythme à chaque fournisseur, modèle et identifiant. Lors des tests certifiés, l’indexation s’est terminée plus de deux fois plus vite sans perdre de citations, d’ordre ni de contrôles d’intégrité. Les barres de traitement affichent maintenant la durée totale et celle de chaque élément. Pour limiter la charge, vous pouvez choisir entre 1 et 8 tâches simultanées.',
    de: 'Der automatische Modus verteilt KI-Arbeit nun parallel und passt das Tempo an Anbieter, Modell und Zugangsdaten an. In zertifizierten Tests war die Indexierung mehr als doppelt so schnell, ohne Zitate, Reihenfolge oder Integritätsprüfungen zu verlieren. Fortschrittsleisten zeigen jetzt die Gesamtzeit und die Zeit pro Element. Bei Bedarf lässt sich die Last auf 1 bis 8 gleichzeitige Aufgaben begrenzen.',
    pt: 'O modo Automático distribui agora o trabalho de IA em paralelo e ajusta o ritmo a cada fornecedor, modelo e credencial. Nos testes certificados, a indexação terminou mais de duas vezes mais depressa sem perder citações, ordem nem controlos de integridade. As barras de processamento mostram agora o tempo total e o de cada elemento. Se precisar de limitar a carga, pode escolher entre 1 e 8 tarefas simultâneas.',
    'pt-BR': 'O modo Automático agora distribui o trabalho de IA em paralelo e ajusta o ritmo para cada provedor, modelo e credencial. Nos testes certificados, a indexação terminou mais de duas vezes mais rápido sem perder citações, ordem ou verificações de integridade. As barras de processamento mostram o tempo total e o de cada item. Se precisar limitar a carga, você pode escolher entre 1 e 8 tarefas simultâneas.',
  },
  {
    category: 'fix',
    scope: 'ai',
    es: 'Los modelos de LM Studio, Ollama y Nodus tienen ahora tiempo suficiente para completar análisis exigentes. Si un fragmento resulta demasiado pesado, Nodus lo divide y continúa en lugar de abandonar todo el documento. Los errores explican su causa en el idioma de la interfaz y el selector general permite cargar y guardar modelos sin volver al asistente inicial.',
    en: 'Models from LM Studio, Ollama, and Nodus now have enough time to complete demanding analyses. If a passage is too heavy, Nodus splits it and continues instead of abandoning the whole document. Errors explain their cause in the interface language, and the general selector can load and save models without returning to the initial setup wizard.',
    fr: 'Les modèles de LM Studio, Ollama et Nodus disposent désormais d’assez de temps pour terminer les analyses exigeantes. Si un passage est trop lourd, Nodus le divise et continue au lieu d’abandonner tout le document. Les erreurs expliquent leur cause dans la langue de l’interface et le sélecteur général permet de charger et d’enregistrer des modèles sans revenir à l’assistant initial.',
    de: 'Modelle aus LM Studio, Ollama und Nodus haben jetzt genügend Zeit für anspruchsvolle Analysen. Ist ein Abschnitt zu aufwendig, teilt Nodus ihn und arbeitet weiter, statt das gesamte Dokument abzubrechen. Fehlermeldungen erklären die Ursache in der Sprache der Oberfläche, und über die allgemeine Auswahl lassen sich Modelle laden und speichern, ohne zum Einrichtungsassistenten zurückzukehren.',
    pt: 'Os modelos do LM Studio, Ollama e Nodus têm agora tempo suficiente para concluir análises exigentes. Se um excerto for demasiado pesado, o Nodus divide-o e continua em vez de abandonar todo o documento. Os erros explicam a causa no idioma da interface e o seletor geral permite carregar e guardar modelos sem voltar ao assistente inicial.',
    'pt-BR': 'Os modelos do LM Studio, Ollama e Nodus agora têm tempo suficiente para concluir análises exigentes. Se um trecho for pesado demais, o Nodus o divide e continua em vez de abandonar o documento inteiro. Os erros explicam a causa no idioma da interface, e o seletor geral permite carregar e salvar modelos sem voltar ao assistente inicial.',
  },
  {
    category: 'enhancement',
    scope: 'zotero',
    es: 'La importación recorre completas las bibliotecas personales y de grupo, incluidos adjuntos, notas, colecciones, documentos independientes y metadatos bibliográficos. Nodus verifica cada copia, repara archivos incompletos y permite reanudar una importación cancelada sin dar por terminado un trabajo defectuoso. Los nombres de archivo largos ya no detienen el proceso y los errores de conexión indican cómo resolverlos. El asistente distingue visualmente Nodus Library y Zotero, y conecta directamente con la API local correcta.',
    en: 'Import now traverses complete personal and group libraries, including attachments, notes, collections, standalone documents, and bibliographic metadata. Nodus verifies every copy, repairs incomplete files, and lets a cancelled import resume without marking faulty work as complete. Long filenames no longer stop the process, and connection errors explain how to fix them. The setup wizard visually distinguishes Nodus Library from Zotero and connects directly to the correct local API.',
    fr: 'L’importation parcourt désormais intégralement les bibliothèques personnelles et de groupe, y compris les pièces jointes, notes, collections, documents autonomes et métadonnées bibliographiques. Nodus vérifie chaque copie, répare les fichiers incomplets et permet de reprendre une importation annulée sans considérer un travail défectueux comme terminé. Les noms de fichier longs n’interrompent plus le processus et les erreurs de connexion indiquent comment les résoudre. L’assistant distingue visuellement Nodus Library de Zotero et se connecte directement à la bonne API locale.',
    de: 'Der Import durchläuft jetzt vollständige persönliche und Gruppenbibliotheken einschließlich Anhängen, Notizen, Sammlungen, eigenständigen Dokumenten und bibliografischen Metadaten. Nodus prüft jede Kopie, repariert unvollständige Dateien und setzt abgebrochene Importe fort, ohne fehlerhafte Arbeit als abgeschlossen zu markieren. Lange Dateinamen stoppen den Vorgang nicht mehr, und Verbindungsfehler erklären die Lösung. Der Assistent unterscheidet Nodus Library und Zotero visuell und verbindet sich direkt mit der richtigen lokalen API.',
    pt: 'A importação percorre agora bibliotecas pessoais e de grupo completas, incluindo anexos, notas, coleções, documentos independentes e metadados bibliográficos. O Nodus verifica cada cópia, repara ficheiros incompletos e permite retomar uma importação cancelada sem dar por concluído um trabalho defeituoso. Os nomes de ficheiro longos já não interrompem o processo e os erros de ligação explicam como resolvê-los. O assistente distingue visualmente Nodus Library e Zotero e liga-se diretamente à API local correta.',
    'pt-BR': 'A importação agora percorre bibliotecas pessoais e de grupo completas, incluindo anexos, notas, coleções, documentos independentes e metadados bibliográficos. O Nodus verifica cada cópia, repara arquivos incompletos e permite retomar uma importação cancelada sem marcar um trabalho defeituoso como concluído. Nomes de arquivo longos não interrompem mais o processo, e os erros de conexão explicam como resolvê-los. O assistente diferencia visualmente Nodus Library e Zotero e se conecta diretamente à API local correta.',
  },
  {
    category: 'enhancement',
    scope: 'server',
    es: 'La interfaz web se acerca mucho más a la aplicación de escritorio en navegación, edición, búsqueda, Deep Research y compatibilidad con los distintos tipos de bóveda. También se han corregido los ajustes, los indicadores de carga, el acceso a bibliotecas sin publicar y varios textos que aparecían sin traducir. Las imágenes de servidor vuelven a arrancar correctamente y mantienen soporte para AMD64 y ARM64.',
    en: 'The web interface now matches the desktop app much more closely in navigation, editing, search, Deep Research, and support for the different vault types. Settings, loading feedback, access to unpublished libraries, and several untranslated labels have also been fixed. Server images start correctly again and continue to support both AMD64 and ARM64.',
    fr: 'L’interface web se rapproche beaucoup plus de l’application de bureau pour la navigation, l’édition, la recherche, Deep Research et la prise en charge des différents types de coffre. Les paramètres, les indicateurs de chargement, l’accès aux bibliothèques non publiées et plusieurs textes non traduits ont également été corrigés. Les images du serveur démarrent de nouveau correctement et restent compatibles avec AMD64 et ARM64.',
    de: 'Die Weboberfläche entspricht der Desktop-App nun deutlich besser bei Navigation, Bearbeitung, Suche, Deep Research und der Unterstützung verschiedener Tresortypen. Auch Einstellungen, Ladeanzeigen, der Zugriff auf unveröffentlichte Bibliotheken und mehrere unübersetzte Texte wurden korrigiert. Die Server-Images starten wieder zuverlässig und unterstützen weiterhin AMD64 und ARM64.',
    pt: 'A interface web aproxima-se muito mais da aplicação de desktop na navegação, edição, pesquisa, Deep Research e compatibilidade com os diferentes tipos de cofre. Também foram corrigidas as definições, os indicadores de carregamento, o acesso a bibliotecas não publicadas e vários textos que apareciam sem tradução. As imagens do servidor voltam a arrancar corretamente e mantêm suporte para AMD64 e ARM64.',
    'pt-BR': 'A interface web agora se aproxima muito mais do aplicativo para desktop em navegação, edição, busca, Deep Research e compatibilidade com os diferentes tipos de cofre. Também foram corrigidas as configurações, os indicadores de carregamento, o acesso a bibliotecas não publicadas e vários textos que apareciam sem tradução. As imagens do servidor voltam a iniciar corretamente e mantêm suporte para AMD64 e ARM64.',
  },
  {
    category: 'enhancement',
    scope: 'library',
    es: 'Una guía breve explica la diferencia entre «Este vault» y «Global», cómo importar, monitorizar y procesar colecciones, y dónde encontrar el índice documental. Ese índice pasa a ser opcional para cada obra y su ausencia ya no reduce el estado de finalización. También desaparece la pregunta sobre comprensión documental que interrumpía el inicio de la aplicación.',
    en: 'A short guide explains the difference between “This vault” and “Global”, how to import, monitor, and process collections, and where to find the Documentary Index. That index is now optional for each work, and its absence no longer lowers completion status. The document-understanding question that interrupted application startup has also been removed.',
    fr: 'Un guide court explique la différence entre « Ce coffre » et « Global », comment importer, surveiller et traiter des collections, et où trouver l’Index documentaire. Cet index devient facultatif pour chaque œuvre et son absence ne réduit plus l’état d’achèvement. La question sur la compréhension des documents qui interrompait le démarrage de l’application a également disparu.',
    de: 'Eine kurze Anleitung erklärt den Unterschied zwischen „Dieser Tresor“ und „Global“, wie Sammlungen importiert, überwacht und verarbeitet werden und wo der Dokumentindex zu finden ist. Dieser Index ist nun für jedes Werk optional, und sein Fehlen senkt den Abschlussstatus nicht mehr. Die Frage zum Dokumentverständnis, die den App-Start unterbrach, wurde ebenfalls entfernt.',
    pt: 'Um guia breve explica a diferença entre «Este cofre» e «Global», como importar, monitorizar e processar coleções e onde encontrar o Índice documental. Esse índice passa a ser opcional para cada obra e a sua ausência já não reduz o estado de conclusão. Também desaparece a pergunta sobre compreensão documental que interrompia o arranque da aplicação.',
    'pt-BR': 'Um guia breve explica a diferença entre “Este cofre” e “Global”, como importar, monitorar e processar coleções e onde encontrar o Índice documental. Esse índice agora é opcional para cada obra, e sua ausência não reduz mais o estado de conclusão. Também foi removida a pergunta sobre compreensão documental que interrompia a inicialização do aplicativo.',
  },
  {
    category: 'new',
    scope: 'databases',
    es: 'Deep Research adopta en las bóvedas de Bases de datos el mismo flujo claro de biblioteca, composición, cola y lectura que ya tenía el modo académico. Incluye configuración local automática, trabajo con varias bases, estado de lectura persistente, anotaciones y exportaciones. Las opciones de roles y edición previa del informe siguen disponibles como ajustes avanzados.',
    en: 'Deep Research in Database vaults now uses the same clear library, composer, queue, and reading flow as the academic mode. It includes automatic local setup, work across multiple databases, persistent reading state, annotations, and exports. Role options and report preview editing remain available as advanced settings.',
    fr: 'Deep Research adopte dans les coffres Bases de données le même parcours clair de bibliothèque, composition, file d’attente et lecture que le mode académique. Il comprend une configuration locale automatique, le travail sur plusieurs bases, un état de lecture persistant, des annotations et des exportations. Les options de rôles et la modification préalable du rapport restent disponibles dans les paramètres avancés.',
    de: 'Deep Research verwendet in Datenbanktresoren jetzt denselben klaren Ablauf für Bibliothek, Erstellung, Warteschlange und Lesen wie im akademischen Modus. Dazu gehören automatische lokale Einrichtung, Arbeit mit mehreren Datenbanken, ein dauerhafter Lesestatus, Anmerkungen und Exporte. Rollenoptionen und die Bearbeitung der Berichtsvorschau bleiben als erweiterte Einstellungen verfügbar.',
    pt: 'O Deep Research adota nos cofres de Bases de dados o mesmo fluxo claro de biblioteca, composição, fila e leitura do modo académico. Inclui configuração local automática, trabalho com várias bases, estado de leitura persistente, anotações e exportações. As opções de funções e a edição prévia do relatório continuam disponíveis como definições avançadas.',
    'pt-BR': 'O Deep Research agora usa nos cofres de Bancos de dados o mesmo fluxo claro de biblioteca, composição, fila e leitura do modo acadêmico. Ele inclui configuração local automática, trabalho com vários bancos, estado de leitura persistente, anotações e exportações. As opções de funções e a edição prévia do relatório continuam disponíveis como configurações avançadas.',
  },
  {
    category: 'enhancement',
    scope: 'word',
    es: 'Ideas, Pasajes y Sinónimos permiten elegir su propio modelo. La generación de sinónimos entiende mejor la frase completa y devuelve alternativas válidas incluso cuando el proveedor cambia el formato de la respuesta. La cinta de Word incorpora accesos directos a Edición con IA, Sinónimos y Chat, y el selector de estilos ya no aparece desplegado al abrir el complemento.',
    en: 'Ideas, Passages, and Synonyms can each use their own selected model. Synonym generation understands the full sentence better and returns valid alternatives even when the provider changes its response format. The Word ribbon adds shortcuts to AI Edit, Synonyms, and Chat, and the style picker no longer opens expanded when the add-in starts.',
    fr: 'Idées, Passages et Synonymes permettent chacun de choisir leur propre modèle. La génération de synonymes comprend mieux la phrase entière et renvoie des alternatives valides même lorsque le fournisseur modifie le format de sa réponse. Le ruban Word ajoute des raccourcis vers Édition par IA, Synonymes et Chat, et le sélecteur de styles ne s’ouvre plus déplié au démarrage du complément.',
    de: 'Ideen, Passagen und Synonyme können jeweils ein eigenes Modell verwenden. Die Synonymerzeugung versteht den vollständigen Satz besser und liefert gültige Alternativen, selbst wenn der Anbieter das Antwortformat ändert. Das Word-Menüband erhält Verknüpfungen zu KI-Bearbeitung, Synonymen und Chat, und die Stilauswahl wird beim Start des Add-ins nicht mehr aufgeklappt.',
    pt: 'Ideias, Passagens e Sinónimos permitem escolher o seu próprio modelo. A geração de sinónimos compreende melhor a frase completa e devolve alternativas válidas mesmo quando o fornecedor altera o formato da resposta. O friso do Word incorpora atalhos para Edição com IA, Sinónimos e Chat, e o seletor de estilos já não aparece expandido ao abrir o suplemento.',
    'pt-BR': 'Ideias, Passagens e Sinônimos permitem escolher seu próprio modelo. A geração de sinônimos entende melhor a frase completa e retorna alternativas válidas mesmo quando o provedor muda o formato da resposta. A faixa de opções do Word ganha atalhos para Edição com IA, Sinônimos e Chat, e o seletor de estilos não aparece mais expandido ao abrir o suplemento.',
  },
  {
    category: 'enhancement',
    scope: 'connector',
    es: 'La extensión de Chrome pasa a llamarse Nodus Research Connector y enlaza directamente con la web del proyecto. La vinculación con la aplicación utiliza ahora un diálogo claro y traducido, con la opción de cancelar en primer lugar y sin depender de una alerta nativa del sistema.',
    en: 'The Chrome extension is now called Nodus Research Connector and links directly to the project website. Pairing with the application now uses a clear, translated dialog that puts the cancel option first and no longer depends on a native system alert.',
    fr: 'L’extension Chrome s’appelle désormais Nodus Research Connector et renvoie directement vers le site du projet. L’association avec l’application utilise maintenant une boîte de dialogue claire et traduite, qui place l’option d’annulation en premier et ne dépend plus d’une alerte native du système.',
    de: 'Die Chrome-Erweiterung heißt jetzt Nodus Research Connector und führt direkt zur Projektwebsite. Die Kopplung mit der Anwendung verwendet nun einen klaren, übersetzten Dialog, der die Abbrechen-Option an erster Stelle zeigt und nicht mehr von einer nativen Systemmeldung abhängt.',
    pt: 'A extensão do Chrome passa a chamar-se Nodus Research Connector e liga diretamente ao site do projeto. O emparelhamento com a aplicação utiliza agora um diálogo claro e traduzido, com a opção de cancelar em primeiro lugar e sem depender de um alerta nativo do sistema.',
    'pt-BR': 'A extensão do Chrome agora se chama Nodus Research Connector e leva diretamente ao site do projeto. O pareamento com o aplicativo usa um diálogo claro e traduzido, com a opção de cancelar em primeiro lugar e sem depender de um alerta nativo do sistema.',
  },
];

/**
 * v5.1.1 deliberately keeps the complete v5.1.0 announcement and appends the
 * Zotero catalog-only hotfix. This makes the patch modal self-contained without
 * rewriting or dropping anything that shipped in the minor release.
 */
const RELEASE_5_1_1_HIGHLIGHTS: RawReleaseHighlight[] = [
  ...RELEASE_5_1_0_HIGHLIGHTS,
  {
    category: 'fix',
    scope: 'zotero',
    es: 'El botón Actualizar del encabezado ahora solo sincroniza el catálogo de las colecciones de Zotero que monitorizas. Los artículos nuevos aparecen en la Biblioteca sin iniciar ni encolar análisis. También se corrige la versión cero que devolvía Zotero 10 y que podía hacer que toda la biblioteca pareciera modificada de golpe.',
    en: 'The Update button in the header now only refreshes the catalog for the Zotero collections you monitor. New items appear in the Library without starting or queuing analysis. This also fixes Zotero 10 returning item version zero, which could make the entire library appear to have changed at once.',
    fr: 'Le bouton Actualiser de l’en-tête met désormais à jour uniquement le catalogue des collections Zotero que vous surveillez. Les nouveaux éléments apparaissent dans la Bibliothèque sans lancer ni mettre d’analyse en file d’attente. Cette version corrige aussi la valeur zéro renvoyée par Zotero 10, qui pouvait faire croire que toute la bibliothèque avait changé d’un coup.',
    de: 'Die Schaltfläche Aktualisieren in der Kopfzeile aktualisiert jetzt nur den Katalog der überwachten Zotero-Sammlungen. Neue Einträge erscheinen in der Bibliothek, ohne Analysen zu starten oder einzureihen. Außerdem wird die von Zotero 10 gemeldete Elementversion null korrekt behandelt, durch die zuvor die gesamte Bibliothek auf einmal als geändert erscheinen konnte.',
    pt: 'O botão Atualizar do cabeçalho passa a atualizar apenas o catálogo das coleções do Zotero que monitoriza. Os novos elementos aparecem na Biblioteca sem iniciar nem colocar análises em fila. Esta versão também corrige o valor zero devolvido pelo Zotero 10, que podia fazer parecer que toda a biblioteca tinha mudado de uma só vez.',
    'pt-BR': 'O botão Atualizar do cabeçalho agora atualiza apenas o catálogo das coleções do Zotero que você monitora. Os novos itens aparecem na Biblioteca sem iniciar nem colocar análises na fila. Esta versão também corrige o valor zero retornado pelo Zotero 10, que podia fazer parecer que toda a biblioteca havia mudado de uma só vez.',
  },
];

const RELEASE_5_1_3_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    category: 'new',
    scope: 'apple',
    es: 'Nodus para macOS se distribuye ahora firmado con Developer ID y notarizado por Apple. Hardened Runtime protege la aplicación y Gatekeeper verifica la firma y el ticket antes de abrirla. Todos los helpers, frameworks, módulos nativos y binarios incluidos se firman con los permisos mínimos que necesitan.',
    en: 'Nodus for macOS is now distributed with a Developer ID signature and Apple notarization. Hardened Runtime protects the application, and Gatekeeper verifies its signature and ticket before opening it. Every bundled helper, framework, native module, and executable is signed with only the permissions it needs.',
    fr: 'Nodus pour macOS est désormais distribué avec une signature Developer ID et une notarisation Apple. Hardened Runtime protège l’application et Gatekeeper vérifie la signature et le ticket avant son ouverture. Tous les assistants, frameworks, modules natifs et exécutables inclus sont signés avec uniquement les autorisations nécessaires.',
    de: 'Nodus für macOS wird jetzt mit einer Developer-ID-Signatur und Apple-Notarisierung ausgeliefert. Hardened Runtime schützt die Anwendung, und Gatekeeper prüft vor dem Öffnen Signatur und Ticket. Alle enthaltenen Hilfsprogramme, Frameworks, nativen Module und ausführbaren Dateien werden nur mit den benötigten Berechtigungen signiert.',
    pt: 'O Nodus para macOS passa a ser distribuído com assinatura Developer ID e notarização da Apple. O Hardened Runtime protege a aplicação e o Gatekeeper verifica a assinatura e o comprovativo antes de a abrir. Todos os auxiliares, frameworks, módulos nativos e executáveis incluídos são assinados apenas com as permissões necessárias.',
    'pt-BR': 'O Nodus para macOS agora é distribuído com assinatura Developer ID e notarização da Apple. O Hardened Runtime protege o aplicativo e o Gatekeeper verifica a assinatura e o tíquete antes de abri-lo. Todos os auxiliares, frameworks, módulos nativos e executáveis incluídos são assinados apenas com as permissões necessárias.',
  },
  {
    category: 'enhancement',
    scope: 'academic',
    es: 'El Diccionario reparte ahora las fuentes entre distintas obras y autorías en vez de dejar que una sola domine la selección. Combina búsqueda semántica y léxica, identifica el origen de ideas, citas y relaciones, y avisa si una definición no cubre suficientes fuentes o autores.',
    en: 'The Dictionary now spreads evidence across different works and authors instead of letting one source dominate the selection. It combines semantic and lexical search, identifies the origin of ideas, quotations, and relationships, and warns when a definition does not cover enough sources or authors.',
    fr: 'Le Dictionnaire répartit désormais les preuves entre plusieurs œuvres et auteurs au lieu de laisser une seule source dominer la sélection. Il combine recherche sémantique et lexicale, identifie l’origine des idées, citations et relations, et avertit lorsqu’une définition ne couvre pas assez de sources ou d’auteurs.',
    de: 'Das Wörterbuch verteilt Belege jetzt auf verschiedene Werke und Autorinnen oder Autoren, statt eine einzige Quelle die Auswahl bestimmen zu lassen. Es kombiniert semantische und lexikalische Suche, kennzeichnet die Herkunft von Ideen, Zitaten und Beziehungen und warnt, wenn eine Definition nicht genügend Quellen oder Urheber abdeckt.',
    pt: 'O Dicionário distribui agora as provas por diferentes obras e autorias em vez de deixar uma única fonte dominar a seleção. Combina pesquisa semântica e lexical, identifica a origem de ideias, citações e relações e avisa quando uma definição não cobre fontes ou autores suficientes.',
    'pt-BR': 'O Dicionário agora distribui as evidências entre diferentes obras e autorias em vez de deixar uma única fonte dominar a seleção. Ele combina busca semântica e lexical, identifica a origem de ideias, citações e relações e avisa quando uma definição não cobre fontes ou autores suficientes.',
  },
];

/**
 * v5.1.2 keeps the complete v5.1.1 announcement and appends the fixes merged
 * afterwards. The patch remains self-contained for anyone updating from an
 * earlier 5.1 release.
 */
const RELEASE_5_1_2_HIGHLIGHTS: RawReleaseHighlight[] = [
  ...RELEASE_5_1_1_HIGHLIGHTS,
  {
    category: 'enhancement',
    scope: 'word',
    es: 'Nodus Copilot para Word cambia Sinónimos por Alternativas para trabajar también con expresiones y frases completas. La pestaña espera a que pulses Generar y respeta el modelo elegido. Ideas, Pasajes, Edición con IA, Alternativas y Chat comparten ahora un selector de modelos con búsqueda y control por teclado.',
    en: 'Nodus Copilot for Word replaces Synonyms with Alternatives so it can also work with expressions and complete phrases. The tab waits for you to press Generate and respects the model you choose. Ideas, Passages, AI Edit, Alternatives, and Chat now share a searchable model picker with keyboard control.',
    fr: 'Nodus Copilot pour Word remplace Synonymes par Alternatives afin de traiter aussi les expressions et les phrases complètes. L’onglet attend que vous appuyiez sur Générer et respecte le modèle choisi. Idées, Passages, Édition par IA, Alternatives et Chat partagent désormais un sélecteur de modèles avec recherche et contrôle au clavier.',
    de: 'Nodus Copilot für Word ersetzt Synonyme durch Alternativen, damit auch Ausdrücke und vollständige Sätze bearbeitet werden können. Die Registerkarte wartet auf einen Klick auf Erzeugen und verwendet das gewählte Modell. Ideen, Passagen, KI-Bearbeitung, Alternativen und Chat teilen sich jetzt eine durchsuchbare Modellauswahl mit Tastatursteuerung.',
    pt: 'O Nodus Copilot para Word substitui Sinónimos por Alternativas para trabalhar também com expressões e frases completas. O separador espera que carregue em Gerar e respeita o modelo escolhido. Ideias, Passagens, Edição com IA, Alternativas e Chat partilham agora um seletor de modelos com pesquisa e controlo por teclado.',
    'pt-BR': 'O Nodus Copilot para Word substitui Sinônimos por Alternativas para trabalhar também com expressões e frases completas. A aba espera você clicar em Gerar e respeita o modelo escolhido. Ideias, Passagens, Edição com IA, Alternativas e Chat agora compartilham um seletor de modelos com busca e controle pelo teclado.',
  },
  {
    category: 'fix',
    scope: 'ai',
    es: 'Los modelos locales ya pueden vectorizar pasajes largos dentro de su límite de contexto sin fallar al superar 512 tokens. Los resúmenes terminados siguen disponibles si falla una tarea opcional posterior. Cuando el propio resumen falla, Nodus guarda y muestra el motivo para que puedas corregirlo y reintentar.',
    en: 'Local models can now embed long passages within their context limit without failing above 512 tokens. Completed summaries remain available if an optional follow-up task fails. When the summary itself fails, Nodus saves and shows the reason so you can correct it and try again.',
    fr: 'Les modèles locaux peuvent désormais vectoriser de longs passages dans leur limite de contexte sans échouer au-delà de 512 jetons. Les résumés terminés restent disponibles si une tâche facultative ultérieure échoue. Lorsque le résumé lui-même échoue, Nodus enregistre et affiche la raison afin de pouvoir la corriger et réessayer.',
    de: 'Lokale Modelle können jetzt lange Passagen innerhalb ihres Kontextlimits einbetten, ohne oberhalb von 512 Token fehlzuschlagen. Fertige Zusammenfassungen bleiben verfügbar, wenn eine optionale Folgeaufgabe scheitert. Schlägt die Zusammenfassung selbst fehl, speichert und zeigt Nodus den Grund, damit Sie ihn beheben und es erneut versuchen können.',
    pt: 'Os modelos locais já podem criar embeddings de passagens longas dentro do respetivo limite de contexto sem falhar acima de 512 tokens. Os resumos concluídos continuam disponíveis se uma tarefa opcional posterior falhar. Quando o próprio resumo falha, o Nodus guarda e mostra o motivo para que possa corrigi-lo e tentar novamente.',
    'pt-BR': 'Os modelos locais agora podem criar embeddings de passagens longas dentro do limite de contexto sem falhar acima de 512 tokens. Os resumos concluídos continuam disponíveis se uma tarefa opcional posterior falhar. Quando o próprio resumo falha, o Nodus salva e mostra o motivo para você corrigi-lo e tentar novamente.',
  },
  {
    category: 'fix',
    scope: 'zotero',
    es: 'Los títulos de Zotero con cursivas, superíndices, subíndices u otro formato enriquecido vuelven a mostrarse como texto limpio en la Biblioteca, la búsqueda y los mensajes de progreso. Nodus conserva el marcado original para reconocer cambios reales y evita que un título formateado desestabilice la sincronización.',
    en: 'Zotero titles with italics, superscripts, subscripts, or other rich formatting now appear as clean text in the Library, search, and progress messages. Nodus preserves the original markup when checking for real changes so a formatted title no longer destabilizes synchronization.',
    fr: 'Les titres Zotero contenant de l’italique, des exposants, des indices ou d’autres mises en forme enrichies s’affichent désormais comme du texte propre dans la Bibliothèque, la recherche et les messages de progression. Nodus conserve le balisage d’origine pour détecter les changements réels et empêcher un titre formaté de déstabiliser la synchronisation.',
    de: 'Zotero-Titel mit Kursivschrift, Hochstellung, Tiefstellung oder anderer Rich-Text-Formatierung erscheinen jetzt als sauberer Text in Bibliothek, Suche und Fortschrittsmeldungen. Nodus bewahrt die ursprüngliche Auszeichnung zur Erkennung echter Änderungen, damit ein formatierter Titel die Synchronisierung nicht mehr destabilisiert.',
    pt: 'Os títulos do Zotero com itálico, sobrescrito, subscrito ou outra formatação enriquecida passam a aparecer como texto limpo na Biblioteca, na pesquisa e nas mensagens de progresso. O Nodus conserva a marcação original ao verificar alterações reais para que um título formatado deixe de desestabilizar a sincronização.',
    'pt-BR': 'Os títulos do Zotero com itálico, sobrescrito, subscrito ou outra formatação enriquecida agora aparecem como texto limpo na Biblioteca, na busca e nas mensagens de progresso. O Nodus preserva a marcação original ao verificar mudanças reais para que um título formatado não desestabilize mais a sincronização.',
  },
  {
    category: 'enhancement',
    scope: 'general',
    es: 'La primera bóveda y los Ajustes explican ahora la misma regla para la contraseña maestra. Debe tener al menos ocho caracteres y puede ser una frase larga sin números ni símbolos obligatorios. La validación señala enseguida si falta longitud o si la confirmación no coincide, y la misma regla se aplica al crear la copia protegida.',
    en: 'Your first vault and Settings now explain the same master-password rule. It must contain at least eight characters and can be a long passphrase without mandatory numbers or symbols. Validation immediately identifies a short or mismatched confirmation, and the same rule is enforced when the protected copy is created.',
    fr: 'Le premier coffre et les Paramètres expliquent désormais la même règle pour le mot de passe principal. Il doit comporter au moins huit caractères et peut être une longue phrase sans chiffres ni symboles obligatoires. La validation signale immédiatement une longueur insuffisante ou une confirmation différente, et la même règle est appliquée lors de la création de la copie protégée.',
    de: 'Der erste Tresor und die Einstellungen erklären jetzt dieselbe Regel für das Masterpasswort. Es muss mindestens acht Zeichen enthalten und darf eine lange Passphrase ohne vorgeschriebene Zahlen oder Symbole sein. Die Prüfung zeigt eine zu kurze oder abweichende Bestätigung sofort an, und beim Erstellen der geschützten Kopie gilt dieselbe Regel.',
    pt: 'O primeiro cofre e as Definições passam a explicar a mesma regra para a palavra-passe mestra. Deve ter pelo menos oito caracteres e pode ser uma frase longa sem números nem símbolos obrigatórios. A validação identifica de imediato uma confirmação curta ou diferente, e a mesma regra é aplicada ao criar a cópia protegida.',
    'pt-BR': 'O primeiro cofre e as Configurações agora explicam a mesma regra para a senha mestra. Ela deve ter pelo menos oito caracteres e pode ser uma frase longa sem números nem símbolos obrigatórios. A validação identifica imediatamente uma confirmação curta ou diferente, e a mesma regra é aplicada ao criar a cópia protegida.',
  },
];

/**
 * v5.0.6 — every user-visible change merged after v5.0.5, excluding the
 * independent server-web parity branch. Keep this list aligned by index with
 * the Italian and Turkish tables so all eight interface languages receive the
 * same release.
 */
const RELEASE_5_0_6_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    category: 'new',
    scope: 'plugin',
    es: 'Nodus Copilot estrena Sinónimos y Chat. Sinónimos lee la frase completa alrededor de tu selección, propone cinco alternativas ajustadas al contexto y sustituye solo el término elegido. El Chat responde usando la página actual o el documento completo, da prioridad al texto seleccionado y permite detener, regenerar, editar y copiar respuestas. Cada documento conserva su propio historial.',
    en: 'Nodus Copilot gains Synonyms and Chat. Synonyms reads the full sentence around your selection, suggests five context-aware alternatives, and replaces only the chosen term. Chat answers using the current page or the full document, prioritizes selected text, and lets you stop, regenerate, edit, and copy replies. Every document keeps its own history.',
    fr: 'Nodus Copilot accueille Synonymes et Chat. Synonymes lit la phrase complète autour de votre sélection, propose cinq alternatives adaptées au contexte et remplace uniquement le terme choisi. Le Chat répond à partir de la page actuelle ou du document complet, donne la priorité au texte sélectionné et permet d’arrêter, régénérer, modifier et copier les réponses. Chaque document conserve son propre historique.',
    de: 'Nodus Copilot erhält Synonyme und Chat. Synonyme liest den vollständigen Satz rund um Ihre Auswahl, schlägt fünf kontextgerechte Alternativen vor und ersetzt nur den gewählten Begriff. Der Chat antwortet anhand der aktuellen Seite oder des gesamten Dokuments, priorisiert ausgewählten Text und lässt Antworten stoppen, neu erzeugen, bearbeiten und kopieren. Jedes Dokument behält seinen eigenen Verlauf.',
    pt: 'O Nodus Copilot estreia Sinónimos e Chat. Sinónimos lê a frase completa em redor da seleção, propõe cinco alternativas ajustadas ao contexto e substitui apenas o termo escolhido. O Chat responde usando a página atual ou o documento completo, dá prioridade ao texto selecionado e permite parar, voltar a gerar, editar e copiar respostas. Cada documento conserva o seu próprio histórico.',
    'pt-BR': 'O Nodus Copilot ganha Sinônimos e Chat. Sinônimos lê a frase completa ao redor da seleção, sugere cinco alternativas adequadas ao contexto e substitui apenas o termo escolhido. O Chat responde usando a página atual ou o documento completo, prioriza o texto selecionado e permite interromper, gerar novamente, editar e copiar respostas. Cada documento mantém seu próprio histórico.',
  },
  {
    category: 'enhancement',
    scope: 'plugin',
    es: 'Nodus para Zotero trabaja con el contenido completo de todos los adjuntos seleccionados y encuentra evidencia tanto por palabras como por significado con un índice local. Las respuestas enlazan pasajes, páginas y secciones exactas, indican qué afirmaciones necesitan más apoyo y conservan una auditoría revisable al reabrir la conversación. También puede interpretar páginas, tablas, figuras y documentos escaneados mediante capturas y OCR, mientras el chat muestra la respuesta a medida que se genera. La instalación y las actualizaciones del plugin quedan integradas en el paquete oficial de cada versión.',
    en: 'Nodus for Zotero works with the complete content of every selected attachment and finds evidence both by words and by meaning with a local index. Answers link to exact passages, pages, and sections, identify claims that need more support, and preserve a reviewable audit when the conversation is reopened. It can also interpret pages, tables, figures, and scanned documents through captures and OCR while chat displays the answer as it is generated. Plugin installation and updates are now integrated into every official release package.',
    fr: 'Nodus pour Zotero travaille avec le contenu intégral de toutes les pièces jointes sélectionnées et trouve des preuves par les mots comme par le sens grâce à un index local. Les réponses renvoient à des passages, pages et sections exacts, signalent les affirmations qui nécessitent davantage d’appui et conservent un audit consultable à la réouverture de la conversation. Il peut aussi interpréter des pages, tableaux, figures et documents numérisés à l’aide de captures et de l’OCR, tandis que le chat affiche la réponse au fil de sa génération. L’installation et les mises à jour du module sont désormais intégrées au paquet officiel de chaque version.',
    de: 'Nodus für Zotero arbeitet mit dem vollständigen Inhalt aller ausgewählten Anhänge und findet Belege über Wörter wie auch über ihre Bedeutung in einem lokalen Index. Antworten verknüpfen genaue Passagen, Seiten und Abschnitte, kennzeichnen Aussagen mit weiterem Belegbedarf und bewahren beim erneuten Öffnen der Unterhaltung eine prüfbare Auswertung. Auch Seiten, Tabellen, Abbildungen und gescannte Dokumente lassen sich über Aufnahmen und OCR auswerten, während der Chat die Antwort schon bei ihrer Erstellung zeigt. Installation und Updates des Plugins sind nun in jedes offizielle Versionspaket integriert.',
    pt: 'O Nodus para Zotero trabalha com o conteúdo completo de todos os anexos selecionados e encontra evidência tanto por palavras como por significado através de um índice local. As respostas ligam a passagens, páginas e secções exatas, indicam que afirmações precisam de mais apoio e conservam uma auditoria consultável ao reabrir a conversa. Também pode interpretar páginas, tabelas, figuras e documentos digitalizados através de capturas e OCR, enquanto o chat mostra a resposta à medida que é gerada. A instalação e as atualizações do plugin ficam integradas no pacote oficial de cada versão.',
    'pt-BR': 'O Nodus para Zotero trabalha com o conteúdo completo de todos os anexos selecionados e encontra evidências tanto por palavras quanto por significado com um índice local. As respostas levam a trechos, páginas e seções exatos, indicam quais afirmações precisam de mais apoio e preservam uma auditoria revisável ao reabrir a conversa. Ele também interpreta páginas, tabelas, figuras e documentos digitalizados por meio de capturas e OCR, enquanto o chat mostra a resposta à medida que ela é gerada. A instalação e as atualizações do plugin ficam integradas ao pacote oficial de cada versão.',
  },
  {
    category: 'new',
    scope: 'plugin',
    es: 'El conector de Chrome permite revisar y corregir título, autores, fecha, publicación, identificadores y tipo de documento antes de guardar. Puedes elegir colección, etiquetas, archivos y una copia legible de la página, además de importar varios resultados en una sola operación. Las transferencias grandes continúan aunque cierres el panel y las capturas repetidas se reúnen en una sola ficha en lugar de llenar la Biblioteca de duplicados.',
    en: 'The Chrome connector lets you review and correct the title, authors, date, publication, identifiers, and document type before saving. You can choose a collection, tags, files, and a readable copy of the page, as well as import several results in one operation. Large transfers continue after you close the panel, and repeated captures are brought together in one record instead of filling Library with duplicates.',
    fr: 'Le connecteur Chrome permet de vérifier et de corriger le titre, les auteurs, la date, la publication, les identifiants et le type de document avant l’enregistrement. Vous pouvez choisir une collection, des étiquettes, des fichiers et une copie lisible de la page, ainsi qu’importer plusieurs résultats en une seule opération. Les transferts volumineux continuent après la fermeture du volet et les captures répétées sont réunies dans une même notice au lieu de remplir la Bibliothèque de doublons.',
    de: 'Mit dem Chrome-Connector lassen sich Titel, Autoren, Datum, Publikation, Kennungen und Dokumenttyp vor dem Speichern prüfen und korrigieren. Sie können Sammlung, Tags, Dateien und eine lesbare Kopie der Seite auswählen sowie mehrere Ergebnisse in einem Vorgang importieren. Große Übertragungen laufen nach dem Schließen des Bereichs weiter, und wiederholte Aufnahmen werden in einem Datensatz zusammengeführt, statt die Bibliothek mit Dubletten zu füllen.',
    pt: 'O conector do Chrome permite rever e corrigir o título, os autores, a data, a publicação, os identificadores e o tipo de documento antes de guardar. Pode escolher a coleção, as etiquetas, os ficheiros e uma cópia legível da página, além de importar vários resultados numa só operação. As transferências grandes continuam mesmo depois de fechar o painel e as capturas repetidas reúnem-se num único registo em vez de encher a Biblioteca de duplicados.',
    'pt-BR': 'O conector do Chrome permite revisar e corrigir título, autores, data, publicação, identificadores e tipo de documento antes de salvar. Você pode escolher coleção, etiquetas, arquivos e uma cópia legível da página, além de importar vários resultados em uma única operação. Transferências grandes continuam mesmo depois de fechar o painel, e capturas repetidas são reunidas em uma única ficha em vez de encher a Biblioteca de duplicatas.',
  },
  {
    category: 'new',
    scope: 'browser',
    es: 'Nodus Bookmarks adopta tarjetas más compactas que se abren al pulsar en cualquier zona útil. Cada marcador y carpeta incorpora una acción de borrado con confirmación, y eliminar una carpeta avisa claramente de que también desaparecerá su contenido.',
    en: 'Nodus Bookmarks adopts more compact cards that open when you click anywhere useful. Every bookmark and folder gains a confirmed deletion action, and deleting a folder clearly warns that its contents will be removed too.',
    fr: 'Nodus Bookmarks adopte des cartes plus compactes qui s’ouvrent en cliquant dans toute zone utile. Chaque favori et dossier dispose d’une action de suppression avec confirmation, et la suppression d’un dossier avertit clairement que son contenu disparaîtra aussi.',
    de: 'Nodus Bookmarks verwendet kompaktere Karten, die sich durch einen Klick auf jeden sinnvollen Bereich öffnen. Jedes Lesezeichen und jeder Ordner erhält eine Löschaktion mit Bestätigung. Beim Löschen eines Ordners weist Nodus klar darauf hin, dass auch dessen Inhalt entfernt wird.',
    pt: 'O Nodus Bookmarks adota cartões mais compactos que se abrem ao clicar em qualquer zona útil. Cada marcador e pasta inclui uma ação de eliminação com confirmação, e eliminar uma pasta avisa claramente de que o seu conteúdo também desaparecerá.',
    'pt-BR': 'O Nodus Bookmarks adota cards mais compactos que abrem ao clicar em qualquer área útil. Cada favorito e pasta ganha uma ação de exclusão com confirmação, e excluir uma pasta avisa claramente que seu conteúdo também será removido.',
  },
  {
    category: 'new',
    scope: 'databases',
    es: 'Las bóvedas de Bases de datos estrenan Deep Research de datos. Formula una pregunta sobre tus tablas, elige bases, vistas, roles y profundidad, y revisa el esquema y el coste antes de iniciar el análisis. Nodus fija un snapshot reproducible, contrasta hipótesis, calcula resultados y vincula cada conclusión con su evidencia. El informe muestra limitaciones, objeciones y fuentes verificables, avisa si los datos han cambiado y se puede exportar en Markdown, PDF o ZIP. Los valores sensibles se ocultan de forma predeterminada y el snapshot bruto solo se incluye con confirmación expresa.',
    en: 'Database vaults gain Data Deep Research. Ask a question about your tables, choose databases, views, roles, and depth, and review the outline and cost before starting the analysis. Nodus freezes a reproducible snapshot, tests hypotheses, calculates results, and links every conclusion to its evidence. The report shows limitations, objections, and verifiable sources, warns when the data has changed, and exports to Markdown, PDF, or ZIP. Sensitive values are hidden by default, and the raw snapshot is included only after explicit confirmation.',
    fr: 'Les coffres Bases de données accueillent Deep Research de données. Posez une question sur vos tables, choisissez les bases, les vues, les rôles et la profondeur, puis vérifiez le plan et le coût avant de lancer l’analyse. Nodus fige un instantané reproductible, confronte les hypothèses, calcule les résultats et relie chaque conclusion à ses preuves. Le rapport présente les limites, les objections et les sources vérifiables, avertit lorsque les données ont changé et s’exporte en Markdown, PDF ou ZIP. Les valeurs sensibles sont masquées par défaut et l’instantané brut n’est inclus qu’après une confirmation explicite.',
    de: 'Datenbanktresore erhalten Data Deep Research. Stellen Sie eine Frage zu Ihren Tabellen, wählen Sie Datenbanken, Ansichten, Rollen und Tiefe aus und prüfen Sie Gliederung und Kosten vor Beginn der Analyse. Nodus fixiert einen reproduzierbaren Schnappschuss, prüft Hypothesen, berechnet Ergebnisse und verknüpft jede Schlussfolgerung mit ihren Belegen. Der Bericht zeigt Einschränkungen, Einwände und überprüfbare Quellen, warnt vor geänderten Daten und lässt sich als Markdown, PDF oder ZIP exportieren. Vertrauliche Werte sind standardmäßig ausgeblendet, und der Rohschnappschuss wird nur nach ausdrücklicher Bestätigung einbezogen.',
    pt: 'Os cofres de Bases de dados estreiam Deep Research de dados. Faça uma pergunta sobre as suas tabelas, escolha bases, vistas, funções e profundidade e reveja o esquema e o custo antes de iniciar a análise. O Nodus fixa um snapshot reproduzível, contrasta hipóteses, calcula resultados e liga cada conclusão à respetiva evidência. O relatório mostra limitações, objeções e fontes verificáveis, avisa se os dados mudaram e pode ser exportado em Markdown, PDF ou ZIP. Os valores sensíveis ficam ocultos por predefinição e o snapshot bruto só é incluído após confirmação expressa.',
    'pt-BR': 'Os cofres de Bancos de dados ganham Deep Research de dados. Faça uma pergunta sobre suas tabelas, escolha bancos, visualizações, funções e profundidade e revise o esquema e o custo antes de iniciar a análise. O Nodus fixa um snapshot reproduzível, confronta hipóteses, calcula resultados e vincula cada conclusão às suas evidências. O relatório mostra limitações, objeções e fontes verificáveis, avisa se os dados mudaram e pode ser exportado em Markdown, PDF ou ZIP. Valores sensíveis ficam ocultos por padrão, e o snapshot bruto só é incluído após confirmação expressa.',
  },
  {
    category: 'enhancement',
    scope: 'toolkit',
    es: 'Compass reconoce mejor las búsquedas por autor. Tolera acentos, iniciales y distintos órdenes del nombre, consulta perfiles de autor reales y evita confundir una mención en el título con una autoría. Los resultados explican cuándo coinciden con la persona solicitada y ahora se pueden limpiar de una vez para comenzar una búsqueda nueva.',
    en: 'Compass recognizes author searches more accurately. It tolerates diacritics, initials, and different name orders, queries real author profiles, and avoids mistaking a title mention for authorship. Results explain when they match the requested person and can now be cleared at once to begin a new search.',
    fr: 'Compass reconnaît plus précisément les recherches par auteur. Il tolère les signes diacritiques, les initiales et différents ordres du nom, interroge de véritables profils d’auteur et évite de confondre une mention dans le titre avec une attribution. Les résultats expliquent quand ils correspondent à la personne demandée et peuvent désormais être effacés en une fois pour lancer une nouvelle recherche.',
    de: 'Compass erkennt Autorensuchen genauer. Es berücksichtigt diakritische Zeichen, Initialen und unterschiedliche Namensreihenfolgen, fragt echte Autorenprofile ab und verwechselt eine Erwähnung im Titel nicht mit der Autorschaft. Ergebnisse erklären, wann sie zur gesuchten Person passen, und lassen sich nun auf einmal leeren, um eine neue Suche zu beginnen.',
    pt: 'O Compass reconhece melhor as pesquisas por autor. Tolera diacríticos, iniciais e diferentes ordens do nome, consulta perfis reais de autores e evita confundir uma menção no título com autoria. Os resultados explicam quando correspondem à pessoa pedida e agora podem ser limpos de uma só vez para iniciar uma nova pesquisa.',
    'pt-BR': 'O Compass reconhece melhor as buscas por autor. Ele tolera diacríticos, iniciais e diferentes ordens do nome, consulta perfis reais de autores e evita confundir uma menção no título com autoria. Os resultados explicam quando correspondem à pessoa solicitada e agora podem ser limpos de uma só vez para iniciar uma nova busca.',
  },
  {
    category: 'new',
    scope: 'estudio',
    es: 'Los prompts personalizados de mejora ya se pueden editar y eliminar. Al editar se conservan el modelo, la creatividad, el nivel y la longitud configurados. Al eliminar, Nodus muestra el nombre del prompt, pide confirmación y lo retira también de la barra de escritura. Los prompts incluidos permanecen protegidos.',
    en: 'Custom improvement prompts can now be edited and deleted. Editing preserves the configured model, creativity, level, and length. When deleting, Nodus shows the prompt name, asks for confirmation, and removes it from the writing toolbar too. Included prompts remain protected.',
    fr: 'Les prompts d’amélioration personnalisés peuvent désormais être modifiés et supprimés. La modification conserve le modèle, la créativité, le niveau et la longueur configurés. Lors de la suppression, Nodus affiche le nom du prompt, demande confirmation et le retire aussi de la barre d’écriture. Les prompts inclus restent protégés.',
    de: 'Benutzerdefinierte Verbesserungs-Prompts lassen sich jetzt bearbeiten und löschen. Beim Bearbeiten bleiben Modell, Kreativität, Niveau und Länge erhalten. Beim Löschen zeigt Nodus den Namen des Prompts, bittet um Bestätigung und entfernt ihn auch aus der Schreibleiste. Mitgelieferte Prompts bleiben geschützt.',
    pt: 'Os prompts personalizados de melhoria já podem ser editados e eliminados. A edição conserva o modelo, a criatividade, o nível e o comprimento configurados. Ao eliminar, o Nodus mostra o nome do prompt, pede confirmação e retira-o também da barra de escrita. Os prompts incluídos permanecem protegidos.',
    'pt-BR': 'Os prompts personalizados de melhoria agora podem ser editados e excluídos. A edição preserva o modelo, a criatividade, o nível e o tamanho configurados. Ao excluir, o Nodus mostra o nome do prompt, pede confirmação e também o remove da barra de escrita. Os prompts incluídos permanecem protegidos.',
  },
];

/**
 * v5.0.5 — the Word and LibreOffice copilot, tidied.
 *
 * One highlight, because from the outside this is one thing: the pane keeps the
 * proposals you paid for, follows the selection without being nudged, and now
 * looks like the rest of Nodus.
 */
const RELEASE_5_0_5_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    category: 'enhancement',
    scope: 'plugin',
    es: 'Mejoras generales en Nodus Copilot para Word y LibreOffice. El panel conserva la propuesta que ha generado, sigue tu selección por su cuenta y estrena el aspecto de Nodus.',
    en: 'General improvements to Nodus Copilot for Word and LibreOffice. The pane keeps the proposal it generated, follows your selection on its own and adopts the Nodus look.',
    fr: 'Améliorations générales de Nodus Copilot pour Word et LibreOffice. Le volet conserve la proposition générée, suit votre sélection de lui-même et adopte l’apparence de Nodus.',
    de: 'Allgemeine Verbesserungen an Nodus Copilot für Word und LibreOffice. Der Bereich behält den erzeugten Vorschlag, folgt Ihrer Auswahl von selbst und übernimmt das Erscheinungsbild von Nodus.',
    pt: 'Melhorias gerais no Nodus Copilot para o Word e o LibreOffice. O painel mantém a proposta que gerou, acompanha a sua seleção sozinho e adota o aspeto do Nodus.',
    'pt-BR': 'Melhorias gerais no Nodus Copilot para Word e LibreOffice. O painel mantém a proposta que gerou, acompanha sua seleção sozinho e adota a aparência do Nodus.',
  },
];

/**
 * 5.0.4 — every user-visible change merged after 5.0.3. Keep this list aligned
 * by index with the Italian and Turkish tables so all eight interface languages
 * receive the same release.
 */
const RELEASE_5_0_4_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    category: 'new',
    scope: 'general',
    es: 'Nodus Server estrena una interfaz web adaptable para trabajar desde el móvil o cualquier navegador. Reproduce el aspecto de la aplicación y abre los espacios de trabajo compartidos, junto con conversaciones, notas, anotaciones y archivos personales que solo ve su propietario.',
    en: 'Nodus Server gains a responsive web interface for working from a phone or any browser. It mirrors the desktop experience and opens shared workspaces alongside conversations, notes, annotations, and personal files that only their owner can see.',
    fr: 'Nodus Server inaugure une interface web adaptative pour travailler depuis un téléphone ou n’importe quel navigateur. Elle reprend l’expérience de l’application et ouvre les espaces de travail partagés avec des conversations, des notes, des annotations et des fichiers personnels que seul leur propriétaire peut voir.',
    de: 'Nodus Server erhält eine responsive Weboberfläche für die Arbeit vom Smartphone oder jedem Browser aus. Sie übernimmt das Erscheinungsbild der Anwendung und öffnet geteilte Arbeitsbereiche zusammen mit Unterhaltungen, Notizen, Anmerkungen und persönlichen Dateien, die nur ihr Eigentümer sehen kann.',
    pt: 'O Nodus Server estreia uma interface web adaptável para trabalhar a partir do telemóvel ou de qualquer navegador. Reproduz a experiência da aplicação e abre os espaços de trabalho partilhados, juntamente com conversas, notas, anotações e ficheiros pessoais que só o proprietário pode ver.',
    'pt-BR': 'O Nodus Server ganha uma interface web responsiva para trabalhar pelo celular ou por qualquer navegador. Ela reproduz a experiência do aplicativo e abre os espaços de trabalho compartilhados, junto com conversas, notas, anotações e arquivos pessoais que só o proprietário pode ver.',
  },
  {
    category: 'new',
    scope: 'general',
    es: 'Cada cuenta del servidor puede configurar sus propios proveedores, modelos y credenciales de IA. Las claves se guardan cifradas y nunca vuelven al navegador, los trabajos y resultados permanecen privados y las preferencias te acompañan entre dispositivos sin romper la compatibilidad con Desktop ni con las bóvedas conectadas.',
    en: 'Each server account can configure its own AI providers, models, and credentials. Keys are stored encrypted and never returned to the browser, jobs and results stay private, and preferences follow you across devices without breaking Desktop or Connected Vault compatibility.',
    fr: 'Chaque compte du serveur peut configurer ses propres fournisseurs, modèles et identifiants d’IA. Les clés sont conservées sous forme chiffrée et ne reviennent jamais au navigateur, les tâches et leurs résultats restent privés et les préférences vous suivent entre les appareils sans rompre la compatibilité avec Desktop ni les coffres connectés.',
    de: 'Jedes Serverkonto kann eigene KI-Anbieter, Modelle und Zugangsdaten einrichten. Schlüssel werden verschlüsselt gespeichert und nie an den Browser zurückgegeben, Aufträge und Ergebnisse bleiben privat und Einstellungen folgen Ihnen zwischen Geräten, ohne die Kompatibilität mit Desktop oder verbundenen Tresoren zu beeinträchtigen.',
    pt: 'Cada conta do servidor pode configurar os seus próprios fornecedores, modelos e credenciais de IA. As chaves ficam cifradas e nunca regressam ao navegador, as tarefas e os resultados permanecem privados e as preferências acompanham-no entre dispositivos sem quebrar a compatibilidade com o Desktop nem com os cofres ligados.',
    'pt-BR': 'Cada conta do servidor pode configurar seus próprios provedores, modelos e credenciais de IA. As chaves ficam criptografadas e nunca voltam ao navegador, os trabalhos e resultados permanecem privados e as preferências acompanham você entre dispositivos sem quebrar a compatibilidade com o Desktop nem com os cofres conectados.',
  },
  {
    category: 'enhancement',
    scope: 'general',
    es: 'El servidor aplica ahora la propiedad y los permisos a cada cambio, archivo y tarea antes de aceptar una operación. También refuerza el inicio de sesión, evita que secretos aparezcan en registros, publicaciones o copias y añade copias de seguridad verificadas con restauración para las instalaciones Docker.',
    en: 'The server now enforces ownership and permissions for every change, file, and job before accepting an operation. It also hardens sign-in, keeps secrets out of logs, publications, and backups, and adds verified backup and restore tooling for Docker installations.',
    fr: 'Le serveur vérifie désormais la propriété et les autorisations de chaque modification, fichier et tâche avant d’accepter une opération. Il renforce aussi la connexion, empêche les secrets d’apparaître dans les journaux, les publications ou les sauvegardes et ajoute des outils de sauvegarde vérifiée et de restauration pour les installations Docker.',
    de: 'Der Server prüft jetzt Eigentum und Berechtigungen für jede Änderung, Datei und Aufgabe, bevor er einen Vorgang annimmt. Außerdem schützt er die Anmeldung stärker, hält Geheimnisse aus Protokollen, Veröffentlichungen und Sicherungen fern und ergänzt geprüfte Sicherungs- und Wiederherstellungswerkzeuge für Docker-Installationen.',
    pt: 'O servidor aplica agora a propriedade e as permissões a cada alteração, ficheiro e tarefa antes de aceitar uma operação. Também reforça o início de sessão, impede que segredos apareçam em registos, publicações ou cópias e acrescenta ferramentas de cópia verificada e restauro para instalações Docker.',
    'pt-BR': 'O servidor agora aplica propriedade e permissões a cada alteração, arquivo e tarefa antes de aceitar uma operação. Ele também reforça o login, impede que segredos apareçam em registros, publicações ou backups e adiciona ferramentas de backup verificado e restauração para instalações Docker.',
  },
  {
    category: 'new',
    scope: 'estudio',
    es: 'Word Copilot añade una cuarta pestaña para los estilos de escritura guardados en tu espacio. Elige un estilo y un modelo, transforma el texto seleccionado y revisa la propuesta en el panel antes de copiarla o sustituir el fragmento original.',
    en: 'Word Copilot adds a fourth tab for the writing styles saved in your workspace. Choose a style and model, transform the selected text, and review the proposal in the pane before copying it or replacing the original passage.',
    fr: 'Word Copilot ajoute un quatrième onglet pour les styles d’écriture enregistrés dans votre espace. Choisissez un style et un modèle, transformez le texte sélectionné et relisez la proposition dans le volet avant de la copier ou de remplacer le passage original.',
    de: 'Word Copilot ergänzt eine vierte Registerkarte für die in Ihrem Arbeitsbereich gespeicherten Schreibstile. Wählen Sie Stil und Modell, wandeln Sie den markierten Text um und prüfen Sie den Vorschlag im Bereich, bevor Sie ihn kopieren oder die ursprüngliche Passage ersetzen.',
    pt: 'O Word Copilot acrescenta um quarto separador para os estilos de escrita guardados no seu espaço. Escolha um estilo e um modelo, transforme o texto selecionado e reveja a proposta no painel antes de a copiar ou substituir o excerto original.',
    'pt-BR': 'O Word Copilot adiciona uma quarta aba para os estilos de escrita salvos no seu espaço. Escolha um estilo e um modelo, transforme o texto selecionado e revise a proposta no painel antes de copiá-la ou substituir o trecho original.',
  },
  {
    category: 'enhancement',
    scope: 'estudio',
    es: 'Las cuatro pestañas de Word ocupan menos espacio y solo la activa despliega su nombre. Referencias conserva su anchura compacta, cada solicitud de escritura mantiene aislado su propio resultado y el texto de Word no cambia hasta que pulsas la acción de reemplazo.',
    en: 'The four Word tabs use less space and only the active one expands its label. References keeps its compact width, each writing request keeps its own result isolated, and the Word text does not change until you choose the replace action.',
    fr: 'Les quatre onglets de Word prennent moins de place et seul l’onglet actif déploie son nom. Références conserve sa largeur compacte, chaque demande d’écriture garde son propre résultat isolé et le texte de Word ne change que lorsque vous choisissez l’action de remplacement.',
    de: 'Die vier Word-Registerkarten benötigen weniger Platz und nur die aktive blendet ihren Namen ein. Referenzen behält seine kompakte Breite, jede Schreibanfrage hält ihr eigenes Ergebnis getrennt und der Word-Text ändert sich erst, wenn Sie Ersetzen wählen.',
    pt: 'Os quatro separadores do Word ocupam menos espaço e só o ativo mostra o nome completo. Referências conserva a largura compacta, cada pedido de escrita mantém o seu próprio resultado isolado e o texto do Word só muda quando escolhe a ação de substituição.',
    'pt-BR': 'As quatro abas do Word ocupam menos espaço e só a ativa expande o nome. Referências mantém a largura compacta, cada solicitação de escrita preserva seu próprio resultado isolado e o texto do Word só muda quando você escolhe a ação de substituição.',
  },
  {
    category: 'enhancement',
    scope: 'general',
    es: 'Nodus conserva solo las dos copias verificadas más recientes que crea antes de migrar cada bóveda. La limpieza se hace en segundo plano y deja intactos informes, archivos desconocidos, pares incompletos, backups y datos especiales de recuperación, evitando que las migraciones antiguas sigan ocupando disco sin límite.',
    en: 'Nodus keeps only the two most recent verified snapshots it creates before migrating each vault. Cleanup runs in the background and leaves reports, unknown files, incomplete pairs, backups, and special recovery data untouched, preventing old migrations from consuming disk space without limit.',
    fr: 'Nodus ne conserve que les deux instantanés vérifiés les plus récents créés avant la migration de chaque coffre. Le nettoyage s’exécute en arrière-plan et laisse intacts les rapports, les fichiers inconnus, les paires incomplètes, les sauvegardes et les données de récupération spéciales, afin que les anciennes migrations ne consomment plus le disque sans limite.',
    de: 'Nodus bewahrt nur die zwei neuesten geprüften Schnappschüsse auf, die vor der Migration jedes Tresors angelegt werden. Die Bereinigung läuft im Hintergrund und lässt Berichte, unbekannte Dateien, unvollständige Paare, Sicherungen und besondere Wiederherstellungsdaten unberührt, damit alte Migrationen nicht unbegrenzt Speicherplatz belegen.',
    pt: 'O Nodus conserva apenas as duas cópias verificadas mais recentes que cria antes de migrar cada cofre. A limpeza decorre em segundo plano e deixa intactos relatórios, ficheiros desconhecidos, pares incompletos, backups e dados especiais de recuperação, evitando que migrações antigas continuem a ocupar disco sem limite.',
    'pt-BR': 'O Nodus mantém apenas os dois snapshots verificados mais recentes que cria antes de migrar cada cofre. A limpeza ocorre em segundo plano e deixa intactos relatórios, arquivos desconhecidos, pares incompletos, backups e dados especiais de recuperação, evitando que migrações antigas continuem ocupando disco sem limite.',
  },
  {
    category: 'fix',
    scope: 'general',
    es: 'El contador público de descargas de la web vuelve a estar al día y su actualización puede lanzarse manualmente cuando haga falta. Así las cifras visibles no dependen únicamente de la ejecución programada.',
    en: 'The public website download counter is current again and its refresh can now be started manually when needed. Visible totals no longer depend only on the scheduled run.',
    fr: 'Le compteur public des téléchargements du site est de nouveau à jour et son actualisation peut désormais être lancée manuellement lorsque nécessaire. Les totaux visibles ne dépendent plus uniquement de l’exécution programmée.',
    de: 'Der öffentliche Downloadzähler der Website ist wieder aktuell und kann bei Bedarf jetzt manuell aufgefrischt werden. Die sichtbaren Summen hängen nicht mehr nur vom geplanten Lauf ab.',
    pt: 'O contador público de transferências do site está novamente atualizado e a sua atualização pode agora ser iniciada manualmente quando for necessário. Os totais visíveis deixam de depender apenas da execução programada.',
    'pt-BR': 'O contador público de downloads do site está atualizado novamente e sua atualização agora pode ser iniciada manualmente quando necessário. Os totais visíveis não dependem mais apenas da execução programada.',
  },
];

/**
 * 5.0.3 — every user-visible change merged after 5.0.2. Keep this list aligned
 * by index with the Italian and Turkish tables so all eight interface languages
 * receive the same release.
 */
const RELEASE_5_0_3_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    category: 'enhancement',
    scope: 'toolkit',
    es: 'Compass ya no necesita credenciales para buscar. Consulta directamente un catálogo mucho más amplio de literatura académica y fuentes primarias abiertas, adapta la búsqueda a cada disciplina y combina los resultados con una clasificación más sólida. La interpretación con IA sigue siendo opcional y apagada de forma predeterminada.',
    en: 'Compass no longer needs credentials to search. It queries a much broader catalogue of scholarly literature and open primary sources directly, adapts each search to its discipline, and combines the results with stronger ranking. AI interpretation remains optional and off by default.',
    fr: 'Compass n’a plus besoin d’identifiants pour effectuer une recherche. Il interroge directement un catalogue bien plus vaste de littérature scientifique et de sources primaires ouvertes, adapte chaque recherche à sa discipline et combine les résultats avec un classement plus robuste. L’interprétation par IA reste facultative et désactivée par défaut.',
    de: 'Compass benötigt für die Suche keine Zugangsdaten mehr. Es fragt einen deutlich größeren Katalog wissenschaftlicher Literatur und offener Primärquellen direkt ab, passt jede Suche an das Fachgebiet an und führt die Ergebnisse mit einer robusteren Rangfolge zusammen. Die KI-Interpretation bleibt optional und standardmäßig ausgeschaltet.',
    pt: 'O Compass já não precisa de credenciais para pesquisar. Consulta diretamente um catálogo muito mais amplo de literatura académica e fontes primárias abertas, adapta cada pesquisa à disciplina e combina os resultados com uma classificação mais robusta. A interpretação por IA continua opcional e desligada por predefinição.',
    'pt-BR': 'O Compass não precisa mais de credenciais para pesquisar. Ele consulta diretamente um catálogo muito mais amplo de literatura acadêmica e fontes primárias abertas, adapta cada busca à área e combina os resultados com uma classificação mais robusta. A interpretação por IA continua opcional e desativada por padrão.',
  },
  {
    category: 'enhancement',
    scope: 'toolkit',
    es: 'Compass conserva búsquedas y candidatos, explica qué proveedor aportó cada resultado y distingue archivos abiertos verificados de simples páginas de referencia. La importación comprueba duplicados, completa metadatos y puede adjuntar archivos disponibles, mientras la cola informa de límites temporales, trabajo parcial y elementos omitidos.',
    en: 'Compass keeps searches and candidates, explains which provider supplied each result, and distinguishes verified open files from reference pages. Import checks duplicates, completes metadata, and can attach available files, while the queue reports rate limits, partial work, and skipped items.',
    fr: 'Compass conserve les recherches et les candidats, indique quel fournisseur a fourni chaque résultat et distingue les fichiers ouverts vérifiés des simples pages de référence. L’importation contrôle les doublons, complète les métadonnées et peut joindre les fichiers disponibles, tandis que la file signale les limites temporaires, le travail partiel et les éléments ignorés.',
    de: 'Compass bewahrt Suchen und Kandidaten auf, nennt den Anbieter jedes Ergebnisses und unterscheidet verifizierte offene Dateien von reinen Referenzseiten. Der Import prüft Dubletten, ergänzt Metadaten und kann verfügbare Dateien anhängen. Die Warteschlange meldet dabei Ratenlimits, Teilergebnisse und übersprungene Elemente.',
    pt: 'O Compass conserva pesquisas e candidatos, explica que fornecedor trouxe cada resultado e distingue ficheiros abertos verificados de simples páginas de referência. A importação verifica duplicados, completa metadados e pode anexar ficheiros disponíveis, enquanto a fila informa sobre limites temporários, trabalho parcial e elementos omitidos.',
    'pt-BR': 'O Compass preserva buscas e candidatos, informa qual provedor trouxe cada resultado e diferencia arquivos abertos verificados de simples páginas de referência. A importação verifica duplicatas, completa metadados e pode anexar arquivos disponíveis, enquanto a fila informa limites temporários, trabalho parcial e itens ignorados.',
  },
  {
    category: 'fix',
    scope: 'academic',
    es: 'Deep Research vuelve a usar la versión 1 de forma predeterminada para reducir coste y riesgo en una primera ejecución. La versión 2 continúa disponible cuando quieras su análisis más exigente, y las solicitudes de la aplicación y de clientes MCP respetan siempre la versión que elijas de forma explícita.',
    en: 'Deep Research uses version 1 by default again to reduce cost and risk on a first run. Version 2 remains available whenever you want its more demanding analysis, and requests from the app and MCP clients always honour the version you choose explicitly.',
    fr: 'Deep Research utilise de nouveau la version 1 par défaut afin de réduire le coût et le risque d’une première exécution. La version 2 reste disponible lorsque vous souhaitez son analyse plus exigeante, et les demandes de l’application comme des clients MCP respectent toujours la version choisie explicitement.',
    de: 'Deep Research verwendet wieder Version 1 als Standard, um Kosten und Risiko beim ersten Lauf zu senken. Version 2 bleibt für die anspruchsvollere Analyse verfügbar. Anfragen aus der App und von MCP-Clients halten sich stets an die ausdrücklich gewählte Version.',
    pt: 'O Deep Research volta a usar a versão 1 por predefinição para reduzir o custo e o risco numa primeira execução. A versão 2 continua disponível quando quiser a análise mais exigente, e os pedidos da aplicação e dos clientes MCP respeitam sempre a versão escolhida explicitamente.',
    'pt-BR': 'O Deep Research volta a usar a versão 1 por padrão para reduzir custo e risco em uma primeira execução. A versão 2 continua disponível quando você quiser a análise mais exigente, e as solicitações do aplicativo e de clientes MCP sempre respeitam a versão escolhida explicitamente.',
  },
  {
    category: 'fix',
    scope: 'academic',
    es: 'El Diccionario ya no sustituye una definición sintetizada por un texto extractivo degradado. Reintenta respuestas truncadas, mal formadas o sin citas verificables, conserva intacta la versión anterior y muestra el motivo y el número de intentos. Un resultado degradado queda en el historial para diagnóstico, pero nunca se aplica como definición.',
    en: 'The Dictionary no longer replaces a synthesized definition with degraded extractive text. It retries truncated, malformed, or unverifiable responses, keeps the previous version intact, and shows the reason plus attempt count. A degraded result remains in history for diagnosis but is never applied as the definition.',
    fr: 'Le Dictionnaire ne remplace plus une définition synthétisée par un texte extractif dégradé. Il relance les réponses tronquées, mal formées ou dépourvues de citations vérifiables, conserve la version précédente intacte et affiche la cause ainsi que le nombre de tentatives. Un résultat dégradé reste dans l’historique pour le diagnostic, mais n’est jamais appliqué comme définition.',
    de: 'Das Wörterbuch ersetzt eine synthetisierte Definition nicht mehr durch minderwertigen extraktiven Text. Abgeschnittene, fehlerhafte oder nicht belegbare Antworten werden erneut versucht, die vorherige Version bleibt unverändert und Grund sowie Anzahl der Versuche werden angezeigt. Ein minderwertiges Ergebnis bleibt zur Diagnose im Verlauf, wird aber nie als Definition angewendet.',
    pt: 'O Dicionário já não substitui uma definição sintetizada por texto extrativo degradado. Repete respostas truncadas, mal formadas ou sem citações verificáveis, conserva intacta a versão anterior e mostra o motivo e o número de tentativas. Um resultado degradado fica no histórico para diagnóstico, mas nunca é aplicado como definição.',
    'pt-BR': 'O Dicionário não substitui mais uma definição sintetizada por texto extrativo degradado. Ele repete respostas truncadas, malformadas ou sem citações verificáveis, mantém intacta a versão anterior e mostra o motivo e o número de tentativas. Um resultado degradado fica no histórico para diagnóstico, mas nunca é aplicado como definição.',
  },
  {
    category: 'enhancement',
    scope: 'estudio',
    es: 'La barra de escritura explica al instante sus trece transformaciones de texto. Cada botón muestra un tooltip localizado con el efecto concreto de Académico, Claro, Conciso, Ortografía, Cohesión, Resumen y las demás opciones, sin obligarte a probar una acción para descubrir qué hará.',
    en: 'The writing toolbar now explains its thirteen text transformations immediately. Every button shows a localized tooltip describing the exact effect of Academic, Clear, Concise, Proofread, Cohesion, Summary, and the other options, so you do not have to run an action to discover what it will do.',
    fr: 'La barre d’écriture explique désormais immédiatement ses treize transformations de texte. Chaque bouton affiche une infobulle localisée qui décrit précisément l’effet d’Académique, Clair, Concis, Correction, Cohésion, Résumé et des autres options. Il n’est plus nécessaire d’essayer une action pour savoir ce qu’elle fera.',
    de: 'Die Schreibwerkzeugleiste erklärt ihre dreizehn Textumwandlungen jetzt sofort. Jede Schaltfläche zeigt einen übersetzten Hinweis zur genauen Wirkung von Akademisch, Klar, Prägnant, Korrektur, Kohärenz, Zusammenfassung und den übrigen Optionen. Sie müssen eine Aktion nicht mehr ausprobieren, um ihre Wirkung zu kennen.',
    pt: 'A barra de escrita explica de imediato as suas treze transformações de texto. Cada botão mostra uma dica localizada com o efeito exato de Académico, Claro, Conciso, Revisão, Coesão, Resumo e das restantes opções. Já não precisa de experimentar uma ação para descobrir o que fará.',
    'pt-BR': 'A barra de escrita agora explica imediatamente suas treze transformações de texto. Cada botão mostra uma dica localizada com o efeito exato de Acadêmico, Claro, Conciso, Revisão, Coesão, Resumo e das demais opções. Você não precisa mais testar uma ação para descobrir o que ela fará.',
  },
  {
    category: 'enhancement',
    scope: 'general',
    es: 'Las confirmaciones de borrado muestran el nombre de la bóveda que vas a eliminar, tanto en la primera pregunta como en la confirmación final. Así puedes comprobar el destino exacto antes de una acción irreversible, incluso cuando administras varias bóvedas parecidas.',
    en: 'Deletion confirmations now show the name of the vault you are about to remove in both the first prompt and the final confirmation. You can therefore verify the exact target before an irreversible action, even when you manage several similar vaults.',
    fr: 'Les confirmations de suppression affichent désormais le nom du coffre à supprimer dans la première question comme dans la confirmation finale. Vous pouvez ainsi vérifier la cible exacte avant une action irréversible, même lorsque vous gérez plusieurs coffres similaires.',
    de: 'Löschbestätigungen zeigen jetzt sowohl in der ersten Abfrage als auch in der endgültigen Bestätigung den Namen des zu entfernenden Tresors. So können Sie das genaue Ziel vor einer unumkehrbaren Aktion prüfen, auch wenn Sie mehrere ähnlich benannte Tresore verwalten.',
    pt: 'As confirmações de eliminação mostram agora o nome do cofre que vai remover, tanto na primeira pergunta como na confirmação final. Assim pode verificar o destino exato antes de uma ação irreversível, mesmo quando gere vários cofres semelhantes.',
    'pt-BR': 'As confirmações de exclusão agora mostram o nome do cofre que será removido, tanto na primeira pergunta quanto na confirmação final. Assim você pode verificar o destino exato antes de uma ação irreversível, mesmo quando administra vários cofres parecidos.',
  },
  {
    category: 'fix',
    scope: 'general',
    es: 'La interfaz distingue ahora Compass de Estado del arte con iconos propios. Las acciones de las tarjetas de Deep Research e Inmersión permanecen alineadas en la parte inferior aunque cambie la longitud del contenido, por lo que las galerías mantienen un ritmo visual estable.',
    en: 'The interface now gives Compass and State of the Art distinct icons. Actions on Deep Research and Immersion cards remain aligned at the bottom even when content lengths differ, so their galleries keep a stable visual rhythm.',
    fr: 'L’interface distingue désormais Compass et État de l’art avec des icônes propres. Les actions des cartes Deep Research et Immersion restent alignées en bas malgré les différences de longueur du contenu, ce qui conserve un rythme visuel stable dans les galeries.',
    de: 'Die Oberfläche unterscheidet Compass und Forschungsstand jetzt durch eigene Symbole. Die Aktionen auf Deep-Research- und Immersionskarten bleiben auch bei unterschiedlich langen Inhalten am unteren Rand ausgerichtet. Dadurch behalten die Galerien einen gleichmäßigen visuellen Rhythmus.',
    pt: 'A interface passa a distinguir o Compass do Estado da arte com ícones próprios. As ações dos cartões de Deep Research e Imersão mantêm-se alinhadas no fundo mesmo quando o conteúdo tem comprimentos diferentes, pelo que as galerias conservam um ritmo visual estável.',
    'pt-BR': 'A interface agora diferencia o Compass do Estado da arte com ícones próprios. As ações dos cards de Deep Research e Imersão permanecem alinhadas na parte inferior mesmo quando o conteúdo tem tamanhos diferentes, mantendo um ritmo visual estável nas galerias.',
  },
  {
    category: 'enhancement',
    scope: 'general',
    es: 'La web pública estrena metadatos coherentes para buscadores, enlaces canónicos, una imagen social de alta resolución y una página de cita generada desde una única fuente. También publica una comparación más legible entre Nodus y NotebookLM y actualiza el total público de descargas de GitHub.',
    en: 'The public website gains consistent search metadata, canonical links, a high-resolution social image, and a citation page generated from one source of truth. It also publishes a clearer Nodus versus NotebookLM comparison and refreshes the public GitHub download total.',
    fr: 'Le site public adopte des métadonnées cohérentes pour les moteurs de recherche, des liens canoniques, une image sociale en haute résolution et une page de citation produite depuis une source unique. Il publie aussi une comparaison plus lisible entre Nodus et NotebookLM et actualise le total public des téléchargements GitHub.',
    de: 'Die öffentliche Website erhält konsistente Suchmetadaten, kanonische Links, ein hochauflösendes Vorschaubild und eine aus einer einzigen Quelle erzeugte Zitierseite. Außerdem veröffentlicht sie einen klareren Vergleich von Nodus und NotebookLM und aktualisiert die öffentliche GitHub-Downloadzahl.',
    pt: 'O site público passa a ter metadados coerentes para motores de pesquisa, ligações canónicas, uma imagem social de alta resolução e uma página de citação gerada a partir de uma única fonte. Publica também uma comparação mais clara entre Nodus e NotebookLM e atualiza o total público de transferências do GitHub.',
    'pt-BR': 'O site público ganha metadados consistentes para mecanismos de busca, links canônicos, uma imagem social de alta resolução e uma página de citação gerada a partir de uma única fonte. Ele também publica uma comparação mais clara entre Nodus e NotebookLM e atualiza o total público de downloads do GitHub.',
  },
];

/**
 * 5.0.2 — reliability and interface repairs completed after 5.0.1, plus the
 * first release of Compass. Keep this list aligned by index with the Italian
 * and Turkish tables so every highlight is native in all eight languages.
 */
const RELEASE_5_0_2_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    category: 'fix',
    scope: 'academic',
    es: 'Deep Research vuelve a completar los informes desde la interfaz aunque cambies de pestaña. El trabajo pesado sale del camino que dibuja la ventana, los fallos transitorios o de formato se reparan y reintentan, y la cola muestra una sola animación junto a su título y números que se actualizan con la posición real.',
    en: 'Deep Research completes reports from the interface again even when you change tabs. Heavy work leaves the path that draws the window, transient or formatting failures are repaired and retried, and the queue shows one animation beside its title plus numbers that update with each report’s real position.',
    fr: 'Deep Research termine de nouveau les rapports depuis l’interface même si vous changez d’onglet. Le travail lourd quitte le chemin qui dessine la fenêtre, les erreurs transitoires ou de format sont réparées puis relancées, et la file affiche une seule animation près de son titre ainsi que des numéros actualisés selon la position réelle.',
    de: 'Deep Research schließt Berichte wieder über die Oberfläche ab, auch wenn Sie den Tab wechseln. Aufwendige Arbeit blockiert das Zeichnen des Fensters nicht mehr, vorübergehende Fehler und Formatfehler werden repariert und erneut versucht, und die Warteschlange zeigt nur eine Animation am Titel sowie laufend aktualisierte Positionsnummern.',
    pt: 'O Deep Research volta a concluir relatórios a partir da interface mesmo que mude de separador. O trabalho pesado sai do caminho que desenha a janela, as falhas transitórias ou de formato são reparadas e repetidas, e a fila mostra uma única animação junto ao título e números atualizados com a posição real.',
    'pt-BR': 'O Deep Research volta a concluir relatórios pela interface mesmo quando você muda de aba. O trabalho pesado sai do caminho que desenha a janela, falhas transitórias ou de formato são reparadas e repetidas, e a fila mostra uma única animação ao lado do título e números atualizados conforme a posição real.',
  },
  {
    category: 'fix',
    scope: 'academic',
    es: 'Los formularios del Diccionario vuelven a aceptar texto y los botones muestran de inmediato que han respondido. Regenerar y actualizar conservan una alineación estable, reparan respuestas incompletas del modelo y reintentan de forma controlada cuando el resultado no se puede interpretar, sin llenar la interfaz de errores repetidos.',
    en: 'Dictionary forms accept text again and their buttons immediately show that they responded. Regenerate and Update keep a stable alignment, repair incomplete model responses, and retry in a controlled way when a result cannot be interpreted, without filling the interface with repeated errors.',
    fr: 'Les formulaires du Dictionnaire acceptent de nouveau le texte et leurs boutons indiquent immédiatement qu’ils ont répondu. Régénérer et Mettre à jour restent alignés, réparent les réponses incomplètes du modèle et relancent de façon contrôlée un résultat impossible à interpréter, sans remplir l’interface d’erreurs répétées.',
    de: 'Die Formulare des Wörterbuchs nehmen wieder Text an und ihre Schaltflächen zeigen sofort eine Reaktion. Neu erzeugen und Aktualisieren bleiben stabil ausgerichtet, reparieren unvollständige Modellantworten und wiederholen kontrolliert, wenn ein Ergebnis nicht gelesen werden kann, ohne die Oberfläche mit wiederholten Fehlern zu füllen.',
    pt: 'Os formulários do Dicionário voltam a aceitar texto e os botões mostram de imediato que responderam. Regenerar e Atualizar mantêm um alinhamento estável, reparam respostas incompletas do modelo e repetem de forma controlada quando o resultado não pode ser interpretado, sem encher a interface de erros repetidos.',
    'pt-BR': 'Os formulários do Dicionário voltam a aceitar texto e os botões mostram imediatamente que responderam. Regenerar e Atualizar mantêm um alinhamento estável, reparam respostas incompletas do modelo e repetem de forma controlada quando o resultado não pode ser interpretado, sem encher a interface de erros repetidos.',
  },
  {
    category: 'fix',
    scope: 'academic',
    es: 'El lector abre de nuevo el PDF dentro de Nodus al cambiar desde el Markdown limpio. La aplicación resuelve el adjunto local antes de entregarlo al visor y ya no deja una respuesta de servidor vacía en pantalla, mientras que Abrir fuera de Nodus conserva el acceso directo al archivo original.',
    en: 'The reader opens the PDF inside Nodus again when you switch from clean Markdown. The app resolves the local attachment before handing it to the viewer and no longer leaves an empty server response on screen, while Open outside Nodus keeps its direct route to the original file.',
    fr: 'Le lecteur ouvre de nouveau le PDF dans Nodus lorsque vous quittez le Markdown nettoyé. L’application résout la pièce jointe locale avant de la transmettre au lecteur et ne laisse plus une réponse serveur vide à l’écran, tandis qu’Ouvrir hors de Nodus conserve son accès direct au fichier original.',
    de: 'Der Reader öffnet das PDF beim Wechsel von bereinigtem Markdown wieder innerhalb von Nodus. Die App löst den lokalen Anhang auf, bevor sie ihn an die Anzeige übergibt, und zeigt keine leere Serverantwort mehr. Außerhalb von Nodus öffnen behält zugleich den direkten Weg zur Originaldatei.',
    pt: 'O leitor volta a abrir o PDF dentro do Nodus ao mudar a partir do Markdown limpo. A aplicação resolve o anexo local antes de o entregar ao visualizador e deixa de mostrar uma resposta vazia do servidor, enquanto Abrir fora do Nodus mantém o acesso direto ao ficheiro original.',
    'pt-BR': 'O leitor volta a abrir o PDF dentro do Nodus ao mudar do Markdown limpo. O aplicativo resolve o anexo local antes de entregá-lo ao visualizador e não deixa mais uma resposta vazia do servidor na tela, enquanto Abrir fora do Nodus mantém o acesso direto ao arquivo original.',
  },
  {
    category: 'fix',
    scope: 'academic',
    es: 'El índice documental informa del trabajo que realmente avanza. La campaña y la tira inferior comparten los mismos recuentos, cada obra conserva su lugar mientras muestra el progreso de sus secciones, y Reintentar explica si cambió el texto o el modelo correcto. El modal también recupera sus colores de modo claro.',
    en: 'The documentary index now reports the work that is actually moving. The campaign and lower strip share the same counts, each work keeps its place while section progress advances, and Retry explains whether the text or the correct model changed. The modal also restores its proper light-mode colours.',
    fr: 'L’index documentaire indique désormais le travail qui avance réellement. La campagne et la bande inférieure partagent les mêmes comptes, chaque œuvre garde sa place tandis que ses sections progressent, et Réessayer précise si le texte ou le bon modèle a changé. La fenêtre retrouve aussi ses couleurs correctes en mode clair.',
    de: 'Der Dokumentindex meldet jetzt die Arbeit, die tatsächlich vorankommt. Kampagne und unterer Streifen verwenden dieselben Zähler, jedes Werk behält seinen Platz, während die Abschnitte fortschreiten, und Wiederholen erklärt, ob sich der Text oder das richtige Modell geändert hat. Das Fenster verwendet außerdem wieder korrekte Farben im hellen Modus.',
    pt: 'O índice documental passa a mostrar o trabalho que realmente avança. A campanha e a faixa inferior partilham as mesmas contagens, cada obra mantém o seu lugar enquanto as secções progridem, e Repetir explica se mudou o texto ou o modelo correto. O modal recupera também as cores adequadas no modo claro.',
    'pt-BR': 'O índice documental agora mostra o trabalho que realmente avança. A campanha e a faixa inferior compartilham as mesmas contagens, cada obra mantém seu lugar enquanto as seções progridem, e Tentar novamente explica se mudou o texto ou o modelo correto. O modal também recupera as cores adequadas no modo claro.',
  },
  {
    category: 'enhancement',
    scope: 'academic',
    es: 'Ideas y Argument map comparten ahora el mismo lenguaje visual. Los puntos de tipo usan los mismos colores en ambas listas, las filas de Ideas ganan el margen vertical que les faltaba y títulos, descripciones y columnas permanecen alineados incluso en una ventana estrecha.',
    en: 'Ideas and Argument map now share the same visual language. Type dots use the same colours in both lists, Ideas rows gain the vertical breathing room they were missing, and titles, descriptions, and columns remain aligned even in a narrow window.',
    fr: 'Idées et Carte argumentative partagent désormais le même langage visuel. Les points de type utilisent les mêmes couleurs dans les deux listes, les lignes d’Idées gagnent l’espace vertical qui leur manquait et titres, descriptions et colonnes restent alignés même dans une fenêtre étroite.',
    de: 'Ideen und Argumentkarte verwenden jetzt dieselbe Bildsprache. Typmarkierungen haben in beiden Listen dieselben Farben, Ideenreihen erhalten den fehlenden vertikalen Abstand, und Titel, Beschreibungen und Spalten bleiben auch in einem schmalen Fenster ausgerichtet.',
    pt: 'Ideias e Mapa de argumentos passam a partilhar a mesma linguagem visual. Os pontos de tipo usam as mesmas cores nas duas listas, as linhas de Ideias ganham o espaço vertical que faltava e títulos, descrições e colunas mantêm-se alinhados mesmo numa janela estreita.',
    'pt-BR': 'Ideias e Mapa de argumentos agora compartilham a mesma linguagem visual. Os pontos de tipo usam as mesmas cores nas duas listas, as linhas de Ideias ganham o espaço vertical que faltava e títulos, descrições e colunas permanecem alinhados mesmo em uma janela estreita.',
  },
  {
    category: 'new',
    scope: 'toolkit',
    es: 'Nodus Compass llega a Herramientas para descubrir literatura académica en fuentes abiertas. Busca en varios catálogos a la vez, combina duplicados, explica por qué recomienda cada resultado y permite guardar candidatos o importarlos a la Biblioteca con comprobación de duplicados y procedencia visible.',
    en: 'Nodus Compass arrives in Tools to discover academic literature across open sources. It searches several catalogues at once, merges duplicates, explains why each result is recommended, and lets you save candidates or import them into the Library with duplicate checks and visible provenance.',
    fr: 'Nodus Compass arrive dans les Outils pour découvrir la littérature académique dans des sources ouvertes. Il interroge plusieurs catalogues à la fois, fusionne les doublons, explique chaque recommandation et permet d’enregistrer des candidats ou de les importer dans la Bibliothèque avec contrôle des doublons et provenance visible.',
    de: 'Nodus Compass kommt zu den Werkzeugen und entdeckt wissenschaftliche Literatur in offenen Quellen. Es durchsucht mehrere Kataloge gleichzeitig, führt Dubletten zusammen, erklärt jede Empfehlung und lässt Kandidaten speichern oder mit Dublettenprüfung und sichtbarer Herkunft in die Bibliothek importieren.',
    pt: 'O Nodus Compass chega às Ferramentas para descobrir literatura académica em fontes abertas. Pesquisa vários catálogos ao mesmo tempo, reúne duplicados, explica cada recomendação e permite guardar candidatos ou importá-los para a Biblioteca com verificação de duplicados e proveniência visível.',
    'pt-BR': 'O Nodus Compass chega às Ferramentas para descobrir literatura acadêmica em fontes abertas. Ele pesquisa vários catálogos ao mesmo tempo, reúne duplicatas, explica cada recomendação e permite salvar candidatos ou importá-los para a Biblioteca com verificação de duplicatas e procedência visível.',
  },
];

/**
 * 5.0.1 — every user-visible repair merged after 5.0.0, including the work
 * that was already on main before this release branch started.
 */
const RELEASE_5_0_1_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    category: 'new',
    scope: 'academic',
    es: 'El Diccionario guía mejor cada definición. Al crear una entrada puedes elegir entre seis enfoques, añadir instrucciones propias y revisar la evidencia que Nodus usará. La entrada abierta, la búsqueda y los filtros se conservan al salir y volver, y regenerar una definición mantiene una versión recuperable.',
    en: 'The Dictionary now guides each definition more clearly. When creating an entry you can choose among six approaches, add your own instructions, and review the evidence Nodus will use. The open entry, search, and filters remain when you leave and return, and regenerating a definition keeps a recoverable version.',
    fr: 'Le Dictionnaire guide désormais plus clairement chaque définition. Lors de la création d’une entrée, vous pouvez choisir parmi six approches, ajouter vos propres consignes et examiner les preuves que Nodus utilisera. L’entrée ouverte, la recherche et les filtres sont conservés quand vous partez puis revenez, et une définition régénérée garde une version récupérable.',
    de: 'Das Wörterbuch führt jetzt klarer durch jede Definition. Beim Erstellen eines Eintrags können Sie aus sechs Ansätzen wählen, eigene Anweisungen ergänzen und die von Nodus verwendeten Belege prüfen. Geöffneter Eintrag, Suche und Filter bleiben beim Verlassen erhalten, und bei einer neuen Definition bleibt eine wiederherstellbare Version bestehen.',
    pt: 'O Dicionário passa a orientar melhor cada definição. Ao criar uma entrada pode escolher entre seis abordagens, acrescentar instruções próprias e rever a evidência que o Nodus utilizará. A entrada aberta, a pesquisa e os filtros conservam-se ao sair e voltar, e uma definição regenerada mantém uma versão recuperável.',
    'pt-BR': 'O Dicionário agora orienta melhor cada definição. Ao criar uma entrada você pode escolher entre seis abordagens, adicionar instruções próprias e revisar as evidências que o Nodus usará. A entrada aberta, a busca e os filtros são preservados ao sair e voltar, e uma definição regenerada mantém uma versão recuperável.',
  },
  {
    category: 'new',
    scope: 'academic',
    es: 'También puedes generar varias entradas del Diccionario a la vez. La cola procesa conceptos en paralelo hasta el límite de llamadas configurado, muestra el progreso y el resultado de cada entrada y permite reintentar solo las que fallen. Puedes seguir usando el Diccionario mientras el trabajo continúa.',
    en: 'You can also generate several Dictionary entries at once. The queue processes concepts in parallel up to the configured request limit, shows the progress and result of every entry, and lets you retry only the ones that fail. You can keep using the Dictionary while the work continues.',
    fr: 'Vous pouvez également générer plusieurs entrées du Dictionnaire à la fois. La file traite les concepts en parallèle jusqu’à la limite de requêtes configurée, affiche la progression et le résultat de chaque entrée et permet de relancer uniquement celles qui échouent. Le Dictionnaire reste utilisable pendant le traitement.',
    de: 'Sie können außerdem mehrere Wörterbucheinträge gleichzeitig erzeugen. Die Warteschlange verarbeitet Begriffe parallel bis zur festgelegten Anfragegrenze, zeigt Fortschritt und Ergebnis jedes Eintrags und lässt nur fehlgeschlagene Einträge erneut starten. Das Wörterbuch bleibt währenddessen nutzbar.',
    pt: 'Também pode gerar várias entradas do Dicionário ao mesmo tempo. A fila processa conceitos em paralelo até ao limite de pedidos configurado, mostra o progresso e o resultado de cada entrada e permite repetir apenas as que falharem. Pode continuar a usar o Dicionário enquanto o trabalho decorre.',
    'pt-BR': 'Também é possível gerar várias entradas do Dicionário ao mesmo tempo. A fila processa conceitos em paralelo até o limite de solicitações configurado, mostra o progresso e o resultado de cada entrada e permite repetir apenas as que falharem. Você pode continuar usando o Dicionário durante o processamento.',
  },
  {
    category: 'fix',
    scope: 'academic',
    es: 'La Biblioteca académica y la Biblioteca global conservan con más fiabilidad la búsqueda, los filtros, la posición y el documento abierto al navegar. Los adjuntos vinculados y de bibliotecas de grupo vuelven a abrirse desde su ruta real, las acciones no se aplican a una selección antigua y las citas de fuentes mantienen su destino exacto.',
    en: 'The academic Library and Global Library now preserve search, filters, position, and the open document more reliably while you navigate. Linked and group-library attachments open again from their real path, actions no longer apply to a stale selection, and source citations keep their exact destination.',
    fr: 'La Bibliothèque académique et la Bibliothèque globale conservent plus sûrement la recherche, les filtres, la position et le document ouvert pendant la navigation. Les pièces jointes liées ou issues de bibliothèques de groupe s’ouvrent de nouveau depuis leur chemin réel, les actions ne visent plus une ancienne sélection et les citations gardent leur destination exacte.',
    de: 'Die akademische und die globale Bibliothek bewahren Suche, Filter, Position und geöffnetes Dokument beim Navigieren zuverlässiger. Verknüpfte Anhänge und Anhänge aus Gruppenbibliotheken öffnen wieder ihren echten Pfad, Aktionen treffen keine veraltete Auswahl mehr, und Quellenzitate behalten ihr genaues Ziel.',
    pt: 'A Biblioteca académica e a Biblioteca global passam a conservar com maior fiabilidade a pesquisa, os filtros, a posição e o documento aberto durante a navegação. Os anexos ligados e de bibliotecas de grupo voltam a abrir pelo caminho real, as ações deixam de afetar uma seleção antiga e as citações mantêm o destino exato.',
    'pt-BR': 'A Biblioteca acadêmica e a Biblioteca global agora preservam com mais segurança a busca, os filtros, a posição e o documento aberto durante a navegação. Anexos vinculados e de bibliotecas de grupo voltam a abrir pelo caminho real, ações não afetam mais uma seleção antiga e citações mantêm o destino exato.',
  },
  {
    category: 'fix',
    scope: 'academic',
    es: 'La comprensión documental recupera campañas interrumpidas sin atascarse en un estado antiguo y mantiene visibles los perfiles ya publicados mientras repara o repite el trabajo pendiente. Los estados y errores que llegan desde procesos en segundo plano aparecen en el idioma de la interfaz, y las fuentes que cambian durante un análisis se vuelven a poner en cola de forma segura.',
    en: 'Document understanding now recovers interrupted campaigns without getting stuck in an old state and keeps published profiles visible while pending work is repaired or retried. Status and errors arriving from background processes use the interface language, and sources that change during analysis are safely queued again.',
    fr: 'La compréhension documentaire récupère les campagnes interrompues sans rester bloquée dans un ancien état et garde les profils publiés visibles pendant la réparation ou la reprise du travail en attente. Les états et erreurs des processus en arrière-plan suivent la langue de l’interface, et une source modifiée pendant l’analyse est remise en file en toute sécurité.',
    de: 'Das Dokumentverständnis stellt unterbrochene Kampagnen wieder her, ohne in einem alten Zustand hängen zu bleiben, und hält veröffentlichte Profile sichtbar, während ausstehende Arbeit repariert oder wiederholt wird. Status und Fehler aus Hintergrundprozessen erscheinen in der Oberflächensprache, und während der Analyse geänderte Quellen werden sicher neu eingereiht.',
    pt: 'A compreensão documental recupera campanhas interrompidas sem ficar presa num estado antigo e mantém os perfis publicados visíveis enquanto o trabalho pendente é reparado ou repetido. Os estados e erros dos processos em segundo plano aparecem no idioma da interface, e as fontes alteradas durante uma análise voltam à fila em segurança.',
    'pt-BR': 'A compreensão documental recupera campanhas interrompidas sem ficar presa em um estado antigo e mantém os perfis publicados visíveis enquanto o trabalho pendente é reparado ou repetido. Estados e erros de processos em segundo plano aparecem no idioma da interface, e fontes alteradas durante uma análise voltam à fila com segurança.',
  },
  {
    category: 'enhancement',
    scope: 'academic',
    es: 'Deep Research usa ahora una única cola duradera para los informes iniciados en la aplicación y por clientes MCP. Un informe pendiente o en curso se puede quitar con confirmación, la cola sobrevive a un reinicio y recupera trabajos antiguos que habían quedado atascados. Al terminar, el borrador aparece en la galería sin duplicados ni informes fantasma.',
    en: 'Deep Research now uses one durable queue for reports started in the app and by MCP clients. A queued or running report can be removed with confirmation, the queue survives a restart, and it recovers older jobs that had become stuck. When work finishes, its draft appears in the gallery without duplicates or ghost reports.',
    fr: 'Deep Research utilise désormais une file durable unique pour les rapports lancés dans l’application ou par des clients MCP. Un rapport en attente ou en cours peut être retiré après confirmation, la file survit au redémarrage et récupère les anciennes tâches bloquées. Une fois terminé, le brouillon apparaît dans la galerie sans doublon ni rapport fantôme.',
    de: 'Deep Research verwendet jetzt eine einzige dauerhafte Warteschlange für Berichte aus der App und von MCP-Clients. Ein wartender oder laufender Bericht kann nach Bestätigung entfernt werden, die Warteschlange übersteht einen Neustart und stellt ältere festgefahrene Aufträge wieder her. Fertige Entwürfe erscheinen ohne Duplikate oder Geisterberichte in der Galerie.',
    pt: 'O Deep Research passa a usar uma única fila duradoura para relatórios iniciados na aplicação e por clientes MCP. Um relatório pendente ou em curso pode ser removido com confirmação, a fila sobrevive a um reinício e recupera trabalhos antigos que tinham ficado bloqueados. Ao terminar, o rascunho aparece na galeria sem duplicados nem relatórios fantasma.',
    'pt-BR': 'O Deep Research agora usa uma única fila durável para relatórios iniciados no aplicativo e por clientes MCP. Um relatório pendente ou em andamento pode ser removido com confirmação, a fila sobrevive a uma reinicialização e recupera trabalhos antigos que ficaram travados. Ao terminar, o rascunho aparece na galeria sem duplicatas nem relatórios fantasmas.',
  },
  {
    category: 'fix',
    scope: 'general',
    es: 'Abrir Ajustes ya no puede congelar Nodus mientras inspecciona copias previas a una migración o limpia copias automáticas. Las comprobaciones de archivos y SQLite se ejecutan fuera del proceso de la ventana, tienen límites claros y descartan resultados que hayan quedado obsoletos si cambias de vault o de carpeta durante la operación.',
    en: 'Opening Settings can no longer freeze Nodus while it inspects pre-migration copies or cleans automatic backups. File and SQLite checks run outside the window process, use clear limits, and discard results that became stale if you change vault or folder during the operation.',
    fr: 'Ouvrir les Réglages ne peut plus figer Nodus pendant l’inspection des copies antérieures à une migration ou le nettoyage des sauvegardes automatiques. Les vérifications des fichiers et de SQLite s’exécutent hors du processus de la fenêtre, ont des limites claires et ignorent tout résultat devenu obsolète si vous changez de coffre ou de dossier.',
    de: 'Das Öffnen der Einstellungen kann Nodus nicht mehr einfrieren, während Kopien vor einer Migration geprüft oder automatische Sicherungen bereinigt werden. Datei- und SQLite-Prüfungen laufen außerhalb des Fensterprozesses, haben klare Grenzen und verwerfen veraltete Ergebnisse, wenn Sie währenddessen Vault oder Ordner wechseln.',
    pt: 'Abrir os Ajustes já não pode bloquear o Nodus enquanto inspeciona cópias anteriores a uma migração ou limpa cópias automáticas. As verificações de ficheiros e SQLite decorrem fora do processo da janela, têm limites claros e descartam resultados desatualizados se mudar de cofre ou de pasta durante a operação.',
    'pt-BR': 'Abrir as Configurações não pode mais travar o Nodus enquanto ele inspeciona cópias anteriores a uma migração ou limpa backups automáticos. As verificações de arquivos e SQLite rodam fora do processo da janela, têm limites claros e descartam resultados obsoletos se você trocar de vault ou pasta durante a operação.',
  },
  {
    category: 'enhancement',
    scope: 'general',
    es: 'Ajustes explica ahora para qué sirve cada modelo y cada control de IA con una descripción breve y uniforme. Si intentas iniciar una tarea de IA sin un modelo configurado, Nodus muestra un aviso pequeño en modo claro u oscuro y te lleva directamente a Ajustes y Modelos. El mensaje está disponible en los ocho idiomas de la interfaz.',
    en: 'Settings now explains what every model and AI control is for with a short, consistent description. If you try to start an AI task without a configured model, Nodus shows a small light or dark mode notice and takes you directly to Settings and Models. The message is available in all eight interface languages.',
    fr: 'Les Réglages expliquent désormais le rôle de chaque modèle et de chaque commande d’IA avec une description courte et cohérente. Si vous lancez une tâche d’IA sans modèle configuré, Nodus affiche un petit avis adapté au thème clair ou sombre et ouvre directement Réglages et Modèles. Le message existe dans les huit langues de l’interface.',
    de: 'Die Einstellungen erklären jetzt jedes Modell und jede KI-Steuerung mit einer kurzen, einheitlichen Beschreibung. Wenn Sie eine KI-Aufgabe ohne konfiguriertes Modell starten, zeigt Nodus einen kleinen Hinweis im hellen oder dunklen Design und öffnet direkt Einstellungen und Modelle. Die Meldung ist in allen acht Oberflächensprachen verfügbar.',
    pt: 'Os Ajustes passam a explicar para que serve cada modelo e controlo de IA com uma descrição breve e uniforme. Se tentar iniciar uma tarefa de IA sem um modelo configurado, o Nodus mostra um pequeno aviso em modo claro ou escuro e abre diretamente Ajustes e Modelos. A mensagem está disponível nos oito idiomas da interface.',
    'pt-BR': 'As Configurações agora explicam para que serve cada modelo e controle de IA com uma descrição breve e uniforme. Se você tentar iniciar uma tarefa de IA sem um modelo configurado, o Nodus mostra um pequeno aviso em modo claro ou escuro e abre diretamente Configurações e Modelos. A mensagem está disponível nos oito idiomas da interface.',
  },
];

/**
 * 5.0.0 — every user-visible change since 4.2.5, including the fixes that
 * landed after the beta tag. Keep this list aligned by index with the Italian
 * and Turkish tables so the startup modal never falls back to English.
 */
const RELEASE_5_0_0_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    category: 'new',
    scope: 'academic',
    es: 'El vault académico estrena Diccionario. Puedes crear conceptos desde la evidencia del corpus, buscar y filtrar entradas, editar definiciones, consultar sus citas y relaciones y recuperar versiones anteriores. Nodus detecta nueva evidencia y conserva la versión previa cuando actualizas o regeneras una entrada.',
    en: 'The academic vault gains a Dictionary. You can create concepts from corpus evidence, search and filter entries, edit definitions, inspect their citations and relations, and restore earlier versions. Nodus detects new evidence and preserves the previous version when you update or regenerate an entry.',
    fr: 'Le coffre académique accueille un Dictionnaire. Vous pouvez créer des concepts à partir des preuves du corpus, rechercher et filtrer les entrées, modifier les définitions, consulter leurs citations et relations et restaurer les versions précédentes. Nodus détecte les nouvelles preuves et conserve la version antérieure lors d’une mise à jour ou d’une régénération.',
    de: 'Der akademische Tresor erhält ein Wörterbuch. Sie können Begriffe aus Korpusbelegen erstellen, Einträge suchen und filtern, Definitionen bearbeiten, Zitate und Beziehungen prüfen und frühere Versionen wiederherstellen. Nodus erkennt neue Belege und bewahrt bei Aktualisierung oder Neuerstellung die vorherige Version auf.',
    pt: 'O cofre académico estreia um Dicionário. Pode criar conceitos a partir da evidência do corpus, pesquisar e filtrar entradas, editar definições, consultar citações e relações e recuperar versões anteriores. O Nodus deteta nova evidência e conserva a versão anterior quando atualiza ou volta a gerar uma entrada.',
    'pt-BR': 'O cofre acadêmico ganha um Dicionário. Você pode criar conceitos a partir das evidências do corpus, pesquisar e filtrar entradas, editar definições, consultar citações e relações e recuperar versões anteriores. O Nodus detecta novas evidências e preserva a versão anterior ao atualizar ou gerar novamente uma entrada.',
  },
  {
    category: 'new',
    scope: 'academic',
    es: 'Nodus entiende cada documento por niveles. Crea perfiles con secciones y resúmenes, enlaza el análisis con el texto exacto y amplía solo las fuentes que hacen falta. La indexación ocurre en segundo plano después de pedir permiso una vez y se puede pausar, reanudar, detener o reintentar desde la Biblioteca sin perder el progreso.',
    en: 'Nodus now understands each document in layers. It builds profiles with sections and summaries, ties analysis to the exact text, and expands only the sources that matter. Indexing runs in the background after one clear consent request and can be paused, resumed, stopped, or retried from Library without losing progress.',
    fr: 'Nodus comprend désormais chaque document par niveaux. Il crée des profils avec sections et résumés, relie l’analyse au texte exact et développe uniquement les sources utiles. L’indexation s’exécute en arrière-plan après une demande de consentement claire et peut être suspendue, reprise, arrêtée ou relancée depuis la Bibliothèque sans perdre la progression.',
    de: 'Nodus versteht jetzt jedes Dokument in mehreren Ebenen. Es erstellt Profile mit Abschnitten und Zusammenfassungen, bindet Analysen an den genauen Text und vertieft nur relevante Quellen. Die Indizierung läuft nach einer klaren Einwilligung im Hintergrund und lässt sich in der Bibliothek ohne Fortschrittsverlust pausieren, fortsetzen, stoppen oder erneut starten.',
    pt: 'O Nodus passa a compreender cada documento por níveis. Cria perfis com secções e resumos, liga a análise ao texto exato e aprofunda apenas as fontes necessárias. A indexação decorre em segundo plano após um pedido claro de consentimento e pode ser pausada, retomada, parada ou repetida na Biblioteca sem perder o progresso.',
    'pt-BR': 'O Nodus agora compreende cada documento em camadas. Ele cria perfis com seções e resumos, liga a análise ao texto exato e aprofunda somente as fontes necessárias. A indexação roda em segundo plano após um pedido claro de consentimento e pode ser pausada, retomada, interrompida ou repetida na Biblioteca sem perder o progresso.',
  },
  {
    category: 'new',
    scope: 'academic',
    es: 'Deep Research v2 parte de ideas, relaciones y evidencia antes de abrir documentos completos. Deja de perseguir una longitud prefijada y termina cuando las fuentes y proposiciones ya sostienen la respuesta. Añade controles equilibrados, salida en un solo bloque y metadatos reproducibles, mientras los informes anteriores siguen abriéndose con su versión original.',
    en: 'Deep Research v2 starts from ideas, relationships, and evidence before opening full documents. It stops chasing a preset length and finishes when the sources and propositions support the answer. It adds balanced controls, continuous single-block output, and reproducible metadata, while earlier reports still open with their original version.',
    fr: 'Deep Research v2 part des idées, des relations et des preuves avant d’ouvrir les documents complets. Il ne poursuit plus une longueur prédéfinie et s’arrête lorsque les sources et les propositions étayent la réponse. Il ajoute des réglages équilibrés, une sortie continue en un seul bloc et des métadonnées reproductibles, tandis que les anciens rapports gardent leur version d’origine.',
    de: 'Deep Research v2 beginnt mit Ideen, Beziehungen und Belegen, bevor vollständige Dokumente geöffnet werden. Es verfolgt keine vorgegebene Länge mehr und endet, wenn Quellen und Aussagen die Antwort tragen. Hinzu kommen ausgewogene Einstellungen, eine fortlaufende Einblock-Ausgabe und reproduzierbare Metadaten, während ältere Berichte mit ihrer ursprünglichen Version geöffnet werden.',
    pt: 'O Deep Research v2 parte de ideias, relações e evidência antes de abrir documentos completos. Deixa de perseguir um tamanho predefinido e termina quando as fontes e proposições sustentam a resposta. Acrescenta controlos equilibrados, saída contínua num só bloco e metadados reprodutíveis, enquanto os relatórios anteriores abrem com a versão original.',
    'pt-BR': 'O Deep Research v2 parte de ideias, relações e evidências antes de abrir documentos completos. Ele deixa de perseguir um tamanho predefinido e termina quando as fontes e proposições sustentam a resposta. Traz controles equilibrados, saída contínua em bloco único e metadados reproduzíveis, enquanto relatórios antigos abrem com sua versão original.',
  },
  {
    category: 'fix',
    scope: 'academic',
    es: 'El archivo local vuelve a ser la fuente de verdad para cada obra, incluidos los adjuntos enlazados y las bibliotecas de grupo. Las citas abren el adjunto y la página que realmente contienen la evidencia. Un texto truncado se divide y reintenta, un reescaneo sobrevive al reinicio y un fallo conserva el análisis anterior en vez de ocultarlo.',
    en: 'The local file is once again the source of truth for each work, including linked attachments and group libraries. Citations open the attachment and page that actually contain the evidence. Truncated text splits and retries, a queued rescan survives a restart, and a failure preserves the previous analysis instead of hiding it.',
    fr: 'Le fichier local redevient la source de vérité pour chaque œuvre, y compris les pièces jointes liées et les bibliothèques de groupe. Les citations ouvrent la pièce jointe et la page qui contiennent réellement la preuve. Un texte tronqué est divisé puis relancé, une nouvelle analyse en attente survit au redémarrage et un échec conserve l’analyse précédente.',
    de: 'Die lokale Datei ist wieder die maßgebliche Quelle für jedes Werk, einschließlich verknüpfter Anhänge und Gruppenbibliotheken. Zitate öffnen den Anhang und die Seite mit dem tatsächlichen Beleg. Abgeschnittener Text wird geteilt und erneut verarbeitet, ein geplanter Scan übersteht den Neustart und ein Fehler bewahrt die vorherige Analyse auf.',
    pt: 'O ficheiro local volta a ser a fonte de verdade de cada obra, incluindo anexos ligados e bibliotecas de grupo. As citações abrem o anexo e a página que contêm realmente a evidência. Um texto truncado é dividido e repetido, uma nova análise em fila sobrevive ao reinício e uma falha conserva a análise anterior.',
    'pt-BR': 'O arquivo local volta a ser a fonte de verdade de cada obra, incluindo anexos vinculados e bibliotecas de grupo. As citações abrem o anexo e a página que realmente contêm a evidência. Um texto truncado é dividido e repetido, uma nova análise na fila sobrevive à reinicialização e uma falha preserva a análise anterior.',
  },
  {
    category: 'enhancement',
    scope: 'browser',
    es: 'Nodus Browser ya controla reproductores personalizados y audio web cuando una página no ofrece un elemento multimedia normal. Pausa y Reanudar siguen al reproductor activo sin accionar botones ambiguos. También corregimos el tema del permiso de análisis, el desbordamiento de acciones en Zotero y la alineación de los marcadores de tipo de idea.',
    en: 'Nodus Browser can now control custom players and web audio when a page exposes no standard media element. Pause and Resume follow the active player without pressing ambiguous controls. We also fixed the analysis-consent theme, overflowing actions in Zotero, and the vertical alignment of idea type markers.',
    fr: 'Nodus Browser peut désormais contrôler les lecteurs personnalisés et l’audio web lorsqu’une page ne présente aucun élément multimédia standard. Pause et Reprendre suivent le lecteur actif sans actionner de commande ambiguë. Nous avons aussi corrigé le thème du consentement à l’analyse, les actions qui débordaient dans Zotero et l’alignement des marqueurs de type d’idée.',
    de: 'Nodus Browser kann jetzt eigene Player und Web-Audio steuern, wenn eine Seite kein normales Medienelement anbietet. Pause und Fortsetzen folgen dem aktiven Player, ohne mehrdeutige Bedienelemente auszulösen. Außerdem wurden das Design der Analyse-Einwilligung, überlaufende Aktionen in Zotero und die Ausrichtung der Ideentyp-Markierungen korrigiert.',
    pt: 'O Nodus Browser passa a controlar leitores personalizados e áudio web quando uma página não apresenta um elemento multimédia normal. Pausar e Retomar seguem o leitor ativo sem acionar controlos ambíguos. Corrigimos também o tema do consentimento de análise, as ações que transbordavam no Zotero e o alinhamento dos marcadores de tipo de ideia.',
    'pt-BR': 'O Nodus Browser agora controla players personalizados e áudio da web quando uma página não apresenta um elemento de mídia normal. Pausar e Retomar seguem o player ativo sem acionar controles ambíguos. Também corrigimos o tema do consentimento de análise, as ações que transbordavam no Zotero e o alinhamento dos marcadores de tipo de ideia.',
  },
  {
    category: 'fix',
    scope: 'general',
    es: 'Una carpeta de recuperación en iCloud, OneDrive o cualquier proveedor lento ya no puede bloquear el arranque. Nodus consulta un índice pequeño con un plazo estricto y continúa si el proveedor no responde. Las inspecciones manuales también tienen límite, y la pantalla de protección muestra el logotipo de Nodus con el color del vault mientras termina.',
    en: 'A recovery folder in iCloud, OneDrive, or any slow provider can no longer block startup. Nodus checks a small index under a strict deadline and continues if the provider does not answer. Manual inspections are bounded too, and the protection screen shows the Nodus mark in the vault colour while it finishes.',
    fr: 'Un dossier de récupération dans iCloud, OneDrive ou tout fournisseur lent ne peut plus bloquer le démarrage. Nodus consulte un petit index avec un délai strict et continue si le fournisseur ne répond pas. Les inspections manuelles sont également limitées, et l’écran de protection affiche le logo Nodus dans la couleur du coffre pendant la vérification.',
    de: 'Ein Wiederherstellungsordner in iCloud, OneDrive oder bei einem langsamen Anbieter kann den Start nicht mehr blockieren. Nodus prüft einen kleinen Index mit fester Frist und fährt fort, wenn der Anbieter nicht antwortet. Auch manuelle Prüfungen sind begrenzt, und der Schutzbildschirm zeigt währenddessen das Nodus-Zeichen in der Tresorfarbe.',
    pt: 'Uma pasta de recuperação no iCloud, OneDrive ou noutro fornecedor lento já não pode bloquear o arranque. O Nodus consulta um pequeno índice com um prazo estrito e continua se o fornecedor não responder. As inspeções manuais também têm limite, e o ecrã de proteção mostra o símbolo do Nodus na cor do cofre enquanto termina.',
    'pt-BR': 'Uma pasta de recuperação no iCloud, OneDrive ou em qualquer provedor lento não pode mais bloquear a inicialização. O Nodus consulta um índice pequeno com prazo rígido e continua se o provedor não responder. As inspeções manuais também têm limite, e a tela de proteção mostra a marca do Nodus na cor do cofre enquanto termina.',
  },
  {
    category: 'fix',
    scope: 'general',
    es: 'Las acciones enviadas desde una bóveda conectada llegan también cuando usas el Nodus Server clásico. El escritorio puede reclamarlas y procesarlas con el mismo contrato seguro de Cloudflare, incluido regenerar la síntesis de un autor, y el servidor las conserva hasta que el equipo confirma su resultado.',
    en: 'Actions sent from a connected vault now arrive when you use the classic Nodus Server too. Desktop can claim and process them with the same safe contract used by Cloudflare, including regenerating an author synthesis, and the server keeps them until the computer confirms the result.',
    fr: 'Les actions envoyées depuis un coffre connecté arrivent désormais aussi avec le Nodus Server classique. L’application de bureau peut les réclamer et les traiter avec le même contrat sûr que Cloudflare, y compris régénérer la synthèse d’un auteur, et le serveur les conserve jusqu’à la confirmation du résultat par l’ordinateur.',
    de: 'Aktionen aus einem verbundenen Tresor kommen jetzt auch mit dem klassischen Nodus Server an. Die Desktop-App kann sie mit demselben sicheren Vertrag wie bei Cloudflare übernehmen und verarbeiten, einschließlich der Neuerstellung einer Autorenzusammenfassung. Der Server bewahrt sie auf, bis der Computer das Ergebnis bestätigt.',
    pt: 'As ações enviadas a partir de um cofre ligado passam a chegar também com o Nodus Server clássico. O ambiente de trabalho pode reclamá-las e processá-las com o mesmo contrato seguro da Cloudflare, incluindo voltar a gerar a síntese de um autor, e o servidor conserva-as até o computador confirmar o resultado.',
    'pt-BR': 'As ações enviadas por um cofre conectado agora chegam também com o Nodus Server clássico. O aplicativo de desktop pode assumi-las e processá-las com o mesmo contrato seguro do Cloudflare, incluindo gerar novamente a síntese de um autor, e o servidor as guarda até o computador confirmar o resultado.',
  },
  {
    category: 'enhancement',
    scope: 'general',
    es: 'La documentación pública se ha puesto al día con la interfaz actual. El README y la guía de inicio usan capturas nuevas de los vaults de demostración en inglés, explican la navegación vigente y muestran accesos más claros a la descarga, la documentación y la licencia.',
    en: 'The public documentation now matches the current interface. The README and getting-started guide use new captures of the English demo vaults, explain the current navigation, and provide clearer paths to downloads, documentation, and the license.',
    fr: 'La documentation publique correspond désormais à l’interface actuelle. Le README et le guide de démarrage utilisent de nouvelles captures des coffres de démonstration en anglais, expliquent la navigation en vigueur et proposent des accès plus clairs aux téléchargements, à la documentation et à la licence.',
    de: 'Die öffentliche Dokumentation entspricht jetzt der aktuellen Oberfläche. README und Einstiegshilfe verwenden neue Aufnahmen der englischen Demo-Tresore, erklären die heutige Navigation und bieten klarere Wege zu Downloads, Dokumentation und Lizenz.',
    pt: 'A documentação pública passa a corresponder à interface atual. O README e o guia de iniciação usam novas capturas dos cofres de demonstração em inglês, explicam a navegação vigente e oferecem caminhos mais claros para as transferências, a documentação e a licença.',
    'pt-BR': 'A documentação pública agora corresponde à interface atual. O README e o guia de primeiros passos usam novas capturas dos cofres de demonstração em inglês, explicam a navegação vigente e oferecem caminhos mais claros para downloads, documentação e licença.',
  },
];

/**
 * 5.1.4 stands on its own, like 5.1.3 before it. 5.1.5 intentionally reuses this
 * exact modal for its focused hotfix. Everyone who installed 5.1.3 already
 * read its two entries, so repeating them here would bury the eight changes that are
 * actually new. The order below is the authored order and also the rendered one: the
 * modal groups highlights by scope and puts the largest cluster first, and `ai` (four)
 * already leads, followed by `academic` (two), `library` and `zotero`.
 */
const RELEASE_5_1_4_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    category: 'enhancement',
    scope: 'ai',
    es: 'Las instrucciones que Nodus envía a la IA están ahora escritas de forma nativa en los ocho idiomas de la interfaz. Antes casi todas se redactaban en español y solo pedían al modelo que contestara en otro idioma, lo que se notaba en la calidad de la respuesta y en los términos que elegía. Ahora cada tarea tiene su propio contrato de instrucciones en tu idioma, desde el análisis del corpus hasta Deep Research, el Tutor, el Taller de escritura, el Diccionario y Nodi. Las claves del protocolo, los identificadores y las reglas de cita se mantienen intactas.',
    en: 'The instructions Nodus sends to the AI are now written natively in all eight interface languages. Almost all of them used to be drafted in Spanish and merely asked the model to answer in another language, which showed in the quality of the answer and in the terms it chose. Every task now has its own instruction contract in your language, from corpus analysis to Deep Research, the Tutor, the Writing Workshop, the Dictionary and Nodi. Protocol keys, identifiers and citation rules are left untouched.',
    fr: 'Les instructions que Nodus envoie à l’IA sont désormais rédigées nativement dans les huit langues de l’interface. Presque toutes étaient écrites en espagnol et demandaient simplement au modèle de répondre dans une autre langue, ce qui se voyait dans la qualité de la réponse et dans les termes choisis. Chaque tâche dispose maintenant de son propre contrat d’instructions dans votre langue, de l’analyse du corpus à Deep Research, au Tuteur, à l’Atelier d’écriture, au Dictionnaire et à Nodi. Les clés du protocole, les identifiants et les règles de citation restent intacts.',
    de: 'Die Anweisungen, die Nodus an die KI schickt, sind jetzt in allen acht Oberflächensprachen nativ verfasst. Fast alle wurden zuvor auf Spanisch geschrieben und baten das Modell lediglich, in einer anderen Sprache zu antworten, was sich in der Qualität der Antwort und in der Wortwahl zeigte. Jede Aufgabe hat nun ihren eigenen Anweisungsvertrag in Ihrer Sprache, von der Korpusanalyse über Deep Research, den Tutor, die Schreibwerkstatt und das Wörterbuch bis zu Nodi. Protokollschlüssel, Bezeichner und Zitierregeln bleiben unverändert.',
    pt: 'As instruções que o Nodus envia à IA passam a estar escritas de forma nativa nos oito idiomas da interface. Quase todas eram redigidas em espanhol e apenas pediam ao modelo que respondesse noutro idioma, o que se notava na qualidade da resposta e nos termos escolhidos. Cada tarefa tem agora o seu próprio contrato de instruções no seu idioma, desde a análise do corpus até ao Deep Research, ao Tutor, à Oficina de escrita, ao Dicionário e ao Nodi. As chaves do protocolo, os identificadores e as regras de citação mantêm-se intactos.',
    'pt-BR': 'As instruções que o Nodus envia à IA agora são escritas de forma nativa nos oito idiomas da interface. Quase todas eram redigidas em espanhol e apenas pediam ao modelo que respondesse em outro idioma, o que aparecia na qualidade da resposta e nos termos escolhidos. Cada tarefa tem agora seu próprio contrato de instruções no seu idioma, da análise do corpus ao Deep Research, ao Tutor, à Oficina de escrita, ao Dicionário e ao Nodi. As chaves do protocolo, os identificadores e as regras de citação continuam intactos.',
  },
  {
    category: 'fix',
    scope: 'ai',
    es: 'Los textos que la aplicación genera fuera de la interfaz dejan de salir en español. Los avisos del complemento de Word, los mensajes del servidor web, los diálogos nativos del sistema y la documentación de Nodi siguen ahora el idioma que tengas configurado. Si tenías Nodus en inglés y veías advertencias en español, eso ya no ocurre.',
    en: 'Text the application generates outside the interface no longer comes out in Spanish. Word add-in warnings, server web messages, native system dialogs and Nodi documentation now follow the language you have set. If you ran Nodus in English and kept seeing Spanish warnings, that is over.',
    fr: 'Les textes que l’application produit en dehors de l’interface ne sortent plus en espagnol. Les avertissements du complément Word, les messages du serveur web, les boîtes de dialogue natives du système et la documentation de Nodi suivent désormais la langue que vous avez choisie. Si vous utilisiez Nodus en français et voyiez encore des avertissements en espagnol, c’est terminé.',
    de: 'Texte, die die Anwendung außerhalb der Oberfläche erzeugt, erscheinen nicht mehr auf Spanisch. Die Warnungen des Word-Add-ins, die Meldungen des Webservers, die nativen Systemdialoge und die Nodi-Dokumentation folgen jetzt der eingestellten Sprache. Wenn Sie Nodus auf Deutsch nutzten und weiterhin spanische Hinweise sahen, ist das vorbei.',
    pt: 'Os textos que a aplicação gera fora da interface deixam de aparecer em espanhol. Os avisos do suplemento do Word, as mensagens do servidor web, as caixas de diálogo nativas do sistema e a documentação do Nodi seguem agora o idioma que tiver configurado. Se usava o Nodus em português e continuava a ver avisos em espanhol, isso acabou.',
    'pt-BR': 'Os textos que o aplicativo gera fora da interface não aparecem mais em espanhol. Os avisos do suplemento do Word, as mensagens do servidor web, as caixas de diálogo nativas do sistema e a documentação do Nodi agora seguem o idioma que você configurou. Se você usava o Nodus em português e continuava vendo avisos em espanhol, isso acabou.',
  },
  {
    category: 'fix',
    scope: 'ai',
    es: 'Los modelos locales terminan los análisis exigentes. Nodus separa ahora la ventana de contexto del máximo de salida y calcula ese máximo para cada tarea, en vez de aplicar un tope fijo que cortaba la respuesta a medias. Los lotes se adaptan solos, se comprueba que la respuesta esté completa y, si no lo está, se reintenta con un plan menor. Ajustes estrena un control de ventana de contexto con modo automático y una ficha de la última petición local para ver qué se envió de verdad.',
    en: 'Local models finish demanding analyses. Nodus now separates the context window from the output budget and works that budget out per task, instead of applying a fixed ceiling that cut answers in half. Batches adapt on their own, each answer is checked for completeness and, when it is not complete, the work is retried with a smaller plan. Settings gains a context-window control with an automatic mode and a card showing the last local request, so you can see what was really sent.',
    fr: 'Les modèles locaux terminent les analyses exigeantes. Nodus sépare désormais la fenêtre de contexte du budget de sortie et calcule ce budget pour chaque tâche, au lieu d’appliquer un plafond fixe qui coupait la réponse en deux. Les lots s’adaptent tout seuls, chaque réponse est vérifiée et, si elle est incomplète, le travail est relancé avec un plan plus modeste. Les Paramètres gagnent un réglage de fenêtre de contexte avec mode automatique et une fiche de la dernière requête locale, pour voir ce qui a réellement été envoyé.',
    de: 'Lokale Modelle bringen anspruchsvolle Analysen zu Ende. Nodus trennt jetzt das Kontextfenster vom Ausgabebudget und berechnet dieses Budget pro Aufgabe, statt eine feste Obergrenze anzuwenden, die Antworten mitten entzweischnitt. Die Stapel passen sich selbst an, jede Antwort wird auf Vollständigkeit geprüft, und wenn sie unvollständig ist, wird mit einem kleineren Plan erneut versucht. Die Einstellungen erhalten eine Kontextfenster-Steuerung mit Automatikmodus und eine Karte zur letzten lokalen Anfrage, damit Sie sehen, was tatsächlich gesendet wurde.',
    pt: 'Os modelos locais terminam as análises exigentes. O Nodus separa agora a janela de contexto do orçamento de saída e calcula esse orçamento para cada tarefa, em vez de aplicar um limite fixo que cortava a resposta a meio. Os lotes adaptam-se sozinhos, verifica-se se a resposta está completa e, se não estiver, o trabalho é repetido com um plano menor. As Definições estreiam um controlo de janela de contexto com modo automático e uma ficha do último pedido local, para ver o que foi realmente enviado.',
    'pt-BR': 'Os modelos locais terminam as análises exigentes. O Nodus agora separa a janela de contexto do orçamento de saída e calcula esse orçamento para cada tarefa, em vez de aplicar um teto fixo que cortava a resposta pela metade. Os lotes se adaptam sozinhos, a resposta é verificada e, se estiver incompleta, o trabalho é refeito com um plano menor. As Configurações estreiam um controle de janela de contexto com modo automático e um card da última requisição local, para você ver o que foi realmente enviado.',
  },
  {
    category: 'fix',
    scope: 'ai',
    es: 'Renovar el análisis de una obra ya no puede dejarte sin nada. Si la renovación falla o la cancelas, el análisis anterior sigue intacto y visible. Si termina bien, se sustituyen ideas, vectores, relaciones, grafo y perfil sin dejar restos del análisis viejo. La cola también deja de mostrar «Pendiente» o «Analizando» en obras que ya no lo están.',
    en: 'Refreshing a work’s analysis can no longer leave you with nothing. If the refresh fails or you cancel it, the previous analysis stays intact and visible. If it succeeds, ideas, vectors, relationships, graph and profile are replaced without leaving any remains of the old analysis behind. The queue also stops showing “Pending” or “Analysing” on works that are neither.',
    fr: 'Relancer l’analyse d’une œuvre ne peut plus vous laisser sans rien. Si la relance échoue ou si vous l’annulez, l’analyse précédente reste intacte et visible. Si elle aboutit, idées, vecteurs, relations, graphe et profil sont remplacés sans laisser de restes de l’ancienne analyse. La file d’attente cesse aussi d’afficher « En attente » ou « Analyse en cours » sur des œuvres qui ne le sont plus.',
    de: 'Eine Analyse zu erneuern kann Sie nicht mehr mit nichts zurücklassen. Scheitert die Erneuerung oder brechen Sie sie ab, bleibt die vorherige Analyse unversehrt und sichtbar. Gelingt sie, werden Ideen, Vektoren, Beziehungen, Graph und Profil ersetzt, ohne Reste der alten Analyse zu hinterlassen. Auch die Warteschlange zeigt nicht länger „Ausstehend“ oder „Wird analysiert“ bei Werken, auf die das nicht mehr zutrifft.',
    pt: 'Renovar a análise de uma obra já não o pode deixar sem nada. Se a renovação falhar ou a cancelar, a análise anterior mantém-se intacta e visível. Se terminar bem, substituem-se ideias, vetores, relações, grafo e perfil sem deixar restos da análise antiga. A fila também deixa de mostrar «Pendente» ou «A analisar» em obras que já não estão nesse estado.',
    'pt-BR': 'Renovar a análise de uma obra não pode mais deixar você sem nada. Se a renovação falhar ou você cancelá-la, a análise anterior continua intacta e visível. Se terminar bem, ideias, vetores, relações, grafo e perfil são substituídos sem deixar restos da análise antiga. A fila também deixa de mostrar “Pendente” ou “Analisando” em obras que já não estão nesse estado.',
  },
  {
    category: 'enhancement',
    scope: 'academic',
    es: 'El perfil del documento reconoce ahora hipótesis y hallazgos como campos propios, con sus reglas de procedencia y de cobertura. Y la fusión de ideas deja de decidirse por un umbral de parecido entre vectores: el modelo tiene que justificar en cada caso si dos ideas son la misma, una variante o algo nuevo, y Nodus rechaza la fusión si la idea elegida no estaba entre las candidatas que se le ofrecieron.',
    en: 'The document profile now recognises hypotheses and findings as fields of their own, with their own provenance and coverage rules. And idea fusion is no longer decided by a vector-similarity threshold: the model has to justify in each case whether two ideas are the same, a variant or something new, and Nodus rejects the merge when the chosen idea was not among the candidates it was offered.',
    fr: 'Le profil du document reconnaît désormais les hypothèses et les résultats comme des champs à part entière, avec leurs propres règles de provenance et de couverture. Et la fusion des idées ne se décide plus par un seuil de similarité entre vecteurs : le modèle doit justifier à chaque fois si deux idées sont identiques, une variante ou quelque chose de nouveau, et Nodus refuse la fusion lorsque l’idée retenue ne figurait pas parmi les candidates proposées.',
    de: 'Das Dokumentprofil erkennt Hypothesen und Befunde jetzt als eigene Felder, mit eigenen Herkunfts- und Abdeckungsregeln. Und die Ideenfusion wird nicht mehr über einen Ähnlichkeitsschwellenwert zwischen Vektoren entschieden: Das Modell muss in jedem Fall begründen, ob zwei Ideen dieselbe sind, eine Variante oder etwas Neues, und Nodus weist die Zusammenführung zurück, wenn die gewählte Idee nicht unter den angebotenen Kandidaten war.',
    pt: 'O perfil do documento reconhece agora hipóteses e achados como campos próprios, com as suas regras de proveniência e de cobertura. E a fusão de ideias deixa de se decidir por um limiar de semelhança entre vetores: o modelo tem de justificar em cada caso se duas ideias são a mesma, uma variante ou algo novo, e o Nodus rejeita a fusão quando a ideia escolhida não estava entre as candidatas apresentadas.',
    'pt-BR': 'O perfil do documento agora reconhece hipóteses e achados como campos próprios, com suas regras de proveniência e de cobertura. E a fusão de ideias deixa de ser decidida por um limiar de semelhança entre vetores: o modelo precisa justificar em cada caso se duas ideias são a mesma, uma variante ou algo novo, e o Nodus rejeita a fusão quando a ideia escolhida não estava entre as candidatas oferecidas.',
  },
  {
    category: 'enhancement',
    scope: 'academic',
    es: 'El tutorial del vault académico se ha rehecho entero. Los catorce pasos antiguos, que señalaban botones que ya no existen, dejan paso a nueve pasos tranquilos que recorren una sola ruta: Biblioteca, Ideas y Grafo. Explica la diferencia entre Global y Este vault, por qué conviene analizar una sola fuente al principio, cómo verificar la evidencia de una idea y por qué el grafo tarda en poblarse. Está completo en los ocho idiomas.',
    en: 'The academic vault tour has been rebuilt from scratch. The old fourteen steps, which pointed at buttons that no longer exist, give way to nine calm steps along a single path: Library, Ideas and Graph. It explains the difference between Global and This vault, why it is better to analyse a single source at first, how to verify the evidence behind an idea and why the graph takes a while to fill up. It is complete in all eight languages.',
    fr: 'La visite guidée du coffre académique a été entièrement refaite. Les quatorze anciennes étapes, qui désignaient des boutons disparus, laissent place à neuf étapes tranquilles suivant un seul parcours : Bibliothèque, Idées et Graphe. Elle explique la différence entre Global et Ce coffre, pourquoi mieux vaut analyser une seule source au début, comment vérifier la preuve derrière une idée et pourquoi le graphe met du temps à se remplir. Elle est complète dans les huit langues.',
    de: 'Die Tour durch den akademischen Tresor wurde vollständig neu gebaut. Die alten vierzehn Schritte, die auf Schaltflächen zeigten, die es nicht mehr gibt, weichen neun ruhigen Schritten entlang eines einzigen Wegs: Bibliothek, Ideen und Graph. Sie erklärt den Unterschied zwischen Global und Diesem Tresor, warum es besser ist, zunächst eine einzige Quelle zu analysieren, wie man den Beleg hinter einer Idee prüft und warum der Graph Zeit braucht, um sich zu füllen. Sie liegt vollständig in allen acht Sprachen vor.',
    pt: 'O tutorial do cofre académico foi refeito por completo. Os catorze passos antigos, que apontavam para botões que já não existem, dão lugar a nove passos tranquilos ao longo de um único percurso: Biblioteca, Ideias e Grafo. Explica a diferença entre Global e Este cofre, porque convém analisar uma só fonte ao início, como verificar a evidência por trás de uma ideia e porque o grafo demora a encher-se. Está completo nos oito idiomas.',
    'pt-BR': 'O tutorial do cofre acadêmico foi refeito por completo. Os catorze passos antigos, que apontavam para botões que não existem mais, dão lugar a nove passos tranquilos ao longo de um único percurso: Biblioteca, Ideias e Grafo. Explica a diferença entre Global e Este cofre, por que convém analisar uma só fonte no começo, como verificar a evidência por trás de uma ideia e por que o grafo demora a encher. Está completo nos oito idiomas.',
  },
  {
    category: 'enhancement',
    scope: 'library',
    es: 'La Biblioteca añade las fechas de Zotero como columnas ordenables. Puedes ordenar por fecha de incorporación, de modificación y de consulta, y las fichas antiguas que no las guardaban siguen funcionando igual.',
    en: 'The Library adds Zotero’s dates as sortable columns. You can sort by date added, date modified and access date, and older records that never stored them keep working exactly as before.',
    fr: 'La Bibliothèque ajoute les dates de Zotero comme colonnes triables. Vous pouvez trier par date d’ajout, date de modification et date de consultation, et les anciennes fiches qui ne les enregistraient pas continuent de fonctionner comme avant.',
    de: 'Die Bibliothek ergänzt die Zotero-Daten als sortierbare Spalten. Sie können nach Hinzufügedatum, Änderungsdatum und Zugriffsdatum sortieren, und ältere Einträge, die diese nie gespeichert haben, funktionieren weiterhin genau wie zuvor.',
    pt: 'A Biblioteca acrescenta as datas do Zotero como colunas ordenáveis. Pode ordenar por data de adição, de modificação e de consulta, e as fichas antigas que não as guardavam continuam a funcionar como antes.',
    'pt-BR': 'A Biblioteca acrescenta as datas do Zotero como colunas ordenáveis. Você pode ordenar por data de inclusão, de modificação e de consulta, e as fichas antigas que não as guardavam continuam funcionando como antes.',
  },
  {
    category: 'fix',
    scope: 'zotero',
    es: 'El complemento de Zotero deja de acumular memoria. El motor de embeddings locales se apaga tras cinco minutos sin uso y también al cerrar el complemento o al cancelar la última petición. Los índices de evidencia antiguos se compactan la primera vez que se leen, sin perder textos, vectores, OCR ni citas. En el perfil diagnosticado el índice pasó de unos 168 MB a unos 13 MB.',
    en: 'The Zotero add-on stops piling up memory. The local embedding engine shuts down after five minutes of inactivity, and also when the add-on unloads or the last request is cancelled. Older evidence indexes are compacted the first time they are read, without losing text, vectors, OCR or citations. On the profile we diagnosed, the index went from about 168 MB down to about 13 MB.',
    fr: 'Le module Zotero cesse d’accumuler de la mémoire. Le moteur d’embeddings locaux s’éteint après cinq minutes d’inactivité, ainsi qu’à la fermeture du module ou à l’annulation de la dernière requête. Les anciens index de preuves sont compactés à la première lecture, sans perdre les textes, les vecteurs, l’OCR ni les citations. Sur le profil diagnostiqué, l’index est passé d’environ 168 Mo à environ 13 Mo.',
    de: 'Das Zotero-Add-on häuft keinen Speicher mehr an. Die lokale Embedding-Engine schaltet sich nach fünf Minuten ohne Nutzung ab, ebenso beim Entladen des Add-ons oder beim Abbrechen der letzten Anfrage. Ältere Belegindizes werden beim ersten Lesen verdichtet, ohne Texte, Vektoren, OCR oder Zitate zu verlieren. Im untersuchten Profil sank der Index von rund 168 MB auf rund 13 MB.',
    pt: 'O suplemento do Zotero deixa de acumular memória. O motor de embeddings locais desliga-se ao fim de cinco minutos sem uso e também ao fechar o suplemento ou ao cancelar o último pedido. Os índices de evidência antigos são compactados na primeira leitura, sem perder textos, vetores, OCR nem citações. No perfil diagnosticado, o índice passou de cerca de 168 MB para cerca de 13 MB.',
    'pt-BR': 'O complemento do Zotero deixa de acumular memória. O motor de embeddings locais se desliga após cinco minutos sem uso e também ao fechar o complemento ou ao cancelar a última requisição. Os índices de evidência antigos são compactados na primeira leitura, sem perder textos, vetores, OCR nem citações. No perfil diagnosticado, o índice caiu de cerca de 168 MB para cerca de 13 MB.',
  },
];

/**
 * v5.1.7 carries a single repair: the Dictionary status line announced a
 * failure while the definition was being written correctly. Its progress copy
 * travelled in a `message` field, so the main-process localizer rewrote it as
 * the generic "the operation could not be completed" notice in every language
 * other than Spanish. The sentences are now handed to the renderer untouched.
 */
const RELEASE_5_1_7_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    category: 'fix',
    scope: 'languages',
    es: 'Generar una definici\u00f3n del diccionario ya no parece un fallo. La l\u00ednea de estado anunciaba que la operaci\u00f3n no se pudo completar mientras la definici\u00f3n se escrib\u00eda sin problemas. Ahora muestra el progreso real en tu idioma: en cola, analizando corpus y generando definici\u00f3n.',
    en: 'Generating a dictionary definition no longer looks like a failure. The status line announced that the operation could not be completed while the definition was being written just fine. It now shows the real progress in your language: queued, analysing corpus and generating definition.',
    fr: 'G\u00e9n\u00e9rer une d\u00e9finition du dictionnaire ne ressemble plus \u00e0 un \u00e9chec. La ligne d\u2019\u00e9tat annon\u00e7ait que l\u2019op\u00e9ration n\u2019avait pas pu aboutir alors que la d\u00e9finition s\u2019\u00e9crivait sans probl\u00e8me. Elle affiche maintenant la progression r\u00e9elle dans votre langue : en file d\u2019attente, analyse du corpus et g\u00e9n\u00e9ration de la d\u00e9finition.',
    de: 'Das Erzeugen einer W\u00f6rterbuchdefinition sieht nicht l\u00e4nger nach einem Fehler aus. Die Statuszeile meldete, der Vorgang habe nicht abgeschlossen werden k\u00f6nnen, w\u00e4hrend die Definition einwandfrei geschrieben wurde. Jetzt zeigt sie den echten Fortschritt in Ihrer Sprache: in der Warteschlange, Korpus wird analysiert und Definition wird erzeugt.',
    pt: 'Gerar uma defini\u00e7\u00e3o do dicion\u00e1rio j\u00e1 n\u00e3o parece uma falha. A linha de estado anunciava que a opera\u00e7\u00e3o n\u00e3o p\u00f4de ser conclu\u00edda enquanto a defini\u00e7\u00e3o se escrevia sem problemas. Agora mostra o progresso real no seu idioma: em fila, a analisar o corpus e a gerar a defini\u00e7\u00e3o.',
    'pt-BR': 'Gerar uma defini\u00e7\u00e3o do dicion\u00e1rio n\u00e3o parece mais uma falha. A linha de status anunciava que a opera\u00e7\u00e3o n\u00e3o p\u00f4de ser conclu\u00edda enquanto a defini\u00e7\u00e3o era escrita sem problemas. Agora ela mostra o progresso real no seu idioma: na fila, analisando o corpus e gerando a defini\u00e7\u00e3o.',
  },
];

/**
 * v5.1.6 stands on its own with the three changes that are actually new: a
 * custom OpenAI-compatible provider in Settings, and the two translation
 * repairs for progress bars and main-process errors. The order below is the
 * authored order and also the rendered one: the modal groups highlights by
 * scope and puts the largest cluster first, and `languages` (two) leads `ai`.
 */
const RELEASE_5_1_6_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    category: 'fix',
    scope: 'languages',
    es: 'Las barras de progreso hablan ya tu idioma. Las líneas de indexación, embeddings, pasajes, cola e importación de Zotero se muestran traducidas en los ocho idiomas. Además dejan de aparecer avisos de error cuando todo va bien y conservan los nombres de tus bibliotecas y obras tal como son.',
    en: 'Progress bars now speak your language. Indexing, embeddings, passages, queue and Zotero import lines appear translated in all eight languages. False error notices no longer show up when everything is fine, and your library and work names stay exactly as they are.',
    fr: 'Les barres de progression parlent désormais votre langue. Les lignes d’indexation, d’embeddings, de passages, de file d’attente et d’importation Zotero s’affichent traduites dans les huit langues. Les faux avis d’erreur n’apparaissent plus quand tout va bien, et les noms de vos bibliothèques et de vos œuvres restent intacts.',
    de: 'Die Fortschrittsleisten sprechen jetzt Ihre Sprache. Die Zeilen für Indexierung, Embeddings, Passagen, Warteschlange und Zotero-Import erscheinen in allen acht Sprachen übersetzt. Falsche Fehlermeldungen erscheinen nicht mehr, wenn alles in Ordnung ist, und die Namen Ihrer Bibliotheken und Werke bleiben genau wie sie sind.',
    pt: 'As barras de progresso falam agora o seu idioma. As linhas de indexação, embeddings, passagens, fila e importação do Zotero aparecem traduzidas nos oito idiomas. Os falsos avisos de erro deixam de aparecer quando está tudo bem e os nomes das suas bibliotecas e obras mantêm-se tal como são.',
    'pt-BR': 'As barras de progresso agora falam o seu idioma. As linhas de indexação, embeddings, trechos, fila e importação do Zotero aparecem traduzidas nos oito idiomas. Os falsos avisos de erro não aparecem mais quando está tudo bem, e os nomes das suas bibliotecas e obras continuam exatamente como são.',
  },
  {
    category: 'fix',
    scope: 'languages',
    es: 'Los errores del proceso principal llegan ya traducidos a tu idioma. Más de mil mensajes que antes salían en español o como un aviso genérico explican ahora su causa real. La prueba de conexión lo muestra claro. Si Ollama no responde, verás su dirección, el código HTTP y la pregunta de si está en marcha.',
    en: 'Main-process errors now arrive translated into your language. More than a thousand messages that used to appear in Spanish or as a generic notice now explain their real cause. The connection test shows it clearly. If Ollama does not answer, you will see its address, the HTTP code and the question of whether it is running.',
    fr: 'Les erreurs du processus principal arrivent désormais traduites dans votre langue. Plus de mille messages qui s’affichaient en espagnol ou sous forme d’avis générique expliquent maintenant leur cause réelle. Le test de connexion le montre bien. Si Ollama ne répond pas, vous verrez son adresse, le code HTTP et la question de savoir s’il est en cours d’exécution.',
    de: 'Fehler aus dem Hauptprozess kommen jetzt in Ihrer Sprache übersetzt an. Mehr als tausend Meldungen, die zuvor auf Spanisch oder als allgemeiner Hinweis erschienen, erklären nun ihre tatsächliche Ursache. Der Verbindungstest zeigt es deutlich. Antwortet Ollama nicht, sehen Sie seine Adresse, den HTTP-Code und die Frage, ob es läuft.',
    pt: 'Os erros do processo principal chegam agora traduzidos para o seu idioma. Mais de mil mensagens que apareciam em espanhol ou como um aviso genérico explicam agora a sua causa real. O teste de ligação mostra-o bem. Se o Ollama não responder, verá o seu endereço, o código HTTP e a pergunta sobre se está em execução.',
    'pt-BR': 'Os erros do processo principal agora chegam traduzidos para o seu idioma. Mais de mil mensagens que apareciam em espanhol ou como um aviso genérico agora explicam sua causa real. O teste de conexão mostra isso bem. Se o Ollama não responder, você verá seu endereço, o código HTTP e a pergunta sobre se ele está em execução.',
  },
  {
    category: 'new',
    scope: 'ai',
    es: 'Ajustes estrena un proveedor personalizado compatible con la API de OpenAI. Escribe la dirección exacta de tu servidor, sin que Nodus añada nada a la ruta, y conecta otros proveedores o un proxy propio. Puedes escribir tus modelos a mano, descubrir los que publica el servidor y comprobar la conexión antes de usarlos. La clave es opcional y se guarda como el resto de credenciales.',
    en: 'Settings gains a custom provider compatible with the OpenAI API. Type the exact address of your server, with Nodus adding nothing to the path, and connect other providers or your own proxy. You can type your models by hand, discover the ones your server publishes and test the connection before using them. The key is optional and is stored like the other credentials.',
    fr: 'Les Paramètres accueillent un fournisseur personnalisé compatible avec l’API d’OpenAI. Saisissez l’adresse exacte de votre serveur, sans que Nodus n’ajoute rien au chemin, et connectez d’autres fournisseurs ou votre propre proxy. Vous pouvez saisir vos modèles à la main, découvrir ceux que publie votre serveur et tester la connexion avant de les utiliser. La clé est facultative et se conserve comme les autres identifiants.',
    de: 'Die Einstellungen erhalten einen benutzerdefinierten Anbieter, der mit der OpenAI-API kompatibel ist. Geben Sie die genaue Adresse Ihres Servers ein, ohne dass Nodus etwas an den Pfad anhängt, und verbinden Sie weitere Anbieter oder einen eigenen Proxy. Sie können Ihre Modelle von Hand eintragen, die von Ihrem Server veröffentlichten entdecken und die Verbindung vor der Nutzung testen. Der Schlüssel ist optional und wird wie die übrigen Zugangsdaten gespeichert.',
    pt: 'As Definições estreiam um fornecedor personalizado compatível com a API da OpenAI. Escreva o endereço exato do seu servidor, sem que o Nodus acrescente nada ao caminho, e ligue outros fornecedores ou um proxy próprio. Pode escrever os seus modelos à mão, descobrir os que o servidor publica e testar a ligação antes de os usar. A chave é opcional e guarda-se como as restantes credenciais.',
    'pt-BR': 'As Configurações estreiam um provedor personalizado compatível com a API da OpenAI. Digite o endereço exato do seu servidor, sem que o Nodus acrescente nada ao caminho, e conecte outros provedores ou um proxy próprio. Você pode digitar seus modelos à mão, descobrir os que o servidor publica e testar a conexão antes de usá-los. A chave é opcional e é guardada como as demais credenciais.',
  },
];

// v5.2.0: approved user-facing highlights in their modal scope order.
const RELEASE_5_2_0_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    category: 'new',
    scope: 'academic',
    "es": "Estrenamos Stellar, el nuevo grafo de ideas. Busca una idea y explora sus conexiones paso a paso o mediante reproducción automática. Puedes avanzar, retroceder y consultar las fuentes y evidencias de cada relación mientras recorres el grafo. Disponible en el corpus, las obras, Estudio, Inmersión y los espacios publicados de Nodus Server.",
    "en": "Introducing Stellar, the new idea graph. Search for an idea and explore its connections step by step or with automatic playback. Move forward, go back and consult the sources and evidence for each relationship as you explore the graph. Available in the corpus, works, Study, Immersion and published Nodus Server spaces.",
    "fr": "Découvrez Stellar, le nouveau graphe d’idées. Recherchez une idée et explorez ses connexions pas à pas ou en lecture automatique. Avancez, revenez en arrière et consultez les sources et les preuves de chaque relation au fil du parcours. Disponible dans le corpus, les œuvres, Étude, Immersion et les espaces publiés de Nodus Server.",
    "de": "Stellar ist da, der neue Ideengraph. Suchen Sie eine Idee und erkunden Sie ihre Verbindungen Schritt für Schritt oder per automatischer Wiedergabe. Gehen Sie vor und zurück und sehen Sie sich dabei die Quellen und Belege jeder Beziehung an. Verfügbar im Korpus, in Werken, Lernen, Immersion und veröffentlichten Nodus-Server-Bereichen.",
    "pt": "Apresentamos o Stellar, o novo grafo de ideias. Procure uma ideia e explore as suas ligações passo a passo ou com reprodução automática. Pode avançar, recuar e consultar as fontes e evidências de cada relação enquanto percorre o grafo. Disponível no corpus, nas obras, no Estudo, na Imersão e nos espaços publicados do Nodus Server.",
    "pt-BR": "Apresentamos o Stellar, o novo grafo de ideias. Busque uma ideia e explore suas conexões passo a passo ou com reprodução automática. Você pode avançar, voltar e consultar as fontes e evidências de cada relação enquanto percorre o grafo. Disponível no corpus, nas obras, no Estudo, na Imersão e nos espaços publicados do Nodus Server.",
  },
  {
    category: 'new',
    scope: 'academic',
    "es": "Varios grafos abiertos a la vez. Cada pestaña conserva sus ideas, posiciones, recorrido y panel de evidencias durante la sesión. Añade ideas desde el buscador, retíralas del lienzo o abre otra exploración sin sustituir la anterior. También puedes trabajar a pantalla completa.",
    "en": "Several graphs open at once. Each tab keeps its own ideas, positions, exploration history and evidence panel during the session. Add ideas from search, remove them from the canvas or open another exploration without replacing the previous one. You can also work in full screen.",
    "fr": "Plusieurs graphes ouverts à la fois. Chaque onglet conserve ses idées, ses positions, son parcours et son panneau de preuves pendant la session. Ajoutez des idées depuis la recherche, retirez-les du canevas ou ouvrez une autre exploration sans remplacer la précédente. Vous pouvez aussi travailler en plein écran.",
    "de": "Mehrere Graphen gleichzeitig öffnen. Jeder Tab behält während der Sitzung seine eigenen Ideen, Positionen, den Erkundungsverlauf und das Belegpanel. Fügen Sie Ideen über die Suche hinzu, entfernen Sie sie von der Zeichenfläche oder öffnen Sie eine weitere Erkundung, ohne die vorherige zu ersetzen. Sie können auch im Vollbild arbeiten.",
    "pt": "Vários grafos abertos ao mesmo tempo. Cada separador conserva as suas ideias, posições, percurso e painel de evidências durante a sessão. Adicione ideias a partir da pesquisa, retire-as da tela ou abra outra exploração sem substituir a anterior. Também pode trabalhar em ecrã inteiro.",
    "pt-BR": "Vários grafos abertos ao mesmo tempo. Cada aba conserva suas ideias, posições, percurso e painel de evidências durante a sessão. Adicione ideias pela busca, remova-as da tela ou abra outra exploração sem substituir a anterior. Você também pode trabalhar em tela cheia.",
  },
  {
    category: 'new',
    scope: 'academic',
    "es": "Un mapa de argumentos visual. Explora la idea central y sus ramas mediante tarjetas desplegables, filtra los tipos de relación y abre sus evidencias. El zoom automático te acerca al argumento seleccionado y puedes volver al encuadre anterior sin cerrar las ramas. La vista de esquema sigue disponible.",
    "en": "A visual argument map. Explore the central idea and its branches through expandable cards, filter relationship types and open their evidence. Automatic zoom brings the selected argument closer, and you can return to the previous view without closing branches. The outline view remains available.",
    "fr": "Une carte d’arguments visuelle. Explorez l’idée centrale et ses branches à l’aide de cartes dépliables, filtrez les types de relation et ouvrez leurs preuves. Le zoom automatique vous rapproche de l’argument sélectionné et vous pouvez revenir au cadrage précédent sans refermer les branches. La vue en plan reste disponible.",
    "de": "Eine visuelle Argumentkarte. Erkunden Sie die zentrale Idee und ihre Zweige mit aufklappbaren Karten, filtern Sie Beziehungstypen und öffnen Sie ihre Belege. Der automatische Zoom bringt das ausgewählte Argument näher. Sie können zur vorherigen Ansicht zurückkehren, ohne Zweige zu schließen. Die Gliederungsansicht bleibt verfügbar.",
    "pt": "Um mapa de argumentos visual. Explore a ideia central e os seus ramos através de cartões expansíveis, filtre os tipos de relação e abra as suas evidências. O zoom automático aproxima o argumento selecionado e pode voltar ao enquadramento anterior sem fechar os ramos. A vista de esquema continua disponível.",
    "pt-BR": "Um mapa de argumentos visual. Explore a ideia central e seus ramos com cartões expansíveis, filtre os tipos de relação e abra suas evidências. O zoom automático aproxima o argumento selecionado e você pode voltar ao enquadramento anterior sem fechar os ramos. A visualização em esquema continua disponível.",
  },
  {
    category: 'new',
    scope: 'academic',
    "es": "Pestañas en Deep Research e Inmersión. Mantén abiertos varios informes o sesiones y cambia entre ellos desde una barra de pestañas, con acceso directo a la galería. Deep Research recuerda además el punto de lectura de cada informe al alternar entre ellos.",
    "en": "Tabs in Deep Research and Immersion. Keep several reports or sessions open and switch between them from a tab bar, with direct access to the gallery. Deep Research also remembers your reading position in each report as you switch between them.",
    "fr": "Des onglets dans Deep Research et Immersion. Gardez plusieurs rapports ou sessions ouverts et passez de l’un à l’autre depuis une barre d’onglets, avec un accès direct à la galerie. Deep Research mémorise aussi votre position de lecture dans chaque rapport lorsque vous changez d’onglet.",
    "de": "Tabs in Deep Research und Immersion. Halten Sie mehrere Berichte oder Sitzungen geöffnet und wechseln Sie über eine Tableiste zwischen ihnen, mit direktem Zugang zur Galerie. Deep Research merkt sich beim Wechsel auch die Leseposition in jedem Bericht.",
    "pt": "Separadores no Deep Research e na Imersão. Mantenha vários relatórios ou sessões abertos e alterne entre eles numa barra de separadores, com acesso direto à galeria. O Deep Research também memoriza o ponto de leitura de cada relatório ao alternar entre eles.",
    "pt-BR": "Abas no Deep Research e na Imersão. Mantenha vários relatórios ou sessões abertos e alterne entre eles em uma barra de abas, com acesso direto à galeria. O Deep Research também lembra o ponto de leitura de cada relatório ao alternar entre eles.",
  },
  {
    category: 'enhancement',
    scope: 'academic',
    "es": "Ideas y evidencias más fáciles de leer. Las conexiones y los resúmenes tienen una presentación más sencilla, con menos recuadros anidados. El diálogo de ideas de una obra utiliza ahora un fondo opaco para que el contenido de detrás no interfiera con la lectura.",
    "en": "Ideas and evidence are easier to read. Connections and summaries have a simpler presentation, with fewer nested boxes. The ideas dialog for a work now uses an opaque background so the content behind it does not interfere with reading.",
    "fr": "Des idées et des preuves plus faciles à lire. Les connexions et les résumés adoptent une présentation plus simple, avec moins de cadres imbriqués. La fenêtre des idées d’une œuvre utilise désormais un fond opaque pour que le contenu situé derrière ne gêne pas la lecture.",
    "de": "Ideen und Belege sind leichter zu lesen. Verbindungen und Zusammenfassungen werden einfacher dargestellt, mit weniger verschachtelten Kästen. Der Ideendialog eines Werks hat jetzt einen undurchsichtigen Hintergrund, damit dahinterliegende Inhalte das Lesen nicht stören.",
    "pt": "Ideias e evidências mais fáceis de ler. As ligações e os resumos têm uma apresentação mais simples, com menos caixas dentro de outras caixas. O diálogo de ideias de uma obra utiliza agora um fundo opaco para que o conteúdo atrás não interfira com a leitura.",
    "pt-BR": "Ideias e evidências mais fáceis de ler. As conexões e os resumos têm uma apresentação mais simples, com menos caixas dentro de outras caixas. A janela de ideias de uma obra agora usa um fundo opaco para que o conteúdo atrás não atrapalhe a leitura.",
  },
  {
    category: 'fix',
    scope: 'academic',
    "es": "El diccionario muestra el estado correcto al terminar. Cuando se completa una definición, el indicador de generación da paso al estado real de la entrada. Las entradas activas ya no se quedan mostrando «Generado» durante el resto de la sesión.",
    "en": "The Dictionary shows the correct status when finished. Once a definition is complete, the generation indicator gives way to the entry's actual status. Active entries no longer keep showing “Generated” for the rest of the session.",
    "fr": "Le Dictionnaire affiche le bon état une fois la génération terminée. Lorsqu’une définition est achevée, l’indicateur de génération laisse place à l’état réel de l’entrée. Les entrées actives ne restent plus marquées « Généré » pendant le reste de la session.",
    "de": "Das Wörterbuch zeigt nach Abschluss den richtigen Status. Sobald eine Definition fertig ist, weicht die Erstellungsanzeige dem tatsächlichen Status des Eintrags. Aktive Einträge zeigen nicht mehr für den Rest der Sitzung „Erstellt“ an.",
    "pt": "O Dicionário mostra o estado correto ao terminar. Quando uma definição fica concluída, o indicador de geração dá lugar ao estado real da entrada. As entradas ativas deixam de mostrar «Gerado» durante o resto da sessão.",
    "pt-BR": "O Dicionário mostra o estado correto ao terminar. Quando uma definição é concluída, o indicador de geração dá lugar ao estado real da entrada. As entradas ativas deixam de mostrar “Gerado” durante o restante da sessão.",
  },
  {
    category: 'enhancement',
    scope: 'general',
    "es": "Un inicio renovado. Las tarjetas de las pantallas de inicio tienen una presentación más clara y se adaptan al espacio disponible. Mejoran el contraste en los temas claro y oscuro y mantienen los colores de cada bóveda para identificar sus secciones y estados.",
    "en": "A refreshed home. Cards on home screens have a clearer presentation and adapt to the available space. They improve contrast in light and dark themes and retain each vault's colors to identify its sections and statuses.",
    "fr": "Un accueil renouvelé. Les cartes des écrans d’accueil sont plus claires et s’adaptent à l’espace disponible. Leur contraste s’améliore dans les thèmes clair et sombre, tout en conservant les couleurs de chaque coffre pour identifier ses sections et ses états.",
    "de": "Eine überarbeitete Startseite. Die Karten der Startseiten sind übersichtlicher und passen sich dem verfügbaren Platz an. Ihr Kontrast im hellen und dunklen Design ist verbessert. Die Farben jedes Tresors kennzeichnen weiterhin seine Bereiche und Zustände.",
    "pt": "Um início renovado. Os cartões dos ecrãs iniciais têm uma apresentação mais clara e adaptam-se ao espaço disponível. Melhoram o contraste nos temas claro e escuro e mantêm as cores de cada cofre para identificar as suas secções e estados.",
    "pt-BR": "Um início renovado. Os cartões das telas iniciais têm uma apresentação mais clara e se adaptam ao espaço disponível. Melhoram o contraste nos temas claro e escuro e mantêm as cores de cada cofre para identificar suas seções e estados.",
  },
  {
    category: 'enhancement',
    scope: 'general',
    "es": "Toda la actividad, en la barra superior. La cola de procesamiento y los indicadores de progreso se reúnen en un panel desplegable. Consulta las tareas activas y pendientes y sigue su avance desde un mismo lugar, dejando más espacio para trabajar.",
    "en": "All activity in the top bar. The processing queue and progress indicators come together in a dropdown panel. Check active and pending tasks and follow their progress in one place, leaving more room to work.",
    "fr": "Toute l’activité dans la barre supérieure. La file de traitement et les indicateurs de progression sont réunis dans un panneau déroulant. Consultez les tâches actives et en attente et suivez leur avancée au même endroit, en gardant plus d’espace pour travailler.",
    "de": "Alle Aktivitäten in der oberen Leiste. Die Verarbeitungswarteschlange und die Fortschrittsanzeigen sind in einem ausklappbaren Panel vereint. Sehen Sie aktive und ausstehende Aufgaben ein und verfolgen Sie ihren Fortschritt an einer Stelle. So bleibt mehr Platz zum Arbeiten.",
    "pt": "Toda a atividade na barra superior. A fila de processamento e os indicadores de progresso reúnem-se num painel expansível. Consulte as tarefas ativas e pendentes e acompanhe o seu avanço no mesmo lugar, deixando mais espaço para trabalhar.",
    "pt-BR": "Toda a atividade na barra superior. A fila de processamento e os indicadores de progresso se reúnem em um painel suspenso. Consulte as tarefas ativas e pendentes e acompanhe seu avanço no mesmo lugar, deixando mais espaço para trabalhar.",
  },
  {
    category: 'enhancement',
    scope: 'general',
    "es": "Tú decides cuándo instalar las actualizaciones. Nodus descarga la nueva versión en segundo plano y te permite elegir entre «Instalar y reiniciar» o «Más tarde». La descarga ya no provoca un reinicio automático, y la instalación conserva la comprobación de la copia de seguridad previa.",
    "en": "You decide when to install updates. Nodus downloads the new version in the background and lets you choose “Install and restart” or “Later”. Downloading no longer triggers an automatic restart, and installation retains the pre-update backup check.",
    "fr": "Vous décidez quand installer les mises à jour. Nodus télécharge la nouvelle version en arrière-plan et vous laisse choisir « Installer et redémarrer » ou « Plus tard ». Le téléchargement ne déclenche plus de redémarrage automatique et l’installation conserve la vérification de la sauvegarde préalable.",
    "de": "Sie entscheiden, wann Updates installiert werden. Nodus lädt die neue Version im Hintergrund herunter und lässt Sie zwischen „Installieren und neu starten“ und „Später“ wählen. Der Download löst keinen automatischen Neustart mehr aus. Vor der Installation wird die vorherige Sicherung weiterhin geprüft.",
    "pt": "Decide quando instalar as atualizações. O Nodus descarrega a nova versão em segundo plano e permite escolher entre «Instalar e reiniciar» e «Mais tarde». A transferência deixa de provocar um reinício automático e a instalação mantém a verificação da cópia de segurança prévia.",
    "pt-BR": "Você decide quando instalar as atualizações. O Nodus baixa a nova versão em segundo plano e permite escolher entre “Instalar e reiniciar” e “Mais tarde”. O download não provoca mais uma reinicialização automática e a instalação mantém a verificação do backup prévio.",
  },
  {
    category: 'enhancement',
    scope: 'general',
    "es": "Ajustes recuerda dónde estabas. Al volver a abrir Ajustes, recuperas la última pestaña que estabas consultando. Los accesos directos a una sección concreta siguen llevándote a su destino.",
    "en": "Settings remembers where you were. When you reopen Settings, you return to the last tab you were viewing. Shortcuts to a specific section still take you to their intended destination.",
    "fr": "Les Paramètres se souviennent de votre position. Lorsque vous les rouvrez, vous retrouvez le dernier onglet consulté. Les raccourcis vers une section précise continuent de vous mener à leur destination.",
    "de": "Die Einstellungen merken sich Ihre Position. Wenn Sie die Einstellungen erneut öffnen, gelangen Sie zum zuletzt angezeigten Tab zurück. Verknüpfungen zu einem bestimmten Bereich führen weiterhin direkt dorthin.",
    "pt": "As Definições lembram-se de onde estava. Ao voltar a abrir as Definições, recupera o último separador que estava a consultar. Os atalhos para uma secção específica continuam a levá-lo ao respetivo destino.",
    "pt-BR": "As Configurações lembram onde você estava. Ao reabrir as Configurações, você recupera a última aba que estava consultando. Os atalhos para uma seção específica continuam levando ao destino correto.",
  },
  {
    category: 'enhancement',
    scope: 'general',
    "es": "Citas mejor presentadas. Las citas enlazadas y sus paréntesis permanecen juntos al cambiar de línea, evitando signos sueltos en los informes y las respuestas de los chats.",
    "en": "Better citation formatting. Linked citations and their parentheses stay together when a line wraps, avoiding stray punctuation in reports and chat responses.",
    "fr": "Des citations mieux présentées. Les citations liées et leurs parenthèses restent ensemble lors d’un retour à la ligne, évitant les signes isolés dans les rapports et les réponses des chats.",
    "de": "Besser dargestellte Quellenangaben. Verlinkte Quellenangaben und ihre Klammern bleiben beim Zeilenumbruch zusammen. So stehen Satzzeichen in Berichten und Chatantworten nicht mehr allein.",
    "pt": "Citações mais bem apresentadas. As citações com ligação e os seus parênteses mantêm-se juntos nas mudanças de linha, evitando sinais isolados nos relatórios e nas respostas dos chats.",
    "pt-BR": "Citações mais bem apresentadas. As citações com link e seus parênteses permanecem juntos nas quebras de linha, evitando sinais soltos nos relatórios e nas respostas dos chats.",
  },
  {
    category: 'new',
    scope: 'ai',
    "es": "Skills para personalizar tus conversaciones. Activa instrucciones reutilizables para estudiar, escribir, desarrollar ideas, comparar opciones o revisar un argumento. Puedes crear tus propias skills, importar archivos Markdown o JSON y editar las incluidas. Los chats comparten la configuración. Nodi mantiene su propia selección.",
    "en": "Skills to personalize your conversations. Enable reusable instructions for studying, writing, developing ideas, comparing options or reviewing an argument. You can create your own skills, import Markdown or JSON files and edit the included ones. Chats share the configuration. Nodi keeps its own selection.",
    "fr": "Des skills pour personnaliser vos conversations. Activez des instructions réutilisables pour étudier, écrire, développer des idées, comparer des options ou examiner un argument. Vous pouvez créer vos propres skills, importer des fichiers Markdown ou JSON et modifier celles qui sont incluses. Les chats partagent la configuration. Nodi conserve sa propre sélection.",
    "de": "Skills für individuellere Gespräche. Aktivieren Sie wiederverwendbare Anweisungen zum Lernen, Schreiben, Entwickeln von Ideen, Vergleichen von Optionen oder Prüfen eines Arguments. Sie können eigene Skills erstellen, Markdown- oder JSON-Dateien importieren und die mitgelieferten Skills bearbeiten. Die Chats teilen sich die Konfiguration. Nodi behält eine eigene Auswahl.",
    "pt": "Skills para personalizar as suas conversas. Ative instruções reutilizáveis para estudar, escrever, desenvolver ideias, comparar opções ou rever um argumento. Pode criar as suas próprias skills, importar ficheiros Markdown ou JSON e editar as incluídas. Os chats partilham a configuração. O Nodi mantém a sua própria seleção.",
    "pt-BR": "Skills para personalizar suas conversas. Ative instruções reutilizáveis para estudar, escrever, desenvolver ideias, comparar opções ou revisar um argumento. Você pode criar suas próprias skills, importar arquivos Markdown ou JSON e editar as incluídas. Os chats compartilham a configuração. O Nodi mantém sua própria seleção.",
  },
  {
    category: 'new',
    scope: 'ai',
    "es": "Diagramas e imágenes directamente en el chat. SVG Studio crea diagramas vectoriales e Image Atelier genera imágenes con el proveedor y modelo configurados en Ajustes. Puedes ampliar, copiar y descargar los resultados, consultar el código SVG o ver las instrucciones utilizadas para generar una imagen. Ambas skills vienen activadas de inicio.",
    "en": "Diagrams and images directly in chat. SVG Studio creates vector diagrams, and Image Atelier generates images with the provider and model configured in Settings. Enlarge, copy and download the results, inspect the SVG code or view the instructions used to generate an image. Both skills are enabled by default.",
    "fr": "Des diagrammes et des images directement dans le chat. SVG Studio crée des diagrammes vectoriels et Image Atelier génère des images avec le fournisseur et le modèle définis dans les Paramètres. Agrandissez, copiez et téléchargez les résultats, consultez le code SVG ou les instructions utilisées pour générer une image. Les deux skills sont activées par défaut.",
    "de": "Diagramme und Bilder direkt im Chat. SVG Studio erstellt Vektordiagramme. Image Atelier erzeugt Bilder mit dem in den Einstellungen gewählten Anbieter und Modell. Sie können Ergebnisse vergrößern, kopieren und herunterladen, den SVG-Code ansehen oder die Anweisungen zur Bilderzeugung lesen. Beide Skills sind standardmäßig aktiviert.",
    "pt": "Diagramas e imagens diretamente no chat. O SVG Studio cria diagramas vetoriais e o Image Atelier gera imagens com o fornecedor e o modelo configurados nas Definições. Pode ampliar, copiar e descarregar os resultados, consultar o código SVG ou ver as instruções utilizadas para gerar uma imagem. Ambas as skills vêm ativadas de início.",
    "pt-BR": "Diagramas e imagens diretamente no chat. O SVG Studio cria diagramas vetoriais e o Image Atelier gera imagens com o provedor e o modelo definidos nas Configurações. Você pode ampliar, copiar e baixar os resultados, consultar o código SVG ou ver as instruções usadas para gerar uma imagem. Ambas as skills vêm ativadas por padrão.",
  },
  {
    category: 'enhancement',
    scope: 'ai',
    "es": "Elegir modelo es más cómodo. Los selectores de modelos utilizan menús con búsqueda y una apariencia integrada con el tema de la aplicación. La búsqueda admite distintas formas de escribir el nombre y los desplegables se ajustan al espacio disponible.",
    "en": "Choosing a model is easier. Model selectors use searchable menus with a look that matches the app's theme. Search accepts different ways of writing the name, and dropdowns adapt to the available space.",
    "fr": "Choisir un modèle devient plus simple. Les sélecteurs de modèles proposent des menus avec recherche dont l’apparence suit le thème de l’application. La recherche accepte différentes façons d’écrire le nom et les menus s’adaptent à l’espace disponible.",
    "de": "Modelle lassen sich bequemer auswählen. Die Modellauswahl verwendet durchsuchbare Menüs, die zum Design der App passen. Die Suche akzeptiert unterschiedliche Schreibweisen des Namens. Die Menüs passen sich dem verfügbaren Platz an.",
    "pt": "Escolher um modelo é mais cómodo. Os seletores de modelos utilizam menus com pesquisa e uma aparência integrada no tema da aplicação. A pesquisa aceita diferentes formas de escrever o nome e os menus adaptam-se ao espaço disponível.",
    "pt-BR": "Escolher um modelo ficou mais fácil. Os seletores de modelos usam menus com busca e uma aparência integrada ao tema do aplicativo. A busca aceita diferentes formas de escrever o nome e os menus se adaptam ao espaço disponível.",
  },
  {
    category: 'new',
    scope: 'toolkit',
    "es": "Tus utilidades favoritas, a mano. Fija herramientas del Toolkit en la barra lateral mediante la chincheta de cada tarjeta. Abre directamente las que más utilizas y retira sus accesos cuando quieras.",
    "en": "Your favorite utilities close at hand. Pin Toolkit tools to the sidebar using the pin on each card. Open the ones you use most directly and remove their shortcuts whenever you like.",
    "fr": "Vos utilitaires favoris à portée de main. Épinglez les outils du Toolkit dans la barre latérale à l’aide de l’épingle de chaque carte. Ouvrez directement ceux que vous utilisez le plus et retirez leurs raccourcis quand vous le souhaitez.",
    "de": "Ihre bevorzugten Werkzeuge griffbereit. Heften Sie Toolkit-Werkzeuge über die Stecknadel auf jeder Karte an die Seitenleiste. Öffnen Sie häufig genutzte Werkzeuge direkt und entfernen Sie ihre Verknüpfungen jederzeit.",
    "pt": "Os seus utilitários favoritos à mão. Fixe ferramentas do Toolkit na barra lateral com o alfinete de cada cartão. Abra diretamente as que mais utiliza e retire os seus atalhos quando quiser.",
    "pt-BR": "Seus utilitários favoritos à mão. Fixe ferramentas do Toolkit na barra lateral usando o alfinete de cada cartão. Abra diretamente as que você mais usa e remova seus atalhos quando quiser.",
  },
];

/**
 * v5.4.0 combines the accumulated changes with all nine notes prepared for 5.3.2.
 * The modal groups scopes by size. Keep the IT/TR arrays aligned with this order.
 */
const RELEASE_5_4_0_HIGHLIGHTS: RawReleaseHighlight[] = [
  ...RELEASE_5_4_0_ADDITIONS,
  {
    category: 'new',
    scope: 'marketplace',
    es: "Chemistry Studio, Legalize y AlphaGenome ya son paquetes oficiales que instalas tú. Aparecen en Skills con su editor verificado, sus permisos, su tamaño y las plataformas en las que funcionan, y puedes instalarlos, actualizarlos, volver a la versión anterior o quitarlos cuando quieras. Lo que hacen no ha cambiado.",
    en: "Chemistry Studio, Legalize and AlphaGenome are now official packages you install yourself. They appear in Skills with their verified publisher, their permissions, their size and the platforms they run on, and you can install, update, roll back or remove any of them whenever you like. What they do has not changed.",
    fr: "Chemistry Studio, Legalize et AlphaGenome sont désormais des paquets officiels que vous installez vous-même. Ils apparaissent dans Skills avec leur éditeur vérifié, leurs permissions, leur taille et les plateformes prises en charge, et vous pouvez les installer, les mettre à jour, revenir en arrière ou les retirer quand vous voulez. Ce qu'ils font n'a pas changé.",
    de: "Chemistry Studio, Legalize und AlphaGenome sind jetzt offizielle Pakete, die Sie selbst installieren. Sie erscheinen unter Skills mit ihrem verifizierten Herausgeber, ihren Berechtigungen, ihrer Größe und den unterstützten Plattformen, und Sie können sie jederzeit installieren, aktualisieren, zurücksetzen oder entfernen. Was sie tun, hat sich nicht geändert.",
    pt: "O Chemistry Studio, o Legalize e o AlphaGenome são agora pacotes oficiais que instalas tu. Aparecem em Skills com o editor verificado, as permissões, o tamanho e as plataformas em que funcionam, e podes instalá-los, atualizá-los, voltar à versão anterior ou removê-los quando quiseres. O que fazem não mudou.",
    'pt-BR': "Chemistry Studio, Legalize e AlphaGenome agora são pacotes oficiais que você instala. Aparecem em Skills com o editor verificado, as permissões, o tamanho e as plataformas em que funcionam, e você pode instalar, atualizar, voltar à versão anterior ou remover quando quiser. O que eles fazem não mudou.",
  },
  {
    category: 'enhancement',
    scope: 'general',
    es: "Tu configuración se muda sola al actualizar. Si tenías Chemistry Studio activado, o una clave de AlphaGenome guardada, o una skill tuya que necesita una de estas capacidades, Nodus instala el paquete que corresponde y adopta la skill conservando su sitio en la lista, dónde la tenías activada y las instrucciones que hubieras editado. Funciona sin conexión porque los paquetes viajan dentro de la propia actualización.",
    en: "Your setup moves across on its own when you update. If Chemistry Studio was switched on, or you had an AlphaGenome key saved, or a skill of your own needs one of these capabilities, Nodus installs the matching package and adopts the skill with its place in the list, the surfaces it was enabled on and any instructions you had edited. It works with no connection because the packages travel inside the update itself.",
    fr: "Votre configuration migre toute seule à la mise à jour. Si Chemistry Studio était activé, si une clé AlphaGenome était enregistrée ou si une de vos skills a besoin de ces capacités, Nodus installe le paquet correspondant et adopte la skill en conservant sa place dans la liste, les surfaces où elle était activée et les instructions que vous aviez modifiées. Cela fonctionne sans connexion car les paquets voyagent dans la mise à jour elle-même.",
    de: "Ihre Einrichtung zieht beim Update von selbst mit um. War Chemistry Studio eingeschaltet, lag ein AlphaGenome-Schlüssel gespeichert vor oder braucht ein eigener Skill eine dieser Capabilities, installiert Nodus das passende Paket und übernimmt den Skill samt seinem Platz in der Liste, den Oberflächen, auf denen er aktiv war, und Ihren bearbeiteten Anweisungen. Das funktioniert ohne Verbindung, weil die Pakete im Update selbst mitreisen.",
    pt: "A tua configuração muda-se sozinha ao atualizar. Se tinhas o Chemistry Studio ligado, uma chave do AlphaGenome guardada ou uma skill tua que precisa destas capacidades, o Nodus instala o pacote correspondente e adota a skill mantendo o seu lugar na lista, as superfícies onde estava ligada e as instruções que tenhas editado. Funciona sem ligação porque os pacotes viajam dentro da própria atualização.",
    'pt-BR': "Sua configuração se muda sozinha ao atualizar. Se o Chemistry Studio estava ligado, havia uma chave do AlphaGenome salva ou uma skill sua precisa dessas capacidades, o Nodus instala o pacote correspondente e adota a skill mantendo seu lugar na lista, as superfícies onde estava ligada e as instruções que você tenha editado. Funciona sem conexão porque os pacotes viajam dentro da própria atualização.",
  },
  {
    category: 'enhancement',
    scope: 'general',
    es: "Nodus ocupa menos si no dibujas moléculas. Los motores químicos, el compilador de TeX y el resto de dependencias de estas tres áreas ya no viajan con la aplicación, sino dentro del paquete que las necesita. Una instalación limpia no descarga ni carga ninguna de las tres mientras no las pidas.",
    en: "Nodus takes up less room if you do not draw molecules. The chemistry engines, the TeX compiler and the rest of the dependencies these three areas need no longer travel with the application, only inside the package that needs them. A clean install neither downloads nor loads any of the three until you ask for one.",
    fr: "Nodus prend moins de place si vous ne dessinez pas de molécules. Les moteurs de chimie, le compilateur TeX et les autres dépendances de ces trois domaines ne voyagent plus avec l'application, mais dans le paquet qui en a besoin. Une installation propre ne télécharge ni ne charge aucun des trois tant que vous n'en demandez pas un.",
    de: "Nodus braucht weniger Platz, wenn Sie keine Moleküle zeichnen. Die Chemie-Engines, der TeX-Compiler und die übrigen Abhängigkeiten dieser drei Bereiche reisen nicht mehr mit der Anwendung, sondern in dem Paket, das sie braucht. Eine saubere Installation lädt und startet keines der drei, solange Sie keines anfordern.",
    pt: "O Nodus ocupa menos espaço se não desenhas moléculas. Os motores de química, o compilador de TeX e as restantes dependências destas três áreas já não viajam com a aplicação, apenas dentro do pacote que precisa delas. Uma instalação limpa não descarrega nem carrega nenhuma das três enquanto não pedires.",
    'pt-BR': "O Nodus ocupa menos espaço se você não desenha moléculas. Os motores de química, o compilador de TeX e as demais dependências dessas três áreas não viajam mais com o aplicativo, apenas dentro do pacote que precisa delas. Uma instalação limpa não baixa nem carrega nenhuma das três enquanto você não pedir.",
  },
  {
    category: 'enhancement',
    scope: 'plugin',
    es: "Cada paquete se configura en su propia ficha. La clave de AlphaGenome, la aceptación de sus términos y la instalación de su runtime de Python están ahora dentro del paquete, no repartidas por los ajustes de Nodus. Tu clave se guarda en el almacén de credenciales del sistema y llega al intérprete por su entrada estándar, nunca en una línea de comandos ni en un registro.",
    en: "Every package configures itself on its own card. The AlphaGenome key, accepting its terms and installing its Python runtime now live inside the package rather than scattered through the Nodus settings. Your key is kept in the system credential store and reaches the interpreter through its standard input, never on a command line or in a log.",
    fr: "Chaque paquet se configure sur sa propre fiche. La clé AlphaGenome, l'acceptation de ses conditions et l'installation de son runtime Python vivent désormais dans le paquet plutôt qu'éparpillées dans les réglages de Nodus. Votre clé est conservée dans le trousseau du système et parvient à l'interpréteur par son entrée standard, jamais sur une ligne de commande ni dans un journal.",
    de: "Jedes Paket richtet sich auf seiner eigenen Karte ein. Der AlphaGenome-Schlüssel, die Zustimmung zu seinen Bedingungen und die Installation seiner Python-Umgebung liegen nun im Paket statt verstreut in den Nodus-Einstellungen. Ihr Schlüssel bleibt im Anmeldeinformationsspeicher des Systems und erreicht den Interpreter über dessen Standardeingabe, nie über eine Befehlszeile oder ein Protokoll.",
    pt: "Cada pacote configura-se na sua própria ficha. A chave do AlphaGenome, a aceitação dos seus termos e a instalação do seu runtime de Python vivem agora dentro do pacote, em vez de espalhadas pelas definições do Nodus. A tua chave fica no armazém de credenciais do sistema e chega ao interpretador pela entrada padrão, nunca numa linha de comandos nem num registo.",
    'pt-BR': "Cada pacote se configura no seu próprio cartão. A chave do AlphaGenome, a aceitação dos seus termos e a instalação do seu runtime de Python agora ficam dentro do pacote, em vez de espalhadas pelas configurações do Nodus. Sua chave fica no armazenamento de credenciais do sistema e chega ao interpretador pela entrada padrão, nunca em uma linha de comando nem em um log.",
  },
  {
    category: 'enhancement',
    scope: 'plugin',
    es: "Un paquete solo llega firmado por NodusResearch. Nodus comprueba la firma y la huella exacta de lo que descarga antes de abrirlo, rechaza una versión más antigua que la instalada y rechaza un contenido distinto publicado con el mismo número. Una actualización que pida más permisos de los que aprobaste espera a que la revises en lugar de aplicarse sola.",
    en: "A package only arrives signed by NodusResearch. Nodus checks the signature and the exact fingerprint of what it downloads before opening it, refuses a version older than the one installed, and refuses different content published under the same number. An update that asks for more than you approved waits for you to review it instead of applying itself.",
    fr: "Un paquet n'arrive que signé par NodusResearch. Nodus vérifie la signature et l'empreinte exacte de ce qu'il télécharge avant de l'ouvrir, refuse une version plus ancienne que celle installée et refuse un contenu différent publié sous le même numéro. Une mise à jour qui demande plus que ce que vous aviez approuvé attend votre examen au lieu de s'appliquer seule.",
    de: "Ein Paket kommt nur signiert von NodusResearch an. Nodus prüft die Signatur und den genauen Fingerabdruck des Downloads, bevor es ihn öffnet, lehnt eine ältere Version als die installierte ab und lehnt abweichende Inhalte unter derselben Nummer ab. Ein Update, das mehr verlangt als Sie genehmigt haben, wartet auf Ihre Prüfung, statt sich selbst anzuwenden.",
    pt: "Um pacote só chega assinado pela NodusResearch. O Nodus verifica a assinatura e a impressão digital exata do que descarrega antes de o abrir, recusa uma versão mais antiga do que a instalada e recusa um conteúdo diferente publicado com o mesmo número. Uma atualização que peça mais do que aprovaste espera pela tua revisão em vez de se aplicar sozinha.",
    'pt-BR': "Um pacote só chega assinado pela NodusResearch. O Nodus verifica a assinatura e a impressão digital exata do que baixa antes de abri-lo, recusa uma versão mais antiga do que a instalada e recusa um conteúdo diferente publicado com o mesmo número. Uma atualização que peça mais do que você aprovou espera pela sua revisão em vez de se aplicar sozinha.",
  },
  {
    category: 'new',
    scope: 'ai',
    es: "Los resultados se guardan junto a la conversación y cada paquete decide qué ve el modelo. Una predicción de AlphaGenome sigue sin salir de tu dispositivo, y ahora esa regla la declara el propio paquete en lugar de estar escrita dentro de Nodus. Si desinstalas un paquete, los resultados que ya tenías en tus chats se conservan y puedes volver a instalarlo desde el propio mensaje.",
    en: "Results are stored beside the conversation and each package decides what the model sees. An AlphaGenome prediction still never leaves your device, and that rule is now declared by the package itself instead of being written into Nodus. If you uninstall a package, the results already in your chats are kept and you can reinstall it from the message itself.",
    fr: "Les résultats sont conservés à côté de la conversation et chaque paquet décide de ce que voit le modèle. Une prédiction AlphaGenome ne quitte toujours pas votre appareil, et cette règle est désormais déclarée par le paquet lui-même au lieu d'être inscrite dans Nodus. Si vous désinstallez un paquet, les résultats déjà présents dans vos conversations sont conservés et vous pouvez le réinstaller depuis le message.",
    de: "Ergebnisse liegen neben der Unterhaltung, und jedes Paket entscheidet, was das Modell sieht. Eine AlphaGenome-Vorhersage verlässt Ihr Gerät weiterhin nicht, und diese Regel erklärt nun das Paket selbst, statt in Nodus einprogrammiert zu sein. Wenn Sie ein Paket deinstallieren, bleiben die Ergebnisse in Ihren Chats erhalten und Sie können es direkt aus der Nachricht neu installieren.",
    pt: "Os resultados ficam guardados junto à conversa e cada pacote decide o que o modelo vê. Uma previsão do AlphaGenome continua a não sair do teu dispositivo, e essa regra passa a ser declarada pelo próprio pacote em vez de estar escrita dentro do Nodus. Se desinstalares um pacote, os resultados que já tinhas nos teus chats mantêm-se e podes reinstalá-lo a partir da própria mensagem.",
    'pt-BR': "Os resultados ficam guardados junto da conversa e cada pacote decide o que o modelo vê. Uma previsão do AlphaGenome continua não saindo do seu dispositivo, e essa regra agora é declarada pelo próprio pacote em vez de estar escrita dentro do Nodus. Se você desinstalar um pacote, os resultados que já tinha nos seus chats são mantidos e você pode reinstalá-lo a partir da própria mensagem.",
  },
  {
    category: 'enhancement',
    scope: 'toolkit',
    es: "Las carpetas del PDF Presenter ahora son etiquetas, que es lo que siempre fueron. Al pulsar una verás solo las presentaciones que la llevan, y al volver a pulsarla las verás todas otra vez. Borrar una etiqueta te pregunta antes y nunca se lleva sus presentaciones por delante. Solo dejan de estar etiquetadas. Las estanterías que organizaste antes de esta actualización se abren tal y como las dejaste.",
    en: "The PDF Presenter's folders are now tags, which is what they always were. Clicking one shows only the presentations that carry it, and clicking it again shows them all. Deleting a tag asks first and never takes its presentations with it. They simply stop being tagged. Shelves you organised before this update open exactly as you left them.",
    fr: "Les dossiers du PDF Presenter sont désormais des étiquettes, ce qu'ils ont toujours été. Cliquer sur l'une d'elles n'affiche que les présentations qui la portent, et cliquer à nouveau les affiche toutes. Supprimer une étiquette demande confirmation et n'emporte jamais ses présentations. Elles cessent simplement d'être étiquetées. Les étagères que vous aviez organisées avant cette mise à jour s'ouvrent telles que vous les aviez laissées.",
    de: "Die Ordner des PDF Presenter sind jetzt Tags, was sie immer schon waren. Ein Klick darauf zeigt nur die Präsentationen mit diesem Tag, ein erneuter Klick zeigt wieder alle. Das Löschen eines Tags fragt vorher nach und nimmt seine Präsentationen nie mit. Sie sind danach einfach ohne Tag. Regale, die Sie vor diesem Update sortiert haben, öffnen sich genau so, wie Sie sie verlassen haben.",
    pt: "As pastas do PDF Presenter são agora etiquetas, que é o que sempre foram. Carregar numa mostra apenas as apresentações que a têm, e carregar outra vez mostra-as todas. Eliminar uma etiqueta pergunta primeiro e nunca leva as suas apresentações atrás. Passam simplesmente a não ter etiqueta. As estantes que organizaste antes desta atualização abrem tal como as deixaste.",
    'pt-BR': "As pastas do PDF Presenter agora são etiquetas, que é o que sempre foram. Clicar em uma mostra apenas as apresentações que a têm, e clicar de novo mostra todas. Excluir uma etiqueta pergunta antes e nunca leva as apresentações junto. Elas simplesmente deixam de ter etiqueta. As estantes que você organizou antes desta atualização abrem exatamente como você as deixou.",
  },
  {
    category: 'new',
    scope: 'toolkit',
    es: "Una presentación ya puede salir de la biblioteca. Descargar PDF guarda donde tú quieras la copia que Nodus conserva, así que una presentación que importaste desde PowerPoint o Keynote es tuya en PDF aunque ya no tengas el original. La copia de tu estantería se queda donde está.",
    en: "A presentation can now leave the library. Download PDF saves the copy Nodus keeps wherever you choose, so a deck you imported from PowerPoint or Keynote is yours as a PDF even if you no longer have the original. The copy on your shelf stays where it is.",
    fr: "Une présentation peut enfin quitter la bibliothèque. Télécharger le PDF enregistre où vous voulez la copie que Nodus conserve, donc une présentation importée depuis PowerPoint ou Keynote est à vous en PDF même si vous n'avez plus l'original. La copie de votre étagère reste où elle est.",
    de: "Eine Präsentation kann die Bibliothek jetzt verlassen. PDF herunterladen speichert die Kopie, die Nodus aufbewahrt, an einem Ort Ihrer Wahl. So gehört Ihnen ein aus PowerPoint oder Keynote importierter Foliensatz als PDF, auch wenn Sie das Original nicht mehr haben. Die Kopie im Regal bleibt, wo sie ist.",
    pt: "Uma apresentação já pode sair da biblioteca. Transferir PDF guarda onde quiseres a cópia que o Nodus mantém, por isso uma apresentação que importaste do PowerPoint ou do Keynote é tua em PDF mesmo que já não tenhas o original. A cópia da tua estante fica onde está.",
    'pt-BR': "Uma apresentação já pode sair da biblioteca. Baixar PDF salva onde você quiser a cópia que o Nodus mantém, então uma apresentação que você importou do PowerPoint ou do Keynote é sua em PDF mesmo que não tenha mais o original. A cópia da sua estante continua onde está.",
  },
  {
    category: 'enhancement',
    scope: 'toolkit',
    es: "El importador de notas lee un segundo tipo de archivo TXT. Además del formato que exporta Nodus, ahora acepta archivos de notas recuperadas que solo listan las diapositivas que tienen nota. Nodus toma el número de diapositivas de la cabecera del propio archivo, así que un archivo con notas para 130 de 140 ya no parece un descuadre.",
    en: "The notes importer reads a second kind of TXT file. Alongside the format Nodus exports, it now accepts recovered notes files that list only the slides that have a note. Nodus takes the deck length from the file's own header, so a file with notes for 130 slides out of 140 no longer looks like a mismatch.",
    fr: "L'importateur de notes lit un second type de fichier TXT. En plus du format exporté par Nodus, il accepte maintenant les fichiers de notes récupérées qui ne listent que les diapositives ayant une note. Nodus lit le nombre de diapositives dans l'en-tête du fichier, donc un fichier avec des notes pour 130 diapositives sur 140 ne ressemble plus à une erreur.",
    de: "Der Notizen-Import liest eine zweite Art von TXT-Datei. Neben dem Format, das Nodus exportiert, akzeptiert er nun wiederhergestellte Notizdateien, die nur die Folien mit einer Notiz auflisten. Nodus entnimmt die Anzahl der Folien der Kopfzeile der Datei selbst, sodass eine Datei mit Notizen für 130 von 140 Folien nicht mehr wie ein Fehler aussieht.",
    pt: "O importador de notas lê um segundo tipo de ficheiro TXT. Além do formato que o Nodus exporta, aceita agora ficheiros de notas recuperadas que listam apenas os diapositivos que têm nota. O Nodus lê o número de diapositivos no cabeçalho do próprio ficheiro, por isso um ficheiro com notas para 130 de 140 já não parece um erro.",
    'pt-BR': "O importador de notas lê um segundo tipo de arquivo TXT. Além do formato que o Nodus exporta, agora aceita arquivos de notas recuperadas que listam apenas os slides que têm nota. O Nodus lê a quantidade de slides no cabeçalho do próprio arquivo, então um arquivo com notas para 130 de 140 não parece mais um erro.",
  },
];

/**
 * v5.3.1 — the Skills Marketplace learns what you already have, and skills start
 * arriving as plugins.
 *
 * Written for someone who opened Skills once and closed it again: what is different
 * for THEM. The plugin entries lead because the sandbox is the promise the rest of the
 * release rests on, and the last entry keeps the three small visible fixes together
 * instead of spending a card on each.
 */
const RELEASE_5_3_1_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    category: 'fix',
    scope: 'marketplace',
    es: "El Marketplace ya sabe qué skills tienes. Las skills incluidas en Nodus aparecen como instaladas en vez de ofrecerse otra vez, un filtro Todas / Instaladas / Disponibles revisa tu biblioteca desde el catálogo y cada skill instalada se puede quitar desde su tarjeta. Instalar una entrada que Nodus ya incluye restaura la versión de tu instalación en lugar de añadir un duplicado, y limpia el duplicado que hubiera dejado una versión anterior.",
    en: "The Marketplace now knows which skills you already have. Skills included in Nodus appear as installed instead of being offered again, an All / Installed / Available filter reviews your library from the catalog, and every installed skill can be removed from its card. Installing an entry Nodus already includes restores the version shipped with your build instead of adding a duplicate, and clears out a duplicate an earlier build had installed.",
    fr: "Le Marketplace sait désormais quelles skills vous possédez déjà. Les skills incluses dans Nodus apparaissent comme installées au lieu d’être proposées à nouveau, un filtre Toutes / Installées / Disponibles passe votre bibliothèque en revue depuis le catalogue et chaque skill installée peut être retirée depuis sa fiche. Installer une entrée que Nodus inclut déjà restaure la version livrée avec votre build au lieu d’ajouter un doublon, et supprime le doublon laissé par une version antérieure.",
    de: "Der Marketplace weiß jetzt, welche Skills Sie bereits haben. In Nodus enthaltene Skills erscheinen als installiert, statt erneut angeboten zu werden. Ein Filter Alle / Installiert / Verfügbar prüft Ihre Bibliothek vom Katalog aus, und jeder installierte Skill lässt sich auf seiner Karte entfernen. Ein Eintrag, den Nodus bereits enthält, stellt bei der Installation die mitgelieferte Fassung wieder her, statt ein Duplikat anzulegen, und räumt ein Duplikat einer früheren Version mit auf.",
    pt: "O Marketplace já sabe que skills tem. As skills incluídas no Nodus aparecem como instaladas em vez de serem oferecidas de novo, um filtro Todas / Instaladas / Disponíveis revê a sua biblioteca a partir do catálogo e cada skill instalada pode ser retirada no seu cartão. Instalar uma entrada que o Nodus já inclui repõe a versão da sua instalação em vez de acrescentar um duplicado, e limpa o duplicado deixado por uma versão anterior.",
    'pt-BR': "O Marketplace agora sabe quais skills você já tem. As skills incluídas no Nodus aparecem como instaladas em vez de serem oferecidas de novo, um filtro Todas / Instaladas / Disponíveis revisa sua biblioteca a partir do catálogo e cada skill instalada pode ser removida no seu cartão. Instalar uma entrada que o Nodus já inclui restaura a versão do seu build em vez de acrescentar uma duplicata, e limpa a duplicata deixada por uma versão anterior.",
  },
  {
    category: 'enhancement',
    scope: 'marketplace',
    es: "Ahora te enteras antes de instalar si un plugin necesita un Nodus más nuevo. La pantalla de revisión compara tu versión con la que el plugin exige y lo indica encima del botón de instalar, y la confirmación lo repite. Un plugin que ya está esperando indica en su tarjeta la versión que necesita, en lugar de mostrar su propia descripción sin explicar nada.",
    en: "You find out before installing when a plugin needs a newer Nodus. The review screen compares your build with the version the plugin requires and says so above the install button, and the confirmation repeats it. A plugin that is already waiting now names the version it needs on its card, instead of showing its own description with no reason given.",
    fr: "Vous savez avant l’installation qu’un plugin exige un Nodus plus récent. L’écran de vérification compare votre build à la version requise par le plugin et l’indique au-dessus du bouton d’installation, et la confirmation le répète. Un plugin déjà en attente indique maintenant sur sa fiche la version dont il a besoin, au lieu d’afficher sa propre description sans donner de raison.",
    de: "Sie erfahren schon vor der Installation, wenn ein Plugin ein neueres Nodus braucht. Die Prüfansicht vergleicht Ihre Version mit der geforderten und weist über der Schaltfläche darauf hin, und die Bestätigung wiederholt es. Ein bereits wartendes Plugin nennt auf seiner Karte jetzt die benötigte Version, statt ohne Begründung nur die eigene Beschreibung zu zeigen.",
    pt: "Passa a saber antes de instalar se um plugin precisa de um Nodus mais recente. O ecrã de revisão compara a sua versão com a exigida pelo plugin e indica-o por cima do botão de instalar, e a confirmação repete-o. Um plugin que já está à espera indica no seu cartão a versão de que precisa, em vez de mostrar a própria descrição sem explicação.",
    'pt-BR': "Você descobre antes de instalar se um plugin precisa de um Nodus mais novo. A tela de revisão compara sua versão com a exigida pelo plugin e informa isso acima do botão de instalar, e a confirmação repete a mensagem. Um plugin que já está aguardando agora indica no seu cartão a versão de que precisa, em vez de mostrar a própria descrição sem explicar nada.",
  },
  {
    category: 'new',
    scope: 'plugin',
    es: "Las skills ya pueden llegar como plugins. Un plugin es un paquete con versión que agrupa varias skills junto a sus propias herramientas aisladas. Esas herramientas se ejecutan en una sesión temporal de Chromium sin acceso a tus archivos, a Nodus ni a la red, y solo salen al exterior por las direcciones HTTPS que declara el paquete. Las claves que configures las inserta Nodus en la petición y nunca son visibles para el código del plugin.",
    en: "Skills can now arrive as plugins. A plugin is one versioned package that bundles several skills together with sandboxed tools of their own. Those tools run in a temporary Chromium session with no access to your files, to Nodus or to the network, and they reach the outside only through the HTTPS addresses the package declares. Keys you configure are inserted by Nodus into the request and are never visible to the plugin's code.",
    fr: "Les skills peuvent désormais arriver sous forme de plugins. Un plugin est un paquet versionné qui regroupe plusieurs skills avec leurs propres outils isolés. Ces outils s’exécutent dans une session Chromium temporaire sans accès à vos fichiers, à Nodus ni au réseau, et ne sortent que par les adresses HTTPS déclarées par le paquet. Les clés que vous configurez sont insérées par Nodus dans la requête et ne sont jamais visibles pour le code du plugin.",
    de: "Skills können jetzt als Plugins kommen. Ein Plugin ist ein versioniertes Paket, das mehrere Skills zusammen mit eigenen abgeschotteten Werkzeugen bündelt. Diese Werkzeuge laufen in einer temporären Chromium-Sitzung ohne Zugriff auf Ihre Dateien, auf Nodus oder das Netzwerk und erreichen die Außenwelt nur über die HTTPS-Adressen, die das Paket angibt. Schlüssel, die Sie hinterlegen, fügt Nodus in die Anfrage ein und sie sind für den Code des Plugins nie sichtbar.",
    pt: "As skills já podem chegar como plugins. Um plugin é um pacote com versão que reúne várias skills e as suas próprias ferramentas isoladas. Essas ferramentas correm numa sessão temporária do Chromium sem acesso aos seus ficheiros, ao Nodus nem à rede, e só saem para o exterior pelos endereços HTTPS que o pacote declara. As chaves que configurar são inseridas pelo Nodus no pedido e nunca ficam visíveis para o código do plugin.",
    'pt-BR': "As skills agora podem chegar como plugins. Um plugin é um pacote versionado que reúne várias skills junto com suas próprias ferramentas isoladas. Essas ferramentas rodam em uma sessão temporária do Chromium sem acesso aos seus arquivos, ao Nodus nem à rede, e só alcançam o exterior pelos endereços HTTPS que o pacote declara. As chaves que você configurar são inseridas pelo Nodus na requisição e nunca ficam visíveis para o código do plugin.",
  },
  {
    category: 'enhancement',
    scope: 'plugin',
    es: "Los plugins se actualizan como una unidad y siempre se pueden deshacer. Una actualización que pide más de lo que aprobaste espera tu aprobación, las instrucciones que hayas editado sobreviven como una capa que puedes restablecer y la versión anterior sigue disponible. Un plugin que dejes en la carpeta del perfil se lista para revisarlo con los permisos exactos que pide, y nada suyo se ejecuta antes de que lo apruebes. Las herramientas locales tienen ahora su propio cupo de dieciséis llamadas por respuesta, aparte de las cuatro de todo lo que sale a la red o toca tus claves.",
    en: "Plugins update as one unit and can always be undone. An update that asks for more than you approved waits for your approval, instructions you edited locally survive as an overlay you can reset, and the previous version stays available. A plugin dropped into the profile folder is listed for review with the exact permissions it requests, and nothing in it runs before you approve it. Local tools now have their own allowance of sixteen calls per reply, apart from the four for anything that reaches the network or your keys.",
    fr: "Les plugins se mettent à jour d’un bloc et restent toujours réversibles. Une mise à jour qui demande plus que ce que vous avez approuvé attend votre accord, les instructions que vous avez modifiées survivent comme une couche réinitialisable et la version précédente reste disponible. Un plugin déposé dans le dossier du profil est listé pour vérification avec les autorisations exactes qu’il demande, et rien ne s’y exécute avant votre approbation. Les outils locaux disposent maintenant de leur propre quota de seize appels par réponse, distinct des quatre réservés à tout ce qui atteint le réseau ou vos clés.",
    de: "Plugins aktualisieren sich als Einheit und lassen sich immer zurücknehmen. Eine Aktualisierung, die mehr verlangt als von Ihnen genehmigt, wartet auf Ihre Zustimmung, lokal bearbeitete Anweisungen bleiben als zurücksetzbare Ebene erhalten und die vorherige Fassung bleibt verfügbar. Ein Plugin im Profilordner wird mit genau den Berechtigungen zur Prüfung aufgeführt, die es verlangt, und nichts daraus läuft vor Ihrer Freigabe. Lokale Werkzeuge haben jetzt ein eigenes Kontingent von sechzehn Aufrufen pro Antwort, getrennt von den vier für alles, was ins Netz geht oder Ihre Schlüssel berührt.",
    pt: "Os plugins atualizam-se como uma unidade e podem sempre ser desfeitos. Uma atualização que pede mais do que aprovou fica à espera da sua aprovação, as instruções que editou sobrevivem como uma camada que pode repor e a versão anterior continua disponível. Um plugin colocado na pasta do perfil é listado para revisão com as permissões exatas que pede, e nada dele corre antes de o aprovar. As ferramentas locais passam a ter a sua própria quota de dezasseis chamadas por resposta, separada das quatro de tudo o que sai para a rede ou toca nas suas chaves.",
    'pt-BR': "Os plugins são atualizados como uma unidade e sempre podem ser desfeitos. Uma atualização que pede mais do que você aprovou fica aguardando sua aprovação, as instruções que você editou sobrevivem como uma camada que pode ser restaurada e a versão anterior continua disponível. Um plugin colocado na pasta do perfil é listado para revisão com as permissões exatas que pede, e nada dele é executado antes de você aprovar. As ferramentas locais agora têm sua própria cota de dezesseis chamadas por resposta, separada das quatro de tudo o que sai para a rede ou toca nas suas chaves.",
  },
  {
    category: 'fix',
    scope: 'academic',
    es: "Deep Research respeta el número de secciones que eliges. El máximo que fijas es ahora un techo y no un mínimo, y no se pierde ninguna evidencia al compactar el plan para ajustarse a él. La nueva Extensión orientativa de cada sección ofrece Automático, 2.500, 5.000, 10.000, 15.000 y 20.000 palabras o la cifra que quieras. Cuenta palabras y no tokens, es una orientación editorial y no una cuota, y se guarda con el informe para volver contigo al reutilizar un prompt.",
    en: "Deep Research respects the number of sections you choose. The maximum you set is now a ceiling instead of a floor, and no evidence is dropped when the plan is compacted to fit it. A new Guideline section length offers Auto, 2,500, 5,000, 10,000, 15,000 and 20,000 words or a figure of your own. It counts words and not tokens, it is editorial guidance rather than a quota, and it is stored with the report so reusing a prompt brings it back.",
    fr: "Deep Research respecte le nombre de sections que vous choisissez. Le maximum que vous fixez est désormais un plafond et non un minimum, et aucune preuve n’est perdue lorsque le plan est compacté pour s’y tenir. La nouvelle Longueur indicative de chaque section propose Automatique, 2 500, 5 000, 10 000, 15 000 et 20 000 mots ou le chiffre de votre choix. Elle compte des mots et non des jetons, c’est une orientation éditoriale et non un quota, et elle est enregistrée avec le rapport pour revenir avec un prompt réutilisé.",
    de: "Deep Research hält sich an die Zahl der Abschnitte, die Sie wählen. Das eingestellte Maximum ist jetzt eine Obergrenze und kein Mindestwert, und beim Verdichten des Plans geht kein Beleg verloren. Die neue Richtlänge je Abschnitt bietet Automatisch, 2.500, 5.000, 10.000, 15.000 und 20.000 Wörter oder einen eigenen Wert. Sie zählt Wörter und keine Token, ist redaktionelle Orientierung und keine Quote, und wird mit dem Bericht gespeichert, sodass sie bei einem wiederverwendeten Prompt zurückkommt.",
    pt: "O Deep Research respeita o número de secções que escolhe. O máximo que define é agora um teto e não um mínimo, e não se perde nenhuma evidência ao compactar o plano para o cumprir. A nova Extensão orientativa de cada secção oferece Automático, 2.500, 5.000, 10.000, 15.000 e 20.000 palavras ou o valor que quiser. Conta palavras e não tokens, é uma orientação editorial e não uma quota, e fica guardada com o relatório para regressar ao reutilizar um prompt.",
    'pt-BR': "O Deep Research respeita o número de seções que você escolhe. O máximo que você define agora é um teto e não um mínimo, e nenhuma evidência é perdida ao compactar o plano para caber nele. A nova Extensão orientativa de cada seção oferece Automático, 2.500, 5.000, 10.000, 15.000 e 20.000 palavras ou o valor que você quiser. Ela conta palavras e não tokens, é orientação editorial e não uma cota, e fica salva com o relatório para voltar quando você reutilizar um prompt.",
  },
  {
    category: 'fix',
    scope: 'ai',
    es: "El selector de contexto del corpus del asistente se abre donde has hecho clic. Síntesis y los demás modos aparecen ahora en un globo anclado a su botón, en lugar de una ventana que tapa la conversación. Se cierra con Escape o con un clic fuera, y se coloca encima del botón cuando no hay sitio debajo.",
    en: "The assistant's corpus context picker opens where you clicked. Synthesis and the other modes now appear in a balloon anchored to their button, instead of a window covering the conversation. It closes with Escape or a click outside, and it flips above the button when there is no room below.",
    fr: "Le sélecteur de contexte du corpus de l’assistant s’ouvre là où vous avez cliqué. Synthèse et les autres modes apparaissent maintenant dans une bulle ancrée à leur bouton, au lieu d’une fenêtre qui recouvre la conversation. Elle se ferme avec Échap ou un clic à l’extérieur, et se place au-dessus du bouton quand il n’y a pas de place en dessous.",
    de: "Die Korpus-Kontextauswahl des Assistenten öffnet sich dort, wo Sie geklickt haben. Synthese und die übrigen Modi erscheinen jetzt in einer Sprechblase an ihrer Schaltfläche, statt in einem Fenster, das das Gespräch verdeckt. Sie schließt mit Escape oder einem Klick daneben und klappt nach oben, wenn darunter kein Platz ist.",
    pt: "O seletor de contexto do corpus do assistente abre onde clicou. Síntese e os restantes modos aparecem agora num balão ancorado ao seu botão, em vez de uma janela que tapa a conversa. Fecha-se com Escape ou com um clique fora, e coloca-se por cima do botão quando não há espaço em baixo.",
    'pt-BR': "O seletor de contexto do corpus do assistente abre onde você clicou. Síntese e os demais modos agora aparecem em um balão ancorado ao seu botão, em vez de uma janela que cobre a conversa. Ele fecha com Escape ou com um clique fora, e se posiciona acima do botão quando não há espaço embaixo.",
  },
  {
    category: 'fix',
    scope: 'languages',
    es: "El italiano se ofrece allí donde se elige el idioma de un informe. El selector del Laboratorio de escritura escribía sus opciones a mano y solo listaba siete de los ocho idiomas admitidos. Todos los compositores usan ahora la misma lista compartida, así que ya no puede faltar un idioma en uno de ellos.",
    en: "Italian is offered everywhere a report language is chosen. The Writing Workshop picker spelled out its options by hand and listed only seven of the eight supported languages. Every composer now renders the same shared list, so a language cannot go missing from one picker again.",
    fr: "L’italien est proposé partout où l’on choisit la langue d’un rapport. Le sélecteur du Laboratoire d’écriture écrivait ses options à la main et n’en listait que sept sur les huit langues prises en charge. Tous les compositeurs affichent désormais la même liste partagée, de sorte qu’une langue ne peut plus manquer dans l’un d’eux.",
    de: "Italienisch steht überall zur Wahl, wo eine Berichtssprache gewählt wird. Die Auswahl im Schreiblabor führte ihre Optionen von Hand auf und nannte nur sieben der acht unterstützten Sprachen. Alle Editoren zeigen jetzt dieselbe gemeinsame Liste, sodass in keinem mehr eine Sprache fehlen kann.",
    pt: "O italiano é oferecido em todos os sítios onde se escolhe o idioma de um relatório. O seletor do Laboratório de escrita escrevia as suas opções à mão e listava apenas sete dos oito idiomas suportados. Todos os compositores mostram agora a mesma lista partilhada, pelo que já não pode faltar um idioma num deles.",
    'pt-BR': "O italiano é oferecido em todos os lugares onde se escolhe o idioma de um relatório. O seletor do Laboratório de escrita escrevia suas opções à mão e listava apenas sete dos oito idiomas suportados. Todos os compositores agora mostram a mesma lista compartilhada, então não pode mais faltar um idioma em um deles.",
  },
  {
    category: 'fix',
    scope: 'general',
    es: "También corregimos tres detalles visibles. Salir del grafo Stellar mientras se dibuja ya no provoca un error. El panel de skills de Nodi mantiene visible la pista de cada interruptor y sus barras de desplazamiento siguen los temas claro y oscuro. Y un dibujo químico que no se puede verificar del todo se muestra ahora con sus etiquetas en lugar de descartarse.",
    en: "We also fixed three visible details. Leaving the Stellar graph while it is still drawing no longer raises an error. Nodi's skills panel keeps the track of every switch visible and its scrollbars follow the light and dark themes. And a chemical drawing that cannot be fully verified is now shown with its labels instead of being discarded.",
    fr: "Nous avons aussi corrigé trois détails visibles. Quitter le graphe Stellar pendant qu’il se dessine ne provoque plus d’erreur. Le panneau de skills de Nodi garde visible le rail de chaque interrupteur et ses barres de défilement suivent les thèmes clair et sombre. Et un dessin chimique qui ne peut pas être entièrement vérifié s’affiche désormais avec ses étiquettes au lieu d’être écarté.",
    de: "Außerdem haben wir drei sichtbare Details behoben. Das Verlassen des Stellar-Graphen während des Zeichnens löst keinen Fehler mehr aus. Das Skills-Panel von Nodi zeigt die Schiene jedes Schalters wieder an, und seine Bildlaufleisten folgen dem hellen und dunklen Design. Und eine chemische Zeichnung, die nicht vollständig geprüft werden kann, erscheint jetzt mit ihren Beschriftungen, statt verworfen zu werden.",
    pt: "Corrigimos também três detalhes visíveis. Sair do grafo Stellar enquanto está a desenhar já não provoca um erro. O painel de skills do Nodi mantém visível a calha de cada interruptor e as suas barras de deslocamento seguem os temas claro e escuro. E um desenho químico que não pode ser verificado por completo passa a ser mostrado com as suas etiquetas em vez de ser descartado.",
    'pt-BR': "Também corrigimos três detalhes visíveis. Sair do grafo Stellar enquanto ele está desenhando não provoca mais um erro. O painel de skills do Nodi mantém visível o trilho de cada interruptor e suas barras de rolagem seguem os temas claro e escuro. E um desenho químico que não pode ser verificado por completo passa a ser mostrado com seus rótulos em vez de ser descartado.",
  },
];

const RELEASE_5_3_0_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    category: 'new',
    scope: 'marketplace',
    es: 'Estrenamos el Marketplace de Skills. Desde Skills puedes explorar el catálogo oficial, revisar el contenido y las capacidades de cada paquete antes de instalarlo y añadir otros repositorios públicos de GitHub. Actualizar un catálogo no cambia lo que ya tienes instalado, y quitar una fuente tampoco borra sus skills.',
    en: 'Introducing the Skills Marketplace. From Skills you can explore the official catalog, review the contents and capabilities of every package before installing it, and add other public GitHub repositories. Updating a catalog does not change what you already have installed, and removing a source does not delete its skills either.',
    fr: 'Découvrez le Marketplace de Skills. Depuis Skills, vous pouvez explorer le catalogue officiel, examiner le contenu et les capacités de chaque paquet avant de l’installer et ajouter d’autres dépôts GitHub publics. La mise à jour d’un catalogue ne modifie pas ce qui est déjà installé, et retirer une source ne supprime pas non plus ses skills.',
    de: 'Der Skills Marketplace ist da. Unter Skills können Sie den offiziellen Katalog erkunden, Inhalt und Fähigkeiten jedes Pakets vor der Installation prüfen und weitere öffentliche GitHub-Repositories hinzufügen. Eine Katalogaktualisierung verändert bereits installierte Inhalte nicht, und das Entfernen einer Quelle löscht ihre Skills ebenfalls nicht.',
    pt: 'Estreia o Marketplace de Skills. Em Skills pode explorar o catálogo oficial, rever o conteúdo e as capacidades de cada pacote antes de o instalar e adicionar outros repositórios públicos do GitHub. Atualizar um catálogo não altera o que já tem instalado, e remover uma fonte também não apaga as suas skills.',
    'pt-BR': 'Estreia o Marketplace de Skills. Em Skills você pode explorar o catálogo oficial, revisar o conteúdo e as capacidades de cada pacote antes de instalá-lo e adicionar outros repositórios públicos do GitHub. Atualizar um catálogo não altera o que já está instalado, e remover uma fonte também não apaga suas skills.',
  },
  {
    category: 'new',
    scope: 'marketplace',
    es: 'Las skills ya pueden incluir herramientas JavaScript para cálculos, transformaciones y generadores. Se ejecutan en un entorno aislado sin acceso a tus archivos, credenciales, red ni datos de Nodus. También puedes importar y exportar paquetes completos, mientras el Asistente y Nodi conservan activaciones independientes.',
    en: 'Skills can now include JavaScript tools for calculations, transformations and generators. They run in an isolated environment without access to your files, credentials, network or Nodus data. You can also import and export complete packages, while the Assistant and Nodi keep independent activation settings.',
    fr: 'Les skills peuvent désormais inclure des outils JavaScript pour les calculs, les transformations et les générateurs. Ils s’exécutent dans un environnement isolé sans accès à vos fichiers, identifiants, réseau ni données Nodus. Vous pouvez aussi importer et exporter des paquets complets, tandis que l’Assistant et Nodi conservent des activations indépendantes.',
    de: 'Skills können jetzt JavaScript-Werkzeuge für Berechnungen, Umwandlungen und Generatoren enthalten. Sie laufen in einer isolierten Umgebung ohne Zugriff auf Ihre Dateien, Zugangsdaten, das Netzwerk oder Nodus-Daten. Sie können außerdem vollständige Pakete importieren und exportieren, während Assistent und Nodi getrennte Aktivierungen behalten.',
    pt: 'As skills já podem incluir ferramentas JavaScript para cálculos, transformações e geradores. São executadas num ambiente isolado sem acesso aos seus ficheiros, credenciais, rede nem dados do Nodus. Também pode importar e exportar pacotes completos, enquanto o Assistente e o Nodi mantêm ativações independentes.',
    'pt-BR': 'As skills agora podem incluir ferramentas JavaScript para cálculos, transformações e geradores. Elas são executadas em um ambiente isolado sem acesso aos seus arquivos, credenciais, rede nem dados do Nodus. Você também pode importar e exportar pacotes completos, enquanto o Assistente e o Nodi mantêm ativações independentes.',
  },
  {
    category: 'new',
    scope: 'ai',
    es: 'AlphaGenome llega como skill opcional para investigación no comercial. Tras añadir tu propia clave e instalar el cliente oficial, puedes pedir predicciones regulatorias de variantes GRCh38 desde los chats de Nodus. Los resultados y sus gráficas se guardan solo en este equipo, y las exportaciones conservan la atribución y las condiciones de uso.',
    en: 'AlphaGenome arrives as an optional skill for non-commercial research. After adding your own key and installing the official client, you can request regulatory predictions for GRCh38 variants from Nodus chats. Results and plots are stored only on this computer, and exports preserve attribution and the applicable terms of use.',
    fr: 'AlphaGenome arrive sous forme de skill facultative pour la recherche non commerciale. Après avoir ajouté votre propre clé et installé le client officiel, vous pouvez demander des prédictions régulatrices pour des variants GRCh38 depuis les chats de Nodus. Les résultats et leurs graphiques restent uniquement sur cet ordinateur, et les exportations conservent l’attribution et les conditions d’utilisation.',
    de: 'AlphaGenome kommt als optionaler Skill für nicht kommerzielle Forschung. Nachdem Sie Ihren eigenen Schlüssel hinterlegt und den offiziellen Client installiert haben, können Sie in Nodus-Chats regulatorische Vorhersagen für GRCh38-Varianten anfordern. Ergebnisse und Diagramme bleiben ausschließlich auf diesem Rechner, und Exporte bewahren Namensnennung und Nutzungsbedingungen.',
    pt: 'O AlphaGenome chega como skill opcional para investigação não comercial. Depois de adicionar a sua própria chave e instalar o cliente oficial, pode pedir previsões regulatórias de variantes GRCh38 nos chats do Nodus. Os resultados e gráficos ficam guardados apenas neste computador, e as exportações preservam a atribuição e as condições de utilização.',
    'pt-BR': 'O AlphaGenome chega como skill opcional para pesquisa não comercial. Depois de adicionar sua própria chave e instalar o cliente oficial, você pode pedir previsões regulatórias de variantes GRCh38 nos chats do Nodus. Os resultados e gráficos ficam armazenados apenas neste computador, e as exportações preservam a atribuição e os termos de uso.',
  },
  {
    category: 'new',
    scope: 'ai',
    es: 'Legalize permite consultar legislación de 32 repositorios nacionales y de la Unión Europea desde cualquier chat. Indica el país, la norma o su identificador y, si quieres, el artículo. Nodus recupera el texto real con su fuente oficial, revisión y atribuciones. No necesitas Git, cuenta ni clave de API.',
    en: 'Legalize lets you consult legislation from 32 reviewed national and European Union repositories in any chat. Name the country, the law or its identifier and, if needed, the article. Nodus retrieves the real text with its official source, revision and attribution. No Git installation, account or API key is required.',
    fr: 'Legalize permet de consulter la législation de 32 dépôts nationaux et de l’Union européenne vérifiés depuis n’importe quel chat. Indiquez le pays, la loi ou son identifiant et, si nécessaire, l’article. Nodus récupère le texte réel avec sa source officielle, sa révision et ses attributions. Aucun Git, compte ni clé API n’est nécessaire.',
    de: 'Mit Legalize können Sie in jedem Chat Rechtsvorschriften aus 32 geprüften nationalen und EU-Repositories abrufen. Nennen Sie das Land, das Gesetz oder seine Kennung und bei Bedarf den Artikel. Nodus holt den echten Text mit offizieller Quelle, Revision und Namensnennungen. Git, ein Konto oder ein API-Schlüssel sind nicht erforderlich.',
    pt: 'O Legalize permite consultar legislação de 32 repositórios nacionais e da União Europeia revistos a partir de qualquer chat. Indique o país, a lei ou o seu identificador e, se necessário, o artigo. O Nodus obtém o texto real com a fonte oficial, revisão e atribuições. Não precisa de Git, conta nem chave de API.',
    'pt-BR': 'O Legalize permite consultar legislação de 32 repositórios nacionais e da União Europeia revisados em qualquer chat. Informe o país, a lei ou seu identificador e, se necessário, o artigo. O Nodus obtém o texto real com a fonte oficial, revisão e atribuições. Você não precisa de Git, conta nem chave de API.',
  },
  {
    category: 'fix',
    scope: 'general',
    es: 'También pulimos tres detalles visibles. Las importaciones temporales dejan de fallar en Windows al guardar los archivos con seguridad. El control Contexto del grafo permanece en su sitio al activarlo. Y el tutorial de PDF Presenter recupera un icono y un degradado propios de una presentación.',
    en: 'We also polished three visible details. Temporary imports no longer fail on Windows when files are saved safely. The graph’s Context control stays in place when enabled. And the PDF Presenter tutorial now uses an icon and gradient that clearly identify it as a presentation.',
    fr: 'Nous avons aussi peaufiné trois détails visibles. Les importations temporaires n’échouent plus sous Windows lors de l’enregistrement sécurisé des fichiers. La commande Contexte du graphe reste en place une fois activée. Et le tutoriel PDF Presenter utilise désormais une icône et un dégradé qui l’identifient clairement comme une présentation.',
    de: 'Drei sichtbare Details wurden ebenfalls verbessert. Temporäre Importe schlagen unter Windows beim sicheren Speichern der Dateien nicht mehr fehl. Der Kontext-Schalter des Graphen bleibt beim Aktivieren an seinem Platz. Und das PDF-Presenter-Tutorial verwendet jetzt ein Symbol und einen Farbverlauf, die es klar als Präsentation kennzeichnen.',
    pt: 'Também aperfeiçoámos três detalhes visíveis. As importações temporárias deixam de falhar no Windows ao guardar os ficheiros em segurança. O controlo Contexto do grafo permanece no lugar quando é ativado. E o tutorial do PDF Presenter passa a usar um ícone e um degradado que o identificam claramente como apresentação.',
    'pt-BR': 'Também refinamos três detalhes visíveis. As importações temporárias não falham mais no Windows ao salvar os arquivos com segurança. O controle Contexto do grafo permanece no lugar quando é ativado. E o tutorial do PDF Presenter agora usa um ícone e um degradê que o identificam claramente como apresentação.',
  },
];

const RELEASE_5_2_2_HIGHLIGHTS: RawReleaseHighlight[] = [
  {
    category: 'new',
    scope: "ai",
    "es": "Chemistry Studio llega al chat. Crea estructuras moleculares a partir de SMILES, diagramas de Lewis y dibujos ChemFig, con controles para ampliar y descargar el resultado. La interfaz está traducida y las instrucciones personalizadas de tus habilidades se conservan.",
    "en": "Chemistry Studio comes to chat. Create molecular structures from SMILES, Lewis diagrams and ChemFig drawings, with controls to enlarge and download the result. The interface is translated and your customized skill instructions are preserved.",
    "fr": "Chemistry Studio arrive dans le chat. Créez des structures moléculaires à partir de SMILES, des diagrammes de Lewis et des dessins ChemFig, puis agrandissez et téléchargez le résultat. L’interface est traduite et vos instructions personnalisées sont conservées.",
    "de": "Chemistry Studio kommt in den Chat. Erstellen Sie Molekülstrukturen aus SMILES, Lewis-Diagramme und ChemFig-Zeichnungen und vergrößern oder laden Sie die Ergebnisse herunter. Die Oberfläche ist übersetzt und Ihre angepassten Skill-Anweisungen bleiben erhalten.",
    "pt": "O Chemistry Studio chega ao chat. Crie estruturas moleculares a partir de SMILES, diagramas de Lewis e desenhos ChemFig, com controlos para ampliar e descarregar o resultado. A interface está traduzida e as instruções personalizadas das suas competências são preservadas.",
    "pt-BR": "O Chemistry Studio chega ao chat. Crie estruturas moleculares a partir de SMILES, diagramas de Lewis e desenhos ChemFig, com controles para ampliar e baixar o resultado. A interface está traduzida e as instruções personalizadas das suas habilidades são preservadas.",
  },
  {
    category: 'enhancement',
    scope: "ai",
    "es": "Dibujos químicos con comprobaciones explícitas. Nodus valida la identidad molecular y admite proyecciones Fischer, Haworth y Newman y reglas acotadas de SN2, E2, aldol, Diels–Alder y resonancia de amidas. Puedes descargar las evidencias y el ChemFig comprobado. Si no puede verificar una propuesta, lo indica en lugar de inventar un dibujo.",
    "en": "Chemical drawings gain explicit checks. Nodus validates molecular identity and supports Fischer, Haworth and Newman projections and bounded rules for SN2, E2, aldol, Diels–Alder and amide resonance. Download the evidence and checked ChemFig. When a proposal cannot be verified, Nodus says so instead of inventing a drawing.",
    "fr": "Les dessins chimiques bénéficient de contrôles explicites. Nodus valide l’identité moléculaire et prend en charge les projections de Fischer, Haworth et Newman ainsi que des règles limitées pour SN2, E2, aldol, Diels–Alder et la résonance des amides. Téléchargez les preuves et le ChemFig vérifié. Une proposition non vérifiable est signalée au lieu d’être dessinée arbitrairement.",
    "de": "Chemische Zeichnungen erhalten ausdrückliche Prüfungen. Nodus validiert die Molekülidentität und unterstützt Fischer-, Haworth- und Newman-Projektionen sowie begrenzte Regeln für SN2, E2, Aldol, Diels–Alder und Amidresonanz. Laden Sie Prüfnachweise und geprüftes ChemFig herunter. Lässt sich ein Vorschlag nicht verifizieren, meldet Nodus dies, statt eine Zeichnung zu erfinden.",
    "pt": "Os desenhos químicos passam a ter verificações explícitas. O Nodus valida a identidade molecular e admite projeções Fischer, Haworth e Newman e regras limitadas de SN2, E2, aldol, Diels–Alder e ressonância de amidas. Descarregue as evidências e o ChemFig verificado. Quando não consegue verificar uma proposta, indica-o em vez de inventar um desenho.",
    "pt-BR": "Os desenhos químicos passam a ter verificações explícitas. O Nodus valida a identidade molecular e aceita projeções Fischer, Haworth e Newman e regras limitadas de SN2, E2, aldol, Diels–Alder e ressonância de amidas. Baixe as evidências e o ChemFig verificado. Quando não consegue verificar uma proposta, informa isso em vez de inventar um desenho.",
  },
  {
    category: 'enhancement',
    scope: "ai",
    "es": "Esquemas de reacción completos y equilibrados. Se conservan las especies declaradas, los contraiones y los coeficientes, y los agentes se muestran aparte. Se comprueban elementos, isótopos, hidrógenos y carga, y se compila la exportación ChemFig completa. Un esquema equilibrado no implica un mecanismo verificado ni predice que la reacción sea viable. También mejora la estabilidad al renderizar varios dibujos.",
    "en": "Complete, balanced reaction schemes preserve declared species, counterions and coefficients, with agents shown separately. Nodus checks elements, isotopes, hydrogens and charge and compiles the complete ChemFig export. A balanced scheme does not mean a verified mechanism or predict reaction feasibility. Rendering several drawings is also more stable.",
    "fr": "Les schémas réactionnels complets et équilibrés conservent les espèces déclarées, contre-ions et coefficients, avec les agents affichés séparément. Nodus contrôle éléments, isotopes, hydrogènes et charge et compile l’export ChemFig complet. Un schéma équilibré ne prouve ni le mécanisme ni la faisabilité de la réaction. Le rendu de plusieurs dessins est aussi plus stable.",
    "de": "Vollständige, ausgeglichene Reaktionsschemata bewahren angegebene Spezies, Gegenionen und Koeffizienten. Hilfsstoffe erscheinen separat. Nodus prüft Elemente, Isotope, Wasserstoff und Ladung und kompiliert den vollständigen ChemFig-Export. Ein ausgeglichenes Schema bestätigt weder den Mechanismus noch die Durchführbarkeit der Reaktion. Mehrere Zeichnungen werden zudem stabiler gerendert.",
    "pt": "Os esquemas de reação completos e equilibrados preservam as espécies declaradas, contra-iões e coeficientes, com os agentes apresentados separadamente. O Nodus verifica elementos, isótopos, hidrogénios e carga e compila a exportação ChemFig completa. Um esquema equilibrado não significa um mecanismo verificado nem prevê a viabilidade da reação. A apresentação de vários desenhos também é mais estável.",
    "pt-BR": "Os esquemas de reação completos e balanceados preservam as espécies declaradas, contraíons e coeficientes, com os agentes apresentados separadamente. O Nodus verifica elementos, isótopos, hidrogênios e carga e compila a exportação ChemFig completa. Um esquema balanceado não significa um mecanismo verificado nem prevê a viabilidade da reação. A renderização de vários desenhos também está mais estável.",
  },
  {
    category: 'fix',
    scope: "ai",
    "es": "Menos errores al pedir respuestas a la IA. Las solicitudes se adaptan a los parámetros admitidos por cada modelo, incluidos Claude 4.7 y posteriores, GPT-5, GPT-6 y la serie o. La corrección se aplica tanto a respuestas completas como a las que aparecen mientras se generan, conservando la compatibilidad con modelos anteriores.",
    "en": "Fewer errors when requesting AI answers. Requests adapt to the parameters each model accepts, including Claude 4.7 and later, GPT-5, GPT-6 and o-series models. The fix covers both complete and streaming responses while preserving compatibility with older models.",
    "fr": "Moins d’erreurs lors des demandes à l’IA. Les requêtes utilisent les paramètres acceptés par chaque modèle, notamment Claude 4.7 et suivants, GPT-5, GPT-6 et la série o. La correction couvre les réponses complètes et celles affichées progressivement, tout en préservant la compatibilité avec les anciens modèles.",
    "de": "Weniger Fehler bei KI-Anfragen. Anfragen passen sich an die unterstützten Parameter des jeweiligen Modells an, darunter Claude ab 4.7, GPT-5, GPT-6 und die o-Serie. Die Korrektur gilt für vollständige und schrittweise angezeigte Antworten und erhält die Kompatibilität mit älteren Modellen.",
    "pt": "Menos erros ao pedir respostas à IA. Os pedidos adaptam-se aos parâmetros aceites por cada modelo, incluindo Claude 4.7 e posteriores, GPT-5, GPT-6 e a série o. A correção abrange respostas completas e progressivas, preservando a compatibilidade com modelos anteriores.",
    "pt-BR": "Menos erros ao pedir respostas à IA. As solicitações se adaptam aos parâmetros aceitos por cada modelo, incluindo Claude 4.7 e posteriores, GPT-5, GPT-6 e a série o. A correção abrange respostas completas e progressivas, preservando a compatibilidade com modelos anteriores.",
  },
  {
    category: 'new',
    scope: "academic",
    "es": "El grafo se abre en un mapa de temas permanente. Entra en un tema y ajusta la profundidad y las relaciones visibles por idea, o abre exploraciones independientes en otras pestañas. Puedes añadir y quitar ideas del mapa y conservar cada exploración al cambiar de vista. Mejoran el zoom, las etiquetas, la selección y los controles, con los colores de tu bóveda en modo claro y oscuro.",
    "en": "The graph opens on a permanent themes hub. Enter a theme and adjust depth and visible relationships per idea, or open independent explorations in other tabs. Add and remove ideas in the hub and preserve each exploration when navigating. Zoom, captions, selection and controls are clearer, with your vault colors in light and dark mode.",
    "fr": "Le graphe s’ouvre sur une carte des thèmes permanente. Ouvrez un thème et réglez la profondeur et les relations visibles par idée, ou lancez des explorations indépendantes dans d’autres onglets. Ajoutez et retirez des idées de la carte et conservez chaque exploration pendant la navigation. Zoom, libellés, sélection et commandes sont plus clairs, aux couleurs du coffre en mode clair et sombre.",
    "de": "Der Graph öffnet sich mit einer dauerhaften Themenübersicht. Öffnen Sie ein Thema und passen Sie Tiefe und sichtbare Beziehungen pro Idee an oder starten Sie unabhängige Erkundungen in weiteren Tabs. Fügen Sie Ideen hinzu oder entfernen Sie sie und behalten Sie jede Erkundung beim Navigieren. Zoom, Beschriftungen, Auswahl und Bedienelemente sind klarer und nutzen Ihre Tresorfarben im hellen und dunklen Modus.",
    "pt": "O grafo abre num mapa de temas permanente. Entre num tema e ajuste a profundidade e as relações visíveis por ideia, ou abra explorações independentes noutros separadores. Adicione e remova ideias do mapa e preserve cada exploração ao navegar. O zoom, as legendas, a seleção e os controlos ficam mais claros, com as cores do cofre nos modos claro e escuro.",
    "pt-BR": "O grafo abre em um mapa de temas permanente. Entre em um tema e ajuste a profundidade e as relações visíveis por ideia, ou abra explorações independentes em outras abas. Adicione e remova ideias do mapa e preserve cada exploração ao navegar. O zoom, as legendas, a seleção e os controles ficam mais claros, com as cores do cofre nos modos claro e escuro.",
  },
  {
    category: 'new',
    scope: "academic",
    "es": "Ve tu grafo dentro del corpus. Activa un fondo de contexto con intensidad ajustable en el mapa de temas y las exploraciones. Las conexiones externas destacan y puedes pulsar una idea del fondo para incorporarla al trabajo. El contexto no altera el recorrido ni sus recuentos. El total del corpus cuenta ideas únicas, también cuando varios temas las comparten, y la mejora llega a los grafos publicados en Nodus Server.",
    "en": "See your graph within the corpus. Enable a context background with adjustable intensity in the themes hub and explorations. External connections stand out, and clicking a background idea adds it to your work. Context does not alter playback or working counts. Corpus totals count unique ideas even across overlapping themes, and published Nodus Server graphs gain the same improvements.",
    "fr": "Situez votre graphe dans le corpus. Activez un fond contextuel d’intensité réglable dans la carte des thèmes et les explorations. Les connexions externes ressortent et un clic sur une idée du fond l’ajoute au travail. Le contexte ne modifie ni le parcours ni ses compteurs. Le total compte les idées uniques même entre thèmes superposés. Les graphes publiés sur Nodus Server en bénéficient aussi.",
    "de": "Sehen Sie Ihren Graphen im Kontext des Korpus. Aktivieren Sie einen Hintergrund mit einstellbarer Intensität in der Themenübersicht und den Erkundungen. Externe Verbindungen werden hervorgehoben und ein Klick übernimmt eine Hintergrundidee in Ihre Arbeit. Der Kontext verändert weder Wiedergabe noch Arbeitszähler. Korpuswerte zählen eindeutige Ideen auch bei überlappenden Themen. Veröffentlichte Nodus-Server-Graphen erhalten dieselben Verbesserungen.",
    "pt": "Veja o grafo no contexto do corpus. Ative um fundo com intensidade ajustável no mapa de temas e nas explorações. As ligações externas destacam-se e pode clicar numa ideia do fundo para a incorporar no trabalho. O contexto não altera o percurso nem as contagens de trabalho. O total conta ideias únicas mesmo entre temas sobrepostos. Os grafos publicados no Nodus Server recebem as mesmas melhorias.",
    "pt-BR": "Veja o grafo no contexto do corpus. Ative um fundo com intensidade ajustável no mapa de temas e nas explorações. As conexões externas se destacam e você pode clicar em uma ideia do fundo para incorporá-la ao trabalho. O contexto não altera o percurso nem as contagens de trabalho. O total conta ideias únicas mesmo entre temas sobrepostos. Os grafos publicados no Nodus Server recebem as mesmas melhorias.",
  },
  {
    category: 'enhancement',
    scope: "library",
    "es": "Búsquedas más ágiles en bibliotecas grandes. La consulta de los perfiles de documentos encuentra cada obra mediante su identificador, evitando recorrer repetidamente todos los perfiles. Se mantienen los resultados y mejora el rendimiento a medida que crece la biblioteca.",
    "en": "Faster searches in large libraries. Document profile queries find each work by its identifier, avoiding repeated scans of all profiles. Results stay the same while performance improves as the library grows.",
    "fr": "Des recherches plus rapides dans les grandes bibliothèques. Les requêtes sur les profils de documents retrouvent chaque œuvre par son identifiant et évitent de parcourir tous les profils à répétition. Les résultats restent identiques et les performances progressent lorsque la bibliothèque grandit.",
    "de": "Schnellere Suche in großen Bibliotheken. Abfragen von Dokumentprofilen finden jedes Werk über seine Kennung und vermeiden wiederholtes Durchsuchen aller Profile. Die Ergebnisse bleiben gleich, während die Leistung bei wachsender Bibliothek steigt.",
    "pt": "Pesquisas mais rápidas em bibliotecas grandes. A consulta dos perfis de documentos encontra cada obra pelo seu identificador, evitando percorrer todos os perfis repetidamente. Os resultados mantêm-se e o desempenho melhora à medida que a biblioteca cresce.",
    "pt-BR": "Buscas mais rápidas em bibliotecas grandes. A consulta dos perfis de documentos encontra cada obra pelo identificador, evitando percorrer todos os perfis repetidamente. Os resultados são mantidos e o desempenho melhora conforme a biblioteca cresce.",
  },
  {
    category: 'new',
    scope: "general",
    "es": "Un nuevo tutorial de PDF Presenter te ayuda a descubrir la herramienta. Está disponible en Funciones, en la web y en la wiki, con título y descripción en doce idiomas. Tras las novedades aparece un aviso con el vídeo, sin reproducción automática. Al cerrarlo queda marcado como visto y no vuelve a aparecer en los siguientes inicios.",
    "en": "A new PDF Presenter tutorial helps you discover the tool. Find it in Features, on the website and in the wiki, with title and description in twelve languages. An announcement shows the video after the release notes without autoplay. Dismissing it marks it as seen so it does not return on later launches.",
    "fr": "Un nouveau tutoriel PDF Presenter vous fait découvrir l’outil. Retrouvez-le dans Fonctionnalités, sur le site et dans le wiki, avec titre et description en douze langues. Une annonce affiche la vidéo après les nouveautés, sans lecture automatique. Une fois fermée, elle est marquée comme vue et ne revient plus aux prochains démarrages.",
    "de": "Ein neues PDF-Presenter-Tutorial stellt Ihnen das Werkzeug vor. Sie finden es unter Funktionen, auf der Website und im Wiki, mit Titel und Beschreibung in zwölf Sprachen. Nach den Versionshinweisen erscheint ein Hinweis mit dem Video ohne automatische Wiedergabe. Nach dem Schließen gilt er als gesehen und erscheint bei späteren Starts nicht erneut.",
    "pt": "Um novo tutorial do PDF Presenter ajuda a descobrir a ferramenta. Está disponível em Funcionalidades, no site e na wiki, com título e descrição em doze idiomas. Após as novidades aparece um aviso com o vídeo, sem reprodução automática. Ao fechá-lo fica marcado como visto e não volta a aparecer nos arranques seguintes.",
    "pt-BR": "Um novo tutorial do PDF Presenter ajuda a descobrir a ferramenta. Está disponível em Funcionalidades, no site e na wiki, com título e descrição em doze idiomas. Após as novidades aparece um aviso com o vídeo, sem reprodução automática. Ao fechá-lo, ele fica marcado como visto e não volta a aparecer nas próximas inicializações.",
  },
];

const RAW_RELEASE_NOTES: RawReleaseNote[] = [
  {
    version: '5.8.1',
    date: '2026-10-09',
    highlights: RELEASE_5_8_1_HIGHLIGHTS,
  },
  {
    version: '5.8.0',
    date: '2026-10-03',
    highlights: RELEASE_5_8_0_HIGHLIGHTS,
  },
  {
    version: '5.7.4',
    date: '2026-10-02',
    highlights: RELEASE_5_7_4_HIGHLIGHTS,
  },
  {
    version: '5.7.3',
    date: '2026-09-30',
    highlights: RELEASE_5_7_3_HIGHLIGHTS,
  },
  // 5.7.2 turns Research Chat into an agent that plans the turn and looks up the
  // catalogue, stops a question from freezing the window, speeds up document
  // preparation, keeps library records and citations on the right passage, scopes
  // re-embedding to the ideas that changed and rebuilds the Linux packages on
  // Ubuntu 22.04 so they start on older glibc.
  {
    version: '5.7.2',
    date: '2026-09-29',
    highlights: RELEASE_5_7_2_HIGHLIGHTS,
  },
  // 5.7.1 fixes the indexing welcome, whose «Yes, start» button stayed disabled while
  // every unindexed PDF was inspected. Its What's New modal is the 5.7.0 one, unchanged.
  {
    version: '5.7.1',
    date: '2026-09-28',
    highlights: RELEASE_5_7_0_HIGHLIGHTS,
  },
  {
    version: '5.7.0',
    date: '2026-09-28',
    highlights: RELEASE_5_7_0_HIGHLIGHTS,
  },
  {
    version: '5.6.0',
    date: '2026-09-20',
    highlights: RELEASE_5_6_0_HIGHLIGHTS,
  },
  {
    version: '5.5.0',
    date: '2026-09-18',
    highlights: RELEASE_5_5_0_HIGHLIGHTS,
  },
  {
    version: '5.4.5',
    date: '2026-09-15',
    highlights: RELEASE_5_4_5_HIGHLIGHTS,
  },
  {
    version: '5.4.4',
    date: '2026-09-14',
    highlights: RELEASE_5_4_4_HIGHLIGHTS,
  },
  {
    version: '5.4.3',
    date: '2026-09-14',
    highlights: RELEASE_5_4_3_HIGHLIGHTS,
  },
  {
    version: '5.4.2',
    date: '2026-09-13',
    highlights: RELEASE_5_4_2_HIGHLIGHTS,
  },
  {
    version: '5.4.1',
    date: '2026-09-13',
    // This fix release intentionally reuses the 5.4.0 What's New modal: it repairs the
    // capability packages 5.4.0 introduced, and anyone updating straight to it should still
    // read what that release brought.
    highlights: RELEASE_5_4_0_HIGHLIGHTS,
  },
  {
    version: '5.4.0',
    date: '2026-09-12',
    highlights: RELEASE_5_4_0_HIGHLIGHTS,
  },
  {
    version: '5.3.1',
    date: '2026-09-10',
    highlights: RELEASE_5_3_1_HIGHLIGHTS,
  },
  {
    version: '5.3.0',
    date: '2026-09-09',
    highlights: RELEASE_5_3_0_HIGHLIGHTS,
  },
  {
    version: '5.2.2',
    date: '2026-09-09',
    highlights: RELEASE_5_2_2_HIGHLIGHTS,
  },
  {
    version: '5.2.1',
    date: '2026-09-06',
    // This focused hotfix intentionally reuses the 5.2.0 What's New modal.
    highlights: RELEASE_5_2_0_HIGHLIGHTS,
  },
  {
    version: '5.2.0',
    date: '2026-09-06',
    highlights: RELEASE_5_2_0_HIGHLIGHTS,
  },
  {
    version: '5.1.7',
    date: '2026-09-04',
    highlights: RELEASE_5_1_7_HIGHLIGHTS,
  },
  {
    version: '5.1.6',
    date: '2026-09-03',
    highlights: RELEASE_5_1_6_HIGHLIGHTS,
  },
  {
    version: '5.1.5',
    date: '2026-09-03',
    highlights: RELEASE_5_1_4_HIGHLIGHTS,
  },
  {
    version: '5.1.4',
    date: '2026-09-02',
    highlights: RELEASE_5_1_4_HIGHLIGHTS,
  },
  {
    version: '5.1.3',
    date: '2026-08-31',
    highlights: RELEASE_5_1_3_HIGHLIGHTS,
  },
  {
    version: '5.1.2',
    date: '2026-08-31',
    highlights: RELEASE_5_1_2_HIGHLIGHTS,
  },
  {
    version: '5.1.1',
    date: '2026-08-31',
    highlights: RELEASE_5_1_1_HIGHLIGHTS,
  },
  {
    version: '5.1.0',
    date: '2026-08-30',
    highlights: RELEASE_5_1_0_HIGHLIGHTS,
  },
  {
    version: '5.0.6',
    date: '2026-08-28',
    highlights: RELEASE_5_0_6_HIGHLIGHTS,
  },
  {
    version: '5.0.5',
    date: '2026-08-27',
    highlights: RELEASE_5_0_5_HIGHLIGHTS,
  },
  {
    version: '5.0.4',
    date: '2026-08-27',
    highlights: RELEASE_5_0_4_HIGHLIGHTS,
  },
  {
    version: '5.0.3',
    date: '2026-08-26',
    highlights: RELEASE_5_0_3_HIGHLIGHTS,
  },
  {
    version: '5.0.2',
    date: '2026-08-26',
    highlights: RELEASE_5_0_2_HIGHLIGHTS,
  },
  {
    version: '5.0.1',
    date: '2026-08-25',
    highlights: RELEASE_5_0_1_HIGHLIGHTS,
  },
  {
    version: '5.0.0',
    date: '2026-08-25',
    highlights: RELEASE_5_0_0_HIGHLIGHTS,
  },
  {
    version: '4.2.5',
    date: '2026-08-23',
    highlights: RELEASE_4_2_5_HIGHLIGHTS,
  },
  {
    version: '4.2.4',
    date: '2026-08-23',
    highlights: RELEASE_4_2_4_HIGHLIGHTS,
  },
  {
    version: '4.2.3',
    date: '2026-08-22',
    highlights: RELEASE_4_2_3_HIGHLIGHTS,
  },
  {
    version: '4.2.2',
    date: '2026-08-21',
    highlights: RELEASE_4_2_2_HIGHLIGHTS,
  },
  {
    version: '4.2.0',
    date: '2026-08-20',
    highlights: RELEASE_4_2_0_HIGHLIGHTS,
  },
  {
    version: '4.1.6',
    date: '2026-08-18',
    highlights: RELEASE_4_1_6_HIGHLIGHTS,
  },
  {
    version: '4.1.5',
    date: '2026-08-17',
    highlights: RELEASE_4_1_5_HIGHLIGHTS,
  },
  {
    version: '4.1.4',
    date: '2026-08-16',
    highlights: RELEASE_4_1_4_HIGHLIGHTS,
  },
  {
    version: '4.1.3',
    date: '2026-08-15',
    highlights: RELEASE_4_1_3_HIGHLIGHTS,
  },
  {
    version: '4.1.2',
    date: '2026-08-15',
    highlights: RELEASE_4_1_2_HIGHLIGHTS,
  },
  {
    version: '4.1.1',
    date: '2026-08-14',
    highlights: RELEASE_4_1_1_HIGHLIGHTS,
  },
  {
    version: '4.1.0',
    date: '2026-08-13',
    highlights: RELEASE_4_1_0_HIGHLIGHTS,
  },
  {
    version: '4.0.1',
    date: '2026-08-12',
    highlights: RELEASE_4_0_1_HIGHLIGHTS,
  },
  {
    version: '4.0.0',
    date: '2026-08-12',
    highlights: RELEASE_4_0_0_HIGHLIGHTS,
  },
  {
    version: '3.2.7',
    date: '2026-08-10',
    highlights: RELEASE_3_2_7_HIGHLIGHTS,
  },
  {
    version: '3.2.6',
    date: '2026-08-09',
    highlights: RELEASE_3_2_6_HIGHLIGHTS,
  },
  {
    version: '3.2.5',
    date: '2026-08-07',
    highlights: RELEASE_3_2_5_HIGHLIGHTS,
  },
  {
    version: '3.2.4',
    date: '2026-08-06',
    highlights: RELEASE_3_2_4_HIGHLIGHTS,
  },
  {
    version: '3.2.3',
    date: '2026-08-05',
    highlights: RELEASE_3_2_3_HIGHLIGHTS,
  },
  {
    version: '3.2.2',
    date: '2026-08-04',
    highlights: RELEASE_3_2_2_HIGHLIGHTS,
  },
  {
    version: '3.2.1',
    date: '2026-08-04',
    highlights: RELEASE_3_2_1_HIGHLIGHTS,
  },
  {
    version: '3.2.0',
    date: '2026-08-04',
    highlights: RELEASE_3_2_0_HIGHLIGHTS,
  },
  {
    version: '3.1.0',
    date: '2026-08-03',
    highlights: RELEASE_3_1_0_HIGHLIGHTS,
  },
  {
    version: '3.0.4',
    date: '2026-08-01',
    highlights: RELEASE_3_0_4_HIGHLIGHTS,
  },
  {
    version: '3.0.3',
    date: '2026-07-31',
    highlights: RELEASE_3_0_3_HIGHLIGHTS,
  },
  {
    version: '3.0.2',
    date: '2026-07-31',
    highlights: RELEASE_3_0_2_HIGHLIGHTS,
  },
  {
    version: '3.0.1',
    date: '2026-07-30',
    highlights: RELEASE_3_0_1_HIGHLIGHTS,
  },
  {
    version: '3.0.0',
    date: '2026-07-30',
    highlights: RELEASE_3_0_0_HIGHLIGHTS,
  },
  {
    version: '2.7.0',
    date: '2026-07-26',
    highlights: RELEASE_2_7_0_HIGHLIGHTS,
  },
  {
    version: '2.6.3',
    date: '2026-07-24',
    highlights: RELEASE_2_6_3_HIGHLIGHTS,
  },
  {
    version: '2.6.2',
    date: '2026-07-23',
    highlights: RELEASE_2_6_2_HIGHLIGHTS,
  },
  {
    version: '2.6.1',
    date: '2026-07-23',
    highlights: RELEASE_2_6_HIGHLIGHTS,
  },
  {
    version: '2.6.0',
    date: '2026-07-23',
    highlights: RELEASE_2_6_HIGHLIGHTS,
  },
  {
    version: '2.5.4',
    date: '2026-07-22',
    highlights: [
      {
        scope: 'toolkit',
        es: 'PDF Presenter ya importa directamente presentaciones de PowerPoint, OpenDocument y Keynote además de PDF. Nodus las convierte localmente mediante PowerPoint, Keynote o LibreOffice instalados, conserva las notas del ponente cuando el formato lo permite y no modifica el archivo original.',
        en: 'PDF Presenter now imports PowerPoint, OpenDocument and Keynote presentations directly in addition to PDFs. Nodus converts them locally through an installed PowerPoint, Keynote or LibreOffice app, preserves speaker notes when the format supports them, and leaves the original file untouched.',
        fr: 'PDF Presenter importe désormais directement les présentations PowerPoint, OpenDocument et Keynote en plus des PDF. Nodus les convertit localement à l’aide de PowerPoint, Keynote ou LibreOffice installé, conserve les notes de l’orateur lorsque le format le permet et ne modifie pas le fichier original.',
        de: 'PDF Presenter importiert jetzt neben PDFs auch PowerPoint-, OpenDocument- und Keynote-Präsentationen direkt. Nodus konvertiert sie lokal mit einer installierten PowerPoint-, Keynote- oder LibreOffice-Anwendung, übernimmt Sprechernotizen, sofern das Format sie unterstützt, und verändert die Originaldatei nicht.',
        pt: 'O PDF Presenter passa a importar diretamente apresentações PowerPoint, OpenDocument e Keynote, além de PDF. O Nodus converte-as localmente através do PowerPoint, Keynote ou LibreOffice instalado, preserva as notas do orador quando o formato o permite e não altera o ficheiro original.',
        'pt-BR': 'O PDF Presenter agora importa diretamente apresentações do PowerPoint, OpenDocument e Keynote, além de PDF. O Nodus faz a conversão localmente pelo PowerPoint, Keynote ou LibreOffice instalado, preserva as notas do apresentador quando o formato permite e não altera o arquivo original.',
      },
      {
        scope: 'nodi',
        es: 'Si cierras la ventana principal en macOS sin salir de Nodus y después vuelves a abrir la app, ahora se restauran correctamente tanto la ventana como el compañero Nodi siempre visible, si lo tenías activado.',
        en: 'If you close the main window on macOS without quitting Nodus and then reopen the app, both the window and the always-on-top Nodi companion are now restored correctly when enabled.',
        fr: 'Si vous fermez la fenêtre principale sur macOS sans quitter Nodus, puis rouvrez l’application, la fenêtre et le compagnon Nodi toujours visible sont désormais correctement restaurés lorsqu’il est activé.',
        de: 'Wenn du unter macOS das Hauptfenster schließt, ohne Nodus zu beenden, und die App danach erneut öffnest, werden jetzt sowohl das Fenster als auch der stets sichtbare Nodi-Begleiter korrekt wiederhergestellt, sofern er aktiviert war.',
        pt: 'Se fechar a janela principal no macOS sem sair do Nodus e depois voltar a abrir a aplicação, tanto a janela como o companheiro Nodi sempre visível passam a ser restaurados corretamente quando estão ativados.',
        'pt-BR': 'Se você fechar a janela principal no macOS sem sair do Nodus e depois abrir o app novamente, tanto a janela quanto o companheiro Nodi sempre visível passam a ser restaurados corretamente quando estão ativados.',
      },
    ],
  },
  {
    version: '2.5.3',
    date: '2026-07-22',
    highlights: [
      {
        scope: 'toolkit',
        es: 'PDF Presenter es mucho más sólido: las herramientas de anotación responden de forma estable, admiten atajos y ajuste de tamaño en directo, y el modo presentador funciona mejor con una o varias pantallas y desde el mando móvil. También puedes importar y exportar las notas del ponente en TXT, y los vídeos de YouTube se redimensionan libremente.',
        en: 'PDF Presenter is much more robust: annotation tools respond reliably, support shortcuts and live resizing, while presenter mode works better with one or multiple displays and from the phone remote. You can also import and export speaker notes as TXT, and freely resize YouTube videos.',
        fr: 'PDF Presenter est beaucoup plus robuste : les outils d’annotation répondent de façon fiable, proposent des raccourcis et un redimensionnement en direct, tandis que le mode présentateur fonctionne mieux avec un ou plusieurs écrans et depuis la télécommande mobile. Vous pouvez aussi importer et exporter les notes de l’orateur en TXT et redimensionner librement les vidéos YouTube.',
        de: 'PDF Presenter ist deutlich robuster: Die Anmerkungswerkzeuge reagieren zuverlässig, unterstützen Tastenkürzel und eine Größenänderung in Echtzeit; der Präsentationsmodus funktioniert besser mit einem oder mehreren Bildschirmen und über die Smartphone-Fernbedienung. Sprechernotizen lassen sich außerdem als TXT importieren und exportieren, YouTube-Videos frei skalieren.',
        pt: 'O PDF Presenter está muito mais robusto: as ferramentas de anotação respondem de forma fiável, incluem atalhos e ajuste de tamanho em direto, enquanto o modo de apresentação funciona melhor com um ou vários ecrãs e através do comando móvel. Também pode importar e exportar notas do orador em TXT e redimensionar livremente vídeos do YouTube.',
        'pt-BR': 'O PDF Presenter está muito mais robusto: as ferramentas de anotação respondem de forma confiável, incluem atalhos e ajuste de tamanho ao vivo, enquanto o modo de apresentação funciona melhor com uma ou várias telas e pelo controle remoto do celular. Também é possível importar e exportar notas do apresentador em TXT e redimensionar livremente vídeos do YouTube.',
      },
      {
        scope: 'toolkit',
        es: 'OCR Workspace separa ahora «Nuevo OCR» y «Biblioteca», permite buscar por título o por el contenido transcrito y procesar varias páginas en paralelo según el proveedor. Reprocesar una página o un documento deja elegir otro modelo y muestra mejor el progreso; los modelos locales siguen trabajando de una en una para mantener la estabilidad.',
        en: 'OCR Workspace now separates “New OCR” from the “Library”, searches by title or transcribed content, and can process multiple pages in parallel according to the provider. Reprocessing a page or document lets you choose another model and shows clearer progress; local models still work one page at a time for stability.',
        fr: 'OCR Workspace sépare désormais « Nouvel OCR » et « Bibliothèque », recherche par titre ou contenu transcrit et peut traiter plusieurs pages en parallèle selon le fournisseur. Le retraitement d’une page ou d’un document permet de choisir un autre modèle et affiche mieux la progression ; les modèles locaux continuent de travailler page par page pour rester stables.',
        de: 'OCR Workspace trennt jetzt „Neue OCR“ und „Bibliothek“, durchsucht Titel und transkribierte Inhalte und kann je nach Anbieter mehrere Seiten parallel verarbeiten. Beim erneuten Verarbeiten einer Seite oder eines Dokuments lässt sich ein anderes Modell wählen und der Fortschritt wird klarer angezeigt; lokale Modelle arbeiten für mehr Stabilität weiterhin Seite für Seite.',
        pt: 'O OCR Workspace separa agora «Novo OCR» e «Biblioteca», permite pesquisar por título ou conteúdo transcrito e processar várias páginas em paralelo consoante o fornecedor. Ao reprocessar uma página ou um documento pode escolher outro modelo e acompanhar melhor o progresso; os modelos locais continuam a trabalhar uma página de cada vez para maior estabilidade.',
        'pt-BR': 'O OCR Workspace agora separa “Novo OCR” e “Biblioteca”, permite buscar por título ou conteúdo transcrito e processar várias páginas em paralelo conforme o provedor. Ao reprocessar uma página ou um documento, você pode escolher outro modelo e acompanhar melhor o progresso; os modelos locais continuam trabalhando uma página por vez para maior estabilidade.',
      },
      {
        scope: 'toolkit',
        es: 'Nodus Protect unifica el tamaño de sus controles y mejora la edición visual: la barra negra se ajusta con un deslizador, y tanto su grosor como el tamaño e intensidad del desenfoque se actualizan al instante en la vista previa.',
        en: 'Nodus Protect now uses consistent control sizes and improves visual editing: the black bar is adjusted with a slider, and its thickness plus blur size and intensity update instantly in the preview.',
        fr: 'Nodus Protect uniformise la taille de ses commandes et améliore l’édition visuelle : la barre noire se règle avec un curseur, et son épaisseur ainsi que la taille et l’intensité du flou se mettent à jour instantanément dans l’aperçu.',
        de: 'Nodus Protect verwendet nun einheitlich große Bedienelemente und verbessert die visuelle Bearbeitung: Der schwarze Balken wird per Schieberegler angepasst; seine Stärke sowie Größe und Intensität der Unschärfe werden sofort in der Vorschau aktualisiert.',
        pt: 'O Nodus Protect uniformiza o tamanho dos controlos e melhora a edição visual: a barra preta é ajustada com um seletor, e tanto a sua espessura como o tamanho e a intensidade do desfoque são atualizados de imediato na pré-visualização.',
        'pt-BR': 'O Nodus Protect padroniza o tamanho dos controles e melhora a edição visual: a barra preta é ajustada por um controle deslizante, e tanto sua espessura quanto o tamanho e a intensidade do desfoque são atualizados imediatamente na prévia.',
      },
      {
        scope: 'general',
        es: 'Ajustes gana una sección propia de «Actualizaciones y novedades». Privacidad, RGPD y Licencias se abren ahora dentro de Nodus con contenido localizado y enlace al documento canónico, en lugar de mostrar Markdown externo en otro idioma.',
        en: 'Settings now has a dedicated “Updates and what’s new” section. Privacy, GDPR and Licences now open inside Nodus with localised content and a link to the canonical document, instead of showing external Markdown in another language.',
        fr: 'Les Paramètres disposent désormais d’une section « Mises à jour et nouveautés ». Confidentialité, RGPD et Licences s’ouvrent maintenant dans Nodus avec un contenu localisé et un lien vers le document canonique, au lieu d’afficher du Markdown externe dans une autre langue.',
        de: 'Die Einstellungen haben jetzt einen eigenen Bereich „Updates und Neuigkeiten“. Datenschutz, DSGVO und Lizenzen öffnen sich nun mit lokalisierten Inhalten und einem Link zum maßgeblichen Dokument direkt in Nodus, statt externes Markdown in einer anderen Sprache anzuzeigen.',
        pt: 'As Definições têm agora uma secção própria de «Atualizações e novidades». Privacidade, RGPD e Licenças passam a abrir dentro do Nodus com conteúdo localizado e uma ligação ao documento canónico, em vez de mostrar Markdown externo noutro idioma.',
        'pt-BR': 'As Configurações agora têm uma seção própria de “Atualizações e novidades”. Privacidade, LGPD/RGPD e Licenças passam a abrir dentro do Nodus com conteúdo localizado e um link para o documento oficial, em vez de mostrar Markdown externo em outro idioma.',
      },
      {
        scope: 'general',
        es: 'La configuración de IA distingue mejor la selección de modelos de los servicios locales y de voz, alinea los selectores avanzados y mejora el contraste del aviso de privacidad docente. Tus modelos favoritos pasan a ser una preferencia global y permanecen disponibles al cambiar de bóveda.',
        en: 'AI settings now distinguish model selection more clearly from local and voice services, align the advanced selectors, and improve the Teaching privacy notice contrast. Your favourite models are now a global preference and remain available when switching vaults.',
        fr: 'Les réglages d’IA distinguent plus clairement la sélection des modèles des services locaux et vocaux, alignent les sélecteurs avancés et améliorent le contraste de l’avis de confidentialité de l’Enseignement. Vos modèles favoris deviennent une préférence globale et restent disponibles lors du changement d’espace.',
        de: 'Die KI-Einstellungen trennen die Modellauswahl jetzt klarer von lokalen und Sprachdiensten, richten die erweiterten Auswahlfelder einheitlich aus und verbessern den Kontrast des Datenschutzhinweises für die Lehre. Deine favorisierten Modelle sind nun eine globale Einstellung und bleiben beim Wechsel des Arbeitsbereichs verfügbar.',
        pt: 'As definições de IA distinguem melhor a seleção de modelos dos serviços locais e de voz, alinham os seletores avançados e melhoram o contraste do aviso de privacidade da Docência. Os seus modelos favoritos passam a ser uma preferência global e continuam disponíveis ao mudar de espaço.',
        'pt-BR': 'As configurações de IA agora distinguem melhor a seleção de modelos dos serviços locais e de voz, alinham os seletores avançados e melhoram o contraste do aviso de privacidade da Docência. Seus modelos favoritos passam a ser uma preferência global e continuam disponíveis ao trocar de espaço.',
      },
      {
        scope: 'estudio',
        es: 'Estudio incorpora un borrado seguro y coherente: puedes seleccionar varios apuntes o materiales, moverlos a la papelera y decidir si también se eliminan sus ideas, embeddings, evidencias y conexiones. Las ideas compartidas con otras fuentes se conservan, las tareas de IA ya no pueden resucitar contenido borrado y las ideas individuales también se pueden eliminar desde su ficha.',
        en: 'Study now has a safe, consistent deletion flow: select multiple notes or materials, move them to the bin, and decide whether their ideas, embeddings, evidence and connections should also be removed. Ideas shared with other sources are preserved, AI jobs can no longer resurrect deleted content, and individual ideas can also be deleted from their detail view.',
        fr: 'Étude dispose désormais d’un flux de suppression sûr et cohérent : sélectionnez plusieurs notes ou documents, placez-les dans la corbeille et décidez si leurs idées, embeddings, preuves et connexions doivent aussi être supprimés. Les idées partagées avec d’autres sources sont conservées, les tâches d’IA ne peuvent plus ressusciter du contenu supprimé et les idées individuelles peuvent aussi être effacées depuis leur fiche.',
        de: 'Studium bietet nun einen sicheren, einheitlichen Löschablauf: Wähle mehrere Notizen oder Materialien aus, verschiebe sie in den Papierkorb und entscheide, ob auch ihre Ideen, Embeddings, Belege und Verbindungen entfernt werden sollen. Mit anderen Quellen geteilte Ideen bleiben erhalten, KI-Aufträge können gelöschte Inhalte nicht mehr wiederherstellen und einzelne Ideen lassen sich direkt in ihrer Detailansicht löschen.',
        pt: 'O Estudo passa a ter um fluxo de eliminação seguro e coerente: selecione vários apontamentos ou materiais, mova-os para o lixo e decida se as respetivas ideias, embeddings, evidências e ligações também devem ser eliminados. As ideias partilhadas com outras fontes são preservadas, as tarefas de IA já não podem recuperar conteúdo eliminado e as ideias individuais também podem ser apagadas a partir da respetiva ficha.',
        'pt-BR': 'O Estudo agora tem um fluxo de exclusão seguro e coerente: selecione várias anotações ou materiais, mova-os para a lixeira e decida se as respectivas ideias, embeddings, evidências e conexões também devem ser removidos. Ideias compartilhadas com outras fontes são preservadas, tarefas de IA não podem mais recriar conteúdo excluído e ideias individuais também podem ser apagadas em sua tela de detalhes.',
      },
      {
        scope: 'estudio',
        es: 'Las cabeceras de las tablas de materiales y apuntes compartidos quedan centradas y alineadas para que listas amplias sean más fáciles de leer.',
        en: 'Headers in the shared materials and notes tables are now centred and aligned, making wide lists easier to read.',
        fr: 'Les en-têtes des tableaux de documents et de notes partagés sont désormais centrés et alignés, ce qui facilite la lecture des longues listes.',
        de: 'Die Überschriften in den Tabellen für geteilte Materialien und Notizen sind jetzt zentriert und ausgerichtet, sodass breite Listen leichter zu lesen sind.',
        pt: 'Os cabeçalhos das tabelas de materiais e apontamentos partilhados ficam agora centrados e alinhados, facilitando a leitura de listas largas.',
        'pt-BR': 'Os cabeçalhos das tabelas de materiais e anotações compartilhados agora ficam centralizados e alinhados, facilitando a leitura de listas largas.',
      },
      {
        scope: 'mcp',
        es: 'ChatGPT ya puede conectarse a Nodus mediante el túnel MCP seguro de OpenAI. Un asistente guiado instala y verifica el cliente oficial, protege las credenciales, explica permisos y errores con pasos concretos y se conecta sin abrir puertos ni publicar tu biblioteca; su interfaz también se lee correctamente en tema claro.',
        en: 'ChatGPT can now connect to Nodus through OpenAI’s secure MCP tunnel. A guided assistant installs and verifies the official client, protects credentials, explains permissions and errors with concrete steps, and connects without opening ports or publishing your library; its interface is also fully readable in light theme.',
        fr: 'ChatGPT peut désormais se connecter à Nodus via le tunnel MCP sécurisé d’OpenAI. Un assistant guidé installe et vérifie le client officiel, protège les identifiants, explique les autorisations et les erreurs avec des étapes concrètes et établit la connexion sans ouvrir de ports ni publier votre bibliothèque ; son interface reste également parfaitement lisible en thème clair.',
        de: 'ChatGPT kann sich jetzt über OpenAIs sicheren MCP-Tunnel mit Nodus verbinden. Ein Assistent installiert und prüft den offiziellen Client, schützt Zugangsdaten, erklärt Berechtigungen und Fehler mit konkreten Schritten und verbindet ohne offene Ports oder Veröffentlichung deiner Bibliothek; auch im hellen Design ist die Oberfläche vollständig lesbar.',
        pt: 'O ChatGPT já pode ligar-se ao Nodus através do túnel MCP seguro da OpenAI. Um assistente guiado instala e verifica o cliente oficial, protege as credenciais, explica permissões e erros com passos concretos e estabelece a ligação sem abrir portas nem publicar a sua biblioteca; a interface também fica totalmente legível no tema claro.',
        'pt-BR': 'O ChatGPT agora pode se conectar ao Nodus pelo túnel MCP seguro da OpenAI. Um assistente guiado instala e verifica o cliente oficial, protege as credenciais, explica permissões e erros com passos concretos e faz a conexão sem abrir portas nem publicar sua biblioteca; a interface também fica totalmente legível no tema claro.',
      },
      {
        scope: 'databases',
        es: 'Bases de datos añade columnas de comparación que calculan el valor mayoritario exacto entre varias propiedades, por fila o para toda la columna. Las columnas de texto e imagen con IA pueden usar su propio modelo, y los procesos largos conservan el progreso aunque cambies de vista, con mejores errores y reintentos.',
        en: 'Databases adds comparison columns that calculate the exact majority value across multiple properties, per row or for the entire column. AI text and image columns can use their own model, and long-running jobs retain progress when you change views, with clearer errors and retries.',
        fr: 'Bases de données ajoute des colonnes de comparaison qui calculent la valeur majoritaire exacte entre plusieurs propriétés, par ligne ou pour toute la colonne. Les colonnes de texte et d’image avec IA peuvent utiliser leur propre modèle, et les traitements longs conservent leur progression lorsque vous changez de vue, avec de meilleures erreurs et relances.',
        de: 'Datenbanken bietet neue Vergleichsspalten, die den exakten Mehrheitswert über mehrere Eigenschaften berechnen – pro Zeile oder für die gesamte Spalte. KI-Text- und Bildspalten können ihr eigenes Modell verwenden; lang laufende Aufgaben behalten beim Ansichtswechsel ihren Fortschritt und bieten klarere Fehler sowie Wiederholungen.',
        pt: 'As Bases de dados ganham colunas de comparação que calculam o valor maioritário exato entre várias propriedades, por linha ou para toda a coluna. As colunas de texto e imagem com IA podem usar o seu próprio modelo, e os processos demorados conservam o progresso ao mudar de vista, com erros e novas tentativas mais claros.',
        'pt-BR': 'Os Bancos de dados ganham colunas de comparação que calculam o valor majoritário exato entre várias propriedades, por linha ou para toda a coluna. As colunas de texto e imagem com IA podem usar seu próprio modelo, e os processos demorados preservam o progresso ao mudar de tela, com erros e novas tentativas mais claros.',
      },
      {
        scope: 'nodi',
        es: 'Los mensajes del chat de Nodi ya se pueden seleccionar como texto. Cada respuesta tiene un botón para copiarla y el encabezado permite copiar la conversación completa.',
        en: 'Nodi chat messages can now be selected as text. Each reply has its own copy button, and the header can copy the complete conversation.',
        fr: 'Les messages du chat de Nodi peuvent désormais être sélectionnés comme du texte. Chaque réponse possède son bouton de copie et l’en-tête permet de copier toute la conversation.',
        de: 'Nachrichten im Nodi-Chat lassen sich jetzt als Text auswählen. Jede Antwort hat eine eigene Kopierschaltfläche; über die Kopfzeile kann die gesamte Unterhaltung kopiert werden.',
        pt: 'As mensagens do chat do Nodi já podem ser selecionadas como texto. Cada resposta tem um botão para a copiar e o cabeçalho permite copiar a conversa completa.',
        'pt-BR': 'As mensagens do chat do Nodi agora podem ser selecionadas como texto. Cada resposta tem seu próprio botão de copiar, e o cabeçalho permite copiar a conversa completa.',
      },
      {
        scope: 'languages',
        es: 'La narración local con Kokoro estrena voces en español de España y Latinoamérica, con normalización y pronunciación adaptadas para que fechas, cifras y texto suenen naturales sin salir de tu equipo.',
        en: 'Local Kokoro narration now includes voices for Spain and Latin American Spanish, with adapted normalisation and pronunciation so dates, numbers and prose sound natural without leaving your device.',
        fr: 'La narration locale avec Kokoro propose désormais des voix en espagnol d’Espagne et d’Amérique latine, avec une normalisation et une prononciation adaptées pour que les dates, les nombres et le texte sonnent naturellement sans quitter votre appareil.',
        de: 'Die lokale Kokoro-Sprachausgabe bietet jetzt Stimmen für Spanisch aus Spanien und Lateinamerika, mit angepasster Normalisierung und Aussprache, damit Daten, Zahlen und Fließtext natürlich klingen, ohne das Gerät zu verlassen.',
        pt: 'A narração local com Kokoro passa a incluir vozes em espanhol de Espanha e da América Latina, com normalização e pronúncia adaptadas para que datas, números e texto soem naturais sem sair do seu equipamento.',
        'pt-BR': 'A narração local com Kokoro agora inclui vozes em espanhol da Espanha e da América Latina, com normalização e pronúncia adaptadas para que datas, números e textos soem naturais sem sair do seu dispositivo.',
      },
      {
        scope: 'docencia',
        es: 'La bóveda de Docencia muestra claramente su estado BETA y el estado vacío del cuaderno de notas vuelve a ofrecer la acción correcta para crear el primer cuaderno.',
        en: 'The Teaching vault now clearly shows its BETA status, and the empty gradebook once again offers the correct action to create the first gradebook.',
        fr: 'L’espace Enseignement affiche clairement son statut BÊTA et l’état vide du carnet de notes propose à nouveau l’action correcte pour créer le premier carnet.',
        de: 'Der Lehr-Arbeitsbereich zeigt seinen BETA-Status nun deutlich an; im leeren Notenbuch wird wieder die richtige Aktion zum Erstellen des ersten Notenbuchs angeboten.',
        pt: 'O espaço de Docência mostra claramente o seu estado BETA e o estado vazio da pauta volta a apresentar a ação correta para criar a primeira pauta.',
        'pt-BR': 'O espaço de Docência agora mostra claramente seu status BETA, e o estado vazio do diário de notas volta a oferecer a ação correta para criar o primeiro diário.',
      },
    ],
  },
  {
    version: '2.5.2',
    date: '2026-07-21',
    highlights: [
      {
        scope: 'general',
        es: 'Importar archivos es más directo: el selector del sistema se abre al instante, sin ventanas intermedias. El aviso antes de grabar con el micrófono —donde advertir a quienes pueden quedar grabados sí importa— ahora te deja aceptarlo una vez, aceptarlo y no volver a mostrarlo en este equipo, o rechazarlo.',
        en: 'Importing files is more direct: the system picker opens instantly, with no modal in between. The notice before recording with the microphone — where warning the people who might be recorded actually matters — now lets you accept it once, accept and stop showing it on this device, or decline.',
        fr: 'L’import de fichiers est plus direct : le sélecteur du système s’ouvre instantanément, sans fenêtre intermédiaire. L’avis avant d’enregistrer au micro — là où prévenir les personnes susceptibles d’être enregistrées compte vraiment — vous permet désormais de l’accepter une fois, de l’accepter et de ne plus l’afficher sur cet appareil, ou de le refuser.',
        de: 'Das Importieren von Dateien ist direkter: Die System-Dateiauswahl öffnet sich sofort, ohne Zwischenfenster. Der Hinweis vor der Aufnahme mit dem Mikrofon – dort, wo das Warnen der möglicherweise aufgenommenen Personen wirklich zählt – lässt dich nun einmalig zustimmen, zustimmen und ihn auf diesem Gerät nicht mehr anzeigen, oder ablehnen.',
        pt: 'Importar ficheiros é mais direto: o seletor do sistema abre-se de imediato, sem janelas intermédias. O aviso antes de gravar com o microfone — onde avisar quem pode ficar gravado realmente importa — passa a permitir aceitá-lo uma vez, aceitá-lo e não voltar a mostrá-lo neste equipamento, ou recusá-lo.',
        'pt-BR': 'Importar arquivos é mais direto: o seletor do sistema abre na hora, sem janelas intermediárias. O aviso antes de gravar com o microfone — onde avisar quem pode acabar gravado realmente importa — agora permite aceitá-lo uma vez, aceitá-lo e não mostrar novamente neste dispositivo, ou recusá-lo.',
      },
      {
        scope: 'general',
        es: 'Corregido un error por el que cambiar de bóveda podía fallar con «table … already exists». Las bases de datos creadas por una versión previa con distinta numeración de migraciones se reparan solas —conservando tus datos— en lugar de bloquear la apertura.',
        en: 'Fixed a bug where switching vaults could fail with “table … already exists”. Databases created by an earlier build with different migration numbering now heal themselves — keeping your data — instead of blocking the vault from opening.',
        fr: 'Correction d’un bug où changer d’espace pouvait échouer avec « table … already exists ». Les bases créées par une version antérieure avec une numérotation de migrations différente se réparent d’elles-mêmes — en conservant vos données — au lieu d’empêcher l’ouverture.',
        de: 'Ein Fehler wurde behoben, bei dem der Wechsel des Arbeitsbereichs mit „table … already exists“ scheitern konnte. Datenbanken, die von einer früheren Version mit abweichender Migrationsnummerierung erstellt wurden, reparieren sich nun selbst – unter Erhalt deiner Daten – statt das Öffnen zu blockieren.',
        pt: 'Corrigido um erro em que mudar de espaço podia falhar com «table … already exists». As bases de dados criadas por uma versão anterior com numeração de migrações diferente reparam-se sozinhas — preservando os seus dados — em vez de bloquear a abertura.',
        'pt-BR': 'Corrigido um erro em que trocar de espaço podia falhar com “table … already exists”. Os bancos de dados criados por uma versão anterior com numeração de migrações diferente se reparam sozinhos — preservando seus dados — em vez de bloquear a abertura.',
      },
    ],
  },
  {
    version: '2.5.0',
    date: '2026-07-21',
    highlights: [
      {
        scope: 'toolkit',
        es: 'Nuevo en Herramientas: OCR Workspace transcribe PDF escaneados e imágenes con cualquier modelo con visión —local o en la nube— y mantiene una biblioteca de OCR por documento. Reconstruye Markdown limpio, conserva el original intacto y exporta el resultado.',
        en: 'New in Tools: OCR Workspace transcribes scanned PDFs and images with any vision-capable model — local or cloud — and keeps a per-document OCR library. It rebuilds clean Markdown, leaves the original untouched and exports the result.',
        fr: 'Nouveau dans Outils : OCR Workspace transcrit les PDF numérisés et les images avec n’importe quel modèle doté de vision — local ou dans le cloud — et conserve une bibliothèque d’OCR par document. Il reconstitue un Markdown propre, laisse l’original intact et exporte le résultat.',
        de: 'Neu unter Werkzeuge: OCR Workspace transkribiert gescannte PDFs und Bilder mit jedem bildfähigen Modell – lokal oder in der Cloud – und führt eine OCR-Bibliothek pro Dokument. Es erzeugt sauberes Markdown, lässt das Original unangetastet und exportiert das Ergebnis.',
        pt: 'Novo em Ferramentas: o OCR Workspace transcreve PDF digitalizados e imagens com qualquer modelo com visão — local ou na nuvem — e mantém uma biblioteca de OCR por documento. Reconstrói Markdown limpo, mantém o original intacto e exporta o resultado.',
        'pt-BR': 'Novo em Ferramentas: o OCR Workspace transcreve PDFs digitalizados e imagens com qualquer modelo com visão — local ou na nuvem — e mantém uma biblioteca de OCR por documento. Ele reconstrói Markdown limpo, mantém o original intacto e exporta o resultado.',
      },
      {
        scope: 'toolkit',
        es: 'PDF Presenter llega a Herramientas: presenta cualquier PDF como diapositivas con vista de presentador, notas del ponente, herramientas de anotación en vivo, vídeos de YouTube por diapositiva y un mando a distancia desde el móvil. Su biblioteca guarda copias con carpetas y búsqueda; el original nunca se toca.',
        en: 'PDF Presenter joins Tools: present any PDF as slides with a presenter view, speaker notes, live annotation tools, per-slide YouTube videos and a phone remote. Its library keeps copies with folders and search; the original is never touched.',
        fr: 'PDF Presenter rejoint Outils : présentez n’importe quel PDF sous forme de diapositives avec un mode présentateur, des notes de l’orateur, des outils d’annotation en direct, des vidéos YouTube par diapositive et une télécommande depuis le téléphone. Sa bibliothèque conserve des copies avec dossiers et recherche ; l’original n’est jamais modifié.',
        de: 'PDF Presenter kommt zu Werkzeuge hinzu: Präsentiere jedes PDF als Folien mit Referentenansicht, Sprechernotizen, Live-Anmerkungswerkzeugen, YouTube-Videos pro Folie und einer Fernbedienung per Smartphone. Seine Bibliothek bewahrt Kopien mit Ordnern und Suche auf; das Original wird nie verändert.',
        pt: 'O PDF Presenter chega às Ferramentas: apresente qualquer PDF como diapositivos com vista de apresentador, notas do orador, ferramentas de anotação ao vivo, vídeos do YouTube por diapositivo e um comando a partir do telemóvel. A sua biblioteca guarda cópias com pastas e pesquisa; o original nunca é tocado.',
        'pt-BR': 'O PDF Presenter chega às Ferramentas: apresente qualquer PDF como slides com modo apresentador, notas do orador, ferramentas de anotação ao vivo, vídeos do YouTube por slide e um controle remoto pelo celular. Sua biblioteca guarda cópias com pastas e busca; o original nunca é tocado.',
      },
      {
        scope: 'docencia',
        es: 'Nueva bóveda de Docencia para profesorado: organiza cursos, horario, calendario, materiales y grabaciones de clase —reutilizando lo mejor del modo Estudio con un acento propio— y añade exámenes y rúbricas con ayuda de IA. Incluye una demostración y un tutorial guiado para empezar.',
        en: 'A new Teaching vault for educators: organise courses, timetable, calendar, materials and class recordings — reusing the best of Study mode with its own accent — and add AI-assisted exams and rubrics. It ships with a demo and a guided tutorial to get started.',
        fr: 'Un nouvel espace Enseignement pour les enseignants : organisez cours, emploi du temps, calendrier, supports et enregistrements de classe — en réutilisant le meilleur du mode Étude avec sa propre couleur — et ajoutez des examens et des grilles avec l’aide de l’IA. Il est livré avec une démo et un tutoriel guidé pour démarrer.',
        de: 'Ein neuer Lehr-Arbeitsbereich für Lehrende: Organisiere Kurse, Stundenplan, Kalender, Materialien und Unterrichtsaufzeichnungen – mit dem Besten aus dem Studium-Modus und einer eigenen Akzentfarbe – und ergänze KI-gestützte Prüfungen und Bewertungsraster. Mit Demo und geführtem Tutorial zum Einstieg.',
        pt: 'Um novo espaço de Docência para professores: organize cursos, horário, calendário, materiais e gravações de aulas — reutilizando o melhor do modo Estudo com um acento próprio — e adicione exames e rubricas com ajuda de IA. Inclui uma demonstração e um tutorial guiado para começar.',
        'pt-BR': 'Um novo espaço de Docência para professores: organize cursos, horário, calendário, materiais e gravações de aulas — reutilizando o melhor do modo Estudo com um acento próprio — e adicione provas e rubricas com ajuda de IA. Inclui uma demonstração e um tutorial guiado para começar.',
      },
      {
        scope: 'docencia',
        es: 'El cuaderno de notas de Docencia calcula las calificaciones a partir de un plan de evaluación con reglas y rúbricas: gestiona grupos de alumnado, genera columnas desde exámenes y rúbricas, analiza la distribución de resultados y exporta acta, boletines individuales, CSV y XLSX. Los nombres del alumnado nunca se envían a la IA: se sustituyen por un código.',
        en: 'The Teaching gradebook computes marks from an assessment plan of rules and rubrics: manage student groups, build columns from exams and rubrics, analyse the distribution of results, and export a record sheet, individual reports, CSV and XLSX. Student names are never sent to the AI — they are replaced by a code.',
        fr: 'Le carnet de notes de l’Enseignement calcule les notes à partir d’un plan d’évaluation fait de règles et de grilles : gérez des groupes d’élèves, créez des colonnes à partir des examens et des grilles, analysez la distribution des résultats et exportez un relevé, des bulletins individuels, CSV et XLSX. Les noms des élèves ne sont jamais envoyés à l’IA : ils sont remplacés par un code.',
        de: 'Das Notenbuch der Lehre berechnet Noten aus einem Bewertungsplan aus Regeln und Rastern: Verwalte Lerngruppen, erstelle Spalten aus Prüfungen und Rastern, analysiere die Ergebnisverteilung und exportiere eine Notenliste, Einzelberichte, CSV und XLSX. Namen der Lernenden gelangen nie zur KI – sie werden durch einen Code ersetzt.',
        pt: 'A pauta de Docência calcula as classificações a partir de um plano de avaliação com regras e rubricas: faça a gestão de grupos de alunos, crie colunas a partir de exames e rubricas, analise a distribuição dos resultados e exporte pauta, boletins individuais, CSV e XLSX. Os nomes dos alunos nunca são enviados à IA — são substituídos por um código.',
        'pt-BR': 'O diário de classe de Docência calcula as notas a partir de um plano de avaliação com regras e rubricas: gerencie grupos de alunos, crie colunas a partir de provas e rubricas, analise a distribuição dos resultados e exporte ata, boletins individuais, CSV e XLSX. Os nomes dos alunos nunca são enviados à IA — são substituídos por um código.',
      },
      {
        scope: 'mcp',
        es: 'El servidor MCP crece: nuevas herramientas de solo lectura para el modo Docencia, escritura de filas y celdas en las bases de datos, y una limitación por tipo de bóveda para que cada cliente solo vea las herramientas pertinentes. El alumnado se identifica siempre por un código, nunca por su nombre.',
        en: 'The MCP server grows: new read-only tools for Teaching mode, row and cell writes into databases, and vault-type gating so each client only sees the relevant tools. Students are always identified by a code, never by name.',
        fr: 'Le serveur MCP s’étoffe : de nouveaux outils en lecture seule pour le mode Enseignement, l’écriture de lignes et de cellules dans les bases de données, et un filtrage par type d’espace pour que chaque client ne voie que les outils pertinents. Les élèves sont toujours identifiés par un code, jamais par leur nom.',
        de: 'Der MCP-Server wächst: neue schreibgeschützte Werkzeuge für den Lehrmodus, das Schreiben von Zeilen und Zellen in Datenbanken sowie eine Begrenzung nach Arbeitsbereichstyp, sodass jeder Client nur die relevanten Werkzeuge sieht. Lernende werden immer über einen Code identifiziert, nie über ihren Namen.',
        pt: 'O servidor MCP cresce: novas ferramentas só de leitura para o modo Docência, escrita de linhas e células nas bases de dados e uma limitação por tipo de espaço para que cada cliente veja apenas as ferramentas pertinentes. Os alunos são sempre identificados por um código, nunca pelo nome.',
        'pt-BR': 'O servidor MCP cresce: novas ferramentas somente leitura para o modo Docência, escrita de linhas e células nos bancos de dados e uma limitação por tipo de espaço para que cada cliente veja apenas as ferramentas pertinentes. Os alunos são sempre identificados por um código, nunca pelo nome.',
      },
      {
        scope: 'plugin',
        es: 'Nueva categoría de plugins: los copilotos de Nodus para Microsoft Word y LibreOffice Writer trabajan dentro de tu procesador de textos —el panel sigue tu cursor, analiza el párrafo, relaciona lo que escribes con tu biblioteca e inserta texto citado con IA—. El copiloto de Word suma ahora notas al pie, redacción sobre el texto seleccionado (reescribir, ampliar o rebatir) y búsqueda de pasajes citables. Se instalan desde Ajustes y la conexión se configura sola.',
        en: 'New plugins category: Nodus’s copilots for Microsoft Word and LibreOffice Writer work right inside your word processor — the pane follows your cursor, analyses the paragraph, relates what you write to your library and inserts AI-drafted cited text. The Word copilot now adds footnotes, compose-over-selection (rewrite, expand or counter) and citable passage search. Install them from Settings and the connection configures itself.',
        fr: 'Nouvelle catégorie de plugins : les copilotes de Nodus pour Microsoft Word et LibreOffice Writer fonctionnent directement dans votre traitement de texte — le panneau suit votre curseur, analyse le paragraphe, relie ce que vous écrivez à votre bibliothèque et insère du texte cité rédigé par IA. Le copilote Word ajoute désormais des notes de bas de page, la rédaction sur la sélection (réécrire, développer ou réfuter) et la recherche de passages citables. Installez-les depuis les Paramètres et la connexion se configure toute seule.',
        de: 'Neue Plugin-Kategorie: Die Nodus-Copiloten für Microsoft Word und LibreOffice Writer arbeiten direkt in deiner Textverarbeitung — das Panel folgt deinem Cursor, analysiert den Absatz, verknüpft das Geschriebene mit deiner Bibliothek und fügt von KI verfassten, zitierten Text ein. Der Word-Copilot bietet nun Fußnoten, das Verfassen über der Auswahl (umschreiben, erweitern oder widerlegen) und die Suche nach zitierbaren Passagen. Installiere sie über die Einstellungen, und die Verbindung konfiguriert sich von selbst.',
        pt: 'Nova categoria de plugins: os copilotos do Nodus para o Microsoft Word e o LibreOffice Writer funcionam dentro do seu processador de texto — o painel segue o seu cursor, analisa o parágrafo, relaciona o que escreve com a sua biblioteca e insere texto citado redigido por IA. O copiloto do Word passa a incluir notas de rodapé, redação sobre o texto selecionado (reescrever, ampliar ou rebater) e pesquisa de passagens citáveis. Instale-os a partir das Definições e a ligação configura-se sozinha.',
        'pt-BR': 'Nova categoria de plugins: os copilotos do Nodus para o Microsoft Word e o LibreOffice Writer funcionam dentro do seu processador de texto — o painel segue seu cursor, analisa o parágrafo, relaciona o que você escreve com sua biblioteca e insere texto citado redigido por IA. O copiloto do Word agora inclui notas de rodapé, redação sobre o texto selecionado (reescrever, ampliar ou rebater) e busca de trechos citáveis. Instale-os pelas Configurações e a conexão se configura sozinha.',
      },
      {
        scope: 'general',
        es: 'Mayor transparencia sobre tus datos: Nodus muestra avisos de privacidad allí donde se procesa información, incorpora una política de privacidad y avisos de terceros, y añade salvaguardas de cumplimiento de licencias. Todo el procesamiento sensible sigue siendo local.',
        en: 'More transparency about your data: Nodus shows privacy notices where information is processed, ships a privacy policy and third-party notices, and adds license-compliance safeguards. All sensitive processing stays local.',
        fr: 'Plus de transparence sur vos données : Nodus affiche des avis de confidentialité là où des informations sont traitées, intègre une politique de confidentialité et des avis de tiers, et ajoute des garde-fous de conformité des licences. Tout le traitement sensible reste local.',
        de: 'Mehr Transparenz über deine Daten: Nodus zeigt Datenschutzhinweise dort an, wo Informationen verarbeitet werden, liefert eine Datenschutzrichtlinie und Hinweise zu Drittanbietern und ergänzt Schutzmaßnahmen zur Lizenzkonformität. Die gesamte sensible Verarbeitung bleibt lokal.',
        pt: 'Mais transparência sobre os seus dados: o Nodus mostra avisos de privacidade onde a informação é processada, inclui uma política de privacidade e avisos de terceiros e acrescenta salvaguardas de conformidade de licenças. Todo o processamento sensível continua a ser local.',
        'pt-BR': 'Mais transparência sobre os seus dados: o Nodus mostra avisos de privacidade onde a informação é processada, inclui uma política de privacidade e avisos de terceiros e acrescenta salvaguardas de conformidade de licenças. Todo o processamento sensível continua sendo local.',
      },
      {
        scope: 'general',
        es: 'Ahora puedes usar tu suscripción de ChatGPT (Codex) o de GitHub Copilot como proveedor de IA, en lugar de una clave de API de pago por uso. Se configuran desde Ajustes → Proveedores; Nodus avisa cuando un modelo consume tu cuota de suscripción.',
        en: 'You can now use your ChatGPT (Codex) or GitHub Copilot subscription as an AI provider instead of a pay-as-you-go API key. Set them up in Settings → Providers; Nodus warns you when a model draws on your subscription quota.',
        fr: 'Vous pouvez désormais utiliser votre abonnement ChatGPT (Codex) ou GitHub Copilot comme fournisseur d’IA, au lieu d’une clé d’API à l’usage. Configurez-les dans Paramètres → Fournisseurs ; Nodus vous avertit lorsqu’un modèle puise dans le quota de votre abonnement.',
        de: 'Du kannst jetzt dein ChatGPT- (Codex) oder GitHub-Copilot-Abo als KI-Anbieter nutzen, statt eines nutzungsbasierten API-Schlüssels. Einrichtung unter Einstellungen → Anbieter; Nodus warnt, wenn ein Modell dein Abo-Kontingent beansprucht.',
        pt: 'Agora pode usar a sua subscrição do ChatGPT (Codex) ou do GitHub Copilot como fornecedor de IA, em vez de uma chave de API paga ao uso. Configure-as em Definições → Fornecedores; o Nodus avisa quando um modelo consome a quota da sua subscrição.',
        'pt-BR': 'Agora você pode usar sua assinatura do ChatGPT (Codex) ou do GitHub Copilot como provedor de IA, em vez de uma chave de API paga por uso. Configure-as em Configurações → Provedores; o Nodus avisa quando um modelo consome a cota da sua assinatura.',
      },
      {
        scope: 'general',
        es: 'La extracción de ideas es más fiable con modelos locales y de nivel gratuito: los modelos de solo visión que devolvían resultados vacíos quedan excluidos del análisis con un aviso claro, y los escaneos profundo y ligero fallan con un error accionable en lugar de guardar datos parciales.',
        en: 'Idea extraction is more reliable on local and free-tier models: vision-only models that returned empty results are now excluded from analysis with a clear notice, and deep and light scans fail with an actionable error instead of storing partial data.',
        fr: 'L’extraction d’idées est plus fiable avec les modèles locaux et gratuits : les modèles uniquement visuels qui renvoyaient des résultats vides sont désormais exclus de l’analyse avec un avis clair, et les analyses approfondie et légère échouent avec une erreur exploitable au lieu d’enregistrer des données partielles.',
        de: 'Die Ideen-Extraktion ist mit lokalen und kostenlosen Modellen zuverlässiger: Reine Bildmodelle, die leere Ergebnisse lieferten, werden nun mit einem klaren Hinweis von der Analyse ausgeschlossen, und Tief- und Leicht-Scans schlagen mit einem umsetzbaren Fehler fehl, statt Teildaten zu speichern.',
        pt: 'A extração de ideias é mais fiável com modelos locais e de nível gratuito: os modelos apenas de visão que devolviam resultados vazios passam a ser excluídos da análise com um aviso claro, e as análises profunda e ligeira falham com um erro acionável em vez de guardar dados parciais.',
        'pt-BR': 'A extração de ideias é mais confiável com modelos locais e de nível gratuito: os modelos apenas de visão que retornavam resultados vazios agora são excluídos da análise com um aviso claro, e as varreduras profunda e leve falham com um erro acionável em vez de guardar dados parciais.',
      },
      {
        scope: 'general',
        es: 'El mapa de ruta de Nodus estrena una vista con el estado de cada iniciativa —planificado, en desarrollo o publicado— presentada en un modal cinemático para que veas de un vistazo hacia dónde va la aplicación.',
        en: 'Nodus’s roadmap gets a new view with the status of each initiative — planned, in progress or shipped — presented in a cinematic modal so you can see at a glance where the app is heading.',
        fr: 'La feuille de route de Nodus inaugure une vue indiquant l’état de chaque initiative — planifiée, en cours ou livrée — présentée dans un modal cinématique pour voir d’un coup d’œil où va l’application.',
        de: 'Die Roadmap von Nodus erhält eine neue Ansicht mit dem Status jeder Initiative – geplant, in Arbeit oder veröffentlicht – dargestellt in einem filmreifen Fenster, damit du auf einen Blick siehst, wohin sich die App entwickelt.',
        pt: 'O roteiro do Nodus estreia uma vista com o estado de cada iniciativa — planeado, em desenvolvimento ou publicado — apresentada num modal cinemático para ver de relance para onde vai a aplicação.',
        'pt-BR': 'O roteiro do Nodus estreia uma visão com o status de cada iniciativa — planejado, em desenvolvimento ou publicado — apresentada em um modal cinematográfico para ver rapidamente para onde o aplicativo está indo.',
      },
      {
        scope: 'general',
        es: 'Nodus es más rápido y más robusto: una auditoría de rendimiento acelera drásticamente varias operaciones (mejora de textos, camino de lectura y galerías), evita bloqueos de la ventana principal e impide abrir dos instancias sobre el mismo perfil; además, las copias de seguridad y la sincronización entre equipos se restauran de forma atómica y resisten mejor los fallos.',
        en: 'Nodus is faster and more robust: a performance audit dramatically speeds up several operations (text improvement, reading path and galleries), prevents main-window freezes and refuses to open two instances on the same profile; backups and cross-machine sync now restore atomically and tolerate failures far better.',
        fr: 'Nodus est plus rapide et plus robuste : un audit de performance accélère nettement plusieurs opérations (amélioration de texte, chemin de lecture et galeries), évite les blocages de la fenêtre principale et refuse d’ouvrir deux instances sur le même profil ; les sauvegardes et la synchronisation entre machines se restaurent de façon atomique et tolèrent bien mieux les erreurs.',
        de: 'Nodus ist schneller und robuster: Ein Performance-Audit beschleunigt mehrere Vorgänge deutlich (Textverbesserung, Lesepfad und Galerien), verhindert Einfrieren des Hauptfensters und lehnt eine zweite Instanz auf demselben Profil ab; Backups und die Synchronisierung zwischen Geräten stellen jetzt atomar wieder her und verkraften Fehler weitaus besser.',
        pt: 'O Nodus é mais rápido e mais robusto: uma auditoria de desempenho acelera drasticamente várias operações (melhoria de texto, percurso de leitura e galerias), evita bloqueios da janela principal e recusa abrir duas instâncias no mesmo perfil; as cópias de segurança e a sincronização entre equipamentos passam a restaurar de forma atómica e a tolerar melhor as falhas.',
        'pt-BR': 'O Nodus é mais rápido e mais robusto: uma auditoria de desempenho acelera drasticamente várias operações (melhoria de texto, caminho de leitura e galerias), evita travamentos da janela principal e recusa abrir duas instâncias no mesmo perfil; os backups e a sincronização entre máquinas agora restauram de forma atômica e toleram falhas muito melhor.',
      },
      {
        scope: 'estudio',
        es: 'Estudio afina su chat: mejora la recuperación de contenido para responder con lo que hay en tu bóveda, corrige varias traducciones y arregla los controles de la cabecera.',
        en: 'Study sharpens its chat: content retrieval is improved so answers draw on what’s in your vault, several translations are corrected and the header controls are fixed.',
        fr: 'Étude affine son chat : la récupération de contenu est améliorée pour répondre à partir de ce qui se trouve dans votre espace, plusieurs traductions sont corrigées et les commandes de l’en-tête sont réparées.',
        de: 'Studium verfeinert seinen Chat: Die Inhaltsabfrage wurde verbessert, sodass Antworten auf dem beruhen, was in deinem Arbeitsbereich liegt, mehrere Übersetzungen wurden korrigiert und die Bedienelemente der Kopfzeile repariert.',
        pt: 'O Estudo afina o seu chat: melhora a recuperação de conteúdo para responder com o que há no seu espaço, corrige várias traduções e repara os controlos do cabeçalho.',
        'pt-BR': 'O Estudo afina o seu chat: melhora a recuperação de conteúdo para responder com o que há no seu espaço, corrige várias traduções e conserta os controles do cabeçalho.',
      },
      {
        scope: 'estudio',
        es: 'La gestión de materiales en Estudio y Docencia es más cómoda: súbelos arrastrando y soltando, renómbralos o elimínalos, y disfruta de un visor de PDF mejorado. Además, Nodus pide consentimiento explícito antes de enviar cualquier material a un modelo de IA, y los controles del horario permanecen dentro de su franja.',
        en: 'Managing materials in Study and Teaching is smoother: upload them by drag-and-drop, rename or delete them, and enjoy an improved PDF viewer. Nodus also asks for explicit consent before sending any material to an AI model, and the timetable controls stay inside their slot.',
        fr: 'La gestion des documents dans Étude et Enseignement est plus fluide : téléversez-les par glisser-déposer, renommez-les ou supprimez-les, et profitez d’un lecteur PDF amélioré. Nodus demande aussi un consentement explicite avant d’envoyer un document à un modèle d’IA, et les commandes de l’emploi du temps restent dans leur créneau.',
        de: 'Die Verwaltung von Materialien in Studium und Lehre ist komfortabler: per Drag-and-drop hochladen, umbenennen oder löschen und ein verbesserter PDF-Betrachter. Außerdem fragt Nodus vor dem Senden eines Materials an ein KI-Modell ausdrücklich um Zustimmung, und die Stundenplan-Bedienelemente bleiben in ihrem Zeitfenster.',
        pt: 'A gestão de materiais em Estudo e Docência é mais cómoda: carregue-os arrastando e largando, renomeie-os ou elimine-os e desfrute de um visualizador de PDF melhorado. Além disso, o Nodus pede consentimento explícito antes de enviar qualquer material a um modelo de IA, e os controlos do horário permanecem dentro da sua faixa.',
        'pt-BR': 'A gestão de materiais em Estudo e Docência é mais cômoda: carregue-os arrastando e soltando, renomeie-os ou exclua-os e aproveite um visualizador de PDF melhorado. Além disso, o Nodus pede consentimento explícito antes de enviar qualquer material a um modelo de IA, e os controles do horário permanecem dentro da sua faixa.',
      },
      {
        scope: 'academic',
        es: 'La bóveda académica de demostración estrena un grafo de conocimiento más rico —con más ideas, temas y conexiones— para explorar cómo Nodus relaciona la literatura antes de cargar tu propio corpus.',
        en: 'The academic demo vault ships a richer knowledge graph — more ideas, themes and connections — to explore how Nodus relates the literature before you load your own corpus.',
        fr: 'L’espace académique de démonstration inaugure un graphe de connaissances plus riche — davantage d’idées, de thèmes et de connexions — pour explorer comment Nodus relie la littérature avant de charger votre propre corpus.',
        de: 'Der akademische Demo-Arbeitsbereich bringt einen reichhaltigeren Wissensgraphen – mehr Ideen, Themen und Verbindungen –, um zu erkunden, wie Nodus die Literatur verknüpft, bevor du dein eigenes Korpus lädst.',
        pt: 'O espaço académico de demonstração estreia um grafo de conhecimento mais rico — mais ideias, temas e ligações — para explorar como o Nodus relaciona a literatura antes de carregar o seu próprio corpus.',
        'pt-BR': 'O espaço acadêmico de demonstração estreia um grafo de conhecimento mais rico — mais ideias, temas e conexões — para explorar como o Nodus relaciona a literatura antes de você carregar seu próprio corpus.',
      },
      {
        scope: 'nodi',
        es: 'El chat de Nodi ahora cita las fuentes del corpus que respaldan sus respuestas, igual que el asistente de investigación, para que puedas rastrear cada afirmación hasta tu biblioteca.',
        en: 'Nodi’s chat now cites the corpus sources behind its answers, just like the research assistant, so you can trace every claim back to your library.',
        fr: 'Le chat de Nodi cite désormais les sources du corpus qui étayent ses réponses, comme l’assistant de recherche, pour que vous puissiez remonter chaque affirmation jusqu’à votre bibliothèque.',
        de: 'Nodis Chat zitiert jetzt die Korpus-Quellen hinter seinen Antworten – genau wie der Rechercheassistent –, damit du jede Aussage bis zu deiner Bibliothek zurückverfolgen kannst.',
        pt: 'O chat do Nodi passa a citar as fontes do corpus que sustentam as suas respostas, tal como o assistente de investigação, para que possa rastrear cada afirmação até à sua biblioteca.',
        'pt-BR': 'O chat do Nodi agora cita as fontes do corpus por trás das suas respostas, assim como o assistente de pesquisa, para que você possa rastrear cada afirmação até a sua biblioteca.',
      },
      {
        scope: 'nodi',
        es: 'Nodi pule su aspecto en tema claro: las barras de desplazamiento de sus paneles vuelven a verse correctamente.',
        en: 'Nodi polishes its light-theme look: the scrollbars in its panels render correctly again.',
        fr: 'Nodi peaufine son apparence en thème clair : les barres de défilement de ses panneaux s’affichent à nouveau correctement.',
        de: 'Nodi verfeinert sein Aussehen im hellen Design: Die Bildlaufleisten seiner Panels werden wieder korrekt dargestellt.',
        pt: 'O Nodi apura o seu aspeto no tema claro: as barras de deslocamento dos seus painéis voltam a ver-se corretamente.',
        'pt-BR': 'O Nodi apura o seu visual no tema claro: as barras de rolagem dos seus painéis voltam a aparecer corretamente.',
      },
    ],
  },
  {
    version: '2.4.0',
    date: '2026-07-18',
    highlights: [
      {
        scope: 'nodi',
        es: 'Nodi estrena un aspecto que puedes elegir: conserva la mascota clásica o cámbiala por un orbe elegante —una esfera de cristal que guarda una constelación— y tu elección te acompaña en toda la aplicación. Nodi incorpora además notas rápidas en Markdown que puedes escribir directamente desde su menú radial.',
        en: 'Nodi has a new look you can choose: keep the classic mascot or switch to a sleek orb — a glass sphere holding a constellation — and your choice follows you across the whole app. Nodi also gains quick Markdown notes you can jot straight from its radial menu.',
        fr: 'Nodi inaugure une apparence que vous pouvez choisir : conservez la mascotte classique ou remplacez-la par un orbe élégant — une sphère de verre renfermant une constellation — et votre choix vous accompagne dans toute l’application. Nodi intègre également des notes rapides en Markdown que vous pouvez écrire directement depuis son menu radial.',
        de: 'Nodi erhält ein Aussehen, das du wählen kannst: Behalte das klassische Maskottchen oder wechsle zu einem eleganten Orb – einer Glaskugel mit einer Konstellation im Inneren – und deine Wahl begleitet dich in der gesamten Anwendung. Nodi bekommt außerdem schnelle Markdown-Notizen, die du direkt aus seinem Radialmenü schreiben kannst.',
        pt: 'O Nodi estreia um aspeto que pode escolher: mantenha a mascote clássica ou troque-a por um orbe elegante — uma esfera de vidro que guarda uma constelação — e a sua escolha acompanha-o em toda a aplicação. O Nodi passa também a ter notas rápidas em Markdown que pode escrever diretamente a partir do seu menu radial.',
        'pt-BR': 'O Nodi estreia um visual que você pode escolher: mantenha o mascote clássico ou troque por um orbe elegante — uma esfera de vidro que guarda uma constelação — e sua escolha acompanha você em todo o aplicativo. O Nodi também ganha notas rápidas em Markdown que você pode escrever diretamente pelo seu menu radial.',
      },
      {
        scope: 'nodi',
        es: 'Nodi se comporta con más estabilidad en todas partes: el overlay flotante ya no parpadea entre aplicaciones ni al arrastrarlo y pulsarlo, rebota con suavidad en los bordes de la pantalla, sus controles se adaptan al color de la bóveda activa y el orbe aparece perfectamente centrado en el tutorial.',
        en: 'Nodi behaves more steadily everywhere: the floating overlay no longer flickers across apps or when you drag and click it, it rebounds smoothly at the screen edges, its controls adapt to the active vault’s colour, and the orb sits perfectly centred in the tutorial.',
        fr: 'Nodi se comporte de manière plus stable partout : l’overlay flottant ne scintille plus entre les applications ni lorsque vous le faites glisser et cliquez dessus, il rebondit en douceur sur les bords de l’écran, ses commandes s’adaptent à la couleur de l’espace actif et l’orbe apparaît parfaitement centré dans le tutoriel.',
        de: 'Nodi verhält sich überall stabiler: Das schwebende Overlay flackert nicht mehr zwischen Anwendungen oder beim Ziehen und Anklicken, es prallt sanft an den Bildschirmrändern ab, seine Bedienelemente passen sich der Farbe des aktiven Arbeitsbereichs an und der Orb erscheint perfekt zentriert im Tutorial.',
        pt: 'O Nodi comporta-se com mais estabilidade em todo o lado: o overlay flutuante já não pisca entre aplicações nem ao arrastá-lo e clicá-lo, ressalta suavemente nos limites do ecrã, os seus controlos adaptam-se à cor do espaço ativo e o orbe aparece perfeitamente centrado no tutorial.',
        'pt-BR': 'O Nodi se comporta com mais estabilidade em todo lugar: o overlay flutuante não pisca mais entre aplicativos nem ao arrastá-lo e clicá-lo, ressalta suavemente nas bordas da tela, seus controles se adaptam à cor do espaço ativo e o orbe aparece perfeitamente centralizado no tutorial.',
      },
      {
        scope: 'toolkit',
        es: 'Estrena Nodus Toolkit, la nueva sección de Herramientas, y su primer conversor, Nodus Convert: convierte y procesa archivos en tu equipo, de uno en uno o en lote. Documentos (PDF, DOCX, EPUB, Markdown, HTML y texto), utilidades de PDF (unir, dividir, rotar, reordenar, extraer imágenes y editar metadatos), OCR ligero con PDF buscable, imágenes (incluido HEIC, redimensionar y comprimir) y utilidades de texto. Todo local y determinista; nunca modifica el archivo original.',
        en: 'Nodus Toolkit arrives as the new Tools section, with its first converter, Nodus Convert: convert and process files on your own computer, one at a time or in batches. Documents (PDF, DOCX, EPUB, Markdown, HTML and text), PDF utilities (merge, split, rotate, reorder, extract images and edit metadata), light OCR with a searchable PDF, images (including HEIC, resize and compress) and text utilities. Everything is local and deterministic; the original file is never modified.',
        fr: 'Nodus Toolkit arrive comme la nouvelle section Outils, avec son premier convertisseur, Nodus Convert : convertissez et traitez vos fichiers sur votre propre ordinateur, un par un ou par lots. Documents (PDF, DOCX, EPUB, Markdown, HTML et texte), utilitaires PDF (fusionner, diviser, faire pivoter, réordonner, extraire des images et modifier les métadonnées), OCR léger avec PDF interrogeable, images (y compris HEIC, redimensionner et compresser) et utilitaires de texte. Tout est local et déterministe ; le fichier d’origine n’est jamais modifié.',
        de: 'Nodus Toolkit erscheint als neuer Werkzeuge-Bereich mit seinem ersten Konverter, Nodus Convert: Konvertiere und verarbeite Dateien auf deinem eigenen Gerät, einzeln oder im Stapel. Dokumente (PDF, DOCX, EPUB, Markdown, HTML und Text), PDF-Werkzeuge (zusammenführen, teilen, drehen, neu anordnen, Bilder extrahieren und Metadaten bearbeiten), leichtes OCR mit durchsuchbarem PDF, Bilder (inklusive HEIC, skalieren und komprimieren) und Textwerkzeuge. Alles ist lokal und deterministisch; die Originaldatei wird nie verändert.',
        pt: 'Chega o Nodus Toolkit como a nova secção Ferramentas, com o seu primeiro conversor, o Nodus Convert: converta e processe ficheiros no seu próprio equipamento, um a um ou em lote. Documentos (PDF, DOCX, EPUB, Markdown, HTML e texto), utilitários de PDF (unir, dividir, rodar, reordenar, extrair imagens e editar metadados), OCR ligeiro com PDF pesquisável, imagens (incluindo HEIC, redimensionar e comprimir) e utilitários de texto. Tudo local e determinista; o ficheiro original nunca é modificado.',
        'pt-BR': 'Chega o Nodus Toolkit como a nova seção Ferramentas, com seu primeiro conversor, o Nodus Convert: converta e processe arquivos no seu próprio computador, um a um ou em lote. Documentos (PDF, DOCX, EPUB, Markdown, HTML e texto), utilitários de PDF (unir, dividir, girar, reordenar, extrair imagens e editar metadados), OCR leve com PDF pesquisável, imagens (incluindo HEIC, redimensionar e comprimir) e utilitários de texto. Tudo local e determinístico; o arquivo original nunca é modificado.',
      },
      {
        scope: 'toolkit',
        es: 'Nodus Convert sigue creciendo: PDF a imágenes, comprimir y pasar a escala de grises, añadir números de página, marcas de agua y recortar márgenes; nuevas opciones de recorte, rotación, volteo y marca de agua para imágenes; y los trabajos en lote se entregan ahora empaquetados en un único ZIP.',
        en: 'Nodus Convert keeps growing: PDF to images, compress and convert to grayscale, add page numbers, watermarks and crop margins; new crop, rotate, flip and watermark options for images; and batch jobs are now delivered packaged in a single ZIP.',
        fr: 'Nodus Convert continue de s’enrichir : PDF vers images, compression et passage en niveaux de gris, ajout de numéros de page, filigranes et rognage des marges ; nouvelles options de recadrage, rotation, retournement et filigrane pour les images ; et les travaux par lots sont désormais livrés empaquetés dans un seul ZIP.',
        de: 'Nodus Convert wächst weiter: PDF zu Bildern, komprimieren und in Graustufen umwandeln, Seitenzahlen, Wasserzeichen und Randbeschnitt hinzufügen; neue Optionen zum Zuschneiden, Drehen, Spiegeln und für Wasserzeichen bei Bildern; und Stapelaufträge werden jetzt gebündelt in einer einzigen ZIP-Datei ausgegeben.',
        pt: 'O Nodus Convert continua a crescer: PDF para imagens, comprimir e converter para escala de cinzentos, adicionar números de página, marcas de água e recortar margens; novas opções de recorte, rotação, inversão e marca de água para imagens; e os trabalhos em lote são agora entregues empacotados num único ZIP.',
        'pt-BR': 'O Nodus Convert continua crescendo: PDF para imagens, comprimir e converter para tons de cinza, adicionar números de página, marcas d’água e recortar margens; novas opções de recorte, rotação, inversão e marca d’água para imagens; e os trabalhos em lote agora são entregues empacotados em um único ZIP.',
      },
      {
        scope: 'toolkit',
        es: 'Llega Nodus Protect: combina PDF e imágenes, oculta o desenfoca datos, recorta, gira y endereza, añade siete tipos de marca de agua y un pie legal, y exporta copias rasterizadas sin capas ni texto oculto. Puede usar archivos del disco o de la bóveda, guardar en la biblioteca Copias protegidas y crear o verificar marcas trazables IDPS v1 compatibles con IDprotector. Todo el procesamiento del documento es local.',
        en: 'Nodus Protect arrives: combine PDFs and images, redact or blur data, crop, rotate and straighten, add seven watermark patterns and a legal footer, and export rasterised copies without hidden text or layers. It can use files from disk or the vault, save to the Protected Copies library, and create or verify IDPS v1 traceable marks compatible with IDprotector. All document processing is local.',
        fr: 'Nodus Protect arrive : combinez PDF et images, masquez ou floutez des données, recadrez, faites pivoter et redressez, ajoutez sept motifs de filigrane et un pied de page juridique, puis exportez des copies rastérisées sans texte ni calque caché. Il utilise des fichiers du disque ou de l’espace, les conserve dans la bibliothèque Copies protégées et crée ou vérifie des marques traçables IDPS v1 compatibles avec IDprotector. Tout le traitement documentaire est local.',
        de: 'Nodus Protect ist da: Kombiniere PDFs und Bilder, schwärze oder verwische Daten, schneide zu, drehe und begradige, füge sieben Wasserzeichenmuster und eine rechtliche Fußzeile hinzu und exportiere gerasterte Kopien ohne verborgenen Text oder Ebenen. Dateien können vom Datenträger oder aus dem Arbeitsbereich stammen, in der Bibliothek Geschützte Kopien gespeichert und als IDPS-v1-Markierungen kompatibel mit IDprotector erstellt oder geprüft werden. Die gesamte Dokumentverarbeitung erfolgt lokal.',
        pt: 'Chega o Nodus Protect: combine PDF e imagens, oculte ou desfoque dados, recorte, rode e endireite, adicione sete padrões de marca de água e um rodapé legal e exporte cópias rasterizadas sem texto nem camadas ocultas. Pode usar ficheiros do disco ou do espaço, guardar na biblioteca Cópias protegidas e criar ou verificar marcas rastreáveis IDPS v1 compatíveis com o IDprotector. Todo o processamento documental é local.',
        'pt-BR': 'Chega o Nodus Protect: combine PDFs e imagens, oculte ou desfoque dados, recorte, gire e endireite, adicione sete padrões de marca d’água e um rodapé legal e exporte cópias rasterizadas sem texto nem camadas ocultas. Ele usa arquivos do disco ou do espaço, salva na biblioteca Cópias protegidas e cria ou verifica marcas rastreáveis IDPS v1 compatíveis com o IDprotector. Todo o processamento de documentos é local.',
      },
      {
        scope: 'languages',
        es: 'La interfaz completa de Nodus ya está disponible también en italiano, como séptimo idioma global. Incluye navegación, ajustes, tutoriales, recuperación, mensajes de runtime, vocabulario de cada bóveda, notas de versión y Nodus Protect; la configuración independiente del idioma de los prompts de IA no cambia.',
        en: 'The complete Nodus interface is now also available in Italian as its seventh global language. It covers navigation, settings, tutorials, recovery, runtime messages, each vault’s vocabulary, release notes and Nodus Protect; the separate AI prompt-language setting is unchanged.',
        fr: 'L’interface complète de Nodus est désormais aussi disponible en italien, septième langue globale. Elle couvre la navigation, les réglages, les tutoriels, la récupération, les messages d’exécution, le vocabulaire de chaque espace, les notes de version et Nodus Protect ; le réglage indépendant de la langue des prompts d’IA ne change pas.',
        de: 'Die vollständige Nodus-Oberfläche ist nun auch auf Italienisch als siebte globale Sprache verfügbar. Dies umfasst Navigation, Einstellungen, Tutorials, Wiederherstellung, Laufzeitmeldungen, das Vokabular jedes Arbeitsbereichs, Versionshinweise und Nodus Protect; die separate Spracheinstellung für KI-Prompts bleibt unverändert.',
        pt: 'A interface completa do Nodus está agora também disponível em italiano, como sétimo idioma global. Abrange navegação, definições, tutoriais, recuperação, mensagens de execução, vocabulário de cada espaço, notas de versão e Nodus Protect; a definição independente do idioma dos prompts de IA não muda.',
        'pt-BR': 'A interface completa do Nodus agora também está disponível em italiano, como sétimo idioma global. Ela abrange navegação, configurações, tutoriais, recuperação, mensagens de execução, vocabulário de cada espaço, notas de versão e Nodus Protect; a configuração separada do idioma dos prompts de IA não muda.',
      },
      {
        scope: 'general',
        es: 'Se han pulido varios detalles de la interfaz: la insignia de la bóveda permanece centrada en la cabecera en lugar de desplazarse bajo el carril de acciones, el indicador de carga de la búsqueda gira correctamente y se han corregido las superficies y anulaciones del tema claro.',
        en: 'Several interface details have been polished: the vault badge stays centred in the header instead of drifting under the action rail, the search loading spinner now spins correctly, and light-theme surfaces and overrides were corrected.',
        fr: 'Plusieurs détails de l’interface ont été peaufinés : le badge de l’espace reste centré dans l’en-tête au lieu de se décaler sous la barre d’actions, l’indicateur de chargement de la recherche tourne correctement et les surfaces et surcharges du thème clair ont été corrigées.',
        de: 'Mehrere Oberflächendetails wurden verfeinert: Das Arbeitsbereichs-Abzeichen bleibt in der Kopfzeile zentriert, statt unter die Aktionsleiste zu rutschen, der Ladeindikator der Suche dreht sich korrekt, und Flächen und Überschreibungen des hellen Themes wurden korrigiert.',
        pt: 'Foram aperfeiçoados vários pormenores da interface: o emblema do espaço permanece centrado no cabeçalho em vez de se deslocar sob a barra de ações, o indicador de carregamento da pesquisa roda corretamente e foram corrigidas as superfícies e substituições do tema claro.',
        'pt-BR': 'Vários detalhes da interface foram aprimorados: o emblema do espaço permanece centralizado no cabeçalho em vez de se deslocar sob a barra de ações, o indicador de carregamento da busca gira corretamente e foram corrigidas as superfícies e substituições do tema claro.',
      },
      {
        scope: 'general',
        es: 'El modal de novedades presenta ahora cada cambio con un icono propio de su ámbito —bóveda, servidor MCP, Nodi, idiomas o herramientas— y agrupa los cambios por categoría, ordenados para que los ámbitos con más novedades aparezcan primero.',
        en: 'The What’s New modal now presents every change with an icon for its area — vault, MCP server, Nodi, languages or tools — and groups changes by category, ordered so the areas with the most updates appear first.',
        fr: 'Le modal des nouveautés présente désormais chaque changement avec une icône propre à son domaine — espace, serveur MCP, Nodi, langues ou outils — et regroupe les changements par catégorie, ordonnés pour que les domaines comptant le plus de nouveautés apparaissent en premier.',
        de: 'Das Neuigkeiten-Fenster zeigt jetzt jede Änderung mit einem eigenen Symbol für ihren Bereich – Arbeitsbereich, MCP-Server, Nodi, Sprachen oder Werkzeuge – und gruppiert die Änderungen nach Kategorie, geordnet, sodass die Bereiche mit den meisten Neuerungen zuerst erscheinen.',
        pt: 'O modal de novidades apresenta agora cada alteração com um ícone próprio do seu âmbito — espaço, servidor MCP, Nodi, idiomas ou ferramentas — e agrupa as alterações por categoria, ordenadas para que os âmbitos com mais novidades apareçam primeiro.',
        'pt-BR': 'O modal de novidades agora apresenta cada mudança com um ícone próprio da sua área — espaço, servidor MCP, Nodi, idiomas ou ferramentas — e agrupa as mudanças por categoria, ordenadas para que as áreas com mais novidades apareçam primeiro.',
      },
      {
        scope: 'estudio',
        es: 'Estudio organiza ahora cursos, asignaturas y horarios por curso académico (por ejemplo, 2024/2025). El año es heredable —fíjalo en un curso y sus asignaturas lo adoptan, o asígnalo por asignatura en una carrera de varios años— de modo que una asignatura que se imparte cada septiembre conserva los materiales y el horario del año anterior en lugar de sobrescribirlos, con un atajo para copiar un horario a otro curso académico.',
        en: 'Study now organises courses, subjects and timetables by academic year (for example, 2024/2025). The year is inheritable — set it on a course and its subjects adopt it, or set it per subject for a multi-year degree — so a course taught again each September keeps last year’s materials and timetable instead of overwriting them, with a shortcut to copy a timetable to another academic year.',
        fr: 'Étude organise désormais les cours, les matières et les emplois du temps par année académique (par exemple, 2024/2025). L’année est héritable — définissez-la sur un cours et ses matières l’adoptent, ou définissez-la par matière pour un cursus de plusieurs années — de sorte qu’un cours redispensé chaque septembre conserve les matériaux et l’emploi du temps de l’année précédente au lieu de les écraser, avec un raccourci pour copier un emploi du temps vers une autre année académique.',
        de: 'Studium organisiert jetzt Kurse, Fächer und Stundenpläne nach Studienjahr (zum Beispiel 2024/2025). Das Jahr ist vererbbar – lege es auf einem Kurs fest, und seine Fächer übernehmen es, oder lege es pro Fach für ein mehrjähriges Studium fest –, sodass ein jeden September erneut unterrichteter Kurs die Materialien und den Stundenplan des Vorjahres behält, statt sie zu überschreiben, mit einer Verknüpfung, um einen Stundenplan in ein anderes Studienjahr zu kopieren.',
        pt: 'O Estudo organiza agora cursos, disciplinas e horários por ano letivo (por exemplo, 2024/2025). O ano é herdável — defina-o num curso e as suas disciplinas adotam-no, ou atribua-o por disciplina num curso de vários anos — de modo que uma disciplina lecionada todos os setembros conserva os materiais e o horário do ano anterior em vez de os substituir, com um atalho para copiar um horário para outro ano letivo.',
        'pt-BR': 'O Estudo agora organiza cursos, disciplinas e horários por ano letivo (por exemplo, 2024/2025). O ano é herdável — defina-o em um curso e suas disciplinas o adotam, ou atribua-o por disciplina em um curso de vários anos — de modo que uma disciplina lecionada todo setembro conserva os materiais e o horário do ano anterior em vez de sobrescrevê-los, com um atalho para copiar um horário para outro ano letivo.',
      },
      {
        scope: 'estudio',
        es: 'La IA de Estudio es más fiable: las extracciones ya no se descartan en silencio cuando un modelo usa una redacción algo distinta para las relaciones, y las respuestas truncadas se detectan en lugar de guardarse como datos parciales.',
        en: 'Study’s AI is more reliable: extractions are no longer silently discarded when a model uses slightly different wording for relationships, and truncated responses are detected instead of being stored as partial data.',
        fr: 'L’IA d’Étude est plus fiable : les extractions ne sont plus rejetées en silence lorsqu’un modèle utilise une formulation légèrement différente pour les relations, et les réponses tronquées sont détectées au lieu d’être enregistrées comme des données partielles.',
        de: 'Die KI von Studium ist zuverlässiger: Extraktionen werden nicht mehr stillschweigend verworfen, wenn ein Modell eine leicht abweichende Formulierung für Beziehungen verwendet, und abgeschnittene Antworten werden erkannt, statt als unvollständige Daten gespeichert zu werden.',
        pt: 'A IA do Estudo é mais fiável: as extrações já não são descartadas em silêncio quando um modelo usa uma redação ligeiramente diferente para as relações, e as respostas truncadas são detetadas em vez de guardadas como dados parciais.',
        'pt-BR': 'A IA do Estudo é mais confiável: as extrações não são mais descartadas silenciosamente quando um modelo usa uma redação ligeiramente diferente para as relações, e as respostas truncadas são detectadas em vez de armazenadas como dados parciais.',
      },
      {
        scope: 'mcp',
        es: 'El servidor MCP ha recibido una auditoría completa: una superficie de herramientas unificada y paginada en todos los tipos de bóveda —eventos y archivo de genealogía y fuentes primarias, consultas y filtros tipados de bases de datos, y el banco de preguntas de estudio— además de corregir tres fallos silenciosos, de modo que un corpus sin indexar, una bóveda cambiada o un proveedor de IA con error ahora avisan con claridad en lugar de engañar al cliente.',
        en: 'The MCP server received a full audit: a unified, paginated tool surface across every vault type — genealogy and primary-source events and archive, typed database queries and filters, and the study question bank — plus three silent failure modes fixed, so an unindexed corpus, a switched vault or a failing AI provider now report clearly instead of misleading the client.',
        fr: 'Le serveur MCP a fait l’objet d’un audit complet : une surface d’outils unifiée et paginée pour tous les types d’espaces — événements et archive de généalogie et de sources primaires, requêtes et filtres typés de bases de données, et banque de questions d’étude — ainsi que la correction de trois défaillances silencieuses, de sorte qu’un corpus non indexé, un espace changé ou un fournisseur d’IA en erreur signalent désormais clairement le problème au lieu d’induire le client en erreur.',
        de: 'Der MCP-Server wurde umfassend geprüft: eine einheitliche, paginierte Werkzeugoberfläche für alle Arbeitsbereichstypen – Ereignisse und Archiv von Genealogie und Primärquellen, typisierte Datenbankabfragen und -filter sowie die Fragensammlung des Studiums – sowie die Behebung von drei stillen Fehlerfällen, sodass ein nicht indexiertes Korpus, ein gewechselter Arbeitsbereich oder ein fehlerhafter KI-Anbieter jetzt klar melden, statt den Client in die Irre zu führen.',
        pt: 'O servidor MCP recebeu uma auditoria completa: uma superfície de ferramentas unificada e paginada em todos os tipos de espaço — eventos e arquivo de genealogia e fontes primárias, consultas e filtros tipados de bases de dados, e o banco de perguntas de estudo — além da correção de três falhas silenciosas, de modo que um corpus sem indexação, um espaço trocado ou um fornecedor de IA com erro avisam agora com clareza em vez de enganar o cliente.',
        'pt-BR': 'O servidor MCP recebeu uma auditoria completa: uma superfície de ferramentas unificada e paginada em todos os tipos de espaço — eventos e arquivo de genealogia e fontes primárias, consultas e filtros tipados de bancos de dados e o banco de perguntas de estudo — além da correção de três falhas silenciosas, de modo que um corpus sem indexação, um espaço trocado ou um provedor de IA com erro agora avisam com clareza em vez de enganar o cliente.',
      },
      {
        scope: 'languages',
        es: 'El selector de idioma de los prompts ofrece ahora alemán y las dos variantes de portugués (europeo y de Brasil, escritas por separado, no como alias), para que tus ideas, informes y preguntas se generen en el idioma en el que lees Nodus; el turco vuelve a funcionar sobre MCP y se han corregido varias traducciones de la interfaz y el recurso de reserva en inglés.',
        en: 'The prompt language selector now offers German and both Portuguese variants (European and Brazilian, written separately, not aliased), so your ideas, reports and questions are generated in the language you read Nodus in; Turkish works over MCP again, and several interface translations and the English fallback were fixed.',
        fr: 'Le sélecteur de langue des prompts propose désormais l’allemand et les deux variantes du portugais (européen et brésilien, rédigées séparément et non aliasées), afin que vos idées, rapports et questions soient générés dans la langue dans laquelle vous lisez Nodus ; le turc fonctionne de nouveau via MCP, et plusieurs traductions de l’interface ainsi que le repli en anglais ont été corrigés.',
        de: 'Die Sprachauswahl der Prompts bietet jetzt Deutsch und beide Portugiesisch-Varianten (europäisch und brasilianisch, separat geschrieben und nicht als Alias), damit deine Ideen, Berichte und Fragen in der Sprache erzeugt werden, in der du Nodus liest; Türkisch funktioniert wieder über MCP, und mehrere Oberflächenübersetzungen sowie der englische Rückgriff wurden korrigiert.',
        pt: 'O seletor de idioma dos prompts oferece agora alemão e as duas variantes de português (europeu e do Brasil, escritas separadamente e não como alias), para que as suas ideias, relatórios e perguntas sejam gerados no idioma em que lê o Nodus; o turco volta a funcionar sobre MCP e foram corrigidas várias traduções da interface e o recurso de reserva em inglês.',
        'pt-BR': 'O seletor de idioma dos prompts agora oferece alemão e as duas variantes de português (europeu e do Brasil, escritas separadamente e não como alias), para que suas ideias, relatórios e perguntas sejam gerados no idioma em que você lê o Nodus; o turco volta a funcionar sobre MCP e foram corrigidas várias traduções da interface e o recurso de reserva em inglês.',
      },
      {
        scope: 'genealogy',
        es: 'Genealogía es más fiel a tus datos: la importación y exportación GEDCOM ya no convierte a un hijo adoptado en hijo biológico al ir y volver entre programas, y la red de relaciones sociales muestra ahora el nombre de cada contacto en lugar de puntos anónimos.',
        en: 'Genealogy is more faithful to your data: GEDCOM import and export no longer turns an adopted child into a birth child on a round-trip between programs, and the social-relations network now shows every contact’s name instead of anonymous dots.',
        fr: 'La généalogie est plus fidèle à vos données : l’import et l’export GEDCOM ne transforment plus un enfant adopté en enfant biologique lors d’un aller-retour entre programmes, et le réseau de relations sociales affiche désormais le nom de chaque contact au lieu de points anonymes.',
        de: 'Die Genealogie ist deinen Daten treuer: Der GEDCOM-Import und -Export macht aus einem adoptierten Kind bei einem Hin- und Rückweg zwischen Programmen kein leibliches Kind mehr, und das Netzwerk der sozialen Beziehungen zeigt jetzt den Namen jedes Kontakts statt anonymer Punkte.',
        pt: 'A genealogia é mais fiel aos seus dados: a importação e exportação GEDCOM já não converte um filho adotado em filho biológico ao ir e voltar entre programas, e a rede de relações sociais mostra agora o nome de cada contacto em vez de pontos anónimos.',
        'pt-BR': 'A genealogia é mais fiel aos seus dados: a importação e exportação GEDCOM não converte mais um filho adotado em filho biológico ao ir e voltar entre programas, e a rede de relações sociais agora mostra o nome de cada contato em vez de pontos anônimos.',
      },
      {
        scope: 'databases',
        es: 'El modo Bases de datos avanza hacia su fase beta con columnas de fórmula creadas a partir de recetas visuales (operaciones, estadísticas, condicionales con colores, texto combinado) que se comportan como cualquier otra columna en filtros, ordenaciones y exportación; la importación de CSV es muchísimo más rápida, la vinculación masiva de adjuntos es más inteligente y las imágenes adjuntas usan miniaturas.',
        en: 'Databases mode moves towards beta with formula columns built from visual recipes (operations, statistics, if/then with colours, combined text) that behave like any other column for filters, sorts and export; CSV import is dramatically faster, bulk attachment matching is smarter, and image attachments use thumbnails.',
        fr: 'Le mode Bases de données progresse vers sa version bêta avec des colonnes de formule créées à partir de recettes visuelles (opérations, statistiques, conditions avec couleurs, texte combiné) qui se comportent comme n’importe quelle autre colonne pour les filtres, les tris et l’export ; l’import CSV est bien plus rapide, l’association en masse des pièces jointes est plus intelligente et les images jointes utilisent des miniatures.',
        de: 'Der Datenbanken-Modus nähert sich der Beta mit Formelspalten, die aus visuellen Rezepten (Operationen, Statistiken, Wenn/Dann mit Farben, kombinierter Text) erstellt werden und sich bei Filtern, Sortierungen und Export wie jede andere Spalte verhalten; der CSV-Import ist erheblich schneller, die Massenzuordnung von Anhängen ist intelligenter und Bildanhänge verwenden Miniaturansichten.',
        pt: 'O modo Bases de dados avança para a fase beta com colunas de fórmula criadas a partir de receitas visuais (operações, estatísticas, condicionais com cores, texto combinado) que se comportam como qualquer outra coluna em filtros, ordenações e exportação; a importação de CSV é muitíssimo mais rápida, a associação em massa de anexos é mais inteligente e as imagens anexadas usam miniaturas.',
        'pt-BR': 'O modo Bancos de dados avança para a fase beta com colunas de fórmula criadas a partir de receitas visuais (operações, estatísticas, condicionais com cores, texto combinado) que se comportam como qualquer outra coluna em filtros, ordenações e exportação; a importação de CSV é muitíssimo mais rápida, a associação em massa de anexos é mais inteligente e as imagens anexadas usam miniaturas.',
      },
    ],
  },
  {
    version: '2.3.8',
    date: '2026-07-16',
    highlights: [
      {
        scope: 'languages',
        es: 'Nodus ya está disponible por completo en francés, alemán, portugués de Portugal y portugués de Brasil. Cada interfaz conserva su vocabulario propio, cubre también taxonomías, parentescos y recuperación, y recurre al inglés de forma segura si falta alguna traducción.',
        en: 'Nodus is now fully available in French, German, European Portuguese and Brazilian Portuguese. Each interface keeps its own vocabulary, also covers taxonomies, kinship and recovery, and safely falls back to English if a translation is ever missing.',
        fr: 'Nodus est désormais entièrement disponible en français, allemand, portugais du Portugal et portugais du Brésil. Chaque interface conserve son propre vocabulaire, couvre également les taxonomies, les liens de parenté et la récupération, et revient à l’anglais en toute sécurité si une traduction manque.',
        de: 'Nodus ist jetzt vollständig auf Französisch, Deutsch, europäischem Portugiesisch und brasilianischem Portugiesisch verfügbar. Jede Oberfläche bewahrt ihren eigenen Wortschatz, deckt auch Taxonomien, Verwandtschaft und Wiederherstellung ab und greift sicher auf Englisch zurück, falls eine Übersetzung fehlt.',
        pt: 'O Nodus está agora totalmente disponível em francês, alemão, português de Portugal e português do Brasil. Cada interface preserva o seu próprio vocabulário, abrange também taxonomias, parentescos e recuperação e recorre em segurança ao inglês caso falte alguma tradução.',
        'pt-BR': 'O Nodus agora está totalmente disponível em francês, alemão, português de Portugal e português do Brasil. Cada interface preserva seu próprio vocabulário, também abrange taxonomias, parentescos e recuperação e recorre com segurança ao inglês caso falte alguma tradução.',
      },
      {
        scope: 'general',
        es: 'El asistente de creación descubre automáticamente los modelos de IA y embeddings disponibles en proveedores locales y en la nube. Combina los resultados en dos buscadores claros, tolera proveedores desconectados y descarga el modelo integrado solo al terminar la configuración.',
        en: 'The vault setup wizard now automatically discovers available AI and embedding models across local and cloud providers. It combines the results into two clear searchable pickers, tolerates offline providers and downloads a built-in model only when setup finishes.',
        fr: 'L’assistant de création découvre automatiquement les modèles d’IA et d’embeddings disponibles auprès des fournisseurs locaux et dans le cloud. Il réunit les résultats dans deux sélecteurs de recherche clairs, tolère les fournisseurs hors ligne et ne télécharge le modèle intégré qu’à la fin de la configuration.',
        de: 'Der Einrichtungsassistent erkennt jetzt automatisch verfügbare KI- und Embedding-Modelle bei lokalen und Cloud-Anbietern. Er führt die Ergebnisse in zwei übersichtlichen, durchsuchbaren Auswahlen zusammen, toleriert nicht erreichbare Anbieter und lädt ein integriertes Modell erst nach Abschluss der Einrichtung herunter.',
        pt: 'O assistente de criação descobre automaticamente os modelos de IA e embeddings disponíveis em fornecedores locais e na nuvem. Combina os resultados em dois seletores pesquisáveis e claros, tolera fornecedores desligados e transfere o modelo integrado apenas ao concluir a configuração.',
        'pt-BR': 'O assistente de criação descobre automaticamente os modelos de IA e embeddings disponíveis em provedores locais e na nuvem. Ele combina os resultados em dois seletores pesquisáveis e claros, tolera provedores desconectados e baixa o modelo integrado somente ao concluir a configuração.',
      },
      {
        scope: 'nodi',
        es: 'Los controles radiales de Nodi mantienen ahora una distribución equilibrada, siguen siendo pulsables en las esquinas superiores y permanecen visibles durante su despedida. El menú contextual conserva la acción de cerrar y las interacciones evitan aperturas o cierres accidentales.',
        en: 'Nodi’s radial controls now stay evenly balanced, remain clickable in the top corners and stay visible during its farewell. The context menu reliably keeps the close action and interactions avoid accidental opening or dismissal.',
        fr: 'Les commandes radiales de Nodi conservent désormais une disposition équilibrée, restent cliquables dans les coins supérieurs et demeurent visibles pendant ses adieux. Le menu contextuel garde fiablement l’action de fermeture et les interactions évitent les ouvertures ou fermetures accidentelles.',
        de: 'Nodis radiale Bedienelemente bleiben jetzt gleichmäßig angeordnet, in den oberen Ecken anklickbar und während seines Abschieds sichtbar. Das Kontextmenü behält zuverlässig die Schließen-Aktion, und die Interaktionen vermeiden versehentliches Öffnen oder Ausblenden.',
        pt: 'Os controlos radiais do Nodi mantêm agora uma distribuição equilibrada, continuam clicáveis nos cantos superiores e permanecem visíveis durante a despedida. O menu de contexto conserva de forma fiável a ação de fechar e as interações evitam aberturas ou fechos acidentais.',
        'pt-BR': 'Os controles radiais do Nodi agora mantêm uma distribuição equilibrada, continuam clicáveis nos cantos superiores e permanecem visíveis durante a despedida. O menu de contexto preserva de forma confiável a ação de fechar e as interações evitam aberturas ou fechamentos acidentais.',
      },
      {
        scope: 'general',
        es: 'El icono de Nodus conserva la misma “N” compacta y estilizada tanto con la aplicación abierta como cerrada. El icono estático y las variantes dinámicas comparten ahora una única geometría, evitando que macOS muestre una marca sobredimensionada al salir.',
        en: 'The Nodus icon now keeps the same compact, stylized “N” whether the application is open or closed. The bundled icon and dynamic variants share one geometry, preventing macOS from showing an oversized mark after quitting.',
        fr: 'L’icône de Nodus conserve désormais le même « N » compact et stylisé, que l’application soit ouverte ou fermée. L’icône intégrée et les variantes dynamiques partagent une géométrie unique, empêchant macOS d’afficher une marque surdimensionnée après la fermeture.',
        de: 'Das Nodus-Symbol behält jetzt dasselbe kompakte, stilisierte „N“, unabhängig davon, ob die Anwendung geöffnet oder geschlossen ist. Das gebündelte Symbol und die dynamischen Varianten verwenden eine gemeinsame Geometrie, sodass macOS nach dem Beenden keine übergroße Marke mehr anzeigt.',
        pt: 'O ícone do Nodus mantém agora o mesmo “N” compacto e estilizado, quer a aplicação esteja aberta ou fechada. O ícone incluído e as variantes dinâmicas partilham uma única geometria, impedindo o macOS de mostrar uma marca sobredimensionada depois de sair.',
        'pt-BR': 'O ícone do Nodus agora mantém o mesmo “N” compacto e estilizado, tanto com o aplicativo aberto quanto fechado. O ícone incluído e as variantes dinâmicas compartilham uma única geometria, impedindo que o macOS mostre uma marca superdimensionada depois de sair.',
      },
    ],
  },
  {
    version: '2.3.7',
    date: '2026-07-16',
    highlights: [
      {
        scope: 'genealogy',
        es: 'El árbol genealógico es más directo y expresivo: puedes desplazarte arrastrando, abrir la ficha lateral con un clic y centrar una persona con doble clic. Las ramas combinan los colores elegidos para ambos progenitores y resaltan en dorado la descendencia de la persona protagonista; también se distinguen las relaciones familiares y sociales iniciales.',
        en: 'The family tree is now more direct and expressive: drag to move around, open the side dossier with one click and centre a person with a double click. Branches blend the colours selected for both parents and highlight the focus person’s descendants in gold; initial family and social relationships are now distinguished too.',
        fr: 'L\'arbre généalogique est plus direct et plus expressif : vous pouvez vous déplacer en faisant glisser, ouvrir la fiche latérale d\'un clic et centrer une personne d\'un double clic. Les branches combinent les couleurs choisies pour les deux parents et mettent en évidence en doré la descendance de la personne protagoniste ; les liens de parenté et les relations sociales initiaux sont également distingués.',
        de: 'Der Stammbaum ist jetzt direkter und ausdrucksstärker: Sie können sich per Ziehen bewegen, das Seitendossier mit einem Klick öffnen und eine Person mit Doppelklick zentrieren. Die Zweige kombinieren die für beide Elternteile gewählten Farben und heben die Nachkommen der Bezugsperson golden hervor; auch die anfänglichen familiären und sozialen Beziehungen werden nun unterschieden.',
        pt: 'A árvore genealógica é agora mais direta e expressiva: pode deslocar-se arrastando, abrir a ficha lateral com um clique e centrar uma pessoa com duplo clique. Os ramos combinam as cores escolhidas para ambos os progenitores e realçam a descendência da pessoa protagonista a dourado; distinguem-se também as relações familiares e sociais iniciais.',
        'pt-BR': 'A árvore genealógica está mais direta e expressiva: você pode se deslocar arrastando, abrir a ficha lateral com um clique e centralizar uma pessoa com um duplo clique. Os ramos combinam as cores escolhidas para os dois genitores e destacam em dourado a descendência da pessoa protagonista; também se distinguem as relações familiares e sociais iniciais.',
      },
      {
        scope: 'genealogy',
        es: 'El timeline y el mapa de Genealogía estrenan filtros múltiples, tarjetas más claras, miniaturas y acceso a la ficha completa al pulsar una persona. Se han eliminado parpadeos y solapamientos, el mapa encuadra los puntos visibles y sus créditos se abren de forma segura en el navegador.',
        en: 'The Genealogy timeline and map now feature multi-select filters, clearer cards, thumbnails and full dossier access when a person is clicked. Flicker and layering issues are gone, the map fits the visible points and credit links open safely in the browser.',
        fr: 'La chronologie et la carte de Généalogie inaugurent des filtres multiples, des cartes plus claires, des miniatures et l\'accès à la fiche complète en cliquant sur une personne. Les scintillements et les chevauchements ont été éliminés, la carte cadre les points visibles et ses crédits s\'ouvrent en toute sécurité dans le navigateur.',
        de: 'Zeitleiste und Karte der Genealogie erhalten Mehrfachfilter, übersichtlichere Karten, Miniaturansichten und Zugriff auf das vollständige Dossier per Klick auf eine Person. Flackern und Überlappungen wurden beseitigt, die Karte rahmt die sichtbaren Punkte ein, und ihre Quellenangaben öffnen sich sicher im Browser.',
        pt: 'A linha do tempo e o mapa de Genealogia estreiam filtros múltiplos, cartões mais claros, miniaturas e acesso à ficha completa ao clicar numa pessoa. Foram eliminados os cintilados e as sobreposições, o mapa enquadra os pontos visíveis e os respetivos créditos abrem-se em segurança no navegador.',
        'pt-BR': 'A linha do tempo e o mapa de Genealogia estreiam filtros múltiplos, cartões mais claros, miniaturas e acesso à ficha completa ao clicar em uma pessoa. Foram eliminadas cintilações e sobreposições, o mapa enquadra os pontos visíveis e seus créditos abrem com segurança no navegador.',
      },
      {
        scope: 'genealogy',
        es: 'El archivo genealógico reúne la creación de entradas en un único modal ordenado, admite cualquier tipo de adjunto e incorpora importación desde Zotero. Las fichas incluyen además un identificador nacional opcional que también participa en las búsquedas.',
        en: 'The genealogy archive now brings entry creation into one well-organised modal, accepts any attachment type and supports Zotero imports. Person dossiers also include an optional national identifier that is searchable throughout the vault.',
        fr: 'L\'archive généalogique réunit la création d\'entrées dans un seul modal ordonné, accepte tout type de pièce jointe et intègre l\'importation depuis Zotero. Les fiches incluent en outre un identifiant national facultatif qui participe également aux recherches.',
        de: 'Das genealogische Archiv fasst die Erstellung von Einträgen in einem einzigen, übersichtlichen Modal zusammen, akzeptiert jeden Anhangstyp und bindet den Import aus Zotero ein. Die Dossiers enthalten zudem eine optionale nationale Kennung, die auch in die Suche einbezogen wird.',
        pt: 'O arquivo genealógico reúne a criação de entradas num único modal organizado, aceita qualquer tipo de anexo e passa a permitir importação a partir do Zotero. As fichas incluem ainda um identificador nacional opcional que também participa nas pesquisas.',
        'pt-BR': 'O arquivo genealógico reúne a criação de entradas em um único modal organizado, aceita qualquer tipo de anexo e incorpora importação a partir do Zotero. As fichas incluem ainda um identificador nacional opcional que também participa das buscas.',
      },
      {
        scope: 'estudio',
        es: 'Los materiales de Estudio se pueden descargar, muestran el nombre de cada acción al pasar el ratón y aparecen correctamente dentro de sus cursos y asignaturas. Nodi, el chat y las herramientas de IA pueden utilizar el contenido ya indexado de imágenes, PDF y otros archivos.',
        en: 'Study materials can now be downloaded, reveal each action name on hover and appear correctly inside their assigned courses and subjects. Nodi, chat and AI tools can use the indexed content of images, PDFs and other files.',
        fr: 'Les matériaux d\'Étude peuvent être téléchargés, affichent le nom de chaque action au survol de la souris et apparaissent correctement dans leurs cours et matières. Nodi, le chat et les outils d\'IA peuvent utiliser le contenu déjà indexé des images, PDF et autres fichiers.',
        de: 'Studienmaterialien lassen sich jetzt herunterladen, zeigen beim Überfahren mit der Maus den Namen jeder Aktion und erscheinen korrekt innerhalb ihrer Kurse und Fächer. Nodi, der Chat und die KI-Werkzeuge können den bereits indexierten Inhalt von Bildern, PDFs und anderen Dateien nutzen.',
        pt: 'Os materiais de Estudo podem ser transferidos, mostram o nome de cada ação ao passar o rato e aparecem corretamente dentro dos respetivos cursos e disciplinas. O Nodi, o chat e as ferramentas de IA podem utilizar o conteúdo já indexado de imagens, PDF e outros ficheiros.',
        'pt-BR': 'Os materiais de Estudo podem ser baixados, exibem o nome de cada ação ao passar o mouse e aparecem corretamente dentro de seus cursos e disciplinas. Nodi, o chat e as ferramentas de IA podem usar o conteúdo já indexado de imagens, PDF e outros arquivos.',
      },
      {
        scope: 'estudio',
        es: 'Estudio incorpora Deep Research adaptado al aprendizaje y reutiliza el mismo motor, diseño y capacidades de grafo e ideas que las bóvedas académicas, manteniendo siempre separado el contenido de cada vault. El horario muestra nombres completos y el selector evita emojis duplicados.',
        en: 'Study now includes learning-focused Deep Research and reuses the same graph and ideas engine, design and capabilities as academic vaults, while keeping every vault’s content isolated. Timetable names remain readable and the picker no longer duplicates emoji.',
        fr: 'Étude intègre Deep Research adapté à l\'apprentissage et réutilise le même moteur, la même conception et les mêmes capacités de graphe et d\'idées que les espaces académiques, tout en gardant toujours séparé le contenu de chaque espace. L\'emploi du temps affiche les noms complets et le sélecteur évite les emojis en double.',
        de: 'Studium integriert ein lernorientiertes Deep Research und nutzt dieselbe Engine, dasselbe Design und dieselben Graph- und Ideenfunktionen wie akademische Arbeitsbereiche, wobei der Inhalt jedes Arbeitsbereichs stets getrennt bleibt. Der Stundenplan zeigt vollständige Namen an, und die Auswahl vermeidet doppelte Emojis.',
        pt: 'O Estudo incorpora o Deep Research adaptado à aprendizagem e reutiliza o mesmo motor, design e capacidades de grafo e ideias que os espaços académicos, mantendo sempre separado o conteúdo de cada espaço. O horário mostra nomes completos e o seletor evita emojis duplicados.',
        'pt-BR': 'Estudo incorpora o Deep Research adaptado ao aprendizado e reutiliza o mesmo motor, design e capacidades de grafo e ideias dos espaços acadêmicos, mantendo sempre separado o conteúdo de cada espaço. O horário exibe nomes completos e o seletor evita emojis duplicados.',
      },
      {
        scope: 'general',
        es: 'Los asistentes de creación de vaults Académico, Genealogía, Estudio y Bases de datos permiten elegir por separado el modelo de IA y el modelo de embeddings, tanto local como en la nube, y descargan el modelo local cuando es necesario.',
        en: 'The Academic, Genealogy, Study and Databases vault creation wizards now let you choose separate AI and embedding models, either local or cloud-based, and download a local model when needed.',
        fr: 'Les assistants de création des espaces Académique, Généalogie, Étude et Bases de données permettent de choisir séparément le modèle d\'IA et le modèle d\'embeddings, local ou dans le cloud, et téléchargent le modèle local si nécessaire.',
        de: 'Die Einrichtungsassistenten für die Arbeitsbereiche Akademisch, Genealogie, Studium und Datenbanken erlauben es nun, das KI-Modell und das Embedding-Modell getrennt auszuwählen, sowohl lokal als auch in der Cloud, und laden das lokale Modell bei Bedarf herunter.',
        pt: 'Os assistentes de criação de espaços Académico, Genealogia, Estudo e Bases de dados permitem escolher separadamente o modelo de IA e o modelo de embeddings, tanto local como na nuvem, e transferem o modelo local quando necessário.',
        'pt-BR': 'Os assistentes de criação de espaços Acadêmico, Genealogia, Estudo e Bases de dados permitem escolher separadamente o modelo de IA e o modelo de embeddings, tanto local quanto na nuvem, e baixam o modelo local quando necessário.',
      },
      {
        scope: 'nodi',
        es: 'Nodi contrae y hace girar sus extremidades mientras piensa, cierra los ojos y recupera su postura con una animación fluida. También se puede arrastrar por toda la pantalla y cerrar desde su menú contextual con una despedida animada que respeta sus cosméticos.',
        en: 'Nodi contracts and spins its limbs while thinking, closes its eyes and smoothly returns to its normal pose. It can also be dragged across the full screen and dismissed from its context menu with an animated farewell that accounts for its cosmetics.',
        fr: 'Nodi contracte et fait tourner ses membres pendant qu\'il réfléchit, ferme les yeux et retrouve sa posture grâce à une animation fluide. Il peut également être déplacé sur tout l\'écran et fermé depuis son menu contextuel avec un adieu animé qui respecte ses cosmétiques.',
        de: 'Nodi zieht seine Gliedmaßen zusammen und lässt sie rotieren, während es nachdenkt, schließt die Augen und kehrt mit einer flüssigen Animation in seine Haltung zurück. Es lässt sich außerdem über den gesamten Bildschirm ziehen und über sein Kontextmenü mit einem animierten Abschied schließen, der seine Kosmetik berücksichtigt.',
        pt: 'O Nodi contrai e faz girar os membros enquanto pensa, fecha os olhos e recupera a postura com uma animação fluida. Também pode ser arrastado por todo o ecrã e fechado a partir do seu menu de contexto com uma despedida animada que respeita os seus cosméticos.',
        'pt-BR': 'Nodi contrai e gira suas extremidades enquanto pensa, fecha os olhos e retoma sua postura com uma animação fluida. Também pode ser arrastado por toda a tela e fechado a partir do seu menu de contexto com uma despedida animada que respeita seus cosméticos.',
      },
      {
        scope: 'general',
        es: 'La interfaz conserva ahora el color de la bóveda activa al redimensionar el sidebar, iguala el tamaño de las tarjetas de creación y corrige superficies claras, botones, buscadores y desplegables. Los iconos de Novedades indican además su grupo al pasar el ratón.',
        en: 'The interface now keeps the active vault colour while resizing the sidebar, gives creation cards a consistent size and fixes light surfaces, buttons, search fields and dropdowns. What’s New icons also identify their group on hover.',
        fr: 'L\'interface conserve désormais la couleur de l\'espace actif lors du redimensionnement de la barre latérale, uniformise la taille des cartes de création et corrige les surfaces claires, les boutons, les champs de recherche et les menus déroulants. Les icônes de Nouveautés indiquent en outre leur groupe au survol de la souris.',
        de: 'Die Oberfläche behält nun beim Ändern der Sidebar-Größe die Farbe des aktiven Arbeitsbereichs bei, vereinheitlicht die Größe der Erstellungskarten und korrigiert helle Flächen, Schaltflächen, Suchfelder und Dropdown-Menüs. Die Symbole der Neuigkeiten zeigen beim Überfahren mit der Maus zudem ihre Gruppe an.',
        pt: 'A interface passa a conservar a cor do espaço ativo ao redimensionar a barra lateral, iguala o tamanho dos cartões de criação e corrige superfícies claras, botões, campos de pesquisa e menus suspensos. Os ícones de Novidades indicam ainda o respetivo grupo ao passar o rato.',
        'pt-BR': 'A interface agora mantém a cor do espaço ativo ao redimensionar a barra lateral, iguala o tamanho dos cartões de criação e corrige superfícies claras, botões, buscadores e menus suspensos. Os ícones de Novidades indicam ainda seu grupo ao passar o mouse.',
      },
      {
        scope: 'general',
        es: 'Al iniciar Nodus aparece una comprobación cinematográfica de actualizaciones que informa si ya tienes la última versión, si existe una nueva o si se produce un error. Muestra el progreso de descarga y permite instalar y reiniciar sin solaparse con el modal de novedades.',
        en: 'Nodus now performs a cinematic update check at startup, reporting whether you are up to date, a new version is available or an error occurred. It shows download progress and supports install-and-restart without overlapping the What’s New modal.',
        fr: 'Au démarrage de Nodus apparaît une vérification cinématographique des mises à jour qui indique si vous disposez déjà de la dernière version, si une nouvelle version existe ou si une erreur se produit. Elle affiche la progression du téléchargement et permet d\'installer et de redémarrer sans se superposer au modal des nouveautés.',
        de: 'Beim Start von Nodus erscheint eine filmreife Update-Prüfung, die anzeigt, ob Sie bereits die neueste Version verwenden, eine neue Version verfügbar ist oder ein Fehler aufgetreten ist. Sie zeigt den Download-Fortschritt und ermöglicht Installation und Neustart, ohne sich mit dem Neuigkeiten-Fenster zu überschneiden.',
        pt: 'Ao iniciar o Nodus surge uma verificação cinematográfica de atualizações que informa se já tem a versão mais recente, se existe uma nova ou se ocorre um erro. Mostra o progresso da transferência e permite instalar e reiniciar sem se sobrepor ao modal de novidades.',
        'pt-BR': 'Ao iniciar o Nodus aparece uma verificação cinematográfica de atualizações que informa se você já tem a última versão, se existe uma nova ou se ocorre um erro. Mostra o progresso do download e permite instalar e reiniciar sem se sobrepor ao modal de novidades.',
      },
    ],
  },
  {
    version: '2.3.6',
    date: '2026-07-16',
    highlights: [
      {
        scope: 'genealogy',
        es: 'El parentesco se recalcula de forma completa al cambiar la persona protagonista: cónyuges, padres, hijos, hermanos, familia política, familias reconstituidas, primos de cualquier grado y relaciones entre generaciones reciben su etiqueta precisa, incluso en árboles extensos. Nodi y el asistente conocen también estos parentescos calculados.',
        en: 'Kinship is now fully recalculated whenever the focus person changes: spouses, parents, children, siblings, in-laws, blended families, cousins of any degree and cross-generation relationships receive their precise label, even in extended trees. Nodi and the assistant also understand these calculated relationships.',
        fr: 'Le lien de parenté est désormais entièrement recalculé lorsque la personne protagoniste change : conjoints, parents, enfants, frères et sœurs, belle-famille, familles recomposées, cousins de tout degré et relations entre générations reçoivent leur étiquette précise, même dans les arbres étendus. Nodi et l\'assistant connaissent également ces liens de parenté calculés.',
        de: 'Die Verwandtschaft wird beim Wechsel der Bezugsperson jetzt vollständig neu berechnet: Ehepartner, Eltern, Kinder, Geschwister, Schwägerschaft, Patchwork-Familien, Cousins/Cousinen jeden Grades und generationsübergreifende Beziehungen erhalten ihre präzise Bezeichnung, selbst in umfangreichen Stammbäumen. Auch Nodi und der Assistent kennen diese berechneten Verwandtschaftsverhältnisse.',
        pt: 'O parentesco passa a ser recalculado por completo ao mudar a pessoa protagonista: cônjuges, pais, filhos, irmãos, família política, famílias reconstituídas, primos de qualquer grau e relações entre gerações recebem a sua etiqueta precisa, mesmo em árvores extensas. O Nodi e o assistente também conhecem estes parentescos calculados.',
        'pt-BR': 'O parentesco é recalculado por completo ao mudar a pessoa protagonista: cônjuges, pais, filhos, irmãos, família por afinidade, famílias reconstituídas, primos de qualquer grau e relações entre gerações recebem sua etiqueta precisa, mesmo em árvores extensas. Nodi e o assistente também conhecem esses parentescos calculados.',
      },
      {
        scope: 'genealogy',
        es: 'La ficha de persona presenta Name variants, Kinship, Life events, Places, Documents, Evidence y Notes en bloques coherentes con Biography y Relations. Las variantes, los eventos y los lugares se añaden mediante modales limpios, con botones de tamaño uniforme.',
        en: 'The person dossier now presents Name variants, Kinship, Life events, Places, Documents, Evidence and Notes in sections consistent with Biography and Relations. Variants, events and places are added through clean modals with uniformly sized buttons.',
        fr: 'La fiche de personne présente Name variants, Kinship, Life events, Places, Documents, Evidence et Notes dans des blocs cohérents avec Biography et Relations. Les variantes, les événements et les lieux s\'ajoutent via des modales épurées, avec des boutons de taille uniforme.',
        de: 'Das Personendossier zeigt Name variants, Kinship, Life events, Places, Documents, Evidence und Notes in Abschnitten, die mit Biography und Relations übereinstimmen. Varianten, Ereignisse und Orte werden über übersichtliche Modale hinzugefügt, mit einheitlich großen Schaltflächen.',
        pt: 'A ficha de pessoa apresenta Name variants, Kinship, Life events, Places, Documents, Evidence e Notes em blocos coerentes com Biography e Relations. As variantes, os eventos e os lugares adicionam-se através de modais limpos, com botões de tamanho uniforme.',
        'pt-BR': 'A ficha de pessoa apresenta Name variants, Kinship, Life events, Places, Documents, Evidence e Notes em blocos coerentes com Biography e Relations. As variantes, os eventos e os lugares são adicionados por meio de modais limpos, com botões de tamanho uniforme.',
      },
      {
        scope: 'general',
        es: 'El icono renovado de Nodus se conserva también durante el arranque en frío de la aplicación, antes de que se cargue la bóveda activa.',
        en: 'The refreshed Nodus icon is now preserved during a cold application launch too, before the active vault has loaded.',
        fr: 'L\'icône renouvelée de Nodus est désormais également conservée pendant le démarrage à froid de l\'application, avant le chargement de l\'espace actif.',
        de: 'Das erneuerte Nodus-Symbol bleibt nun auch beim Kaltstart der Anwendung erhalten, bevor der aktive Arbeitsbereich geladen wird.',
        pt: 'O ícone renovado do Nodus passa a manter-se também durante o arranque a frio da aplicação, antes de o espaço ativo ser carregado.',
        'pt-BR': 'O ícone renovado do Nodus é mantido também durante a inicialização a frio do aplicativo, antes de o espaço ativo ser carregado.',
      },
      {
        scope: 'general',
        es: 'El modal de novedades muestra ahora el historial completo de la versión principal instalada —por ejemplo, todas las versiones 2.x— en español o inglés. Cada cambio histórico incluye además el icono y el color de su bóveda, o el indicador general cuando afecta a toda la aplicación.',
        en: 'The What’s New modal now shows the complete history of the installed major version—for example, every 2.x release—in English or Spanish. Every historical change also includes its vault icon and colour, or the general indicator when it affects the whole application.',
        fr: 'Le modal des nouveautés affiche désormais l\'historique complet de la version principale installée — par exemple, toutes les versions 2.x — en espagnol ou en anglais. Chaque changement historique inclut en outre l\'icône et la couleur de son espace, ou l\'indicateur général lorsqu\'il concerne l\'ensemble de l\'application.',
        de: 'Das Neuigkeiten-Fenster zeigt jetzt den vollständigen Verlauf der installierten Hauptversion – zum Beispiel alle 2.x-Versionen – auf Spanisch oder Englisch an. Jede historische Änderung enthält außerdem das Symbol und die Farbe ihres Arbeitsbereichs oder die allgemeine Kennzeichnung, wenn sie die gesamte Anwendung betrifft.',
        pt: 'O modal de novidades mostra agora o histórico completo da versão principal instalada — por exemplo, todas as versões 2.x — em espanhol ou inglês. Cada alteração histórica inclui ainda o ícone e a cor do respetivo espaço, ou o indicador geral quando afeta toda a aplicação.',
        'pt-BR': 'O modal de novidades agora mostra o histórico completo da versão principal instalada — por exemplo, todas as versões 2.x — em espanhol ou inglês. Cada mudança histórica inclui ainda o ícone e a cor do seu espaço, ou o indicador geral quando afeta todo o aplicativo.',
      },
    ],
  },
  {
    version: '2.3.5',
    date: '2026-07-16',
    highlights: [
      {
        scope: 'genealogy',
        es: 'Las ramas extensas ya no se mezclan: tíos, tías y sus parejas permanecen dentro del bloque paterno o materno que les corresponde, con la pareja de progenitores como frontera central y todas las generaciones centradas de forma coherente.',
        en: 'Extended branches no longer mix: uncles, aunts and their partners remain inside their corresponding paternal or maternal block, with the parental couple as the centre seam and every generation aligned consistently.',
        fr: 'Les branches étendues ne se mélangent plus : oncles, tantes et leurs partenaires restent à l\'intérieur du bloc paternel ou maternel qui leur correspond, le couple de parents faisant office de frontière centrale et toutes les générations étant centrées de façon cohérente.',
        de: 'Umfangreiche Zweige vermischen sich nicht mehr: Onkel, Tanten und ihre Partner bleiben innerhalb des jeweils zugehörigen väterlichen oder mütterlichen Blocks, wobei das Elternpaar als zentrale Grenze dient und alle Generationen einheitlich zentriert sind.',
        pt: 'Os ramos extensos deixam de se misturar: tios, tias e os seus cônjuges permanecem dentro do bloco paterno ou materno correspondente, com o casal de progenitores como fronteira central e todas as gerações centradas de forma coerente.',
        'pt-BR': 'Os ramos extensos não se misturam mais: tios, tias e seus parceiros permanecem dentro do bloco paterno ou materno correspondente, com o casal de genitores como fronteira central e todas as gerações centralizadas de forma coerente.',
      },
      {
        scope: 'genealogy',
        es: 'Las líneas horizontales del árbol se trazan únicamente por el espacio libre entre generaciones. Los nombres, las etiquetas de parentesco y las fechas cuentan además con un fondo protector para conservar siempre su legibilidad en modo claro y oscuro.',
        en: 'Horizontal tree lines are now routed exclusively through the free space between generations. Names, kinship labels and dates also have a protective background so they remain readable in both light and dark mode.',
        fr: 'Les lignes horizontales de l\'arbre ne passent désormais que par l\'espace libre entre les générations. Les noms, les étiquettes de lien de parenté et les dates disposent en outre d\'un fond protecteur pour toujours conserver leur lisibilité en mode clair et sombre.',
        de: 'Die horizontalen Linien des Stammbaums verlaufen jetzt ausschließlich durch den freien Raum zwischen den Generationen. Namen, Verwandtschaftsbezeichnungen und Daten verfügen zudem über einen schützenden Hintergrund, damit sie im hellen und dunklen Modus stets lesbar bleiben.',
        pt: 'As linhas horizontais da árvore passam a ser traçadas apenas pelo espaço livre entre gerações. Os nomes, as etiquetas de parentesco e as datas contam ainda com um fundo protetor para conservar sempre a sua legibilidade em modo claro e escuro.',
        'pt-BR': 'As linhas horizontais da árvore são traçadas somente pelo espaço livre entre gerações. Os nomes, as etiquetas de parentesco e as datas contam ainda com um fundo protetor para preservar sempre sua legibilidade no modo claro e escuro.',
      },
      {
        scope: 'genealogy',
        es: 'El árbol incorpora un buscador que localiza personas por nombre, fechas o etiqueta de parentesco, incluso sin escribir los acentos. Las coincidencias quedan iluminadas y el resto del árbol permanece visible de forma atenuada para conservar el contexto familiar.',
        en: 'The tree now includes search across names, dates and kinship labels, with accent-insensitive matching. Matches are highlighted while the rest of the tree stays visible in a dimmed state to preserve family context.',
        fr: 'L\'arbre intègre un moteur de recherche qui localise les personnes par nom, dates ou étiquette de lien de parenté, même sans saisir les accents. Les correspondances sont mises en surbrillance et le reste de l\'arbre reste visible de façon atténuée pour conserver le contexte familial.',
        de: 'Der Stammbaum verfügt jetzt über eine Suche, die Personen anhand von Name, Datum oder Verwandtschaftsbezeichnung findet, auch ohne Akzentzeichen einzugeben. Treffer werden hervorgehoben, während der Rest des Stammbaums abgeblendet sichtbar bleibt, um den familiären Kontext zu bewahren.',
        pt: 'A árvore incorpora um motor de pesquisa que localiza pessoas por nome, datas ou etiqueta de parentesco, mesmo sem escrever os acentos. As correspondências ficam realçadas e o resto da árvore permanece visível de forma esbatida para conservar o contexto familiar.',
        'pt-BR': 'A árvore incorpora um buscador que localiza pessoas por nome, datas ou etiqueta de parentesco, mesmo sem digitar os acentos. As correspondências ficam destacadas e o restante da árvore permanece visível de forma atenuada para preservar o contexto familiar.',
      },
    ],
  },
  {
    version: '2.3.4',
    date: '2026-07-16',
    highlights: [
      {
        scope: 'genealogy',
        es: 'El árbol separa correctamente las unidades familiares para que las líneas de los abuelos paternos y maternos no vuelvan a unirse por error. Las ramas paterna y materna usan azul y rojo por defecto, permiten elegir sus dos colores principales y distinguen las subramas mediante variaciones de intensidad.',
        en: 'The tree now keeps family units separate, preventing paternal and maternal grandparent lines from being joined incorrectly. Paternal and maternal branches use blue and red by default, let you choose their two main colours, and distinguish sub-branches through tonal variations.',
        fr: 'L\'arbre sépare désormais correctement les unités familiales afin que les lignes des grands-parents paternels et maternels ne se rejoignent plus par erreur. Les branches paternelle et maternelle utilisent le bleu et le rouge par défaut, permettent de choisir leurs deux couleurs principales et distinguent les sous-branches par des variations d\'intensité.',
        de: 'Der Stammbaum trennt Familieneinheiten jetzt korrekt, sodass sich die Linien der väterlichen und mütterlichen Großeltern nicht mehr versehentlich verbinden. Die väterliche und die mütterliche Linie verwenden standardmäßig Blau und Rot, lassen sich in ihren beiden Hauptfarben frei wählen und unterscheiden Unterzweige durch Intensitätsabstufungen.',
        pt: 'A árvore separa corretamente as unidades familiares para que as linhas dos avós paternos e maternos não voltem a unir-se por erro. Os ramos paterno e materno usam azul e vermelho por predefinição, permitem escolher as suas duas cores principais e distinguem os sub-ramos através de variações de intensidade.',
        'pt-BR': 'A árvore separa corretamente as unidades familiares para que as linhas dos avós paternos e maternos não voltem a se unir por engano. Os ramos paterno e materno usam azul e vermelho por padrão, permitem escolher suas duas cores principais e distinguem os sub-ramos por meio de variações de intensidade.',
      },
      {
        scope: 'genealogy',
        es: 'Cada persona muestra ahora una etiqueta de parentesco relativa a la persona protagonista del árbol: padres, hermanos, tíos, primos, sobrinos, abuelos, bisabuelos, tatarabuelos y sus equivalentes descendentes, entre otros. Las etiquetas se recalculan al cambiar el centro y también forman parte del contexto de Nodi y del asistente.',
        en: 'Every person now shows a kinship label relative to the tree’s focus person, including parents, siblings, uncles and aunts, cousins, nephews and nieces, grandparents, great-grandparents, great-great-grandparents and their descendant equivalents. Labels are recalculated when the focus changes and are also included in Nodi and assistant context.',
        fr: 'Chaque personne affiche désormais une étiquette de lien de parenté relative à la personne protagoniste de l\'arbre : parents, frères et sœurs, oncles et tantes, cousins, neveux et nièces, grands-parents, arrière-grands-parents, arrière-arrière-grands-parents et leurs équivalents descendants, entre autres. Les étiquettes sont recalculées lorsque le centre change et font également partie du contexte de Nodi et de l\'assistant.',
        de: 'Jede Person zeigt jetzt eine Verwandtschaftsbezeichnung relativ zur Bezugsperson des Stammbaums an: Eltern, Geschwister, Onkel und Tanten, Cousins und Cousinen, Neffen und Nichten, Großeltern, Urgroßeltern, Ururgroßeltern und ihre absteigenden Entsprechungen, unter anderem. Die Bezeichnungen werden beim Wechsel des Zentrums neu berechnet und sind auch Teil des Kontexts von Nodi und dem Assistenten.',
        pt: 'Cada pessoa mostra agora uma etiqueta de parentesco relativa à pessoa protagonista da árvore: pais, irmãos, tios, primos, sobrinhos, avós, bisavós, trisavós e os respetivos equivalentes descendentes, entre outros. As etiquetas são recalculadas ao mudar o centro e também fazem parte do contexto do Nodi e do assistente.',
        'pt-BR': 'Cada pessoa agora mostra uma etiqueta de parentesco relativa à pessoa protagonista da árvore: pais, irmãos, tios, primos, sobrinhos, avós, bisavós, trisavós e seus equivalentes descendentes, entre outros. As etiquetas são recalculadas ao mudar o centro e também fazem parte do contexto de Nodi e do assistente.',
      },
      {
        scope: 'genealogy',
        es: 'Las relaciones familiares y sociales comparten una interfaz más limpia: cada bloque conserva su listado y ofrece un único botón para abrir un modal de alta o edición. Los selectores tienen buscador, admiten varias personas y las relaciones sociales permiten elegir uno o varios tipos preconfigurados en una sola operación.',
        en: 'Family and social relations now share a cleaner interface: each section keeps its persistent list and provides one button that opens an add or edit modal. Selectors include search, support multiple people, and social relations let you choose one or more predefined types in a single operation.',
        fr: 'Les relations familiales et sociales partagent une interface plus épurée : chaque bloc conserve sa liste et propose un bouton unique pour ouvrir un modal d\'ajout ou de modification. Les sélecteurs disposent d\'une recherche, prennent en charge plusieurs personnes, et les relations sociales permettent de choisir un ou plusieurs types préconfigurés en une seule opération.',
        de: 'Familiäre und soziale Beziehungen teilen sich jetzt eine übersichtlichere Oberfläche: Jeder Block behält seine Liste bei und bietet eine einzige Schaltfläche zum Öffnen eines Modals zum Hinzufügen oder Bearbeiten. Die Auswahlfelder verfügen über eine Suche, unterstützen mehrere Personen, und bei sozialen Beziehungen lassen sich einer oder mehrere vorkonfigurierte Typen in einem einzigen Vorgang auswählen.',
        pt: 'As relações familiares e sociais partilham uma interface mais limpa: cada bloco conserva a sua listagem e oferece um único botão para abrir um modal de criação ou edição. Os seletores têm pesquisa, admitem várias pessoas e as relações sociais permitem escolher um ou vários tipos pré-configurados numa única operação.',
        'pt-BR': 'As relações familiares e sociais compartilham uma interface mais limpa: cada bloco mantém sua listagem e oferece um único botão para abrir um modal de inclusão ou edição. Os seletores têm buscador, admitem várias pessoas e as relações sociais permitem escolher um ou vários tipos pré-configurados em uma única operação.',
      },
      {
        scope: 'general',
        es: 'Se han pulido varios detalles de interfaz: la marca de Nodus conserva su margen al ocultar el sidebar, la primera persona del listado ya no queda tapada, los desplegables se muestran por encima de los modales sin solapar la lupa con el texto y el banner de apoyo evita duplicar el botón de PayPal.',
        en: 'Several interface details have been polished: the Nodus brand keeps its margin when the sidebar is hidden, the first person in the list is no longer clipped, dropdowns appear above modals without overlapping the search icon and text, and the support banner no longer duplicates the PayPal button.',
        fr: 'Plusieurs détails d\'interface ont été peaufinés : la marque Nodus conserve sa marge lorsque la barre latérale est masquée, la première personne de la liste n\'est plus masquée, les menus déroulants s\'affichent au-dessus des modales sans superposer la loupe au texte, et la bannière de soutien évite de dupliquer le bouton PayPal.',
        de: 'Mehrere Oberflächendetails wurden verfeinert: Das Nodus-Logo behält seinen Rand, wenn die Sidebar ausgeblendet wird, die erste Person der Liste wird nicht mehr verdeckt, Dropdown-Menüs erscheinen über den Modalen, ohne die Lupe mit dem Text zu überlappen, und das Unterstützungsbanner zeigt den PayPal-Button nicht mehr doppelt an.',
        pt: 'Foram aperfeiçoados vários pormenores de interface: a marca do Nodus conserva a sua margem ao ocultar a barra lateral, a primeira pessoa da lista deixa de ficar tapada, os menus suspensos mostram-se acima dos modais sem sobrepor a lupa ao texto e o banner de apoio evita duplicar o botão do PayPal.',
        'pt-BR': 'Vários detalhes de interface foram aprimorados: a marca do Nodus mantém sua margem ao ocultar a barra lateral, a primeira pessoa da listagem não fica mais encoberta, os menus suspensos aparecem acima dos modais sem sobrepor a lupa ao texto e o banner de apoio evita duplicar o botão do PayPal.',
      },
    ],
  },
  {
    version: '2.3.3',
    date: '2026-07-15',
    highlights: [
      {
        scope: 'genealogy',
        es: 'Las relaciones familiares se pueden crear desde la ficha de una persona o desde el propio árbol mediante un selector claro: progenitor, hijo o hija, hermano o hermana y pareja. Al añadir descendencia puedes indicar los dos progenitores conocidos o solamente uno.',
        en: 'Family relationships can now be created from a person dossier or directly from the tree with a clear selector: parent, child, sibling or partner. When adding a child, you can specify both known parents or just one.',
        fr: 'Les relations familiales peuvent désormais être créées depuis la fiche d\'une personne ou directement depuis l\'arbre grâce à un sélecteur clair : parent, fils ou fille, frère ou sœur et partenaire. Lors de l\'ajout d\'une descendance, vous pouvez indiquer les deux parents connus ou un seul.',
        de: 'Familiäre Beziehungen lassen sich jetzt aus dem Personendossier oder direkt aus dem Stammbaum über eine klare Auswahl erstellen: Elternteil, Sohn oder Tochter, Bruder oder Schwester und Partner. Beim Hinzufügen von Nachkommen können Sie beide bekannten Elternteile oder nur einen angeben.',
        pt: 'As relações familiares podem ser criadas a partir da ficha de uma pessoa ou da própria árvore através de um seletor claro: progenitor, filho ou filha, irmão ou irmã e parceiro/a. Ao adicionar descendência, pode indicar os dois progenitores conhecidos ou apenas um.',
        'pt-BR': 'As relações familiares podem ser criadas a partir da ficha de uma pessoa ou da própria árvore por meio de um seletor claro: genitor, filho ou filha, irmão ou irmã e parceiro(a). Ao adicionar descendência, você pode indicar os dois genitores conhecidos ou apenas um.',
      },
      {
        scope: 'genealogy',
        es: 'El panel derecho del árbol conserva todas las relaciones de la persona seleccionada para poder editarlas, invertirlas o eliminarlas. También avisa de fechas cronológicamente improbables sin bloquear los casos históricos que necesites documentar.',
        en: 'The tree sidebar now keeps every relationship for the selected person visible, so you can edit, reverse or delete it. It also warns about chronologically unlikely dates without blocking historical cases you need to document.',
        fr: 'Le panneau droit de l\'arbre conserve désormais toutes les relations de la personne sélectionnée afin de pouvoir les modifier, les inverser ou les supprimer. Il signale également les dates chronologiquement improbables sans bloquer les cas historiques que vous devez documenter.',
        de: 'Das rechte Panel des Stammbaums zeigt jetzt alle Beziehungen der ausgewählten Person an, damit Sie sie bearbeiten, umkehren oder löschen können. Es warnt außerdem vor chronologisch unwahrscheinlichen Daten, ohne historische Fälle zu blockieren, die Sie dokumentieren müssen.',
        pt: 'O painel direito da árvore conserva todas as relações da pessoa selecionada para as poder editar, inverter ou eliminar. Também avisa sobre datas cronologicamente improváveis sem bloquear os casos históricos que precise de documentar.',
        'pt-BR': 'O painel direito da árvore mantém todas as relações da pessoa selecionada para que você possa editá-las, invertê-las ou excluí-las. Também avisa sobre datas cronologicamente improváveis sem bloquear os casos históricos que você precisa documentar.',
      },
      {
        scope: 'genealogy',
        es: 'El árbol coloca por defecto a los antepasados arriba y permite invertir la orientación. Se han corregido la disposición y las líneas de progenitores, hijos, hermanos y parejas, manteniendo compatibles las relaciones que ya existían.',
        en: 'The tree now places ancestors at the top by default and can optionally reverse its orientation. Parent, child, sibling and partner layout and connectors have been corrected while keeping existing relationships compatible.',
        fr: 'L\'arbre place désormais les ancêtres en haut par défaut et permet d\'inverser l\'orientation. La disposition et les lignes des parents, enfants, frères et sœurs et partenaires ont été corrigées, tout en conservant la compatibilité avec les relations déjà existantes.',
        de: 'Der Stammbaum platziert Vorfahren standardmäßig oben und ermöglicht es, die Ausrichtung umzukehren. Anordnung und Verbindungslinien von Eltern, Kindern, Geschwistern und Partnern wurden korrigiert, wobei bereits bestehende Beziehungen kompatibel bleiben.',
        pt: 'A árvore coloca por predefinição os antepassados no topo e permite inverter a orientação. Foram corrigidas a disposição e as linhas de progenitores, filhos, irmãos e parceiros, mantendo compatíveis as relações já existentes.',
        'pt-BR': 'A árvore coloca por padrão os ancestrais na parte superior e permite inverter a orientação. Foram corrigidas a disposição e as linhas de genitores, filhos, irmãos e parceiros, mantendo compatíveis as relações já existentes.',
      },
      {
        scope: 'general',
        es: 'El modal de novedades identifica visualmente cada cambio: los cambios generales usan un icono neutro y los específicos de una bóveda muestran su color e icono correspondientes, tanto en modo claro como oscuro.',
        en: 'The What’s New modal now identifies every change visually: general changes use a neutral icon, while vault-specific changes show the corresponding colour and icon in both light and dark mode.',
        fr: 'Le modal des nouveautés identifie désormais visuellement chaque changement : les changements généraux utilisent une icône neutre et ceux spécifiques à un espace affichent leur couleur et leur icône correspondantes, en mode clair comme en mode sombre.',
        de: 'Das Neuigkeiten-Fenster kennzeichnet jetzt jede Änderung visuell: Allgemeine Änderungen verwenden ein neutrales Symbol, während arbeitsbereichsspezifische Änderungen die entsprechende Farbe und das entsprechende Symbol zeigen, sowohl im hellen als auch im dunklen Modus.',
        pt: 'O modal de novidades identifica visualmente cada alteração: as alterações gerais usam um ícone neutro e as específicas de um espaço mostram a sua cor e ícone correspondentes, tanto em modo claro como escuro.',
        'pt-BR': 'O modal de novidades identifica visualmente cada mudança: as mudanças gerais usam um ícone neutro e as específicas de um espaço mostram sua cor e ícone correspondentes, tanto no modo claro quanto no escuro.',
      },
    ],
  },
  {
    version: '2.3.2',
    date: '2026-07-15',
    highlights: [
      {
        scope: 'general',
        es: 'Se ha solucionado un error que impedía a Nodus leer algunas claves de API de IA ya guardadas y hacía que no aparecieran en Ajustes. Las claves no se habían borrado: Nodus las recupera de forma segura y vuelve a incluirlas en la copia protegida del workspace.',
        en: 'Fixed an issue that prevented Nodus from reading some previously saved AI API keys, making them disappear from Settings. The keys had not been deleted: Nodus recovers them safely and includes them again in the protected workspace backup.',
        fr: 'Un problème empêchant Nodus de lire certaines clés d\'API d\'IA déjà enregistrées, les faisant disparaître des Paramètres, a été corrigé. Les clés n\'avaient pas été supprimées : Nodus les récupère en toute sécurité et les réintègre dans la copie protégée de l\'espace de travail.',
        de: 'Ein Fehler wurde behoben, der Nodus daran hinderte, einige bereits gespeicherte KI-API-Schlüssel zu lesen, wodurch sie nicht mehr in den Einstellungen erschienen. Die Schlüssel waren nicht gelöscht worden: Nodus stellt sie jetzt sicher wieder her und nimmt sie erneut in die geschützte Sicherung des Workspace auf.',
        pt: 'Foi corrigido um erro que impedia o Nodus de ler algumas chaves de API de IA já guardadas e fazia com que não aparecessem em Definições. As chaves não tinham sido apagadas: o Nodus recupera-as de forma segura e volta a incluí-las na cópia protegida do espaço de trabalho.',
        'pt-BR': 'Foi corrigido um erro que impedia o Nodus de ler algumas chaves de API de IA já salvas e fazia com que não aparecessem em Configurações. As chaves não haviam sido apagadas: o Nodus as recupera com segurança e volta a incluí-las na cópia protegida do espaço de trabalho.',
      },
      {
        scope: 'general',
        es: 'Nodus vuelve a detectar el modelo con el que se creó el índice de cada workspace. Si tus embeddings se generaron, por ejemplo, con BGE-M3 mediante OpenRouter, ese modelo reaparece seleccionado sin borrar ni reindexar ningún vector.',
        en: 'Nodus now detects the model used to build each workspace index again. If your embeddings were generated, for example, with BGE-M3 through OpenRouter, that model is selected again without deleting or reindexing any vectors.',
        fr: 'Nodus détecte à nouveau le modèle avec lequel l\'index de chaque espace de travail a été créé. Si vos embeddings ont été générés, par exemple, avec BGE-M3 via OpenRouter, ce modèle réapparaît sélectionné sans supprimer ni réindexer aucun vecteur.',
        de: 'Nodus erkennt jetzt wieder das Modell, mit dem der Index jedes Workspace erstellt wurde. Wurden Ihre Embeddings beispielsweise mit BGE-M3 über OpenRouter erzeugt, erscheint dieses Modell wieder ausgewählt, ohne dass Vektoren gelöscht oder neu indexiert werden.',
        pt: 'O Nodus volta a detetar o modelo com que foi criado o índice de cada espaço de trabalho. Se os seus embeddings foram gerados, por exemplo, com o BGE-M3 através do OpenRouter, esse modelo reaparece selecionado sem apagar nem reindexar qualquer vetor.',
        'pt-BR': 'O Nodus volta a detectar o modelo com o qual foi criado o índice de cada espaço de trabalho. Se seus embeddings foram gerados, por exemplo, com BGE-M3 via OpenRouter, esse modelo reaparece selecionado sem apagar nem reindexar nenhum vetor.',
      },
      {
        scope: 'general',
        es: 'También se recuperan los modelos destacados y las selecciones por tarea conservadas antes de la migración. El modo básico o avanzado y el modelo de embeddings vuelven a pertenecer a cada workspace, evitando que uno sobrescriba la configuración de otro.',
        en: 'Favorite models and per-task selections preserved before the migration are recovered too. Basic or advanced mode and the embedding model belong to each workspace again, preventing one workspace from overwriting another.',
        fr: 'Les modèles favoris et les sélections par tâche conservées avant la migration sont également récupérés. Le mode basique ou avancé et le modèle d\'embeddings appartiennent à nouveau à chaque espace de travail, évitant qu\'un espace n\'écrase la configuration d\'un autre.',
        de: 'Auch die vor der Migration gespeicherten bevorzugten Modelle und aufgabenbezogenen Auswahlen werden wiederhergestellt. Der einfache oder erweiterte Modus sowie das Embedding-Modell gehören wieder zu jedem Workspace, sodass keiner die Konfiguration eines anderen überschreibt.',
        pt: 'Também são recuperados os modelos destacados e as seleções por tarefa conservadas antes da migração. O modo básico ou avançado e o modelo de embeddings voltam a pertencer a cada espaço de trabalho, evitando que um substitua a configuração de outro.',
        'pt-BR': 'Também são recuperados os modelos favoritos e as seleções por tarefa preservadas antes da migração. O modo básico ou avançado e o modelo de embeddings voltam a pertencer a cada espaço de trabalho, evitando que um sobrescreva a configuração de outro.',
      },
    ],
  },
  {
    version: '2.3.1',
    date: '2026-07-15',
    highlights: [
      {
        scope: 'general',
        es: 'Se ha solucionado un error que impedía a Nodus leer algunas claves de API de IA ya guardadas y hacía que no aparecieran en Ajustes. Las claves no se habían borrado: esta versión las recupera de forma segura, conserva sus copias cifradas anteriores y vuelve a incluirlas en la copia protegida del workspace.',
        en: 'Fixed an issue that prevented Nodus from reading some previously saved AI API keys, making them disappear from Settings. The keys had not been deleted: this version recovers them safely, preserves their previous encrypted copies and includes them again in the protected workspace backup.',
        fr: 'Un problème empêchant Nodus de lire certaines clés d\'API d\'IA déjà enregistrées, les faisant disparaître des Paramètres, a été corrigé. Les clés n\'avaient pas été supprimées : cette version les récupère en toute sécurité, conserve leurs copies chiffrées antérieures et les réintègre dans la copie protégée de l\'espace de travail.',
        de: 'Ein Fehler wurde behoben, der Nodus daran hinderte, einige bereits gespeicherte KI-API-Schlüssel zu lesen, wodurch sie nicht mehr in den Einstellungen erschienen. Die Schlüssel waren nicht gelöscht worden: Diese Version stellt sie sicher wieder her, behält ihre bisherigen verschlüsselten Kopien bei und nimmt sie erneut in die geschützte Sicherung des Workspace auf.',
        pt: 'Foi corrigido um erro que impedia o Nodus de ler algumas chaves de API de IA já guardadas e fazia com que não aparecessem em Definições. As chaves não tinham sido apagadas: esta versão recupera-as de forma segura, conserva as suas cópias cifradas anteriores e volta a incluí-las na cópia protegida do espaço de trabalho.',
        'pt-BR': 'Foi corrigido um erro que impedia o Nodus de ler algumas chaves de API de IA já salvas e fazia com que não aparecessem em Configurações. As chaves não haviam sido apagadas: esta versão as recupera com segurança, preserva suas cópias criptografadas anteriores e volta a incluí-las na cópia protegida do espaço de trabalho.',
      },
      {
        scope: 'general',
        es: 'En macOS puede aparecer una solicitud del Llavero durante la recuperación. Comprueba que corresponde a Nodus y selecciona «Permitir siempre»; si la cerraste, puedes repetir la recuperación desde Ajustes → Proveedores.',
        en: 'On macOS, Keychain may ask for permission during recovery. Check that the request belongs to Nodus and choose “Always Allow”; if you dismissed it, retry from Settings → Providers.',
        fr: 'Sur macOS, une demande du Trousseau peut apparaître pendant la récupération. Vérifiez qu\'elle provient bien de Nodus et sélectionnez «Toujours autoriser» ; si vous l\'avez fermée, vous pouvez relancer la récupération depuis Paramètres → Fournisseurs.',
        de: 'Unter macOS kann während der Wiederherstellung eine Anfrage des Schlüsselbunds erscheinen. Prüfen Sie, dass sie von Nodus stammt, und wählen Sie „Immer erlauben“; falls Sie sie geschlossen haben, können Sie die Wiederherstellung über Einstellungen → Anbieter wiederholen.',
        pt: 'No macOS pode surgir um pedido do Acesso às Chaves durante a recuperação. Verifique que corresponde ao Nodus e selecione «Permitir sempre»; se o fechou, pode repetir a recuperação a partir de Definições → Fornecedores.',
        'pt-BR': 'No macOS, pode aparecer uma solicitação do Chaveiro durante a recuperação. Confira se ela corresponde ao Nodus e selecione “Sempre permitir”; se você a fechou, pode repetir a recuperação em Configurações → Provedores.',
      },
    ],
  },
  {
    version: '2.3.0',
    date: '2026-07-15',
    highlights: [
      {
        scope: 'estudio',
        es: 'El vault de estudio da un gran salto: cursos y asignaturas, carpetas y apuntes, materiales anotables, grabaciones con transcripción, horario, calendario, banco de preguntas, tests, tarjetas, repasos, progreso, grafo de conocimiento y chat fundamentado en tus fuentes.',
        en: 'Study vault takes a major leap forward: courses and subjects, folders and notes, annotatable materials, recordings with transcripts, timetable, calendar, question bank, tests, flashcards, reviews, progress, a knowledge graph and source-grounded chat.',
        fr: 'L\'espace Étude franchit une étape majeure : cours et matières, dossiers et notes, matériaux annotables, enregistrements avec transcription, emploi du temps, calendrier, banque de questions, tests, flashcards, révisions, progression, graphe de connaissances et chat fondé sur vos sources.',
        de: 'Der Studium-Arbeitsbereich macht einen großen Sprung nach vorn: Kurse und Fächer, Ordner und Notizen, kommentierbare Materialien, Aufnahmen mit Transkription, Stundenplan, Kalender, Fragenbank, Tests, Flashcards, Wiederholungen, Fortschritt, Wissensgraph und ein auf Ihren Quellen basierender Chat.',
        pt: 'O espaço de estudo dá um grande salto: cursos e disciplinas, pastas e notas, materiais anotáveis, gravações com transcrição, horário, calendário, banco de perguntas, testes, flashcards, revisões, progresso, grafo de conhecimento e chat fundamentado nas suas fontes.',
        'pt-BR': 'O espaço de estudo dá um grande salto: cursos e disciplinas, pastas e notas, materiais anotáveis, gravações com transcrição, horário, calendário, banco de questões, testes, flashcards, revisões, progresso, grafo de conhecimento e chat fundamentado em suas fontes.',
      },
      {
        scope: 'estudio',
        es: 'Zotero se integra más a fondo: las bóvedas pueden usar bibliotecas de grupo y, desde cursos o materiales, buscar un elemento y decidir si importar su adjunto a Nodus o mantener un enlace que lo abra en Zotero.',
        en: 'Zotero integration goes deeper: vaults can use group libraries and, from courses or materials, search for an item and choose whether to import its attachment into Nodus or keep a link that opens it in Zotero.',
        fr: 'L\'intégration de Zotero va plus loin : les espaces peuvent utiliser des bibliothèques de groupe et, depuis les cours ou les matériaux, rechercher un élément et choisir d\'importer sa pièce jointe dans Nodus ou de conserver un lien qui l\'ouvre dans Zotero.',
        de: 'Die Zotero-Integration geht tiefer: Arbeitsbereiche können jetzt Gruppenbibliotheken nutzen und aus Kursen oder Materialien heraus ein Element suchen und entscheiden, ob dessen Anhang in Nodus importiert oder ein Link beibehalten wird, der es in Zotero öffnet.',
        pt: 'A integração com o Zotero aprofunda-se: os espaços podem usar bibliotecas de grupo e, a partir de cursos ou materiais, procurar um elemento e decidir se importam o seu anexo para o Nodus ou se mantêm uma ligação que o abre no Zotero.',
        'pt-BR': 'O Zotero se integra mais a fundo: os espaços podem usar bibliotecas de grupo e, a partir de cursos ou materiais, buscar um item e decidir se importam seu anexo para o Nodus ou mantêm um link que o abra no Zotero.',
      },
      {
        scope: 'general',
        es: 'Groq y Cerebras se incorporan como proveedores de IA, con carga de modelos cuando el proveedor la permite. La configuración básica y avanzada ahora avisa antes de cambiar de modo para evitar dejar modelos sin configurar por accidente.',
        en: 'Groq and Cerebras join the AI providers, with model discovery whenever the provider supports it. Basic and advanced setup now asks for confirmation before switching modes, preventing accidental incomplete model configurations.',
        fr: 'Groq et Cerebras rejoignent les fournisseurs d\'IA, avec chargement des modèles lorsque le fournisseur le permet. La configuration basique et avancée avertit désormais avant de changer de mode, afin d\'éviter de laisser des modèles non configurés par accident.',
        de: 'Groq und Cerebras kommen als KI-Anbieter hinzu, mit Modell-Ladefunktion, sofern der Anbieter dies unterstützt. Die einfache und erweiterte Konfiguration warnt jetzt vor dem Wechsel des Modus, um zu verhindern, dass versehentlich Modelle unkonfiguriert bleiben.',
        pt: 'O Groq e o Cerebras juntam-se aos fornecedores de IA, com carregamento de modelos quando o fornecedor o permite. A configuração básica e avançada avisa agora antes de mudar de modo, para evitar deixar modelos por configurar por acidente.',
        'pt-BR': 'Groq e Cerebras passam a ser provedores de IA, com carregamento de modelos quando o provedor permite. A configuração básica e avançada agora avisa antes de mudar de modo para evitar deixar modelos sem configurar por acidente.',
      },
      {
        scope: 'general',
        es: 'Los modelos locales son más sencillos de usar: puedes descargar, seleccionar y eliminar modelos integrados para distintas tareas y, si uno necesita un motor previo, Nodus lo instala automáticamente antes de iniciar la descarga.',
        en: 'Local models are easier to use: download, select and remove integrated models for different tasks, and when a model requires an engine first, Nodus installs it automatically before starting the download.',
        fr: 'Les modèles locaux sont plus simples à utiliser : vous pouvez télécharger, sélectionner et supprimer des modèles intégrés pour différentes tâches et, si l\'un d\'eux nécessite un moteur préalable, Nodus l\'installe automatiquement avant de démarrer le téléchargement.',
        de: 'Lokale Modelle sind jetzt einfacher zu nutzen: Sie können integrierte Modelle für verschiedene Aufgaben herunterladen, auswählen und entfernen. Benötigt ein Modell zuvor eine Engine, installiert Nodus diese automatisch, bevor der Download beginnt.',
        pt: 'Os modelos locais são mais simples de usar: pode transferir, selecionar e eliminar modelos integrados para diferentes tarefas e, se um precisar de um motor prévio, o Nodus instala-o automaticamente antes de iniciar a transferência.',
        'pt-BR': 'Os modelos locais ficaram mais fáceis de usar: você pode baixar, selecionar e excluir modelos integrados para diferentes tarefas e, se um deles precisar de um mecanismo prévio, o Nodus o instala automaticamente antes de iniciar o download.',
      },
      {
        scope: 'general',
        es: 'Nueva guía esencial cinematográfica protagonizada por Nodi para entender bóvedas, proveedores, modelos, embeddings y voz. Nodi se presenta al final, permanece más tranquilo durante el recorrido y no se superpone con su versión real.',
        en: 'A new cinematic essential guide starring Nodi explains vaults, providers, models, embeddings and speech. Nodi is introduced at the end, stays calmer throughout the tour and no longer overlaps with the live companion.',
        fr: 'Nouveau guide essentiel cinématographique mettant en vedette Nodi pour comprendre les espaces, les fournisseurs, les modèles, les embeddings et la voix. Nodi se présente à la fin, reste plus calme pendant la visite et ne se superpose plus à sa version réelle.',
        de: 'Neuer filmreifer Einführungsguide mit Nodi in der Hauptrolle, um Arbeitsbereiche, Anbieter, Modelle, Embeddings und Sprache zu verstehen. Nodi stellt sich am Ende vor, bleibt während der Tour ruhiger und überlagert sich nicht mehr mit seiner echten Version.',
        pt: 'Novo guia essencial cinematográfico protagonizado pelo Nodi para compreender espaços, fornecedores, modelos, embeddings e voz. O Nodi apresenta-se no final, permanece mais tranquilo ao longo do percurso e não se sobrepõe à sua versão real.',
        'pt-BR': 'Novo guia essencial cinematográfico estrelado por Nodi para entender espaços, provedores, modelos, embeddings e voz. Nodi se apresenta no final, permanece mais tranquilo durante o percurso e não se sobrepõe à sua versão real.',
      },
      {
        scope: 'general',
        es: 'Nuevo sistema de recuperación total: Nodus protege automáticamente todas tus bóvedas, documentos, ajustes, historiales, archivos y claves en snapshots cifrados dentro de una carpeta segura. Incluye clave de recuperación y un asistente de migración para instalaciones anteriores, compatible con carpetas sincronizadas por Google Drive, Dropbox, iCloud y servicios similares.',
        en: 'A new complete recovery system automatically protects every vault, document, setting, history, file and key in encrypted snapshots inside a safe folder. It includes a recovery key and a migration assistant for previous installations, compatible with folders synchronized by Google Drive, Dropbox, iCloud and similar services.',
        fr: 'Nouveau système de récupération totale : Nodus protège automatiquement tous vos espaces, documents, paramètres, historiques, fichiers et clés dans des snapshots chiffrés au sein d\'un dossier sécurisé. Il inclut une clé de récupération et un assistant de migration pour les installations antérieures, compatible avec les dossiers synchronisés par Google Drive, Dropbox, iCloud et services similaires.',
        de: 'Neues System zur vollständigen Wiederherstellung: Nodus schützt automatisch alle Ihre Arbeitsbereiche, Dokumente, Einstellungen, Verläufe, Dateien und Schlüssel in verschlüsselten Snapshots innerhalb eines sicheren Ordners. Es enthält einen Wiederherstellungsschlüssel und einen Migrationsassistenten für frühere Installationen, kompatibel mit Ordnern, die über Google Drive, Dropbox, iCloud und ähnliche Dienste synchronisiert werden.',
        pt: 'Novo sistema de recuperação total: o Nodus protege automaticamente todos os seus espaços, documentos, definições, históricos, ficheiros e chaves em snapshots cifrados dentro de uma pasta segura. Inclui uma chave de recuperação e um assistente de migração para instalações anteriores, compatível com pastas sincronizadas por Google Drive, Dropbox, iCloud e serviços semelhantes.',
        'pt-BR': 'Novo sistema de recuperação total: o Nodus protege automaticamente todos os seus espaços, documentos, configurações, históricos, arquivos e chaves em snapshots criptografados dentro de uma pasta segura. Inclui chave de recuperação e um assistente de migração para instalações anteriores, compatível com pastas sincronizadas por Google Drive, Dropbox, iCloud e serviços similares.',
      },
      {
        scope: 'general',
        es: 'Las demos de los modos Académico, Genealogía, Bases de datos y Estudio se han ampliado para que ninguna sección empiece vacía: incluyen carpetas, notas, materiales, conversaciones, informes y ejemplos conectados que puedes explorar y eliminar después.',
        en: 'The Academic, Genealogy, Databases and Study demos have been expanded so no section starts empty: they include folders, notes, materials, conversations, reports and connected examples that you can explore and remove afterwards.',
        fr: 'Les démos des modes Académique, Généalogie, Bases de données et Étude ont été enrichies pour qu\'aucune section ne commence vide : elles incluent des dossiers, des notes, des matériaux, des conversations, des rapports et des exemples reliés que vous pouvez explorer puis supprimer.',
        de: 'Die Demos der Modi Akademisch, Genealogie, Datenbanken und Studium wurden erweitert, sodass kein Bereich mehr leer beginnt: Sie enthalten Ordner, Notizen, Materialien, Unterhaltungen, Berichte und verknüpfte Beispiele, die Sie erkunden und anschließend löschen können.',
        pt: 'As demonstrações dos modos Académico, Genealogia, Bases de dados e Estudo foram ampliadas para que nenhuma secção comece vazia: incluem pastas, notas, materiais, conversas, relatórios e exemplos ligados entre si que pode explorar e eliminar depois.',
        'pt-BR': 'As demos dos modos Acadêmico, Genealogia, Bases de dados e Estudo foram ampliadas para que nenhuma seção comece vazia: incluem pastas, notas, materiais, conversas, relatórios e exemplos conectados que você pode explorar e excluir depois.',
      },
      {
        scope: 'nodi',
        es: 'Nodi cierra correctamente su menú, chat y paneles al hacer clic fuera. También mejoran la experiencia flotante, las animaciones del tutorial y el comportamiento del icono de la app, que conserva el aspecto de la bóveda y el tema activos al cerrar.',
        en: 'Nodi now closes its menu, chat and panels correctly when you click elsewhere. The floating experience and tutorial animations are improved too, and the app icon now keeps the active vault and theme appearance after quitting.',
        fr: 'Nodi ferme désormais correctement son menu, son chat et ses panneaux lors d\'un clic à l\'extérieur. L\'expérience flottante, les animations du tutoriel et le comportement de l\'icône de l\'application s\'améliorent également : elle conserve l\'apparence de l\'espace et du thème actifs à la fermeture.',
        de: 'Nodi schließt jetzt sein Menü, den Chat und die Panels korrekt bei einem Klick außerhalb. Auch die schwebende Darstellung, die Tutorial-Animationen und das Verhalten des App-Symbols wurden verbessert: Es behält beim Beenden das Erscheinungsbild des aktiven Arbeitsbereichs und Themas bei.',
        pt: 'O Nodi fecha corretamente o seu menu, chat e painéis ao clicar fora. Também melhoram a experiência flutuante, as animações do tutorial e o comportamento do ícone da aplicação, que conserva o aspeto do espaço e do tema ativos ao fechar.',
        'pt-BR': 'Nodi agora fecha corretamente seu menu, chat e painéis ao clicar fora. Também melhoram a experiência flutuante, as animações do tutorial e o comportamento do ícone do app, que mantém a aparência do espaço e do tema ativos ao fechar.',
      },
      {
        scope: 'general',
        es: 'La navegación lateral se siente más consistente: la marca de Nodus permanece centrada al redimensionar el menú y toda su cabecera permite mostrarlo u ocultarlo.',
        en: 'Sidebar navigation now feels more consistent: the Nodus brand stays centered as the menu is resized, and its entire header can show or hide it.',
        fr: 'La navigation latérale paraît plus cohérente : la marque Nodus reste centrée lors du redimensionnement du menu et l\'ensemble de son en-tête permet de l\'afficher ou de le masquer.',
        de: 'Die seitliche Navigation wirkt jetzt einheitlicher: Das Nodus-Logo bleibt beim Ändern der Menügröße zentriert, und der gesamte Kopfbereich lässt sich zum Ein- oder Ausblenden nutzen.',
        pt: 'A navegação lateral torna-se mais consistente: a marca do Nodus permanece centrada ao redimensionar o menu e todo o seu cabeçalho permite mostrá-lo ou ocultá-lo.',
        'pt-BR': 'A navegação lateral parece mais consistente: a marca do Nodus permanece centralizada ao redimensionar o menu e todo o seu cabeçalho permite exibi-lo ou ocultá-lo.',
      },
      {
        scope: 'general',
        es: 'El panel de novedades estrena una presentación cinematográfica con Nodi celebrando, versiones y cambios claramente visibles en modo claro y oscuro, además de una sección opcional para apoyar el proyecto open source mediante PayPal.',
        en: 'The What’s New panel now has a cinematic presentation with Nodi celebrating, versions and changes clearly visible in light and dark mode, plus an optional section to support the open-source project through PayPal.',
        fr: 'Le panneau des nouveautés inaugure une présentation cinématographique avec Nodi qui célèbre, des versions et des changements clairement visibles en mode clair et sombre, ainsi qu\'une section optionnelle pour soutenir le projet open source via PayPal.',
        de: 'Das Neuigkeiten-Panel erhält eine filmreife Präsentation mit einem feiernden Nodi, Versionen und Änderungen, die im hellen und dunklen Modus deutlich sichtbar sind, sowie einen optionalen Bereich zur Unterstützung des Open-Source-Projekts über PayPal.',
        pt: 'O painel de novidades estreia uma apresentação cinematográfica com o Nodi a festejar, versões e alterações claramente visíveis em modo claro e escuro, além de uma secção opcional para apoiar o projeto open source através do PayPal.',
        'pt-BR': 'O painel de novidades estreia uma apresentação cinematográfica com Nodi comemorando, versões e mudanças claramente visíveis no modo claro e escuro, além de uma seção opcional para apoiar o projeto open source por meio do PayPal.',
      },
    ],
  },
  {
    version: '2.2.0',
    date: '2026-07-13',
    highlights: [
      {
        scope: 'nodi',
        es: 'Te presentamos a Nodi, la nueva mascota de Nodus: un nodo de luz que te acompaña flotando abajo a la derecha. Puedes arrastrarlo por la ventana y activarlo o desactivarlo desde Ajustes → Interfaz.',
        en: 'Meet Nodi, Nodus’s new mascot: a little node of light that keeps you company, floating at the bottom right. Drag it around the window, and switch it on or off in Settings → Interface.',
        fr: 'Nous vous présentons Nodi, la nouvelle mascotte de Nodus : un nœud de lumière qui vous accompagne en flottant en bas à droite. Vous pouvez le faire glisser dans la fenêtre et l\'activer ou le désactiver depuis Paramètres → Interface.',
        de: 'Wir stellen Ihnen Nodi vor, das neue Maskottchen von Nodus: ein Lichtknoten, der Sie schwebend unten rechts begleitet. Sie können es im Fenster verschieben und in Einstellungen → Oberfläche ein- oder ausschalten.',
        pt: 'Apresentamos-lhe o Nodi, a nova mascote do Nodus: um nó de luz que o acompanha flutuando em baixo à direita. Pode arrastá-lo pela janela e ativá-lo ou desativá-lo em Definições → Interface.',
        'pt-BR': 'Apresentamos o Nodi, a nova mascote do Nodus: um nó de luz que acompanha você flutuando no canto inferior direito. Você pode arrastá-lo pela janela e ativá-lo ou desativá-lo em Configurações → Interface.',
      },
      {
        scope: 'nodi',
        es: 'Haz clic en Nodi para abrir su menú: un chat con la IA que conoce Nodus y tu configuración, un centro de notificaciones (te avisa con un punto rojo y levantando la mano) y una ayuda rápida. Además, Nodi cambia de traje según el modo de la bóveda (académico, genealogía, bases de datos), algo que puedes desactivar si prefieres el Nodi de siempre.',
        en: 'Click Nodi to open its menu: a chat with an AI that knows Nodus and your setup, a notification center (it flags unread items with a red dot and a raised hand) and quick help. Nodi even changes outfit to match the vault mode (academic, genealogy, databases) — which you can turn off if you prefer the plain Nodi.',
        fr: 'Cliquez sur Nodi pour ouvrir son menu : un chat avec l\'IA qui connaît Nodus et votre configuration, un centre de notifications (il vous prévient avec un point rouge et en levant la main) et une aide rapide. De plus, Nodi change de tenue selon le mode de l\'espace (académique, généalogie, bases de données), ce que vous pouvez désactiver si vous préférez le Nodi habituel.',
        de: 'Klicken Sie auf Nodi, um sein Menü zu öffnen: einen Chat mit der KI, die Nodus und Ihre Konfiguration kennt, ein Benachrichtigungszentrum (es macht mit einem roten Punkt und einer erhobenen Hand auf sich aufmerksam) und eine Kurzhilfe. Außerdem wechselt Nodi je nach Modus des Arbeitsbereichs (Akademisch, Genealogie, Datenbanken) sein Outfit – das können Sie deaktivieren, wenn Sie den klassischen Nodi bevorzugen.',
        pt: 'Clique no Nodi para abrir o seu menu: um chat com a IA que conhece o Nodus e a sua configuração, um centro de notificações (avisa-o com um ponto vermelho e levantando a mão) e uma ajuda rápida. Além disso, o Nodi muda de traje consoante o modo do espaço (académico, genealogia, bases de dados), algo que pode desativar se preferir o Nodi de sempre.',
        'pt-BR': 'Clique em Nodi para abrir seu menu: um chat com a IA que conhece o Nodus e sua configuração, uma central de notificações (ele avisa com um ponto vermelho e levantando a mão) e uma ajuda rápida. Além disso, Nodi troca de traje conforme o modo do espaço (acadêmico, genealogia, bases de dados), algo que você pode desativar se preferir o Nodi de sempre.',
      },
      {
        scope: 'nodi',
        es: 'Si quieres, Nodi puede vivir en una pequeña ventana flotante del escritorio, siempre por encima del resto de aplicaciones —incluso a pantalla completa—, para tenerlo a mano sin cambiar de app.',
        en: 'If you like, Nodi can live in a small floating desktop window, always on top of your other apps — even in fullscreen — so it’s always within reach without switching apps.',
        fr: 'Si vous le souhaitez, Nodi peut vivre dans une petite fenêtre flottante du bureau, toujours au-dessus des autres applications — même en plein écran — pour l\'avoir à portée de main sans changer d\'application.',
        de: 'Wenn Sie möchten, kann Nodi in einem kleinen schwebenden Desktop-Fenster leben, immer über allen anderen Anwendungen – sogar im Vollbildmodus –, sodass es stets griffbereit ist, ohne die App zu wechseln.',
        pt: 'Se quiser, o Nodi pode viver numa pequena janela flutuante do ambiente de trabalho, sempre por cima das restantes aplicações — mesmo em ecrã inteiro —, para o ter à mão sem mudar de aplicação.',
        'pt-BR': 'Se você quiser, Nodi pode viver em uma pequena janela flutuante da área de trabalho, sempre acima das demais aplicações — mesmo em tela cheia —, para tê-lo à mão sem trocar de app.',
      },
    ],
  },
  {
    version: '2.1.1',
    date: '2026-07-13',
    highlights: [
      {
        scope: 'general',
        es: 'Los modelos que eliges para cada proveedor y para cada tarea de IA ahora se comparten entre todas tus bóvedas, igual que ya ocurría con las claves de API. Configúralos una vez y estarán listos en cualquier bóveda.',
        en: 'The models you pick for each provider and for each AI task are now shared across all your vaults, just like your API keys already were. Set them up once and they’re ready in every vault.',
        fr: 'Les modèles que vous choisissez pour chaque fournisseur et pour chaque tâche d\'IA sont désormais partagés entre tous vos espaces, comme c\'était déjà le cas pour les clés d\'API. Configurez-les une fois et ils seront prêts dans n\'importe quel espace.',
        de: 'Die Modelle, die Sie für jeden Anbieter und jede KI-Aufgabe wählen, werden jetzt zwischen allen Ihren Arbeitsbereichen geteilt, genau wie es bereits bei den API-Schlüsseln der Fall war. Konfigurieren Sie sie einmal, und sie stehen in jedem Arbeitsbereich bereit.',
        pt: 'Os modelos que escolhe para cada fornecedor e para cada tarefa de IA passam agora a ser partilhados entre todos os seus espaços, tal como já acontecia com as chaves de API. Configure-os uma vez e estarão prontos em qualquer espaço.',
        'pt-BR': 'Os modelos que você escolhe para cada provedor e para cada tarefa de IA agora são compartilhados entre todos os seus espaços, assim como já acontecia com as chaves de API. Configure-os uma vez e eles estarão prontos em qualquer espaço.',
      },
      {
        scope: 'general',
        es: 'Como las bóvedas comparten claves y modelos, hemos retirado el aviso de «cargar claves de API desde otra bóveda»: ya no hacía falta.',
        en: 'Since vaults share keys and models, we removed the “load API keys from another vault” prompt — it was no longer needed.',
        fr: 'Les espaces partageant désormais les clés et les modèles, nous avons retiré l\'avertissement «charger les clés d\'API depuis un autre espace» : il n\'était plus nécessaire.',
        de: 'Da Arbeitsbereiche jetzt Schlüssel und Modelle gemeinsam nutzen, haben wir den Hinweis „API-Schlüssel aus einem anderen Arbeitsbereich laden“ entfernt: Er war nicht mehr nötig.',
        pt: 'Como os espaços partilham chaves e modelos, retirámos o aviso de «carregar chaves de API de outro espaço»: já não era necessário.',
        'pt-BR': 'Como os espaços compartilham chaves e modelos, retiramos o aviso de “carregar chaves de API de outro espaço”: já não era mais necessário.',
      },
    ],
  },
  {
    version: '2.1.0',
    date: '2026-07-13',
    highlights: [
      {
        scope: 'databases',
        es: 'Nodus estrena el modo Bases de datos: un gestor de bases de datos al estilo Notion dentro de tu bóveda. Crea tablas con columnas de muchos tipos (texto, número, selección, fecha, relación, rollup, imagen…), organiza los datos en varias vistas con filtros y ordenaciones, y edítalo todo directamente en la cuadrícula. Importa y exporta en CSV cuando lo necesites.',
        en: 'Nodus introduces Databases mode: a Notion-style database manager inside your vault. Build tables with many column types (text, number, select, date, relation, rollup, image…), organize data across several views with filters and sorting, and edit everything right in the grid. Import and export CSV whenever you need it.',
        fr: 'Nodus inaugure le mode Bases de données : un gestionnaire de bases de données façon Notion au sein de votre espace. Créez des tableaux avec des colonnes de nombreux types (texte, nombre, sélection, date, relation, rollup, image…), organisez les données dans plusieurs vues avec filtres et tris, et modifiez tout directement dans la grille. Importez et exportez en CSV quand vous en avez besoin.',
        de: 'Nodus führt den Modus Datenbanken ein: einen Datenbankmanager im Notion-Stil innerhalb Ihres Arbeitsbereichs. Erstellen Sie Tabellen mit Spalten vieler Typen (Text, Zahl, Auswahl, Datum, Relation, Rollup, Bild…), organisieren Sie die Daten in mehreren Ansichten mit Filtern und Sortierungen und bearbeiten Sie alles direkt im Raster. Importieren und exportieren Sie CSV, wann immer Sie es brauchen.',
        pt: 'O Nodus estreia o modo Bases de dados: um gestor de bases de dados ao estilo Notion dentro do seu espaço. Crie tabelas com colunas de muitos tipos (texto, número, seleção, data, relação, rollup, imagem…), organize os dados em várias vistas com filtros e ordenações, e edite tudo diretamente na grelha. Importe e exporte em CSV sempre que precisar.',
        'pt-BR': 'O Nodus estreia o modo Bases de dados: um gerenciador de bases de dados no estilo Notion dentro do seu espaço. Crie tabelas com colunas de muitos tipos (texto, número, seleção, data, relação, rollup, imagem…), organize os dados em várias visualizações com filtros e ordenações, e edite tudo diretamente na grade. Importe e exporte em CSV quando precisar.',
      },
      {
        scope: 'databases',
        es: 'Columnas con IA: deja que la IA rellene una columna entera a partir del resto de la fila, ya sea con texto (resúmenes, clasificaciones, traducciones) o con imágenes generadas. Y un chat integrado responde preguntas sobre los datos de tu tabla.',
        en: 'AI columns: let the AI fill an entire column from the rest of the row — either with text (summaries, classifications, translations) or with generated images. And a built-in chat answers questions about your table’s data.',
        fr: 'Colonnes avec IA : laissez l\'IA remplir une colonne entière à partir du reste de la ligne, que ce soit avec du texte (résumés, classifications, traductions) ou des images générées. Et un chat intégré répond aux questions sur les données de votre tableau.',
        de: 'Spalten mit KI: Lassen Sie die KI eine ganze Spalte anhand des Rests der Zeile ausfüllen, sei es mit Text (Zusammenfassungen, Klassifizierungen, Übersetzungen) oder mit generierten Bildern. Und ein integrierter Chat beantwortet Fragen zu den Daten Ihrer Tabelle.',
        pt: 'Colunas com IA: deixe que a IA preencha uma coluna inteira a partir do resto da linha, seja com texto (resumos, classificações, traduções) ou com imagens geradas. E um chat integrado responde a perguntas sobre os dados da sua tabela.',
        'pt-BR': 'Colunas com IA: deixe a IA preencher uma coluna inteira a partir do restante da linha, seja com texto (resumos, classificações, traduções) ou com imagens geradas. E um chat integrado responde perguntas sobre os dados da sua tabela.',
      },
      {
        scope: 'databases',
        es: 'Análisis estadístico honesto: la IA propone los análisis adecuados sobre tus columnas reales (correlaciones, chi-cuadrado, ANOVA, regresión) y la app los calcula de forma determinista, con gráficos nativos —mapas de calor, dispersión y diagramas de caja—. La IA planifica; el motor calcula, sin inventar cifras.',
        en: 'Honest statistical analysis: the AI proposes the right analyses over your real columns (correlations, chi-square, ANOVA, regression) and the app computes them deterministically, with native charts — heatmaps, scatter plots and box plots. The AI plans; the engine computes, with no made-up numbers.',
        fr: 'Analyse statistique honnête : l\'IA propose les analyses adaptées à vos colonnes réelles (corrélations, chi carré, ANOVA, régression) et l\'application les calcule de façon déterministe, avec des graphiques natifs — cartes de chaleur, nuages de points et diagrammes en boîte. L\'IA planifie ; le moteur calcule, sans inventer de chiffres.',
        de: 'Ehrliche statistische Analyse: Die KI schlägt die passenden Analysen für Ihre echten Spalten vor (Korrelationen, Chi-Quadrat, ANOVA, Regression), und die App berechnet sie deterministisch, mit nativen Diagrammen – Heatmaps, Streudiagrammen und Boxplots. Die KI plant; die Engine berechnet, ohne Zahlen zu erfinden.',
        pt: 'Análise estatística honesta: a IA propõe as análises adequadas sobre as suas colunas reais (correlações, qui-quadrado, ANOVA, regressão) e a aplicação calcula-as de forma determinística, com gráficos nativos — mapas de calor, dispersão e diagramas de caixa. A IA planeia; o motor calcula, sem inventar números.',
        'pt-BR': 'Análise estatística honesta: a IA propõe as análises adequadas sobre suas colunas reais (correlações, qui-quadrado, ANOVA, regressão) e o app as calcula de forma determinística, com gráficos nativos — mapas de calor, dispersão e diagramas de caixa. A IA planeja; o motor calcula, sem inventar números.',
      },
      {
        scope: 'genealogy',
        es: 'El Archivo de Genealogía se reconstruye como una cuadrícula editable al estilo de las bases de datos: edita cada celda al momento, asigna documentos a varias carpetas a la vez y clasifícalos con una taxonomía de más de 190 tipos de documento patrimonial, con búsqueda inteligente y filtros por faceta.',
        en: 'The Genealogy Archive is rebuilt as an editable database-style grid: edit each cell inline, file documents into several folders at once, and classify them with a taxonomy of 190+ heritage document types, complete with smart search and facet filters.',
        fr: 'L\'Archive de Généalogie est reconstruite sous forme de grille modifiable façon bases de données : modifiez chaque cellule instantanément, assignez des documents à plusieurs dossiers à la fois et classez-les grâce à une taxonomie de plus de 190 types de documents patrimoniaux, avec recherche intelligente et filtres par facette.',
        de: 'Das Genealogie-Archiv wird als bearbeitbares Raster im Stil der Datenbanken neu aufgebaut: Bearbeiten Sie jede Zelle sofort, ordnen Sie Dokumente mehreren Ordnern gleichzeitig zu und klassifizieren Sie sie mit einer Taxonomie von über 190 Typen von Kulturerbe-Dokumenten, mit intelligenter Suche und Facettenfiltern.',
        pt: 'O Arquivo de Genealogia é reconstruído como uma grelha editável ao estilo das bases de dados: edite cada célula no momento, atribua documentos a várias pastas em simultâneo e classifique-os com uma taxonomia de mais de 190 tipos de documento patrimonial, com pesquisa inteligente e filtros por faceta.',
        'pt-BR': 'O Arquivo de Genealogia é reconstruído como uma grade editável no estilo das bases de dados: edite cada célula na hora, atribua documentos a várias pastas de uma vez e classifique-os com uma taxonomia de mais de 190 tipos de documento patrimonial, com busca inteligente e filtros por faceta.',
      },
    ],
  },
  {
    version: '2.0.2',
    date: '2026-07-12',
    highlights: [
      {
        scope: 'genealogy',
        es: 'El Archivo estrena un campo «Fuente» para cada documento: anota de dónde procede (el archivo o repositorio, una cita o una URL). Es la base de una buena cita genealógica y viaja con las copias de seguridad como el resto del documento.',
        en: 'The Archive gains a “Source” field on every document: record where it came from (the archive or repository, a citation, or a URL). It’s the backbone of a good genealogical citation, and it travels with your backups like the rest of the document.',
        fr: 'L\'Archive inaugure un champ «Source» pour chaque document : notez sa provenance (l\'archive ou le dépôt, une citation ou une URL). C\'est la base d\'une bonne citation généalogique, et cela accompagne les sauvegardes comme le reste du document.',
        de: 'Das Archiv erhält ein neues Feld „Quelle“ für jedes Dokument: Notieren Sie, woher es stammt (das Archiv oder Repositorium, eine Zitation oder eine URL). Das ist die Grundlage einer guten genealogischen Zitation und wird wie der Rest des Dokuments in den Sicherungen mitgeführt.',
        pt: 'O Arquivo estreia um campo «Fonte» para cada documento: anote a sua proveniência (o arquivo ou repositório, uma citação ou um URL). É a base de uma boa citação genealógica e acompanha as cópias de segurança tal como o resto do documento.',
        'pt-BR': 'O Arquivo estreia um campo “Fonte” para cada documento: anote de onde ele vem (o arquivo ou repositório, uma citação ou uma URL). É a base de uma boa citação genealógica e acompanha os backups como o restante do documento.',
      },
    ],
  },
  {
    version: '2.0.1',
    date: '2026-07-12',
    highlights: [
      {
        scope: 'general',
        es: 'El selector de bóvedas muestra ahora una etiqueta con el tipo de cada bóveda (Académico, Genealogía…), y el rótulo «Activa» y el botón «Cargar» comparten por fin la misma tipografía.',
        en: 'The vault switcher now shows a badge with each vault’s type (Academic, Genealogy…), and the “Active” label and the “Load” button finally share the same typography.',
        fr: 'Le sélecteur d\'espaces affiche désormais un badge indiquant le type de chaque espace (Académique, Généalogie…), et le libellé «Actif» et le bouton «Charger» partagent enfin la même typographie.',
        de: 'Die Arbeitsbereichsauswahl zeigt jetzt ein Etikett mit dem Typ jedes Arbeitsbereichs (Akademisch, Genealogie…), und die Bezeichnung „Aktiv“ und die Schaltfläche „Laden“ verwenden endlich dieselbe Schriftart.',
        pt: 'O seletor de espaços mostra agora um distintivo com o tipo de cada espaço (Académico, Genealogia…), e o rótulo «Ativo» e o botão «Carregar» partilham finalmente a mesma tipografia.',
        'pt-BR': 'O seletor de espaços agora exibe uma etiqueta com o tipo de cada espaço (Acadêmico, Genealogia…), e o rótulo “Ativo” e o botão “Carregar” finalmente compartilham a mesma tipografia.',
      },
      {
        scope: 'genealogy',
        es: 'En las fichas de persona, los botones de editar y eliminar de las relaciones sociales pasan a ser iconos, y el panel de «Ajustar encuadre» del retrato se cierra al hacer clic fuera y ya no queda descuadrado.',
        en: 'In the person dossier, the edit and delete buttons of social relations are now icons, and the portrait “Adjust framing” panel closes on an outside click and is no longer misaligned.',
        fr: 'Dans les fiches de personne, les boutons de modification et de suppression des relations sociales deviennent des icônes, et le panneau «Ajuster le cadrage» du portrait se ferme lors d\'un clic à l\'extérieur et n\'est plus désaligné.',
        de: 'In den Personendossiers werden die Schaltflächen zum Bearbeiten und Löschen sozialer Beziehungen jetzt zu Symbolen, und das Panel „Ausschnitt anpassen“ für das Porträt schließt sich bei einem Klick außerhalb und ist nicht mehr verschoben.',
        pt: 'Nas fichas de pessoa, os botões de editar e eliminar das relações sociais passam a ser ícones, e o painel de «Ajustar enquadramento» do retrato fecha-se ao clicar fora e deixa de ficar desalinhado.',
        'pt-BR': 'Nas fichas de pessoa, os botões de editar e excluir das relações sociais passam a ser ícones, e o painel de “Ajustar enquadramento” do retrato se fecha ao clicar fora e não fica mais desalinhado.',
      },
      {
        scope: 'general',
        es: 'Corregida la ventana de novedades: ahora aparece correctamente al actualizar y recupera los cambios de la versión 2.0.0 si te los perdiste.',
        en: 'Fixed the what’s-new window: it now appears correctly after updating and recovers the 2.0.0 changes if you missed them.',
        fr: 'Fenêtre des nouveautés corrigée : elle apparaît désormais correctement lors de la mise à jour et récupère les changements de la version 2.0.0 si vous les avez manqués.',
        de: 'Das Neuigkeiten-Fenster wurde korrigiert: Es erscheint jetzt korrekt nach einem Update und zeigt die Änderungen der Version 2.0.0 an, falls Sie diese verpasst haben.',
        pt: 'Corrigida a janela de novidades: aparece agora corretamente ao atualizar e recupera as alterações da versão 2.0.0 caso as tenha perdido.',
        'pt-BR': 'Corrigida a janela de novidades: agora ela aparece corretamente ao atualizar e recupera as mudanças da versão 2.0.0 caso você as tenha perdido.',
      },
    ],
  },
  {
    version: '2.0.0',
    date: '2026-07-12',
    highlights: [
      {
        scope: 'general',
        es: 'Nodus estrena tipos de bóveda: cada bóveda tiene ahora un modo que adapta las secciones visibles y la personalidad del asistente de IA. Esta versión trae dos modos, «Académico» y «Genealogía», y anuncia los que llegarán después: Estudio, Fuentes primarias y Bases de datos.',
        en: 'Nodus introduces vault types: each vault now has a mode that tailors which sections are shown and the AI assistant’s persona. This release ships two modes, “Academic” and “Genealogy”, and previews the ones coming next: Study, Primary Sources and Databases.',
        fr: 'Nodus inaugure les types d\'espace : chaque espace dispose désormais d\'un mode qui adapte les sections visibles et la personnalité de l\'assistant IA. Cette version apporte deux modes, «Académique» et «Généalogie», et annonce ceux à venir : Étude, Sources primaires et Bases de données.',
        de: 'Nodus führt Arbeitsbereichstypen ein: Jeder Arbeitsbereich hat jetzt einen Modus, der die sichtbaren Bereiche und die Persönlichkeit des KI-Assistenten anpasst. Diese Version bringt zwei Modi, „Akademisch“ und „Genealogie“, und kündigt die kommenden an: Studium, Primärquellen und Datenbanken.',
        pt: 'O Nodus estreia tipos de espaço: cada espaço tem agora um modo que adapta as secções visíveis e a personalidade do assistente de IA. Esta versão traz dois modos, «Académico» e «Genealogia», e anuncia os que chegarão depois: Estudo, Fontes primárias e Bases de dados.',
        'pt-BR': 'O Nodus estreia os tipos de espaço: cada espaço agora tem um modo que adapta as seções visíveis e a personalidade do assistente de IA. Esta versão traz dois modos, “Acadêmico” e “Genealogia”, e anuncia os que chegarão depois: Estudo, Fontes primárias e Bases de dados.',
      },
      {
        scope: 'genealogy',
        es: 'Nuevo modo Genealogía: reconstruye historia familiar a partir de fuentes primarias con fichas de persona, árbol genealógico, cronología, archivo de evidencia y un mapa real. El asistente actúa como genealogista y propone parentescos a partir de la evidencia, siguiendo el estándar de prueba genealógico.',
        en: 'New Genealogy mode: reconstruct family history from primary sources with person dossiers, a family tree, a timeline, an evidence archive and a real map. The assistant acts as a genealogist and proposes kinship from the evidence, following the genealogical proof standard.',
        fr: 'Nouveau mode Généalogie : reconstituez l\'histoire familiale à partir de sources primaires grâce à des fiches de personne, un arbre généalogique, une chronologie, une archive de preuves et une carte réelle. L\'assistant agit comme un généalogiste et propose des liens de parenté à partir des preuves, en suivant la norme de preuve généalogique.',
        de: 'Neuer Modus Genealogie: Rekonstruieren Sie Familiengeschichte anhand von Primärquellen mit Personendossiers, Stammbaum, Zeitleiste, Belegarchiv und einer echten Karte. Der Assistent agiert als Genealoge und schlägt anhand der Belege Verwandtschaftsverhältnisse vor, gemäß dem genealogischen Beweisstandard.',
        pt: 'Novo modo Genealogia: reconstrua a história familiar a partir de fontes primárias com fichas de pessoa, árvore genealógica, cronologia, arquivo de evidências e um mapa real. O assistente atua como genealogista e propõe parentescos a partir das evidências, seguindo o padrão de prova genealógica.',
        'pt-BR': 'Novo modo Genealogia: reconstrua a história familiar a partir de fontes primárias com fichas de pessoa, árvore genealógica, cronologia, arquivo de evidências e um mapa real. O assistente atua como genealogista e propõe parentescos a partir das evidências, seguindo o padrão de prova genealógica.',
      },
      {
        scope: 'genealogy',
        es: 'Relaciones sociales: una segunda red, independiente del parentesco, para amistades, patronazgo, empleo, rivalidades y correspondencia — el material del historiador social y prosopográfico.',
        en: 'Social relations: a second network, independent from kinship, for friendships, patronage, employment, rivalries and correspondence — the material of the social and prosopographical historian.',
        fr: 'Relations sociales : un second réseau, indépendant du lien de parenté, pour les amitiés, le patronage, l\'emploi, les rivalités et la correspondance — la matière de l\'historien social et prosopographique.',
        de: 'Soziale Beziehungen: ein zweites, vom Verwandtschaftsverhältnis unabhängiges Netzwerk für Freundschaften, Patronage, Beschäftigung, Rivalitäten und Korrespondenz — das Material des Sozial- und Prosopographiehistorikers.',
        pt: 'Relações sociais: uma segunda rede, independente do parentesco, para amizades, patrocínio, emprego, rivalidades e correspondência — a matéria-prima do historiador social e prosopográfico.',
        'pt-BR': 'Relações sociais: uma segunda rede, independente do parentesco, para amizades, patronagem, emprego, rivalidades e correspondência — o material do historiador social e prosopográfico.',
      },
      {
        scope: 'genealogy',
        es: 'Deep Research aprende genealogía: compone un informe de historia familiar sobre el archivo indexado por embeddings y la biblioteca. La cabecera muestra ahora el modo de la bóveda activa en su color de acento.',
        en: 'Deep Research learns genealogy: it composes a family-history report over the embedding-indexed archive and library. The header now shows the active vault’s mode in its accent colour.',
        fr: 'Deep Research apprend la généalogie : il compose un rapport d\'histoire familiale à partir de l\'archive indexée par embeddings et de la bibliothèque. L\'en-tête affiche désormais le mode de l\'espace actif dans sa couleur d\'accent.',
        de: 'Deep Research lernt Genealogie: Es erstellt einen Bericht zur Familiengeschichte auf Grundlage des per Embeddings indexierten Archivs und der Bibliothek. Die Kopfzeile zeigt jetzt den Modus des aktiven Arbeitsbereichs in seiner Akzentfarbe an.',
        pt: 'O Deep Research aprende genealogia: compõe um relatório de história familiar sobre o arquivo indexado por embeddings e a biblioteca. O cabeçalho mostra agora o modo do espaço ativo na sua cor de destaque.',
        'pt-BR': 'Deep Research aprende genealogia: compõe um relatório de história familiar a partir do arquivo indexado por embeddings e da biblioteca. O cabeçalho agora mostra o modo do espaço ativo em sua cor de destaque.',
      },
      {
        scope: 'general',
        es: 'Copias de seguridad multi-bóveda: el sistema de respaldos automáticos cifrados abarca ahora todas tus bóvedas con rotación por generaciones.',
        en: 'Multi-vault backups: the automatic encrypted backup system now covers all your vaults with generational rotation.',
        fr: 'Sauvegardes multi-espaces : le système de sauvegardes automatiques chiffrées couvre désormais tous vos espaces avec rotation par générations.',
        de: 'Arbeitsbereichsübergreifende Sicherungen: Das System automatischer verschlüsselter Sicherungen umfasst jetzt alle Ihre Arbeitsbereiche mit generationsbasierter Rotation.',
        pt: 'Cópias de segurança multi-espaço: o sistema de backups automáticos cifrados abrange agora todos os seus espaços com rotação por gerações.',
        'pt-BR': 'Backups multi-espaço: o sistema de backups automáticos criptografados agora abrange todos os seus espaços com rotação por gerações.',
      },
    ],
  },
  {
    version: '1.8.0',
    date: '2026-07-11',
    highlights: [
      {
        scope: 'general',
        es: 'Nuevo copiloto de escritura para LibreOffice Writer (Linux, macOS y Windows): instala la macro desde Ajustes → Copiloto de escritura (LibreOffice), ejecútala en Writer y el panel del copiloto sigue tu cursor para analizar el párrafo e insertar texto citado con IA. La conexión se configura sola.',
        en: 'New writing copilot for LibreOffice Writer (Linux, macOS and Windows): install the macro from Settings → Writing copilot (LibreOffice), run it in Writer, and the copilot pane follows your cursor to analyze the paragraph and insert AI-drafted cited text. The connection configures itself.',
        fr: 'Nouveau copilote d\'écriture pour LibreOffice Writer (Linux, macOS et Windows) : installez la macro depuis Paramètres → Copilote d\'écriture (LibreOffice), exécutez-la dans Writer, et le panneau du copilote suit votre curseur pour analyser le paragraphe et insérer du texte cité généré par IA. La connexion se configure automatiquement.',
        de: 'Neuer Schreib-Copilot für LibreOffice Writer (Linux, macOS und Windows): Installieren Sie das Makro über Einstellungen → Schreib-Copilot (LibreOffice), führen Sie es in Writer aus, und das Copilot-Panel folgt Ihrem Cursor, um den Absatz zu analysieren und mit KI zitierten Text einzufügen. Die Verbindung konfiguriert sich von selbst.',
        pt: 'Novo copiloto de escrita para o LibreOffice Writer (Linux, macOS e Windows): instale a macro em Definições → Copiloto de escrita (LibreOffice), execute-a no Writer e o painel do copiloto segue o seu cursor para analisar o parágrafo e inserir texto citado com IA. A ligação configura-se sozinha.',
        'pt-BR': 'Novo copiloto de escrita para o LibreOffice Writer (Linux, macOS e Windows): instale a macro em Configurações → Copiloto de escrita (LibreOffice), execute-a no Writer e o painel do copiloto segue seu cursor para analisar o parágrafo e inserir texto citado com IA. A conexão se configura sozinha.',
      },
      {
        scope: 'general',
        es: 'Nodus llega a Linux: cada release publica ahora instaladores .deb y AppImage, y la app hereda el tema del cursor del sistema en Wayland.',
        en: 'Nodus lands on Linux: every release now ships .deb and AppImage installers, and the app inherits the system cursor theme on Wayland.',
        fr: 'Nodus arrive sur Linux : chaque version publie désormais des installateurs .deb et AppImage, et l\'application hérite du thème du curseur du système sous Wayland.',
        de: 'Nodus kommt zu Linux: Jedes Release veröffentlicht jetzt .deb- und AppImage-Installer, und die App übernimmt unter Wayland das Cursor-Theme des Systems.',
        pt: 'O Nodus chega ao Linux: cada versão passa a publicar instaladores .deb e AppImage, e a aplicação herda o tema do cursor do sistema no Wayland.',
        'pt-BR': 'O Nodus chega ao Linux: cada release agora publica instaladores .deb e AppImage, e o app herda o tema do cursor do sistema no Wayland.',
      },
      {
        scope: 'languages',
        es: 'Los idiomas de los prompts suman francés y turco: las ideas, los informes de Deep Research y los borradores del taller pueden generarse también en esos idiomas. Las citas literales siempre conservan el idioma original.',
        en: 'Prompt languages now include French and Turkish: ideas, Deep Research reports and workshop drafts can also be generated in those languages. Verbatim quotes always keep the source language.',
        fr: 'Les langues des prompts s\'enrichissent du français et du turc : les idées, les rapports de Deep Research et les brouillons de l\'atelier peuvent désormais être générés dans ces langues également. Les citations littérales conservent toujours la langue d\'origine.',
        de: 'Die Prompt-Sprachen wachsen um Französisch und Türkisch: Ideen, Deep-Research-Berichte und Entwürfe aus der Schreibwerkstatt lassen sich jetzt auch in diesen Sprachen erzeugen. Wörtliche Zitate behalten stets die Originalsprache bei.',
        pt: 'Os idiomas dos prompts somam o francês e o turco: as ideias, os relatórios de Deep Research e os rascunhos da oficina podem também ser gerados nesses idiomas. As citações literais conservam sempre o idioma original.',
        'pt-BR': 'Os idiomas dos prompts ganham francês e turco: as ideias, os relatórios do Deep Research e os rascunhos da oficina podem ser gerados também nesses idiomas. As citações literais sempre preservam o idioma original.',
      },
      {
        scope: 'general',
        es: 'Corregido: los PDFs locales añadidos después del primer análisis vuelven a detectarse al sincronizar, en lugar de quedarse marcados como «sin texto» para siempre.',
        en: 'Fixed: local PDFs attached after a first scan are picked up again on sync instead of staying flagged as “no text” forever.',
        fr: 'Corrigé : les PDF locaux ajoutés après la première analyse sont de nouveau détectés lors de la synchronisation, au lieu de rester marqués comme «sans texte» pour toujours.',
        de: 'Behoben: Lokale PDFs, die nach der ersten Analyse hinzugefügt wurden, werden bei der Synchronisierung wieder erkannt, statt für immer als „ohne Text“ markiert zu bleiben.',
        pt: 'Corrigido: os PDF locais adicionados após a primeira análise voltam a ser detetados ao sincronizar, em vez de ficarem marcados como «sem texto» para sempre.',
        'pt-BR': 'Corrigido: os PDFs locais adicionados após a primeira análise voltam a ser detectados ao sincronizar, em vez de ficarem marcados como “sem texto” para sempre.',
      },
      {
        scope: 'general',
        es: 'Esta versión incluye la primera contribución externa al proyecto: el copiloto de LibreOffice, los paquetes de Linux y los nuevos idiomas nacen del trabajo de Oğuz Karayemiş (@oguzkarayemis). ¡Gracias!',
        en: 'This version includes the project’s first external contribution: the LibreOffice copilot, the Linux packages and the new languages grew from the work of Oğuz Karayemiş (@oguzkarayemis). Thank you!',
        fr: 'Cette version inclut la première contribution externe au projet : le copilote LibreOffice, les paquets Linux et les nouvelles langues sont nés du travail d\'Oğuz Karayemiş (@oguzkarayemis). Merci !',
        de: 'Diese Version enthält den ersten externen Beitrag zum Projekt: Der LibreOffice-Copilot, die Linux-Pakete und die neuen Sprachen entstanden aus der Arbeit von Oğuz Karayemiş (@oguzkarayemis). Vielen Dank!',
        pt: 'Esta versão inclui a primeira contribuição externa para o projeto: o copiloto do LibreOffice, os pacotes para Linux e os novos idiomas nasceram do trabalho de Oğuz Karayemiş (@oguzkarayemis). Obrigado!',
        'pt-BR': 'Esta versão inclui a primeira contribuição externa ao projeto: o copiloto do LibreOffice, os pacotes do Linux e os novos idiomas nasceram do trabalho de Oğuz Karayemiş (@oguzkarayemis). Obrigado!',
      },
    ],
  },
  {
    version: '1.7.5',
    date: '2026-07-11',
    highlights: [
      {
        scope: 'general',
        es: 'Los modelos locales (LM Studio / Ollama) con ventana de contexto pequeña ya no fallan en el asistente de investigación: la app ajusta automáticamente el contexto a la ventana del modelo para que siempre pueda responder.',
        en: 'Local models (LM Studio / Ollama) with a small context window no longer fail in the research assistant: the app now fits the context to the model’s window so it can always answer.',
        fr: 'Les modèles locaux (LM Studio / Ollama) dotés d\'une petite fenêtre de contexte ne provoquent plus d\'échec dans l\'assistant de recherche : l\'application ajuste désormais automatiquement le contexte à la fenêtre du modèle afin qu\'il puisse toujours répondre.',
        de: 'Lokale Modelle (LM Studio / Ollama) mit kleinem Kontextfenster schlagen im Recherche-Assistenten nicht mehr fehl: Die App passt den Kontext jetzt automatisch an das Fenster des Modells an, damit es immer antworten kann.',
        pt: 'Os modelos locais (LM Studio / Ollama) com uma janela de contexto pequena deixam de falhar no assistente de investigação: a aplicação ajusta agora automaticamente o contexto à janela do modelo para que possa sempre responder.',
        'pt-BR': 'Os modelos locais (LM Studio / Ollama) com janela de contexto pequena não falham mais no assistente de pesquisa: o app ajusta automaticamente o contexto à janela do modelo para que ele sempre possa responder.',
      },
      {
        scope: 'general',
        es: 'Las citas de los modelos locales se muestran correctamente como «Autor, Año» en lugar del identificador interno de la idea.',
        en: 'Citations from local models now render properly as “Author, Year” instead of the internal idea id.',
        fr: 'Les citations des modèles locaux s\'affichent désormais correctement sous la forme «Auteur, Année» au lieu de l\'identifiant interne de l\'idée.',
        de: 'Zitate lokaler Modelle werden jetzt korrekt als „Autor, Jahr“ angezeigt statt der internen Kennung der Idee.',
        pt: 'As citações dos modelos locais mostram-se corretamente como «Autor, Ano» em vez do identificador interno da ideia.',
        'pt-BR': 'As citações dos modelos locais agora aparecem corretamente como “Autor, Ano” em vez do identificador interno da ideia.',
      },
      {
        scope: 'general',
        es: 'El asistente de configuración muestra las colecciones como un árbol desplegable, para vigilar subcolecciones concretas cuando una colección es muy grande.',
        en: 'The setup wizard now shows collections as an expandable tree, so you can monitor specific subcollections when a collection is very large.',
        fr: 'L\'assistant de configuration affiche désormais les collections sous forme d\'arbre déroulant, pour surveiller des sous-collections précises lorsqu\'une collection est très volumineuse.',
        de: 'Der Einrichtungsassistent zeigt Sammlungen jetzt als aufklappbaren Baum an, um bei sehr großen Sammlungen gezielt einzelne Unterkollektionen zu überwachen.',
        pt: 'O assistente de configuração mostra as coleções como uma árvore expansível, para vigiar subcoleções específicas quando uma coleção é muito grande.',
        'pt-BR': 'O assistente de configuração exibe as coleções como uma árvore expansível, para monitorar subcoleções específicas quando uma coleção é muito grande.',
      },
    ],
  },
  {
    version: '1.7.4',
    date: '2026-07-11',
    highlights: [
      {
        scope: 'general',
        es: 'Inmersión estrena galería con vista de mosaico y de lista, y un botón «Nueva inmersión» con su propia ventana, igual que Deep Research.',
        en: 'Immersion has a new gallery with grid and list views, plus a “New immersion” button with its own dialog — just like Deep Research.',
        fr: 'Immersion inaugure une galerie avec vue en mosaïque et en liste, ainsi qu\'un bouton «Nouvelle immersion» avec sa propre fenêtre, tout comme Deep Research.',
        de: 'Immersion erhält eine neue Galerie mit Kachel- und Listenansicht sowie eine Schaltfläche „Neue Immersion“ mit eigenem Fenster, genau wie Deep Research.',
        pt: 'A Imersão estreia uma galeria com vista em mosaico e em lista, e um botão «Nova imersão» com a sua própria janela, tal como o Deep Research.',
        'pt-BR': 'Imersão estreia uma galeria com visualização em mosaico e em lista, e um botão “Nova imersão” com sua própria janela, assim como o Deep Research.',
      },
      {
        scope: 'general',
        es: 'Selección múltiple en Deep Research e Inmersión para eliminar varios elementos a la vez, con confirmación.',
        en: 'Multi-select in Deep Research and Immersion to delete several items at once, with confirmation.',
        fr: 'Sélection multiple dans Deep Research et Immersion pour supprimer plusieurs éléments à la fois, avec confirmation.',
        de: 'Mehrfachauswahl in Deep Research und Immersion, um mehrere Elemente gleichzeitig zu löschen, mit Bestätigung.',
        pt: 'Seleção múltipla no Deep Research e na Imersão para eliminar vários elementos de uma vez, com confirmação.',
        'pt-BR': 'Seleção múltipla no Deep Research e na Imersão para excluir vários itens de uma vez, com confirmação.',
      },
      {
        scope: 'general',
        es: 'Nuevo botón «Traducir»: genera con IA una traducción del informe o de la inmersión a cualquier idioma. Cada traducción se guarda para releerla, regenerarla o eliminarla.',
        en: 'New “Translate” button: generate an AI translation of a report or immersion into any language. Each translation is saved to reread, regenerate or delete.',
        fr: 'Nouveau bouton «Traduire» : génère avec l\'IA une traduction du rapport ou de l\'immersion dans n\'importe quelle langue. Chaque traduction est enregistrée pour être relue, régénérée ou supprimée.',
        de: 'Neue Schaltfläche „Übersetzen“: Erzeugt mit KI eine Übersetzung des Berichts oder der Immersion in jede beliebige Sprache. Jede Übersetzung wird gespeichert, um sie erneut zu lesen, neu zu erzeugen oder zu löschen.',
        pt: 'Novo botão «Traduzir»: gera com IA uma tradução do relatório ou da imersão para qualquer idioma. Cada tradução fica guardada para voltar a ler, regenerar ou eliminar.',
        'pt-BR': 'Novo botão “Traduzir”: gera com IA uma tradução do relatório ou da imersão para qualquer idioma. Cada tradução é salva para ser relida, regenerada ou excluída.',
      },
      {
        scope: 'general',
        es: 'Al actualizar la app verás esta ventana con las novedades y las correcciones.',
        en: 'After each update you’ll see this what’s-new window with the latest changes and fixes.',
        fr: 'Après chaque mise à jour de l\'application, vous verrez cette fenêtre avec les nouveautés et les corrections.',
        de: 'Nach jedem Update sehen Sie dieses Fenster mit den Neuigkeiten und Korrekturen.',
        pt: 'Ao atualizar a aplicação verá esta janela com as novidades e as correções.',
        'pt-BR': 'Ao atualizar o app, você verá esta janela com as novidades e as correções.',
      },
    ],
  },
  {
    version: '1.7.3',
    date: '2026-07-11',
    highlights: [
      {
        scope: 'general',
        es: 'La interfaz ya no se congela mientras se genera el audio de narración en Deep Research e Inmersión.',
        en: 'The interface no longer freezes while narration audio is generated in Deep Research and Immersion.',
        fr: 'L\'interface ne se fige plus pendant la génération de l\'audio de narration dans Deep Research et Immersion.',
        de: 'Die Oberfläche friert nicht mehr ein, während das Erzähl-Audio in Deep Research und Immersion generiert wird.',
        pt: 'A interface deixa de ficar bloqueada enquanto se gera o áudio de narração no Deep Research e na Imersão.',
        'pt-BR': 'A interface não trava mais enquanto o áudio de narração é gerado no Deep Research e na Imersão.',
      },
      {
        scope: 'general',
        es: 'Corregida la voz «Sharvard»: ahora aparece como voz masculina, que es la que el motor reproduce realmente.',
        en: 'Fixed the “Sharvard” voice: it now appears as a male voice, which is what the engine actually renders.',
        fr: 'Voix «Sharvard» corrigée : elle apparaît désormais comme une voix masculine, ce qui correspond à ce que le moteur reproduit réellement.',
        de: 'Stimme „Sharvard“ korrigiert: Sie erscheint jetzt als männliche Stimme, was der tatsächlichen Wiedergabe durch die Engine entspricht.',
        pt: 'Corrigida a voz «Sharvard»: aparece agora como voz masculina, que é a que o motor efetivamente reproduz.',
        'pt-BR': 'Corrigida a voz “Sharvard”: agora ela aparece como voz masculina, que é a que o motor realmente reproduz.',
      },
    ],
  },
];

export const RELEASE_NOTES: ReleaseNote[] = RAW_RELEASE_NOTES.map((note) => ({
  ...note,
  highlights: note.highlights.map((highlight, index) => ({
    ...highlight,
    it: RELEASE_NOTES_IT[note.version]?.[index] ?? highlight.en,
    tr: RELEASE_NOTES_TR[note.version]?.[index] ?? highlight.en,
    'zh-CN': RELEASE_NOTES_ZH[note.version]?.[index] ?? highlight.en,
    'zh-TW': RELEASE_NOTES_ZH_TW[note.version]?.[index] ?? highlight.en,
    ko: RELEASE_NOTES_KO[note.version]?.[index] ?? highlight.en,
    ja: RELEASE_NOTES_JA[note.version]?.[index] ?? highlight.en,
  })),
}));

/** Compare two dotted numeric versions. Returns >0 if a>b, <0 if a<b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Release notes strictly newer than `since` (a version string, or null for a
 *  fresh install), capped and newest-first, up to and including `current`. */
export function releaseNotesSince(since: string | null, current: string): ReleaseNote[] {
  return RELEASE_NOTES.filter(
    (note) =>
      compareVersions(note.version, current) <= 0 &&
      (since == null || compareVersions(note.version, since) > 0)
  );
}

/** Every published note from the same major version as `current`, capped at
 *  `current` and kept newest-first. Used by the update modal so each new build
 *  provides the complete context for its current product generation. */
export function releaseNotesForMajor(current: string): ReleaseNote[] {
  const currentMajor = Number.parseInt(current.split('.')[0] ?? '', 10);
  if (!Number.isFinite(currentMajor)) return [];

  return RELEASE_NOTES.filter((note) => {
    const noteMajor = Number.parseInt(note.version.split('.')[0] ?? '', 10);
    return noteMajor === currentMajor && compareVersions(note.version, current) <= 0;
  });
}
