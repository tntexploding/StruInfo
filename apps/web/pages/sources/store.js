import {request, ingestion} from './api.js';
import {switchInput} from '../../shared/switch.js';
export const escape = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
export const kinds = {
  rss: 'RSS / Atom',
  git: 'Git 文件',
  web: '网页',
  json: 'JSON API',
  plugin: '连接插件',
};
const typeNames = {
  rss: 'rss_atom',
  git: 'github_markdown',
  web: 'web',
  json: 'json_api',
  plugin: 'plugin',
};
let sourceRevision,
  policy,
  raw = [];
export let loadError = '';
export const sources = [],
  states = {};
export const initial = (source) => ({
  name: source.name,
  description: '',
  accent: '#c4b08b',
  kind: source.kind,
  privacy: 'public',
  priority: 50,
  enabled: false,
  mode: 'interval',
  interval: 120,
  weekdays: [1, 2, 3, 4, 5],
  start: '09:00',
  end: '18:00',
  retries: 2,
  ai: false,
  split: '',
  tags: '',
  relations: '',
  rules: '',
  connection: {},
  saved: false,
});
const time = (n) =>
  `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const minutes = (value) =>
  value.split(':').reduce((h, m) => Number(h) * 60 + Number(m));
const cursor = (c, prefix) =>
  c[prefix + 'Param'] && c[prefix + 'Path']
    ? {queryParameter: c[prefix + 'Param'], responsePath: c[prefix + 'Path']}
    : undefined;
function readSource(s) {
  const kind = Object.keys(typeNames).find((k) => typeNames[k] === s.kind),
    r = s.receiving,
    schedule = r.schedule;
  const c = {
    url: s.feedUrl || s.repositoryUri || s.pageUrl || s.endpointUrl || '',
    ref: s.repositoryRef,
    path: s.repositoryPath,
    paths: s.additionalPaths?.join('\n'),
    component: s.connectorId,
    profile: s.configurationRef,
    records: s.recordsPath,
    id: s.externalIdPath,
    title: s.titlePath,
    body: s.bodyPath,
    canonical: s.canonicalUriPath,
    published: s.publishedAtPath,
    version: s.versionPath,
    pageParam: s.pageCursor?.queryParameter,
    pagePath: s.pageCursor?.responsePath,
    sinceParam: s.incrementalCursor?.queryParameter,
    sincePath: s.incrementalCursor?.responsePath,
    auth: s.authentication?.kind === 'bearer_env' ? 'bearer' : 'none',
    credential: s.authentication?.variable,
  };
  return {
    ...initial({name: s.label, kind}),
    description: s.description || '',
    accent: s.processingProfile?.accent || '#c4b08b',
    privacy: s.isPrivate ? 'private' : 'public',
    priority: r.preference,
    enabled: s.enabled,
    mode: schedule.mode === 'manual' ? 'interval' : schedule.mode,
    interval: s.intervalMinutes,
    weekdays: schedule.weekdays || [1, 2, 3, 4, 5],
    start: time(schedule.startMinute ?? 540),
    end: time(schedule.endMinute ?? 1080),
    retries: r.retryLimit,
    ai: policy.settings.subscriptionIds.includes(s.subscriptionId),
    split: s.processingProfile?.split || '',
    tags: s.processingProfile?.tags || '',
    relations: s.processingProfile?.relations || '',
    connection: c,
    saved: true,
  };
}
export async function load() {
  const [result, status, intake] = await Promise.all([
    request('source-subscriptions'),
    ingestion('ingestion_status'),
    ingestion('intake_status'),
  ]);
  sourceRevision = result.revision;
  raw = result.subscriptions;
  policy = status.policy;
  sources.splice(
    0,
    sources.length,
    ...raw.map((s) => ({
      id: s.subscriptionId,
      name: s.label,
      initial: s.label.slice(0, 2),
      kind: Object.keys(typeNames).find((k) => typeNames[k] === s.kind),
      connector: s.kind,
      count: intake.records.filter(
        (r) =>
          r.value.receipt === 'pending' &&
          r.value.captureOrigin?.subscriptionId === s.subscriptionId,
      ).length,
      enabled: s.enabled,
    })),
  );
  for (const s of raw) states[s.subscriptionId] = readSource(s);
}
function writeSource(s, id) {
  const old = raw.find((s) => s.subscriptionId === id),
    c = s.connection;
  const receiving = {
    schedule:
      s.mode === 'window'
        ? {
            mode: 'window',
            timeZone: old?.receiving.schedule.timeZone || 'Asia/Shanghai',
            weekdays: s.weekdays,
            startMinute: minutes(s.start),
            endMinute: minutes(s.end),
          }
        : {mode: s.mode},
    history: old?.receiving.history || 'discover',
    urgency: old?.receiving.urgency || 'normal',
    preference: s.priority,
    retryLimit: s.retries,
  };
  const profile = [s.split, s.rules].filter(Boolean).join('\n\n');
  const base = {
    subscriptionId: id,
    label: s.name.trim(),
    description: s.description,
    enabled: s.enabled,
    sourceAlias: old?.sourceAlias || s.name.trim(),
    isPrivate: s.privacy === 'private',
    intervalMinutes: s.interval,
    receiving,
    processingProfile: {
      split: profile,
      tags: s.tags,
      relations: s.relations,
      accent: s.accent,
    },
    kind: typeNames[s.kind],
  };
  if (s.kind === 'rss')
    return {...base, feedUrl: c.url, itemLimit: old?.itemLimit || 20};
  if (s.kind === 'git')
    return {
      ...base,
      repositoryUri: c.url,
      repositoryRef: c.ref || 'main',
      repositoryPath: c.path,
      profile: old?.profile || 'commonmark-v1',
    };
  if (s.kind === 'web')
    return {
      ...base,
      pageUrl: c.url,
      additionalPaths: (c.paths || '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    };
  if (s.kind === 'plugin')
    return {...base, connectorId: c.component, configurationRef: c.profile};
  return {
    ...base,
    endpointUrl: c.url,
    recordsPath: c.records,
    externalIdPath: c.id,
    titlePath: c.title,
    bodyPath: c.body,
    canonicalUriPath: c.canonical || undefined,
    publishedAtPath: c.published || undefined,
    versionPath: c.version || undefined,
    recordLimit: old?.recordLimit || 20,
    pageCursor: cursor(c, 'page'),
    incrementalCursor: cursor(c, 'since'),
    authentication:
      c.auth === 'bearer'
        ? {kind: 'bearer_env', variable: c.credential}
        : {kind: 'none'},
  };
}
export async function persist(id) {
  const s = states[id],
    isNew = id === 'new' && !s.persistedId,
    actual = s.persistedId || (isNew ? crypto.randomUUID() : id);
  if (s.kind !== 'plugin' && !s.connection.url?.trim())
    throw new Error('先填写接收地址');
  const writes = raw.map((r) => {
    if (r.subscriptionId === actual) return writeSource(s, r.subscriptionId);
    const config = {...r};
    for (const key of [
      'receivingStatus',
      'routeAfterImport',
      'cursor',
      'lastAttemptAt',
      'lastSuccessAt',
      'lastRunId',
      'checkState',
      'qualityReview',
    ])
      delete config[key];
    return config;
  });
  if (isNew) writes.push(writeSource(s, actual));
  const saved = await request(
    'source-subscriptions',
    {expectedRevision: sourceRevision, subscriptions: writes},
    'PUT',
  );
  raw = saved.subscriptions;
  sourceRevision = saved.revision;
  s.persistedId = actual;
  states[actual] = {
    ...s,
    saved: true,
    rules: '',
    split: writeSource(s, actual).processingProfile.split,
  };
  const ids = new Set(policy.settings.subscriptionIds);
  s.ai ? ids.add(actual) : ids.delete(actual);
  if (
    JSON.stringify([...ids]) !== JSON.stringify(policy.settings.subscriptionIds)
  ) {
    try {
      policy = await ingestion('ingestion_policy_save', {
        expectedRevision: policy.revision,
        settings: {...policy.settings, subscriptionIds: [...ids]},
      });
    } catch (error) {
      throw new Error('来源已保存，自动处理范围未保存。请重新加载后检查。', {
        cause: error,
      });
    }
  }
  if (id === 'new') delete states.new;
  return actual;
}
export const sourceRecord = (id) => raw.find((s) => s.subscriptionId === id);
export const field = (label, name, value = '', attrs = '', cls = '') =>
  `<label class="setting-field ${cls}"><span>${label}</span><input data-field="${name}" value="${escape(value)}" ${attrs}></label>`;
export const options = (items, value) =>
  Object.entries(items)
    .map(
      ([key, label]) =>
        `<option value="${key}" ${key === value ? 'selected' : ''}>${label}</option>`,
    )
    .join('');
export const select = (label, name, items, value, cls = '') =>
  `<label class="setting-field ${cls}"><span>${label}</span><select data-field="${name}">${options(items, value)}</select></label>`;
export const toggle = (label, name, checked) =>
  `<label class="switch-label"><span>${label}</span>${switchInput({checked, data: {field: name}})}</label>`;

export function resetSource(id) {
  states[id] =
    id === 'new'
      ? initial({name: '', kind: 'rss'})
      : readSource(sourceRecord(id));
}
