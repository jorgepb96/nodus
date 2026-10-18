import {useEffect,useRef} from 'react';

export const COMPANION_CONTENT_CHANGED = 'nodus:companion-content-changed';

/** Refresh an existing mounted reader after the linked Mac's actual corpus
 * revision changes. Its tabs, filters and editor component keep their identity. */
export function useCompanionContentRefresh(refresh:()=>unknown|Promise<unknown>):void {
  const callback=useRef(refresh);callback.current=refresh;
  useEffect(()=>{
    const report=(error:unknown)=>window.dispatchEvent(new ErrorEvent('error',{message:error instanceof Error?error.message:String(error)}));
    const update=()=>{try{void Promise.resolve(callback.current()).catch(report);}catch(error){report(error);}};
    window.addEventListener(COMPANION_CONTENT_CHANGED,update);
    return ()=>window.removeEventListener(COMPANION_CONTENT_CHANGED,update);
  },[]);
}
