import type {EvidenceSnapshot} from '../api/m1c_api_contract.js';

export type ProductSection =
  | 'overview'
  | 'import'
  | 'split'
  | 'tags'
  | 'associations'
  | 'query'
  | 'knowledge';

export type Loadable<T> =
  | Readonly<{status: 'loading'}>
  | Readonly<{status: 'ready'; value: T}>
  | Readonly<{status: 'empty'}>
  | Readonly<{status: 'error'; message: string}>;

export type EvidencePanelState =
  | Readonly<{status: 'closed'}>
  | Readonly<{
      status: 'loading';
      snapshotId: string;
      selectedFragmentId?: string | undefined;
      includePrivate?: boolean;
    }>
  | Readonly<{
      status: 'ready';
      snapshot: Readonly<EvidenceSnapshot>;
      selectedFragmentId?: string | undefined;
    }>
  | Readonly<{
      status: 'error';
      snapshotId: string;
      selectedFragmentId?: string | undefined;
      includePrivate?: boolean;
      message: string;
    }>;

export interface ActionFeedback {
  readonly kind: 'success' | 'error';
  readonly title: string;
  readonly detail: string;
}

export interface WorkspaceTransferFeedback extends ActionFeedback {
  readonly fileName?: string;
}
