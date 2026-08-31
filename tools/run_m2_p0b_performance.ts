import {
  M2_P0B_SMOKE_PERFORMANCE_WORKLOAD,
  runM2P0bPerformanceWorkload,
} from './m2_p0b_performance.js';

const arguments_ = process.argv.slice(2);
const smoke = arguments_.length === 1 && arguments_[0] === '--smoke';

if (arguments_.length > (smoke ? 1 : 0)) {
  process.stderr.write(
    `${JSON.stringify({event: 'm2_p0b_performance_failed', code: 'invalid_arguments'})}\n`,
  );
  process.exitCode = 1;
} else {
  try {
    const report = runM2P0bPerformanceWorkload(
      smoke ? M2_P0B_SMOKE_PERFORMANCE_WORKLOAD : undefined,
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch {
    process.stderr.write(
      `${JSON.stringify({event: 'm2_p0b_performance_failed', code: 'execution_failed'})}\n`,
    );
    process.exitCode = 1;
  }
}
