import type {
  PluginSourceSubscriptionWrite,
  SourceConnectorCapabilityView,
  SourceSubscriptionWrite,
  WebSourceSubscriptionWrite,
} from '../api/m1c_api_contract.js';

interface ConnectorFieldsChangeProps {
  readonly onChange: (change: Partial<SourceSubscriptionWrite>) => void;
}

export function SourceConnectorCapabilityList({
  connectors,
}: Readonly<{
  connectors: readonly Readonly<SourceConnectorCapabilityView>[];
}>) {
  const pluginCount = connectors.filter(
    (connector) => connector.origin === 'plugin',
  ).length;
  return (
    <aside
      className="source-connector-capabilities"
      aria-label="可用信源连接器"
    >
      <div>
        <strong>可用连接器</strong>
        <span>
          {connectors.length} 个 · 已安装插件 {pluginCount} 个
        </span>
      </div>
      {connectors.length === 0 ? (
        <p>当前运行环境没有公开任何连接器能力。</p>
      ) : (
        <ul>
          {connectors.map((connector) => (
            <li key={connector.connectorId}>
              <span>{connector.displayName}</span>
              <code>{connector.connectorId}</code>
              <small>
                {connector.origin === 'plugin' ? '已安装插件' : '内置'}
              </small>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

export function WebSourceSubscriptionFields({
  subscription,
  onChange,
}: Readonly<
  ConnectorFieldsChangeProps & {
    subscription: Readonly<WebSourceSubscriptionWrite>;
  }
>) {
  return (
    <>
      <label className="field field--wide">
        <span>主网页地址</span>
        <input
          type="url"
          value={subscription.pageUrl}
          placeholder="https://example.invalid/articles"
          onChange={(event) => {
            onChange({pageUrl: event.currentTarget.value});
          }}
        />
        <small>
          仅公开 HTTPS；不会跟随重定向、发现链接、执行脚本或绕过登录。
        </small>
      </label>
      <label className="field field--wide">
        <span>其他同源页面（可选，每行一个）</span>
        <textarea
          rows={4}
          value={subscription.additionalPaths.join('\n')}
          placeholder={'/news\n/about?lang=zh'}
          onChange={(event) => {
            onChange({
              additionalPaths: Object.freeze(
                event.currentTarget.value
                  .split(/\r?\n/u)
                  .map((value) => value.trim())
                  .filter((value) => value !== ''),
              ),
            });
          }}
        />
        <small>
          最多 7 条根相对路径；与主网页合计最多请求 8 页。正文按
          article/main/body 顺序提取。
        </small>
      </label>
    </>
  );
}

export function PluginSourceSubscriptionFields({
  subscription,
  connectors,
  onChange,
}: Readonly<
  ConnectorFieldsChangeProps & {
    subscription: Readonly<PluginSourceSubscriptionWrite>;
    connectors: readonly Readonly<SourceConnectorCapabilityView>[];
  }
>) {
  const plugins = connectors.filter(
    (connector) => connector.origin === 'plugin',
  );
  const selectedAvailable = plugins.some(
    (connector) => connector.connectorId === subscription.connectorId,
  );
  return (
    <>
      <label className="field field--wide">
        <span>已安装连接器</span>
        <select
          value={subscription.connectorId}
          disabled={plugins.length === 0}
          onChange={(event) => {
            onChange({connectorId: event.currentTarget.value});
          }}
        >
          {!selectedAvailable && subscription.connectorId !== '' ? (
            <option value={subscription.connectorId}>
              {subscription.connectorId}（当前不可用）
            </option>
          ) : null}
          {plugins.length === 0 ? (
            <option value="">没有已安装插件连接器</option>
          ) : null}
          {plugins.map((connector) => (
            <option key={connector.connectorId} value={connector.connectorId}>
              {connector.displayName}
            </option>
          ))}
        </select>
        <small>
          插件由运行环境安装；个人配置只保存连接器 ID，不保存或加载代码。
        </small>
      </label>
      <label className="field field--wide">
        <span>外部配置引用</span>
        <input
          value={subscription.configurationRef}
          maxLength={200}
          placeholder="profile.default"
          onChange={(event) => {
            onChange({configurationRef: event.currentTarget.value});
          }}
        />
        <small>
          这是由已安装连接器解析的外部引用；不要填写密码、正文或文件内容。
        </small>
      </label>
      {!selectedAvailable ? (
        <p className="source-connector-warning" role="status">
          当前连接器未安装。配置可保留和迁移，但“立即检查”会稳定失败。
        </p>
      ) : null}
    </>
  );
}
