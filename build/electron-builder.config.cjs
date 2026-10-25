const pkg = require('../package.json');
require('./supportNsis.cjs').installSupportNsisTemplates();
const { packagedNodeModuleExclusions } = require('./packagedNodeModules.cjs');

// The packaging definition every build starts from: package.json "build", plus the
// node_modules pruning, which has to be computed from package-lock.json and so
// cannot live in JSON. `npm run dist*` load this file; the release config extends
// it. See build/packagedNodeModules.cjs for what is left out and why.
module.exports = {
  ...pkg.build,
  nsis: {...pkg.build.nsis},
  files: [...pkg.build.files, ...packagedNodeModuleExclusions()],
  mac: { ...pkg.build.mac, sign: 'build/macLocalSign.cjs' },
};
