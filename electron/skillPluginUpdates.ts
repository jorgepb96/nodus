import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { compareSemver } from '../skill-capabilities/contracts';
import { installMarketplacePlugin, updateSkillSource } from './skillMarketplace';
import { listInstalledPlugins } from './skillPlugins';

const PERIOD = 24 * 60 * 60 * 1000;
const stateFile = () => path.join(app.getPath('userData'), 'plugin-update-state.json');
let timer: ReturnType<typeof setInterval> | undefined;
let running: Promise<void> | undefined;

/** The same lock that keeps the app and capability packages from updating themselves.
 *  Without it this loop ran on every launch, and would fetch catalogues and install updates
 *  for any plugin with autoUpdate on, in a build that was told not to update. */
const updatesDisabled = () => process.env.NODUS_DISABLE_AUTO_UPDATE === '1';

function lastCheck(): number {
  try { return Date.parse(JSON.parse(fs.readFileSync(stateFile(), 'utf8')).checkedAt) || 0; } catch { return 0; }
}
function recordCheck() {
  fs.writeFileSync(`${stateFile()}.tmp`, JSON.stringify({ checkedAt: new Date().toISOString() }), { mode: 0o600 });
  fs.renameSync(`${stateFile()}.tmp`, stateFile());
}

export function checkPluginUpdates(force = false): Promise<void> {
  if (updatesDisabled()) return Promise.resolve();
  if (running) return running;
  running = (async () => {
    if (!force && Date.now() - lastCheck() < PERIOD) return;
    const installed = listInstalledPlugins().filter(plugin => plugin.activeVersion && plugin.autoUpdate);
    const sourceIds = [...new Set(installed.map(plugin => plugin.sourceId))];
    for (let offset = 0; offset < sourceIds.length; offset += 2) {
      await Promise.all(sourceIds.slice(offset, offset + 2).map(async sourceId => {
        try {
          const marketplace = await updateSkillSource(sourceId), source = marketplace.sources.find(item => item.id === sourceId);
          if (!source?.commit) return;
          for (const plugin of installed.filter(item => item.sourceId === sourceId)) {
            const entry = source.plugins?.find(item => item.package.manifest.id === plugin.id);
            if (entry && compareSemver(entry.package.manifest.version, plugin.activeVersion) > 0) installMarketplacePlugin(sourceId, entry.path, source.commit, false);
          }
        } catch (error) { console.warn(`[skill-plugins] update failed for ${sourceId}: ${error instanceof Error ? error.message : String(error)}`); }
      }));
    }
    recordCheck();
  })().finally(() => { running = undefined; });
  return running;
}

export function startPluginUpdates(): void {
  if (updatesDisabled()) { console.log('[skill-plugins] automatic plugin updates disabled'); return; }
  void checkPluginUpdates();
  timer = setInterval(() => void checkPluginUpdates(), PERIOD);
}
export function stopPluginUpdates(): void { if (timer) clearInterval(timer); timer = undefined; }
