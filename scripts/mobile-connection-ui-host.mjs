// Stateful real-app driver for native connection acceptance. All commands and
// screenshots stay inside an explicitly isolated copied workspace.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {_electron} from 'playwright-core';
const require=createRequire(import.meta.url),repo=path.resolve(import.meta.dirname,'..');
const lab=fs.realpathSync(process.env.NODUS_MOBILE_ACCEPTANCE_LAB??'');
assert(fs.existsSync(path.join(lab,'.nodus-mobile-acceptance-lab')));
const root=path.dirname(lab), marker=JSON.parse(fs.readFileSync(path.join(root,'isolation.json'),'utf8'));
assert.equal(marker.root,root);assert.equal(path.join(root,'profile'),lab);
const output=path.join(root,'connection-evidence');fs.mkdirSync(output,{recursive:true,mode:0o700});
let app,page;
async function launch(){
 const lock=path.join(lab,'isolated-instance.lock');
 if(fs.existsSync(lock)){
  const pid=Number(fs.readFileSync(lock,'utf8'));let alive=false;
  try{process.kill(pid,0);alive=true;}catch{}
  assert(!alive,'Another process owns this isolated profile');fs.unlinkSync(lock);
 }
 const env={...process.env,NODUS_ISOLATED_ROOT:root,NODUS_USERDATA:lab,NODUS_DISABLE_AUTO_UPDATE:'1',NODUS_E2E_UPDATE_STATUS:'not-available'};
 delete env.ELECTRON_RUN_AS_NODE;delete env.NODUS_HARNESS_KEYS_FILE;
 app=await _electron.launch({executablePath:require('electron'),args:[repo],cwd:repo,env,timeout:90000});
 page=await app.firstWindow();page.setDefaultTimeout(30000);
 await page.waitForFunction(()=>Boolean(document.getElementById('root')?.children.length),null,{timeout:90000});
 await page.evaluate(async()=>{await window.nodus.updateSettings({uiLanguage:'es',mascotEnabled:false,tourComplete:true,advancedTourComplete:true});});
 const recovery=await page.evaluate(()=>window.nodus.getRecoveryStatus());
 if(recovery.needsSetup){
  const folder=path.join(root,'desktop-recovery');fs.mkdirSync(folder,{recursive:true});
  const result=await page.evaluate(({folder,password})=>window.nodus.initializeRecoveryFolder(folder,password,'es'),{folder,password:randomBytes(32).toString('base64url')});
  assert.equal(result.ok,true,result.message);await page.reload();
 }
 await page.waitForFunction(()=>Boolean(document.querySelector('[data-testid="whats-new-cinematic-modal"]')||document.querySelector('[data-tour="nav-settings"]')),null,{timeout:60000});
 const news=page.getByTestId('whats-new-cinematic-modal');
 if(await news.isVisible())await news.getByRole('button',{name:'Cerrar',exact:true}).click();
 await page.locator('[data-tour="nav-settings"]').click();
 await page.getByRole('button',{name:'Conexión móvil',exact:true}).click();
 await page.getByRole('heading',{name:'Vincular con mi Nodus',exact:true}).waitFor();
 console.log(JSON.stringify({ready:true,desktopPid:app.process().pid,isolated:true}));
}
async function close(){if(app){await app.close();app=undefined;}}
async function offer(){
 const button=page.getByRole('button',{name:/^(Generar código y QR|Renovar código)$/});
 await button.click();
 const qr=page.getByRole('img',{name:'Código QR para vincular Nodus',exact:true});await qr.waitFor();
 await page.getByRole('button',{name:'Copiar enlace',exact:true}).waitFor();
 const href=await page.getByRole('link',{name:'Abrir enlace de vinculación',exact:true}).getAttribute('href');
 const value=JSON.parse(Buffer.from(new URL(href).searchParams.get('offer'),'base64url').toString());
 assert.equal(value.wholeWorkspace,true);assert(!value.relay,'The primary UI offers direct LAN/VPN');
 fs.writeFileSync(path.join(lab,'mobile-pairing-offer.json'),JSON.stringify({...value,pairingURL:href}),{mode:0o600});
 const image=await qr.getAttribute('src');assert(image.startsWith('data:image/png;base64,'));
 fs.writeFileSync(path.join(output,'desktop-offer-qr.png'),Buffer.from(image.split(',')[1],'base64'),{mode:0o600});
 await page.screenshot({path:path.join(output,'desktop-mobile-settings-offer.png')});
 console.log(JSON.stringify({offerReady:true,wholeWorkspace:true,qrCaptured:true,vaultCount:value.vaultIds.length}));
}
async function status(){
 const value=await page.evaluate(()=>window.nodus.getDesktopBridgeStatus());
 fs.writeFileSync(path.join(output,'desktop-status.json'),JSON.stringify(value,null,2),{mode:0o600});
 console.log(JSON.stringify({statusSaved:true,running:value.running,linked:value.pairings.filter(p=>!p.revokedAt).length}));
}
try{
 await launch();
 const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
 for await(const line of rl){
  try{
   const input=JSON.parse(line);
   if(input.action==='offer')await offer();
   else if(input.action==='status')await status();
   else if(input.action==='createVault'){
    assert(typeof input.name==='string'&&input.name.startsWith('ConnectionQA-'));
    const {vault}=await page.evaluate(name=>window.nodus.createVault({name,type:'academic'}),input.name);
    fs.writeFileSync(path.join(output,'created-vault.json'),JSON.stringify(vault),{mode:0o600});console.log(JSON.stringify({vaultCreated:true}));
   }else if(input.action==='removeCreatedVault'){
    const vault=JSON.parse(fs.readFileSync(path.join(output,'created-vault.json'),'utf8'));
    assert(vault.name.startsWith('ConnectionQA-'));
    assert(path.resolve(vault.path).startsWith(lab+path.sep));
    await page.evaluate(id=>window.nodus.deleteVault(id,true),vault.id);
    console.log(JSON.stringify({createdVaultRemoved:true}));
   }else if(input.action==='model'){
    assert(typeof input.model==='string'&&/^ConnectionQA-[a-f0-9-]+$/.test(input.model));
    await page.evaluate(model=>window.nodus.updateSettings({chatModel:{provider:'deepseek',model}}),input.model);console.log(JSON.stringify({modelUpdated:true}));
   }else if(input.action==='revoke'){
    const value=await page.evaluate(()=>window.nodus.getDesktopBridgeStatus());
    for(const pairing of value.pairings.filter(p=>!p.revokedAt))await page.evaluate(id=>window.nodus.revokeDesktopBridgePairing(id),pairing.id);
    await status();
   }else if(input.action==='capture'){
    await page.screenshot({path:path.join(output,'desktop-mobile-settings-linked.png')});
    console.log(JSON.stringify({settingsCaptured:true}));
   }else if(input.action==='stop'){await close();console.log(JSON.stringify({desktopStopped:true}));}
   else if(input.action==='start'){assert(!app);await launch();}
   else if(input.action==='quit'){rl.close();break;}
   else throw new Error('unsupported_test_command');
  }catch(error){console.error(JSON.stringify({commandFailed:true,error:error.message}));}
 }
}finally{await close();}
