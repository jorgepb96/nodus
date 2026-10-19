import { app, dialog, net, safeStorage, session, shell, systemPreferences, utilityProcess } from 'electron';
import { installSupportIsolation } from '../../shared/support/isolation.mjs';
import { createRequire } from 'node:module';
import { installSqliteIsolation } from '../../shared/support/sqlite-isolation.mjs';

export function isolateSupportApplication(root: string): void {
  const boundary=installSupportIsolation(root);
  if(process.versions.electron)installSqliteIsolation(createRequire(import.meta.url),boundary.check);
  const deny = () => { throw Object.assign(new Error('SUPPORT_EXTERNAL_ACTION_DENIED'),{code:'SUPPORT_EXTERNAL_ACTION_DENIED'}); };
  utilityProcess.fork = deny;
  net.request = deny; net.fetch = async () => deny();
  shell.openExternal = async () => deny(); shell.openPath = async () => deny(); shell.trashItem = async () => deny();
  safeStorage.decryptString = deny; safeStorage.encryptString = deny;
  app.relaunch=deny;app.setLoginItemSettings=deny;app.setAsDefaultProtocolClient=deny;app.removeAsDefaultProtocolClient=deny;
  for(const name of ['setUserDefault','removeUserDefault']) {
    const preferences=systemPreferences as unknown as Record<string,unknown>;
    if(typeof preferences[name]==='function')preferences[name]=deny;
  }
  // Native converters can bypass node:fs. Keep their user-selected destinations
  // inside the trial too, before they receive a filename from a save dialog.
  const save=dialog.showSaveDialog,saveSync=dialog.showSaveDialogSync;
  dialog.showSaveDialog=(async(...args:unknown[])=>{const result=await Reflect.apply(save,dialog,args);if(!result.canceled&&result.filePath)boundary.check(result.filePath);return result;}) as typeof dialog.showSaveDialog;
  dialog.showSaveDialogSync=((...args:unknown[])=>{const result=Reflect.apply(saveSync,dialog,args);if(result)boundary.check(result);return result;}) as typeof dialog.showSaveDialogSync;
  const open=dialog.showOpenDialog,openSync=dialog.showOpenDialogSync;
  dialog.showOpenDialog=(async(...args:unknown[])=>{const result=await Reflect.apply(open,dialog,args);if(!result.canceled)for(const file of result.filePaths)boundary.check(file);return result;}) as typeof dialog.showOpenDialog;
  dialog.showOpenDialogSync=((...args:unknown[])=>{const result=Reflect.apply(openSync,dialog,args);if(result)for(const file of result)boundary.check(file);return result;}) as typeof dialog.showOpenDialogSync;
  const restricted=new WeakSet<Electron.Session>();
  const restrict = (target: Electron.Session) => {
    if (restricted.has(target)) return; restricted.add(target);
    const register=target.webRequest.onBeforeRequest.bind(target.webRequest);
    const allowed=(url:string)=>['file:','data:','devtools:','chrome-extension:','nodus-archive:','nodus-library:','nodus-image:'].includes(new URL(url).protocol);
    const protect=(...args: unknown[])=>{
      const listener=args.at(-1);
      register((request,done)=>{
        if (!allowed(request.url)) { done({cancel:true}); return; }
        if (typeof listener==='function') listener(request,done); else done({cancel:false});
      });
    };
    // Later browser/tool handlers cannot replace the Support network restriction.
    Object.defineProperty(target.webRequest,'onBeforeRequest',{value:protect,configurable:false,writable:false});
    protect();
    // Normal window/browser initialization must not replace the trial's denials.
    const requests=target.setPermissionRequestHandler.bind(target);
    const denyRequests=()=>requests((_contents,_permission,done)=>done(false));
    Object.defineProperty(target,'setPermissionRequestHandler',{value:denyRequests,configurable:false,writable:false});denyRequests();
    for(const name of ['setPermissionCheckHandler','setDevicePermissionHandler'] as const) {
      const register=target[name]?.bind(target);if(!register)continue;
      const reject=()=>register(()=>false);
      Object.defineProperty(target,name,{value:reject,configurable:false,writable:false});reject();
    }
    const media=target.setDisplayMediaRequestHandler?.bind(target);
    if(media){const reject=()=>media((_request,done)=>done({}));Object.defineProperty(target,'setDisplayMediaRequestHandler',{value:reject,configurable:false,writable:false});reject();}
    target.on('will-download',event=>event.preventDefault());
  };
  app.on('session-created',restrict);
  void app.whenReady().then(()=>restrict(session.defaultSession));
}
