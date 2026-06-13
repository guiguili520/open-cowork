import { describe, it, expect } from 'vitest';
import { classifyOfficeTaskError } from '../../shared/office-task-error-format';
import type { OfficeTaskErrorType } from '../../shared/office-task-error-format';

interface ExpectedResult {
  type: OfficeTaskErrorType;
  i18nKey: string;
  retryable: boolean;
}

describe('classifyOfficeTaskError', () => {
  // --- Known backend messages ---

  const knownMessageCases: [string, string, ExpectedResult][] = [
    [
      'noArtifacts — exact NO_ARTIFACTS_ERROR constant',
      'Task finished, but no generated artifacts were found in the output directory.',
      { type: 'noArtifacts', i18nKey: 'office.errorTypes.noArtifacts', retryable: true },
    ],
    [
      'noArtifacts — message that contains the key phrase',
      'Something happened: no generated artifacts were found anywhere.',
      { type: 'noArtifacts', i18nKey: 'office.errorTypes.noArtifacts', retryable: true },
    ],
    [
      'timeout — Chinese marker 请求超时',
      '请求超时，请稍后再试',
      { type: 'timeout', i18nKey: 'office.errorTypes.timeout', retryable: true },
    ],
    [
      'timeout — Chinese marker embedded in longer text',
      '**Error**: 请求超时 (connection reset)',
      { type: 'timeout', i18nKey: 'office.errorTypes.timeout', retryable: true },
    ],
    [
      "timeout — trace title 'Request timed out'",
      'Request timed out',
      { type: 'timeout', i18nKey: 'office.errorTypes.timeout', retryable: true },
    ],
    [
      'aborted — Chinese marker 操作已中止',
      '操作已中止',
      { type: 'aborted', i18nKey: 'office.errorTypes.aborted', retryable: true },
    ],
    [
      'aborted — Chinese marker embedded in longer text',
      '操作已中止，请重试',
      { type: 'aborted', i18nKey: 'office.errorTypes.aborted', retryable: true },
    ],
    [
      "requestFailed — trace title 'Request failed'",
      'Request failed',
      { type: 'requestFailed', i18nKey: 'office.errorTypes.requestFailed', retryable: true },
    ],
    [
      "requestFailed — trace title 'Error occurred'",
      'Error occurred',
      { type: 'requestFailed', i18nKey: 'office.errorTypes.requestFailed', retryable: true },
    ],
    [
      "requestFailed — trace title 'Error during context compaction'",
      'Error during context compaction',
      { type: 'requestFailed', i18nKey: 'office.errorTypes.requestFailed', retryable: true },
    ],
    [
      "sessionError — exact 'The linked agent session failed.'",
      'The linked agent session failed.',
      { type: 'sessionError', i18nKey: 'office.errorTypes.sessionError', retryable: false },
    ],
    [
      'sessionError — custom session-level error message containing the key phrase',
      'Unexpected error: agent session failed with SIGTERM',
      { type: 'sessionError', i18nKey: 'office.errorTypes.sessionError', retryable: false },
    ],
  ];

  it.each(knownMessageCases)('%s', (_label, message, expected) => {
    const result = classifyOfficeTaskError(message);
    expect(result).toEqual(expected);
  });

  // --- Null / empty / unknown → generic ---

  it('null message → generic, retryable', () => {
    const result = classifyOfficeTaskError(null);
    expect(result).toEqual({
      type: 'generic',
      i18nKey: 'office.errorTypes.generic',
      retryable: true,
    });
  });

  it('empty string → generic, retryable', () => {
    const result = classifyOfficeTaskError('');
    expect(result).toEqual({
      type: 'generic',
      i18nKey: 'office.errorTypes.generic',
      retryable: true,
    });
  });

  it('unknown/arbitrary string → generic, retryable', () => {
    const result = classifyOfficeTaskError('Some completely random unexpected error from nowhere');
    expect(result).toEqual({
      type: 'generic',
      i18nKey: 'office.errorTypes.generic',
      retryable: true,
    });
  });

  it('another unknown string → generic, retryable', () => {
    const result = classifyOfficeTaskError('Working folder does not exist');
    expect(result).toEqual({
      type: 'generic',
      i18nKey: 'office.errorTypes.generic',
      retryable: true,
    });
  });

  // --- i18nKey always matches the type ---

  it('i18nKey is always office.errorTypes.<type>', () => {
    const messages = [
      'Task finished, but no generated artifacts were found in the output directory.',
      '请求超时',
      '操作已中止',
      'Request failed',
      'The linked agent session failed.',
      null,
      '',
      'random unknown text',
    ] as const;

    for (const msg of messages) {
      const result = classifyOfficeTaskError(msg);
      expect(result.i18nKey).toBe(`office.errorTypes.${result.type}`);
    }
  });
});
