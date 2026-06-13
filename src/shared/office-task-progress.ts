import type {
  OfficeArtifact,
  OfficeArtifactType,
  OfficeTaskStatus,
  OfficeTaskTemplateId,
} from './office-tasks';

/**
 * Pure, framework-free helpers that turn raw task state into the user-facing
 * progress model shown in the Office workspace. This file must NOT import React,
 * i18next, or `node:path` — it is bundled into the renderer and consumed by the
 * main process. Functions return i18n keys + params, never translated strings.
 */

export type OfficePhase = 'queued' | 'reading' | 'analyzing' | 'generating' | 'done';

export const OFFICE_PHASE_ORDER: readonly OfficePhase[] = [
  'queued',
  'reading',
  'analyzing',
  'generating',
  'done',
];

export type OfficeProgressState = 'idle' | 'active' | 'error' | 'cancelled' | 'done';

export interface OfficeProgress {
  phase: OfficePhase;
  percent: number;
  state: OfficeProgressState;
}

/**
 * Minimal structural shape of a trace step. Declared locally instead of
 * importing `TraceStep` from `src/renderer/types` so this shared module never
 * depends on renderer code. The renderer's `TraceStep` is structurally
 * assignable, so callers pass `TraceStep[]` with no cast.
 */
export interface TraceStepLike {
  type: 'thinking' | 'text' | 'tool_call' | 'tool_result';
  status?: 'pending' | 'running' | 'completed' | 'error';
  title?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
}

const PHASE_INDEX: Record<OfficePhase, number> = {
  queued: 0,
  reading: 1,
  analyzing: 2,
  generating: 3,
  done: 4,
};

const PHASE_PERCENT: Record<OfficePhase, number> = {
  queued: 5,
  reading: 30,
  analyzing: 60,
  generating: 90,
  done: 100,
};

const READ_TOOLS = new Set([
  'read',
  'read_file',
  'grep',
  'find',
  'glob',
  'ls',
  'list_dir',
  'search',
]);

const WRITE_TOOLS = new Set([
  'write',
  'write_file',
  'edit',
  'edit_file',
  'multiedit',
  'notebookedit',
  'notebook_edit',
]);

function getStringField(input: Record<string, unknown> | undefined, key: string): string | null {
  const value = input?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Whether a bash command is installing dependencies rather than producing output. */
export function isInstallCommand(command: string): boolean {
  return (
    /\b(?:pip|pip3|uv|poetry|conda)\b[^\n]*\binstall\b/i.test(command) ||
    /\bnpm\s+(?:i|install|ci)\b/i.test(command) ||
    /\b(?:apt-get|apt|brew)\s+install\b/i.test(command)
  );
}

/**
 * Detect the office format a bash command is producing, if any. Used both to
 * advance the phase to "generating" and to label the activity line. Returns the
 * uppercased format token (DOCX/PPTX/XLSX/PDF) or null. Install commands that
 * merely mention a library (e.g. `pip install python-docx`) are not generation.
 */
export function detectGenerationFormat(command: string): 'DOCX' | 'PPTX' | 'XLSX' | 'PDF' | null {
  if (isInstallCommand(command)) {
    return null;
  }
  const redirect = command.match(/(?:-o|--output|>)\s*['"]?\S*?\.(docx|pptx|xlsx|pdf)\b/i);
  if (redirect) {
    return redirect[1].toUpperCase() as 'DOCX' | 'PPTX' | 'XLSX' | 'PDF';
  }
  if (/\bpython/i.test(command)) {
    if (/\b(?:pptx|python-pptx)\b/i.test(command)) return 'PPTX';
    if (/\b(?:docx|python-docx)\b/i.test(command)) return 'DOCX';
    if (/\b(?:openpyxl|xlsxwriter)\b/i.test(command)) return 'XLSX';
    if (/\b(?:fpdf|reportlab)\b/i.test(command)) return 'PDF';
  }
  return null;
}

/** Whether a bash command is producing an office deliverable. */
export function isGenerationCommand(command: string): boolean {
  if (isInstallCommand(command)) {
    return false;
  }
  return (
    detectGenerationFormat(command) !== null || /\b(?:soffice|libreoffice|pandoc)\b/i.test(command)
  );
}

/**
 * Map a single trace step to the phase it represents, or null if it should not
 * influence the phase (e.g. an unrecognized tool result). Only feeds the running
 * max in {@link derivePhase} — never read in isolation.
 */
export function classifyStepPhase(step: TraceStepLike): OfficePhase | null {
  const tool = step.toolName?.trim().toLowerCase();
  if (tool) {
    if (tool === 'artifact') return 'generating';
    if (READ_TOOLS.has(tool)) return 'reading';
    if (WRITE_TOOLS.has(tool)) return 'generating';
    if (tool === 'bash') {
      const command = getStringField(step.toolInput, 'command');
      return command && isGenerationCommand(command) ? 'generating' : 'analyzing';
    }
    if (tool.startsWith('mcp__')) return 'analyzing';
    // A named-but-unrecognized tool result is a paired completion — ignore it to
    // avoid double counting. A tool call is active work → analyzing.
    return step.type === 'tool_result' ? null : 'analyzing';
  }
  if (step.type === 'thinking' || step.type === 'text') return 'analyzing';
  return null;
}

function highestReachedPhase(steps: readonly TraceStepLike[]): OfficePhase {
  let maxIndex = PHASE_INDEX.queued;
  for (const step of steps) {
    const phase = classifyStepPhase(step);
    if (phase !== null) {
      maxIndex = Math.max(maxIndex, PHASE_INDEX[phase]);
    }
  }
  // Traces can never reach "done"; only OfficeTaskStatus === 'completed' does.
  maxIndex = Math.min(maxIndex, PHASE_INDEX.generating);
  return OFFICE_PHASE_ORDER[maxIndex];
}

/**
 * Derive the progress shown in the stepper. Task status dominates: a completed
 * task is always done/100; error and cancelled freeze at the last reached phase
 * (never done, never 100). For a running task the phase is the running max of
 * its trace steps, so it can never visibly regress.
 */
export function derivePhase(
  status: OfficeTaskStatus,
  steps: readonly TraceStepLike[]
): OfficeProgress {
  if (status === 'completed') {
    return { phase: 'done', percent: 100, state: 'done' };
  }

  const reached = highestReachedPhase(steps);

  if (status === 'error') {
    return { phase: reached, percent: Math.min(PHASE_PERCENT[reached], 95), state: 'error' };
  }
  if (status === 'cancelled') {
    return { phase: reached, percent: Math.min(PHASE_PERCENT[reached], 95), state: 'cancelled' };
  }
  if (status === 'pending') {
    return { phase: 'queued', percent: 0, state: 'idle' };
  }

  // running
  if (steps.length === 0) {
    return { phase: 'queued', percent: 5, state: 'active' };
  }
  return { phase: reached, percent: PHASE_PERCENT[reached], state: 'active' };
}

/** Browser-safe lowercase file extension including the dot, or '' if none. */
function fileExtension(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

/**
 * Classify an output file into a coarse artifact type. Single source of truth —
 * `office-task-service.ts` imports this so the main process and renderer agree.
 */
export function classifyArtifact(fileName: string): OfficeArtifactType {
  switch (fileExtension(fileName)) {
    case '.doc':
    case '.docx':
      return 'document';
    case '.ppt':
    case '.pptx':
    case '.key':
      return 'presentation';
    case '.xls':
    case '.xlsx':
    case '.csv':
    case '.tsv':
      return 'spreadsheet';
    case '.pdf':
      return 'pdf';
    case '.md':
    case '.markdown':
      return 'markdown';
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.gif':
    case '.webp':
      return 'image';
    default:
      return 'other';
  }
}

const EXPECTED_PRIMARY_TYPE: Record<OfficeTaskTemplateId, OfficeArtifactType> = {
  file_summary: 'document',
  pdf_summary: 'document',
  spreadsheet_analysis: 'document',
  report_generation: 'document',
  deck_generation: 'presentation',
};

const EXPLICIT_ROLES: Partial<Record<OfficeTaskTemplateId, ReadonlySet<OfficeArtifactType>>> = {
  file_summary: new Set<OfficeArtifactType>(['document', 'markdown']),
  pdf_summary: new Set<OfficeArtifactType>(['document', 'markdown', 'pdf']),
  spreadsheet_analysis: new Set<OfficeArtifactType>(['document', 'markdown', 'spreadsheet']),
  report_generation: new Set<OfficeArtifactType>(['document', 'markdown']),
  deck_generation: new Set<OfficeArtifactType>(['presentation', 'markdown', 'document']),
};

/** i18n key for the role noun of an artifact under a given template. */
export function resolveArtifactRoleKey(
  templateId: OfficeTaskTemplateId,
  type: OfficeArtifactType
): string {
  const explicit = EXPLICIT_ROLES[templateId]?.has(type);
  return explicit
    ? `office.artifactRoles.${templateId}.${type}`
    : `office.artifactRoles.generic.${type}`;
}

/** i18n key for the short format tag shown beside the role, e.g. (DOCX). */
export function resolveArtifactFormatKey(fileName: string): string {
  return `office.artifactFormats.${artifactFormatTag(fileName)}`;
}

function artifactFormatTag(fileName: string): string {
  switch (fileExtension(fileName)) {
    case '.docx':
    case '.doc':
      return 'docx';
    case '.md':
    case '.markdown':
      return 'md';
    case '.pdf':
      return 'pdf';
    case '.xlsx':
    case '.xls':
      return 'xlsx';
    case '.csv':
    case '.tsv':
      return 'csv';
    case '.pptx':
    case '.ppt':
      return 'pptx';
    default:
      return 'other';
  }
}

export interface ArtifactDescription {
  roleKey: string;
  formatKey: string;
}

export function describeArtifact(
  artifact: Pick<OfficeArtifact, 'name' | 'type'>,
  templateId: OfficeTaskTemplateId
): ArtifactDescription {
  return {
    roleKey: resolveArtifactRoleKey(templateId, artifact.type),
    formatKey: resolveArtifactFormatKey(artifact.name),
  };
}

type PrimaryCandidate = Pick<OfficeArtifact, 'id' | 'type' | 'size' | 'createdAt' | 'path'>;

function tieBreakArtifacts(a: PrimaryCandidate, b: PrimaryCandidate): number {
  if (b.size !== a.size) return b.size - a.size;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  if (a.path < b.path) return -1;
  if (a.path > b.path) return 1;
  return 0;
}

/**
 * Pick the single headline deliverable from a task's artifacts. Computed over
 * the whole list (never per-artifact) so exactly one is primary: the expected
 * office format wins, then a markdown fallback, then the most specific produced
 * file, with a deterministic tie-break. Returns the artifact id, or null when
 * there are no artifacts.
 */
export function pickPrimaryArtifactId(
  templateId: OfficeTaskTemplateId,
  artifacts: readonly PrimaryCandidate[]
): string | null {
  if (artifacts.length === 0) {
    return null;
  }
  const expected = EXPECTED_PRIMARY_TYPE[templateId];
  let pool = artifacts.filter((artifact) => artifact.type === expected);
  if (pool.length === 0) {
    pool = artifacts.filter((artifact) => artifact.type === 'markdown');
  }
  if (pool.length === 0) {
    pool = artifacts.filter((artifact) => artifact.type !== 'other');
  }
  if (pool.length === 0) {
    pool = artifacts.slice();
  }
  return [...pool].sort(tieBreakArtifacts)[0].id;
}

export type ResultSummary =
  | { kind: 'status'; key: string }
  | { kind: 'produced'; fileCount: number; inputCount: number; primaryRoleKey: string };

/**
 * Build the one-line "what was produced" summary from the persisted artifacts
 * (never a trace-derived list). The component resolves the keys/plurals via
 * i18next; this stays pure and testable.
 */
export function buildResultSummary(
  status: OfficeTaskStatus,
  inputCount: number,
  artifacts: readonly OfficeArtifact[],
  templateId: OfficeTaskTemplateId
): ResultSummary {
  if (status === 'pending' || status === 'running') {
    return { kind: 'status', key: 'office.resultSummary.running' };
  }
  if (status === 'cancelled') {
    return { kind: 'status', key: 'office.resultSummary.cancelled' };
  }
  if (artifacts.length === 0) {
    return {
      kind: 'status',
      key:
        status === 'error' ? 'office.resultSummary.error' : 'office.resultSummary.emptyCompleted',
    };
  }
  const primaryId = pickPrimaryArtifactId(templateId, artifacts);
  const primary = artifacts.find((artifact) => artifact.id === primaryId) ?? artifacts[0];
  return {
    kind: 'produced',
    fileCount: artifacts.length,
    inputCount,
    primaryRoleKey: resolveArtifactRoleKey(templateId, primary.type),
  };
}
