import type {AcceptedTm2Environment} from './environment_oracle.js';
import type {Tm2CaseGroup, Tm2MandatoryCase} from './mandatory_ledger.js';

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
  readonly bindingStatus: 'bound' | 'backend_binding_unavailable';
  executeEnvironmentCase(
    row: Tm2MandatoryCase,
    context: Tm2ExecutionContext,
  ): Promise<Tm2CaseEvidence>;
  executeMigrationCase(
    row: Tm2MandatoryCase,
    context: Tm2ExecutionContext,
  ): Promise<Tm2CaseEvidence>;
  executeCatalogCase(
    row: Tm2MandatoryCase,
    context: Tm2ExecutionContext,
  ): Promise<Tm2CaseEvidence>;
  executeGrantCase(
    row: Tm2MandatoryCase,
    context: Tm2ExecutionContext,
  ): Promise<Tm2CaseEvidence>;
  executeLifecycleCase(
    row: Tm2MandatoryCase,
    context: Tm2ExecutionContext,
  ): Promise<Tm2CaseEvidence>;
  executeTransactionCase(
    row: Tm2MandatoryCase,
    context: Tm2ExecutionContext,
  ): Promise<Tm2CaseEvidence>;
  executeDomainCase(
    row: Tm2MandatoryCase,
    context: Tm2ExecutionContext,
  ): Promise<Tm2CaseEvidence>;
  executeRetrievalCase(
    row: Tm2MandatoryCase,
    context: Tm2ExecutionContext,
  ): Promise<Tm2CaseEvidence>;
  executeQualityCase(
    row: Tm2MandatoryCase,
    context: Tm2ExecutionContext,
  ): Promise<Tm2CaseEvidence>;
}

export class PostgresTm2BindingUnavailable extends Error {
  readonly code = 'PG_TM2_BACKEND_BINDING_UNAVAILABLE';

  constructor(group: Tm2CaseGroup, caseId: string) {
    super(`${group}:${caseId}`);
    this.name = 'PostgresTm2BindingUnavailable';
  }
}

function unavailable(
  group: Tm2CaseGroup,
  row: Tm2MandatoryCase,
): Promise<Tm2CaseEvidence> {
  return Promise.reject(new PostgresTm2BindingUnavailable(group, row.id));
}

const unboundFacade: PostgresTm2PublicFacade = Object.freeze({
  bindingStatus: 'backend_binding_unavailable' as const,
  executeEnvironmentCase: (row: Tm2MandatoryCase) =>
    unavailable('environment', row),
  executeMigrationCase: (row: Tm2MandatoryCase) =>
    unavailable('migration', row),
  executeCatalogCase: (row: Tm2MandatoryCase) => unavailable('catalog', row),
  executeGrantCase: (row: Tm2MandatoryCase) => unavailable('grant', row),
  executeLifecycleCase: (row: Tm2MandatoryCase) =>
    unavailable('lifecycle', row),
  executeTransactionCase: (row: Tm2MandatoryCase) =>
    unavailable('transaction', row),
  executeDomainCase: (row: Tm2MandatoryCase) => unavailable('domain', row),
  executeRetrievalCase: (row: Tm2MandatoryCase) =>
    unavailable('retrieval', row),
  executeQualityCase: (row: Tm2MandatoryCase) => unavailable('quality', row),
});

export function getPostgresTm2PublicFacade(): PostgresTm2PublicFacade {
  return unboundFacade;
}

export function executeTm2MandatoryCase(
  facade: PostgresTm2PublicFacade,
  row: Tm2MandatoryCase,
  context: Tm2ExecutionContext,
): Promise<Tm2CaseEvidence> {
  switch (row.group) {
    case 'environment':
      return facade.executeEnvironmentCase(row, context);
    case 'migration':
      return facade.executeMigrationCase(row, context);
    case 'catalog':
      return facade.executeCatalogCase(row, context);
    case 'grant':
      return facade.executeGrantCase(row, context);
    case 'lifecycle':
      return facade.executeLifecycleCase(row, context);
    case 'transaction':
      return facade.executeTransactionCase(row, context);
    case 'domain':
      return facade.executeDomainCase(row, context);
    case 'retrieval':
      return facade.executeRetrievalCase(row, context);
    case 'quality':
      return facade.executeQualityCase(row, context);
  }
}
