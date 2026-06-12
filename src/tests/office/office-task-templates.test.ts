import { describe, expect, it } from 'vitest';
import { OFFICE_TASK_TEMPLATES } from '../../shared/office-tasks';
import {
  buildOfficeTaskPrompt,
  validateOfficeTaskStartInput,
} from '../../main/office/office-task-templates';

describe('office task templates', () => {
  it('builds prompts with inputs, output directory, and deliverables for every template', () => {
    for (const template of OFFICE_TASK_TEMPLATES) {
      const prompt = buildOfficeTaskPrompt({
        taskId: 'task-1',
        templateId: template.id,
        title: 'Quarterly review',
        cwd: '/workspace',
        inputPaths: ['/source/a.pdf', '/source/b.xlsx'],
        outputDir: '/workspace/.cowork-office/tasks/task-1/outputs',
        options: {
          outputFormat: 'docx',
          language: 'zh',
          detailLevel: 'deep',
          audience: 'executive team',
        },
      });

      expect(prompt).toContain('Quarterly review');
      expect(prompt).toContain('/source/a.pdf');
      expect(prompt).toContain('/source/b.xlsx');
      expect(prompt).toContain('/workspace/.cowork-office/tasks/task-1/outputs');
      expect(prompt).toContain('Expected deliverables');
      expect(prompt).toContain('Write all generated deliverables');
      expect(prompt).toContain('Output format: DOCX');
      expect(prompt).toContain('Language: Chinese');
      expect(prompt).toContain('Detail level: Deep analysis');
      expect(prompt).toContain('executive team');
    }
  });

  it('rejects missing cwd and missing input files', () => {
    expect(
      validateOfficeTaskStartInput({
        templateId: 'file_summary',
        cwd: '',
        inputPaths: ['/tmp/input.pdf'],
      })
    ).toBe('A working folder is required');

    expect(
      validateOfficeTaskStartInput({
        templateId: 'file_summary',
        cwd: '/tmp/work',
        inputPaths: [],
      })
    ).toBe('Select at least one input file');
  });

  it('rejects relative paths', () => {
    expect(
      validateOfficeTaskStartInput({
        templateId: 'file_summary',
        cwd: 'relative-workspace',
        inputPaths: ['/tmp/input.pdf'],
      })
    ).toBe('Working folder must be an absolute path');

    expect(
      validateOfficeTaskStartInput({
        templateId: 'file_summary',
        cwd: '/tmp/work',
        inputPaths: ['relative.pdf'],
      })
    ).toBe('Input file paths must be absolute');
  });

  it('rejects files that do not match strict office templates', () => {
    expect(
      validateOfficeTaskStartInput({
        templateId: 'pdf_summary',
        cwd: '/tmp/work',
        inputPaths: ['/tmp/input.docx'],
      })
    ).toBe('PDF summary tasks only accept PDF input files');

    expect(
      validateOfficeTaskStartInput({
        templateId: 'spreadsheet_analysis',
        cwd: '/tmp/work',
        inputPaths: ['/tmp/input.pdf'],
      })
    ).toBe('Spreadsheet analysis tasks only accept Excel, CSV, or TSV input files');
  });
});
