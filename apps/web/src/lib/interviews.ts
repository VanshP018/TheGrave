import type {
  InterviewDetail,
  InterviewLevel,
  InterviewListResponse,
  InterviewStatus,
} from '@thegrave/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export const interviewsApi = {
  list: () => api<InterviewListResponse>('/interviews'),
  get: (id: string) => api<InterviewDetail>(`/interviews/${id}`),
  create: (json: { repoUrl: string; level: InterviewLevel }) =>
    api<{ id: string; status: InterviewStatus }>('/interviews', { method: 'POST', json }),
  remove: (id: string) => api<void>(`/interviews/${id}`, { method: 'DELETE' }),
};

/** How often a running analysis is re-read (plan.md 2.2). */
const POLL_MS = 1500;
export const isActive = (status: InterviewStatus) => status === 'QUEUED' || status === 'RUNNING';

/** The user's analyses; polls while any of them is still running, and stops once all are finished. */
export function useInterviews() {
  return useQuery({
    queryKey: ['interviews'],
    queryFn: interviewsApi.list,
    refetchInterval: (q) => (q.state.data?.items.some((i) => isActive(i.status)) ? POLL_MS : false),
  });
}

/** One analysis; polls every 1.5 s until it is DONE or FAILED. */
export function useInterview(id: string) {
  return useQuery({
    queryKey: ['interviews', id],
    queryFn: () => interviewsApi.get(id),
    retry: (count, err) => (err as { status?: number }).status !== 404 && count < 2,
    refetchInterval: (q) => (q.state.data && isActive(q.state.data.status) ? POLL_MS : false),
  });
}

export function useCreateInterview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: interviewsApi.create,
    onSettled: () => qc.invalidateQueries({ queryKey: ['interviews'] }),
  });
}

export function useDeleteInterview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: interviewsApi.remove,
    onSuccess: (_r, id) => {
      qc.removeQueries({ queryKey: ['interviews', id] });
      return qc.invalidateQueries({ queryKey: ['interviews'] });
    },
  });
}
