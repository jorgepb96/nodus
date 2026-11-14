import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {connectAcceptanceBridge} from './lib/mobileAcceptanceClient.mjs';

const client=await connectAcceptanceBridge('Autonomous writing acceptance');
try {
  const title='Aceptación asistencia autónoma 0.1.0';
  const original='La investigación sobre turismo analiza cómo la fotografía representa la autenticidad. Esta representación depende del contexto histórico. La propaganda utiliza imágenes y la fotografía utiliza imágenes; por eso, para estudiar esos materiales hay que estudiar las imágenes sin olvidar su contexto. El análisis conserva 37 observaciones de 2024, la referencia (García, 2023, p. 8), la fórmula $E=mc^2$ y el enlace [fuente](https://example.org/nodus-acceptance).';
  const tree=await client.operation('getNotesTree');
  const note=tree.notes.find(note=>note.title===title)??await client.operation('createNote',[{title,kind:'note',content:original,tags:['mobile-acceptance','fictional-writing-fixture']}]);
  let editor=await client.operation('getWorkspaceNoteEditorData',[note.id]);
  if(process.env.NODUS_ACCEPTANCE_RESET_WRITING==='1') {
    await client.operation('updateWorkspaceNote',[note.id,{title,contentMarkdown:original,expectedRevision:editor.revision}]);
    editor=await client.operation('getWorkspaceNoteEditorData',[note.id]);
    assert.equal(editor.contentMarkdown,original,'Only the disposable writing fixture is reset; its history is retained');
  }
  const logs=await client.operation('listStudyImprovementLog',[note.id]);
  if(process.env.NODUS_ACCEPTANCE_VERIFY_WRITING==='1') {
    const contentHash=createHash('sha256').update(editor.contentMarkdown).digest('hex');
    const applied=logs.find(log=>log.action==='replace' && log.modelProvider==='deepseek' && log.modelName==='deepseek-chat' && log.resultHash===contentHash);
    assert(applied,'The actual phone-owned provider must record the applied improvement on the Mac');
    assert(editor.contentMarkdown !== original,'The saved text must contain the actual improvement');
    for(const protectedValue of ['37','2024','García','2023','E=mc^2','https://example.org/nodus-acceptance']) assert(editor.contentMarkdown.includes(protectedValue),`Protected content missing: ${protectedValue}`);
    assert(editor.nativeDocument?.length>0 && editor.versions.length>0);
    const settings=await client.operation('getSettings');
    console.log(JSON.stringify({result:'passed',noteId:note.id,logId:applied.id,phoneModel:applied.modelName,macModel:settings.improveModel ?? settings.writingModel,
      chars:editor.contentMarkdown.length,editorRevision:editor.revision,versions:editor.versions.length,protectedContent:true,resultMatchesAppliedLog:true}));
  } else {
    fs.writeFileSync(`${process.env.NODUS_MOBILE_ACCEPTANCE_LAB}/autonomous-writing-fixture.json`,JSON.stringify({noteId:note.id,title,original,editorRevision:editor.revision}),{mode:0o600});
    console.log(JSON.stringify({prepared:true,noteId:note.id,title,chars:editor.contentMarkdown.length}));
  }
} finally {await client.close();}
