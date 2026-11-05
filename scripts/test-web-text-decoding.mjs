import assert from 'node:assert/strict';
import test from 'node:test';
import {buildSync} from 'esbuild';
const built=buildSync({entryPoints:['shared/webTextDecoding.ts'],bundle:true,write:false,format:'cjs',platform:'browser'}),module={exports:{}};
new Function('module','exports',built.outputFiles[0].text)(module,module.exports);const {decodeWebText}=module.exports;
test('UTF-8 and legacy Spanish charsets preserve actual accents',()=>{assert.equal(decodeWebText(new TextEncoder().encode('presión, año, acción'),'text/html; charset=utf-8'),'presión, año, acción');const old=Buffer.from('presión, año, acción','latin1');assert.equal(decodeWebText(old,'text/html; charset="iso-8859-1"'),'presión, año, acción');assert.equal(decodeWebText(Buffer.from('<meta charset="windows-1252"><p>presión y año</p>','latin1'),'text/html'),'<meta charset="windows-1252"><p>presión y año</p>');});
test('HTTP charset takes precedence; unknown charset retains canonical UTF-8 fallback',()=>{const bytes=new TextEncoder().encode('<meta charset="iso-8859-1"><p>presión</p>');assert.equal(decodeWebText(bytes,'text/html; charset=UTF-8'),'<meta charset="iso-8859-1"><p>presión</p>');assert.equal(decodeWebText(bytes,'text/html; charset=unknown-encoding'),'<meta charset="iso-8859-1"><p>presión</p>');assert.equal(decodeWebText(Uint8Array.from([0xff]),'text/plain'),'�');});
