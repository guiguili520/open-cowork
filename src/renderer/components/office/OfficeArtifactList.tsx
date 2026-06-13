import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Eye,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Presentation,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import {
  buildResultSummary,
  describeArtifact,
  pickPrimaryArtifactId,
  type ResultSummary,
} from '../../../shared/office-task-progress';
import type { OfficeArtifact, OfficeTask } from '../../types';
import { EmptyLine, SectionLabel } from './OfficePrimitives';

interface OfficeArtifactListProps {
  task: OfficeTask;
  artifacts: OfficeArtifact[];
  emptyLabel: string;
  isRefreshing: boolean;
  onRefresh: (taskId: string) => Promise<void>;
  onReveal: (artifact: OfficeArtifact) => Promise<void>;
  onPreview: (artifact: OfficeArtifact) => Promise<void>;
  onRename: (artifact: OfficeArtifact) => Promise<void>;
  onDelete: (artifact: OfficeArtifact) => Promise<void>;
}

export function OfficeArtifactList({
  task,
  artifacts,
  emptyLabel,
  isRefreshing,
  onRefresh,
  onReveal,
  onPreview,
  onRename,
  onDelete,
}: OfficeArtifactListProps) {
  const { t } = useTranslation();
  const summary = buildResultSummary(
    task.status,
    task.inputPaths.length,
    artifacts,
    task.templateId
  );
  const primaryId = pickPrimaryArtifactId(task.templateId, artifacts);

  return (
    <section className="rounded-lg border border-border-muted bg-background">
      <div className="h-10 px-3 border-b border-border-muted flex items-center justify-between">
        <SectionLabel>{t('office.artifacts')}</SectionLabel>
        <button
          onClick={() => void onRefresh(task.id)}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          title={t('office.refreshArtifacts')}
        >
          {isRefreshing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
      <div className="p-3 space-y-2">
        <p className="text-xs text-text-secondary">
          <span className="font-medium text-text-muted">{t('office.resultLabel')}: </span>
          {resultSummaryText(t, summary)}
        </p>
        {artifacts.length === 0 ? (
          <EmptyLine label={emptyLabel} />
        ) : (
          artifacts.map((artifact) => (
            <ArtifactRow
              key={artifact.id}
              task={task}
              artifact={artifact}
              isPrimary={artifact.id === primaryId}
              onReveal={onReveal}
              onPreview={onPreview}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))
        )}
      </div>
    </section>
  );
}

function ArtifactRow({
  task,
  artifact,
  isPrimary,
  onReveal,
  onPreview,
  onRename,
  onDelete,
}: {
  task: OfficeTask;
  artifact: OfficeArtifact;
  isPrimary: boolean;
  onReveal: (artifact: OfficeArtifact) => Promise<void>;
  onPreview: (artifact: OfficeArtifact) => Promise<void>;
  onRename: (artifact: OfficeArtifact) => Promise<void>;
  onDelete: (artifact: OfficeArtifact) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { roleKey, formatKey } = describeArtifact(artifact, task.templateId);

  return (
    <div className="w-full rounded-lg border border-border-muted px-2 py-2 flex items-center gap-1.5 text-left hover:bg-surface-hover transition-colors">
      <button
        onClick={() => void onReveal(artifact)}
        className="min-w-0 flex-1 flex items-center gap-2 text-left"
        title={t('office.revealArtifact')}
      >
        <ArtifactIcon artifact={artifact} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs text-text-primary">{artifact.name}</span>
          <span className="mt-0.5 flex items-center gap-1.5">
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                isPrimary ? 'bg-accent-muted text-accent' : 'bg-surface-muted text-text-muted'
              }`}
              title={t(isPrimary ? 'office.primaryBadge' : 'office.supportingBadge')}
            >
              {t(roleKey)}
            </span>
            <span className="text-[10px] text-text-muted">{t(formatKey)}</span>
          </span>
        </span>
      </button>
      <span className="text-[11px] text-text-muted shrink-0">{formatBytes(artifact.size)}</span>
      <IconButton label={t('office.previewArtifact')} onClick={() => void onPreview(artifact)}>
        <Eye className="w-3.5 h-3.5" />
      </IconButton>
      <IconButton label={t('office.renameArtifact')} onClick={() => void onRename(artifact)}>
        <Pencil className="w-3.5 h-3.5" />
      </IconButton>
      <IconButton label={t('office.deleteArtifact')} danger onClick={() => void onDelete(artifact)}>
        <Trash2 className="w-3.5 h-3.5" />
      </IconButton>
    </div>
  );
}

function resultSummaryText(
  t: ReturnType<typeof useTranslation>['t'],
  summary: ResultSummary
): string {
  if (summary.kind === 'status') {
    return t(summary.key);
  }
  // Single vs. many is decided here, not via i18next plurals: Chinese has only
  // one plural category, so an `_one`/`_other` split would drop the role noun.
  const deliverable =
    summary.fileCount === 1
      ? t('office.resultSummary.deliverableSingle', { role: t(summary.primaryRoleKey) })
      : t('office.resultSummary.deliverableMany', { count: summary.fileCount });
  const inputs = t('office.resultSummary.fromInputs', { count: summary.inputCount });
  return t('office.resultSummary.line', { deliverable, inputs });
}

function ArtifactIcon({ artifact }: { artifact: OfficeArtifact }) {
  const className = 'w-3.5 h-3.5 text-text-muted shrink-0';
  if (artifact.type === 'spreadsheet') return <FileSpreadsheet className={className} />;
  if (artifact.type === 'presentation') return <Presentation className={className} />;
  if (artifact.type === 'image') return <ImageIcon className={className} />;
  return <FileText className={className} />;
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
      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
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

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
