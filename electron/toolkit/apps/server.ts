import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { createPinGate, makePin, type PinGate } from '../presenter/serverAuth';
import { buildToolkitAppDocument } from '@shared/toolkitAppRuntime';
import type { AppLanguage } from '@shared/types';
import { normalizeBrowserUiLanguage } from '@shared/uiLanguage';
import { localizedIncludedToolkitAppMeta } from '@shared/toolkitAppsI18n';
import {
  isToolkitAppJsonValue,
  isToolkitAppManifest,
  type ToolkitAppJsonValue,
  type ToolkitAppManifest,
  type ToolkitAppParticipant,
  type ToolkitAppSessionInfo,
  type ToolkitAppSessionMessage,
  type ToolkitAppSessionSnapshot,
} from '@shared/toolkitApps';

interface Client {
  id: number;
  ws: WebSocket;
  participant: ToolkitAppParticipant | null;
  language: AppLanguage;
}

let server: Server | null = null;
let wss: WebSocketServer | null = null;
let pin: string | null = null;
let gate: PinGate | null = null;
let manifest: ToolkitAppManifest | null = null;
let info: ToolkitAppSessionInfo | null = null;
let nextClientId = 1;
let onSnapshot: ((snapshot: ToolkitAppSessionSnapshot) => void) | null = null;
const clients = new Set<Client>();
const messages: ToolkitAppSessionMessage[] = [];

function participantLanguage(value: string | null): AppLanguage {
  return normalizeBrowserUiLanguage(value);
}

type ParticipantCopyKey =
  | 'enterCode' | 'codeHelp' | 'accessCode' | 'continue' | 'sixDigits' | 'checking'
  | 'invalidOrEnded' | 'sharedExperience' | 'sharedApp' | 'displayName' | 'yourName'
  | 'openApp' | 'sessionClosed' | 'loadFailed' | 'sessionFull' | 'nameRequired' | 'participant'
  | 'storageTooLarge';

const PARTICIPANT_COPY: Record<AppLanguage, Record<ParticipantCopyKey, string>> = {
  es: {
    enterCode: 'Introduce el código', codeHelp: 'Escribe el código de seis cifras que aparece en Nodus.', accessCode: 'Código de acceso', continue: 'Continuar', sixDigits: 'Escribe las seis cifras del código.', checking: 'Comprobando…', invalidOrEnded: 'El código no es correcto o la sesión ha terminado.', sharedExperience: 'Experiencia compartida', sharedApp: 'App compartida', displayName: '¿Cómo quieres aparecer?', yourName: 'Tu nombre', openApp: 'Abrir app', sessionClosed: 'La sesión se ha cerrado.', loadFailed: 'No se pudo cargar la app.', sessionFull: 'La sesión está completa.', nameRequired: 'Escribe un nombre para entrar.', participant: 'Participante', storageTooLarge: 'El dato es demasiado grande.',
  },
  en: {
    enterCode: 'Enter the code', codeHelp: 'Enter the six-digit code shown in Nodus.', accessCode: 'Access code', continue: 'Continue', sixDigits: 'Enter all six digits of the code.', checking: 'Checking…', invalidOrEnded: 'The code is incorrect or the session has ended.', sharedExperience: 'Shared experience', sharedApp: 'Shared app', displayName: 'How would you like to appear?', yourName: 'Your name', openApp: 'Open app', sessionClosed: 'The session has closed.', loadFailed: 'The app could not be loaded.', sessionFull: 'The session is full.', nameRequired: 'Enter a name to join.', participant: 'Participant', storageTooLarge: 'The data is too large.',
  },
  fr: {
    enterCode: 'Saisissez le code', codeHelp: 'Saisissez le code à six chiffres affiché dans Nodus.', accessCode: 'Code d’accès', continue: 'Continuer', sixDigits: 'Saisissez les six chiffres du code.', checking: 'Vérification…', invalidOrEnded: 'Le code est incorrect ou la session est terminée.', sharedExperience: 'Expérience partagée', sharedApp: 'App partagée', displayName: 'Comment souhaitez-vous apparaître ?', yourName: 'Votre nom', openApp: 'Ouvrir l’app', sessionClosed: 'La session a été fermée.', loadFailed: 'Impossible de charger l’app.', sessionFull: 'La session est complète.', nameRequired: 'Saisissez un nom pour participer.', participant: 'Participant', storageTooLarge: 'Les données sont trop volumineuses.',
  },
  de: {
    enterCode: 'Code eingeben', codeHelp: 'Geben Sie den sechsstelligen Code aus Nodus ein.', accessCode: 'Zugangscode', continue: 'Weiter', sixDigits: 'Geben Sie alle sechs Ziffern des Codes ein.', checking: 'Wird geprüft…', invalidOrEnded: 'Der Code ist falsch oder die Sitzung wurde beendet.', sharedExperience: 'Gemeinsames Erlebnis', sharedApp: 'Geteilte App', displayName: 'Wie möchten Sie angezeigt werden?', yourName: 'Ihr Name', openApp: 'App öffnen', sessionClosed: 'Die Sitzung wurde geschlossen.', loadFailed: 'Die App konnte nicht geladen werden.', sessionFull: 'Die Sitzung ist voll.', nameRequired: 'Geben Sie einen Namen ein, um beizutreten.', participant: 'Teilnehmer', storageTooLarge: 'Die Daten sind zu groß.',
  },
  pt: {
    enterCode: 'Introduz o código', codeHelp: 'Introduz o código de seis algarismos apresentado no Nodus.', accessCode: 'Código de acesso', continue: 'Continuar', sixDigits: 'Introduz os seis algarismos do código.', checking: 'A verificar…', invalidOrEnded: 'O código está incorreto ou a sessão terminou.', sharedExperience: 'Experiência partilhada', sharedApp: 'App partilhada', displayName: 'Como queres aparecer?', yourName: 'O teu nome', openApp: 'Abrir app', sessionClosed: 'A sessão foi encerrada.', loadFailed: 'Não foi possível carregar a app.', sessionFull: 'A sessão está cheia.', nameRequired: 'Introduz um nome para entrar.', participant: 'Participante', storageTooLarge: 'Os dados são demasiado grandes.',
  },
  'pt-BR': {
    enterCode: 'Digite o código', codeHelp: 'Digite o código de seis dígitos exibido no Nodus.', accessCode: 'Código de acesso', continue: 'Continuar', sixDigits: 'Digite os seis dígitos do código.', checking: 'Verificando…', invalidOrEnded: 'O código está incorreto ou a sessão foi encerrada.', sharedExperience: 'Experiência compartilhada', sharedApp: 'App compartilhado', displayName: 'Como você quer aparecer?', yourName: 'Seu nome', openApp: 'Abrir app', sessionClosed: 'A sessão foi encerrada.', loadFailed: 'Não foi possível carregar o app.', sessionFull: 'A sessão está cheia.', nameRequired: 'Digite um nome para entrar.', participant: 'Participante', storageTooLarge: 'Os dados são grandes demais.',
  },
  it: {
    enterCode: 'Inserisci il codice', codeHelp: 'Inserisci il codice di sei cifre mostrato in Nodus.', accessCode: 'Codice di accesso', continue: 'Continua', sixDigits: 'Inserisci tutte le sei cifre del codice.', checking: 'Verifica…', invalidOrEnded: 'Il codice non è corretto o la sessione è terminata.', sharedExperience: 'Esperienza condivisa', sharedApp: 'App condivisa', displayName: 'Come vuoi apparire?', yourName: 'Il tuo nome', openApp: 'Apri app', sessionClosed: 'La sessione è stata chiusa.', loadFailed: 'Impossibile caricare l’app.', sessionFull: 'La sessione è piena.', nameRequired: 'Inserisci un nome per partecipare.', participant: 'Partecipante', storageTooLarge: 'I dati sono troppo grandi.',
  },
  tr: {
    enterCode: 'Kodu girin', codeHelp: 'Nodus’ta görünen altı haneli kodu girin.', accessCode: 'Erişim kodu', continue: 'Devam et', sixDigits: 'Kodun altı hanesini de girin.', checking: 'Kontrol ediliyor…', invalidOrEnded: 'Kod yanlış veya oturum sona erdi.', sharedExperience: 'Paylaşılan deneyim', sharedApp: 'Paylaşılan uygulama', displayName: 'Nasıl görünmek istersiniz?', yourName: 'Adınız', openApp: 'Uygulamayı aç', sessionClosed: 'Oturum kapatıldı.', loadFailed: 'Uygulama yüklenemedi.', sessionFull: 'Oturum dolu.', nameRequired: 'Katılmak için bir ad girin.', participant: 'Katılımcı', storageTooLarge: 'Veri çok büyük.',
  },
  'zh-CN': {
    enterCode: '输入代码', codeHelp: '输入 Nodus 中显示的六位代码。', accessCode: '访问代码', continue: '继续', sixDigits: '请输入代码的全部六位数字。', checking: '检查中…', invalidOrEnded: '代码不正确或会话已结束。', sharedExperience: '共享体验', sharedApp: '共享应用', displayName: '你希望以什么名称显示？', yourName: '你的名字', openApp: '打开应用', sessionClosed: '会话已关闭。', loadFailed: '无法加载应用。', sessionFull: '会话已满。', nameRequired: '请输入名称以加入。', participant: '参与者', storageTooLarge: '数据过大。',
  },
  'zh-TW': {
    enterCode: '輸入程式碼', codeHelp: '輸入 Nodus 中顯示的六位程式碼。', accessCode: '訪問程式碼', continue: '繼續', sixDigits: '請輸入程式碼的全部六位數字。', checking: '檢查中…', invalidOrEnded: '程式碼不正確或會話已結束。', sharedExperience: '共享體驗', sharedApp: '共享應用', displayName: '你希望以什麼名稱顯示？', yourName: '你的名字', openApp: '開啟應用', sessionClosed: '會話已關閉。', loadFailed: '無法載入應用。', sessionFull: '會話已滿。', nameRequired: '請輸入名稱以加入。', participant: '參與者', storageTooLarge: '資料過大。',
  },
  ko: {
    enterCode: "코드를 입력하세요",
    codeHelp: "Nodus에 표시된 6자리 코드를 입력하세요.",
    accessCode: "액세스 코드",
    continue: "계속하다",
    sixDigits: "코드 6자리를 모두 입력하세요.",
    checking: "확인 중…",
    invalidOrEnded: "코드가 올바르지 않거나 세션이 종료되었습니다.",
    sharedExperience: "공유된 경험",
    sharedApp: "공유 앱",
    displayName: "어떻게 등장하고 싶나요?",
    yourName: "당신의 이름",
    openApp: "앱 열기",
    sessionClosed: "세션이 종료되었습니다.",
    loadFailed: "앱을 로드할 수 없습니다.",
    sessionFull: "세션이 꽉 찼습니다.",
    nameRequired: "가입하려면 이름을 입력하세요.",
    participant: "참가자",
    storageTooLarge: "데이터가 너무 큽니다.",
  },
  ja: {
    enterCode: "コードを入力してください",
    codeHelp: "Nodusに表示されている6桁のコードを入力してください。",
    accessCode: "アクセスコード",
    continue: "続く",
    sixDigits: "コードの6桁すべてを入力します。",
    checking: "チェック中…",
    invalidOrEnded: "コードが間違っているか、セッションが終了しています。",
    sharedExperience: "共有された経験",
    sharedApp: "共有アプリ",
    displayName: "どのように登場したいですか？",
    yourName: "あなたの名前",
    openApp: "アプリを開く",
    sessionClosed: "セッションは終了しました。",
    loadFailed: "アプリを読み込めませんでした。",
    sessionFull: "セッションは満席です。",
    nameRequired: "参加する名前を入力してください。",
    participant: "参加者",
    storageTooLarge: "データが大きすぎます。",
  },
};

function participantText(language: AppLanguage, key: ParticipantCopyKey): string {
  return PARTICIPANT_COPY[language][key];
}

function lanIp(): string {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return '127.0.0.1';
}

function requestPin(req: IncomingMessage): string | null {
  try { return new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).searchParams.get('pin'); }
  catch { return null; }
}

function snapshot(): ToolkitAppSessionSnapshot {
  return {
    participants: [...clients].flatMap((client) => client.participant ? [client.participant] : []),
    messages: [...messages],
  };
}

function emitSnapshot(): void {
  onSnapshot?.(snapshot());
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }).end(JSON.stringify(value));
}

function html(res: ServerResponse, value: string, sandboxed = false): void {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': sandboxed
      ? "sandbox allow-scripts allow-forms; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
      : "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' ws: wss:; frame-src 'self'; img-src data:; base-uri 'none'; form-action 'self'",
  }).end(value);
}

const PARTICIPANT_SHELL = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="light dark"><title>Nodus App</title><style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;color:#242424;background:#f7f7f5}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 50% -10%,#fff5db,transparent 42%),#f7f7f5}.shell{width:min(520px,100%);margin:auto;padding:38px 18px}.brand{display:flex;align-items:center;gap:9px;margin-bottom:22px;color:#a16207;font-size:13px;font-weight:800;letter-spacing:.02em}.mark{display:grid;width:35px;height:35px;place-items:center;border-radius:12px;background:#f59e0b;color:#241400;box-shadow:0 8px 25px #f59e0b44}.card{border:1px solid #e5e5e5;border-radius:24px;padding:26px;background:#ffffffee;box-shadow:0 25px 70px #29252412}h1{margin:0;font-size:1.75rem;line-height:1.1}p{color:#737373;line-height:1.55}.meta{display:inline-flex;margin:10px 0 20px;border-radius:99px;padding:5px 9px;background:#f5f5f5;font-size:11px;color:#737373}label{display:block;margin:10px 0 7px;font-size:12px;font-weight:700}input{width:100%;border:1px solid #d4d4d4;border-radius:13px;padding:13px 14px;background:#fff;color:#171717;font:inherit}button{width:100%;margin-top:16px;border:0;border-radius:13px;padding:13px 18px;background:#d97706;color:white;font:inherit;font-weight:750;cursor:pointer}.error{margin-top:12px;color:#b91c1c;font-size:12px}.app-frame{position:fixed;inset:0;width:100%;height:100%;border:0;background:white}.runtime-error{position:fixed;z-index:5;right:12px;bottom:12px;max-width:360px;border-radius:10px;padding:9px 12px;background:#991b1bee;color:white;font-size:11px}.hidden{display:none}@media(prefers-color-scheme:dark){:root{color:#f5f5f5;background:#090909}body{background:radial-gradient(circle at 50% -10%,#34230c,transparent 42%),#090909}.card{border-color:#333;background:#171717ee}.meta{background:#292929;color:#aaa}p{color:#aaa}input{border-color:#444;background:#0f0f0f;color:#fff}}
</style></head><body><main class="shell" id="shell"><div class="brand"><span class="mark">N</span>Nodus Apps</div><section class="card" id="card"></section></main><div id="runtime-error" class="runtime-error hidden"></div><script>
	const __copies=${JSON.stringify(PARTICIPANT_COPY)};function browserLanguage(value){const normalized=String(value||'').trim().toLowerCase();if(normalized==='pt-br'||normalized.startsWith('pt-br-'))return'pt-BR';const base=normalized.split('-')[0];if(base==='zh')return'zh-CN';return['es','en','fr','de','pt','it','tr'].includes(base)?base:'en'}const __locale=browserLanguage(navigator.language);const tx=key=>(__copies[__locale]||__copies.en)[key]||__copies.en[key]||key;document.documentElement.lang=__locale;
	let pin='';const card=document.getElementById('card');const shell=document.getElementById('shell');const errorBox=document.getElementById('runtime-error');let meta=null;let ws=null;let frame=null;let token='';let state={};
const escapeText=(value)=>String(value??'');function showError(message){errorBox.textContent=escapeText(message);errorBox.classList.remove('hidden')}function response(target,id,ok,value,error){target.postMessage({source:'nodus-host',token,type:'response',id,ok,value,error},'*')}
	function renderAccess(error=''){card.replaceChildren();const title=document.createElement('h1');title.textContent=tx('enterCode');const copy=document.createElement('p');copy.textContent=tx('codeHelp');const form=document.createElement('form');const label=document.createElement('label');label.textContent=tx('accessCode');const input=document.createElement('input');input.inputMode='numeric';input.autocomplete='one-time-code';input.maxLength=6;input.pattern='[0-9]{6}';input.required=true;input.placeholder='000000';input.style.fontFamily='ui-monospace,monospace';input.style.fontSize='1.35rem';input.style.letterSpacing='.24em';input.style.textAlign='center';const submit=document.createElement('button');submit.type='submit';submit.textContent=tx('continue');form.append(label,input,submit);if(error){const message=document.createElement('p');message.className='error';message.textContent=error;form.append(message)}form.addEventListener('submit',async(event)=>{event.preventDefault();pin=input.value.replace(/[^0-9]/g,'').slice(0,6);if(pin.length!==6){renderAccess(tx('sixDigits'));return}submit.disabled=true;submit.textContent=tx('checking');try{const result=await fetch('/api/meta?pin='+encodeURIComponent(pin)+'&language='+encodeURIComponent(__locale));if(!result.ok)throw new Error();meta=await result.json();renderJoin()}catch{pin='';renderAccess(tx('invalidOrEnded'))}});card.append(title,copy,form);input.focus()}
function boot(){renderAccess()}
	function renderJoin(){card.replaceChildren();const title=document.createElement('h1');title.textContent=meta.title;const summary=document.createElement('p');summary.textContent=meta.summary;const badge=document.createElement('span');badge.className='meta';badge.textContent=tx(meta.multiplayer?'sharedExperience':'sharedApp');card.append(title,summary,badge);const form=document.createElement('form');let input=null;if(meta.identity==='name'){const label=document.createElement('label');label.textContent=tx('displayName');input=document.createElement('input');input.maxLength=60;input.required=true;input.placeholder=tx('yourName');form.append(label,input)}const join=document.createElement('button');join.type='submit';join.textContent=tx('openApp');form.append(join);form.addEventListener('submit',(event)=>{event.preventDefault();connect(input?input.value.trim():'')});card.append(form)}
	function connect(name){const protocol=location.protocol==='https:'?'wss':'ws';ws=new WebSocket(protocol+'://'+location.host+'/socket?pin='+encodeURIComponent(pin));ws.addEventListener('open',()=>ws.send(JSON.stringify({type:'join',name,language:__locale})));ws.addEventListener('message',async(event)=>{const message=JSON.parse(event.data);if(message.kind==='ready')await mount(message.participant,message.history||[]);if(message.kind==='app-message')deliver(message.message);if(message.kind==='error')showError(tx(message.code))});ws.addEventListener('close',()=>showError(tx('sessionClosed')))}
	async function mount(participant,history){token=Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');const params=new URLSearchParams({pin,token,id:String(participant.id),name:participant.name,language:__locale});const result=await fetch('/api/document?'+params);if(!result.ok)throw new Error(tx('loadFailed'));const documentText=await result.text();frame=document.createElement('iframe');frame.className='app-frame';frame.setAttribute('sandbox','allow-scripts allow-forms');frame.setAttribute('referrerpolicy','no-referrer');frame.title=meta.title;frame.srcdoc=documentText;shell.replaceWith(frame);frame.addEventListener('load',()=>history.forEach(deliver))}
function deliver(message){if(frame?.contentWindow)frame.contentWindow.postMessage({source:'nodus-host',token,type:'session:message',message},'*')}
window.addEventListener('message',(event)=>{if(!frame||event.source!==frame.contentWindow)return;const message=event.data;if(!message||message.source!=='nodus-miniapp'||message.token!==token)return;const key=typeof message.key==='string'?message.key.slice(0,100):'';try{if(message.type==='storage:get')return response(event.source,message.id,true,state[key]??null);if(message.type==='storage:set'){const encoded=JSON.stringify(message.value);if(!key||encoded.length>64000)throw new Error(tx('storageTooLarge'));state[key]=message.value;return response(event.source,message.id,true,true)}if(message.type==='storage:remove'){delete state[key];return response(event.source,message.id,true,true)}if(message.type==='storage:clear'){state={};return response(event.source,message.id,true,true)}if(message.type==='session:send'&&meta.multiplayer){ws.send(JSON.stringify({type:'app-message',channel:message.channel,payload:message.payload}));return}if(message.type==='runtime:error')showError(message.message)}catch(error){response(event.source,message.id,false,null,error.message)}});boot();
</script></body></html>`;

/** Anything a LAN client can make throw — a malformed escape, an unparsable Host — runs before
 *  the PIN check; uncaught it left the socket hanging and logged an uncaught exception per
 *  request. It is answered 400 instead. */
function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  try { handleRequestUnsafe(req, res); }
  catch {
    if (!res.headersSent) res.writeHead(400).end('Bad request');
    else res.destroy();
  }
}

function handleRequestUnsafe(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const authorized = Boolean(gate?.admit({ remoteAddress: req.socket.remoteAddress, providedPin: url.searchParams.get('pin'), host: req.headers.host, origin: req.headers.origin }));
  if (url.pathname === '/join' || url.pathname === '/') return html(res, PARTICIPANT_SHELL);
  if (!authorized || !manifest) return json(res, 403, { error: 'Forbidden' });
  if (url.pathname === '/api/meta') {
    const language = participantLanguage(url.searchParams.get('language'));
    const localized = localizedIncludedToolkitAppMeta(manifest, language);
    return json(res, 200, {
      title: localized.title,
      summary: localized.summary,
      identity: manifest.sharing.identity,
      multiplayer: manifest.capabilities.multiplayer,
    });
  }
  if (url.pathname === '/api/document') {
    const token = url.searchParams.get('token') ?? '';
    const id = Number(url.searchParams.get('id'));
    const name = (url.searchParams.get('name') ?? '').slice(0, 60);
    if (!/^[a-f0-9]{32}$/.test(token) || !Number.isInteger(id) || id < 1) return json(res, 400, { error: 'Invalid runtime' });
    return html(res, buildToolkitAppDocument(manifest, {
      token,
      language: participantLanguage(url.searchParams.get('language')),
      storage: manifest.capabilities.storage,
      session: { available: manifest.capabilities.multiplayer, role: 'participant', participant: { id, name } },
    }), true);
  }
  json(res, 404, { error: 'Not found' });
}

function validMessage(channel: unknown, payload: unknown): channel is string {
  if (typeof channel !== 'string' || !/^[a-zA-Z0-9:_-]{1,64}$/.test(channel) || !isToolkitAppJsonValue(payload)) return false;
  try { return JSON.stringify(payload).length <= 16_000; } catch { return false; }
}

function publish(participantId: number, participantName: string, channel: string, payload: ToolkitAppJsonValue): void {
  const message: ToolkitAppSessionMessage = {
    id: randomBytes(8).toString('hex'), participantId, participantName, channel, payload, sentAt: new Date().toISOString(),
  };
  messages.push(message);
  if (messages.length > 500) messages.splice(0, messages.length - 500);
  const encoded = JSON.stringify({ kind: 'app-message', message });
  for (const client of clients) if (client.participant && client.ws.readyState === WebSocket.OPEN) client.ws.send(encoded);
  emitSnapshot();
}

function handleMessage(client: Client, raw: WebSocket.RawData): void {
  let message: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw.toString());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    message = parsed;
  } catch { return; }
  if (message.type === 'join') {
    if (client.participant || !manifest) return;
    client.language = participantLanguage(typeof message.language === 'string' ? message.language : null);
    const active = [...clients].filter((item) => item.participant).length;
    if (active >= manifest.sharing.maxParticipants) return void client.ws.send(JSON.stringify({ kind: 'error', code: 'sessionFull' }));
    const requested = typeof message.name === 'string' ? message.name.trim().slice(0, 60) : '';
    const name = manifest.sharing.identity === 'name' ? requested : `${participantText(client.language, 'participant')} ${client.id}`;
    if (!name) return void client.ws.send(JSON.stringify({ kind: 'error', code: 'nameRequired' }));
    client.participant = { id: client.id, name, joinedAt: new Date().toISOString() };
    client.ws.send(JSON.stringify({ kind: 'ready', participant: client.participant, history: messages.slice(-100) }));
    emitSnapshot();
    return;
  }
  if (message.type !== 'app-message' || !client.participant || !manifest?.capabilities.multiplayer) return;
  if (!validMessage(message.channel, message.payload)) return;
  publish(client.participant.id, client.participant.name, message.channel, message.payload as ToolkitAppJsonValue);
}

export async function startToolkitAppSession(nextManifest: ToolkitAppManifest, listener: (snapshot: ToolkitAppSessionSnapshot) => void): Promise<ToolkitAppSessionInfo> {
  if (!isToolkitAppManifest(nextManifest)) throw new Error('El bundle de la app no es válido o contiene capacidades no permitidas.');
  stopToolkitAppSession();
  manifest = nextManifest; pin = makePin(); gate = createPinGate(pin); onSnapshot = listener; nextClientId = 1; messages.length = 0;
  return new Promise((resolve, reject) => {
    server = createServer(handleRequest); server.on('error', reject);
    wss = new WebSocketServer({ server, maxPayload: 32 * 1024 });
    wss.on('connection', (ws, req) => {
      if (!gate?.admit({ remoteAddress: req.socket.remoteAddress, providedPin: requestPin(req), host: req.headers.host, origin: req.headers.origin })) return void ws.close(4001, 'Invalid PIN');
      const client: Client = { id: nextClientId++, ws, participant: null, language: 'en' }; clients.add(client);
      ws.on('message', (raw) => handleMessage(client, raw));
      ws.on('close', () => { clients.delete(client); emitSnapshot(); });
      ws.on('error', () => { clients.delete(client); emitSnapshot(); });
    });
    server.listen(0, '0.0.0.0', () => {
      const address = server?.address(); const port = typeof address === 'object' && address ? address.port : 0; const ip = lanIp();
      const url = `http://${ip}:${port}/join`;
      void QRCode.toDataURL(url, { width: 320, margin: 2 }).then((qr) => {
        info = { appTitle: nextManifest.title, ip, port, pin: pin!, url, qr, startedAt: new Date().toISOString() };
        listener(snapshot()); resolve(info);
      }, (error) => { stopToolkitAppSession(); reject(error); });
    });
  });
}

export function sendToolkitAppSessionMessage(channel: string, payload: ToolkitAppJsonValue): void {
  if (!manifest?.capabilities.multiplayer || !validMessage(channel, payload)) throw new Error('La app no permite este mensaje compartido.');
  publish(0, 'Nodus', channel, payload);
}

export function getToolkitAppSessionInfo(): ToolkitAppSessionInfo | null { return info; }
export function getToolkitAppSessionSnapshot(): ToolkitAppSessionSnapshot { return snapshot(); }

export function stopToolkitAppSession(): void {
  for (const client of clients) try { client.ws.close(); } catch { /* ignore */ }
  clients.clear(); wss?.close(); wss = null; server?.close(); server = null; pin = null; gate = null; manifest = null; info = null; onSnapshot = null; messages.length = 0;
}
