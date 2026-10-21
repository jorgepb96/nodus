// Reuse Nodus’ isolated-keychain identity resolution with Support’s smaller app.
const path=require('node:path');
const {signAsync}=require('@electron/osx-sign');
const {resolveDeveloperIdIdentity}=require('./macSign.cjs');
module.exports=async options=>{
 const frameworks=path.join(options.app,'Contents/Frameworks'),original=options.optionsForFile;
 return signAsync({...options,identity:resolveDeveloperIdIdentity(options),optionsForFile:file=>{
   const relative=path.relative(frameworks,file),parts=relative.split(path.sep);
   const helper=!relative.startsWith('..')&&/ Helper(?: \([^)]+\))?\.app$/.test(parts[0]??'')&&(parts.length===1||(parts.length===4&&parts[1]==='Contents'&&parts[2]==='MacOS'));
   const inherited=original?original(file):{};
   return file===options.app||helper?inherited:{...inherited,entitlements:path.join(__dirname,'entitlements.mac.empty.plist')};
 }});
};
