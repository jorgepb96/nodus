import { useBlockNoteEditor, useComponentsContext, useDictionary, useEditorState } from '@blocknote/react';
import { Icon } from '../ui';

/** Both uploaded and generated images use the same native media block. */
export function EditorFileDeleteButton({ onRequestDelete }: { onRequestDelete(id: string): void }) {
  const editor = useBlockNoteEditor();
  const components = useComponentsContext()!;
  const dictionary = useDictionary();
  const block = useEditorState({ editor, selector: ({ editor }) => {
    if (!editor.isEditable) return undefined;
    const blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];
    return blocks.length === 1 && 'url' in blocks[0].props ? blocks[0] : undefined;
  } });
  if (!block) return null;
  const label = dictionary.formatting_toolbar.file_delete.tooltip[block.type] || dictionary.formatting_toolbar.file_delete.tooltip.file;
  const Button = components.FormattingToolbar.Button;
  return <Button className="bn-button" label={label} mainTooltip={label} icon={<Icon name="trash" size={18} />} onClick={() => onRequestDelete(block.id)} />;
}
