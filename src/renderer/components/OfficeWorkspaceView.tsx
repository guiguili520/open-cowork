import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, RefreshCw } from 'lucide-react';
import { DEFAULT_OFFICE_TASK_OPTIONS, OFFICE_TASK_TEMPLATES } from '../../shared/office-tasks';
import type {
  OfficeArtifact,
  OfficeArtifactPreview,
  OfficeTask,
  OfficeTaskOptions,
  OfficeTaskTemplateId,
} from '../types';
import { useIPC } from '../hooks/useIPC';
import { useAppStore } from '../store';
import { useOfficeTaskDetails, useOfficeTasks, useWorkingDir } from '../store/selectors';
import {
  ArtifactPreviewDialog,
  EmptyLine,
  SectionLabel,
  StatusBadge,
  TaskDetail,
} from './office/OfficeTaskPanels';
import { OfficeTaskComposer } from './office/OfficeTaskComposer';

export function OfficeWorkspaceView() {
  const { t } = useTranslation();
  const officeTasks = useOfficeTasks();
  const officeTaskDetails = useOfficeTaskDetails();
  const workingDir = useWorkingDir();
  const sessionStates = useAppStore((s) => s.sessionStates);
  const sessions = useAppStore((s) => s.sessions);
  const setOfficeTasks = useAppStore((s) => s.setOfficeTasks);
  const upsertOfficeTaskDetail = useAppStore((s) => s.upsertOfficeTaskDetail);
  const setWorkingDir = useAppStore((s) => s.setWorkingDir);
  const setMainView = useAppStore((s) => s.setMainView);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setMessages = useAppStore((s) => s.setMessages);
  const setTraceSteps = useAppStore((s) => s.setTraceSteps);
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);
  const { changeWorkingDir, getSessionMessages, getSessionTraceSteps, isElectron, listSessions } =
    useIPC();

  const [selectedTemplateId, setSelectedTemplateId] =
    useState<OfficeTaskTemplateId>('file_summary');
  const [title, setTitle] = useState('');
  const [inputPaths, setInputPaths] = useState<string[]>([]);
  const [taskOptions, setTaskOptions] = useState<OfficeTaskOptions>(DEFAULT_OFFICE_TASK_OPTIONS);
  const [safetyConfirmed, setSafetyConfirmed] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isRefreshingArtifacts, setIsRefreshingArtifacts] = useState(false);
  const [artifactPreview, setArtifactPreview] = useState<OfficeArtifactPreview | null>(null);

  const selectedTask = selectedTaskId
    ? (officeTasks.find((task) => task.id === selectedTaskId) ?? null)
    : null;
  const selectedDetail = selectedTaskId ? officeTaskDetails[selectedTaskId] : undefined;
  const detailArtifacts = selectedDetail?.artifacts ?? [];
  const selectedSessionId = selectedDetail?.task.sessionId ?? selectedTask?.sessionId ?? null;
  const selectedTrace = selectedSessionId
    ? (sessionStates[selectedSessionId]?.traceSteps ?? [])
    : [];

  useEffect(() => {
    void loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedTaskId && officeTasks.length > 0) {
      setSelectedTaskId(officeTasks[0].id);
    }
  }, [officeTasks, selectedTaskId]);

  useEffect(() => {
    if (!selectedTaskId || officeTaskDetails[selectedTaskId]) {
      return;
    }
    void loadTaskDetail(selectedTaskId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTaskId, officeTaskDetails]);

  useEffect(() => {
    if (!selectedSessionId || selectedTrace.length > 0 || !isElectron) {
      return;
    }
    void getSessionTraceSteps(selectedSessionId)
      .then((steps) => setTraceSteps(selectedSessionId, steps || []))
      .catch((error) => console.error('[OfficeWorkspace] Failed to load trace steps:', error));
  }, [getSessionTraceSteps, isElectron, selectedSessionId, selectedTrace.length, setTraceSteps]);

  useEffect(() => {
    setSafetyConfirmed(false);
  }, [inputPaths, selectedTemplateId, taskOptions, workingDir]);

  const selectedTemplate = useMemo(
    () => OFFICE_TASK_TEMPLATES.find((template) => template.id === selectedTemplateId),
    [selectedTemplateId]
  );

  async function loadTasks() {
    if (!window.electronAPI?.officeTasks) {
      return;
    }
    setIsLoadingTasks(true);
    try {
      const tasks = await window.electronAPI.officeTasks.list();
      setOfficeTasks(tasks);
    } catch (error) {
      showError(error, t('office.errors.loadTasks'));
    } finally {
      setIsLoadingTasks(false);
    }
  }

  async function loadTaskDetail(taskId: string) {
    if (!window.electronAPI?.officeTasks) {
      return;
    }
    try {
      const detail = await window.electronAPI.officeTasks.get(taskId);
      if (detail) {
        upsertOfficeTaskDetail(detail);
      }
    } catch (error) {
      showError(error, t('office.errors.loadTask'));
    }
  }

  async function handleSelectFiles() {
    if (!window.electronAPI?.dialog?.selectTaskFiles) {
      return;
    }
    try {
      const files = await window.electronAPI.dialog.selectTaskFiles();
      if (files.length === 0) return;
      setInputPaths((prev) => Array.from(new Set([...prev, ...files])));
    } catch (error) {
      showError(error, t('office.errors.selectFiles'));
    }
  }

  async function handleSelectWorkingDir() {
    const result = await changeWorkingDir(undefined, workingDir || undefined);
    if (result.success) {
      setWorkingDir(result.path);
      return;
    }
    if (result.error && result.error !== 'User cancelled') {
      setGlobalNotice({
        id: `office-dir-${Date.now()}`,
        type: 'warning',
        message: `${t('office.errors.selectFolder')}: ${result.error}`,
      });
    }
  }

  async function handleStartTask() {
    if (!workingDir) {
      setGlobalNotice({
        id: `office-missing-dir-${Date.now()}`,
        type: 'warning',
        message: t('office.errors.missingFolder'),
      });
      return;
    }
    if (inputPaths.length === 0) {
      setGlobalNotice({
        id: `office-missing-files-${Date.now()}`,
        type: 'warning',
        message: t('office.errors.missingFiles'),
      });
      return;
    }
    if (!safetyConfirmed) {
      setGlobalNotice({
        id: `office-safety-${Date.now()}`,
        type: 'warning',
        message: t('office.errors.safetyRequired'),
      });
      return;
    }
    setIsStarting(true);
    try {
      const detail = await window.electronAPI.officeTasks.start({
        templateId: selectedTemplateId,
        title: title.trim() || undefined,
        cwd: workingDir,
        inputPaths,
        options: taskOptions,
        sourceType: 'local',
      });
      upsertOfficeTaskDetail(detail);
      setSelectedTaskId(detail.task.id);
      setTitle('');
      setInputPaths([]);
      setSafetyConfirmed(false);
    } catch (error) {
      showError(error, t('office.errors.startTask'));
    } finally {
      setIsStarting(false);
    }
  }

  async function handleRetryTask(taskId: string) {
    try {
      const detail = await window.electronAPI.officeTasks.retry(taskId);
      upsertOfficeTaskDetail(detail);
      setSelectedTaskId(detail.task.id);
    } catch (error) {
      showError(error, t('office.errors.retryTask'));
    }
  }

  function handleUseTaskAsTemplate(task: OfficeTask) {
    setSelectedTemplateId(task.templateId);
    setTitle(task.title);
    setWorkingDir(task.cwd);
    setInputPaths(task.inputPaths);
    setTaskOptions(task.options);
    setSafetyConfirmed(false);
    setGlobalNotice({
      id: `office-use-template-${Date.now()}`,
      type: 'info',
      message: t('office.copiedToComposer'),
    });
  }

  async function handleCancelTask(taskId: string) {
    try {
      const detail = await window.electronAPI.officeTasks.cancel(taskId);
      if (detail) {
        upsertOfficeTaskDetail(detail);
      }
    } catch (error) {
      showError(error, t('office.errors.cancelTask'));
    }
  }

  async function handleRefreshArtifacts(taskId: string) {
    setIsRefreshingArtifacts(true);
    try {
      const detail = await window.electronAPI.officeTasks.refreshArtifacts(taskId);
      if (detail) {
        upsertOfficeTaskDetail(detail);
      }
    } catch (error) {
      showError(error, t('office.errors.refreshArtifacts'));
    } finally {
      setIsRefreshingArtifacts(false);
    }
  }

  async function handleRevealArtifact(artifact: OfficeArtifact) {
    const ok = await window.electronAPI.officeTasks.revealArtifact(artifact.path);
    if (!ok) {
      setGlobalNotice({
        id: `office-reveal-${Date.now()}`,
        type: 'warning',
        message: t('office.errors.revealArtifact'),
      });
    }
  }

  async function handlePreviewArtifact(artifact: OfficeArtifact) {
    try {
      const preview = await window.electronAPI.officeTasks.previewArtifact(
        artifact.taskId,
        artifact.id
      );
      if (!preview) {
        setGlobalNotice({
          id: `office-preview-${Date.now()}`,
          type: 'warning',
          message: t('office.errors.previewArtifact'),
        });
        return;
      }
      setArtifactPreview(preview);
    } catch (error) {
      showError(error, t('office.errors.previewArtifact'));
    }
  }

  async function handleRenameArtifact(artifact: OfficeArtifact) {
    const nextName = window.prompt(t('office.renameArtifactPrompt'), artifact.name);
    if (nextName === null || nextName.trim() === artifact.name) {
      return;
    }
    try {
      const detail = await window.electronAPI.officeTasks.renameArtifact(
        artifact.taskId,
        artifact.id,
        nextName
      );
      if (detail) {
        upsertOfficeTaskDetail(detail);
      }
    } catch (error) {
      showError(error, t('office.errors.renameArtifact'));
    }
  }

  async function handleDeleteArtifact(artifact: OfficeArtifact) {
    if (!window.confirm(t('office.deleteArtifactConfirm', { name: artifact.name }))) {
      return;
    }
    try {
      const detail = await window.electronAPI.officeTasks.deleteArtifact(
        artifact.taskId,
        artifact.id
      );
      if (detail) {
        upsertOfficeTaskDetail(detail);
      }
    } catch (error) {
      showError(error, t('office.errors.deleteArtifact'));
    }
  }

  async function handleRevealOutputDir(outputDir: string) {
    const ok = await window.electronAPI.officeTasks.revealArtifact(outputDir);
    if (!ok) {
      setGlobalNotice({
        id: `office-output-${Date.now()}`,
        type: 'warning',
        message: t('office.errors.revealOutputDir'),
      });
    }
  }

  async function handleOpenSession(sessionId: string) {
    const hasSession = sessions.some((session) => session.id === sessionId);
    if (!hasSession) {
      listSessions();
    }
    const existingMessages = sessionStates[sessionId]?.messages;
    if ((!existingMessages || existingMessages.length === 0) && isElectron) {
      try {
        const messages = await getSessionMessages(sessionId);
        if (messages.length > 0) {
          setMessages(sessionId, messages);
        }
      } catch (error) {
        console.error('[OfficeWorkspace] Failed to load session messages:', error);
      }
    }
    const existingTrace = sessionStates[sessionId]?.traceSteps;
    if ((!existingTrace || existingTrace.length === 0) && isElectron) {
      try {
        const steps = await getSessionTraceSteps(sessionId);
        setTraceSteps(sessionId, steps || []);
      } catch (error) {
        console.error('[OfficeWorkspace] Failed to load session trace steps:', error);
      }
    }
    setActiveSession(sessionId);
    setMainView('chat');
  }

  function showError(error: unknown, fallback: string) {
    setGlobalNotice({
      id: `office-error-${Date.now()}`,
      type: 'error',
      message: error instanceof Error && error.message ? `${fallback}: ${error.message}` : fallback,
    });
  }

  return (
    <div className="h-full min-h-0 flex flex-col bg-background">
      <div className="h-12 border-b border-border-muted px-5 flex items-center justify-between">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-text-primary">{t('office.title')}</h2>
        </div>
        <button
          onClick={() => void loadTasks()}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          title={t('office.refresh')}
        >
          {isLoadingTasks ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
        </button>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(320px,400px)_minmax(0,1fr)] overflow-y-auto lg:overflow-hidden">
        <OfficeTaskComposer
          selectedTemplateId={selectedTemplateId}
          selectedTemplate={selectedTemplate}
          title={title}
          workingDir={workingDir}
          inputPaths={inputPaths}
          options={taskOptions}
          safetyConfirmed={safetyConfirmed}
          isStarting={isStarting}
          onSelectTemplate={setSelectedTemplateId}
          onTitleChange={setTitle}
          onSelectWorkingDir={() => void handleSelectWorkingDir()}
          onSelectFiles={() => void handleSelectFiles()}
          onRemoveFile={(filePath) =>
            setInputPaths((prev) => prev.filter((item) => item !== filePath))
          }
          onOptionsChange={setTaskOptions}
          onSafetyConfirmedChange={setSafetyConfirmed}
          onStartTask={() => void handleStartTask()}
        />

        <main className="min-w-0 min-h-[560px] lg:min-h-0 grid grid-rows-[minmax(0,1fr)_220px] overflow-hidden">
          <section className="min-h-0 overflow-y-auto px-5 py-5">
            {selectedTask ? (
              <TaskDetail
                task={selectedDetail?.task ?? selectedTask}
                artifacts={detailArtifacts}
                trace={selectedTrace}
                onCancel={handleCancelTask}
                onRetry={handleRetryTask}
                onUseAsTemplate={handleUseTaskAsTemplate}
                onRefreshArtifacts={handleRefreshArtifacts}
                onRevealArtifact={handleRevealArtifact}
                onPreviewArtifact={handlePreviewArtifact}
                onRenameArtifact={handleRenameArtifact}
                onDeleteArtifact={handleDeleteArtifact}
                onRevealOutputDir={handleRevealOutputDir}
                onOpenSession={handleOpenSession}
                isRefreshingArtifacts={isRefreshingArtifacts}
              />
            ) : (
              <div className="h-full rounded-lg border border-border-muted flex items-center justify-center text-sm text-text-muted">
                {t('office.noTaskSelected')}
              </div>
            )}
          </section>

          <section className="border-t border-border-muted min-h-0 overflow-hidden">
            <div className="h-10 px-5 flex items-center justify-between">
              <SectionLabel>{t('office.history')}</SectionLabel>
              <span className="text-xs text-text-muted">{officeTasks.length}</span>
            </div>
            <div className="h-[calc(100%-2.5rem)] overflow-y-auto px-5 pb-4">
              {officeTasks.length === 0 ? (
                <EmptyLine label={t('office.noHistory')} />
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
                  {officeTasks.map((task) => (
                    <button
                      key={task.id}
                      onClick={() => setSelectedTaskId(task.id)}
                      className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                        selectedTaskId === task.id
                          ? 'border-accent/40 bg-accent-muted/20'
                          : 'border-border-muted bg-background hover:bg-surface-hover'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-medium text-text-primary">
                          {task.title}
                        </span>
                        <StatusBadge status={task.status} />
                      </div>
                      <div className="mt-1 text-xs text-text-muted truncate">
                        {formatPath(task.cwd)}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
      {artifactPreview && (
        <ArtifactPreviewDialog preview={artifactPreview} onClose={() => setArtifactPreview(null)} />
      )}
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
