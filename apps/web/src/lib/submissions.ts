import type { ProjectRunView, SubmissionView } from '@thegrave/shared';
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

/** Same for a programming-challenge run (decision.md D-066). */
export async function pollProjectRun(id: string): Promise<ProjectRunView> {
  for (;;) {
    const r = await api<ProjectRunView>(`/project-runs/${id}`);
    if (r.status === 'DONE' || r.status === 'FAILED') return r;
    await new Promise((res) => setTimeout(res, 300));
  }
}
