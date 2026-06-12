import path from 'node:path';
import {
  DEFAULT_OFFICE_TASK_OPTIONS,
  getOfficeTaskTemplate,
  type OfficeTaskOptions,
  type OfficeTaskStartInput,
  type OfficeTaskTemplateId,
} from '../../shared/office-tasks';

export interface BuildOfficeTaskPromptInput {
  taskId: string;
  templateId: OfficeTaskTemplateId;
  title: string;
  cwd: string;
  inputPaths: string[];
  outputDir: string;
  options?: Partial<OfficeTaskOptions>;
}

interface TemplatePromptSpec {
  objective: string;
  steps: string[];
  outputs: string[];
}

const TEMPLATE_PROMPTS: Record<OfficeTaskTemplateId, TemplatePromptSpec> = {
  file_summary: {
    objective: 'Summarize the selected files for a business audience.',
    steps: [
      'Read every attached file before writing the final deliverable.',
      'Extract key facts, decisions, risks, open questions, and suggested next actions.',
      'Prefer a concise Markdown summary; create a DOCX version when the content is substantial.',
    ],
    outputs: ['summary.md', 'summary.docx when appropriate'],
  },
  pdf_summary: {
    objective: 'Create a structured executive summary from the selected PDF files.',
    steps: [
      'Read all selected PDFs and preserve important numbers, dates, names, and source references.',
      'Group the summary into overview, key points, risks, and recommended follow-ups.',
      'Create a polished DOCX report unless the PDFs are too small, in which case Markdown is acceptable.',
    ],
    outputs: ['pdf-summary.docx', 'pdf-summary.md as a fallback'],
  },
  spreadsheet_analysis: {
    objective: 'Analyze the selected spreadsheet or CSV data and explain the business signal.',
    steps: [
      'Inspect workbook sheets, columns, formulas, and obvious data quality issues.',
      'Calculate meaningful totals, trends, outliers, and comparisons from the data.',
      'Write a concise analysis report and create a derived XLSX only when useful.',
    ],
    outputs: [
      'spreadsheet-analysis.docx or spreadsheet-analysis.md',
      'analysis-output.xlsx when useful',
    ],
  },
  report_generation: {
    objective: 'Generate a professional business report or weekly report from the selected files.',
    steps: [
      'Read all source files and organize the report around the strongest business narrative.',
      'Include an executive summary, supporting detail, risks, and next steps.',
      'Create a DOCX report with clear section headings.',
    ],
    outputs: ['business-report.docx'],
  },
  deck_generation: {
    objective: 'Generate a presentation deck from the selected files.',
    steps: [
      'Read all source files and identify a clear slide narrative.',
      'Create a concise PPTX deck suitable for a business review.',
      'Use 5 to 8 slides unless the source material clearly requires a different length.',
    ],
    outputs: ['presentation-deck.pptx'],
  },
};

export function validateOfficeTaskStartInput(input: OfficeTaskStartInput): string | null {
  if (!getOfficeTaskTemplate(input.templateId)) {
    return 'Unknown office task template';
  }
  if (!input.cwd.trim()) {
    return 'A working folder is required';
  }
  if (!path.isAbsolute(input.cwd)) {
    return 'Working folder must be an absolute path';
  }
  if (input.inputPaths.length === 0) {
    return 'Select at least one input file';
  }
  for (const inputPath of input.inputPaths) {
    if (!inputPath.trim()) {
      return 'Input file path cannot be empty';
    }
    if (!path.isAbsolute(inputPath)) {
      return 'Input file paths must be absolute';
    }
  }
  const templateError = validateTemplateFileTypes(input.templateId, input.inputPaths);
  if (templateError) {
    return templateError;
  }
  return null;
}

export function buildOfficeTaskPrompt(input: BuildOfficeTaskPromptInput): string {
  const spec = TEMPLATE_PROMPTS[input.templateId];
  const options = normalizeOfficeTaskOptions(input.options);
  const inputList = input.inputPaths
    .map((filePath, index) => `${index + 1}. ${filePath}`)
    .join('\n');
  const stepList = spec.steps.map((step) => `- ${step}`).join('\n');
  const outputList = buildExpectedOutputs(spec.outputs, options.outputFormat);
  const optionList = [
    `- Output format: ${formatOutputFormat(options.outputFormat)}`,
    `- Language: ${formatLanguage(options.language)}`,
    `- Detail level: ${formatDetailLevel(options.detailLevel)}`,
    `- Audience: ${options.audience.trim() || 'business audience'}`,
  ].join('\n');

  return [
    `Office task: ${input.title}`,
    `Task ID: ${input.taskId}`,
    '',
    `Objective: ${spec.objective}`,
    '',
    'Input files:',
    inputList,
    '',
    `Output directory: ${input.outputDir}`,
    '',
    'Task options:',
    optionList,
    '',
    'Instructions:',
    stepList,
    '- Write all generated deliverables into the output directory above.',
    '- Do not overwrite input files.',
    '- If the requested output format conflicts with the template, still create the closest useful deliverable and explain the fallback.',
    '- Use the requested language, detail level, and audience when writing the deliverable.',
    '- When you finish, include a short summary and list each generated artifact path.',
    '',
    'Expected deliverables:',
    outputList.join('\n'),
    '',
    'Use the attached files copied into the workspace .tmp directory when available. If a copied attachment path is listed later in this prompt, prefer that path for reading.',
  ].join('\n');
}

export function normalizeOfficeTaskOptions(
  options: Partial<OfficeTaskOptions> | undefined
): OfficeTaskOptions {
  return {
    ...DEFAULT_OFFICE_TASK_OPTIONS,
    ...options,
    audience: options?.audience?.trim() ?? DEFAULT_OFFICE_TASK_OPTIONS.audience,
  };
}

function validateTemplateFileTypes(
  templateId: OfficeTaskTemplateId,
  inputPaths: string[]
): string | null {
  if (templateId === 'pdf_summary' && !inputPaths.every(hasExtension(['.pdf']))) {
    return 'PDF summary tasks only accept PDF input files';
  }
  if (
    templateId === 'spreadsheet_analysis' &&
    !inputPaths.every(hasExtension(['.xls', '.xlsx', '.csv', '.tsv']))
  ) {
    return 'Spreadsheet analysis tasks only accept Excel, CSV, or TSV input files';
  }
  return null;
}

function hasExtension(extensions: string[]): (filePath: string) => boolean {
  return (filePath) => extensions.includes(path.extname(filePath).toLowerCase());
}

function buildExpectedOutputs(outputs: string[], outputFormat: OfficeTaskOptions['outputFormat']) {
  if (outputFormat === 'auto') {
    return outputs.map((output) => `- ${output}`);
  }
  return [
    `- Primary deliverable in ${formatOutputFormat(outputFormat)} format`,
    ...outputs.map((output) => `- Template default fallback: ${output}`),
  ];
}

function formatOutputFormat(outputFormat: OfficeTaskOptions['outputFormat']): string {
  switch (outputFormat) {
    case 'markdown':
      return 'Markdown (.md)';
    case 'docx':
      return 'DOCX (.docx)';
    case 'pdf':
      return 'PDF (.pdf)';
    case 'xlsx':
      return 'Excel workbook (.xlsx)';
    case 'pptx':
      return 'PowerPoint deck (.pptx)';
    case 'auto':
      return 'Auto, choose the best format for the template';
  }
}

function formatLanguage(language: OfficeTaskOptions['language']): string {
  switch (language) {
    case 'zh':
      return 'Chinese';
    case 'en':
      return 'English';
    case 'auto':
      return 'Auto, match the source material or user locale';
  }
}

function formatDetailLevel(detailLevel: OfficeTaskOptions['detailLevel']): string {
  switch (detailLevel) {
    case 'brief':
      return 'Brief';
    case 'standard':
      return 'Standard';
    case 'deep':
      return 'Deep analysis';
  }
}
