import {markdownToDocxBytes,type DocxOptions} from '@shared/markdownDocx';
export {pngSize} from '@shared/markdownDocx';
export type {DocxImage,DocxOptions} from '@shared/markdownDocx';

export async function markdownToDocx(markdown:string,options:DocxOptions={}):Promise<Buffer> {
  return Buffer.from(await markdownToDocxBytes(markdown,options));
}
