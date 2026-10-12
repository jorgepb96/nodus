import { DECORATIVE_IMAGE_STYLES } from '../../shared/imageStyles';
import { generateReportImageAndWait } from '../ai/decorativeImages';
import type { DecorativeImageStyle } from '../../shared/types';

export function reportImageRequest(raw: unknown): { entityId: string; style: DecorativeImageStyle; visualContext?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_report_image_request');
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some(key => !['entityId', 'style', 'visualContext'].includes(key)) ||
      typeof value.entityId !== 'string' || !value.entityId || value.entityId.length > 256 || /[\u0000-\u001f\u007f]/.test(value.entityId) ||
      !DECORATIVE_IMAGE_STYLES.some(style => style.id === value.style) ||
      value.visualContext != null && (typeof value.visualContext !== 'string' || value.visualContext.length > 4000)) {
    throw new Error('invalid_report_image_request');
  }
  return { entityId: value.entityId, style: value.style as DecorativeImageStyle,
    ...(typeof value.visualContext === 'string' ? { visualContext: value.visualContext } : {}) };
}

export async function generateMobileReportImage(raw: unknown, onProgress: (phase: string) => void, signal?: AbortSignal) {
  const request = reportImageRequest(raw);
  return generateReportImageAndWait(request.entityId, request.style, request.visualContext, onProgress, signal);
}
