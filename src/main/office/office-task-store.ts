import { v4 as uuidv4 } from 'uuid';
import type { DatabaseInstance, OfficeArtifactRow, OfficeTaskRow } from '../db/database';
import type {
  OfficeTaskOptions,
  OfficeArtifact,
  OfficeArtifactType,
  OfficeTask,
  OfficeTaskSourceType,
  OfficeTaskStatus,
  OfficeTaskTemplateId,
} from '../../shared/office-tasks';
import { DEFAULT_OFFICE_TASK_OPTIONS } from '../../shared/office-tasks';

export interface OfficeTaskCreateRecord {
  id?: string;
  title: string;
  templateId: OfficeTaskTemplateId;
  status: OfficeTaskStatus;
  cwd: string;
  inputPaths: string[];
  outputDir: string;
  sessionId?: string | null;
  sourceType?: OfficeTaskSourceType;
  externalRef?: string | null;
  options?: OfficeTaskOptions;
  error?: string | null;
}

export interface OfficeTaskUpdateRecord {
  title?: string;
  status?: OfficeTaskStatus;
  cwd?: string;
  inputPaths?: string[];
  outputDir?: string;
  sessionId?: string | null;
  sourceType?: OfficeTaskSourceType;
  externalRef?: string | null;
  options?: OfficeTaskOptions;
  error?: string | null;
  completedAt?: number | null;
}

export interface OfficeTaskStore {
  list: () => OfficeTask[];
  get: (id: string) => OfficeTask | null;
  getBySessionId: (sessionId: string) => OfficeTask | null;
  create: (input: OfficeTaskCreateRecord) => OfficeTask;
  update: (id: string, updates: OfficeTaskUpdateRecord) => OfficeTask | null;
  delete: (id: string) => boolean;
  listArtifacts: (taskId: string) => OfficeArtifact[];
  replaceArtifacts: (taskId: string, artifacts: OfficeArtifact[]) => void;
}

export function createOfficeTaskStore(db: DatabaseInstance): OfficeTaskStore {
  return {
    list: () => db.officeTasks.getAll().map(mapTaskRow),
    get: (id: string) => {
      const row = db.officeTasks.get(id);
      return row ? mapTaskRow(row) : null;
    },
    getBySessionId: (sessionId: string) => {
      const row = db.officeTasks.getBySessionId(sessionId);
      return row ? mapTaskRow(row) : null;
    },
    create: (input: OfficeTaskCreateRecord) => {
      const now = Date.now();
      const row: OfficeTaskRow = {
        id: input.id ?? uuidv4(),
        title: input.title,
        template_id: input.templateId,
        status: input.status,
        cwd: input.cwd,
        input_paths: JSON.stringify(input.inputPaths),
        output_dir: input.outputDir,
        session_id: input.sessionId ?? null,
        source_type: input.sourceType ?? 'local',
        external_ref: input.externalRef ?? null,
        options_json: JSON.stringify(input.options ?? DEFAULT_OFFICE_TASK_OPTIONS),
        error: input.error ?? null,
        created_at: now,
        updated_at: now,
        completed_at: null,
      };
      db.officeTasks.create(row);
      return mapTaskRow(row);
    },
    update: (id: string, updates: OfficeTaskUpdateRecord) => {
      db.officeTasks.update(id, mapTaskUpdatesToRow(updates));
      const row = db.officeTasks.get(id);
      return row ? mapTaskRow(row) : null;
    },
    delete: (id: string) => {
      const existing = db.officeTasks.get(id);
      if (!existing) return false;
      db.officeTasks.delete(id);
      return true;
    },
    listArtifacts: (taskId: string) => db.officeArtifacts.listByTaskId(taskId).map(mapArtifactRow),
    replaceArtifacts: (taskId: string, artifacts: OfficeArtifact[]) => {
      db.officeArtifacts.replaceForTask(taskId, artifacts.map(mapArtifactToRow));
    },
  };
}

function mapTaskRow(row: OfficeTaskRow): OfficeTask {
  return {
    id: row.id,
    title: row.title,
    templateId: row.template_id as OfficeTaskTemplateId,
    status: row.status as OfficeTaskStatus,
    cwd: row.cwd,
    inputPaths: parseInputPaths(row.input_paths),
    outputDir: row.output_dir,
    sessionId: row.session_id,
    sourceType: row.source_type as OfficeTaskSourceType,
    externalRef: row.external_ref,
    options: parseOptions(row.options_json),
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function mapTaskUpdatesToRow(updates: OfficeTaskUpdateRecord): Partial<OfficeTaskRow> {
  const row: Partial<OfficeTaskRow> = {};
  if (updates.title !== undefined) row.title = updates.title;
  if (updates.status !== undefined) row.status = updates.status;
  if (updates.cwd !== undefined) row.cwd = updates.cwd;
  if (updates.inputPaths !== undefined) row.input_paths = JSON.stringify(updates.inputPaths);
  if (updates.outputDir !== undefined) row.output_dir = updates.outputDir;
  if (updates.sessionId !== undefined) row.session_id = updates.sessionId;
  if (updates.sourceType !== undefined) row.source_type = updates.sourceType;
  if (updates.externalRef !== undefined) row.external_ref = updates.externalRef;
  if (updates.options !== undefined) row.options_json = JSON.stringify(updates.options);
  if (updates.error !== undefined) row.error = updates.error;
  if (updates.completedAt !== undefined) row.completed_at = updates.completedAt;
  return row;
}

function mapArtifactRow(row: OfficeArtifactRow): OfficeArtifact {
  return {
    id: row.id,
    taskId: row.task_id,
    path: row.path,
    name: row.name,
    type: row.type as OfficeArtifactType,
    size: row.size,
    createdAt: row.created_at,
  };
}

function mapArtifactToRow(artifact: OfficeArtifact): OfficeArtifactRow {
  return {
    id: artifact.id,
    task_id: artifact.taskId,
    path: artifact.path,
    name: artifact.name,
    type: artifact.type,
    size: artifact.size,
    created_at: artifact.createdAt,
  };
}

function parseInputPaths(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function parseOptions(value: string | undefined): OfficeTaskOptions {
  if (!value) {
    return DEFAULT_OFFICE_TASK_OPTIONS;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return DEFAULT_OFFICE_TASK_OPTIONS;
    }
    const record = parsed as Partial<Record<keyof OfficeTaskOptions, unknown>>;
    return {
      outputFormat: isOutputFormat(record.outputFormat)
        ? record.outputFormat
        : DEFAULT_OFFICE_TASK_OPTIONS.outputFormat,
      language: isLanguage(record.language)
        ? record.language
        : DEFAULT_OFFICE_TASK_OPTIONS.language,
      detailLevel: isDetailLevel(record.detailLevel)
        ? record.detailLevel
        : DEFAULT_OFFICE_TASK_OPTIONS.detailLevel,
      audience:
        typeof record.audience === 'string'
          ? record.audience
          : DEFAULT_OFFICE_TASK_OPTIONS.audience,
    };
  } catch {
    return DEFAULT_OFFICE_TASK_OPTIONS;
  }
}

function isOutputFormat(value: unknown): value is OfficeTaskOptions['outputFormat'] {
  return (
    value === 'auto' ||
    value === 'markdown' ||
    value === 'docx' ||
    value === 'pdf' ||
    value === 'xlsx' ||
    value === 'pptx'
  );
}

function isLanguage(value: unknown): value is OfficeTaskOptions['language'] {
  return value === 'auto' || value === 'zh' || value === 'en';
}

function isDetailLevel(value: unknown): value is OfficeTaskOptions['detailLevel'] {
  return value === 'brief' || value === 'standard' || value === 'deep';
}
