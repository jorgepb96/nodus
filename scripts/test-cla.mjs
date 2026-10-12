import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  STATUS, SIGNATURE_BRANCH, acceptance, agreement, compatibleAgreements, connection, contributors,
  isAiAttribution, run, signaturePath,
} from './cla.mjs';

const document = await readFile(new URL('../CLA.md', import.meta.url), 'utf8');
const cla = agreement(document);
const alice = { __typename: 'User', id: 'user-1', login: 'alice' };
const bob = { __typename: 'User', id: 'user-2', login: 'bob' };
const bot = { __typename: 'Bot', id: 'bot-1', login: 'automation' };
const copilot = { __typename: 'User', id: 'BOT_kgDOC9w8XQ', login: 'Copilot' };
const copilotActor = {
  name: 'copilot-swe-agent[bot]', email: '198982749+Copilot@users.noreply.github.com', user: copilot,
};
const commit = (...users) => ({
  oid: 'a'.repeat(40), authors: { totalCount: users.length, nodes: users.map(user => ({ user })) },
});
const signingComment = (author = alice, overrides = {}) => ({
  id: `comment-${author.id}`, author, body: cla.statement, lastEditedAt: null,
  url: `https://github.com/example/nodus/pull/1#issuecomment-${author.id}`,
  createdAt: '2026-09-05T12:00:00Z', ...overrides,
});
const fixture = (number = 1, author = alice) => ({
  number, author, comments: [], commits: [commit(author)],
  head: { sha: String(number).repeat(40) },
  html_url: `https://github.com/example/nodus/pull/${number}`, state: 'open',
});

function harness(prs, options = {}) {
  const statuses = [];
  const writes = [];
  const files = options.files ?? new Map();
  const errors = [];
  let summary = '';
  const notFound = () => { throw Object.assign(new Error('Not found'), { status: 404 }); };
  const github = {
    paginate: async () => prs,
    graphql: async (query, args) => {
      if (options.apiError) throw new Error('GitHub unavailable');
      const pr = prs.find(item => item.number === args.number);
      const field = query.includes('comments(first:') ? 'comments' : 'commits';
      const nodes = field === 'comments' ? pr.comments : pr.commits.map(c => ({ commit: c }));
      return { repository: { pullRequest: {
        headRefOid: pr.head.sha, author: pr.author,
        [field]: { nodes, totalCount: nodes.length, pageInfo: { hasNextPage: false, endCursor: null } },
      } } };
    },
    rest: {
      pulls: {
        list() {},
        get: async ({ pull_number }) => ({ data: {
          ...prs.find(pr => pr.number === pull_number),
          ...(options.changedHead ? { head: { sha: 'changed' } } : {}),
          ...(options.closedPrs?.includes(pull_number) ? { state: 'closed' } : {}),
        } }),
      },
      git: { getRef: async () => ({ data: {} }) },
      repos: {
        createCommitStatus: async args => { statuses.push(args); },
        getContent: async args => {
          assert.equal(args.ref, SIGNATURE_BRANCH);
          const content = files.get(args.path);
          return content ? { data: { content } } : notFound();
        },
        createOrUpdateFileContents: async args => {
          assert.equal(args.branch, SIGNATURE_BRANCH);
          assert.equal(args.sha, undefined, 'records must be create-only');
          if (options.storageError) throw new Error('Cannot persist acceptance');
          assert.ok(!files.has(args.path), 'must never overwrite an existing record');
          files.set(args.path, args.content);
          writes.push(args);
        },
      },
    },
  };
  const core = {
    summary: { addRaw(text) { summary += text; return this; }, async write() {} },
    setFailed(message) { errors.push(message); },
  };
  return {
    statuses, writes, files, errors, github, core,
    summary: () => summary,
    execute: () => run({ github, core, document: options.document ?? document, context: { repo: { owner: 'example', repo: 'nodus' }, runId: 123 } }),
  };
}

test('only a new, exact acceptance from the actual human account is a signature', () => {
  assert.equal(acceptance(signingComment(), cla), true);
  assert.equal(acceptance(signingComment(alice, { body: `  ${cla.statement}\n` }), cla), true);
  for (const comment of [
    signingComment(bot),
    signingComment(copilot),
    signingComment(alice, { lastEditedAt: '2026-09-05T13:00:00Z' }),
    signingComment(alice, { body: `> ${cla.statement}` }),
    signingComment(alice, { body: `- [x] ${cla.statement}` }),
    signingComment(alice, { body: `${cla.statement} on behalf of bob` }),
    signingComment(alice, { author: null }),
    signingComment(alice, { body: 'I agree' }),
  ]) assert.equal(acceptance(comment, cla), false);
});

test('an agreement change requires a new acceptance even if someone forgets to bump the version', () => {
  const changed = agreement(`${document}\nChanged terms.\n`);
  assert.notEqual(changed.digest, cla.digest);
  assert.notEqual(signaturePath(changed, alice.id), signaturePath(cla, alice.id));
  assert.equal(acceptance(signingComment(), changed), false);
});

test('PR authors, commit authors, and human coauthors all need acceptance', () => {
  const result = contributors({ author: alice }, [commit(alice, bob), commit(bob)]);
  assert.deepEqual(result.users, [alice, bob]);
  assert.deepEqual(result.problems, []);
  assert.equal(contributors({ author: bot }, [commit(alice)]).problems.length, 1);
  assert.equal(contributors({ author: alice }, []).problems.length, 1);
  const truncated = commit(alice);
  truncated.authors.totalCount = 101;
  assert.equal(contributors({ author: alice }, [truncated]).problems.length, 1);
});

test('commit emails that no GitHub account claims are skipped, not blocking', () => {
  const unlinked = { name: 'alice', email: 'alice@example.org', user: null };
  const result = contributors({ author: alice }, [{
    oid: 'b'.repeat(40), authors: { totalCount: 1, nodes: [unlinked] },
  }]);
  assert.deepEqual(result.users, [alice]);
  assert.deepEqual(result.problems, []);
});

test('recognized AI attributions are allowed but never exempt the human submitter', () => {
  const ai = { name: 'Claude Sonnet 5', email: 'noreply@anthropic.com', user: bob };
  assert.equal(isAiAttribution(ai), true);
  assert.equal(isAiAttribution({ name: 'Codex', email: 'codex@openai.com' }), true);
  assert.equal(isAiAttribution({ ...ai, email: 'another@example.org' }), false);
  assert.equal(isAiAttribution({ ...ai, name: 'A human' }), false);
  const result = contributors({ author: alice }, [{
    ...commit(alice), authors: { totalCount: 2, nodes: [{ user: alice }, ai] },
  }]);
  assert.deepEqual(result.users, [alice]);
  assert.deepEqual(result.problems, []);
  assert.equal(contributors({ author: bot }, [{
    ...commit(alice), authors: { totalCount: 1, nodes: [ai] },
  }]).problems.length, 1);
});

test('the verified Copilot bot attribution never exempts a human contributor or PR author', () => {
  assert.equal(isAiAttribution(copilotActor), true);
  assert.equal(isAiAttribution({
    ...copilotActor, name: 'COPILOT-SWE-AGENT[BOT]', email: copilotActor.email.toLowerCase(),
  }), true);
  for (const actor of [
    { ...copilotActor, user: null },
    { ...copilotActor, user: { ...copilot, id: bob.id } },
    { ...copilotActor, user: { ...copilot, login: bob.login } },
    { ...copilotActor, name: 'A human' },
    { ...copilotActor, email: 'copilot@example.org' },
  ]) assert.equal(isAiAttribution(actor), false);

  const authors = { totalCount: 3, nodes: [copilotActor, { user: alice }, { user: bob }] };
  const result = contributors({ author: alice }, [{ ...commit(alice), authors }]);
  assert.deepEqual(result.users, [alice, bob]);
  assert.deepEqual(result.problems, []);
  assert.equal(contributors({ author: copilot }, [commit(alice)]).problems.length, 1);
});

test('Copilot commits still require the human submitter signature and create no bot record', async () => {
  const pr = fixture();
  pr.commits = [{ ...commit(alice), authors: { totalCount: 1, nodes: [copilotActor] } }];
  const unsigned = harness([pr]);
  await unsigned.execute();
  assert.equal(unsigned.statuses.at(-1).state, 'failure');
  assert.match(unsigned.statuses.at(-1).description, /@alice/);
  assert.doesNotMatch(unsigned.statuses.at(-1).description, /@Copilot/);

  pr.comments = [signingComment(copilot), signingComment()];
  const signed = harness([pr]);
  await signed.execute();
  assert.equal(signed.statuses.at(-1).state, 'success');
  assert.equal(signed.writes.length, 1);
  assert.equal(JSON.parse(Buffer.from(signed.writes[0].content, 'base64').toString()).user.id, alice.id);
});

test('unsigned PRs fail with signing instructions and the exact agreement', async () => {
  const h = harness([fixture()]);
  await h.execute();
  assert.deepEqual(h.statuses.map(s => s.state), ['pending', 'failure']);
  assert.ok(h.statuses.every(s => s.context === STATUS && s.sha === '1'.repeat(40)));
  assert.match(h.statuses.at(-1).description, /@alice/);
  assert.ok(h.summary().includes(cla.statement));
  assert.ok(h.summary().includes(document));
});

test('a persisted signature unblocks every open PR and survives deleted comments and account renames', async () => {
  const first = fixture();
  first.comments = [signingComment()];
  const second = fixture(2);
  const h = harness([first, second]);
  await h.execute();
  assert.equal(h.writes.length, 1);
  assert.deepEqual(h.statuses.slice(-2).map(s => s.state), ['success', 'success']);
  const record = JSON.parse(Buffer.from(h.writes[0].content, 'base64').toString());
  assert.equal(record.document.text, document);
  assert.equal(record.comment.id, signingComment().id);
  assert.equal(record.user.id, alice.id);
  const renamed = fixture(3, { ...alice, login: 'alice-renamed' });
  const next = harness([renamed], { files: h.files });
  await next.execute();
  assert.equal(next.writes.length, 0);
  assert.equal(next.statuses.at(-1).state, 'success');
});

test('persisted signatures from before the maintainer rename unblock all PRs without rewriting records', async () => {
  const [current, previous] = compatibleAgreements(cla);
  assert.equal(current.digest, '28018d5b63a8adcded0dfde9323a88f3c5e8611460b9bc27f3f1c67013e48aca');
  assert.equal(previous.digest, '68b2b9153b43fb63d3f8d7bee0156375d02005d3023dc73822994a0273fdbaf1');
  // Persist authentic signatures under the historical document first.
  const oldPr = fixture();
  oldPr.comments = [signingComment(alice, { body: previous.statement })];
  const old = harness([oldPr], { document: previous.text });
  await old.execute();
  assert.equal(old.writes.length, 1);
  const snapshot = [...old.files];

  const renamed = fixture(2, { ...alice, login: 'alice-renamed' });
  renamed.commits = [commit(renamed.author, bob)];
  renamed.comments = [signingComment(bob)];
  const another = fixture(3, renamed.author);
  // Even an existing current acceptance comment must not copy Alice's record.
  another.comments = [signingComment(renamed.author)];
  const next = harness([renamed, another], { files: old.files });
  await next.execute();
  assert.deepEqual(next.errors, []);
  assert.deepEqual(next.statuses.slice(-2).map(s => s.state), ['success', 'success']);
  assert.equal(next.writes.length, 1, 'only the newly signed coauthor gets a record');
  assert.equal(next.writes[0].path, signaturePath(current, bob.id));
  assert.equal(next.files.get(snapshot[0][0]), snapshot[0][1], 'historical record stays byte-for-byte unchanged');
  assert.equal(next.files.has(signaturePath(current, alice.id)), false);
});

test('rename compatibility does not cover future edits, version changes or unsigned coauthors', async () => {
  const [, previous] = compatibleAgreements(cla);
  const pr = fixture();
  pr.comments = [signingComment(alice, { body: previous.statement })];
  const old = harness([pr], { document: previous.text });
  await old.execute();
  const unsignedCoauthor = fixture(2);
  unsignedCoauthor.commits = [commit(alice, bob)];
  const gate = harness([unsignedCoauthor], { files: old.files });
  await gate.execute();
  assert.equal(gate.statuses.at(-1).state, 'failure');
  assert.match(gate.statuses.at(-1).description, /@bob/);
  assert.doesNotMatch(gate.statuses.at(-1).description, /@alice/);

  for (const changedText of [
    `${document}\nChanged terms.\n`,
    document.replace('Version 1 (', 'Version 2 ('),
    document.replace('royalty-free', 'royalty-bearing'),
    document.replace('jorgepb96', 'another-maintainer'),
    `${document}\n`,
  ]) {
    const changed = agreement(changedText);
    assert.deepEqual(compatibleAgreements(changed), [changed]);
    assert.equal(acceptance(signingComment(alice, { body: previous.statement }), changed), false);
    const next = harness([fixture()], { files: old.files, document: changedText });
    await next.execute();
    assert.equal(next.statuses.at(-1).state, 'failure');
    assert.match(next.statuses.at(-1).description, /@alice/);
    assert.equal(next.writes.length, 0);
  }
});

test('corrupt or mismatched historical signatures and historical API errors fail closed', async () => {
  const [, previous] = compatibleAgreements(cla);
  const pr = fixture();
  pr.comments = [signingComment(alice, { body: previous.statement })];
  const old = harness([pr], { document: previous.text });
  await old.execute();
  const path = signaturePath(previous, alice.id);
  const original = JSON.parse(Buffer.from(old.files.get(path), 'base64').toString('utf8'));
  for (const mutate of [
    record => { record.user.id = bob.id; },
    record => { record.document.text += '\n'; },
    record => { record.document.sha256 = cla.digest; },
    record => { record.document.version = '2'; },
    record => { record.statement = cla.statement; },
    record => { record.comment.id = ''; },
  ]) {
    const record = structuredClone(original);
    mutate(record);
    const files = new Map([[path, Buffer.from(JSON.stringify(record)).toString('base64')]]);
    const next = harness([fixture()], { files });
    await next.execute();
    assert.equal(next.statuses.at(-1).state, 'failure');
    assert.ok(next.errors.length);
    assert.equal(next.writes.length, 0);
  }
  const unavailable = harness([fixture()]);
  const read = unavailable.github.rest.repos.getContent;
  unavailable.github.rest.repos.getContent = async args => {
    if (args.path === path) throw Object.assign(new Error('Unavailable'), { status: 503 });
    return read(args);
  };
  await unavailable.execute();
  assert.equal(unavailable.statuses.at(-1).state, 'failure');
  assert.ok(unavailable.errors.length);
});

test('one signed author cannot cover an unsigned human coauthor', async () => {
  const pr = fixture();
  pr.comments = [signingComment()];
  pr.commits = [commit(alice, bob)];
  const h = harness([pr]);
  await h.execute();
  assert.equal(h.statuses.at(-1).state, 'failure');
  assert.match(h.statuses.at(-1).description, /@bob/);
});

test('a signed responsible human can merge an AI-assisted contribution', async () => {
  const pr = fixture();
  pr.comments = [signingComment()];
  pr.commits[0].authors.nodes.push({ name: 'Claude Sonnet 5', email: 'noreply@anthropic.com', user: bob });
  pr.commits[0].authors.totalCount = 2;
  const h = harness([pr]);
  await h.execute();
  assert.equal(h.statuses.at(-1).state, 'success');
  assert.equal(h.writes.length, 1);
});

test('an unlinked commit email does not block a signed PR author', async () => {
  const pr = fixture();
  pr.comments = [signingComment()];
  pr.commits = [{
    oid: 'b'.repeat(40),
    authors: { totalCount: 2, nodes: [
      { name: 'alice', email: 'alice@example.org', user: null },
      { name: 'Claude Sonnet 5', email: 'noreply@anthropic.com', user: bob },
    ] },
  }];
  const h = harness([pr]);
  await h.execute();
  assert.equal(h.statuses.at(-1).state, 'success');
  assert.equal(h.writes.length, 1);
});

test('PRs sharing a SHA cannot overwrite a missing signature with success', async () => {
  const unsigned = fixture(1, bob);
  const signed = fixture(2);
  signed.comments = [signingComment()];
  signed.head.sha = unsigned.head.sha;
  const h = harness([unsigned, signed]);
  await h.execute();
  assert.equal(h.statuses.at(-1).state, 'failure');
  assert.match(h.statuses.at(-1).description, /@bob/);
});

test('API failures, persistence failures, corrupt records, and changed heads fail closed', async () => {
  for (const options of [{ apiError: true }, { storageError: true }, { changedHead: true }, {
    files: new Map([[signaturePath(cla, alice.id), Buffer.from('{}').toString('base64')]]),
  }]) {
    const pr = fixture();
    pr.comments = [signingComment()];
    const h = harness([pr], options);
    await h.execute();
    assert.equal(h.statuses[0].state, 'pending');
    assert.equal(h.statuses.at(-1).state, 'failure');
    assert.ok(h.errors.length);
  }
});

test('closing or merging a PR during verification does not fail the workflow or grant acceptance', async () => {
  const closing = fixture();
  const open = fixture(2, bob);
  open.comments = [signingComment(bob)];
  const h = harness([closing, open], { closedPrs: [1] });
  await h.execute();
  assert.deepEqual(h.errors, []);
  assert.deepEqual(h.statuses.filter(s => s.sha === closing.head.sha).map(s => s.state), ['pending']);
  assert.equal(h.statuses.filter(s => s.sha === open.head.sha).at(-1).state, 'success');
  assert.match(h.summary(), /PR #1\nClosed during verification; skipped/);

  // A reopened PR must still obtain its own acceptance.
  const reopened = harness([closing], { files: h.files });
  await reopened.execute();
  assert.equal(reopened.statuses.at(-1).state, 'failure');
  assert.match(reopened.statuses.at(-1).description, /@alice/);
});

test('a PR closing during verification cannot override the gate of an open PR sharing its SHA', async () => {
  for (const signed of [false, true]) {
    for (const closedFirst of [false, true]) {
      const closing = fixture(1);
      const open = fixture(2, bob);
      open.head.sha = closing.head.sha;
      if (signed) open.comments = [signingComment(bob)];
      const h = harness(closedFirst ? [closing, open] : [open, closing], { closedPrs: [1] });
      await h.execute();
      assert.deepEqual(h.errors, []);
      assert.equal(h.statuses.at(-1).state, signed ? 'success' : 'failure');
      if (!signed) assert.match(h.statuses.at(-1).description, /@bob/);
    }
  }
});

test('pagination includes late coauthors/comments and rejects incomplete or changing data', async () => {
  const calls = [];
  const github = { graphql: async (_query, { cursor }) => {
    calls.push(cursor);
    return { repository: { pullRequest: {
      headRefOid: 'head', author: alice,
      comments: { totalCount: 2, nodes: [cursor ? signingComment(bob) : signingComment()],
        pageInfo: { hasNextPage: !cursor, endCursor: cursor ? null : 'page-2' } },
    } } };
  } };
  const result = await connection(github, {}, 1, 'comments');
  assert.equal(result.nodes.length, 2);
  assert.deepEqual(calls, [null, 'page-2']);
  for (const mode of ['head-change', 'truncated', 'stuck']) {
    const broken = { graphql: async (...args) => {
      const result = await github.graphql(...args);
      const pr = result.repository.pullRequest;
      if (mode === 'head-change' && args[1].cursor) pr.headRefOid = 'changed';
      if (mode === 'truncated') pr.comments.totalCount = 10;
      if (mode === 'stuck') pr.comments.pageInfo = { hasNextPage: true, endCursor: null };
      return result;
    } };
    await assert.rejects(connection(broken, {}, 1, 'comments'));
  }
});

test('signature storage initializes as an independent branch without repository source', async () => {
  const h = harness([fixture()]);
  const writes = [];
  h.github.rest.git = {
    getRef: async () => { throw Object.assign(new Error('missing'), { status: 404 }); },
    createTree: async args => { writes.push(args); return { data: { sha: 'tree' } }; },
    createCommit: async args => { writes.push(args); return { data: { sha: 'commit' } }; },
    createRef: async args => { writes.push(args); },
  };
  await h.execute();
  assert.equal(writes[0].tree.length, 1);
  assert.equal(writes[0].tree[0].path, 'README.md');
  assert.deepEqual(writes[1].parents, []);
  assert.equal(writes[2].ref, `refs/heads/${SIGNATURE_BRANCH}`);
});

test('workflow runs trusted code without installing PR dependencies or using PR text as code', async () => {
  const workflow = await readFile(new URL('../.github/workflows/cla.yml', import.meta.url), 'utf8');
  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /ref: \$\{\{ github.event.repository.default_branch \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /head\.sha|head\.ref|npm (?:ci|install)|pull_request\.body/);
});

test('website refreshes its deployed cache without bypassing main protection', async () => {
  const workflow = await readFile(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /git push|git commit|contents: write/);
  const refresh = workflow.slice(workflow.indexOf('- name: Refresh shared release download totals'), workflow.indexOf('- name: Configure GitHub Pages'));
  assert.match(refresh, /run: node scripts\/github-release-downloads.mjs/);
  assert.doesNotMatch(refresh, /\bif:/, 'push deployments must not restore an older cache');
});
