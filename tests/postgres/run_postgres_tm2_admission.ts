import {runTm2AdmissionChild} from '../../apps/server/test_support/postgres_tm2/admission_child.js';

try {
  const outcome = await runTm2AdmissionChild(process.env);
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
  process.exitCode =
    outcome.status === 'admitted' ? 0 : outcome.status === 'not_ready' ? 2 : 1;
} catch {
  process.stdout.write(
    `${JSON.stringify({status: 'failed', code: 'tm2_admission_child_failure'})}\n`,
  );
  process.exitCode = 1;
}
