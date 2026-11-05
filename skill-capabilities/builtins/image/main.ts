import {callImageProvider,prepareGeneratedImage} from '../../../electron/ai/decorativeImages';
import {getSettings} from '../../../electron/db/settingsRepo';
import {chatAssetVersion,storeChatImage} from '../../../electron/chatAssets';
import {portableImageRequest} from '../../../shared/portableImageRequest';
const image=portableImageRequest({callImageProvider,prepareGeneratedImage,getSettings,chatAssetVersion,storeChatImage});
export function executeImageRequest(...args:Parameters<typeof image.executeImageRequest>){return image.executeImageRequest(...args);}
