/** Waiting for a slot has no transport deadline. The active resource owns its
 * timeout and abort handler, so changing a document stops both queued and live work. */
export class ReaderResourceQueue {
  private active=0;
  private waiting:Array<()=>void>=[];
  constructor(private readonly concurrency=4){if(!Number.isSafeInteger(concurrency)||concurrency<1)throw new Error('invalid_reader_concurrency');}
  run<T>(load:()=>Promise<T>,signal:AbortSignal):Promise<T>{
    return new Promise<T>((resolve,reject)=>{
      if(signal.aborted){reject(signal.reason??new DOMException('Lectura cancelada','AbortError'));return;}
      let started=false,settled=false;
      const abort=()=>{
        if(started||settled)return;
        settled=true;const index=this.waiting.indexOf(start);if(index>=0)this.waiting.splice(index,1);
        signal.removeEventListener('abort',abort);reject(signal.reason??new DOMException('Lectura cancelada','AbortError'));
      };
      const start=()=>{
        if(settled)return;
        if(signal.aborted){abort();return;}
        started=true;this.active++;signal.removeEventListener('abort',abort);
        void Promise.resolve().then(load).then(resolve,reject).finally(()=>{
          settled=true;this.active--;while(this.active<this.concurrency&&this.waiting.length)this.waiting.shift()!();
        });
      };
      signal.addEventListener('abort',abort,{once:true});
      if(this.active<this.concurrency)start();else this.waiting.push(start);
    });
  }
}
