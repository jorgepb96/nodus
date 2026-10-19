import { app, dialog, net, safeStorage, session, shell, systemPreferences, utilityProcess } from 'electron';
import { installSupportIsolation } from '../../shared/support/isolation.mjs';

export function isolateSupportApplication(root: string): void {
  const boundary=installSupportIsolation(root);
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
    target.setPermissionRequestHandler((_contents,_permission,done)=>done(false));
    target.on('will-download',event=>event.preventDefault());
  };
  app.on('session-created',restrict);
  void app.whenReady().then(()=>restrict(session.defaultSession));
}
