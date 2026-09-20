import {useCallback, useEffect, useRef, useState} from 'react';
import {
  aiError,
  aiWorkflowCommand,
  type IntakeRecord,
} from '../api/ai_workflow_client.js';
import type {
  EvidenceSnapshotSummary,
  SourceSubscriptionView,
} from '../api/m1c_api_contract.js';
import type {MaterialsWorkspaceProps} from './materials_workspace.js';
import type {IntakeOrigin} from './intake_source_state.js';
export function useIntakeDirectory(
  props: MaterialsWorkspaceProps,
  includePrivate = false,
) {
  const {sourceSubscriptionsEnabled, onListSourceSubscriptions} = props;
  const [sources, setSources] = useState<readonly SourceSubscriptionView[]>([]);
  const [originState, setOriginState] = useState<{
    scope: string;
    rows: Map<string, IntakeOrigin>;
    error?: string;
  }>();
  const [records, setRecords] = useState<IntakeRecord[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [originRetry, setOriginRetry] = useState(0);
  const generation = useRef(0);
  const snapshots: readonly EvidenceSnapshotSummary[] =
    props.snapshots.status === 'ready'
      ? props.snapshots.value.filter((s) => includePrivate || !s.isPrivate)
      : [];
  const ids = snapshots.map((s) => s.snapshotId).join(',');
  const scope = String(includePrivate) + ':' + ids;
  const reload = useCallback(async () => {
    const current = ++generation.current;
    try {
      const [intake, subscriptions] = await Promise.all([
        aiWorkflowCommand<{records: IntakeRecord[]}>('intake_status'),
        sourceSubscriptionsEnabled
          ? onListSourceSubscriptions()
          : Promise.resolve(undefined),
      ]);
      if (current !== generation.current) return;
      if (subscriptions && subscriptions.body.status !== 'ok')
        throw new Error('intake_unavailable');
      setRecords(intake.records);
      setSources(
        subscriptions?.body.status === 'ok'
          ? subscriptions.body.subscriptions
          : [],
      );
      setError('');
      setLoaded(true);
    } catch (e) {
      if (current === generation.current) {
        setError(aiError(e));
        setLoaded(false);
      }
    }
  }, [onListSourceSubscriptions, sourceSubscriptionsEnabled]);
  useEffect(() => {
    const timer = setTimeout(() => void reload(), 0);
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, 10000);
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
    };
  }, [reload]);
  useEffect(() => {
    let live = true;
    async function load() {
      const rows = new Map<string, IntakeOrigin>();
      const list = ids ? ids.split(',') : [];
      for (let start = 0; start < list.length; start += 100) {
        const result = await aiWorkflowCommand<{origins: IntakeOrigin[]}>(
          'intake_origins',
          {snapshotIds: list.slice(start, start + 100), includePrivate},
        );
        if (!live) return;
        for (const origin of result.origins)
          rows.set(origin.snapshotId, origin);
      }
      if (live) setOriginState({scope, rows});
    }
    void load().catch((e: unknown) => {
      if (live) setOriginState({scope, rows: new Map(), error: aiError(e)});
    });
    return () => {
      live = false;
    };
  }, [ids, includePrivate, scope, originRetry]);
  const origins =
    originState?.scope === scope
      ? originState.rows
      : new Map<string, IntakeOrigin>();
  const ready =
    loaded &&
    (props.snapshots.status === 'ready' ||
      props.snapshots.status === 'empty') &&
    originState?.scope === scope &&
    !originState.error;
  const failure =
    props.snapshots.status === 'error'
      ? props.snapshots.message
      : error || (originState?.scope === scope ? originState.error : undefined);
  const byId = new Map(records.map((r) => [r.snapshotId, r]));
  const derived = new Set(
    records.flatMap((r) => [
      r.value.preparedSnapshotId,
      ...(r.value.previousPreparedSnapshotIds ?? []),
    ]),
  );
  return {
    sources,
    origins,
    byId,
    records,
    error: failure,
    ready,
    reload: async () => {
      setOriginRetry((value) => value + 1);
      await reload();
    },
    received: snapshots.filter((s) => !derived.has(s.snapshotId)),
  };
}
