import { getDefaultReactSlashMenuItems } from '@blocknote/react';
import { EditorInsertController, EditorSideMenu, editorInsertMenuOptions, type EditorInsertHandle, type EditorInsertItem } from './EditorInsertMenu';
import { Icon } from '../ui';
import { EditorFileDownloadButton } from './EditorFileDownloadButton';
import { EditorFilePanel } from './EditorFilePanel';
import { uploadEditorFile } from './editorAttachments';
import { academicCitationSequence, academicInlines, academicTargets, type AcademicMetadata, type AcademicCitation } from '@shared/academicDocument';
import { formatAcademicSnapshot, singleAcademicSnapshot } from '@shared/academicCsl';
import { createContext, useContext, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { BlockNoteSchema, COLORS_DEFAULT, createHeadingBlockSpec, createStyleSpec, defaultBlockSpecs, defaultInlineContentSpecs, defaultStyleSpecs, type PartialBlock } from '@blocknote/core';
import { en, es } from '@blocknote/core/locales';
import { BlockNoteView } from '@blocknote/ariakit';
import { createReactBlockSpec, createReactInlineContentSpec, FilePanelController, FormattingToolbar, FormattingToolbarController, getFormattingToolbarItems, SideMenuController, SuggestionMenuController, useCreateBlockNote, type SideMenuProps } from '@blocknote/react';
import { editorSideMenuOptions } from './editorSideMenu';
import { insertOrUpdateBlockForSlashMenu, SuggestionMenu as SuggestionMenuExtension } from '@blocknote/core/extensions';
import { editorLinkAllowed, searchEditorReferences, type EditorReference } from '@shared/editorReferences';
import { ReferenceSuggestionMenu, type ReferenceSuggestion } from './EditorReferences';
import { TextSelection } from '@tiptap/pm/state';
import { closeHistory, redoDepth, undoDepth } from '@tiptap/pm/history';
import '@blocknote/ariakit/style.css';
import { blockNoteToMarkdown, markdownToBlockNote, nativeBlockMarkdown, nativeDocumentText, nativePlainText, type BlockNoteDocument, type NativeBlock } from '@shared/blockNoteDocument';
import type { StudyBlockAnchor } from '@shared/studyEditor';
import { Markdown } from '../Markdown';
import { getActiveLang, t } from '../../i18n';

const compatibility = createReactBlockSpec({ type: 'nodusMarkdown', propSchema: { markdown: { default: '' }, originalJson: { default: '' } }, content: 'none' }, {
  render: ({ block, editor }) => <div className="nodus-compatibility-block">
    <Markdown content={block.props.markdown} verify={false} />
    {editor.isEditable && <details><summary>{t('Editar bloque de compatibilidad')}</summary><textarea aria-label={t('Contenido original')} value={block.props.markdown} onChange={event => editor.updateBlock(block, { props: { markdown: event.target.value, originalJson: '' } })} /></details>}
  </div>,
})();
const wiki = createReactInlineContentSpec({ type: 'nodusWiki', propSchema: { reference: { default: '' }, label: { default: '' } }, content: 'none' }, {
  render: ({ inlineContent }) => <span className="nodus-wiki-link" data-wiki-reference={inlineContent.props.reference}>{inlineContent.props.label || inlineContent.props.reference}</span>,
});
const formula = createReactInlineContentSpec({ type: 'nodusFormula', propSchema: { formula: { default: '' } }, content: 'none' }, {
  render: function Formula({ inlineContent, editor, updateInlineContent }) {
    const [editing, setEditing] = useState(false), [draft, setDraft] = useState('');
    const input = useRef<HTMLInputElement>(null), committing = useRef(false);
    useEffect(() => { if (editing) { input.current?.focus(); input.current?.select(); } }, [editing]);
    const open = () => { if (!editor.isEditable) return; committing.current=false;setDraft(inlineContent.props.formula);setEditing(true); };
    const finish = (save: boolean, focus: boolean) => {
      if (committing.current) return;
      committing.current=true;
      if (save && draft.trim() && draft !== inlineContent.props.formula) editor.transact(tr => { closeHistory(tr); updateInlineContent({type:'nodusFormula',props:{formula:draft}}); });
      setEditing(false); if (focus) editor.focus();
    };
    return <span className="nodus-inline-formula" role={editor.isEditable&&!editing?'button':undefined} tabIndex={editor.isEditable&&!editing?0:undefined} aria-label={editing?undefined:t('Fórmula en línea')} onClick={event => { event.stopPropagation();if(!editing)open(); }} onKeyDown={event=>{if(!editing&&(event.key==='Enter'||event.key===' ')){event.preventDefault();event.stopPropagation();open();}}}>
      {editing ? <input ref={input} className="nodus-formula-input" aria-label={t('Fórmula en línea')} value={draft} onChange={event=>setDraft(event.target.value)} onBlur={()=>finish(true,false)} onKeyDown={event=>{event.stopPropagation();if(event.key==='Enter'||event.key==='Escape'){event.preventDefault();finish(event.key==='Enter',true);}}}/> : <Markdown content={`$${inlineContent.props.formula}$`} verify={false} />}
    </span>;
  },
});
const AcademicRender = createContext<{citations:Map<string,string>;notes:Map<string,number>;targets:Map<string,string>}>({citations:new Map(),notes:new Map(),targets:new Map()});
const academicCitation = createReactInlineContentSpec({type:'nodusCitation',propSchema:{payload:{default:''},label:{default:''}},content:'none'}, {
 render:({inlineContent})=>{const formatted=useContext(AcademicRender);let id='';try{id=JSON.parse(inlineContent.props.payload).citationId;}catch{}return <span className="academic-citation" data-academic-citation={inlineContent.props.payload} role="button" tabIndex={0}>{formatted.citations.get(id) || inlineContent.props.label}</span>;}
});
const academicFootnote = createReactInlineContentSpec({type:'nodusFootnote',propSchema:{noteId:{default:''},label:{default:''}},content:'none'}, {
 render:({inlineContent})=>{const formatted=useContext(AcademicRender);return <sup className="academic-note-call" data-academic-note={inlineContent.props.noteId} role="button" tabIndex={0}>{formatted.notes.get(inlineContent.props.noteId) ?? inlineContent.props.label ?? '•'}</sup>;}
});
const academicCrossReference = createReactInlineContentSpec({type:'nodusCrossReference',propSchema:{targetId:{default:''},documentId:{default:''},documentKind:{default:'note'},label:{default:''}},content:'none'}, {
 render:({inlineContent})=>{const formatted=useContext(AcademicRender);return <span className="academic-cross-reference" role="button" tabIndex={0} data-academic-document={inlineContent.props.documentId} data-academic-kind={inlineContent.props.documentKind} data-academic-target={inlineContent.props.targetId}>{formatted.targets.get(inlineContent.props.targetId)??inlineContent.props.label}</span>}
});
function colorStyle<T extends 'textColor' | 'backgroundColor'>(type: T) {
  const property = type === 'textColor' ? 'color' : 'backgroundColor';
  const render = (value: string, external = false) => {
    const span = document.createElement('span');
    // BlockNote's palette is styled by its theme. Arbitrary CSS colors from
    // existing documents also need a renderer, rather than only an exporter.
    if (value !== 'default' && (external || !(value in COLORS_DEFAULT))) {
      const color = external && value in COLORS_DEFAULT ? COLORS_DEFAULT[value as keyof typeof COLORS_DEFAULT][type === 'textColor' ? 'text' : 'background'] : value;
      if (CSS.supports('color',color)) span.style[property] = color;
    }
    return {dom:span,contentDOM:span};
  };
  return createStyleSpec({type,propSchema:'string'}, {render: value => render(value),toExternalHTML: value => render(value,true),parse: element => element.tagName === 'SPAN' && element.style[property] ? element.style[property] : undefined});
}
const schema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, heading: createHeadingBlockSpec({ levels: [1, 2, 3, 4, 5, 6] }), nodusMarkdown: compatibility },
  inlineContentSpecs: { ...defaultInlineContentSpecs, nodusWiki: wiki, nodusFormula: formula, nodusCitation: academicCitation, nodusFootnote: academicFootnote, nodusCrossReference: academicCrossReference },
  styleSpecs: { ...defaultStyleSpecs, textColor: colorStyle('textColor'), backgroundColor: colorStyle('backgroundColor') },
});

/** Unknown native types are displayed through a reversible compatibility block. */
function forEditor(document: BlockNoteDocument): PartialBlock<typeof schema.blockSchema, typeof schema.inlineContentSchema, typeof schema.styleSchema>[] {
  const supportedInline = (value: unknown): boolean => !Array.isArray(value) || value.every(item => {
    if (!item || !(item.type in schema.inlineContentSchema)) return false;
    if (item.type === 'text') return Object.keys(item).every(key => ['type','text','styles'].includes(key)) && Object.keys(item.styles ?? {}).every(key => key in schema.styleSchema);
    if (item.type === 'link') return supportedInline(item.content);
    return true;
  });
  return document.map(block => {
    const children = forEditor(block.children ?? []);
    const contentSupported = block.type === 'table' && block.content && !Array.isArray(block.content)
      ? ((block.content as { rows?: Array<{cells: unknown[]}> }).rows ?? []).every(row => row.cells.every(cell => supportedInline(Array.isArray(cell) ? cell : (cell as {content?:unknown})?.content)))
      : supportedInline(block.content);
    if (!(block.type in schema.blockSchema) || !contentSupported) return { id: block.id, type: 'nodusMarkdown', props: { markdown: String(block.props.markdown ?? nativePlainText(block.content)) || nativeBlockMarkdown(block), originalJson: JSON.stringify({ ...block, children: [] }) }, children };
    return { ...block, children } as PartialBlock<typeof schema.blockSchema, typeof schema.inlineContentSchema, typeof schema.styleSchema>;
  });
}
function fromEditor(document: BlockNoteDocument, originals: Map<string, NativeBlock>): BlockNoteDocument {
  return document.map(block => {
    const children = fromEditor(block.children ?? [], originals);
    if (block.type === 'nodusMarkdown' && block.props.originalJson) {
      try { return { ...JSON.parse(String(block.props.originalJson)), children }; } catch { /* editable Markdown stays available */ }
    }
    return { ...block, props: { ...originals.get(block.id)?.props, ...block.props }, children };
  });
}

export interface BlockNoteCanvasHandle {
  insertText(text: string, replaceSelection: boolean): void;
  insertMarkdown(markdown: string): void;
  preserveSelection(): void;
  restoreSelection(): boolean;
  selectionSnapshot(): { text: string; occurrence: number; anchor?: StudyBlockAnchor; range: { from: number; to: number } };
  runInlineCommand(command: 'code' | 'formula'): void;
  setHeading(level: number): void;
  setTextColor(color: string): void;
  undo(): void;
  redo(): void;
  replaceAllMarkdown(markdown: string, options?: { addToHistory?: boolean; closeHistory?: boolean }): void;
  replaceSelectionMarkdown(range: { from: number; to: number }, markdown: string): void;
  openReferenceMenu(): void;
  insertAcademicInline(inline: import('@shared/blockNoteDocument').NativeInline, range?: {from:number;to:number}): void;
  jumpToBlock(id:string): void;
  replaceAcademicCitation(payload:string):void;
  setCaption(blockId:string,caption:string):void;
}
export const BlockNoteCanvas = forwardRef<BlockNoteCanvasHandle, {
  documentId: string;
  academicMetadata?: AcademicMetadata;
  onAcademicAction?(action:'cite'|'note'|'crossref', payload?:string):void;
  academicActions?: Array<'cite'|'note'|'crossref'>;
  value: string;
  nativeDocument?: BlockNoteDocument | null;
  editable?: boolean;
  spellcheck?: boolean;
  language?: string;
  onChange(markdown: string, document: BlockNoteDocument): void;
  onHistoryChange?(state: { canUndo: boolean; canRedo: boolean }): void;
  onOpenRecording?(id: string, timestamp?: number | null): void;
  onNavigateLink?(href: string): void;
  onWikiLink?(reference: string): void;
  onToolbarElement?(element: HTMLElement | null): void;
  listReferences?(): Promise<EditorReference[]>;
}>(({ documentId, value, academicMetadata, onAcademicAction, academicActions, nativeDocument, editable = true, spellcheck = true, language = 'es-ES', onChange, onHistoryChange, onOpenRecording, onNavigateLink, onWikiLink, onToolbarElement, listReferences }, ref) => {
  const initial = useMemo(() => nativeDocument ?? markdownToBlockNote(value), [documentId]);
  const originals = useMemo(() => {
    const result = new Map<string, NativeBlock>();
    const visit = (blocks: NativeBlock[]) => blocks.forEach(block => { result.set(block.id, block); visit(block.children ?? []); });
    visit(initial); return result;
  }, [initial]);
  const initialContent = useMemo(() => forEditor(initial), [initial]);
  const editor = useCreateBlockNote({ schema, initialContent: initialContent.length ? initialContent : undefined, uploadFile: uploadEditorFile, dictionary: getActiveLang() === 'es' ? es : en, links: { isValidLink: editorLinkAllowed } }, [documentId]);
  const root = useRef<HTMLDivElement>(null);
  const insertController = useRef<EditorInsertHandle>(null);
  const InsertSideMenu = useMemo(() => function NodusSideMenu(props: SideMenuProps) {
    return <EditorSideMenu {...props} onAddBlock={blockId => insertController.current?.openAtBlock(blockId)} />;
  }, []);
  const selectionCheckpoint = useRef<{ editor: typeof editor; document: typeof editor.prosemirrorState.doc; bookmark: ReturnType<typeof editor.prosemirrorState.selection.getBookmark> } | null>(null);
  const citationCache = useRef<{key:string;citations:Map<string,string>} | null>(null);
  const academicRender = useMemo(()=>{
    let citations = new Map<string,string>();
    if (academicMetadata && nativeDocument) {
      const snapshot = singleAcademicSnapshot(documentId,'',nativeDocument,academicMetadata);
      // A paragraph insertion or text edit must not rebuild two CSL engines.
      const sequence = academicCitationSequence(snapshot);
      const key = JSON.stringify([sequence,academicMetadata.style,academicMetadata.locale,academicMetadata.placement,academicMetadata.customStyleXml]);
      if (citationCache.current?.key === key) citations = citationCache.current.citations;
      else {
        if (sequence.length) try {const result=formatAcademicSnapshot(snapshot);citations=new Map(result.citations.map(c=>[c.citationId, academicMetadata.placement==='in-text'?c.text:String(c.noteIndex)]));} catch { /* The delivery inspector reports unresolved citations. */ }
        citationCache.current = {key,citations};
      }
    }
    const notes=new Map<string,number>();let no=0;for(const {inline} of academicInlines(nativeDocument??[])){if(inline.type==='nodusCitation'&&academicMetadata?.placement!=='in-text')no++;if(inline.type==='nodusFootnote'){const id=String(inline.props?.noteId);notes.set(id,++no);}}
    const targets=new Map([...academicTargets(singleAcademicSnapshot(documentId,'',nativeDocument??[],academicMetadata!)).entries()].map(([id,target])=>[id,target.label]));
    return {citations,notes,targets};
  },[nativeDocument,academicMetadata,documentId]);
  const academicActionRef=useRef(onAcademicAction);academicActionRef.current=onAcademicAction;
  const referenceLoader = useRef(listReferences);
  referenceLoader.current = listReferences;
  const catalog = useRef<{ promise: Promise<EditorReference[]>; expires: number } | null>(null);
  useEffect(() => { const invalidate = () => { catalog.current = null; }; window.addEventListener('nodus:data-changed', invalidate); return () => window.removeEventListener('nodus:data-changed', invalidate); }, []);
  const getReferences = useCallback(async (query: string): Promise<ReferenceSuggestion[]> => {
    if (!catalog.current || catalog.current.expires < Date.now()) catalog.current = { promise: referenceLoader.current?.() ?? Promise.resolve([]), expires: Date.now() + 30_000 };
    try {
      const items = searchEditorReferences(await catalog.current.promise, query);
      return items.length ? items.map(reference => ({ reference, query })) : [{ message: 'empty', query }];
    } catch { catalog.current = null; return [{ message: 'error', query }]; }
  }, [documentId]);
  const insertItems = useMemo((): EditorInsertItem[] => {
    const items = getDefaultReactSlashMenuItems(editor) as EditorInsertItem[];
    const inline = (type:'nodusFormula'|'code') => {
      editor.insertInlineContent(type === 'nodusFormula' ? [{ type, props: { formula: 'x^2' } }] : [{type:'text',text:t('Código'),styles:{code:true}}]);
      editor.focus();
    };
    items.push({key:'nodus_formula',title:t('Fórmula en línea'),aliases:['formula','math','latex','ecuacion'],group:t('Inserción'),icon:<span aria-hidden="true">ƒx</span>,onItemClick:()=>inline('nodusFormula')},
      {key:'nodus_code',title:t('Código en línea'),aliases:['inline code','codigo'],group:t('Inserción'),icon:<Icon name="code" size={18}/>,onItemClick:()=>inline('code')},
      {key:'nodus_quiz',title:t('Insertar pregunta de test'),subtext:t('Plantilla editable'),aliases:['quiz','test','pregunta'],group:t('Inserción'),icon:<Icon name="help" size={18}/>,onItemClick:()=>{
        insertOrUpdateBlockForSlashMenu(editor,{type:'paragraph',content:t('Pregunta'),children:[{type:'checkListItem',content:'A. …'},{type:'checkListItem',content:'B. …'},{type:'checkListItem',content:'C. …'}]});editor.focus();
      }});
    if (listReferences) items.push({key:'nodus_link',title:t('Enlazar con Nodus'),aliases:['link','enlace','idea','autor','obra','[['],group:t('Académico'),icon:<Icon name="link" size={18}/>,onItemClick:()=>{editor.focus();editor.getExtension(SuggestionMenuExtension)?.openSuggestionMenu('[[');}});
    if (onAcademicAction) for (const [key,title,action,aliases,icon] of [
      ['nodus_cite','Citar fuente','cite',['cite','cita bibliografica'],'quote'],
      ['nodus_note','Nota al pie','note',['footnote','nota'],'notebook'],
      ['nodus_crossref','Referencia cruzada','crossref',['reference','figura','tabla'],'link'],
    ] as const) { if (academicActions && !academicActions.includes(action)) continue; items.push({key,title:t(title),aliases:[...aliases],group:t('Académico'),icon:<Icon name={icon} size={18}/>,onItemClick:()=>academicActionRef.current?.(action)}); }
    return items;
  }, [editor, Boolean(listReferences), Boolean(onAcademicAction), academicActions?.join(',')]);
  const [theme,setTheme] = useState<'light'|'dark'>(()=>document.documentElement.classList.contains('dark')?'dark':'light');
  useEffect(()=>{ const update=()=>setTheme(document.documentElement.classList.contains('dark')?'dark':'light'); const observer=new MutationObserver(update);observer.observe(document.documentElement,{attributes:true,attributeFilter:['class']});return ()=>observer.disconnect(); },[]);
  const read = () => fromEditor(editor.document as unknown as BlockNoteDocument, originals);
  useEffect(()=>{try{const jump=JSON.parse(sessionStorage.getItem('nodus.academicJump')??'null');if(jump&&documentId.startsWith(jump.documentId)){requestAnimationFrame(()=>requestAnimationFrame(()=>{root.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(jump.blockId)}"]`)?.scrollIntoView({block:'center'});}));sessionStorage.removeItem('nodus.academicJump');}}catch{}},[documentId]);
  const notifyHistory = () => queueMicrotask(() => { const state = editor.prosemirrorState; onHistoryChange?.({ canUndo: undoDepth(state) > 0, canRedo: redoDepth(state) > 0 }); });
  const mountToolbar = useCallback((element: HTMLSpanElement | null) => onToolbarElement?.(element), [onToolbarElement]);
  // Stable component and ref identities prevent a portal mount from causing an
  // endless unmount/setState/remount cycle while text is selected.
  const SelectionToolbar = useMemo(() => function NodusSelectionToolbar() {
    const [more, setMore] = useState(false);
    const advanced = new Set(['strikeStyleButton', 'textAlignLeftButton', 'textAlignCenterButton', 'textAlignRightButton', 'nestBlockButton', 'unnestBlockButton']);
    const items = getFormattingToolbarItems().map(item => item.key === 'fileDownloadButton' ? <EditorFileDownloadButton key={item.key} /> : item);
    return <FormattingToolbar>{items.filter(item => !advanced.has(String(item.key)))}{onAcademicAction&&<button type="button" className="bn-button" title={t('Citar fuente')} aria-label={t('Citar fuente')} onMouseDown={event=>event.preventDefault()} onClick={()=>academicActionRef.current?.('cite')}>❞</button>}<span ref={mountToolbar} className="study-selection-tools-host" /><div className="editorial-selection-more"><button type="button" className="bn-button" aria-label={t('Más formato')} title={t('Más formato')} aria-expanded={more} onMouseDown={event => event.preventDefault()} onClick={() => setMore(!more)}>···</button>{more && <div className="editorial-selection-more-menu">{items.filter(item => advanced.has(String(item.key)))}<button type="button" className="bn-button" title={t('Fórmula en línea')} onClick={() => editor.insertInlineContent([{ type: 'nodusFormula', props: { formula: editor.getSelectedText() || 'x^2' } }])}>ƒx</button></div>}</div></FormattingToolbar>;
  }, [editor,mountToolbar]);
  useEffect(() => {
    const content = root.current?.querySelector<HTMLElement>('.bn-editor');
    content?.setAttribute('spellcheck', String(spellcheck));
    content?.setAttribute('lang', language);
    content?.setAttribute('aria-label', t('Editor del documento'));
  }, [editor, spellcheck, language]);
  useImperativeHandle(ref, () => ({
    preserveSelection() {
      const state = editor.prosemirrorState;
      selectionCheckpoint.current = { editor, document: state.doc, bookmark: state.selection.getBookmark() };
    },
    restoreSelection() {
      const checkpoint = selectionCheckpoint.current;
      if (!checkpoint || checkpoint.editor !== editor || !checkpoint.document.eq(editor.prosemirrorState.doc)) return false;
      editor.transact(tr => { tr.setSelection(checkpoint.bookmark.resolve(tr.doc)); tr.setMeta('addToHistory', false); });
      editor.focus();
      return true;
    },
    insertAcademicInline(inline,range) {
      editor.transact(tr=>{
        closeHistory(tr);
        const end = range && range.to<=tr.doc.content.size ? range.to : tr.selection.to;
        tr.setSelection(TextSelection.create(tr.doc,end));
        const before=tr.doc.resolve(end).nodeBefore;
        const space=(inline.type==='nodusCitation'||inline.type==='nodusCrossReference')&&before&&(before.isAtom||!(/\s$/.test(before.textContent))) ? [{type:'text',text:' ',styles:{}}] : [];
        editor.insertInlineContent([...space,inline] as any);
      });editor.focus();
    },
    replaceAcademicCitation(payload) {
      const replacement=JSON.parse(payload) as AcademicCitation;
      const sources=new Map(replacement.sources.map(source=>[source.id,source]));
      const rewrite=(value:any):any=>{
        if(Array.isArray(value))return value.map(rewrite);
        if(!value||typeof value!=='object')return value;
        if(value.type==='nodusCitation') {
          try {
            const citation=JSON.parse(value.props.payload) as AcademicCitation;
            const next=citation.citationId===replacement.citationId?replacement:{...citation,sources:citation.sources.map(source=>sources.get(source.id)??source),citationItems:citation.citationItems.map(item=>sources.has(item.id)?{...item,snapshot:{citationKey:sources.get(item.id)!.citationKey,metadata:sources.get(item.id)!.metadata}}:item)};
            return {...value,props:{...value.props,payload:JSON.stringify(next)}};
          }catch{return value;}
        }
        return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,rewrite(item)]));
      };
      const visit=(blocks:any[])=>{for(const block of blocks){const content=rewrite(block.content);if(JSON.stringify(content)!==JSON.stringify(block.content))editor.updateBlock(block,{content});visit(block.children??[]);}};
      editor.transact(tr=>{closeHistory(tr);visit(editor.document);});
    },
    setCaption(id,caption) {
      const block=editor.getBlock(id);if(!block)return;
      originals.set(id,{...read().find(b=>b.id===id)??block,props:{...block.props,caption}} as NativeBlock);
      if(block.type==='image')editor.updateBlock(block,{props:{caption}});
      const doc=read();onChange(blockNoteToMarkdown(doc),doc);
    },
    jumpToBlock(id) {const element=root.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);element?.scrollIntoView({block:'center',behavior:'smooth'});if(editor.getBlock(id)){editor.setTextCursorPosition(id,'start');editor.focus();}},
    openReferenceMenu() { editor.focus(); editor.getExtension(SuggestionMenuExtension)?.openSuggestionMenu('[['); },
    insertText(text, replaceSelection) {
      editor.transact(tr => { if (!replaceSelection) tr.setSelection(TextSelection.near(tr.doc.resolve(tr.selection.from))); editor.insertInlineContent(text); });
      editor.focus();
    },
    insertMarkdown(markdown) {
      const cursor = editor.getTextCursorPosition().block;
      const blocks = forEditor(markdownToBlockNote(markdown));
      if (cursor.type === 'paragraph' && !nativeDocumentText([cursor as unknown as NativeBlock])) editor.replaceBlocks([cursor], blocks);
      else editor.insertBlocks(blocks, cursor, 'after');
      editor.focus();
    },
    selectionSnapshot() {
      const text = editor.getSelectedText();
      const cut = editor.getSelectionCutBlocks();
      const blockId = cut.blocks[0]?.id ?? editor.getTextCursorPosition().block.id;
      const state = editor.prosemirrorState;
      const before = state.doc.textBetween(0, state.selection.from, '\n');
      return { text, occurrence: text ? before.split(text).length - 1 : 0, range: { from: state.selection.from, to: state.selection.to }, anchor: { blockId, endBlockId: cut.blocks.at(-1)?.id, from: state.selection.$from.parentOffset, to: state.selection.$to.parentOffset } };
    },
    runInlineCommand(command) { if (command === 'code') editor.toggleStyles({ code: true }); else editor.insertInlineContent([{ type: 'nodusFormula', props: { formula: editor.getSelectedText() || 'x^2' } }]); editor.focus(); },
    setHeading(level) { editor.updateBlock(editor.getTextCursorPosition().block, level ? { type: 'heading', props: { level } } : { type: 'paragraph' }); editor.focus(); },
    setTextColor(color) { editor.addStyles({ textColor: color }); editor.focus(); },
    undo() { editor.undo(); notifyHistory(); },
    redo() { editor.redo(); notifyHistory(); },
    replaceAllMarkdown(markdown, options = {}) {
      const blocks = forEditor(markdownToBlockNote(markdown, read()));
      editor.transact(tr => {
        if (options.addToHistory === false) tr.setMeta('addToHistory', false);
        if (options.closeHistory) closeHistory(tr);
        editor.replaceBlocks(editor.document, blocks);
      });
    },
    replaceSelectionMarkdown(range, markdown) {
      let protectedAcademic=false;editor.prosemirrorState.doc.nodesBetween(range.from,range.to,node=>{if(['nodusCitation','nodusFootnote','nodusCrossReference'].includes(node.type.name))protectedAcademic=true;});
      if(protectedAcademic)throw new Error(t('Selecciona el texto entre las citas para conservar sus referencias al mejorar con IA.'));
      const blocks = forEditor(markdownToBlockNote(markdown));
      editor.transact(tr => {
        closeHistory(tr);
        tr.setSelection(TextSelection.create(tr.doc, range.from, range.to));
        if (blocks.length === 1 && Array.isArray(blocks[0].content)) editor.insertInlineContent(blocks[0].content);
        else editor.pasteHTML(editor.blocksToHTMLLossy(blocks));
      });
      editor.focus();
      notifyHistory();
    },
  }));
  return <div ref={root} className="nodus-blocknote" data-document-id={documentId} onTouchEnd={event => {
    // Embedded WebKit can leave DOM focus on the catalogue control after a touch
    // selects an editable paragraph. Focus within the same user gesture, preserving
    // the browser's caret and letting noneditable formula/media controls keep focus.
    const target = event.target as HTMLElement;
    if (editable && target.isContentEditable && !editor.prosemirrorView.hasFocus()) {
      const touch = event.changedTouches[0];
      const position = touch && editor.prosemirrorView.posAtCoords({ left: touch.clientX, top: touch.clientY });
      if (position) editor.transact(tr => tr.setSelection(TextSelection.near(tr.doc.resolve(position.pos))));
      editor.focus();
    }
  }} onKeyDown={event=>{const target=event.target as HTMLElement;if((event.key==='Enter'||event.key===' ')&&target.matches('[data-academic-citation],[data-academic-note],[data-academic-target]')){event.preventDefault();target.click();}}} onClickCapture={event => {
    const target = event.target as HTMLElement;
    const cite=target.closest<HTMLElement>('[data-academic-citation]');if(cite&&editable){event.preventDefault();onAcademicAction?.('cite',cite.dataset.academicCitation);return;}
    const note=target.closest<HTMLElement>('[data-academic-note]');if(note&&editable){event.preventDefault();onAcademicAction?.('note',note.dataset.academicNote);return;}
    const cross=target.closest<HTMLElement>('[data-academic-target]');if(cross){event.preventDefault();const element=root.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(cross.dataset.academicTarget??'')}"]`);if(element)element.scrollIntoView({block:'center'});else if(cross.dataset.academicDocument){sessionStorage.setItem('nodus.academicJump',JSON.stringify({documentId:cross.dataset.academicDocument,blockId:cross.dataset.academicTarget}));onNavigateLink?.(`nodus://${cross.dataset.academicKind==='study'?'study/doc':'note'}/${encodeURIComponent(cross.dataset.academicDocument)}`);}return;}

    const wiki = target.closest<HTMLElement>('[data-wiki-reference]');
    if (wiki) { event.preventDefault(); event.stopPropagation(); const reference = wiki.dataset.wikiReference ?? ''; if (reference.startsWith('nodus://')) onNavigateLink?.(reference); else onWikiLink?.(reference); return; }
    const anchor = target.closest<HTMLAnchorElement>('a[href]'); if (!anchor) return;
    const href = anchor.getAttribute('href') ?? '';
    event.preventDefault(); event.stopPropagation();
    const match = href.match(/^nodus:\/\/study\/recording\/([^?]+)(?:\?(.*))?/);
    if (match) onOpenRecording?.(decodeURIComponent(match[1]), Number(new URLSearchParams(match[2]).get('t')) || null);
    else if (onNavigateLink) onNavigateLink(href);
    else if (/^https?:\/\//i.test(href)) window.open(href,'_blank','noopener,noreferrer');
  }}>
    <AcademicRender.Provider value={academicRender}><BlockNoteView editor={editor} editable={editable} formattingToolbar={false} sideMenu={false} slashMenu={false} filePanel={false} theme={theme} onChange={() => {
      const next = read(); onChange(blockNoteToMarkdown(next), next); notifyHistory();
    }}>
      <FormattingToolbarController formattingToolbar={SelectionToolbar} floatingUIOptions={{ elementProps: { style: { zIndex: 40, paddingInline: 12 } } }} />
      {editable && <FilePanelController filePanel={EditorFilePanel} floatingUIOptions={editorInsertMenuOptions} />}
      {editable && <SideMenuController sideMenu={InsertSideMenu} floatingUIOptions={editorSideMenuOptions} />}
      {listReferences && editable && <SuggestionMenuController triggerCharacter="[[" getItems={getReferences} suggestionMenuComponent={ReferenceSuggestionMenu} shouldOpen={tr => !tr.selection.$from.parent.type.spec.code} onItemClick={item => {
        if (item.reference) editor.insertInlineContent([{ type: 'link', href: item.reference.href, content: [{ type: 'text', text: item.reference.title, styles: {} }] }, ' ']);
        // Enter in an empty/error state must never discard what the user typed.
        else editor.insertInlineContent(`[[${item.query}`);
        editor.focus();
      }} />}
      {editable && <EditorInsertController ref={insertController} items={insertItems} />}
    </BlockNoteView></AcademicRender.Provider>
  </div>;
});
BlockNoteCanvas.displayName = 'BlockNoteCanvas';
