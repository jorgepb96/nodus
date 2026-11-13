import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import Bonjour from 'bonjour-service';

export interface BridgeAdvertisement extends EventEmitter { kill(): boolean }

/** Same DNS-SD type and TXT wire format on every Desktop platform. macOS keeps
 * its native publisher; Windows/Linux need no Bonjour/Avahi executable installed. */
export function advertiseDesktopBridge(name:string, port:number, txt:readonly string[], platform:NodeJS.Platform=process.platform):BridgeAdvertisement {
  if(!Number.isInteger(port)||port<1||port>65535||!name||txt.some(value=>Buffer.byteLength(value)>255))throw new Error('invalid_bridge_advertisement');
  if(platform==='darwin')return spawn('/usr/bin/dns-sd',['-R',name,'_nodus-mobile._tcp','local',String(port),...txt],{stdio:'ignore'});
  const events=new EventEmitter() as BridgeAdvertisement;
  let closed=false;
  let instance:Bonjour|undefined;
  let service:ReturnType<Bonjour['publish']>|undefined;
  const close=()=>{
    if(closed)return;closed=true;instance?.destroy();events.emit('exit');
  };
  events.kill=()=>{
    if(closed)return false;
    if(service)service.stop(close);else close();
    const timeout=setTimeout(close,500);timeout.unref();return true;
  };
  events.on('error',()=>events.kill());
  const failure=(error:Error)=>setImmediate(()=>{if(!closed)events.emit('error',error);});
  try {
    const record=Object.fromEntries(txt.map(value=>{const index=value.indexOf('=');if(index<=0)throw new Error('invalid_bridge_txt');return [value.slice(0,index),value.slice(index+1)];}));
    instance=new Bonjour({},failure);
    service=instance.publish({name,type:'nodus-mobile',protocol:'tcp',port,txt:record});
    service.on('error',failure);
    service.on('up',()=>events.emit('up'));
  } catch(error) {failure(error instanceof Error?error:new Error(String(error)));}
  return events;
}
