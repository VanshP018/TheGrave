import type { SubmissionView } from '@thegrave/shared';
import { api } from './api';

/** Polls a submission until the judge is done with it; `onUpdate` sees every intermediate state. */
export async function pollSubmission(
  id: string,
  onUpdate?: (s: SubmissionView) => void,
): Promise<SubmissionView> {
  for (;;) {
    const s = await api<SubmissionView>(`/submissions/${id}`);
    onUpdate?.(s);
    if (s.status === 'DONE' || s.status === 'FAILED') return s;
    await new Promise((r) => setTimeout(r, 400));
  }
}
