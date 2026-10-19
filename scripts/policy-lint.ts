// policy:lint — task 1.4: contracts for the data files, the D-26 hashes, and the src/pipeline/ purity and float lint.
import { dataErrors, hashErrors, pipelineErrors } from '../src/io/lint.js';

const checks: [string, () => string[]][] = [['data files', dataErrors], ['D-26 hashes', hashErrors], ['src/pipeline', pipelineErrors]];
let failed = 0;
for (const [what, run] of checks) {
  const errs = run();
  console.log(`${errs.length ? 'FAIL' : 'ok  '} ${what}${errs.length ? ` (${errs.length})` : ''}`);
  for (const e of errs) console.log(`  ${e}`);
  failed += errs.length;
}
console.log(failed ? `policy:lint FAILED, ${failed} problem(s)` : 'policy:lint OK');
process.exit(failed ? 1 : 0);
