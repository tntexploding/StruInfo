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
    <aside className="source-connector-capabilities" aria-label="可用订阅方式">
      <div>
        <strong>可用订阅方式</strong>
        <span>
          {connectors.length} 个 · 已安装插件 {pluginCount} 个
        </span>
      </div>
      {connectors.length === 0 ? (
        <p>当前没有可用的订阅方式。</p>
      ) : (
        <ul>
          {connectors.map((connector) => (
            <li key={connector.connectorId}>
              <span>{connector.displayName}</span>
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
          最多添加 7 个同站页面，连同主网页最多读取 8
          页。系统会优先提取网页正文。
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
        <span>选择插件</span>
        <select
          value={subscription.connectorId}
          disabled={plugins.length === 0}
          onChange={(event) => {
            onChange({connectorId: event.currentTarget.value});
          }}
        >
          {!selectedAvailable && subscription.connectorId !== '' ? (
            <option value={subscription.connectorId}>
              已保存的插件（当前不可用）
            </option>
          ) : null}
          {plugins.length === 0 ? <option value="">没有可用插件</option> : null}
          {plugins.map((connector) => (
            <option key={connector.connectorId} value={connector.connectorId}>
              {connector.displayName}
            </option>
          ))}
        </select>
        <small>
          插件由服务端安装；个人设置只记录所选插件，不保存或加载插件代码。
        </small>
      </label>
      <label className="field field--wide">
        <span>插件配置名称</span>
        <input
          value={subscription.configurationRef}
          maxLength={200}
          placeholder="profile.default"
          onChange={(event) => {
            onChange({configurationRef: event.currentTarget.value});
          }}
        />
        <small>
          填写插件预先约定的配置名称；不要在这里填写密码或文档内容。
        </small>
      </label>
      {!selectedAvailable ? (
        <p className="source-connector-warning" role="status">
          当前插件不可用。设置会保留，但暂时无法检查更新。
        </p>
      ) : null}
    </>
  );
}
