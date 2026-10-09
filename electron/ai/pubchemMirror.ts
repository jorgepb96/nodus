import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/** Where a local PubChem mirror lives, when one has been built: NODUS_PUBCHEM_DIR, else
 *  <userData>/pubchem-mirror/current. A mirror answers the chemistry package's name and structure
 *  lookups without a network round trip; with none, the package asks PubChem exactly as before. */
export function pubchemMirrorDirectory(): string | null {
  const dir = process.env.NODUS_PUBCHEM_DIR
    ? path.resolve(process.env.NODUS_PUBCHEM_DIR)
    : path.join(app.getPath('userData'), 'pubchem-mirror', 'current');
  try {
    return fs.statSync(path.join(dir, 'pubchem.sqlite')).isFile() ? dir : null;
  } catch {
    return null;
  }
}

/** Where a local OPSIN lives, when one is set up: NODUS_OPSIN_DIR, else <userData>/opsin. It holds a
 *  `java` link, OPSIN's jar and the OpsinBatch wrapper. Systematic names are then parsed on this
 *  machine by the same parser EBI's web service runs; with none, the package asks the web service. */
export function opsinDirectory(): string | null {
  const dir = process.env.NODUS_OPSIN_DIR
    ? path.resolve(process.env.NODUS_OPSIN_DIR)
    : path.join(app.getPath('userData'), 'opsin');
  try {
    return fs.existsSync(path.join(dir, 'java')) && fs.existsSync(path.join(dir, 'OpsinBatch.class')) ? dir : null;
  } catch {
    return null;
  }
}
