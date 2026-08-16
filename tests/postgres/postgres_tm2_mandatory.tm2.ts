import {afterAll, describe, expect, it} from 'vitest';

import {
  admitTm2Environment,
  type AcceptedTm2Environment,
} from '../../apps/server/test_support/postgres_tm2/environment_oracle.js';
import {TM2_MANDATORY_LEDGER} from '../../apps/server/test_support/postgres_tm2/mandatory_ledger.js';
import {
  executeTm2MandatoryCase,
  getPostgresTm2PublicFacade,
} from '../../apps/server/test_support/postgres_tm2/public_facade.js';

function requireAdmittedEnvironment(): AcceptedTm2Environment {
  if (process.env.STRUIINFO_TM2_ADMISSION_PROVEN !== '1') {
    throw new Error('PG_TM2_HARNESS_ADMISSION_REQUIRED');
  }
  const admission = admitTm2Environment(process.env);
  if (admission.status === 'not_ready') {
    throw new Error(`PG_TM2_HARNESS_ADMISSION_DRIFT:${admission.code}`);
  }
  return admission;
}

describe('PostgreSQL TM2 mandatory ledger', {concurrent: false}, () => {
  const facade = getPostgresTm2PublicFacade();

  afterAll(async () => {
    await facade.close();
  });

  for (const row of TM2_MANDATORY_LEDGER) {
    it(`${row.id} ${row.vectorId}`, async () => {
      const admission = requireAdmittedEnvironment();
      const poisonRoot = process.env.STRUIINFO_TM2_POISON_ROOT;
      if (poisonRoot === undefined || poisonRoot === '') {
        throw new Error('PG_TM2_POISON_ROOT_REQUIRED');
      }
      const evidence = await executeTm2MandatoryCase(facade, row, {
        admission,
        poisonRoot,
      });
      expect(evidence.caseId).toBe(row.id);
      expect(evidence.vectorId).toBe(row.vectorId);
      expect(evidence.assertionCount).toBeGreaterThan(0);
      expect(evidence.safeEvidenceCodes.length).toBeGreaterThan(0);
    });
  }
});
