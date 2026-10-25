import assert from 'node:assert/strict';
import test from 'node:test';
import { validationCases, resolveValidationWorkIds } from './lib/research-validation-cases.mjs';

test('scoped benchmark cases resolve records locally without broadening their grant', () => {
  assert.equal(validationCases[1].length, 15);
  assert.equal(validationCases[2].length, 10);
  const scoped = validationCases[1][0];
  const records = new Map(scoped.workTitles.map((title, i) => [title, [{ nodus_id: `fixture-work-${i}` }]]));
  assert.deepEqual(resolveValidationWorkIds(scoped, title => records.get(title)), ['fixture-work-0', 'fixture-work-1']);
  assert.throws(() => resolveValidationWorkIds(scoped, () => []), /exactly one/);
  assert.throws(() => resolveValidationWorkIds(scoped, () => [{ nodus_id: 'a' }, { nodus_id: 'b' }]), /exactly one/);
  assert.equal(resolveValidationWorkIds(validationCases[1][1], () => { throw new Error('Unscoped cases need no implicit selection'); }), undefined);
});
