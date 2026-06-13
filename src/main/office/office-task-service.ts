import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type { ContentBlock, ServerEvent, SessionStatus, TextContent } from '../../renderer/types';
import type {
  OfficeArtifact,
  OfficeArtifactPreview,
  OfficeTask,
  OfficeTaskStartInput,
  OfficeTaskTemplateId,
  OfficeTaskWithArtifacts,
} from '../../shared/office-tasks';
import { classifyArtifact } from '../../shared/office-task-progress';
import type { SessionManager } from '../session/session-manager';
import type { OfficeTaskStore } from './office-task-store';
import {
  buildOfficeTaskPrompt,
  normalizeOfficeTaskOptions,
  validateOfficeTaskStartInput,
} from './office-task-templates';
import { log, logCtx, logCtxWarn, logCtxError, runWithLogContext } from '../utils/logger';
import { redactValue } from '../utils/log-redaction';

export interface OfficeTaskServiceOptions {
  store: OfficeTaskStore;
  sessionManager: SessionManager;
  sendToRenderer: (event: ServerEvent) => void;
  now?: () => number;
}

const OUTPUT_ROOT_DIR = '.cowork-office';
const NO_ARTIFACTS_ERROR =
  'Task finished, but no generated artifacts were found in the output directory.';
const PREVIEW_LIMIT_BYTES = 64 * 1024;

export class OfficeTaskService {
  private readonly store: OfficeTaskStore;
  private readonly sessionManager: SessionManager;
  private readonly sendToRenderer: (event: ServerEvent) => void;
  private readonly now: () => number;

  constructor(options: OfficeTaskServiceOptions) {
    this.store = options.store;
    this.sessionManager = options.sessionManager;
    this.sendToRenderer = options.sendToRenderer;
    this.now = options.now ?? (() => Date.now());
  }

  list(): OfficeTask[] {
    return this.store.list();
  }

  get(taskId: string): OfficeTaskWithArtifacts | null {
    const task = this.store.get(taskId);
    if (!task) {
      return null;
    }
    return {
      task,
      artifacts: this.store.listArtifacts(taskId),
    };
  }

  async start(input: OfficeTaskStartInput): Promise<OfficeTaskWithArtifacts> {
    const validationError = validateOfficeTaskStartInput(input);
    if (validationError) {
      throw new Error(validationError);
    }
    this.validateFileSystemInputs(input);

    const taskId = uuidv4();
    const title = normalizeTitle(input.title) || getDefaultTitle(input.templateId);
    const options = normalizeOfficeTaskOptions(input.options);
    const outputDir = path.join(input.cwd, OUTPUT_ROOT_DIR, 'tasks', taskId, 'outputs');
    fs.mkdirSync(outputDir, { recursive: true });

    const task = this.store.create({
      id: taskId,
      title,
      templateId: input.templateId,
      status: 'pending',
      cwd: input.cwd,
      inputPaths: input.inputPaths,
      outputDir,
      sourceType: input.sourceType ?? 'local',
      externalRef: input.externalRef ?? null,
      options,
    });

    const prompt = buildOfficeTaskPrompt({
      taskId,
      templateId: input.templateId,
      title,
      cwd: input.cwd,
      inputPaths: input.inputPaths,
      outputDir,
      options,
    });
    const content = this.buildContentBlocks(input.inputPaths, prompt);

    this.logTaskEvent(taskId, 'info', '[OfficeTask] start', {
      template: input.templateId,
      inputs: input.inputPaths.length,
      outputDir,
    });

    try {
      const session = await this.sessionManager.startSession(
        title,
        prompt,
        input.cwd,
        undefined,
        content
      );
      const runningTask = this.store.update(task.id, {
        status: 'running',
        sessionId: session.id,
        error: null,
      });
      this.logTaskEvent(taskId, 'info', '[OfficeTask] running', { sessionId: session.id });
      this.emitTaskUpdate(runningTask ?? task);
      this.sendToRenderer({
        type: 'session.update',
        payload: { sessionId: session.id, updates: session },
      });
      return {
        task: runningTask ?? task,
        artifacts: [],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logTaskEvent(task.id, 'error', '[OfficeTask] failed (start)', {
        pathway: 'start-failure',
        error,
      });
      const failedTask =
        this.store.update(task.id, {
          status: 'error',
          error: message,
          completedAt: this.now(),
        }) ?? task;
      this.emitTaskUpdate(failedTask);
      throw error;
    }
  }

  retry(taskId: string): Promise<OfficeTaskWithArtifacts> {
    const task = this.store.get(taskId);
    if (!task) {
      throw new Error('Office task not found');
    }
    return this.start({
      templateId: task.templateId,
      title: task.title,
      cwd: task.cwd,
      inputPaths: task.inputPaths,
      options: task.options,
      sourceType: task.sourceType,
      externalRef: task.externalRef,
    });
  }

  cancel(taskId: string): OfficeTaskWithArtifacts | null {
    const task = this.store.get(taskId);
    if (!task) {
      return null;
    }
    if (task.sessionId) {
      this.sessionManager.stopSession(task.sessionId);
    }
    const cancelled =
      this.store.update(taskId, {
        status: 'cancelled',
        completedAt: this.now(),
      }) ?? task;
    this.emitTaskUpdate(cancelled);
    return {
      task: cancelled,
      artifacts: this.store.listArtifacts(taskId),
    };
  }

  refreshArtifacts(taskId: string): OfficeTaskWithArtifacts | null {
    const task = this.store.get(taskId);
    if (!task) {
      return null;
    }
    const artifacts = this.scanOutputArtifacts(task);
    this.store.replaceArtifacts(taskId, artifacts);
    return {
      task,
      artifacts,
    };
  }

  previewArtifact(taskId: string, artifactId: string): OfficeArtifactPreview | null {
    const task = this.store.get(taskId);
    if (!task) {
      return null;
    }
    const artifact = this.findArtifact(task, artifactId);
    if (!artifact) {
      return null;
    }
    this.assertArtifactInsideOutputDir(task, artifact.path);
    if (!isPreviewableArtifact(artifact)) {
      return {
        artifact,
        content: '',
        supported: false,
        truncated: false,
      };
    }
    const buffer = fs.readFileSync(artifact.path);
    const truncated = buffer.byteLength > PREVIEW_LIMIT_BYTES;
    const content = buffer.subarray(0, PREVIEW_LIMIT_BYTES).toString('utf8');
    return {
      artifact,
      content,
      supported: true,
      truncated,
    };
  }

  renameArtifact(taskId: string, artifactId: string, name: string): OfficeTaskWithArtifacts | null {
    const task = this.store.get(taskId);
    if (!task) {
      return null;
    }
    const artifact = this.findArtifact(task, artifactId);
    if (!artifact) {
      return null;
    }
    this.assertArtifactInsideOutputDir(task, artifact.path);
    const nextName = sanitizeArtifactName(name);
    const nextPath = path.join(path.dirname(artifact.path), nextName);
    this.assertArtifactInsideOutputDir(task, nextPath);
    if (fs.existsSync(nextPath) && path.resolve(nextPath) !== path.resolve(artifact.path)) {
      throw new Error('A file with this name already exists');
    }
    fs.renameSync(artifact.path, nextPath);
    return this.refreshArtifacts(taskId);
  }

  deleteArtifact(taskId: string, artifactId: string): OfficeTaskWithArtifacts | null {
    const task = this.store.get(taskId);
    if (!task) {
      return null;
    }
    const artifact = this.findArtifact(task, artifactId);
    if (!artifact) {
      return null;
    }
    this.assertArtifactInsideOutputDir(task, artifact.path);
    fs.rmSync(artifact.path, { force: true });
    return this.refreshArtifacts(taskId);
  }

  handleServerEvent(event: ServerEvent): void {
    if (event.type === 'stream.message') {
      const assistantError = extractAssistantError(event);
      if (assistantError) {
        this.markTaskError(event.payload.sessionId, assistantError);
        return;
      }
    }

    if (event.type === 'trace.step' || event.type === 'trace.update') {
      const fatalTraceError = extractFatalTraceError(event);
      if (fatalTraceError) {
        this.markTaskError(event.payload.sessionId, fatalTraceError);
        return;
      }
    }

    if (event.type !== 'session.status') {
      return;
    }

    const task = this.store.getBySessionId(event.payload.sessionId);
    if (!task) {
      return;
    }

    if (
      event.payload.status === 'running' &&
      task.status !== 'running' &&
      task.status !== 'error' &&
      task.status !== 'cancelled'
    ) {
      const updated = this.store.update(task.id, { status: 'running', error: null });
      if (updated) this.emitTaskUpdate(updated);
      return;
    }

    if (!isTerminalSessionStatus(event.payload.status)) {
      return;
    }

    if (task.status === 'cancelled') {
      return;
    }

    if (event.payload.status === 'error') {
      this.markTaskError(
        event.payload.sessionId,
        event.payload.error || 'The linked agent session failed.'
      );
      return;
    }

    if (task.status === 'error') {
      return;
    }

    try {
      const artifacts = this.scanOutputArtifacts(task);
      this.store.replaceArtifacts(task.id, artifacts);
      if (artifacts.length === 0) {
        this.logTaskEvent(task.id, 'error', '[OfficeTask] failed (no artifacts)', {
          pathway: 'no-artifacts',
        });
        const updated = this.store.update(task.id, {
          status: 'error',
          error: NO_ARTIFACTS_ERROR,
          completedAt: this.now(),
        });
        if (updated) {
          this.emitTaskUpdate(updated);
        }
        return;
      }
      this.logTaskEvent(task.id, 'info', '[OfficeTask] completed', { artifacts: artifacts.length });
      const updated = this.store.update(task.id, {
        status: 'completed',
        error: null,
        completedAt: this.now(),
      });
      if (updated) {
        this.emitTaskUpdate(updated);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logTaskEvent(task.id, 'error', '[OfficeTask] failed (artifact scan)', {
        pathway: 'scan-error',
        error,
      });
      const updated = this.store.update(task.id, {
        status: 'error',
        error: message,
        completedAt: this.now(),
      });
      if (updated) {
        this.emitTaskUpdate(updated);
      }
    }
  }

  private markTaskError(sessionId: string, message: string): void {
    const task = this.store.getBySessionId(sessionId);
    if (!task || task.status === 'cancelled') {
      return;
    }
    this.logTaskEvent(task.id, 'error', '[OfficeTask] failed (session)', {
      pathway: 'session-error',
      reason: message,
    });
    const updated = this.store.update(task.id, {
      status: 'error',
      error: message,
      completedAt: this.now(),
    });
    if (updated) {
      this.emitTaskUpdate(updated);
    }
  }

  private validateFileSystemInputs(input: OfficeTaskStartInput): void {
    if (!fs.existsSync(input.cwd)) {
      throw new Error('Working folder does not exist');
    }
    if (!fs.statSync(input.cwd).isDirectory()) {
      throw new Error('Working folder must be a folder');
    }
    for (const inputPath of input.inputPaths) {
      if (!fs.existsSync(inputPath)) {
        throw new Error(`Input file does not exist: ${inputPath}`);
      }
      if (!fs.statSync(inputPath).isFile()) {
        throw new Error(
          'Folder inputs are not supported in this version. Select one folder as the working directory and attach files inside the task.'
        );
      }
    }
  }

  private buildContentBlocks(inputPaths: string[], prompt: string): ContentBlock[] {
    const attachments: ContentBlock[] = inputPaths.map((inputPath) => ({
      type: 'file_attachment',
      filename: path.basename(inputPath),
      relativePath: inputPath,
      size: safeFileSize(inputPath),
      mimeType: guessMimeType(inputPath),
    }));
    return [...attachments, { type: 'text', text: prompt }];
  }

  private scanOutputArtifacts(task: OfficeTask): OfficeArtifact[] {
    if (!fs.existsSync(task.outputDir)) {
      logCtxWarn(
        '[OfficeTask] Output directory missing while scanning artifacts:',
        redactValue(task.outputDir)
      );
      return [];
    }

    const artifacts: OfficeArtifact[] = [];
    const queue = [task.outputDir];
    while (queue.length > 0) {
      const currentDir = queue.shift();
      if (!currentDir) continue;

      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isSymbolicLink()) {
          continue;
        }
        if (entry.isDirectory()) {
          queue.push(fullPath);
          continue;
        }
        if (!entry.isFile() || shouldIgnoreArtifact(entry.name)) {
          continue;
        }

        const stat = fs.statSync(fullPath);
        artifacts.push({
          id: uuidv4(),
          taskId: task.id,
          path: fullPath,
          name: entry.name,
          type: classifyArtifact(entry.name),
          size: stat.size,
          createdAt: Math.max(stat.birthtimeMs || 0, stat.mtimeMs || this.now()),
        });
      }
    }

    log('[OfficeTask] Scanned artifacts:', task.id, artifacts.length);
    return artifacts.sort((a, b) => a.createdAt - b.createdAt);
  }

  private findArtifact(task: OfficeTask, artifactId: string): OfficeArtifact | null {
    return this.store.listArtifacts(task.id).find((artifact) => artifact.id === artifactId) ?? null;
  }

  private assertArtifactInsideOutputDir(task: OfficeTask, artifactPath: string): void {
    const resolvedOutputDir = path.resolve(task.outputDir);
    const resolvedArtifactPath = path.resolve(artifactPath);
    const prefix = resolvedOutputDir.endsWith(path.sep)
      ? resolvedOutputDir
      : `${resolvedOutputDir}${path.sep}`;
    if (resolvedArtifactPath !== resolvedOutputDir && !resolvedArtifactPath.startsWith(prefix)) {
      throw new Error('Artifact path is outside the task output directory');
    }
  }

  /**
   * Emit a context-tagged, redacted lifecycle log line for a task. Secrets and
   * home-path usernames in `detail` are masked before they reach the log file,
   * and every line carries the task id as a trace tag for correlation.
   */
  private logTaskEvent(
    taskId: string,
    level: 'info' | 'error',
    message: string,
    detail?: unknown
  ): void {
    runWithLogContext({ traceId: taskId, module: 'OfficeTask' }, () => {
      const args: unknown[] = detail === undefined ? [message] : [message, redactValue(detail)];
      if (level === 'error') {
        logCtxError(...args);
      } else {
        logCtx(...args);
      }
    });
  }

  private emitTaskUpdate(task: OfficeTask): void {
    this.sendToRenderer({
      type: 'office-task.update',
      payload: {
        task,
        artifacts: this.store.listArtifacts(task.id),
      },
    });
  }
}

function normalizeTitle(title: string | undefined): string {
  return title?.trim() ?? '';
}

function getDefaultTitle(templateId: OfficeTaskTemplateId): string {
  switch (templateId) {
    case 'file_summary':
      return 'File summary';
    case 'pdf_summary':
      return 'PDF summary';
    case 'spreadsheet_analysis':
      return 'Spreadsheet analysis';
    case 'report_generation':
      return 'Business report';
    case 'deck_generation':
      return 'Presentation deck';
  }
}

function isTerminalSessionStatus(status: SessionStatus): boolean {
  return status === 'idle' || status === 'completed' || status === 'error';
}

function extractAssistantError(event: ServerEvent): string | null {
  if (event.type !== 'stream.message' || event.payload.message.role !== 'assistant') {
    return null;
  }

  const text = event.payload.message.content
    .filter((block): block is TextContent => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
  if (!text) {
    return null;
  }

  const errorMatch = text.match(/^\*\*Error\*\*:\s*(.+)$/is) ?? text.match(/^Error:\s*(.+)$/is);
  if (errorMatch?.[1]?.trim()) {
    return errorMatch[1].trim();
  }

  if (text.includes('请求超时') || text.includes('操作已中止')) {
    return text;
  }

  return null;
}

function extractFatalTraceError(event: ServerEvent): string | null {
  if (event.type === 'trace.step') {
    const step = event.payload.step;
    if (step.type === 'thinking' && step.status === 'error') {
      return step.title || step.content || 'The linked agent session failed.';
    }
    return null;
  }

  if (event.type !== 'trace.update' || event.payload.updates.status !== 'error') {
    return null;
  }

  const title = event.payload.updates.title;
  if (
    title === 'Request failed' ||
    title === 'Request timed out' ||
    title === 'Error occurred' ||
    title === 'Error during context compaction'
  ) {
    return title;
  }
  return null;
}

function safeFileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function guessMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.pdf':
      return 'application/pdf';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case '.csv':
      return 'text/csv';
    case '.md':
      return 'text/markdown';
    case '.txt':
      return 'text/plain';
    default:
      return 'application/octet-stream';
  }
}

function shouldIgnoreArtifact(fileName: string): boolean {
  return (
    fileName === '.DS_Store' ||
    fileName.startsWith('~$') ||
    fileName.startsWith('._') ||
    /^\.~lock\..*#$/.test(fileName) ||
    /\.(?:tmp|temp|swp|swo|bak|crdownload|part)$/i.test(fileName)
  );
}

function isPreviewableArtifact(artifact: OfficeArtifact): boolean {
  const ext = path.extname(artifact.name).toLowerCase();
  return (
    artifact.type === 'markdown' ||
    ext === '.txt' ||
    ext === '.csv' ||
    ext === '.tsv' ||
    ext === '.json' ||
    ext === '.log'
  );
}

function sanitizeArtifactName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Artifact name cannot be empty');
  }
  if (trimmed !== path.basename(trimmed) || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error('Artifact name must not contain folders');
  }
  if (trimmed === '.' || trimmed === '..') {
    throw new Error('Artifact name is invalid');
  }
  return trimmed;
}
