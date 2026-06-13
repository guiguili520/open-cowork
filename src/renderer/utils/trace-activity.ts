import type { TraceStep } from '../types';
import { detectGenerationFormat, isInstallCommand } from '../../shared/office-task-progress';
import { getArtifactLabel } from './artifact-steps';
import { extractFilePathFromToolInput } from './tool-output-path';

/**
 * Translate a raw trace step into a friendly, user-facing activity for the
 * Office progress panel. Returns an i18n key + params (never a translated
 * string) so the component owns localization, or null when the step should not
 * be shown as an activity (assistant prose already streams into the message
 * pane). The raw tool command is never surfaced.
 */
export interface TraceActivity {
  key: string;
  params?: Record<string, string>;
}

const READ_TOOLS = new Set(['read', 'read_file']);
const WRITE_TOOLS = new Set(['write', 'write_file']);
const EDIT_TOOLS = new Set(['edit', 'edit_file', 'multiedit', 'notebookedit', 'notebook_edit']);

function getStringField(input: Record<string, unknown> | undefined, key: string): string | null {
  const value = input?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Build a `{ key, params }` for a file activity. Falls back to a name-free
 * "Generic" key variant when no path can be extracted, so the rendered string
 * never leaks an unfilled `{{name}}` placeholder.
 */
function fileActivity(base: string, step: TraceStep): TraceActivity {
  const filePath = extractFilePathFromToolInput(step.toolInput);
  const name = filePath ? getArtifactLabel(filePath) : '';
  return name
    ? { key: `office.activity.${base}`, params: { name } }
    : { key: `office.activity.${base}Generic` };
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function describeBash(step: TraceStep): TraceActivity {
  const command = getStringField(step.toolInput, 'command');
  if (!command) {
    return { key: 'office.activity.runningCommand' };
  }
  // Install must be checked before generation: `pip install python-docx` mentions
  // a library but produces nothing.
  if (isInstallCommand(command)) {
    return { key: 'office.activity.installingDeps' };
  }
  const format = detectGenerationFormat(command);
  if (format) {
    return { key: 'office.activity.generatingFile', params: { format } };
  }
  if (/\b(?:soffice|libreoffice|pandoc|markitdown)\b|--convert-to/i.test(command)) {
    return { key: 'office.activity.converting' };
  }
  if (/\b(?:python3?|node|tsx|deno|bash|sh)\b|(?:^|\s)\.\/|\.(?:py|sh|js|ts)\b/i.test(command)) {
    return { key: 'office.activity.runningScript' };
  }
  return { key: 'office.activity.runningCommand' };
}

function mcpToolName(toolName: string): string {
  const match = toolName.match(/^mcp__(?:.+?)__(.+)$/);
  return match ? match[1] : toolName;
}

export function describeTraceStep(step: TraceStep): TraceActivity | null {
  if (step.type === 'text') {
    return null;
  }
  if (step.type === 'thinking') {
    return { key: 'office.activity.thinking' };
  }

  const raw = step.toolName?.trim();
  const tool = raw?.toLowerCase();
  if (!tool || tool === 'unknown') {
    return { key: 'office.activity.working' };
  }

  if (tool === 'artifact') {
    return fileActivity('producedArtifact', step);
  }
  if (READ_TOOLS.has(tool)) {
    return fileActivity('reading', step);
  }
  if (WRITE_TOOLS.has(tool)) {
    return fileActivity('writing', step);
  }
  if (EDIT_TOOLS.has(tool)) {
    return fileActivity('editing', step);
  }
  if (tool === 'grep') {
    const pattern = getStringField(step.toolInput, 'pattern');
    return pattern
      ? { key: 'office.activity.searching', params: { query: truncate(pattern, 40) } }
      : { key: 'office.activity.searchingGeneric' };
  }
  if (tool === 'find' || tool === 'glob') {
    return { key: 'office.activity.finding' };
  }
  if (tool === 'ls' || tool === 'list_dir') {
    return { key: 'office.activity.listing' };
  }
  if (tool === 'bash') {
    return describeBash(step);
  }
  if (tool === 'webfetch' || tool === 'websearch') {
    return { key: 'office.activity.browsing' };
  }
  if (tool === 'todo' || tool === 'todowrite' || tool === 'todo_write') {
    return { key: 'office.activity.planning' };
  }
  if (tool.startsWith('mcp__') && raw) {
    return { key: 'office.activity.usingTool', params: { tool: mcpToolName(raw) } };
  }
  return { key: 'office.activity.working' };
}
