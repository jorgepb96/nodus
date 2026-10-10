import fs from 'node:fs';
import path from 'node:path';
import {getDb, withVaultDatabase} from '../electron/db/database';
import {getVault, withOwningVault} from '../electron/vaults/vaultRegistry';
import {listEntityClips, saveClip} from '../electron/audio/audioService';

export async function ensureAcceptanceAudioFixtures(lab: string): Promise<void> {
  if (!fs.existsSync(path.join(lab, '.nodus-mobile-acceptance-lab'))) throw new Error('Isolated audio laboratory required');
  const vault = getVault('default');
  if (!vault || !path.resolve(vault.path).startsWith(path.resolve(lab) + path.sep)) throw new Error('Isolated Principal required');
  await withOwningVault(vault.id, () => withVaultDatabase(vault.id, () => {
    const report = getDb().prepare('SELECT id, title, draft_json FROM writing_saved_drafts WHERE title LIKE ? LIMIT 1').get('NodusQA-%') as {id:string;title:string;draft_json:string} | undefined;
    if (!report) throw new Error('Audio acceptance requires an actual saved laboratory research report');
    const label = 'Aceptación · narración guardada';
    let clip = listEntityClips('deep_research', report.id).find(item => item.segmentLabel === label && !item.missing);
    if (!clip) {
      const samples = 16_000 * 30, wav = Buffer.alloc(44 + samples * 2);
      wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
      wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16_000, 24); wav.writeUInt32LE(32_000, 28);
      wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
      // Deliberately quiet tone: playback/timing fixture, not AI-generated speech evidence.
      for (let n = 0; n < samples; n++) wav.writeInt16LE(Math.round(120 * Math.sin(n * 2 * Math.PI * 440 / 16_000)), 44 + n * 2);
      clip = saveClip('deep_research', report.id, {segmentIndex:0,segmentLabel:label,provider:'piper',voice:'acceptance-tone',language:'es',bytes:wav});
    }
    fs.writeFileSync(path.join(lab,'saved-audio-fixture.json'), JSON.stringify({vaultId:vault.id, reportId:report.id,
      reportTitle:report.title, reportMarker:report.title.match(/^NodusQA-[a-f0-9-]{36}/i)?.[0],
      bodySnippet:JSON.parse(report.draft_json).abstract?.slice(0,220),clipId:clip.id,label,duration:clip.durationSec,
      note:'Explicit quiet WAV playback fixture; not evidence of generated narration.'}), {mode:0o600});
  }));
}
