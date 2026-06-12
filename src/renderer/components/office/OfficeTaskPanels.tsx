import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart3,
  Eye,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Loader2,
  Pencil,
  Presentation,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type {
  OfficeArtifact,
  OfficeArtifactPreview,
  OfficeTask,
  OfficeTaskTemplate,
  TraceStep,
} from '../../types';

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
  const recentTrace = trace.slice(-8).reverse();
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
        <section className="rounded-lg border border-border-muted bg-background">
          <PanelHeader title={t('office.progress')} />
          <div className="p-3 space-y-2">
            {recentTrace.length === 0 ? (
              <EmptyLine label={t('office.noProgress')} />
            ) : (
              recentTrace.map((step) => (
                <div key={step.id} className="flex items-center gap-2 text-xs">
                  <StatusDot status={step.status} />
                  <span className="min-w-0 flex-1 truncate text-text-primary">
                    {step.title || step.toolName || step.type}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-lg border border-border-muted bg-background">
          <PanelHeader
            title={t('office.artifacts')}
            action={
              <button
                onClick={() => void onRefreshArtifacts(task.id)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
                title={t('office.refreshArtifacts')}
              >
                {isRefreshingArtifacts ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
              </button>
            }
          />
          <div className="p-3 space-y-2">
            {artifacts.length === 0 ? (
              <EmptyLine label={emptyArtifactsLabel} />
            ) : (
              artifacts.map((artifact) => (
                <div
                  key={artifact.id}
                  className="w-full rounded-lg border border-border-muted px-2 py-2 flex items-center gap-1.5 text-left hover:bg-surface-hover transition-colors"
                >
                  <button
                    onClick={() => void onRevealArtifact(artifact)}
                    className="min-w-0 flex-1 flex items-center gap-2 text-left"
                    title={t('office.revealArtifact')}
                  >
                    <ArtifactIcon artifact={artifact} />
                    <span className="min-w-0 flex-1 truncate text-xs text-text-primary">
                      {artifact.name}
                    </span>
                  </button>
                  <span className="text-[11px] text-text-muted">{formatBytes(artifact.size)}</span>
                  <IconButton
                    label={t('office.previewArtifact')}
                    onClick={() => void onPreviewArtifact(artifact)}
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </IconButton>
                  <IconButton
                    label={t('office.renameArtifact')}
                    onClick={() => void onRenameArtifact(artifact)}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </IconButton>
                  <IconButton
                    label={t('office.deleteArtifact')}
                    danger
                    onClick={() => void onDeleteArtifact(artifact)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </IconButton>
                </div>
              ))
            )}
          </div>
        </section>
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

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-xs font-medium uppercase tracking-wide text-text-muted">{children}</div>
  );
}

export function EmptyLine({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border-muted px-3 py-3 text-sm text-text-muted">
      {label}
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

function PanelHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="h-10 px-3 border-b border-border-muted flex items-center justify-between">
      <SectionLabel>{title}</SectionLabel>
      {action}
    </div>
  );
}

function IconButton({
  label,
  danger,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
        danger
          ? 'text-text-muted hover:text-error hover:bg-error/10'
          : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'
      }`}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function StatusDot({ status }: { status: TraceStep['status'] }) {
  const className =
    status === 'completed'
      ? 'bg-success'
      : status === 'error'
        ? 'bg-error'
        : status === 'running'
          ? 'bg-accent'
          : 'bg-text-muted';
  return <span className={`w-2 h-2 rounded-full shrink-0 ${className}`} />;
}

function ArtifactIcon({ artifact }: { artifact: OfficeArtifact }) {
  const className = 'w-3.5 h-3.5 text-text-muted shrink-0';
  if (artifact.type === 'spreadsheet') return <FileSpreadsheet className={className} />;
  if (artifact.type === 'presentation') return <Presentation className={className} />;
  return <FileText className={className} />;
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

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
