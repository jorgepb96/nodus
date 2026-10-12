// SPDX-License-Identifier: AGPL-3.0-only
// Run only from the trusted default branch via .github/workflows/cla.yml.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const STATUS = 'CLA / signature';
export const SIGNATURE_BRANCH = 'cla-signatures';

function isCopilotAccount(user) {
  // GitHub exposes this automated account as a GraphQL User. Pin its stable
  // bot ID as well as its login; a human with a similar name is not exempt.
  return user?.id === 'BOT_kgDOC9w8XQ' && user.login?.toLowerCase() === 'copilot';
}

export function agreement(text) {
  const version = text.match(/^Version (\d+) \(/m)?.[1];
  if (!version) throw new Error('CLA.md must have an explicit version.');
  const digest = createHash('sha256').update(text).digest('hex');
  return {
    version, digest, text,
    statement: `I have read and agree to the Nodus Research CLA v${version} (SHA-256: ${digest}).`,
  };
}

export function compatibleAgreements(cla) {
  // PR #1052 changed only the maintainer's GitHub handle and repository links.
  // Pin BOTH documents: no normalization or version-only matching may extend
  // this exception to future edits, even if the version number stays the same.
  if (cla.digest !== '28018d5b63a8adcded0dfde9323a88f3c5e8611460b9bc27f3f1c67013e48aca') return [cla];
  const previous = agreement(cla.text
    .replace('([jorgepb96](https://github.com/jorgepb96))', '([Drakonis96](https://github.com/Drakonis96))')
    .replace('[Nodus Research](https://github.com/jorgepb96/nodus)', '[Nodus Research](https://github.com/Drakonis96/nodus)'));
  if (previous.digest !== '68b2b9153b43fb63d3f8d7bee0156375d02005d3023dc73822994a0273fdbaf1') {
    throw new Error('Unexpected historical CLA document; inspect the username compatibility exception.');
  }
  return [cla, previous];
}

export function acceptance(comment, cla) {
  // The GitHub account, not a name written in the body, is the signer. Reject
  // edited comments (including maintainer edits) and all automated accounts.
  return comment.author?.__typename === 'User' && Boolean(comment.author.id)
    && !isCopilotAccount(comment.author)
    && comment.lastEditedAt === null && comment.body.trim() === cla.statement;
}

export function isAiAttribution(actor) {
  const email = actor.email?.toLowerCase();
  const name = actor.name?.trim() ?? '';
  return (email === 'noreply@anthropic.com' && /^Claude(?: (?:Opus|Sonnet|Haiku)(?: \d+(?:\.\d+)*)?)?$/i.test(name))
    || (['codex@openai.com', 'noreply@openai.com'].includes(email) && /^Codex$/i.test(name))
    || (isCopilotAccount(actor.user) && /^copilot-swe-agent\[bot\]$/i.test(name)
      && email === '198982749+copilot@users.noreply.github.com');
}

export function contributors(pr, commits) {
  const users = new Map();
  const problems = [];
  const add = (user, source) => {
    if (!user?.id || user.__typename !== 'User' || isCopilotAccount(user)) {
      problems.push(`${source}: a human GitHub account is required.`);
    } else {
      users.set(user.id, user);
    }
  };
  add(pr.author, 'PR author');
  if (!commits.length) problems.push('No commits returned; contributor verification is incomplete.');
  for (const commit of commits) {
    if (!commit.authors.nodes.length || commit.authors.totalCount !== commit.authors.nodes.length) {
      problems.push(`Commit ${commit.oid}: incomplete author/coauthor list.`);
    }
    for (const actor of commit.authors.nodes) {
      // Tool attribution never replaces the accountable human PR author above.
      if (isAiAttribution(actor)) continue;
      // Acceptance is only enforceable for accounts that can comment on the PR.
      // A commit email that no GitHub account claims is covered by the signing
      // PR author instead of blocking the whole PR.
      if (actor.user?.id && actor.user.__typename === 'User') users.set(actor.user.id, actor.user);
    }
  }
  return { users: [...users.values()], problems };
}

const fields = {
  commits: `nodes { commit { oid authors(first: 100) {
    totalCount nodes { name email user { __typename id login } }
  } } }`,
  comments: `nodes { id body url createdAt lastEditedAt
    author { __typename login ... on User { id } }
  }`,
};

export async function connection(github, repo, number, name) {
  const nodes = [];
  let cursor = null;
  let snapshot;
  do {
    const data = await github.graphql(`query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
      repository(owner: $owner, name: $repo) { pullRequest(number: $number) {
        headRefOid author { __typename login ... on User { id } }
        ${name}(first: 100, after: $cursor) {
          totalCount pageInfo { hasNextPage endCursor } ${fields[name]}
        }
      } }
    }`, { ...repo, number, cursor });
    const pr = data.repository.pullRequest;
    if (!pr || (snapshot && snapshot.headRefOid !== pr.headRefOid)) {
      throw new Error('The PR changed while reading contributors; rerun the workflow.');
    }
    snapshot = pr;
    const page = pr[name];
    nodes.push(...page.nodes);
    const next = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    if (page.pageInfo.hasNextPage && (!next || next === cursor)) {
      throw new Error(`Incomplete ${name} pagination.`);
    }
    cursor = next;
    if (!cursor && nodes.length !== page.totalCount) throw new Error(`Incomplete ${name} response.`);
  } while (cursor);
  return { pr: snapshot, nodes };
}

async function ensureSignatureBranch(github, repo) {
  try {
    await github.rest.git.getRef({ ...repo, ref: `heads/${SIGNATURE_BRANCH}` });
    return;
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  const { data: tree } = await github.rest.git.createTree({
    ...repo, tree: [{ path: 'README.md', mode: '100644', type: 'blob', content:
      '# Nodus Research CLA acceptance records\n\n'
      + 'Generated by the trusted CLA workflow. Do not edit or delete records.\n'
      + 'Records retain the exact agreement and authenticated acceptance evidence.\n' }],
  });
  const { data: commit } = await github.rest.git.createCommit({
    ...repo, message: 'Initialize CLA acceptance records', tree: tree.sha, parents: [],
  });
  await github.rest.git.createRef({ ...repo, ref: `refs/heads/${SIGNATURE_BRANCH}`, sha: commit.sha });
}

export function signaturePath(cla, userId) {
  return `signatures/v${cla.version}/${cla.digest}/${encodeURIComponent(userId)}.json`;
}

export function validateRecord(record, cla, userId) {
  if (record.user.id !== userId || record.document.version !== cla.version || record.document.sha256 !== cla.digest
      || record.document.text !== cla.text || record.statement !== cla.statement
      || !record.comment.id || !record.comment.url || !record.comment.createdAt) {
    throw new Error('Invalid CLA acceptance record; inspect the signature branch.');
  }
  return record;
}

export async function getSignatureRecord(github, repo, cla, userId) {
  for (const acceptedAgreement of compatibleAgreements(cla)) {
    try {
      const { data } = await github.rest.repos.getContent({
        ...repo, path: signaturePath(acceptedAgreement, userId), ref: SIGNATURE_BRANCH,
      });
      // Validate against the document actually signed, retaining its original
      // statement, text, digest and evidence. Never copy or rewrite signatures.
      return validateRecord(
        JSON.parse(Buffer.from(data.content, 'base64').toString('utf8')),
        acceptedAgreement,
        userId,
      );
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
  return null;
}

export async function run({ github, context, core, document }) {
  const repo = context.repo;
  const cla = agreement(document ?? await readFile(new URL('../CLA.md', import.meta.url), 'utf8'));
  const runUrl = `https://github.com/${repo.owner}/${repo.repo}/actions/runs/${context.runId}`;
  const records = new Map();
  const problems = [];
  const summary = [
    '## Nodus Research Contributor License Agreement',
    'Contributors retain ownership and grant Jorge Pérez Burgueño permission to relicense their contributions.',
    'Read the exact agreement below. To accept, post this exact statement as a **new comment from your own GitHub account** on an open PR:',
    `\n\`\`\`text\n${cla.statement}\n\`\`\``,
    'The public acceptance record is reused for this exact agreement.'
      + (compatibleAgreements(cla).length > 1 ? ' Recorded acceptances from before the maintainer username change are also recognized.' : '')
      + ' All human authors and coauthors must accept. AI-assisted contributions are welcome; the responsible person signs. A checkbox is not a signature.',
  ];
  const prs = await github.paginate(github.rest.pulls.list, { ...repo, state: 'open', per_page: 100 });
  if (!prs.length) {
    await core.summary.addRaw('No open pull requests.').write();
    return;
  }
  const setStatus = (pr, state, description) => github.rest.repos.createCommitStatus({
    ...repo, sha: pr.head.sha, context: STATUS, state,
    description: description.slice(0, 140), target_url: runUrl,
  });
  // Invalidate previous successes before any fallible API/storage operation.
  for (const pr of prs) await setStatus(pr, 'pending', 'Checking CLA acceptance for every contributor.');

  try {
    await ensureSignatureBranch(github, repo);
    const getRecord = async (userId) => {
      if (records.has(userId)) return records.get(userId);
      const record = await getSignatureRecord(github, repo, cla, userId);
      records.set(userId, record);
      return record;
    };
    // Scan all open PRs on every event. A signature can unblock multiple PRs,
    // and pending workflow runs can be replaced by GitHub's concurrency queue.
    const outcomes = new Map();
    for (const pr of prs) {
      const { nodes: comments } = await connection(github, repo, pr.number, 'comments');
      for (const comment of comments) {
        if (!acceptance(comment, cla) || await getRecord(comment.author.id)) continue;
        const record = {
          user: { id: comment.author.id, login: comment.author.login },
          statement: cla.statement,
          document: { version: cla.version, sha256: cla.digest, text: cla.text },
          comment: { id: comment.id, url: comment.url, createdAt: comment.createdAt },
          pullRequest: pr.html_url,
        };
        await github.rest.repos.createOrUpdateFileContents({
          ...repo, branch: SIGNATURE_BRANCH, path: signaturePath(cla, comment.author.id),
          message: `Record CLA v${cla.version} acceptance by ${comment.author.login}`,
          content: Buffer.from(`${JSON.stringify(record, null, 2)}\n`).toString('base64'),
          // No SHA: create only. Never overwrite an acceptance record.
        });
        records.set(comment.author.id, record);
      }
    }
    for (const pr of prs) {
      try {
        const { pr: details, nodes } = await connection(github, repo, pr.number, 'commits');
        if (details.headRefOid !== pr.head.sha) throw new Error('PR head changed; a new workflow run must verify it.');
        const result = contributors(details, nodes.map(node => node.commit));
        const missing = [];
        for (const user of result.users) if (!await getRecord(user.id)) missing.push(`@${user.login}`);
        const { data: latest } = await github.rest.pulls.get({ ...repo, pull_number: pr.number });
        if (latest.state === 'closed') {
          // A merge/close during this scan is normal, not a signature failure.
          // Do not grant success or alter outcomes for open PRs sharing this SHA.
          // The pending status stays unapproved; reopening triggers a fresh scan.
          summary.push(`\n### PR #${pr.number}\nClosed during verification; skipped. Reopening triggers a new check.`);
          continue;
        }
        if (latest.head.sha !== pr.head.sha || latest.state !== 'open') {
          throw new Error('PR changed before publication; a new workflow run must verify it.');
        }
        const failures = [...result.problems];
        if (missing.length) failures.push(`Acceptance needed: ${missing.join(', ')}.`);
        const ok = failures.length === 0;
        const previous = outcomes.get(pr.head.sha);
        outcomes.set(pr.head.sha, {
          pr, ok: ok && (previous?.ok ?? true),
          failures: [...(previous?.failures ?? []), ...failures],
        });
        summary.push(`\n### PR #${pr.number}\n${ok ? 'All contributors have accepted.' : failures.join('\n\n')}`);
      } catch (error) {
        outcomes.set(pr.head.sha, { pr, ok: false, failures: ['CLA verification could not complete. See Details.'] });
        summary.push(`\n### PR #${pr.number}\nVerification failed. See workflow logs.`);
        problems.push(`PR #${pr.number}: ${error.message}`);
      }
    }
    // Commit statuses belong to a SHA, not to a PR. If several PRs share the
    // same head, none may overwrite another PR's missing acceptance with green.
    for (const { pr, ok, failures } of outcomes.values()) {
      await setStatus(pr, ok ? 'success' : 'failure', ok ? 'All contributors have accepted the CLA.' : failures.join(' '));
    }
  } catch (error) {
    for (const pr of prs) await setStatus(pr, 'failure', 'CLA verification could not complete. See Details.');
    problems.push(error.message);
  }
  // Include the actual hashed document, not a mutable main/CLA.md link.
  summary.push(`\n## Exact agreement (SHA-256: ${cla.digest})\n\n${cla.text}`);
  await core.summary.addRaw(summary.join('\n\n')).write();
  if (problems.length) core.setFailed(problems.join('\n'));
}
