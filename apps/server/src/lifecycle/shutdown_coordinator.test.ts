import {describe, expect, it, vi} from 'vitest';

import type {LogLevel} from '../config/runtime_config.js';
import type {RuntimeLogger} from '../logging/structured_logger.js';
import {DeadlineExceededError, type Deadline} from './deadline.js';
import {
  ShutdownCoordinator,
  type ExitDecision,
  type ShutdownSignal,
  type SignalSource,
} from './shutdown_coordinator.js';
import type {RuntimeResource} from './runtime_resource.js';

class ImmediateDeadline implements Deadline {
  public async run<T>(
    _label: string,
    _timeoutMs: number,
    operation: () => Promise<T>,
  ): Promise<T> {
    return operation();
  }
}

class RecordingLogger implements RuntimeLogger {
  public readonly events: Readonly<
    Readonly<{
      level: LogLevel;
      event: string;
      fields: Readonly<Record<string, unknown>>;
    }>
  >[] = [];

  public write(
    level: LogLevel,
    event: string,
    fields: Readonly<Record<string, unknown>> = {},
  ): void {
    this.events.push({level, event, fields});
  }
}

class RecordingExitDecision implements ExitDecision {
  public readonly codes: number[] = [];

  public exit(code: number): void {
    this.codes.push(code);
  }
}

class ControllableSignalSource implements SignalSource {
  #handler: ((signal: ShutdownSignal) => void) | undefined;

  public subscribe(handler: (signal: ShutdownSignal) => void): () => void {
    this.#handler = handler;
    return (): void => {
      this.#handler = undefined;
    };
  }

  public emit(signal: ShutdownSignal): void {
    this.#handler?.(signal);
  }
}

describe('ShutdownCoordinator', () => {
  it('makes readiness false before drain and closes in reverse order', async () => {
    let ready = true;
    const events: string[] = [];
    const resources = ['database', 'queue', 'listener'].map((name) =>
      createResource(name, events, () => ready),
    );
    const logger = new RecordingLogger();
    const exits = new RecordingExitDecision();
    const coordinator = new ShutdownCoordinator({
      readiness: {
        beginShutdown: () => {
          ready = false;
          events.push('readiness:false');
        },
      },
      resources,
      deadline: new ImmediateDeadline(),
      timeoutMs: 1000,
      logger,
      exitDecision: exits,
    });

    await expect(coordinator.requestShutdown('test')).resolves.toBe(
      'completed',
    );

    expect(events).toEqual([
      'readiness:false',
      'stop:listener:ready=false',
      'stop:queue:ready=false',
      'stop:database:ready=false',
      'drain:listener',
      'drain:queue',
      'drain:database',
      'close:listener',
      'close:queue',
      'close:database',
    ]);
    expect(logger.events.map(({event}) => event)).toEqual([
      'shutdown_completed',
    ]);
    expect(exits.codes).toEqual([]);
  });

  it('returns the same promise for repeated first-shutdown requests', async () => {
    const readiness = {beginShutdown: vi.fn()};
    const events: string[] = [];
    const coordinator = new ShutdownCoordinator({
      readiness,
      resources: [createResource('only', events, () => false)],
      deadline: new ImmediateDeadline(),
      timeoutMs: 1000,
      logger: new RecordingLogger(),
      exitDecision: new RecordingExitDecision(),
    });

    const first = coordinator.requestShutdown('manual');
    const repeated = coordinator.requestShutdown('manual-again');

    expect(repeated).toBe(first);
    await expect(first).resolves.toBe('completed');
    expect(readiness.beginShutdown).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event.startsWith('close:'))).toHaveLength(
      1,
    );
  });

  it('exits zero after a completed first process signal', async () => {
    const signals = new ControllableSignalSource();
    const exits = new RecordingExitDecision();
    const coordinator = new ShutdownCoordinator({
      readiness: {beginShutdown: vi.fn()},
      resources: [],
      deadline: new ImmediateDeadline(),
      timeoutMs: 1000,
      logger: new RecordingLogger(),
      exitDecision: exits,
    });
    const dispose = coordinator.bind(signals);

    signals.emit('SIGTERM');
    await expect(coordinator.requestShutdown('duplicate')).resolves.toBe(
      'completed',
    );

    expect(exits.codes).toEqual([0]);
    dispose();
    signals.emit('SIGINT');
    expect(exits.codes).toEqual([0]);
  });

  it('forces a nonzero exit on a second signal without duplicate force', async () => {
    const signals = new ControllableSignalSource();
    const exits = new RecordingExitDecision();
    const logger = new RecordingLogger();
    let finishDrain: (() => void) | undefined;
    const drainPending = new Promise<void>((resolve) => {
      finishDrain = resolve;
    });
    const resource: RuntimeResource = {
      name: 'pending',
      stopAccepting: () => undefined,
      drain: () => drainPending,
      close: () => undefined,
    };
    const coordinator = new ShutdownCoordinator({
      readiness: {beginShutdown: vi.fn()},
      resources: [resource],
      deadline: new ImmediateDeadline(),
      timeoutMs: 1000,
      logger,
      exitDecision: exits,
    });
    coordinator.bind(signals);

    signals.emit('SIGINT');
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    signals.emit('SIGTERM');
    signals.emit('SIGTERM');

    expect(exits.codes).toEqual([1]);
    expect(logger.events.map(({event}) => event)).toEqual(['shutdown_forced']);
    finishDrain?.();
    await expect(coordinator.requestShutdown('duplicate')).resolves.toBe(
      'forced',
    );
  });

  it('returns a nonzero timeout verdict for signal-driven shutdown', async () => {
    const deadline: Deadline = {
      run: () =>
        Promise.reject(new DeadlineExceededError('graceful shutdown', 1000)),
    };
    const signals = new ControllableSignalSource();
    const exits = new RecordingExitDecision();
    const logger = new RecordingLogger();
    const readiness = {beginShutdown: vi.fn()};
    const coordinator = new ShutdownCoordinator({
      readiness,
      resources: [],
      deadline,
      timeoutMs: 1000,
      logger,
      exitDecision: exits,
    });
    coordinator.bind(signals);

    signals.emit('SIGTERM');
    await expect(coordinator.requestShutdown('duplicate')).resolves.toBe(
      'timed_out',
    );

    expect(readiness.beginShutdown).toHaveBeenCalledTimes(1);
    expect(exits.codes).toEqual([1]);
    expect(logger.events.map(({event}) => event)).toEqual([
      'shutdown_timed_out',
    ]);
  });

  it('continues closing resources and reports a shutdown failure', async () => {
    const events: string[] = [];
    const broken = createResource('broken', events, () => false, true);
    const healthy = createResource('healthy', events, () => false);
    const exits = new RecordingExitDecision();
    const signals = new ControllableSignalSource();
    const coordinator = new ShutdownCoordinator({
      readiness: {beginShutdown: vi.fn()},
      resources: [healthy, broken],
      deadline: new ImmediateDeadline(),
      timeoutMs: 1000,
      logger: new RecordingLogger(),
      exitDecision: exits,
    });
    coordinator.bind(signals);

    signals.emit('SIGINT');
    await expect(coordinator.requestShutdown('duplicate')).resolves.toBe(
      'failed',
    );

    expect(events).toContain('close:healthy');
    expect(exits.codes).toEqual([1]);
  });
});

function createResource(
  name: string,
  events: string[],
  isReady: () => boolean,
  failClose = false,
): RuntimeResource {
  return {
    name,
    stopAccepting: () => {
      events.push(`stop:${name}:ready=${String(isReady())}`);
    },
    drain: () => {
      events.push(`drain:${name}`);
    },
    close: () => {
      events.push(`close:${name}`);
      if (failClose) {
        throw new Error('synthetic close failure');
      }
    },
  };
}
