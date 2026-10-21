import type {NodeRequire} from 'node:module';
export function installSqliteIsolation(require: NodeRequire, check: (path: string) => void): () => void;
