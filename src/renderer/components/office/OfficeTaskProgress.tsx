import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import {
  derivePhase,
  OFFICE_PHASE_ORDER,
  type OfficePhase,
  type OfficeProgressState,
} from '../../../shared/office-task-progress';
import type { OfficeTask, TraceStep } from '../../types';
import { describeTraceStep, type TraceActivity } from '../../utils/trace-activity';
import { SectionLabel } from './OfficePrimitives';

const STEPPER_PHASES: OfficePhase[] = ['reading', 'analyzing', 'generating', 'done'];

interface ActivityEntry {
  step: TraceStep;
  activity: TraceActivity;
}

export function OfficeTaskProgress({ task, trace }: { task: OfficeTask; trace: TraceStep[] }) {
  const { t } = useTranslation();
  const progress = derivePhase(task.status, trace);

  const entries: ActivityEntry[] = [];
  for (const step of trace) {
    const activity = describeTraceStep(step);
    if (activity) {
      entries.push({ step, activity });
    }
  }
  const recent = entries.slice(-8).reverse();
  const current = entries.length > 0 ? entries[entries.length - 1] : null;

  return (
    <section className="rounded-lg border border-border-muted bg-background">
      <div className="h-10 px-3 border-b border-border-muted flex items-center">
        <SectionLabel>{t('office.progress')}</SectionLabel>
      </div>
      <div className="p-3 space-y-3">
        <PhaseStepper progress={progress} />
        <CurrentStepLine state={progress.state} activity={current?.activity ?? null} />
        {recent.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer list-none text-[11px] font-medium text-text-muted hover:text-text-secondary select-none">
              {t('office.details')}
            </summary>
            <div className="mt-2 space-y-1.5">
              {recent.map((entry) => (
                <div key={entry.step.id} className="flex items-center gap-2 text-xs">
                  <StatusDot status={entry.step.status} />
                  <span className="min-w-0 flex-1 truncate text-text-secondary">
                    {t(entry.activity.key, entry.activity.params)}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}

function PhaseStepper({ progress }: { progress: ReturnType<typeof derivePhase> }) {
  const { t } = useTranslation();
  const currentIndex = OFFICE_PHASE_ORDER.indexOf(progress.phase);
  const barColor =
    progress.state === 'error'
      ? 'bg-error'
      : progress.state === 'cancelled'
        ? 'bg-text-muted'
        : progress.state === 'done'
          ? 'bg-success'
          : 'bg-accent';

  return (
    <div className="space-y-2">
      <div className="h-1.5 w-full rounded-full bg-surface-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      <div className="flex items-center justify-between gap-1">
        {STEPPER_PHASES.map((phase) => {
          const phaseIndex = OFFICE_PHASE_ORDER.indexOf(phase);
          const nodeState = resolveNodeState(progress.state, currentIndex, phaseIndex);
          return (
            <div key={phase} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <PhaseDot nodeState={nodeState} />
              <span
                className={`truncate text-[10px] leading-tight ${
                  nodeState === 'pending' ? 'text-text-muted' : 'text-text-secondary'
                }`}
              >
                {t(`office.phases.${phase}`)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type NodeState = 'done' | 'active' | 'error' | 'cancelled' | 'pending';

function resolveNodeState(
  state: OfficeProgressState,
  currentIndex: number,
  phaseIndex: number
): NodeState {
  if (state === 'done') {
    return 'done';
  }
  if (phaseIndex < currentIndex) {
    return 'done';
  }
  if (phaseIndex === currentIndex) {
    if (state === 'error') return 'error';
    if (state === 'cancelled') return 'cancelled';
    return 'active';
  }
  return 'pending';
}

function PhaseDot({ nodeState }: { nodeState: NodeState }) {
  if (nodeState === 'done') {
    return <CheckCircle2 className="w-3.5 h-3.5 text-success" />;
  }
  if (nodeState === 'error') {
    return <AlertCircle className="w-3.5 h-3.5 text-error" />;
  }
  if (nodeState === 'active') {
    return <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />;
  }
  const color = nodeState === 'cancelled' ? 'bg-text-muted' : 'bg-border-muted';
  return <span className={`w-2 h-2 rounded-full ${color}`} />;
}

function CurrentStepLine({
  state,
  activity,
}: {
  state: OfficeProgressState;
  activity: TraceActivity | null;
}) {
  const { t } = useTranslation();
  if (state === 'done') {
    return (
      <div className="flex items-center gap-2 text-xs text-success">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{t('office.phases.done')}</span>
      </div>
    );
  }
  if (state !== 'active') {
    return null;
  }
  return (
    <div className="flex items-center gap-2 text-xs text-text-primary">
      <Loader2 className="w-3.5 h-3.5 shrink-0 text-accent animate-spin" />
      <span className="min-w-0 flex-1 truncate">
        {activity ? t(activity.key, activity.params) : t('office.activity.working')}
      </span>
    </div>
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
