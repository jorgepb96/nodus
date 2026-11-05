import {readyDocumentFigures} from '../../shared/documentFigureExport';
import type {DocumentVisualManifest,DocumentVisualTarget} from '../../shared/documentSkills';
import {getDocumentVisuals} from '../ai/documentVisuals';
import {getChatImage} from '../chatAssets';
/** Standalone HTML/Word/Markdown exports cannot retain a private protocol URI.
 * Materialize at the explicit export boundary, never in the authored checkpoint. */
export function materializeDocumentVisualPosters(manifest:DocumentVisualManifest|null):DocumentVisualManifest|null {
 if(!manifest)return null;const result=structuredClone(manifest);
 for(const figure of readyDocumentFigures(result)){if(!figure.poster?.startsWith('nodus-image://chat/'))continue;const prefix=`nodus-image://chat/${figure.owner}/`;if(!figure.poster.startsWith(prefix))throw new Error('Document figure poster owner mismatch.');const image=getChatImage(figure.poster.slice('nodus-image://chat/'.length));if(!image||image.mime!=='image/png')throw new Error('The saved document figure image is unavailable for export.');figure.poster=`data:image/png;base64,${image.blob.toString('base64')}`;}
 return result;
}
export function getDocumentVisualsForExport(target:DocumentVisualTarget){return materializeDocumentVisualPosters(getDocumentVisuals(target));}
