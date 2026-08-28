import {describe, expect, it} from 'vitest';

import {
  collectEnvironmentSecrets,
  StructuredLogger,
  type Clock,
  type LogSink,
} from './structured_logger.js';

class FixedClock implements Clock {
  public now(): Date {
    return new Date('2026-08-09T01:02:03.000Z');
  }
}

class RecordingSink implements LogSink {
  public readonly lines: string[] = [];

  public write(line: string): void {
    this.lines.push(line);
  }
}

describe('StructuredLogger', () => {
  it('writes stable structured fields using an injected clock', () => {
    const sink = new RecordingSink();
    const logger = new StructuredLogger({
      minimumLevel: 'info',
      role: 'worker',
      clock: new FixedClock(),
      sink,
      secrets: [],
    });

    logger.write('info', 'runtime_ready', {count: 2});

    const line = sink.lines.at(0);
    if (line === undefined) {
      throw new Error('Expected one structured log line.');
    }
    expect(JSON.parse(line)).toEqual({
      timestamp: '2026-08-09T01:02:03.000Z',
      level: 'info',
      event: 'runtime_ready',
      service: 'struinfo',
      role: 'worker',
      count: 2,
    });
  });

  it('does not retain database URLs or injected secret values', () => {
    const databaseUrl =
      'postgresql://runtime:synthetic-db-secret@localhost/struinfo';
    const injectedSecret = 'synthetic-injected-token';
    const sink = new RecordingSink();
    const logger = new StructuredLogger({
      minimumLevel: 'debug',
      role: 'api',
      clock: new FixedClock(),
      sink,
      secrets: [databaseUrl, injectedSecret],
    });

    logger.write('error', `failed near ${databaseUrl}`, {
      database_url: databaseUrl,
      detail: `token=${injectedSecret}`,
      nested: {password: injectedSecret},
      error: new Error(injectedSecret),
    });

    const output = sink.lines.join('\n');
    expect(output).not.toContain(databaseUrl);
    expect(output).not.toContain('synthetic-db-secret');
    expect(output).not.toContain(injectedSecret);
    expect(output).not.toContain('Error:');
    expect(output).toContain('[REDACTED]');
  });

  it('collects only values from secret-bearing environment keys', () => {
    expect(
      collectEnvironmentSecrets({
        DATABASE_URL: 'database-secret',
        API_TOKEN: 'token-secret',
        NORMAL_VALUE: 'public-value',
      }),
    ).toEqual(['database-secret', 'token-secret']);
  });

  it('honors the configured minimum level', () => {
    const sink = new RecordingSink();
    const logger = new StructuredLogger({
      minimumLevel: 'warn',
      role: 'scheduler',
      clock: new FixedClock(),
      sink,
      secrets: [],
    });

    logger.write('info', 'ignored');
    logger.write('warn', 'retained');

    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]).toContain('retained');
  });
});
