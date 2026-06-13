import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import createI18n from 'i18next';
import {
  buildResultSummary,
  classifyArtifact,
  describeArtifact,
  derivePhase,
  detectGenerationFormat,
  isGenerationCommand,
  pickPrimaryArtifactId,
  type TraceStepLike,
} from '../../shared/office-task-progress';
import type { OfficeArtifact } from '../../shared/office-tasks';
import enTranslations from '../../renderer/i18n/locales/en.json';
import zhTranslations from '../../renderer/i18n/locales/zh.json';

function step(overrides: Partial<TraceStepLike>): TraceStepLike {
  return { type: 'tool_call', status: 'completed', ...overrides };
}

function artifact(overrides: Partial<OfficeArtifact>): OfficeArtifact {
  return {
    id: 'a',
    taskId: 't',
    path: '/out/a',
    name: 'a.docx',
    type: 'document',
    size: 100,
    createdAt: 1000,
    ...overrides,
  };
}

describe('derivePhase', () => {
  it('is monotonic — a re-read after a write does not regress the phase', () => {
    const steps = [
      step({ toolName: 'read' }),
      step({ toolName: 'write' }),
      step({ toolName: 'read' }),
    ];
    expect(derivePhase('running', steps)).toEqual({
      phase: 'generating',
      percent: 90,
      state: 'active',
    });
  });

  it('returns queued/5 for a running task with no trace yet', () => {
    expect(derivePhase('running', [])).toEqual({ phase: 'queued', percent: 5, state: 'active' });
  });

  it('returns queued/0 for a pending task', () => {
    expect(derivePhase('pending', [])).toEqual({ phase: 'queued', percent: 0, state: 'idle' });
  });

  it('detects generation from bash commands (the two file-producing templates)', () => {
    const gen = step({
      toolName: 'bash',
      toolInput: { command: 'soffice --convert-to pptx deck' },
    });
    expect(derivePhase('running', [gen])).toMatchObject({ phase: 'generating', percent: 90 });

    const genRedirect = step({
      toolName: 'bash',
      toolInput: { command: 'python build.py -o out.xlsx' },
    });
    expect(derivePhase('running', [genRedirect])).toMatchObject({ phase: 'generating' });

    const plain = step({ toolName: 'bash', toolInput: { command: 'cat report.txt' } });
    expect(derivePhase('running', [plain])).toMatchObject({ phase: 'analyzing', percent: 60 });
  });

  it('lets status dominate — completed is always done/100 even if trace only reached reading', () => {
    expect(derivePhase('completed', [step({ toolName: 'read' })])).toEqual({
      phase: 'done',
      percent: 100,
      state: 'done',
    });
  });

  it('freezes error/cancelled at the reached phase, never done, never 100', () => {
    const afterWrite = [step({ toolName: 'write' })];
    expect(derivePhase('error', afterWrite)).toEqual({
      phase: 'generating',
      percent: 90,
      state: 'error',
    });
    expect(derivePhase('cancelled', [step({ toolName: 'read' })])).toEqual({
      phase: 'reading',
      percent: 30,
      state: 'cancelled',
    });
    expect(derivePhase('error', [])).toEqual({ phase: 'queued', percent: 5, state: 'error' });
  });

  it('advances the synthetic artifact step to generating but never to done while running', () => {
    const artifactStep = step({ type: 'tool_result', toolName: 'artifact' });
    expect(derivePhase('running', [artifactStep])).toEqual({
      phase: 'generating',
      percent: 90,
      state: 'active',
    });
  });
});

describe('generation command detection', () => {
  it('detects the produced format', () => {
    expect(detectGenerationFormat('python -c "from pptx import Presentation"')).toBe('PPTX');
    expect(detectGenerationFormat('python make.py --output report.docx')).toBe('DOCX');
    expect(detectGenerationFormat('node build.js > out.pdf')).toBe('PDF');
    expect(detectGenerationFormat('cat notes.md')).toBeNull();
  });

  it('treats office converters as generation', () => {
    expect(isGenerationCommand('libreoffice --headless --convert-to docx in.md')).toBe(true);
    expect(isGenerationCommand('ls -la')).toBe(false);
  });
});

describe('classifyArtifact', () => {
  it('maps extensions to coarse types without node:path', () => {
    expect(classifyArtifact('summary.docx')).toBe('document');
    expect(classifyArtifact('deck.pptx')).toBe('presentation');
    expect(classifyArtifact('data.xlsx')).toBe('spreadsheet');
    expect(classifyArtifact('notes.md')).toBe('markdown');
    expect(classifyArtifact('scan.pdf')).toBe('pdf');
    expect(classifyArtifact('chart.png')).toBe('image');
    expect(classifyArtifact('archive.zip')).toBe('other');
    expect(classifyArtifact('.env')).toBe('other');
  });
});

describe('pickPrimaryArtifactId', () => {
  it('prefers the expected office format over a markdown fallback', () => {
    const docx = artifact({ id: 'docx', type: 'document', name: 'r.docx' });
    const md = artifact({ id: 'md', type: 'markdown', name: 'r.md' });
    expect(pickPrimaryArtifactId('pdf_summary', [md, docx])).toBe('docx');
  });

  it('falls back to markdown when the expected type is absent', () => {
    const md = artifact({ id: 'md', type: 'markdown', name: 'r.md' });
    expect(pickPrimaryArtifactId('file_summary', [md])).toBe('md');
  });

  it('tie-breaks deterministically by size, then createdAt, then path', () => {
    const big = artifact({ id: 'big', type: 'document', size: 500, createdAt: 50, path: '/z' });
    const small = artifact({ id: 'small', type: 'document', size: 100, createdAt: 10, path: '/a' });
    expect(pickPrimaryArtifactId('report_generation', [small, big])).toBe('big');

    const older = artifact({ id: 'older', type: 'document', size: 100, createdAt: 10, path: '/b' });
    const newer = artifact({ id: 'newer', type: 'document', size: 100, createdAt: 90, path: '/a' });
    expect(pickPrimaryArtifactId('report_generation', [newer, older])).toBe('older');
  });

  it('handles all-other artifacts without throwing', () => {
    const o1 = artifact({ id: 'o1', type: 'other', size: 10, path: '/a' });
    const o2 = artifact({ id: 'o2', type: 'other', size: 20, path: '/b' });
    expect(pickPrimaryArtifactId('file_summary', [o1, o2])).toBe('o2');
  });

  it('returns null for an empty artifact list', () => {
    expect(pickPrimaryArtifactId('file_summary', [])).toBeNull();
  });
});

describe('describeArtifact', () => {
  it('uses the template-specific role and the format tag', () => {
    expect(describeArtifact({ name: 'r.docx', type: 'document' }, 'pdf_summary')).toEqual({
      roleKey: 'office.artifactRoles.pdf_summary.document',
      formatKey: 'office.artifactFormats.docx',
    });
  });

  it('falls back to the generic role for unenumerated combinations', () => {
    expect(describeArtifact({ name: 'x.csv', type: 'spreadsheet' }, 'file_summary')).toEqual({
      roleKey: 'office.artifactRoles.generic.spreadsheet',
      formatKey: 'office.artifactFormats.csv',
    });
  });
});

describe('buildResultSummary', () => {
  it('reports status before producing files', () => {
    expect(buildResultSummary('running', 2, [], 'pdf_summary')).toEqual({
      kind: 'status',
      key: 'office.resultSummary.running',
    });
    expect(buildResultSummary('cancelled', 2, [], 'pdf_summary')).toEqual({
      kind: 'status',
      key: 'office.resultSummary.cancelled',
    });
    expect(buildResultSummary('error', 2, [], 'pdf_summary')).toEqual({
      kind: 'status',
      key: 'office.resultSummary.error',
    });
    expect(buildResultSummary('completed', 2, [], 'pdf_summary')).toEqual({
      kind: 'status',
      key: 'office.resultSummary.emptyCompleted',
    });
  });

  it('describes what was produced when artifacts exist', () => {
    const docx = artifact({ id: 'docx', type: 'document', name: 'r.docx' });
    const md = artifact({ id: 'md', type: 'markdown', name: 'r.md' });
    expect(buildResultSummary('completed', 3, [docx, md], 'pdf_summary')).toEqual({
      kind: 'produced',
      fileCount: 2,
      inputCount: 3,
      primaryRoleKey: 'office.artifactRoles.pdf_summary.document',
    });
  });
});

describe('result summary i18n plurals', () => {
  const i18n = createI18n.createInstance();
  i18n.init({
    lng: 'en',
    resources: {
      en: { translation: enTranslations },
      zh: { translation: zhTranslations },
    },
    pluralSeparator: '_',
    contextSeparator: '_',
    interpolation: { escapeValue: false },
  });

  function line(lng: 'en' | 'zh', fileCount: number, role: string, inputCount: number): string {
    const t = i18n.getFixedT(lng);
    const deliverable =
      fileCount === 1
        ? t('office.resultSummary.deliverableSingle', { role: t(role) })
        : t('office.resultSummary.deliverableMany', { count: fileCount });
    const inputs = t('office.resultSummary.fromInputs', { count: inputCount });
    return t('office.resultSummary.line', { deliverable, inputs });
  }

  it('renders the single-file role and English plural inputs', () => {
    const t = i18n.getFixedT('en');
    expect(t('office.resultSummary.deliverableSingle', { role: 'Summary' })).toBe('1 Summary');
    expect(t('office.resultSummary.deliverableMany', { count: 2 })).toBe('2 files');
    expect(t('office.resultSummary.fromInputs', { count: 1 })).toBe('from 1 file');
    expect(line('en', 1, 'office.artifactRoles.pdf_summary.document', 2)).toBe(
      '1 Executive summary from 2 files'
    );
    expect(line('en', 2, 'office.artifactRoles.pdf_summary.document', 3)).toBe(
      '2 files from 3 files'
    );
  });

  it('keeps the role noun in Chinese, where plurals have one form', () => {
    const t = i18n.getFixedT('zh');
    // The bug guard: a plain i18next `_one`/`_other` split would drop 摘要 here.
    expect(t('office.resultSummary.deliverableSingle', { role: '摘要' })).toBe('1 个摘要');
    expect(t('office.resultSummary.deliverableMany', { count: 2 })).toBe('2 个文件');
    expect(line('zh', 1, 'office.artifactRoles.pdf_summary.document', 2)).toBe(
      '1 个执行摘要（来自 2 个文件）'
    );
  });
});

describe('layering', () => {
  it('shared progress util imports no renderer-only dependency', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/shared/office-task-progress.ts'),
      'utf-8'
    );
    expect(source).not.toMatch(/from ['"]react/);
    expect(source).not.toMatch(/from ['"][^'"]*i18next/);
    expect(source).not.toMatch(/from ['"]node:path/);
  });
});
