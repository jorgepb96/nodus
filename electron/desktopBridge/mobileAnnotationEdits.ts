import type { StudyAnnotationInput } from '../../shared/studyEditor';

export interface MobileAnnotationCommand { action: 'annotationCreate'|'annotationUpdate'|'annotationDelete'; annotationId: string; expectedAnnotation: unknown; patch?: Partial<StudyAnnotationInput> & {resolved?: boolean}; }

/** Shared validation for individually replayable comments on study documents and workspace notes. */
export function parseMobileAnnotationCommand(raw: unknown): MobileAnnotationCommand {
  const action = raw as Record<string, unknown> | undefined;
  if (!action || typeof action !== 'object' || Array.isArray(action) || !['annotationCreate','annotationUpdate','annotationDelete'].includes(String(action.action)) || Object.keys(action).some(key => !['action','annotationId','expectedAnnotation','patch'].includes(key)) ||
      typeof action.annotationId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(action.annotationId) ||
      (action.action === 'annotationCreate' ? action.expectedAnnotation !== null : !action.expectedAnnotation || typeof action.expectedAnnotation !== 'object' || Array.isArray(action.expectedAnnotation))) throw new Error('invalid_mobile_annotation');
  const patch = action.patch as Record<string, unknown> | undefined;
  if (action.action === 'annotationDelete' ? patch !== undefined : !patch || typeof patch !== 'object' || Array.isArray(patch) ||
      Object.keys(patch).some(key => !['anchor','from','to','selectedText','comment','color','locked','pinned','resolved'].includes(key))) throw new Error('invalid_mobile_annotation');
  if (patch) {
    for (const key of ['from','to']) if (patch[key] !== undefined && (!Number.isSafeInteger(patch[key]) || Number(patch[key]) < 0)) throw new Error('invalid_mobile_annotation');
    for (const key of ['selectedText','comment']) if (patch[key] !== undefined && (typeof patch[key] !== 'string' || String(patch[key]).length > 1024 * 1024)) throw new Error('invalid_mobile_annotation');
    for (const key of ['locked','pinned','resolved']) if (patch[key] !== undefined && typeof patch[key] !== 'boolean') throw new Error('invalid_mobile_annotation');
    if (patch.color !== undefined && patch.color !== null && (typeof patch.color !== 'string' || patch.color.length > 128)) throw new Error('invalid_mobile_annotation');
    if (patch.anchor !== undefined && patch.anchor !== null) {
      const anchor = patch.anchor as Record<string, unknown>;
      if (typeof anchor !== 'object' || Array.isArray(anchor) || Object.keys(anchor).some(key => !['blockId','endBlockId','from','to'].includes(key)) ||
          typeof anchor.blockId !== 'string' || !anchor.blockId || anchor.blockId.length > 128 ||
          (anchor.endBlockId !== undefined && (typeof anchor.endBlockId !== 'string' || !anchor.endBlockId || anchor.endBlockId.length > 128)) ||
          !Number.isSafeInteger(anchor.from) || !Number.isSafeInteger(anchor.to) || Number(anchor.from) < 0 || Number(anchor.to) < Number(anchor.from)) throw new Error('invalid_mobile_annotation');
    }
    if (action.action === 'annotationCreate' && (typeof patch.comment !== 'string' || typeof patch.selectedText !== 'string' || !Number.isSafeInteger(patch.from) || !Number.isSafeInteger(patch.to) || Number(patch.to) < Number(patch.from))) throw new Error('invalid_mobile_annotation');
  }
  return action as unknown as MobileAnnotationCommand;
}
