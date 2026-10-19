/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const protocol='nodus.support-nsis-repair/1';
const digest=value=>createHash('sha256').update(value).digest('hex');
const quoted=file=>path.resolve(file).replaceAll('\\','/').replaceAll('"','$\\"');
function replaceOnce(source,needle,replacement) {
  if(source.split(needle).length!==2)throw new Error(`NSIS support repair requires review: template anchor ${JSON.stringify(needle)}`);
  return source.replace(needle,replacement);
}
exports.generateSupportNsisScript=function(root=path.resolve(__dirname,'..'),output=path.join(root,'.ci/support-nsis')) {
  const templates=path.join(path.dirname(require.resolve('app-builder-lib/package.json')),'templates/nsis');
  let installer=fs.readFileSync(path.join(templates,'installer.nsi'),'utf8').replaceAll('\r\n','\n');
  let section=fs.readFileSync(path.join(templates,'installSection.nsh'),'utf8').replaceAll('\r\n','\n');
  installer='; '+protocol+'\n!addincludedir "'+quoted(templates)+'"\n!ifndef BUILD_UNINSTALLER\nVar /GLOBAL nodusSupportRepair\n!endif\n'+installer;
  installer=replaceOnce(installer,'    !insertmacro initMultiUser',`    !insertmacro initMultiUser
    \${StdUtils.TestParameter} $nodusSupportRepair "nodus-support-repair"
    \${if} $nodusSupportRepair == "true"
      \${ifNot} \${Silent}
        SetErrorLevel 2
        Quit
      \${endif}
    \${endif}`);
  // Use the stock installer for ordinary installs/updates. Only the explicitly
  // requested, signed-manifest-declared repair path bypasses the old uninstaller.
  const uninstall=`!insertmacro uninstallOldVersion SHELL_CONTEXT
!insertmacro handleUninstallResult SHELL_CONTEXT

\${if} $installMode == "all"
  !insertmacro uninstallOldVersion HKEY_CURRENT_USER
  !insertmacro handleUninstallResult HKEY_CURRENT_USER
\${endIf}`;
  section=replaceOnce(section,uninstall,'\${if} $nodusSupportRepair != "true"\n'+uninstall+'\n\${endif}');
  const running='!insertmacro CHECK_APP_RUNNING';
  if(section.split(running).length!==3)throw new Error('NSIS running-process template changed; review the repair safety boundary');
  section=section.replaceAll(running,`\${if} $nodusSupportRepair == "true"
      \${nsProcess::FindProcess} "\${APP_EXECUTABLE_FILENAME}" $R0
      \${if} $R0 != 603
        SetErrorLevel 2
        Quit
      \${endif}
    \${else}
      !insertmacro CHECK_APP_RUNNING
    \${endif}`);
  section=replaceOnce(section,'!macro doStartApp\n','!macro doStartApp\n  \${if} $nodusSupportRepair != "true"\n');
  section=replaceOnce(section,'  !insertmacro StartApp\n!macroend','  !insertmacro StartApp\n  \${endif}\n!macroend');
  fs.mkdirSync(output,{recursive:true});
  installer=replaceOnce(installer,'!include "installSection.nsh"',`!include "${quoted(path.join(output,'installSection.nsh'))}"`);
  const files={'installer.nsi':installer,'installSection.nsh':section};
  for(const [name,content] of Object.entries(files))fs.writeFileSync(path.join(output,name),content);
  fs.writeFileSync(path.join(output,'contract.json'),JSON.stringify({protocol,files:Object.fromEntries(Object.entries(files).map(([name,content])=>[name,digest(content)]))}));
  return path.join(output,'installer.nsi');
};
exports.hasSupportNsisContract=function(script) {
  try {
    if(!script)return false;
    const folder=path.dirname(script),record=JSON.parse(fs.readFileSync(path.join(folder,'contract.json'),'utf8'));
    return record.protocol===protocol&&path.basename(script)==='installer.nsi'&&['installer.nsi','installSection.nsh'].every(name=>digest(fs.readFileSync(path.join(folder,name)))===record.files[name]);
  }catch{return false;}
};
