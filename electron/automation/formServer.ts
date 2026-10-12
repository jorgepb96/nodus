import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { getColumns } from '../db/databasesRepo';
import { authenticateDatabaseForm, getDatabaseFormBySlug, submitDatabaseForm } from '../db/databaseAutomationsRepo';
import { formInputType, type DatabaseFormServerStatus, type FormDefinition } from '@shared/databaseAutomations';
import type { AppLanguage } from '@shared/types';
import { localizeRuntimeError } from '@shared/uiLanguage';

let server: Server | null = null;
let port: number | null = null;
const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const fingerprint = (request: IncomingMessage) => createHash('sha256').update(`${request.socket.remoteAddress ?? ''}|${request.headers['user-agent'] ?? ''}`).digest('hex');

type FormChrome = { accessToken: string; access: string; choose: string; yes: string; submit: string; notFound: string; unavailable: string; invalidToken: string; tooLarge: string; error: string };
const FORM_CHROME: Record<AppLanguage, FormChrome> = {
  es: { accessToken: 'Token de acceso', access: 'Acceder', choose: 'Selecciona una opción', yes: 'Sí', submit: 'Enviar respuesta', notFound: 'No encontrado', unavailable: 'Formulario no disponible', invalidToken: 'El token no es válido.', tooLarge: 'La respuesta supera 1 MB.', error: 'Error' },
  en: { accessToken: 'Access token', access: 'Sign in', choose: 'Select an option', yes: 'Yes', submit: 'Submit response', notFound: 'Not found', unavailable: 'Form unavailable', invalidToken: 'The token is not valid.', tooLarge: 'The response exceeds 1 MB.', error: 'Error' },
  fr: { accessToken: 'Jeton d’accès', access: 'Accéder', choose: 'Sélectionnez une option', yes: 'Oui', submit: 'Envoyer la réponse', notFound: 'Introuvable', unavailable: 'Formulaire indisponible', invalidToken: 'Le jeton n’est pas valide.', tooLarge: 'La réponse dépasse 1 Mo.', error: 'Erreur' },
  de: { accessToken: 'Zugriffstoken', access: 'Anmelden', choose: 'Option auswählen', yes: 'Ja', submit: 'Antwort senden', notFound: 'Nicht gefunden', unavailable: 'Formular nicht verfügbar', invalidToken: 'Das Token ist nicht gültig.', tooLarge: 'Die Antwort überschreitet 1 MB.', error: 'Fehler' },
  pt: { accessToken: 'Token de acesso', access: 'Aceder', choose: 'Selecione uma opção', yes: 'Sim', submit: 'Enviar resposta', notFound: 'Não encontrado', unavailable: 'Formulário indisponível', invalidToken: 'O token não é válido.', tooLarge: 'A resposta excede 1 MB.', error: 'Erro' },
  'pt-BR': { accessToken: 'Token de acesso', access: 'Entrar', choose: 'Selecione uma opção', yes: 'Sim', submit: 'Enviar resposta', notFound: 'Não encontrado', unavailable: 'Formulário indisponível', invalidToken: 'O token não é válido.', tooLarge: 'A resposta excede 1 MB.', error: 'Erro' },
  it: { accessToken: 'Token di accesso', access: 'Accedi', choose: 'Seleziona un’opzione', yes: 'Sì', submit: 'Invia risposta', notFound: 'Non trovato', unavailable: 'Modulo non disponibile', invalidToken: 'Il token non è valido.', tooLarge: 'La risposta supera 1 MB.', error: 'Errore' },
  tr: { accessToken: 'Erişim belirteci', access: 'Giriş yap', choose: 'Bir seçenek seçin', yes: 'Evet', submit: 'Yanıtı gönder', notFound: 'Bulunamadı', unavailable: 'Form kullanılamıyor', invalidToken: 'Belirteç geçerli değil.', tooLarge: 'Yanıt 1 MB boyutunu aşıyor.', error: 'Hata' },
  'zh-CN': { accessToken: '访问令牌', access: '登录', choose: '请选择一项', yes: '是', submit: '提交回复', notFound: '未找到', unavailable: '表单不可用', invalidToken: '令牌无效。', tooLarge: '回复超过 1 MB。', error: '错误' },
  'zh-TW': { accessToken: '訪問令牌', access: '登入', choose: '請選擇一項', yes: '是', submit: '提交回復', notFound: '未找到', unavailable: '表單不可用', invalidToken: '令牌無效。', tooLarge: '回覆超過 1 MB。', error: '錯誤' },
  ko: {
    accessToken: "액세스 토큰",
    access: "로그인",
    choose: "옵션을 선택하세요",
    yes: "예",
    submit: "응답 제출",
    notFound: "찾을 수 없음",
    unavailable: "양식을 사용할 수 없습니다.",
    invalidToken: "토큰이 유효하지 않습니다.",
    tooLarge: "응답이 1MB를 초과합니다.",
    error: "오류",
  },
  ja: {
    accessToken: "アクセストークン",
    access: "サインイン",
    choose: "オプションを選択してください",
    yes: "はい",
    submit: "応答を送信する",
    notFound: "見つかりません",
    unavailable: "フォームが利用できません",
    invalidToken: "トークンが無効です。",
    tooLarge: "応答が1 MB を超えています。",
    error: "エラー",
  },
};

function formLanguage(request: IncomingMessage, url: URL): AppLanguage {
  const requested = url.searchParams.get('lang') || url.searchParams.get('locale');
  const header = String(request.headers['accept-language'] ?? '').split(',')[0]?.trim();
  // Accept-Language values may carry a quality suffix (for example `pt-BR;q=0.8`).
  const candidate = (requested || header || '').split(';', 1)[0].trim().toLowerCase();
  if (candidate === 'pt-br') return 'pt-BR';
  if (candidate.startsWith('es')) return 'es';
  if (candidate.startsWith('fr')) return 'fr';
  if (candidate.startsWith('de')) return 'de';
  if (candidate.startsWith('pt')) return 'pt';
  if (candidate.startsWith('it')) return 'it';
  if (candidate.startsWith('tr')) return 'tr';
  // Script subtags win; a traditional region (zh-TW/HK/MO) gets the Traditional table.
  if (candidate === 'zh-tw' || candidate.startsWith('zh-tw-')
    || candidate === 'zh-hant' || candidate.startsWith('zh-hant-')
    || candidate === 'zh-hk' || candidate.startsWith('zh-hk-')
    || candidate === 'zh-mo' || candidate.startsWith('zh-mo-')) return 'zh-TW';
  // Simplified Chinese: zh-CN, zh-Hans, zh-SG and any bare `zh` locale.
  if (candidate === 'zh' || candidate.startsWith('zh-')) return 'zh-CN';
  return 'en';
}

function chrome(language: AppLanguage): FormChrome { return FORM_CHROME[language] ?? FORM_CHROME.en; }

function headers(response: ServerResponse, status = 200, type = 'text/html; charset=utf-8'): void {
  response.writeHead(status, { 'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',
    'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'self'" });
}

function shell(title:string,body:string,dark=false,language: AppLanguage = 'en'):string { return `<!doctype html><html lang="${language}" class="${dark?'dark':''}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
:root{color-scheme:light dark;font:16px/1.5 Inter,ui-sans-serif,system-ui,sans-serif;background:#f5f5f4;color:#1c1917}*{box-sizing:border-box}body{margin:0;min-height:100vh;padding:32px 16px;background:radial-gradient(circle at top,#d1fae5 0,transparent 32rem),#f5f5f4}.dark{color-scheme:dark;background:#09090b;color:#f4f4f5}.dark body{background:radial-gradient(circle at top,#064e3b 0,transparent 32rem),#09090b}.card{width:min(720px,100%);margin:auto;background:#fff;border:1px solid #d6d3d1;border-radius:20px;padding:clamp(22px,5vw,42px);box-shadow:0 24px 70px #0002}.dark .card{background:#111113;border-color:#3f3f46;box-shadow:0 24px 70px #0008}.brand{display:flex;align-items:center;gap:10px;color:#047857;font-weight:750}.dark .brand{color:#6ee7b7}h1{font-size:clamp(1.7rem,6vw,2.5rem);line-height:1.12;margin:24px 0 8px}p{color:#57534e}.dark p{color:#a1a1aa}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-top:28px}.field{display:grid;gap:7px}.full{grid-column:1/-1}label{font-size:.88rem;font-weight:650}.hint{font-size:.78rem;color:#78716c}.dark .hint{color:#a1a1aa}input,select,textarea{width:100%;min-height:46px;border:1px solid #a8a29e;border-radius:11px;background:#fff;color:inherit;padding:10px 12px;font:inherit}textarea{min-height:110px;resize:vertical}.dark input,.dark select,.dark textarea{background:#18181b;border-color:#52525b}input:focus-visible,select:focus-visible,textarea:focus-visible,button:focus-visible{outline:3px solid #34d399;outline-offset:2px}.check{display:flex;align-items:center;gap:9px;min-height:46px}.check input{width:20px;min-height:20px}button{min-height:48px;border:0;border-radius:12px;background:#047857;color:white;padding:12px 20px;font:inherit;font-weight:750;cursor:pointer}button:hover{background:#065f46}.actions{display:flex;justify-content:flex-end;margin-top:26px}.error{border:1px solid #fda4af;background:#fff1f2;color:#9f1239;border-radius:12px;padding:12px;margin:18px 0}.dark .error{background:#4c0519;color:#fecdd3;border-color:#9f1239}@media(max-width:520px){body{padding:12px}.card{border-radius:16px;padding:22px 18px}.grid{grid-template-columns:1fr}.field{grid-column:1/-1}.actions button{width:100%}}
</style></head><body>${body}</body></html>`; }

function authPage(form:FormDefinition,dark:boolean,error='',language: AppLanguage = 'en'):string { const copy = chrome(language); return shell(form.title,`<main class="card"><div class="brand"><span aria-hidden="true">◆</span> Nodus Research</div><h1>${escapeHtml(form.title)}</h1><p>${escapeHtml(form.description)}</p>${error?`<div class="error" role="alert">${escapeHtml(error)}</div>`:''}<form method="get"><input type="hidden" name="lang" value="${language}"><div class="field"><label for="token">${copy.accessToken}</label><input id="token" name="token" type="password" required autocomplete="current-password"></div><div class="actions"><button type="submit">${copy.access}</button></div></form></main>`,dark,language); }

function fieldHtml(form:FormDefinition,language: AppLanguage):string { const copy = chrome(language); const columns=new Map(getColumns(form.databaseId).map((column)=>[column.id,column])); return form.fields.map((field)=>{ const column=columns.get(field.columnId); if(!column)return'';
  const inputType=formInputType(column.type); const attrs=`id="field_${escapeHtml(field.columnId)}" name="field_${escapeHtml(field.columnId)}" ${field.required?'required':''}`;
  let control:string; if(inputType==='textarea') control=`<textarea ${attrs}></textarea>`; else if(inputType==='select') { const multiple=column.type==='multi_select'?' multiple':'';
    control=`<select ${attrs}${multiple}><option value="">${copy.choose}</option>${column.options.map((option)=>`<option value="${escapeHtml(option.id)}">${escapeHtml(option.label)}</option>`).join('')}</select>`;
  } else if(inputType==='checkbox') control=`<span class="check"><input ${attrs} type="checkbox" value="1"><span>${copy.yes}</span></span>`;
  else control=`<input ${attrs} type="${inputType}"${column.type==='number'?' step="any"':''}>`;
  return `<div class="field ${field.width==='full'?'full':''}"><label for="field_${escapeHtml(field.columnId)}">${escapeHtml(field.label)}${field.required?' *':''}</label>${field.description?`<span class="hint">${escapeHtml(field.description)}</span>`:''}${control}</div>`; }).join(''); }

function formPage(form:FormDefinition,token:string|null,dark:boolean,error='',language: AppLanguage = 'en'):string { const copy = chrome(language); return shell(form.title,`<main class="card"><div class="brand"><span aria-hidden="true">◆</span> Nodus Research</div><h1>${escapeHtml(form.title)}</h1><p>${escapeHtml(form.description)}</p>${error?`<div class="error" role="alert">${escapeHtml(error)}</div>`:''}<form method="post"><input type="hidden" name="lang" value="${language}">${token?`<input type="hidden" name="_token" value="${escapeHtml(token)}">`:''}<div class="grid">${fieldHtml(form,language)}</div><div class="actions"><button type="submit">${copy.submit}</button></div></form></main>`,dark,language); }
function confirmationPage(form:FormDefinition,dark:boolean,language: AppLanguage = 'en'):string { return shell(form.confirmationTitle,`<main class="card"><div class="brand"><span aria-hidden="true">✓</span> Nodus Research</div><h1>${escapeHtml(form.confirmationTitle)}</h1><p>${escapeHtml(form.confirmationBody)}</p></main>`,dark,language); }

async function readBody(request:IncomingMessage):Promise<URLSearchParams> { const chunks:Buffer[]=[]; let size=0; for await(const chunk of request){ const value=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk); size+=value.length; if(size>1_000_000)throw new Error('La respuesta supera 1 MB.'); chunks.push(value); }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8')); }

async function handle(request:IncomingMessage,response:ServerResponse):Promise<void> { const origin=`http://127.0.0.1:${port}`; const url=new URL(request.url??'/',origin); const language = formLanguage(request, url); const copy = chrome(language); const match=/^\/forms\/([a-z0-9-]+)$/.exec(url.pathname);
  if(!match){headers(response,404);response.end(shell(copy.notFound,`<main class="card"><h1>${copy.notFound}</h1></main>`,false,language));return;} const form=getDatabaseFormBySlug(match[1]); const dark=url.searchParams.get('theme')==='dark';
  if(!form||!form.enabled){headers(response,404);response.end(shell(copy.unavailable,`<main class="card"><h1>${copy.unavailable}</h1></main>`,dark,language));return;}
  if(request.method==='GET'){ const token=url.searchParams.get('token'); const authorized=authenticateDatabaseForm(form.id,token); headers(response,authorized?200:401); response.end(authorized?formPage(form,token,dark,'',language):authPage(form,dark,token?copy.invalidToken:'',language)); return; }
  if(request.method!=='POST'){headers(response,405);return;} let params:URLSearchParams; try{params=await readBody(request);}catch(cause){headers(response,413);const raw= cause instanceof Error ? cause.message : String(cause); const message=raw === 'La respuesta supera 1 MB.' ? copy.tooLarge : localizeRuntimeError(raw,language);response.end(formPage(form,null,dark,message,language));return;}
  const token=params.get('_token')??url.searchParams.get('token'); if(!authenticateDatabaseForm(form.id,token)){headers(response,401);response.end(authPage(form,dark,copy.invalidToken,language));return;}
  const columns=new Map(getColumns(form.databaseId).map((column)=>[column.id,column])); const values:Record<string,string|null>={}; for(const field of form.fields){ const column=columns.get(field.columnId); if(!column)continue; const raw=params.getAll(`field_${field.columnId}`);
    values[field.columnId]=column.type==='multi_select'?JSON.stringify(raw.filter(Boolean)):column.type==='checkbox'?(raw.length?'1':'0'):(raw[0]?.trim()||null); }
  try{await submitDatabaseForm(form.id,values,'local-http',fingerprint(request));headers(response,200);response.end(confirmationPage(form,dark,language));}
  catch(cause){headers(response,/límite temporal/i.test(String(cause))?429:400);const message=localizeRuntimeError(cause instanceof Error?cause.message:String(cause),language);response.end(formPage(form,token,dark,message,language));}
}

export async function startDatabaseFormServer(requestedPort=0):Promise<DatabaseFormServerStatus> { if(server)return databaseFormServerStatus(); server=createServer((request,response)=>{void handle(request,response).catch((cause)=>{ const url=new URL(request.url??'/',`http://127.0.0.1:${port}`); const language=formLanguage(request,url); const copy=chrome(language); if(!response.headersSent)headers(response,500);response.end(shell(copy.error,`<main class="card"><div class="error">${escapeHtml(localizeRuntimeError(cause instanceof Error?cause.message:String(cause),language))}</div></main>`,false,language));});});
  const candidate=server;
  // A failed listen (EADDRINUSE on a fixed port) must not leave `server` set: every later
  // start would then report {running:false} without ever trying again.
  try{await new Promise<void>((resolve,reject)=>{candidate.once('error',reject);candidate.listen(requestedPort,'127.0.0.1',()=>{candidate.off('error',reject);resolve();});});}
  catch(cause){if(server===candidate){server=null;port=null;}candidate.close();throw cause;}
  const address=candidate.address(); port=typeof address==='object'&&address?address.port:null; return databaseFormServerStatus(); }
export async function stopDatabaseFormServer():Promise<void> { const current=server;server=null;port=null;if(!current)return;await new Promise<void>((resolve)=>current.close(()=>resolve())); }
export function databaseFormServerStatus():DatabaseFormServerStatus { return {running:Boolean(server&&port),port,origin:port?`http://127.0.0.1:${port}`:null}; }
export function databaseFormPublicUrl(slug:string):string|null { return port?`http://127.0.0.1:${port}/forms/${encodeURIComponent(slug)}`:null; }
