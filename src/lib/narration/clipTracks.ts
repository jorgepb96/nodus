// SPDX-License-Identifier: AGPL-3.0-only
import type { AudioClip, AudioSegment } from '@shared/types';
import type { PlayerTrack } from '../../components/AudioPlayer';

/** Player tracks for an item's saved clips. The read-along highlight resolves each one by its
 *  clip id; `segments`, when the caller has them, fill the text of clips saved before clips
 *  kept their fragments' text. */
export function clipTracks(clips: readonly AudioClip[], fallbackLabel: string, segments?: readonly AudioSegment[]): PlayerTrack[] {
  return clips.filter((clip) => !clip.missing).map((clip) => ({
    id: clip.id,
    label: clip.segmentLabel || fallbackLabel,
    durationS: clip.durationSec,
    sync: { kind: 'clip', clipId: clip.id, segmentIndex: clip.segmentIndex, text: segments?.find((segment) => segment.index === clip.segmentIndex)?.text },
  }));
}
