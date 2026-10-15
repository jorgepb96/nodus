import fs from 'node:fs';
import path from 'node:path';

const write = (file, value) => {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
};

// One durable human authorization spans all attempts, including uncertain
// requests. A crash leaves the attempt active and blocks a budget reset.
export function claimOpenRouterBudget(repo, authorizationFile, output, root) {
  const lock = `${authorizationFile}.lock`;
  const descriptor = fs.openSync(lock, 'wx');
  try {
    const authorization = JSON.parse(fs.readFileSync(authorizationFile, 'utf8'));
    if (authorization.credentialAccessStoppedByUser === true) {
      throw new Error('OpenRouter QA credential access was stopped by the user; no new attempt may start');
    }
    if (authorization.format !== 'research-openrouter-authorization/1' || authorization.limitUsd !== 0.5
      || authorization.oldDeepSeekCampaignReopened !== false || authorization.activeAttempt) throw new Error('Campaign authorization unavailable or already active');
    let committed = 0;
    for (const attempt of authorization.priorAttempts) {
      const report = JSON.parse(fs.readFileSync(path.resolve(repo, attempt.report), 'utf8'));
      const amount = report.cost?.accountedUpperBoundUsd ?? report.cost?.committedUsd;
      if (!Number.isFinite(amount) || amount < 0 || Math.abs(amount - attempt.committedUsd) > 1e-9) throw new Error('Previous campaign accounting mismatch');
      committed += amount;
    }
    const remaining = authorization.limitUsd - committed;
    if (remaining <= 0) throw new Error('Additional campaign budget exhausted');
    const report = path.relative(repo, path.join(output, 'campaign.json'));
    if (report.startsWith('..') || path.isAbsolute(report)) throw new Error('Campaign report must stay inside this repository');
    authorization.activeAttempt = { report, root, limitUsd: remaining, startedAt: new Date().toISOString() };
    authorization.remainingUsd = remaining;
    write(authorizationFile, authorization);
    return { limitUsd: remaining, priorCommittedUsd: committed };
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
  }
}

export function closeOpenRouterBudget(authorizationFile, root, committedUsd) {
  const authorization = JSON.parse(fs.readFileSync(authorizationFile, 'utf8'));
  if (authorization.activeAttempt?.root !== root || !Number.isFinite(committedUsd) || committedUsd < 0) throw new Error('Invalid campaign closure');
  authorization.priorAttempts.push({ report: authorization.activeAttempt.report, committedUsd });
  delete authorization.activeAttempt;
  authorization.remainingUsd = Math.max(0, authorization.limitUsd - authorization.priorAttempts.reduce((sum, attempt) => sum + attempt.committedUsd, 0));
  authorization.state = authorization.remainingUsd === 0 ? 'budget-exhausted' : 'closed';
  write(authorizationFile, authorization);
}
