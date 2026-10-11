import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {installRuntimeHooks} from './lib/tsRuntimeHooks.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-device-database-export-'));
const runtime=installRuntimeHooks(directory),require=createRequire(import.meta.url);
try {
  const engine=require('../shared/databaseResearchEngine.ts'),mobile=require('../shared/mobileDatabaseResearch.ts'),files=require('../shared/databaseResearchExport.ts');
  const {unzipSync,strFromU8}=require('fflate'),esbuild=require('esbuild');
  const stamp='2026-10-11T00:00:00Z',database={id:'database',shortId:'DB-1',name:'Datos',icon:null,position:0,rowCount:20,createdAt:stamp,updatedAt:stamp};
  const columns=[{id:'metric',databaseId:database.id,name:'Métrica',type:'number',position:0,config:{},options:[]},{id:'text',databaseId:database.id,name:'Texto',type:'text',position:1,config:{},options:[]}];
  const rows=Array.from({length:20},(_,i)=>({id:`row-${i}`,databaseId:database.id,position:i,cells:{metric:String(i+1),text:'PRIVATE-RAW-CELL'}}));
  const snapshot={databaseId:database.id,databaseName:database.name,revision:1,rowCount:20,totalRowCount:20,truncated:false,columns:columns.map(column=>column.id),rows,relationEdges:[],capturedAt:stamp,hash:''};snapshot.hash=engine.rehashDatabaseResearchSnapshot(snapshot);
  const pack={version:1,vaultId:'vault',capturedAt:stamp,id:'',signature:'0'.repeat(64),databases:[{database,snapshot,columns,views:[],viewRows:{},viewId:null,viewRevision:null}]};pack.id=engine.sha256Snapshot(mobile.databaseSourcePackPayload(pack));
  const request={databaseIds:[database.id],objective:'Informe de datos',depth:'focused',language:'es',reportType:'general',autoConfigure:false,model:{provider:'openai',model:'fixture'},viewIds:[],filters:{query:'',columnIds:[]},roles:{},planSections:[]};
  const sources=mobile.mobileDatabaseSources([pack],request.databaseIds),repository=new mobile.MobileDatabaseResearchRepository(mobile.createMobileDatabaseResearchDetail('dbr_mobile_00000000-0000-4000-8000-000000000001',request,sources));
  const detail=await engine.processDatabaseResearchRun(repository.detail.run.id,{},mobile.mobileDatabaseResearchHost(repository,sources,async(...args)=>engine.runDatabaseDeepResearch(...args)));
  detail.report.markdown+='\n\n## Comprobación Unicode\n\nMemoria 🌊 y [Fuente](nodus://work/fixture).';
  const {report,...exportDetail}=detail,source={version:1,report,exportDetail,sourcePacks:[pack]};
  const bundle=path.join(directory,'device-export.mjs');
  await esbuild.build({absWorkingDir:root,entryPoints:['src/mobileWeb/databaseResearchExport.ts'],bundle:true,platform:'browser',target:'es2022',format:'esm',outfile:bundle,alias:{'@shared':path.join(root,'shared')},logLevel:'silent'});
  const {exportDeviceDatabaseResearch}=await import(pathToFileURL(bundle).href);
  const exported=[];
  const call=async(method,...args)=>{
    if(method==='getDatabaseResearchExportSource'){assert.equal(args[0],report.id);return source;}
    if(method==='surfaceExportFile'){
      const input=args[0],bytes=Buffer.from(input.base64,'base64');assert.equal(input.sha256,createHash('sha256').update(bytes).digest('hex'));exported.push({input,bytes});return {canceled:false,path:input.filename};
    }
    if(method==='surfaceExportPDF'){exported.push({input:args[0]});return {canceled:false,path:args[0].filename};}
    throw new Error(`An offline export cannot reach ${method}`);
  };
  await exportDeviceDatabaseResearch(call,report.id,{format:'markdown'});
  assert.equal(exported.at(-1).bytes.toString('utf8'),require('../shared/databaseDeepResearch.ts').redactDatabaseResearchMarkdown(report.markdown));
  await exportDeviceDatabaseResearch(call,report.id,{format:'docx'});
  const word=unzipSync(exported.at(-1).bytes);assert(strFromU8(word['word/document.xml']).includes('Memoria 🌊'));assert(strFromU8(word['word/document.xml']).includes('nodus://work/fixture'));assert(word['[Content_Types].xml']);
  await exportDeviceDatabaseResearch(call,report.id,{format:'pdf'});
  assert(exported.at(-1).input.html.includes('class="cover"'));assert(exported.at(-1).input.html.includes('Comprobación Unicode'));assert(exported.at(-1).input.html.includes('@page'));
  await exportDeviceDatabaseResearch(call,report.id,{format:'zip'});
  const archive=unzipSync(exported.at(-1).bytes),canonical=files.databaseResearchArchiveFiles(report,detail,{format:'zip'});
  assert.deepEqual(Object.keys(archive).sort(),Object.keys(canonical).sort());
  for(const [name,text] of Object.entries(canonical)){assert.equal(strFromU8(archive[name]),text);assert(!text.includes('PRIVATE-RAW-CELL'));}
  await exportDeviceDatabaseResearch(call,report.id,{format:'zip',includeSnapshot:true});
  const raw=unzipSync(exported.at(-1).bytes);assert(strFromU8(raw['snapshot/data.json']).includes('PRIVATE-RAW-CELL'));
  source.sourcePacks=structuredClone([pack]);source.sourcePacks[0].databases[0].snapshot.rows[0].cells.metric='999';
  await assert.rejects(exportDeviceDatabaseResearch(call,report.id,{format:'zip',includeSnapshot:true}),/source_pack/);
  delete source.exportDetail;
  await assert.rejects(exportDeviceDatabaseResearch(call,report.id,{format:'zip'}),/archivo reproducible/);
  await assert.rejects(exportDeviceDatabaseResearch(call,report.id,{format:'docx',includeSnapshot:true}),/Formato/);
  console.log('Browser-bundled offline Markdown, DOCX Unicode/citations, shared paginated PDF HTML, reproducible ZIP/redaction, raw snapshot proof and native file digests passed. Actual printing/share-sheet acceptance remains separate.');
} finally {runtime.restore();fs.rmSync(directory,{recursive:true,force:true});}
