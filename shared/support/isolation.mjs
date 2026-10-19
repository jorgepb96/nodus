// Installed before the normal application graph, only in explicitly isolated Support runs.
// This is defence in depth for trusted Nodus code; untrusted plugins and subprocesses stay disabled.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import childProcess from 'node:child_process';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import dgram from 'node:dgram';
import workers from 'node:worker_threads';

export function installSupportIsolation(root) {
  const realpath = fs.realpathSync.native.bind(fs.realpathSync), lstat = fs.lstatSync.bind(fs);
  const normalize=file=>process.platform==='win32'?path.toNamespacedPath(path.resolve(file)):path.resolve(file);
  const boundary = normalize(realpath(root)), restored = [], writable = new Set([1,2]);
  const deny = code => { throw Object.assign(new Error(code),{code}); };
  function check(input) {
    if (typeof input === 'number') { if (!writable.has(input)) deny('SUPPORT_WRITE_DENIED'); return; }
    const file = normalize(input instanceof URL ? fileURLToPath(input) : Buffer.isBuffer(input) ? input.toString() : input);
    const relative = path.relative(boundary,file);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) deny('SUPPORT_WRITE_DENIED');
    let current = file;
    for (;;) {
      try { const stat=lstat(current); if (stat.isSymbolicLink() || stat.isFile() && stat.nlink > 1) deny('SUPPORT_WRITE_DENIED'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (path.relative(boundary,current)==='') break;
      const parent=path.dirname(current); if (current===parent) deny('SUPPORT_WRITE_DENIED'); current=parent;
    }
  }
  function patch(object,key,wrapper) {
    if (typeof object[key] !== 'function') return;
    const original=object[key]; object[key]=wrapper(original); restored.push(()=>{object[key]=original;});
  }
  const writes = flags => typeof flags === 'number' ? Boolean(flags & (fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_APPEND)) : /[wa+]/.test(flags ?? 'r');
  for (const key of ['writeFile','appendFile','truncate','mkdir','mkdtemp','rm','rmdir','unlink','chmod','chown','lchown','utimes','lutimes']) {
    patch(fs,key,original=>function(input,...args){check(input);return original.call(this,input,...args);});
    patch(fsp,key,original=>async function(input,...args){check(input);return original.call(this,input,...args);});
    patch(fs,`${key}Sync`,original=>function(input,...args){check(input);return original.call(this,input,...args);});
  }
  for (const key of ['rename','link']) {
    patch(fs,key,original=>function(from,to,...args){check(from);check(to);return original.call(this,from,to,...args);});
    patch(fsp,key,original=>async function(from,to,...args){check(from);check(to);return original.call(this,from,to,...args);});
    patch(fs,`${key}Sync`,original=>function(from,to,...args){check(from);check(to);return original.call(this,from,to,...args);});
  }
  for (const key of ['copyFile','cp']) {
    patch(fs,key,original=>function(from,to,...args){check(to);return original.call(this,from,to,...args);});
    patch(fsp,key,original=>async function(from,to,...args){check(to);return original.call(this,from,to,...args);});
    patch(fs,`${key}Sync`,original=>function(from,to,...args){check(to);return original.call(this,from,to,...args);});
  }
  for (const object of [fs,fsp]) patch(object,'symlink',()=>()=>deny('SUPPORT_WRITE_DENIED'));
  patch(fs,'symlinkSync',()=>()=>deny('SUPPORT_WRITE_DENIED'));
  const track=(fd,flags)=>{writable.delete(fd);if(writes(flags))writable.add(fd);};
  patch(fs,'openSync',original=>function(file,flags,...args){if(writes(flags))check(file);const fd=original.call(this,file,flags,...args);track(fd,flags);return fd;});
  patch(fs,'open',original=>function(file,flags,...args){if(writes(flags))check(file);const callback=args.pop();return original.call(this,file,flags,...args,(error,fd)=>{if(!error)track(fd,flags);callback(error,fd);});});
  patch(fsp,'open',original=>async function(file,flags,...args){
    if(writes(flags))check(file);const handle=await original.call(this,file,flags,...args);track(handle.fd,flags);
    const fd=handle.fd;
    for(const method of ['appendFile','write','writev','writeFile','truncate','chmod','chown','utimes']) {
      const originalMethod=handle[method].bind(handle);handle[method]=async(...values)=>{check(fd);return originalMethod(...values);};
    }
    const close=handle.close.bind(handle);handle.close=async()=>{writable.delete(fd);return close();};return handle;
  });
  patch(fs,'closeSync',original=>function(fd){writable.delete(fd);return original.call(this,fd);});
  patch(fs,'close',original=>function(fd,...args){writable.delete(fd);return original.call(this,fd,...args);});
  patch(fs,'createWriteStream',original=>function(file,options){check(options?.fd ?? file);return original.call(this,file,options);});
  for(const key of ['write','writev','ftruncate','fchmod','fchown','futimes']) {
    patch(fs,key,original=>function(fd,...args){check(fd);return original.call(this,fd,...args);});
    patch(fs,`${key}Sync`,original=>function(fd,...args){check(fd);return original.call(this,fd,...args);});
  }
  for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']) patch(childProcess,key,()=>()=>deny('SUPPORT_PROCESS_DENIED'));
  patch(workers,'Worker',()=>class { constructor(){deny('SUPPORT_PROCESS_DENIED');} });
  for(const [object,keys] of [[net,['connect','createConnection']],[net.Socket.prototype,['connect']],[net.Server.prototype,['listen']],[tls,['connect']],[http,['request','get']],[https,['request','get']],[dgram.Socket.prototype,['send','connect','bind']],[dns,Object.keys(dns).filter(key=>/^(resolve|lookup)/.test(key))],[dns.promises,Object.keys(dns.promises).filter(key=>/^(resolve|lookup)/.test(key))]]) {
    for(const key of keys)patch(object,key,()=>()=>deny('SUPPORT_NETWORK_DENIED'));
  }
  const fetch=globalThis.fetch;globalThis.fetch=async()=>deny('SUPPORT_NETWORK_DENIED');restored.push(()=>{globalThis.fetch=fetch;});
  syncBuiltinESMExports();
  return {check,restore(){for(const undo of restored.reverse())undo();syncBuiltinESMExports();}};
}
