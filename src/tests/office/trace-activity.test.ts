import { describe, expect, it } from 'vitest';
import { describeTraceStep } from '../../renderer/utils/trace-activity';
import type { TraceStep } from '../../renderer/types';

function step(overrides: Partial<TraceStep>): TraceStep {
  return {
    id: 's1',
    type: 'tool_call',
    status: 'completed',
    title: '',
    timestamp: 0,
    ...overrides,
  };
}

describe('describeTraceStep', () => {
  it('maps file tools to named activities', () => {
    expect(
      describeTraceStep(step({ toolName: 'read', toolInput: { path: '/src/report.pdf' } }))
    ).toEqual({ key: 'office.activity.reading', params: { name: 'report.pdf' } });
    expect(
      describeTraceStep(step({ toolName: 'write', toolInput: { path: '/out/summary.docx' } }))
    ).toEqual({ key: 'office.activity.writing', params: { name: 'summary.docx' } });
    expect(
      describeTraceStep(step({ toolName: 'edit', toolInput: { file_path: '/out/summary.docx' } }))
    ).toEqual({ key: 'office.activity.editing', params: { name: 'summary.docx' } });
  });

  it('handles read/write/edit alias families', () => {
    for (const toolName of ['Read', 'read_file']) {
      expect(describeTraceStep(step({ toolName, toolInput: { path: '/a/b.pdf' } }))).toEqual({
        key: 'office.activity.reading',
        params: { name: 'b.pdf' },
      });
    }
    for (const toolName of ['Write', 'write_file']) {
      expect(describeTraceStep(step({ toolName, toolInput: { path: '/a/b.docx' } }))).toEqual({
        key: 'office.activity.writing',
        params: { name: 'b.docx' },
      });
    }
    for (const toolName of ['Edit', 'edit_file', 'multiedit', 'NotebookEdit']) {
      expect(describeTraceStep(step({ toolName, toolInput: { path: '/a/b.docx' } }))).toEqual({
        key: 'office.activity.editing',
        params: { name: 'b.docx' },
      });
    }
  });

  it('falls back to a name-free key when no path is available', () => {
    expect(describeTraceStep(step({ toolName: 'read', toolInput: {} }))).toEqual({
      key: 'office.activity.readingGeneric',
    });
    expect(describeTraceStep(step({ toolName: 'read' }))).toEqual({
      key: 'office.activity.readingGeneric',
    });
  });

  it('does not throw on non-string tool inputs', () => {
    expect(() =>
      describeTraceStep(step({ toolName: 'read', toolInput: { path: 123 as unknown as string } }))
    ).not.toThrow();
    expect(
      describeTraceStep(step({ toolName: 'read', toolInput: { path: 42 as unknown } }))
    ).toEqual({
      key: 'office.activity.readingGeneric',
    });
  });

  it('classifies bash by intent and never leaks the raw command', () => {
    const cases: Array<[string, string]> = [
      ['python gen.py -o slides.pptx', 'office.activity.generatingFile'],
      ['soffice --convert-to pptx deck', 'office.activity.converting'],
      ['libreoffice --headless --convert-to docx in.md', 'office.activity.converting'],
      ['pip install python-docx', 'office.activity.installingDeps'],
      ['python build_report.py', 'office.activity.runningScript'],
      ['mv a b && rm c', 'office.activity.runningCommand'],
    ];
    for (const [command, key] of cases) {
      const result = describeTraceStep(step({ toolName: 'bash', toolInput: { command } }));
      expect(result?.key).toBe(key);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(command);
    }
  });

  it('passes the produced format for generation commands', () => {
    expect(
      describeTraceStep(
        step({ toolName: 'bash', toolInput: { command: 'python -m build -o out.xlsx' } })
      )
    ).toEqual({ key: 'office.activity.generatingFile', params: { format: 'XLSX' } });
  });

  it('strips the mcp prefix to a readable tool name', () => {
    expect(describeTraceStep(step({ toolName: 'mcp__Chrome__navigate' }))).toEqual({
      key: 'office.activity.usingTool',
      params: { tool: 'navigate' },
    });
  });

  it('maps thinking to analysis and skips assistant text', () => {
    expect(describeTraceStep(step({ type: 'thinking' }))).toEqual({
      key: 'office.activity.thinking',
    });
    expect(describeTraceStep(step({ type: 'text' }))).toBeNull();
  });

  it('never renders a raw or unknown tool name', () => {
    expect(describeTraceStep(step({ toolName: 'unknown' }))).toEqual({
      key: 'office.activity.working',
    });
    expect(describeTraceStep(step({ type: 'tool_call' }))).toEqual({
      key: 'office.activity.working',
    });
    expect(describeTraceStep(step({ toolName: 'some_new_tool' }))).toEqual({
      key: 'office.activity.working',
    });
  });

  it('maps search/find/list and produced artifacts', () => {
    expect(
      describeTraceStep(step({ toolName: 'grep', toolInput: { pattern: 'revenue' } }))
    ).toEqual({
      key: 'office.activity.searching',
      params: { query: 'revenue' },
    });
    expect(describeTraceStep(step({ toolName: 'find' }))).toEqual({
      key: 'office.activity.finding',
    });
    expect(describeTraceStep(step({ toolName: 'ls' }))).toEqual({
      key: 'office.activity.listing',
    });
    expect(
      describeTraceStep(
        step({ type: 'tool_result', toolName: 'artifact', toolInput: { path: '/out/deck.pptx' } })
      )
    ).toEqual({ key: 'office.activity.producedArtifact', params: { name: 'deck.pptx' } });
  });
});
