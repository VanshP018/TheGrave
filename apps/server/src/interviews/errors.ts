import { INTERVIEW_ERROR_MESSAGES, type InterviewErrorCode } from '@thegrave/shared';

/**
 * An analysis can't continue; `code` is stored on the row and shown to the user via INTERVIEW_ERROR_MESSAGES.
 * `retryable` tells the queue whether another attempt could succeed; `retryAt` is when a busy AI frees up.
 */
export class InterviewError extends Error {
  readonly retryable: boolean;
  readonly retryAt: Date | null;

  constructor(
    readonly code: InterviewErrorCode,
    message?: string,
    opts: { retryable?: boolean; retryAt?: Date } = {},
  ) {
    super(message ?? INTERVIEW_ERROR_MESSAGES[code]);
    this.name = 'InterviewError';
    this.retryable = opts.retryable ?? false;
    this.retryAt = opts.retryAt ?? null;
  }
}
