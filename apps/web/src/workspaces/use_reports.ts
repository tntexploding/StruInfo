import {printReport} from './report_print.js';
import {useCallback, useEffect, useRef, useState} from 'react';
import {
  reportCommand,
  reportError,
  type ReportEdit,
  type ReportList,
  type ReportRecord,
  type ReportRequest,
  type ReportView,
} from '../api/report_client.js';

export function useReports(active: boolean) {
  const [list, setList] = useState<ReportList>();
  const [value, setValue] = useState<ReportView>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selection = useRef<string | undefined>(undefined);
  const locked = useRef(false);
  const generation = useRef(0);
  const refreshList = useCallback(async () => {
    const result = await reportCommand<ReportList>('reports_list');
    setList(result);
  }, []);
  useEffect(() => {
    if (!active) return;
    let live = true;
    const selected = selection.current,
      currentGeneration = generation.current;
    if (selected)
      void reportCommand<ReportView>('report_read', {reportId: selected})
        .then((result) => {
          if (
            live &&
            selection.current === selected &&
            generation.current === currentGeneration
          )
            setValue(result);
        })
        .catch((e: unknown) => {
          if (live && generation.current === currentGeneration) {
            setError(reportError(e));
            setValue(undefined);
          }
        });
    void reportCommand<ReportList>('reports_list')
      .then((result) => {
        if (live) setList(result);
      })
      .catch((e: unknown) => {
        if (live) setError(reportError(e));
      });
    return () => {
      live = false;
    };
  }, [active]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible')
        void refreshList().catch((e: unknown) => {
          setError(reportError(e));
        });
    }, 5000);
    return () => {
      clearInterval(timer);
    };
  }, [active, refreshList]);
  const run = useCallback(async (action: () => Promise<void>) => {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
      return true;
    } catch (e) {
      setError(reportError(e));
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }, []);
  const open = useCallback(
    async (id: string) =>
      run(async () => {
        generation.current++;
        selection.current = id;
        setValue(undefined);
        const result = await reportCommand<ReportView>('report_read', {
          reportId: id,
        });
        if (selection.current === id) setValue(result);
      }),
    [run],
  );
  const clear = () => {
    generation.current++;
    selection.current = undefined;
    setValue(undefined);
    setError('');
  };
  const refresh = async () =>
    run(async () => {
      generation.current++;
      if (selection.current) {
        try {
          const result = await reportCommand<ReportView>('report_read', {
            reportId: selection.current,
          });
          setValue(result);
        } catch (e) {
          setValue(undefined);
          throw e;
        }
      }
      await refreshList();
    });
  const create = async (request: ReportRequest, requestKey: string) =>
    run(async () => {
      const result = await reportCommand<ReportView>('report_create', {
        request,
        requestKey,
      });
      generation.current++;
      selection.current = result.report.reportId;
      setValue(result);
      if (
        request.composition !== 'collection' &&
        result.model &&
        result.report.state.status === 'draft'
      ) {
        try {
          const started = await reportCommand<ReportView>('report_generate', {
            reportId: result.report.reportId,
            expectedVersion: result.report.version,
          });
          setValue(started);
        } catch (e) {
          setError(reportError(e));
        }
      }
      // The durable creation succeeds even when the secondary history refresh fails.
      await refreshList().catch(() => undefined);
    });
  const change = async (
    operation: string,
    extra: Record<string, unknown> = {},
    expectedReport?: Pick<ReportRecord, 'reportId' | 'version'>,
  ) =>
    run(async () => {
      const target = expectedReport ?? value?.report;
      if (!target) return;
      generation.current++;
      const result = await reportCommand<ReportView>(operation, {
        reportId: target.reportId,
        expectedVersion: target.version,
        ...extra,
      });
      setValue(result);
      await refreshList().catch(() => undefined);
    });
  useEffect(() => {
    if (!active || !value || busy) return;
    const waitingForPrice =
      value.report.state.status === 'queued' &&
      ['ai_price_window_closed', 'ai_operations_paused'].includes(
        value.report.state.errorCode ?? '',
      );
    if (!value.active && !waitingForPrice) return;
    let live = true;
    const id = value.report.reportId,
      version = generation.current;
    const timer = setTimeout(() => {
      void reportCommand<ReportView>('report_read', {reportId: id})
        .then((result) => {
          if (
            !live ||
            version !== generation.current ||
            selection.current !== id
          )
            return;
          setValue(result);
          if (!result.active) void refreshList().catch(() => undefined);
        })
        .catch((e: unknown) => {
          if (live && version === generation.current) {
            setError(reportError(e));
            setValue(undefined);
          }
        });
    }, 1500);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [active, value, busy, refreshList]);
  const exportReport = async () =>
    run(async () => {
      if (!value) return;
      const result = await reportCommand<{fileName: string; markdown: string}>(
        'report_export',
        {reportId: value.report.reportId},
      );
      const url = URL.createObjectURL(
        new Blob([result.markdown], {type: 'text/markdown;charset=utf-8'}),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = result.fileName;
      link.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
    });
  return {
    list,
    value,
    busy,
    error,
    clearError: () => {
      setError('');
    },
    open,
    clear,
    refresh,
    create,
    exportReport,
    exportPdf: () =>
      run(async () => {
        if (value) await printReport(value.report.reportId);
      }),
    generate: () => change('report_generate'),
    cancel: () => change('report_cancel'),
    save: (
      edit: ReportEdit,
      report: Pick<ReportRecord, 'reportId' | 'version'>,
    ) => change('report_edit', {edit}, report),
  };
}
