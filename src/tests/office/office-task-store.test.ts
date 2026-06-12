import { describe, expect, it } from 'vitest';
import { createOfficeTaskStore } from '../../main/office/office-task-store';
import { createFakeOfficeDatabase } from './fake-office-db';

describe('office task store', () => {
  it('persists task records through the database interface', () => {
    const store = createOfficeTaskStore(createFakeOfficeDatabase());

    const task = store.create({
      id: 'task-1',
      title: 'Weekly report',
      templateId: 'report_generation',
      status: 'pending',
      cwd: '/tmp/work',
      inputPaths: ['/tmp/input.docx'],
      outputDir: '/tmp/work/.cowork-office/tasks/task-1/outputs',
      sourceType: 'local',
      externalRef: null,
      options: {
        outputFormat: 'docx',
        language: 'zh',
        detailLevel: 'deep',
        audience: 'leadership',
      },
    });

    expect(task.id).toBe('task-1');
    expect(store.list()).toHaveLength(1);
    expect(store.get('task-1')?.inputPaths).toEqual(['/tmp/input.docx']);
    expect(store.get('task-1')?.options.outputFormat).toBe('docx');
    expect(store.get('task-1')?.options.audience).toBe('leadership');

    const updated = store.update('task-1', {
      status: 'running',
      sessionId: 'session-1',
    });

    expect(updated?.status).toBe('running');
    expect(store.getBySessionId('session-1')?.id).toBe('task-1');
  });

  it('replaces artifacts for a task atomically', () => {
    const store = createOfficeTaskStore(createFakeOfficeDatabase());
    store.create({
      id: 'task-1',
      title: 'Deck',
      templateId: 'deck_generation',
      status: 'completed',
      cwd: '/tmp/work',
      inputPaths: ['/tmp/source.pdf'],
      outputDir: '/tmp/work/.cowork-office/tasks/task-1/outputs',
    });

    store.replaceArtifacts('task-1', [
      {
        id: 'artifact-1',
        taskId: 'task-1',
        path: '/tmp/out/report.docx',
        name: 'report.docx',
        type: 'document',
        size: 10,
        createdAt: 100,
      },
    ]);
    expect(store.listArtifacts('task-1')).toHaveLength(1);

    store.replaceArtifacts('task-1', [
      {
        id: 'artifact-2',
        taskId: 'task-1',
        path: '/tmp/out/deck.pptx',
        name: 'deck.pptx',
        type: 'presentation',
        size: 20,
        createdAt: 200,
      },
    ]);

    const artifacts = store.listArtifacts('task-1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].name).toBe('deck.pptx');
  });
});
