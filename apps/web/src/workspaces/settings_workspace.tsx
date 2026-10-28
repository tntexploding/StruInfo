import {useState, type ReactNode} from 'react';
import {ContentDialog} from '../components/content_dialog.js';
import {SettingCard, SettingRow} from '../components/setting_controls.js';
import {useWorkspaceUi} from '../components/use_workspace_ui.js';
import type {WorkspaceUiPreferences} from '../api/workspace_ui_preferences.js';
import type {ProductSection} from '../components/product_types.js';
import {VisualSettings} from './visual_settings.js';
import {AnnotationSettings} from './annotation_settings.js';
import {ResearchPanel} from './research_panel.js';
import {ReportPipelinePanel} from './report_pipeline_panel.js';
import '../theme/prototypes/settings.css';

const SECTIONS = [
  ['appearance', '外观与阅读', '主题、正文和动画。'],
  ['ai', 'AI 执行', '模型状态、并发和价格时段。'],
  ['automation', '自动处理', '新增资料的处理范围和限额。'],
  ['vocabulary', '标签与词表', '标注维度、词条和确认过的别名。'],
  ['network', '联网与通知', '联网检索、定时报告和站内通知。'],
  ['data', '数据与维护', '导入、导出、备份和恢复。'],
] as const;
type Section = (typeof SECTIONS)[number][0];

export function SettingsWorkspace({
  workflow,
  ai,
  automation,
  maintenance,
}: {
  readonly workflow: ReactNode;
  readonly ai: ReactNode;
  readonly automation: ReactNode;
  readonly maintenance: ReactNode;
  readonly onNavigate: (section: ProductSection) => void;
}) {
  const [section, setSection] = useState<Section>('appearance');
  const [visited, setVisited] = useState<ReadonlySet<string>>(
    new Set(['appearance']),
  );
  const [dialog, setDialog] = useState<
    'rules' | 'vocabulary' | 'schedule' | 'data'
  >();
  const current = SECTIONS.find(([id]) => id === section) ?? SECTIONS[0];
  return (
    <div className="workspace-view reading-sample settings-sample settings-main">
      <header className="settings-heading">
        <div>
          <h1>设置</h1>
          <p>外观、AI 和数据管理。</p>
        </div>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置分类">
          {SECTIONS.map(([id, label]) => (
            <a
              key={id}
              href={`#settings-${id}`}
              aria-current={section === id ? 'page' : undefined}
              onClick={(event) => {
                event.preventDefault();
                setSection(id);
                setVisited((items) => new Set([...items, id]));
              }}
            >
              {label}
            </a>
          ))}
        </nav>
        <section className="settings-editor" aria-labelledby="settings-title">
          <header className="settings-editor-head">
            <div>
              <h2 id="settings-title">{current[1]}</h2>
              <p>{current[2]}</p>
            </div>
          </header>
          <div className="settings-panels">
            <div className="settings-content" hidden={section !== 'appearance'}>
              <InterfaceSettings />
              <VisualSettings />
            </div>
            <div className="settings-content" hidden={section !== 'ai'}>
              {visited.has('ai') ? ai : null}
            </div>
            <div className="settings-content" hidden={section !== 'automation'}>
              {visited.has('automation') ? (
                <>
                  {automation}
                  <SettingCard title="手动处理">
                    <SettingRow
                      title="拆分与本地推荐"
                      hint="手动拆分规则、快捷标签与本地联系推荐。"
                    >
                      {(id) => (
                        <button
                          id={id}
                          className="secondary-action"
                          onClick={() => {
                            setDialog('rules');
                          }}
                        >
                          编辑规则
                        </button>
                      )}
                    </SettingRow>
                  </SettingCard>
                </>
              ) : null}
            </div>
            <div className="settings-content" hidden={section !== 'vocabulary'}>
              <SettingCard title="结构化标注" className="full-width">
                <SettingRow
                  title="维度、词条与别名"
                  hint="词条含义、同义表达和关联词在这里维护。"
                >
                  {(id) => (
                    <button
                      id={id}
                      className="secondary-action"
                      onClick={() => {
                        setDialog('vocabulary');
                      }}
                    >
                      编辑词表
                    </button>
                  )}
                </SettingRow>
              </SettingCard>
            </div>
            <div className="settings-content" hidden={section !== 'network'}>
              {visited.has('network') ? (
                <>
                  <SettingCard title="联网搜索">
                    <ResearchPanel
                      active={section === 'network'}
                      query={{}}
                      settingsOnly
                    />
                  </SettingCard>
                  <SettingCard title="定时报告与通知">
                    <SettingRow
                      title="计划与站内通知"
                      hint="按时生成报告。外部推送尚未配置。"
                    >
                      {(id) => (
                        <button
                          id={id}
                          className="secondary-action"
                          onClick={() => {
                            setDialog('schedule');
                          }}
                        >
                          管理计划
                        </button>
                      )}
                    </SettingRow>
                  </SettingCard>
                </>
              ) : null}
            </div>
            <div className="settings-content" hidden={section !== 'data'}>
              <SettingCard title="个人数据" className="full-width">
                <SettingRow
                  title="导入、导出与恢复"
                  hint="个人配置与内容保存在当前工作区。"
                >
                  {(id) => (
                    <button
                      id={id}
                      className="secondary-action"
                      onClick={() => {
                        setDialog('data');
                      }}
                    >
                      打开数据工具
                    </button>
                  )}
                </SettingRow>
              </SettingCard>
            </div>
          </div>
        </section>
      </div>
      <ContentDialog
        open={dialog !== undefined}
        title={
          dialog === 'rules'
            ? '手动处理规则'
            : dialog === 'vocabulary'
              ? '标签与词表'
              : dialog === 'schedule'
                ? '定时报告与通知'
                : '数据与维护'
        }
        className="settings-dialog"
        onClose={() => {
          setDialog(undefined);
        }}
      >
        {dialog === 'rules' ? (
          workflow
        ) : dialog === 'vocabulary' ? (
          <AnnotationSettings />
        ) : dialog === 'schedule' ? (
          <ReportPipelinePanel active />
        ) : dialog === 'data' ? (
          maintenance
        ) : null}
      </ContentDialog>
    </div>
  );
}

function InterfaceSettings() {
  const ui = useWorkspaceUi();
  const [draft, setDraft] = useState<
    WorkspaceUiPreferences['theme'] | undefined
  >();
  const [busy, setBusy] = useState(false);
  return (
    <SettingCard title="外观" className="appearance-card">
      <SettingRow title="主题">
        {(id) => (
          <select
            id={id}
            value={draft ?? ui.preferences.theme}
            disabled={!ui.ready || busy}
            onChange={(event) => {
              setDraft(
                event.currentTarget.value as WorkspaceUiPreferences['theme'],
              );
            }}
          >
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        )}
      </SettingRow>
      <div className="settings-card-actions">
        <button
          className="primary-action"
          disabled={
            !ui.ready ||
            busy ||
            draft === undefined ||
            draft === ui.preferences.theme
          }
          onClick={() => {
            if (!draft || busy) return;
            setBusy(true);
            void ui.save({...ui.preferences, theme: draft}).finally(() => {
              setBusy(false);
            });
          }}
        >
          保存主题
        </button>
        <button
          className="text-action"
          disabled={busy}
          onClick={() => {
            setDraft(undefined);
            ui.reload();
          }}
        >
          重新读取
        </button>
      </div>
      <p role="status">{ui.message}</p>
    </SettingCard>
  );
}
