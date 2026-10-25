// Used only by the disposable end-to-end fixture; never loaded by Support.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {installRuntimeHooks,repoRoot} from './lib/tsRuntimeHooks.mjs';
const root=fs.realpathSync(process.argv[2]),profile=path.join(root,'profile');
const marker=JSON.parse(fs.readFileSync(path.join(root,'support-session.json'),'utf8'));
if(marker.root!==root||marker.protocol!==1||marker.network!==false)throw new Error('Expected a disposable protected working copy');
process.env.NODUS_BACKUP_UTILITY_INLINE='1';process.env.NODUS_USERDATA=profile;installRuntimeHooks(profile);
const require=createRequire(import.meta.url),{createBackupArchiveFile}=require(path.join(repoRoot,'electron/export/exportImport.ts'));
const {closeDb}=require(path.join(repoRoot,'electron/db/database.ts'));
await createBackupArchiveFile({password:'Support qualification synthetic password',appVersion:JSON.parse(fs.readFileSync(path.join(repoRoot,'package.json'),'utf8')).version},path.join(root,'qualification.nodus'));closeDb();
