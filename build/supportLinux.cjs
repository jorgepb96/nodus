const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

function rpmRemoveScript(template) {
  // RPM's postun also runs after the new package's postinst during upgrades
  // and same-version repairs. Only a final removal (remaining count 0) may
  // remove the executable link or unload the newly installed AppArmor profile.
  return '#!/bin/bash\nif [ "$1" != "0" ]; then\n  exit 0\nfi\n' + template.replace(/^#![^\n]*\n/, '');
}
function prepareSupportRpmScripts() {
  const root = path.resolve(__dirname, '..');
  const template = path.join(path.dirname(require.resolve('app-builder-lib/package.json')), 'templates/linux/after-remove.tpl');
  const output = path.join(root, 'build/support-linux/after-remove.tpl');
  fs.mkdirSync(path.dirname(output), {recursive: true});
  const prepared = `${output}.${randomUUID()}`;
  fs.writeFileSync(prepared, rpmRemoveScript(fs.readFileSync(template, 'utf8')));
  fs.renameSync(prepared, output);
  return output;
}
module.exports = {rpmRemoveScript, prepareSupportRpmScripts};
