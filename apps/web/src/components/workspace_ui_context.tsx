import {useCallback, useEffect, useState, useRef, type ReactNode} from 'react';
import type {M1cApiClient} from '../api/m1c_api_client.js';
import {
  DEFAULT_WORKSPACE_UI_PREFERENCES,
  type WorkspaceUiPreferences,
} from '../api/workspace_ui_preferences.js';

import {UiContext} from './use_workspace_ui.js';
export function WorkspaceUiProvider({
  api,
  children,
}: {
  readonly api: M1cApiClient;
  readonly children: ReactNode;
}) {
  const requests = useRef(0);
  const [preferences, setPreferences] = useState(
    DEFAULT_WORKSPACE_UI_PREFERENCES,
  );
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    const request = ++requests.current;
    void api
      .loadWorkspaceUiPreferences({signal: abort.signal})
      .then(({body}) => {
        if (
          !abort.signal.aborted &&
          request === requests.current &&
          body.status === 'ok'
        ) {
          setPreferences(body.preferences);
          setReady(true);
          setMessage('');
        }
      })
      .catch(() => {
        if (!abort.signal.aborted && request === requests.current)
          setMessage('页面设置暂时无法读取，正在使用默认布局。');
      });
    return () => {
      abort.abort();
    };
  }, [api, generation]);
  useEffect(() => {
    if (preferences.theme === 'system')
      delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = preferences.theme;
  }, [preferences.theme]);
  const save = useCallback(
    async (value: Readonly<WorkspaceUiPreferences>) => {
      const request = ++requests.current;
      try {
        const {body} = await api.saveWorkspaceUiPreferences(value);
        if (request !== requests.current) return false;
        if (body.status === 'conflict') {
          setMessage(
            '设置已在别处更新。请重新读取后再保存，当前草稿仍然保留。',
          );
          return false;
        }
        setPreferences(body.preferences);
        setReady(true);
        setMessage('页面设置已保存。');
        return true;
      } catch {
        if (request !== requests.current) return false;
        setMessage('未能确认设置保存结果。请重新读取确认，当前草稿仍然保留。');
        return false;
      }
    },
    [api],
  );
  return (
    <UiContext.Provider
      value={{
        preferences,
        ready,
        message,
        reload: () => {
          requests.current += 1;
          setReady(false);
          setGeneration((n) => n + 1);
        },
        save,
      }}
    >
      {children}
    </UiContext.Provider>
  );
}
