import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {createProbeInput,readProbePassword} from '../shared/support/probe-input.mjs';

test('private probe input rejects other clients and sends the password once without storing it in environment fields',async()=>{
  const password='Private synthetic backup 密碼 🔑 contraseña',id=randomUUID(),channel=await createProbeInput(password,id);
  try {
    assert.ok(!JSON.stringify(channel.env).includes(password));
    await new Promise((resolve,reject)=>{
      const socket=net.createConnection(channel.env.NODUS_SUPPORT_INPUT_PIPE);let bytes=0;
      socket.once('connect',()=>socket.write('incorrect token\n'));socket.on('data',chunk=>bytes+=chunk.length);
      socket.once('error',()=>{});socket.once('close',()=>{try{assert.equal(bytes,0);resolve();}catch(error){reject(error);}});
    });
    const env={...channel.env,NODUS_SUPPORT_REQUEST_ID:id};
    assert.equal(await readProbePassword(env),password);
    assert.equal(env.NODUS_SUPPORT_INPUT_PIPE,undefined);assert.equal(env.NODUS_SUPPORT_INPUT_TOKEN,undefined);
    await assert.rejects(readProbePassword({...channel.env,NODUS_SUPPORT_REQUEST_ID:id}),error=>error.code==='PROBE_INPUT_UNAVAILABLE');
  }finally{channel.close();}
});
test('probe input refuses arbitrary endpoints and handles split UTF-8 input',async()=>{
  await assert.rejects(readProbePassword({NODUS_SUPPORT_REQUEST_ID:randomUUID(),NODUS_SUPPORT_INPUT_PIPE:'127.0.0.1:1234',NODUS_SUPPORT_INPUT_TOKEN:'a'.repeat(43)}),error=>error.code==='PROBE_INPUT_UNAVAILABLE');
  const password='密碼 🔑 contraseña',bytes=Buffer.from(JSON.stringify({password}));
  assert.equal(await readProbePassword({},Readable.from([...bytes].map(value=>Buffer.from([value])))),password);
  await assert.rejects(readProbePassword({},Readable.from(['{"password":""}'])),error=>error.code==='PROBE_INPUT_UNAVAILABLE');
});
