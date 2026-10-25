import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';

const validId=value=>/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value??'');
const endpoint=id=>process.platform==='win32'?`\\\\.\\pipe\\nodus-support-${id}`:`/tmp/nodus-support-${id}.sock`;
const invalid=()=>Object.assign(new Error('PROBE_INPUT_UNAVAILABLE'),{code:'PROBE_INPUT_UNAVAILABLE'});

// Windows GUI executables cannot rely on inherited console input. Keep the
// password in memory and send it over one authenticated, per-request local pipe.
export async function createProbeInput(password,requestId) {
  if(!validId(requestId)||typeof password!=='string'||!password||password.length>4096)throw invalid();
  const token=randomBytes(32).toString('base64url'),pipe=endpoint(requestId),sockets=new Set();let used=false;
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.setTimeout(5000,()=>socket.destroy());let input='';
    socket.on('error',()=>{});socket.once('close',()=>sockets.delete(socket));
    socket.on('data',chunk=>{
      input+=chunk.toString();if(input.length>256){socket.destroy();return;}
      if(!input.includes('\n'))return;
      if(used||input!==token+'\n'){socket.destroy();return;}
      used=true;socket.end(JSON.stringify({password}));password='';server.close();
    });
  });
  const close=()=>{password='';for(const socket of sockets)socket.destroy();if(server.listening)server.close();};
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(pipe,resolve);});}
  catch{close();throw invalid();}
  server.on('error',()=>close());
  return {env:{NODUS_SUPPORT_INPUT_PIPE:pipe,NODUS_SUPPORT_INPUT_TOKEN:token},close};
}

export async function readProbePassword(env=process.env,stdin=process.stdin) {
  if(env.NODUS_SUPPORT_INPUT_PIPE!==undefined||env.NODUS_SUPPORT_INPUT_TOKEN!==undefined) {
    const pipe=env.NODUS_SUPPORT_INPUT_PIPE,token=env.NODUS_SUPPORT_INPUT_TOKEN,id=env.NODUS_SUPPORT_REQUEST_ID;
    delete env.NODUS_SUPPORT_INPUT_PIPE;delete env.NODUS_SUPPORT_INPUT_TOKEN;
    if(!validId(id)||pipe!==endpoint(id)||!/^[-_a-zA-Z0-9]{43}$/.test(token??''))throw invalid();
    return new Promise((resolve,reject)=>{
      const socket=net.createConnection(pipe);socket.setEncoding('utf8');let input='',done=false;
      const finish=(error,value)=>{if(done)return;done=true;socket.destroy();if(error)reject(invalid());else resolve(value);};
      socket.setTimeout(5000,()=>finish(invalid()));socket.once('error',()=>finish(invalid()));
      socket.once('connect',()=>socket.write(token+'\n'));
      socket.on('data',chunk=>{input+=chunk.toString();if(input.length>32768)finish(invalid());});
      socket.once('end',()=>{try{const value=JSON.parse(input);if(typeof value.password!=='string'||!value.password||value.password.length>4096)throw invalid();finish(null,value.password);}catch{finish(invalid());}finally{input='';}});
      socket.once('close',()=>{if(!done)finish(invalid());});
    });
  }
  const decoder=new StringDecoder('utf8');let input='';for await(const chunk of stdin){input+=typeof chunk==='string'?chunk:decoder.write(chunk);if(input.length>32768)throw invalid();}input+=decoder.end();
  try{const value=JSON.parse(input);if(typeof value.password!=='string'||!value.password||value.password.length>4096)throw invalid();return value.password;}
  finally{input='';}
}
