import {retrieveDocumentary,type DocumentaryRetrievalInput} from '@shared/documentaryRetrieval';
import type {DocumentaryRetrievalHost} from '@shared/documentaryRetrieval';
export type {DocumentaryRetrievalInput};
export function runDocumentaryRetrieval(store:DocumentaryRetrievalHost,input:DocumentaryRetrievalInput,activity:DocumentaryRetrievalHost['activity']=()=>{}) {return retrieveDocumentary(input,{...store,activity});}
