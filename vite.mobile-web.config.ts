import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';
import { MOBILE_OPERATIONS } from './shared/mobileOperations';

const output = path.resolve(process.env.NODUS_MOBILE_SURFACE_OUT || '../nodus-mobile/ios/Nodus/Resources/SharedDesktop');
const chatRead=process.env.NODUS_MOBILE_CHAT_READ==='1';

export default defineConfig({
  root: path.resolve(__dirname, 'src/mobileWeb'), base: './',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  resolve: { alias: [{ find: '@shared', replacement: path.resolve(__dirname, 'shared') },
    { find: /^.*\/AudioPanel$/, replacement: path.resolve(__dirname, 'src/mobileWeb/MobileAudio.tsx') },
    { find: /^.*\/StudyDictation$/, replacement: path.resolve(__dirname, 'src/mobileWeb/MobileAudio.tsx') },
    { find: '../i18n', replacement: path.resolve(__dirname, 'src/serverWeb/i18nShim.ts') },
    { find: '../../i18n', replacement: path.resolve(__dirname, 'src/serverWeb/i18nShim.ts') }] },
  plugins: [{ name: 'mobile-inline-layout-worker', enforce: 'pre', transform(code, id) {
    if (!/\/stellarGraph\/(StellarCanvas|CorpusContext)\.tsx$/.test(id)) return;
    // WKWebView file documents cannot create module workers from another file URL.
    // Bundle the shared layout engine into a blob worker rather than fetching it.
    const transformed = code.replace(/new Worker\(new URL\("\.\/layout\.worker\.ts", import\.meta\.url\),\s*\{\s*type:\s*"module",?\s*\}\)/g, 'mobileLayoutWorker()');
    if (transformed === code) throw new Error(`Shared graph worker pattern changed: ${id}`);
    return `import MobileLayoutWorker from './layout.worker?worker&inline';\nfunction mobileLayoutWorker(){const w=new MobileLayoutWorker();w.addEventListener('error',e=>window.dispatchEvent(new ErrorEvent('error',{message:'Graph worker: '+e.message+' ('+e.filename+':'+e.lineno+')'})));return w;}\n${transformed}`;
  } }, react(), { name: 'mobile-local-document', writeBundle() {
    if(chatRead) {
      fs.writeFileSync(path.join(output,'chat-read.html'),`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: nodus-image: nodus-library: nodus-archive:; media-src 'self' data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><link rel="stylesheet" href="./chat-read.css"></head><body><div id="root"></div><script src="./chat-read.iife.js"></script></body></html>`);return;
    }
    fs.writeFileSync(path.join(output, 'operations.json'), JSON.stringify({ version: 2, operations: MOBILE_OPERATIONS }));
    fs.writeFileSync(path.join(output, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'self' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: nodus-image: nodus-library: nodus-archive:; media-src 'self' data: blob: nodus-library: nodus-archive:; frame-src 'self' nodus-library: nodus-archive:; connect-src 'none'; object-src 'none'; base-uri 'none'"><link rel="stylesheet" href="./surface.css"><title>Nodus</title></head><body><div id="root"></div></body></html>`);
  } }],
  worker: { format: 'iife' },
  build: { outDir: output, emptyOutDir: !chatRead,
    lib: { entry: path.resolve(__dirname, chatRead?'src/mobileWeb/chatRead.tsx':'src/mobileWeb/main.tsx'), formats: ['iife'], name: chatRead?'NodusChatRead':'NodusMobile', fileName: chatRead?'chat-read':'surface', cssFileName: chatRead?'chat-read':'surface' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
