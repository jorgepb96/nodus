// Browser destinations are selected here, never supplied by the renderer.
export const SUPPORT_GUIDES = {
  'windows-drivers': {platform:'win32',label:'graphicsHelp',url:'https://support.microsoft.com/en-us/windows/update-drivers-through-device-manager-in-windows-ec62f46c-ff14-c91d-eead-d7126dc1f7b6'},
  'macos-update': {platform:'darwin',label:'systemHelp',url:'https://support.apple.com/en-gb/108382'},
  ollama: {label:'Ollama',url:'https://ollama.com/download'},
  lmstudio: {label:'LM Studio',url:'https://lmstudio.ai/download'},
};
export function guideUrl(id,platform) {
  const guide=Object.hasOwn(SUPPORT_GUIDES,id)?SUPPORT_GUIDES[id]:null;
  if(!guide||guide.platform&&guide.platform!==platform)throw new Error('INVALID_GUIDE');
  return guide.url;
}
