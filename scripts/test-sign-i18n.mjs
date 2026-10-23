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
const {setActiveLang,t,hasTranslation}=load('src/i18n.ts');
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

test('known and unexpected Sign failures stay localized, without exposing raw IPC errors', () => {
  for (const locale of ['es', ...locales]) {
    errorRuntime.setActiveLang(locale);
    for (const [message, key] of [
      ['Error invoking remote method: CERTIFICATE_PASSWORD_OR_FORMAT', 'La contraseña o el archivo PKCS#12 no son correctos.'],
      ['Internal detail /private/example', 'No se ha podido completar la operación. Vuelve a intentarlo.'],
      ...['constructor', 'toString', '__proto__', 'hasOwnProperty', ''].map(message => [message, 'No se ha podido completar la operación. Vuelve a intentarlo.']),
      ...['No se pudo abrir la imagen.', 'No hay documento.', 'Añade una firma antes de guardar.', 'Confirma la operación antes de firmar.', 'Indica páginas válidas, por ejemplo: 1, 3-5.'].map(message => [message, message]),
    ]) {
      const expected = locale === 'es' ? key : SIGN_TRANSLATIONS[locale][key];
      assert.equal(errorRuntime.signErrorText(new Error(message)), expected, `${locale}: ${message}`);
      assert.equal(errorRuntime.signErrorText(message), expected, `${locale}, string rejection: ${message}`);
    }
  }
});

test('translation membership requires a catalogue entry in every language, including Spanish', () => {
  for (const locale of ['es', ...locales]) {
    setActiveLang(locale);
    for (const key of Object.keys(SIGN_TRANSLATIONS.en)) {
      assert.equal(hasTranslation(key), true, `${locale}: ${key}`);
    }
    for (const message of ['Internal detail /private/example', 'constructor', 'toString', '__proto__', 'hasOwnProperty', '']) {
      assert.equal(hasTranslation(message), false, `${locale}: ${message}`);
    }
  }
});

/**
 * A sentence this surface throws must arrive as itself, never as the generic line.
 *
 * `signErrorText` used to decide "is this one of ours?" against a three-item allow-list held
 * in `src/sign/errors.ts`, so its own view's sentences — "No hay documento.", "Confirma la
 * operación antes de firmar.", "Indica páginas válidas, por ejemplo: 1, 3-5." — were all
 * translated in eleven languages and still shown as "Could not complete the operation. Try
 * again." Typing a bad page range told the reader nothing. Asking the catalogue instead is
 * the fix; this is the part that keeps it fixed, because a new `throw new Error('…')` in the
 * Sign surface is otherwise invisible to `test-i18n-coverage.mjs` — that test reads `t()`
 * literals, and this prose reaches `t()` from a variable.
 */
test('every sentence the Sign surface throws reaches the reader in their own words', () => {
  const GENERIC_KEY = 'No se ha podido completar la operación. Vuelve a intentarlo.';
  const files = [
    'src/views/ToolkitSignView.tsx',
    ...fs.readdirSync('src/sign').filter((name) => /\.tsx?$/.test(name)).map((name) => `src/sign/${name}`),
  ];
  const literals = new Map();
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const pattern of [
      /new Error\(\s*'((?:[^'\\]|\\.)*)'/g,
      /new Error\(\s*"((?:[^"\\]|\\.)*)"/g,
      /new Error\(\s*`((?:[^`\\]|\\.)*)`/g,
    ]) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(source)) !== null) {
        // `${…}` carries a runtime value; a placeholder satisfies both \d+ and .+ catalogues.
        const text = match[1].replace(/\$\{[^}]*\}/g, '1').replace(/\\n/g, ' ').trim();
        if (!/[a-zA-Záéíóúñ]/.test(text) || text === GENERIC_KEY) continue;
        if (!literals.has(text)) literals.set(text, file);
      }
    }
  }
  assert.ok(literals.size > 0, 'the sweep found no error literals, so it is not reading the Sign surface');
  const erased = [];
  for (const locale of ['es', ...locales]) {
    errorRuntime.setActiveLang(locale);
    const generic = locale === 'es' ? GENERIC_KEY : SIGN_TRANSLATIONS[locale][GENERIC_KEY];
    for (const [text, file] of literals) {
      const shown = errorRuntime.signErrorText(new Error(text));
      if (shown === generic) erased.push(`${JSON.stringify(text)} — ${file} (${locale})`);
    }
  }
  assert.deepEqual(erased, [], `Sentences the Sign surface throws, shown as the generic line:\n  ${erased.join('\n  ')}`);
});
