import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Replace the real (file-writing) logger with spies. runWithLogContext must
// still invoke its callback so the lifecycle log calls actually fire.
vi.mock('../../main/utils/logger', () => ({
  log: vi.fn(),
  logCtx: vi.fn(),
  logCtxWarn: vi.fn(),
  logCtxError: vi.fn(),
  runWithLogContext: (_ctx: unknown, fn: () => unknown) => fn(),
}));

import { createOfficeTaskStore } from '../../main/office/office-task-store';
import { OfficeTaskService } from '../../main/office/office-task-service';
import * as logger from '../../main/utils/logger';
import type { SessionManager } from '../../main/session/session-manager';
import { createFakeOfficeDatabase } from './fake-office-db';

function calls(fn: unknown): unknown[][] {
  return (fn as unknown as { mock: { calls: unknown[][] } }).mock.calls;
}

describe('office task logging', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'office-log-'));
    fs.writeFileSync(path.join(cwd, 'a.txt'), 'content');
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('emits a context-tagged start log and redacts secrets in failure logs', async () => {
    const db = createFakeOfficeDatabase();
    const store = createOfficeTaskStore(db);
    const secret = 'sk-abcdef0123456789ABCDEFGHIJ';
    const manager = {
      startSession: vi.fn(async () => {
        throw new Error(`session boot failed api_key=${secret}`);
      }),
      stopSession: vi.fn(),
    } as unknown as SessionManager;

    const service = new OfficeTaskService({
      store,
      sessionManager: manager,
      sendToRenderer: () => {},
      now: () => 1,
    });

    await expect(
      service.start({
        templateId: 'file_summary',
        cwd,
        inputPaths: [path.join(cwd, 'a.txt')],
      })
    ).rejects.toThrow();

    // A lifecycle "start" info log fired.
    const infoSerialized = JSON.stringify(calls(logger.logCtx));
    expect(infoSerialized).toContain('[OfficeTask] start');

    // The failure was logged with the secret masked, original secret absent.
    const errorSerialized = JSON.stringify(calls(logger.logCtxError));
    expect(errorSerialized).toContain('[OfficeTask] failed (start)');
    expect(errorSerialized).toContain('***REDACTED***');
    expect(errorSerialized).not.toContain(secret);
  });
});
