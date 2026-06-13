/**
 * Pure, dependency-free utility for classifying Office task error messages
 * into typed, actionable categories surfaced in the renderer.
 *
 * Source-of-truth for known message strings: src/main/office/office-task-service.ts
 */

export type OfficeTaskErrorType =
  | 'noArtifacts'
  | 'timeout'
  | 'aborted'
  | 'requestFailed'
  | 'sessionError'
  | 'generic';

export interface OfficeTaskErrorClassification {
  type: OfficeTaskErrorType;
  i18nKey: string;
  retryable: boolean;
}

/**
 * Classify an Office task error message into a typed result with an i18n key
 * and a flag indicating whether a retry is likely to help.
 *
 * @param message - The raw error string from `OfficeTask.error`, or null when absent.
 * @returns A classification with `type`, `i18nKey`, and `retryable`.
 */
export function classifyOfficeTaskError(message: string | null): OfficeTaskErrorClassification {
  if (!message) {
    return make('generic', true);
  }

  // No-artifacts: task completed but agent produced no output files.
  if (message.includes('no generated artifacts were found')) {
    return make('noArtifacts', true);
  }

  // Timeout: Chinese SDK marker OR English trace title.
  if (message.includes('请求超时') || message === 'Request timed out') {
    return make('timeout', true);
  }

  // Aborted: Chinese SDK marker for operation cancelled by the platform.
  if (message.includes('操作已中止')) {
    return make('aborted', true);
  }

  // Request-level failures from extractFatalTraceError trace titles.
  if (
    message === 'Request failed' ||
    message === 'Error occurred' ||
    message === 'Error during context compaction'
  ) {
    return make('requestFailed', true);
  }

  // Session-level errors: the agent session itself failed to run.
  if (message.includes('agent session failed')) {
    return make('sessionError', false);
  }

  // Unknown / generic fallback — retry may still be worth trying.
  return make('generic', true);
}

function make(type: OfficeTaskErrorType, retryable: boolean): OfficeTaskErrorClassification {
  return { type, i18nKey: `office.errorTypes.${type}`, retryable };
}
