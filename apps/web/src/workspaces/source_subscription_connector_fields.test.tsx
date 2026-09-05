import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';

import {
  PluginSourceSubscriptionFields,
  SourceConnectorCapabilityList,
  WebSourceSubscriptionFields,
} from './source_subscription_connector_fields.js';

const COMMON = Object.freeze({
  subscriptionId: '11111111-1111-4111-8111-111111111111',
  label: 'Synthetic source',
  enabled: false,
  sourceAlias: 'synthetic',
  isPrivate: false,
  routeAfterImport: false,
  intervalMinutes: 60,
});

describe('source subscription connector fields', () => {
  it('explains the explicit same-origin Web request boundary', () => {
    const markup = renderToStaticMarkup(
      <WebSourceSubscriptionFields
        subscription={{
          ...COMMON,
          kind: 'web',
          pageUrl: 'https://example.invalid/articles',
          additionalPaths: ['/about'],
        }}
        onChange={vi.fn()}
      />,
    );
    expect(markup).toContain('主网页地址');
    expect(markup).toContain('其他同源页面');
    expect(markup).toContain('不会跟随重定向、发现链接、执行脚本');
    expect(markup).toContain('/about');
  });

  it('shows installed connector identity and external-reference-only configuration', () => {
    const connectors = [
      {
        connectorId: 'builtin.web.v1',
        displayName: '受限网页',
        origin: 'builtin' as const,
        configurationMode: 'internal' as const,
      },
      {
        connectorId: 'plugin.synthetic.v1',
        displayName: 'Synthetic plugin',
        origin: 'plugin' as const,
        configurationMode: 'external_reference' as const,
      },
    ];
    const capabilityMarkup = renderToStaticMarkup(
      <SourceConnectorCapabilityList connectors={connectors} />,
    );
    expect(capabilityMarkup).toContain('已安装插件 1 个');
    expect(capabilityMarkup).not.toContain('plugin.synthetic.v1');

    const fieldsMarkup = renderToStaticMarkup(
      <PluginSourceSubscriptionFields
        subscription={{
          ...COMMON,
          kind: 'plugin',
          connectorId: 'plugin.synthetic.v1',
          configurationRef: 'profile.default',
        }}
        connectors={connectors}
        onChange={vi.fn()}
      />,
    );
    expect(fieldsMarkup).toContain('选择插件');
    expect(fieldsMarkup).toContain('插件配置名称');
    expect(fieldsMarkup).toContain('profile.default');
    expect(fieldsMarkup).not.toContain('当前插件不可用');
  });

  it('keeps a portable missing-plugin configuration visibly unavailable', () => {
    const markup = renderToStaticMarkup(
      <PluginSourceSubscriptionFields
        subscription={{
          ...COMMON,
          kind: 'plugin',
          connectorId: 'plugin.missing.v1',
          configurationRef: 'profile.default',
        }}
        connectors={[]}
        onChange={vi.fn()}
      />,
    );
    expect(markup).toContain('已保存的插件（当前不可用）');
    expect(markup).toContain('当前插件不可用');
  });
});
