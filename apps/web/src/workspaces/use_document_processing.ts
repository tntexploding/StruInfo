import {useCallback, useEffect, useRef, useState} from 'react';
import {
  aiWorkflowCommand,
  aiError,
  type AiTask,
  type IntakeRecord,
  type AiWorkflowClient,
} from '../api/ai_workflow_client.js';
import {intakeForDocument} from './document_processing_state.js';

export function useDocumentProcessing(
  active: boolean,
  snapshotId: string,
  onResultsChanged: (id: string) => void,
  client: AiWorkflowClient = aiWorkflowCommand,
) {
  const [view, setView] = useState<{
    scope: string;
    tasks: AiTask[];
    records: IntakeRecord[];
  }>();
  const [error, setError] = useState<{scope: string; text: string}>();
  const generation = useRef(0);
  const completed = useRef(new Map<string, string>());
  const load = useCallback(async () => {
    const request = ++generation.current;
    try {
      const [intake, recent] = await Promise.all([
        client<{records: IntakeRecord[]}>('intake_status'),
        client<AiTask[]>('tasks_list'),
      ]);
      const record = intakeForDocument(snapshotId, intake.records);
      const ids = [
        ...new Set(
          [
            snapshotId,
            record?.snapshotId,
            record?.value.preparedSnapshotId,
          ].filter((id): id is string => Boolean(id)),
        ),
      ];
      // Filter at the repository before its limit; older selected documents remain readable.
      const selected = ids.length
        ? await client<AiTask[]>('tasks_list', {snapshotIds: ids})
        : [];
      if (request !== generation.current) return;
      const tasks = [
        ...new Map([...recent, ...selected].map((t) => [t.taskId, t])).values(),
      ];
      const signature = selected
        .flatMap((task) =>
          task.state.steps
            .filter((step) => step.complete)
            .map((step) =>
              [task.taskId, step.kind, step.targetId, step.relatedEntryId].join(
                ':',
              ),
            ),
        )
        .join('|');
      const previous = completed.current.get(snapshotId);
      completed.current.set(snapshotId, signature);
      setView({scope: snapshotId, tasks, records: intake.records});
      if (previous !== undefined && previous !== signature)
        onResultsChanged(snapshotId);
      setError(undefined);
    } catch (cause) {
      if (request === generation.current)
        setError({scope: snapshotId, text: aiError(cause)});
    }
  }, [client, snapshotId, onResultsChanged]);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    if (!active) return;
    const first = globalThis.setTimeout(() => {
      void load();
    }, 0);
    const interval = globalThis.setInterval(() => {
      if (document.visibilityState !== 'hidden') void load();
    }, 10000);
    return () => {
      invalidate();
      globalThis.clearTimeout(first);
      globalThis.clearInterval(interval);
    };
  }, [active, load, invalidate]);
  return {
    // The list spans every document; keep its last read while the selected detail reloads.
    listView: view,
    view: view?.scope === snapshotId ? view : undefined,
    error: error?.scope === snapshotId ? error.text : undefined,
    refresh: load,
  };
}
