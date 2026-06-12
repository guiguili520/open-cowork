import type Database from 'better-sqlite3';
import type {
  DatabaseInstance,
  OfficeArtifactRow,
  OfficeTaskRow,
  ScheduledTaskRow,
  SessionRow,
  MessageRow,
  TraceStepRow,
} from '../../main/db/database';

export function createFakeOfficeDatabase(): DatabaseInstance {
  const tasks: OfficeTaskRow[] = [];
  const artifacts: OfficeArtifactRow[] = [];
  const sessions: SessionRow[] = [];

  const unusedStatement = (): Database.Statement => {
    throw new Error('Statement API is not used by this test');
  };

  return {
    raw: {} as Database.Database,
    sessions: {
      create: (session) => {
        const index = sessions.findIndex((row) => row.id === session.id);
        if (index === -1) {
          sessions.push(session);
        } else {
          sessions[index] = session;
        }
      },
      update: (id, updates) => {
        const row = sessions.find((session) => session.id === id);
        if (row) Object.assign(row, updates);
      },
      get: (id) => sessions.find((session) => session.id === id),
      getAll: () => [...sessions],
      delete: (id) => {
        const index = sessions.findIndex((session) => session.id === id);
        if (index !== -1) sessions.splice(index, 1);
      },
    },
    messages: {
      create: (_message: MessageRow) => undefined,
      update: (_id: string, _updates: Partial<Pick<MessageRow, 'execution_time_ms'>>) => undefined,
      getBySessionId: (_sessionId: string) => [],
      delete: (_id: string) => undefined,
      deleteBySessionId: (_sessionId: string) => undefined,
    },
    traceSteps: {
      create: (_step: TraceStepRow) => undefined,
      update: (_id: string, _updates: Partial<TraceStepRow>) => undefined,
      getBySessionId: (_sessionId: string) => [],
      deleteBySessionId: (_sessionId: string) => undefined,
    },
    scheduledTasks: {
      create: (_task: ScheduledTaskRow) => undefined,
      update: (_id: string, _updates: Partial<ScheduledTaskRow>) => undefined,
      get: (_id: string) => undefined,
      getAll: () => [],
      delete: (_id: string) => undefined,
    },
    officeTasks: {
      create: (task) => {
        const index = tasks.findIndex((row) => row.id === task.id);
        if (index === -1) {
          tasks.push(task);
        } else {
          tasks[index] = task;
        }
      },
      update: (id, updates) => {
        const row = tasks.find((task) => task.id === id);
        if (row) {
          Object.assign(row, updates);
        }
      },
      get: (id) => tasks.find((task) => task.id === id),
      getBySessionId: (sessionId) => tasks.find((task) => task.session_id === sessionId),
      getAll: () => [...tasks].sort((a, b) => b.updated_at - a.updated_at),
      delete: (id) => {
        const index = tasks.findIndex((task) => task.id === id);
        if (index !== -1) tasks.splice(index, 1);
      },
    },
    officeArtifacts: {
      create: (artifact) => {
        artifacts.push(artifact);
      },
      listByTaskId: (taskId) => artifacts.filter((artifact) => artifact.task_id === taskId),
      deleteByTaskId: (taskId) => {
        for (let index = artifacts.length - 1; index >= 0; index -= 1) {
          if (artifacts[index].task_id === taskId) {
            artifacts.splice(index, 1);
          }
        }
      },
      replaceForTask: (taskId, nextArtifacts) => {
        for (let index = artifacts.length - 1; index >= 0; index -= 1) {
          if (artifacts[index].task_id === taskId) {
            artifacts.splice(index, 1);
          }
        }
        artifacts.push(...nextArtifacts);
      },
    },
    prepare: unusedStatement,
    exec: (_sql: string) => undefined,
    pragma: (_pragma: string) => undefined,
    close: () => undefined,
  };
}
