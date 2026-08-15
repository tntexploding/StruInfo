import type {AcceptedTm2Environment} from './environment_oracle.js';
import type {Tm2MandatoryCase} from './mandatory_ledger.js';
import {BoundPostgresTm2Runtime, Tm2SafeFailure} from './bound_runtime.js';
import {
  executeCatalogCase,
  executeGrantCase,
  executeLifecycleCase,
  executeMigrationCase,
  executeTransactionCase,
} from './database_cases.js';
import {executeDomainCase, executeRetrievalCase} from './domain_cases.js';
import {executeEnvironmentCase} from './environment_cases.js';
import {executeQualityCase} from './quality_cases.js';

export interface Tm2CaseEvidence {
  readonly caseId: string;
  readonly vectorId: string;
  readonly assertionCount: number;
  readonly safeEvidenceCodes: readonly string[];
}

export interface Tm2ExecutionContext {
  readonly admission: AcceptedTm2Environment;
  readonly poisonRoot: string;
}

export interface PostgresTm2PublicFacade {
  readonly bindingStatus: 'bound';
  executeCase(
    row: Tm2MandatoryCase,
    context: Tm2ExecutionContext,
  ): Promise<Tm2CaseEvidence>;
  close(): Promise<void>;
}

function admissionIdentity(admission: AcceptedTm2Environment): string {
  const entries: readonly (readonly [
    string,
    AcceptedTm2Environment['admin'],
  ])[] = [
    ['admin', admission.admin],
    ['migration', admission.migration],
    ['runtime', admission.runtime],
  ];
  return JSON.stringify(
    entries.map(([role, entry]) => {
      return [
        role,
        entry.authorityHost,
        entry.config.host,
        entry.config.port,
        entry.config.database,
        entry.config.user,
        entry.config.application_name,
      ];
    }),
  );
}

class BoundPostgresTm2PublicFacade implements PostgresTm2PublicFacade {
  public readonly bindingStatus = 'bound' as const;
  #runtime: BoundPostgresTm2Runtime | undefined;
  #admissionIdentity: string | undefined;
  #closed = false;

  public async executeCase(
    row: Tm2MandatoryCase,
    context: Tm2ExecutionContext,
  ): Promise<Tm2CaseEvidence> {
    if (this.#closed) {
      throw new Tm2SafeFailure('facade_closed');
    }
    this.#bindAdmission(context.admission);
    const result = await this.#executeBoundCase(row, context);
    if (
      result.caseId !== row.id ||
      result.vectorId !== row.vectorId ||
      !Number.isSafeInteger(result.assertionCount) ||
      result.assertionCount < 1 ||
      result.safeEvidenceCodes.length === 0 ||
      result.safeEvidenceCodes.some(
        (code) => !/^PG-TM2-[0-9]{3}:[a-z0-9_-]+$/u.test(code),
      )
    ) {
      throw new Tm2SafeFailure(`${row.id}:unsafe_evidence`);
    }
    return result;
  }

  async #executeBoundCase(
    row: Tm2MandatoryCase,
    context: Tm2ExecutionContext,
  ): Promise<Tm2CaseEvidence> {
    switch (row.group) {
      case 'environment':
        return await executeEnvironmentCase(row, context, () =>
          this.#requireRuntime(context.admission),
        );
      case 'migration':
        return await executeMigrationCase(
          row,
          this.#requireRuntime(context.admission),
        );
      case 'catalog':
        return await executeCatalogCase(
          row,
          this.#requireRuntime(context.admission),
        );
      case 'grant':
        return await executeGrantCase(
          row,
          this.#requireRuntime(context.admission),
        );
      case 'lifecycle':
        return await executeLifecycleCase(
          row,
          this.#requireRuntime(context.admission),
        );
      case 'transaction':
        return await executeTransactionCase(
          row,
          this.#requireRuntime(context.admission),
        );
      case 'domain':
        return await executeDomainCase(
          row,
          this.#requireRuntime(context.admission),
        );
      case 'retrieval':
        return await executeRetrievalCase(
          row,
          this.#requireRuntime(context.admission),
        );
      case 'quality':
        return await executeQualityCase(row);
    }
  }

  public async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    if (this.#runtime !== undefined) {
      await this.#runtime.close();
    }
  }

  #bindAdmission(admission: AcceptedTm2Environment): void {
    const identity = admissionIdentity(admission);
    if (this.#admissionIdentity === undefined) {
      this.#admissionIdentity = identity;
      return;
    }
    if (identity !== this.#admissionIdentity) {
      throw new Tm2SafeFailure('facade_admission_changed');
    }
  }

  #requireRuntime(admission: AcceptedTm2Environment): BoundPostgresTm2Runtime {
    this.#runtime ??= new BoundPostgresTm2Runtime(admission);
    return this.#runtime;
  }
}

let facade: PostgresTm2PublicFacade | undefined;

export function getPostgresTm2PublicFacade(): PostgresTm2PublicFacade {
  facade ??= new BoundPostgresTm2PublicFacade();
  return facade;
}

export function executeTm2MandatoryCase(
  facadeToExecute: PostgresTm2PublicFacade,
  row: Tm2MandatoryCase,
  context: Tm2ExecutionContext,
): Promise<Tm2CaseEvidence> {
  return facadeToExecute.executeCase(row, context);
}
