export type OfficeTaskTemplateId =
  | 'file_summary'
  | 'pdf_summary'
  | 'spreadsheet_analysis'
  | 'report_generation'
  | 'deck_generation';

export type OfficeTaskStatus = 'pending' | 'running' | 'completed' | 'error' | 'cancelled';

export type OfficeTaskSourceType = 'local' | 'feishu' | 'slack' | 'api';

export type OfficeArtifactType =
  | 'document'
  | 'presentation'
  | 'spreadsheet'
  | 'pdf'
  | 'markdown'
  | 'image'
  | 'other';

export type OfficeTaskOutputFormat = 'auto' | 'markdown' | 'docx' | 'pdf' | 'xlsx' | 'pptx';

export type OfficeTaskLanguage = 'auto' | 'zh' | 'en';

export type OfficeTaskDetailLevel = 'brief' | 'standard' | 'deep';

export interface OfficeTaskOptions {
  outputFormat: OfficeTaskOutputFormat;
  language: OfficeTaskLanguage;
  detailLevel: OfficeTaskDetailLevel;
  audience: string;
}

export interface OfficeTaskTemplate {
  id: OfficeTaskTemplateId;
  titleKey: string;
  descriptionKey: string;
  icon: 'fileText' | 'pdf' | 'spreadsheet' | 'report' | 'deck';
  preferredOutput: string;
}

export interface OfficeTask {
  id: string;
  title: string;
  templateId: OfficeTaskTemplateId;
  status: OfficeTaskStatus;
  cwd: string;
  inputPaths: string[];
  outputDir: string;
  sessionId: string | null;
  sourceType: OfficeTaskSourceType;
  externalRef: string | null;
  options: OfficeTaskOptions;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface OfficeArtifact {
  id: string;
  taskId: string;
  path: string;
  name: string;
  type: OfficeArtifactType;
  size: number;
  createdAt: number;
}

export interface OfficeTaskWithArtifacts {
  task: OfficeTask;
  artifacts: OfficeArtifact[];
}

export interface OfficeArtifactPreview {
  artifact: OfficeArtifact;
  content: string;
  supported: boolean;
  truncated: boolean;
}

export interface OfficeTaskStartInput {
  templateId: OfficeTaskTemplateId;
  title?: string;
  cwd: string;
  inputPaths: string[];
  options?: Partial<OfficeTaskOptions>;
  sourceType?: OfficeTaskSourceType;
  externalRef?: string | null;
}

export interface OfficeArtifactRenameInput {
  taskId: string;
  artifactId: string;
  name: string;
}

export interface OfficeArtifactDeleteInput {
  taskId: string;
  artifactId: string;
}

export interface OfficeArtifactPreviewInput {
  taskId: string;
  artifactId: string;
}

export const DEFAULT_OFFICE_TASK_OPTIONS: OfficeTaskOptions = {
  outputFormat: 'auto',
  language: 'auto',
  detailLevel: 'standard',
  audience: '',
};

export const OFFICE_TASK_TEMPLATES: OfficeTaskTemplate[] = [
  {
    id: 'file_summary',
    titleKey: 'office.templates.file_summary.title',
    descriptionKey: 'office.templates.file_summary.description',
    icon: 'fileText',
    preferredOutput: 'Markdown or DOCX',
  },
  {
    id: 'pdf_summary',
    titleKey: 'office.templates.pdf_summary.title',
    descriptionKey: 'office.templates.pdf_summary.description',
    icon: 'pdf',
    preferredOutput: 'DOCX',
  },
  {
    id: 'spreadsheet_analysis',
    titleKey: 'office.templates.spreadsheet_analysis.title',
    descriptionKey: 'office.templates.spreadsheet_analysis.description',
    icon: 'spreadsheet',
    preferredOutput: 'DOCX and optional XLSX',
  },
  {
    id: 'report_generation',
    titleKey: 'office.templates.report_generation.title',
    descriptionKey: 'office.templates.report_generation.description',
    icon: 'report',
    preferredOutput: 'DOCX',
  },
  {
    id: 'deck_generation',
    titleKey: 'office.templates.deck_generation.title',
    descriptionKey: 'office.templates.deck_generation.description',
    icon: 'deck',
    preferredOutput: 'PPTX',
  },
];

export function getOfficeTaskTemplate(
  templateId: OfficeTaskTemplateId
): OfficeTaskTemplate | undefined {
  return OFFICE_TASK_TEMPLATES.find((template) => template.id === templateId);
}
