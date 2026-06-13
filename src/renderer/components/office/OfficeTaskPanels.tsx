import { useTranslation } from 'react-i18next';
import {
  BarChart3,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Presentation,
  RotateCcw,
  Square,
  X,
} from 'lucide-react';
import type {
  OfficeArtifact,
  OfficeArtifactPreview,
  OfficeTask,
  OfficeTaskTemplate,
  TraceStep,
} from '../../types';
import { OfficeTaskProgress } from './OfficeTaskProgress';
import { OfficeArtifactList } from './OfficeArtifactList';
import { EmptyLine } from './OfficePrimitives';

export { EmptyLine, SectionLabel } from './OfficePrimitives';

const RUNNING_STATUSES = new Set<OfficeTask['status']>(['pending', 'running']);

export function TemplateButton({
  template,
  active,
  onClick,
}: {
  template: OfficeTaskTemplate;
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const Icon = getTemplateIcon(template);
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-3 py-2.5 text-left flex items-start gap-3 transition-colors ${
        active
          ? 'border-accent/40 bg-accent-muted/20'
          : 'border-border-muted bg-background hover:bg-surface-hover'
      }`}
    >
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${active ? 'text-accent' : 'text-text-muted'}`} />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-text-primary">{t(template.titleKey)}</span>
        <span className="block mt-0.5 text-xs leading-5 text-text-muted">
          {t(template.descriptionKey)}
        </span>
      </span>
    </button>
  );
}

export function TaskDetail({
  task,
  artifacts,
  trace,
  onCancel,
  onRetry,
  onUseAsTemplate,
  onRefreshArtifacts,
  onRevealArtifact,
  onPreviewArtifact,
  onRenameArtifact,
  onDeleteArtifact,
  onRevealOutputDir,
  onOpenSession,
  isRefreshingArtifacts,
}: {
  task: OfficeTask;
  artifacts: OfficeArtifact[];
  trace: TraceStep[];
  onCancel: (taskId: string) => Promise<void>;
  onRetry: (taskId: string) => Promise<void>;
  onUseAsTemplate: (task: OfficeTask) => void;
  onRefreshArtifacts: (taskId: string) => Promise<void>;
  onRevealArtifact: (artifact: OfficeArtifact) => Promise<void>;
  onPreviewArtifact: (artifact: OfficeArtifact) => Promise<void>;
  onRenameArtifact: (artifact: OfficeArtifact) => Promise<void>;
  onDeleteArtifact: (artifact: OfficeArtifact) => Promise<void>;
  onRevealOutputDir: (outputDir: string) => Promise<void>;
  onOpenSession: (sessionId: string) => Promise<void>;
  isRefreshingArtifacts: boolean;
}) {
  const { t } = useTranslation();
  const running = RUNNING_STATUSES.has(task.status);
  const emptyArtifactsLabel = running
    ? t('office.noArtifactsRunning')
    : task.status === 'error'
      ? t('office.noArtifactsFailed')
      : t('office.noArtifacts');

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-text-primary truncate">{task.title}</h3>
            <StatusBadge status={task.status} />
          </div>
          <p className="mt-1 text-xs text-text-muted truncate">{formatPath(task.outputDir)}</p>
          <p className="mt-1 text-[11px] text-text-muted truncate">{formatTaskOptions(task)}</p>
        </div>
        <div className="flex items-center justify-end gap-2 shrink-0 flex-wrap">
          <button
            onClick={() => void onRevealOutputDir(task.outputDir)}
            className="rounded-lg border border-border-muted px-3 py-2 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors inline-flex items-center gap-1.5"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            {t('office.openOutputDir')}
          </button>
          {task.sessionId && (
            <button
              onClick={() => void onOpenSession(task.sessionId!)}
              className="rounded-lg border border-border-muted px-3 py-2 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
            >
              {t('office.openSession')}
            </button>
          )}
          {!running && (
            <button
              onClick={() => void onRetry(task.id)}
              className="rounded-lg border border-border-muted px-3 py-2 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors inline-flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {t('office.retryTask')}
            </button>
          )}
          {!running && (
            <button
              onClick={() => onUseAsTemplate(task)}
              className="rounded-lg border border-border-muted px-3 py-2 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors inline-flex items-center gap-1.5"
            >
              <FileText className="w-3.5 h-3.5" />
              {t('office.useAsTemplate')}
            </button>
          )}
          {running && (
            <button
              onClick={() => void onCancel(task.id)}
              className="rounded-lg border border-error/30 px-3 py-2 text-xs font-medium text-error hover:bg-error/10 transition-colors inline-flex items-center gap-1.5"
            >
              <Square className="w-3 h-3" />
              {t('office.cancelTask')}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <OfficeTaskProgress task={task} trace={trace} />
        <OfficeArtifactList
          task={task}
          artifacts={artifacts}
          emptyLabel={emptyArtifactsLabel}
          isRefreshing={isRefreshingArtifacts}
          onRefresh={onRefreshArtifacts}
          onReveal={onRevealArtifact}
          onPreview={onPreviewArtifact}
          onRename={onRenameArtifact}
          onDelete={onDeleteArtifact}
        />
      </div>

      {task.error && (
        <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
          {task.error}
        </div>
      )}
    </div>
  );
}

export function ArtifactPreviewDialog({
  preview,
  onClose,
}: {
  preview: OfficeArtifactPreview;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center px-4">
      <div className="w-full max-w-3xl max-h-[80vh] rounded-lg border border-border-muted bg-background shadow-xl overflow-hidden">
        <div className="h-12 px-4 border-b border-border-muted flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-text-primary truncate">
              {preview.artifact.name}
            </div>
            {preview.truncated && (
              <div className="text-[11px] text-text-muted">{t('office.previewTruncated')}</div>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover"
            title={t('common.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 overflow-auto max-h-[calc(80vh-3rem)]">
          {preview.supported ? (
            <pre className="whitespace-pre-wrap break-words text-xs leading-5 text-text-primary">
              {preview.content}
            </pre>
          ) : (
            <EmptyLine label={t('office.previewUnsupported')} />
          )}
        </div>
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: OfficeTask['status'] }) {
  const { t } = useTranslation();
  const className =
    status === 'completed'
      ? 'bg-success/10 text-success'
      : status === 'error'
        ? 'bg-error/10 text-error'
        : status === 'cancelled'
          ? 'bg-surface-muted text-text-muted'
          : 'bg-accent-muted text-accent';
  return (
    <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-medium ${className}`}>
      {t(`office.status.${status}`)}
    </span>
  );
}

function getTemplateIcon(template: OfficeTaskTemplate) {
  switch (template.icon) {
    case 'spreadsheet':
      return FileSpreadsheet;
    case 'deck':
      return Presentation;
    case 'report':
      return FileText;
    case 'pdf':
      return FileText;
    case 'fileText':
      return BarChart3;
  }
}

function formatTaskOptions(task: OfficeTask): string {
  const parts = [
    task.options.outputFormat.toUpperCase(),
    task.options.language.toUpperCase(),
    task.options.detailLevel,
  ];
  if (task.options.audience.trim()) {
    parts.push(task.options.audience.trim());
  }
  return parts.join(' / ');
}

function formatPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const homeMatch = normalized.match(/^\/(?:Users|home)\/[^/]+/);
  if (homeMatch) {
    return `~${normalized.slice(homeMatch[0].length)}`;
  }
  return normalized;
}
