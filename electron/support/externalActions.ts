import { supportText } from '../../shared/support/messages';
import type { AppLanguage } from '../../shared/types';

export function assertSupportExternalActionAllowed():void {
  if(process.env.NODUS_SUPPORT_INTERACTIVE==='1'||process.env.NODUS_SUPPORT_PROBE==='1') {
    throw Object.assign(new Error(supportText((process.env.NODUS_SUPPORT_LANGUAGE??'en') as AppLanguage,'externalPaused')),{code:'SUPPORT_EXTERNAL_ACTION_DENIED'});
  }
}
