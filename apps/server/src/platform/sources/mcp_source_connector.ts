import {createHash} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {z} from 'zod';
import {
  SourceConnectorError,
  type SourceConnectorPort,
  type SourceConnectorReadRequest,
  type SourceConnectorReadResult,
  type SourceConnectorDocument,
} from '../../modules/subscriptions/source_connector.js';
import {plainHtml} from './history_markup.js';
import {
  decodePublicJsonApiUrl,
  isBlockedJsonApiAddress,
  readPath,
} from './json_api_source_connector.js';

// SDK 1.32's HTTP declaration conflicts with its own Transport under
// exactOptionalPropertyTypes. Keep that mismatch at this runtime boundary.
const {StreamableHTTPClientTransport} = createRequire(import.meta.url)(
  '@modelcontextprotocol/sdk/client/streamableHttp.js',
) as {
  StreamableHTTPClientTransport: new (
    url: URL,
    options: {
      requestInit: RequestInit;
      reconnectionOptions: {
        maxRetries: number;
        initialReconnectionDelay: number;
        maxReconnectionDelay: number;
        reconnectionDelayGrowFactor: number;
      };
      fetch: typeof fetch;
    },
  ) => Transport;
};

export const MCP_SOURCE_CONNECTOR_ID = 'plugin.mcp-receiver.v1';
const ENV_KEY = /^[A-Z_][A-Z0-9_]{0,99}$/u;
const path = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*){0,7}$/u)
  .max(500);
const configurationSchema = z
  .object({
    serverUrl: z.string().max(2000),
    headers: z.record(z.string().max(100), z.string().max(8192)).default({}),
    tool: z.string().min(1).max(128),
    arguments: z.record(z.string(), z.unknown()).default({}),
    recordsPath: z.union([path, z.literal('')]),
    externalIdPath: path,
    bodyPath: path,
    titlePath: path.optional(),
    canonicalUriPath: path.optional(),
    canonicalUriTemplate: z.string().max(2000).optional(),
    publishedAtPath: path.optional(),
    timeZoneOffset: z
      .string()
      .regex(/^(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/u)
      .default('Z'),
    bodyFormat: z.enum(['text', 'html', 'markdown']).default('text'),
    success: z
      .object({path, value: z.union([z.string(), z.number(), z.boolean()])})
      .strict()
      .optional(),
    recordLimit: z.number().int().min(1).max(32).default(20),
    pagination: z
      .object({
        cursorArgument: z
          .string()
          .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u)
          .max(100),
        nextCursorPath: path,
        hasMorePath: path.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((v) => Boolean(v.canonicalUriPath ?? v.canonicalUriTemplate));
const cursorSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    tokens: z.array(z.string().regex(/^[A-Za-z0-9_-]{16}$/u)).max(64),
    pending: z
      .object({
        page: z.union([z.string().max(128), z.number()]).optional(),
        skip: z.number().int().min(0).max(1000),
        stop: z.array(z.string().regex(/^[A-Za-z0-9_-]{16}$/u)).max(24),
        initial: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** The owner chooses a receiving tool and field mapping. No model chooses tools. */
export class McpSourceConnector implements SourceConnectorPort {
  public readonly connectorId = MCP_SOURCE_CONNECTOR_ID;
  public readonly descriptor = Object.freeze({
    displayName: 'MCP 接收器',
    origin: 'plugin' as const,
    configurationMode: 'external_reference' as const,
  });
  public constructor(
    private readonly deps: {
      fetch?: typeof fetch;
      readEnvironment?: (name: string) => string | undefined;
      resolveAddresses?: (host: string) => Promise<readonly string[]>;
    } = {},
  ) {}

  public async read(
    request: Readonly<SourceConnectorReadRequest>,
  ): Promise<Readonly<SourceConnectorReadResult>> {
    const env =
      this.deps.readEnvironment ?? ((name: string) => process.env[name]);
    let config: z.infer<typeof configurationSchema>;
    let previous: z.infer<typeof cursorSchema>;
    try {
      const reference = z
        .object({configurationRef: z.string().regex(ENV_KEY)})
        .strict()
        .parse(request.configuration);
      const file = env(reference.configurationRef + '_FILE');
      const source =
        env(reference.configurationRef) ??
        (file ? await readFile(file, 'utf8') : 'null');
      if (source.length > 64 * 1024) throw new Error('configuration_size');
      config = configurationSchema.parse(JSON.parse(source) as unknown);
      previous = request.previousCursor
        ? cursorSchema.parse(
            JSON.parse(
              Buffer.from(request.previousCursor, 'base64url').toString('utf8'),
            ) as unknown,
          )
        : {version: 1, tokens: []};
    } catch {
      throw new SourceConnectorError('connector_result_invalid');
    }
    const endpoint = decodePublicJsonApiUrl(config.serverUrl);
    if (!endpoint) throw new SourceConnectorError('connector_result_invalid');
    let addresses: readonly string[];
    try {
      addresses = this.deps.resolveAddresses
        ? await this.deps.resolveAddresses(endpoint.hostname)
        : (await lookup(endpoint.hostname, {all: true})).map((a) => a.address);
    } catch {
      throw new SourceConnectorError('connector_unavailable');
    }
    if (!addresses.length || addresses.some(isBlockedJsonApiAddress))
      throw new SourceConnectorError('connector_result_invalid');
    let headers: Headers;
    try {
      headers = new Headers(config.headers);
    } catch {
      throw new SourceConnectorError('connector_result_invalid');
    }
    const signal = AbortSignal.timeout(20_000);
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: {headers, redirect: 'error'},
      reconnectionOptions: {
        maxRetries: 0,
        initialReconnectionDelay: 1000,
        maxReconnectionDelay: 1000,
        reconnectionDelayGrowFactor: 1,
      },
      fetch: async (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url !== endpoint.href)
          throw new SourceConnectorError('connector_result_invalid');
        const response = await (this.deps.fetch ?? fetch)(input, {
          ...init,
          redirect: 'error',
          signal: init?.signal
            ? AbortSignal.any([signal, init.signal])
            : signal,
        });
        if (!response.body) return response;
        let size = 0;
        return new Response(
          response.body.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, controller) {
                size += chunk.byteLength;
                if (size > 1024 * 1024)
                  throw new SourceConnectorError('connector_too_large');
                controller.enqueue(chunk);
              },
            }),
          ),
          {status: response.status, headers: response.headers},
        );
      },
    });
    const client = new Client(
      {name: 'struinfo-mcp-receiver', version: '1.0.0'},
      {capabilities: {}},
    );
    try {
      await client.connect(transport, {signal, timeout: 20_000});
      const listed = await client.listTools({}, {signal, timeout: 20_000});
      const tool = listed.tools.find((t) => t.name === config.tool);
      if (
        !tool ||
        tool.inputSchema.required?.some(
          (key) => !Object.hasOwn(config.arguments, key),
        )
      )
        throw new SourceConnectorError('connector_result_invalid');
      const pagination = config.pagination;
      const initial = previous.pending?.initial ?? previous.tokens.length === 0;
      const stop = previous.pending?.stop ?? previous.tokens.slice(-24);
      const tokens = pagination
        ? previous.pending
          ? [...previous.tokens]
          : []
        : [...previous.tokens];
      let page = previous.pending?.page;
      let skip = previous.pending?.skip ?? 0;
      let pending: z.infer<typeof cursorSchema>['pending'];
      const documents: SourceConnectorDocument[] = [];
      const seenIds = new Set<string>();
      // One bounded batch; unfinished pages resume after this batch is saved.
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = CallToolResultSchema.parse(
          await client.callTool(
            {
              name: config.tool,
              arguments: {
                ...config.arguments,
                ...(pagination && page !== undefined
                  ? {[pagination.cursorArgument]: page}
                  : {}),
              },
            },
            undefined,
            {signal, timeout: 20_000},
          ),
        );
        if (result.isError)
          throw new SourceConnectorError('connector_unavailable');
        let value: unknown = result.structuredContent;
        if (!value) {
          const block = result.content.find((b) => b.type === 'text');
          if (block?.type !== 'text')
            throw new SourceConnectorError('connector_result_invalid');
          value = JSON.parse(block.text) as unknown;
        }
        if (
          config.success &&
          readPath(value, config.success.path) !== config.success.value
        )
          throw new SourceConnectorError('connector_unavailable');
        const rows = readPath(value, config.recordsPath);
        if (!Array.isArray(rows) || rows.length > 1000)
          throw new SourceConnectorError('connector_result_invalid');
        let reached = false;
        for (let index = skip; index < rows.length; index++) {
          if (documents.length >= config.recordLimit) {
            if (pagination)
              pending = {
                ...(page === undefined ? {} : {page}),
                skip: index,
                stop,
                initial,
              };
            break;
          }
          const row: unknown = rows[index];
          const rawId = readPath(row, config.externalIdPath);
          const id =
            typeof rawId === 'number' && Number.isSafeInteger(rawId)
              ? String(rawId)
              : rawId;
          const content = readPath(row, config.bodyPath);
          if (
            typeof id !== 'string' ||
            !id ||
            id.length > 500 ||
            typeof content !== 'string' ||
            !content.trim() ||
            content.length > 100_000
          )
            throw new SourceConnectorError('connector_result_invalid');
          if (seenIds.has(id)) continue;
          seenIds.add(id);
          const body =
            config.bodyFormat === 'html' ? plainHtml(content) : content.trim();
          if (!body) throw new SourceConnectorError('connector_result_invalid');
          const rawTitle = config.titlePath
            ? readPath(row, config.titlePath)
            : undefined;
          const title = (
            typeof rawTitle === 'string' && rawTitle.trim()
              ? plainHtml(rawTitle)
              : Array.from(plainHtml(body)).slice(0, 80).join('')
          )
            .replace(/[\r\n]/gu, ' ')
            .slice(0, 1000);
          const rawUri = config.canonicalUriPath
            ? readPath(row, config.canonicalUriPath)
            : undefined;
          const canonical = decodePublicJsonApiUrl(
            typeof rawUri === 'string' && rawUri
              ? rawUri
              : config.canonicalUriTemplate?.replaceAll(
                  '{id}',
                  encodeURIComponent(id),
                ),
          );
          if (!canonical)
            throw new SourceConnectorError('connector_result_invalid');
          const rawTime = config.publishedAtPath
            ? readPath(row, config.publishedAtPath)
            : undefined;
          const date =
            typeof rawTime === 'string' && rawTime
              ? new Date(
                  /(?:Z|[+-]\d\d:\d\d)$/u.test(rawTime)
                    ? rawTime
                    : rawTime.replace(' ', 'T') + config.timeZoneOffset,
                )
              : undefined;
          const instant =
            date && Number.isFinite(date.getTime())
              ? date.toISOString()
              : undefined;
          const version = createHash('sha256')
            .update(JSON.stringify([body, title, instant, canonical.href]))
            .digest('hex');
          const token = createHash('sha256')
            .update(id + ':' + version)
            .digest('base64url')
            .slice(0, 16);
          if (pagination && !initial && stop.includes(token)) {
            reached = true;
            break;
          }
          if (pagination) {
            if (
              page === undefined &&
              tokens.length < 24 &&
              !tokens.includes(token)
            )
              tokens.push(token);
            if (previous.tokens.includes(token)) continue;
          } else {
            if (tokens.includes(token)) continue;
            tokens.push(token);
          }
          documents.push({
            externalId: id,
            version,
            canonicalUri: canonical.href,
            sourceUtf8: new TextEncoder().encode(
              `# ${title.replace(/[\\`*_[\]<>#]/gu, '\\$&')}\n\n${body}\n`,
            ),
            rawSourceBytes: new TextEncoder().encode(JSON.stringify(row)),
            mediaType: 'application/json',
            profile: 'commonmark-v1',
            ...(instant
              ? {
                  publication: {
                    instant,
                    precision: 'second' as const,
                    inferred: false,
                  },
                }
              : {}),
          });
        }
        if (!pagination || pending || initial || reached) break;
        const next: unknown = readPath(value, pagination.nextCursorPath);
        const hasMore = pagination.hasMorePath
          ? readPath(value, pagination.hasMorePath)
          : next != null && next !== '';
        if (hasMore === false || hasMore === 0) break;
        if (
          !(
            (typeof next === 'string' &&
              next.length > 0 &&
              next.length <= 128) ||
            (typeof next === 'number' && Number.isFinite(next))
          ) ||
          next === page
        )
          throw new SourceConnectorError('connector_result_invalid');
        page = next;
        skip = 0;
        if (attempt === 2) pending = {page, skip, stop, initial};
      }
      const cursor = Buffer.from(
        JSON.stringify({
          version: 2,
          tokens: tokens.length ? tokens.slice(-64) : previous.tokens,
          ...(pending ? {pending} : {}),
        }),
      ).toString('base64url');
      if (cursor.length > 2048)
        throw new SourceConnectorError('connector_result_invalid');
      const continuation = pending ? {hasMore: true as const} : {};
      return documents.length
        ? {status: 'changed', cursor, documents, ...continuation}
        : {status: 'unchanged', cursor, ...continuation};
    } catch (error) {
      if (error instanceof SourceConnectorError) throw error;
      if (error instanceof z.ZodError || error instanceof SyntaxError)
        throw new SourceConnectorError('connector_result_invalid');
      // Upstream errors may contain authorization values or payloads.
      throw new SourceConnectorError('connector_unavailable');
    } finally {
      await client.close().catch(() => undefined);
    }
  }
}
