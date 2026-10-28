export interface SourceReceiving {
  schedule:
    | {mode: 'manual' | 'once' | 'interval'}
    | {
        mode: 'window';
        timeZone: string;
        weekdays: number[];
        startMinute: number;
        endMinute: number;
      };
  history: 'discover' | 'none';
  urgency: 'low' | 'normal' | 'high';
  preference: number;
  retryLimit: number;
}
export const DEFAULT_SOURCE_RECEIVING: SourceReceiving = {
  schedule: {mode: 'interval'},
  history: 'discover',
  urgency: 'normal',
  preference: 50,
  retryLimit: 2,
};
export interface SourceReceivingStatus {
  nextCheckAt: string | null;
  reason:
    | 'disabled'
    | 'manual'
    | 'collected'
    | 'due'
    | 'interval'
    | 'window'
    | 'backoff'
    | 'exhausted';
  live: 'poll';
  history: 'public_index' | 'not_supported' | 'disabled';
  pendingCount: number;
  lastNewAt: string | null;
  errorCode: string | null;
  failures: number;
}
export interface Reception {
  channel: 'manual' | 'live' | 'history';
  strategy?: SourceReceiving;
}
