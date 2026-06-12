import { File, FolderOpen, Loader2, Presentation, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  OFFICE_TASK_TEMPLATES,
  type OfficeTaskOptions,
  type OfficeTaskTemplate,
  type OfficeTaskTemplateId,
} from '../../../shared/office-tasks';
import { EmptyLine, SectionLabel, TemplateButton } from './OfficeTaskPanels';

interface OfficeTaskComposerProps {
  selectedTemplateId: OfficeTaskTemplateId;
  selectedTemplate: OfficeTaskTemplate | undefined;
  title: string;
  workingDir: string | null;
  inputPaths: string[];
  options: OfficeTaskOptions;
  safetyConfirmed: boolean;
  isStarting: boolean;
  onSelectTemplate: (templateId: OfficeTaskTemplateId) => void;
  onTitleChange: (title: string) => void;
  onSelectWorkingDir: () => void;
  onSelectFiles: () => void;
  onRemoveFile: (filePath: string) => void;
  onOptionsChange: (options: OfficeTaskOptions) => void;
  onSafetyConfirmedChange: (confirmed: boolean) => void;
  onStartTask: () => void;
}

const OUTPUT_FORMATS: OfficeTaskOptions['outputFormat'][] = [
  'auto',
  'markdown',
  'docx',
  'pdf',
  'xlsx',
  'pptx',
];
const LANGUAGES: OfficeTaskOptions['language'][] = ['auto', 'zh', 'en'];
const DETAIL_LEVELS: OfficeTaskOptions['detailLevel'][] = ['brief', 'standard', 'deep'];

export function OfficeTaskComposer({
  selectedTemplateId,
  selectedTemplate,
  title,
  workingDir,
  inputPaths,
  options,
  safetyConfirmed,
  isStarting,
  onSelectTemplate,
  onTitleChange,
  onSelectWorkingDir,
  onSelectFiles,
  onRemoveFile,
  onOptionsChange,
  onSafetyConfirmedChange,
  onStartTask,
}: OfficeTaskComposerProps) {
  const { t } = useTranslation();

  return (
    <section className="border-b lg:border-b-0 lg:border-r border-border-muted overflow-visible lg:overflow-y-auto px-5 py-5 space-y-5">
      <div className="space-y-2">
        <SectionLabel>{t('office.template')}</SectionLabel>
        <div className="grid grid-cols-1 gap-2">
          {OFFICE_TASK_TEMPLATES.map((template) => (
            <TemplateButton
              key={template.id}
              template={template}
              active={template.id === selectedTemplateId}
              onClick={() => onSelectTemplate(template.id)}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <SectionLabel>{t('office.taskTitle')}</SectionLabel>
        <input
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder={selectedTemplate ? t(selectedTemplate.titleKey) : ''}
          className="w-full rounded-lg border border-border-muted bg-background px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
        />
      </div>

      <div className="space-y-2">
        <SectionLabel>{t('office.workingFolder')}</SectionLabel>
        <button
          onClick={onSelectWorkingDir}
          className="w-full min-w-0 rounded-lg border border-border-muted bg-background px-3 py-2 flex items-center gap-2 text-left text-sm hover:bg-surface-hover transition-colors"
        >
          <FolderOpen className="w-4 h-4 text-text-muted shrink-0" />
          <span className={workingDir ? 'truncate text-text-primary' : 'text-text-muted'}>
            {workingDir ? formatPath(workingDir) : t('office.selectFolder')}
          </span>
        </button>
      </div>

      <TaskOptionsEditor options={options} onChange={onOptionsChange} />

      <InputFilesPanel
        inputPaths={inputPaths}
        onSelectFiles={onSelectFiles}
        onRemoveFile={onRemoveFile}
      />

      <SafetyConfirmation
        fileCount={inputPaths.length}
        workingDir={workingDir}
        confirmed={safetyConfirmed}
        onChange={onSafetyConfirmedChange}
      />

      <button
        onClick={onStartTask}
        disabled={isStarting}
        className="w-full h-10 rounded-lg bg-accent text-white text-sm font-semibold flex items-center justify-center gap-2 hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isStarting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Presentation className="w-4 h-4" />
        )}
        {t('office.startTask')}
      </button>
    </section>
  );
}

function TaskOptionsEditor({
  options,
  onChange,
}: {
  options: OfficeTaskOptions;
  onChange: (options: OfficeTaskOptions) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <SectionLabel>{t('office.taskOptions')}</SectionLabel>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <SelectField
          label={t('office.outputFormat')}
          value={options.outputFormat}
          onChange={(value) =>
            onChange({ ...options, outputFormat: value as OfficeTaskOptions['outputFormat'] })
          }
          options={OUTPUT_FORMATS.map((value) => ({
            value,
            label: t(`office.outputFormats.${value}`),
          }))}
        />
        <SelectField
          label={t('office.language')}
          value={options.language}
          onChange={(value) =>
            onChange({ ...options, language: value as OfficeTaskOptions['language'] })
          }
          options={LANGUAGES.map((value) => ({
            value,
            label: t(`office.languages.${value}`),
          }))}
        />
        <SelectField
          label={t('office.detailLevel')}
          value={options.detailLevel}
          onChange={(value) =>
            onChange({ ...options, detailLevel: value as OfficeTaskOptions['detailLevel'] })
          }
          options={DETAIL_LEVELS.map((value) => ({
            value,
            label: t(`office.detailLevels.${value}`),
          }))}
        />
        <label className="space-y-1">
          <span className="text-[11px] font-medium text-text-muted">{t('office.audience')}</span>
          <input
            value={options.audience}
            onChange={(event) => onChange({ ...options, audience: event.target.value })}
            placeholder={t('office.audiencePlaceholder')}
            className="w-full h-9 rounded-lg border border-border-muted bg-background px-2.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </label>
      </div>
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="text-[11px] font-medium text-text-muted">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full h-9 rounded-lg border border-border-muted bg-background px-2.5 text-xs text-text-primary focus:outline-none focus:border-accent"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function InputFilesPanel({
  inputPaths,
  onSelectFiles,
  onRemoveFile,
}: {
  inputPaths: string[];
  onSelectFiles: () => void;
  onRemoveFile: (filePath: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <SectionLabel>{t('office.inputFiles')}</SectionLabel>
        <button
          onClick={onSelectFiles}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-muted px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
        >
          <File className="w-3.5 h-3.5" />
          {t('office.addFiles')}
        </button>
      </div>
      {inputPaths.length === 0 ? (
        <EmptyLine label={t('office.noFiles')} />
      ) : (
        <div className="space-y-1">
          {inputPaths.map((filePath) => (
            <div
              key={filePath}
              className="rounded-lg border border-border-muted bg-background px-3 py-2 flex items-center gap-2"
            >
              <File className="w-3.5 h-3.5 text-text-muted shrink-0" />
              <span className="flex-1 min-w-0 truncate text-xs text-text-primary">
                {formatPath(filePath)}
              </span>
              <button
                onClick={() => onRemoveFile(filePath)}
                className="w-6 h-6 rounded-lg flex items-center justify-center text-text-muted hover:text-error hover:bg-surface-hover"
                title={t('common.remove')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SafetyConfirmation({
  fileCount,
  workingDir,
  confirmed,
  onChange,
}: {
  fileCount: number;
  workingDir: string | null;
  confirmed: boolean;
  onChange: (confirmed: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-border-muted bg-background px-3 py-3 space-y-2">
      <SectionLabel>{t('office.safety')}</SectionLabel>
      <div className="space-y-1 text-xs text-text-muted">
        <p>{t('office.safetyReadFiles', { count: fileCount })}</p>
        <p>
          {t('office.safetyWriteOutput', {
            outputDir: workingDir
              ? `${formatPath(workingDir)}/.cowork-office/tasks/<task>/outputs`
              : t('office.selectFolder'),
          })}
        </p>
      </div>
      <label className="flex items-start gap-2 text-xs text-text-primary">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-0.5"
        />
        <span>{t('office.safetyConfirm')}</span>
      </label>
    </div>
  );
}

function formatPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const homeMatch = normalized.match(/^\/(?:Users|home)\/[^/]+/);
  if (homeMatch) {
    return `~${normalized.slice(homeMatch[0].length)}`;
  }
  return normalized;
}
