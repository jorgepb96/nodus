import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { ipcCensus, mobileOperationCensus } from './ipc-channel-census.mjs';

const registrySource = fs.readFileSync(new URL('../shared/mobileOperations.ts', import.meta.url), 'utf8');
const dispatcherSource = fs.readFileSync(new URL('../electron/desktopBridge/operations.ts', import.meta.url), 'utf8');
const exportsSource = fs.readFileSync(new URL('../electron/desktopBridge/exports.ts', import.meta.url), 'utf8');
const input = { registrySource, dispatcherSource, exportsSource };
const parse = (source) => ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true);
const handled = new Set(ipcCensus().handled.map(entry => entry.channel));
const orphan = census => census.invoked.filter(entry => !handled.has(entry.channel));

function withoutDirectBranch(method) {
  const source = parse(dispatcherSource);
  const execute = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'executeMobileOperation');
  const branch = execute.body.statements.find(node => ts.isIfStatement(node) && node.expression.getText(source).includes(`'${method}'`));
  assert(branch, `Real production branch for ${method} must exist`);
  return dispatcherSource.slice(0, branch.getStart(source)) + dispatcherSource.slice(branch.end);
}

test('real HTTP dispatcher covers its 20 direct methods without inventing IPC handlers', () => {
  const census = mobileOperationCensus(input);
  assert.equal(census.directMethods.size, 20);
  for (const method of census.directMethods) {
    assert(census.entries.some(entry => entry.method === method));
    assert(!census.invoked.some(entry => entry.method === method));
  }
  assert.deepEqual(orphan(census), []);
});

test('removing a real equality-selected branch exposes its methods as orphan IPC', () => {
  const census = mobileOperationCensus({ ...input, dispatcherSource: withoutDirectBranch('getMobileDeepResearchSource') });
  assert(orphan(census).some(entry => entry.method === 'getMobileDeepResearchSource'));
  assert(orphan(census).some(entry => entry.method === 'saveMobileDeepResearchReport'));
});

test('literal includes(method) is a direct selector, and removing its branch exposes both routes', () => {
  const census = mobileOperationCensus({ ...input, dispatcherSource: withoutDirectBranch('getMobileSyncedBlockSource') });
  for (const method of ['getMobileSyncedBlockSource', 'getMobileLinkedDatabaseRead']) {
    assert(!census.directMethods.has(method));
    assert(orphan(census).some(entry => entry.method === method));
  }
});

test('an invented dispatcher method is rejected rather than treated as a routing exception', () => {
  assert.throws(() => mobileOperationCensus({ ...input,
    dispatcherSource: dispatcherSource.replace("method==='getMobileDeepResearchSource'", "method==='inventedCensusRoute'") }), /Unknown MOBILE_OPERATIONS method.*inventedCensusRoute/);
});

test('a new registry entry without a direct branch or IPC handler remains orphaned', () => {
  const census = mobileOperationCensus({ ...input,
    registrySource: registrySource.replace('MOBILE_OPERATIONS = {', "MOBILE_OPERATIONS = { unconnectedCensusRoute: ['census:unconnected', 'corpus'],") });
  assert(orphan(census).some(entry => entry.method === 'unconnectedCensusRoute'));
});

test('validation guards, callback returns, negations and post-IPC transforms cannot hide missing routes', () => {
  const methods = ['validationOnly', 'callbackOnly', 'postIpcOnly', 'negatedOnly', 'partialReturn'];
  const registry = `export const MOBILE_OPERATIONS = {${methods.map(method => `${method}: ['census:${method}', 'corpus']`).join(',')}} as const;`;
  const dispatcher = `export function executeMobileOperation(method:string) {
    if(method==='validationOnly')throw new Error('invalid');
    if(method==='callbackOnly'){const helper=()=>{return 1;};helper();}
    if(!(method==='negatedOnly')){return 1;}
    if(method==='partialReturn'){if(authorized)return 1;}
    const handler=handlers.get(channel);
    if(method==='postIpcOnly')return 1;
    return handler();
  }`;
  const census = mobileOperationCensus({ registrySource: registry, dispatcherSource: dispatcher,
    exportsSource: 'export const MOBILE_EXPORT_METHODS = new Set([]);' });
  assert.equal(census.directMethods.size, 0);
  assert.deepEqual(census.invoked.map(entry => entry.method), methods);
});

test('a return in another function cannot replace a removed production dispatcher branch', () => {
  const dispatcher = withoutDirectBranch('getMobileDeepResearchSource') +
    "\nfunction unrelated(method:string){if(method==='getMobileDeepResearchSource')return 1;}";
  assert(orphan(mobileOperationCensus({ ...input, dispatcherSource: dispatcher })).some(entry => entry.method === 'getMobileDeepResearchSource'));
});

test('nonliteral selectors, malformed source and unknown exports fail closed', () => {
  assert.throws(() => mobileOperationCensus({ ...input,
    dispatcherSource: dispatcherSource.replace("['getMobileSyncedBlockSource','getMobileLinkedDatabaseRead'].includes(method)", 'unknownDynamicRoutes.includes(method)') }), /literal string array/);
  assert.throws(() => mobileOperationCensus({ ...input, dispatcherSource: 'export function executeMobileOperation(' }), /malformed TypeScript/);
  assert.throws(() => mobileOperationCensus({ ...input, exportsSource: "export const MOBILE_EXPORT_METHODS=new Set(['unregisteredExport']);" }), /Unknown MOBILE_OPERATIONS export/);
});

test('native workspace aliases are absent from remote capabilities and rejected by the real authorizer', () => {
  const census = mobileOperationCensus(input);
  const aliases = ['duplicateMobileWorkspaceNote', 'trashMobileWorkspaceNote'];
  for (const method of aliases) assert(!census.entries.some(entry => entry.method === method));
  // Run only the actual pure registry initializer and authorization declaration;
  // no production module import, database, provider or credential access occurs.
  const registry = parse(registrySource);
  const declaration = registry.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : [])
    .find(node => node.name.getText(registry) === 'MOBILE_OPERATIONS');
  const dispatcher = parse(dispatcherSource);
  const authorization = dispatcher.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'authorizeMobileOperation');
  const pure = `const MOBILE_OPERATIONS=${declaration.initializer.getText(registry)};\n${authorization.getText(dispatcher)}`;
  const { outputText, diagnostics } = ts.transpileModule(pure, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true });
  assert.equal(diagnostics.length, 0);
  const context = { exports: {} };
  vm.runInNewContext(outputText, context);
  for (const method of aliases) assert.throws(() => context.exports.authorizeMobileOperation(['corpus', 'writing'], method), /operation_forbidden/);
  const known = census.entries[0];
  assert.doesNotThrow(() => context.exports.authorizeMobileOperation(['corpus', 'writing', 'research-generation'], known.method));
});
