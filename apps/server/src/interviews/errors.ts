import { INTERVIEW_ERROR_MESSAGES, type InterviewErrorCode } from '@thegrave/shared';

/** An analysis can't continue; `code` is stored on the row and shown to the user via INTERVIEW_ERROR_MESSAGES. */
export class InterviewError extends Error {
  constructor(
    readonly code: InterviewErrorCode,
    message?: string,
  ) {
    super(message ?? INTERVIEW_ERROR_MESSAGES[code]);
    this.name = 'InterviewError';
  }
}
