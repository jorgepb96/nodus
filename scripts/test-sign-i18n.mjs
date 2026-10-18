import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import ts from 'typescript';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-sign-i18n-'));
const require=createRequire(import.meta.url);
function load(entry){const out=path.join(temp,path.basename(entry)+'.cjs');buildSync({entryPoints:[entry],outfile:out,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});return require(out);}
const {SIGN_TRANSLATIONS,signText}=load('shared/signI18n.ts');
const {setActiveLang,t}=load('src/i18n.ts');
const {EN}=load('src/i18n.en.ts');
const errorsOut=path.join(temp,'errors.cjs');
buildSync({stdin:{contents:`export { signErrorText } from ${JSON.stringify(path.resolve('src/sign/errors.ts'))}; export { setActiveLang } from ${JSON.stringify(path.resolve('src/i18n.ts'))};`,loader:'ts',resolveDir:process.cwd()},outfile:errorsOut,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
const errorRuntime=require(errorsOut);
const locales=['en','fr','de','pt','pt-BR','it','tr','zh-CN','zh-TW','ja','ko'];
test.after(()=>fs.rmSync(temp,{force:true,recursive:true}));
for(const locale of locales)test(`Sign has complete renderer and native dialog translations: ${locale}`,()=>{
  const table=SIGN_TRANSLATIONS[locale];assert.deepEqual(Object.keys(table).sort(),Object.keys(SIGN_TRANSLATIONS.en).sort());setActiveLang(locale);
  for(const [key,text]of Object.entries(table)){assert.ok(text.trim(),`${locale}: ${key}`);assert.equal(signText(locale,key),text);assert.equal(t(key),text,`renderer wiring: ${locale} ${key}`);}
  if(locale!=='en')assert.ok(Object.keys(table).filter(k=>table[k]!==SIGN_TRANSLATIONS.en[k]).length>Object.keys(table).length*.9,`${locale} must not copy the English fallback`);
});
test('Sign translated data labels, errors, installers and placement controls have entries in every language',()=>{
  const files=['src/views/ToolkitSignView.tsx',...fs.readdirSync('src/sign').filter(f=>/\.tsx?$/.test(f)).map(f=>'src/sign/'+f),'electron/ipc/sign.ts'];
  const keys=new Set();
  for(const file of files){const source=fs.readFileSync(file,'utf8'),tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);function visit(n){if(ts.isStringLiteral(n)&&(/[áéíóúñ¿…]/i.test(n.text)||Object.hasOwn(SIGN_TRANSLATIONS.en,n.text)))keys.add(n.text);ts.forEachChild(n,visit);}visit(tree);}
  for(const key of keys)assert.ok(Object.hasOwn(EN,key),`Untranslated Sign source: ${key}`);
});

test('known and unexpected Sign failures stay localized, without exposing raw IPC errors',()=>{for(const locale of locales){errorRuntime.setActiveLang(locale);for(const [message,key] of [['Error invoking remote method: CERTIFICATE_PASSWORD_OR_FORMAT','La contraseña o el archivo PKCS#12 no son correctos.'],['Internal detail /private/example','No se ha podido completar la operación. Vuelve a intentarlo.'],['No se pudo abrir la imagen.','No se pudo abrir la imagen.']])assert.equal(errorRuntime.signErrorText(new Error(message)),SIGN_TRANSLATIONS[locale][key]);}});
