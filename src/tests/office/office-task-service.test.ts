import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createOfficeTaskStore } from '../../main/office/office-task-store';
import { OfficeTaskService } from '../../main/office/office-task-service';
import type { SessionManager } from '../../main/session/session-manager';
import type { ServerEvent, Session } from '../../renderer/types';
import { createFakeOfficeDatabase } from './fake-office-db';

describe('office task service', () => {
  let cwd: string;
  let inputFile: string;
  let pdfFile: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'office-task-service-work-'));
    inputFile = path.join(cwd, 'source.txt');
    fs.writeFileSync(inputFile, 'quarterly numbers');
    pdfFile = path.join(cwd, 'source.pdf');
    fs.writeFileSync(pdfFile, '%PDF-1.4');
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('starts a task through SessionManager and records generated artifacts on completion', async () => {
    const db = createFakeOfficeDatabase();
    const store = createOfficeTaskStore(db);
    const events: ServerEvent[] = [];
    const session: Session = {
      id: 'session-1',
      title: 'File summary',
      status: 'idle',
      cwd,
      mountedPaths: [{ virtual: '/mnt/workspace', real: cwd }],
      allowedTools: ['read', 'write'],
      memoryEnabled: true,
      createdAt: 100,
      updatedAt: 100,
    };
    const startSession = vi.fn(async () => {
      db.sessions.create({
        id: session.id,
        title: session.title,
        claude_session_id: null,
        openai_thread_id: null,
        status: session.status,
        cwd,
        mounted_paths: JSON.stringify(session.mountedPaths),
        allowed_tools: JSON.stringify(session.allowedTools),
        memory_enabled: 1,
        model: null,
        created_at: session.createdAt,
        updated_at: session.updatedAt,
      });
      return session;
    });
    const stopSession = vi.fn();
    const manager = {
      startSession,
      stopSession,
    } as unknown as SessionManager;
    const service = new OfficeTaskService({
      store,
      sessionManager: manager,
      sendToRenderer: (event) => events.push(event),
      now: () => 500,
    });

    const detail = await service.start({
      templateId: 'file_summary',
      cwd,
      inputPaths: [inputFile],
      sourceType: 'local',
    });

    expect(detail.task.status).toBe('running');
    expect(detail.task.sessionId).toBe('session-1');
    expect(fs.existsSync(detail.task.outputDir)).toBe(true);
    expect(startSession).toHaveBeenCalledTimes(1);

    const artifactPath = path.join(detail.task.outputDir, 'summary.md');
    fs.writeFileSync(artifactPath, '# Summary');
    service.handleServerEvent({
      type: 'session.status',
      payload: { sessionId: 'session-1', status: 'idle' },
    });

    const completed = service.get(detail.task.id);
    expect(completed?.task.status).toBe('completed');
    expect(completed?.artifacts).toHaveLength(1);
    expect(completed?.artifacts[0].name).toBe('summary.md');
    expect(events.some((event) => event.type === 'office-task.update')).toBe(true);
  });

  it('cancels the linked session when a task is cancelled', async () => {
    const db = createFakeOfficeDatabase();
    const store = createOfficeTaskStore(db);
    const session: Session = {
      id: 'session-2',
      title: 'PDF summary',
      status: 'idle',
      cwd,
      mountedPaths: [{ virtual: '/mnt/workspace', real: cwd }],
      allowedTools: ['read', 'write'],
      memoryEnabled: true,
      createdAt: 100,
      updatedAt: 100,
    };
    const manager = {
      startSession: vi.fn(async () => {
        db.sessions.create({
          id: session.id,
          title: session.title,
          claude_session_id: null,
          openai_thread_id: null,
          status: session.status,
          cwd,
          mounted_paths: JSON.stringify(session.mountedPaths),
          allowed_tools: JSON.stringify(session.allowedTools),
          memory_enabled: 1,
          model: null,
          created_at: session.createdAt,
          updated_at: session.updatedAt,
        });
        return session;
      }),
      stopSession: vi.fn(),
    } as unknown as SessionManager;
    const service = new OfficeTaskService({
      store,
      sessionManager: manager,
      sendToRenderer: () => undefined,
      now: () => 600,
    });

    const detail = await service.start({
      templateId: 'pdf_summary',
      cwd,
      inputPaths: [pdfFile],
    });
    const cancelled = service.cancel(detail.task.id);

    expect(cancelled?.task.status).toBe('cancelled');
    expect(manager.stopSession).toHaveBeenCalledWith('session-2');
  });

  it('marks the task as error when the linked session reports an error', async () => {
    const { service } = createServiceHarness('session-error', 700);
    const detail = await service.start({
      templateId: 'file_summary',
      cwd,
      inputPaths: [inputFile],
    });

    service.handleServerEvent({
      type: 'session.status',
      payload: {
        sessionId: 'session-error',
        status: 'error',
        error: 'Provider quota exceeded',
      },
    });
    service.handleServerEvent({
      type: 'session.status',
      payload: { sessionId: 'session-error', status: 'idle' },
    });

    const failed = service.get(detail.task.id);
    expect(failed?.task.status).toBe('error');
    expect(failed?.task.error).toBe('Provider quota exceeded');
    expect(failed?.task.completedAt).toBe(700);
  });

  it('keeps fatal assistant errors from being overwritten by the final idle status', async () => {
    const { service } = createServiceHarness('session-assistant-error', 800);
    const detail = await service.start({
      templateId: 'report_generation',
      cwd,
      inputPaths: [inputFile],
    });

    service.handleServerEvent({
      type: 'stream.message',
      payload: {
        sessionId: 'session-assistant-error',
        message: {
          id: 'assistant-error',
          sessionId: 'session-assistant-error',
          role: 'assistant',
          content: [{ type: 'text', text: '**Error**: API request failed' }],
          timestamp: 800,
        },
      },
    });
    const artifactPath = path.join(detail.task.outputDir, 'report.md');
    fs.writeFileSync(artifactPath, '# Report');
    service.handleServerEvent({
      type: 'session.status',
      payload: { sessionId: 'session-assistant-error', status: 'idle' },
    });

    const failed = service.get(detail.task.id);
    expect(failed?.task.status).toBe('error');
    expect(failed?.task.error).toBe('API request failed');
    expect(failed?.artifacts).toHaveLength(0);
  });

  it('marks completed sessions with no output artifacts as errors', async () => {
    const { service } = createServiceHarness('session-no-artifacts', 900);
    const detail = await service.start({
      templateId: 'deck_generation',
      cwd,
      inputPaths: [inputFile],
    });

    service.handleServerEvent({
      type: 'session.status',
      payload: { sessionId: 'session-no-artifacts', status: 'idle' },
    });

    const failed = service.get(detail.task.id);
    expect(failed?.task.status).toBe('error');
    expect(failed?.task.error).toContain('no generated artifacts');
    expect(failed?.artifacts).toHaveLength(0);
  });

  it('retries a task with the same inputs and options', async () => {
    const { service, manager } = createServiceHarness('session-retry', 1000);
    const detail = await service.start({
      templateId: 'file_summary',
      title: 'Retry me',
      cwd,
      inputPaths: [inputFile],
      options: {
        outputFormat: 'docx',
        language: 'zh',
        detailLevel: 'deep',
        audience: 'leadership',
      },
    });

    const retried = await service.retry(detail.task.id);

    expect(retried.task.id).not.toBe(detail.task.id);
    expect(retried.task.title).toBe('Retry me');
    expect(retried.task.inputPaths).toEqual([inputFile]);
    expect(retried.task.options.outputFormat).toBe('docx');
    expect(manager.startSession).toHaveBeenCalledTimes(2);
  });

  it('previews, renames, and deletes text artifacts inside the output directory', async () => {
    const { service } = createServiceHarness('session-artifacts', 1100);
    const detail = await service.start({
      templateId: 'file_summary',
      cwd,
      inputPaths: [inputFile],
    });
    const artifactPath = path.join(detail.task.outputDir, 'summary.md');
    fs.writeFileSync(artifactPath, '# Summary\nHello');

    const refreshed = service.refreshArtifacts(detail.task.id);
    const artifact = refreshed?.artifacts[0];
    expect(artifact).toBeDefined();

    const preview = service.previewArtifact(detail.task.id, artifact!.id);
    expect(preview?.supported).toBe(true);
    expect(preview?.content).toContain('Hello');

    const renamed = service.renameArtifact(detail.task.id, artifact!.id, 'renamed.md');
    expect(renamed?.artifacts[0].name).toBe('renamed.md');
    expect(fs.existsSync(path.join(detail.task.outputDir, 'renamed.md'))).toBe(true);

    const deleted = service.deleteArtifact(detail.task.id, renamed!.artifacts[0].id);
    expect(deleted?.artifacts).toHaveLength(0);
    expect(fs.existsSync(path.join(detail.task.outputDir, 'renamed.md'))).toBe(false);
  });

  function createServiceHarness(sessionId: string, now: number) {
    const db = createFakeOfficeDatabase();
    const store = createOfficeTaskStore(db);
    const events: ServerEvent[] = [];
    const session: Session = {
      id: sessionId,
      title: 'Office task',
      status: 'idle',
      cwd,
      mountedPaths: [{ virtual: '/mnt/workspace', real: cwd }],
      allowedTools: ['read', 'write'],
      memoryEnabled: true,
      createdAt: 100,
      updatedAt: 100,
    };
    const manager = {
      startSession: vi.fn(async () => {
        db.sessions.create({
          id: session.id,
          title: session.title,
          claude_session_id: null,
          openai_thread_id: null,
          status: session.status,
          cwd,
          mounted_paths: JSON.stringify(session.mountedPaths),
          allowed_tools: JSON.stringify(session.allowedTools),
          memory_enabled: 1,
          model: null,
          created_at: session.createdAt,
          updated_at: session.updatedAt,
        });
        return session;
      }),
      stopSession: vi.fn(),
    } as unknown as SessionManager;
    const service = new OfficeTaskService({
      store,
      sessionManager: manager,
      sendToRenderer: (event) => events.push(event),
      now: () => now,
    });
    return { db, store, events, manager, service };
  }
});
