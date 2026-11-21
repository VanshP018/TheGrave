import {
  INTERVIEW_ERROR_MESSAGES,
  parseGithubRepoUrl,
  type InterviewLevel,
  type InterviewListResponse,
} from '@thegrave/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiRequestError } from '../../lib/api';
import { isActive, useCreateInterview } from '../../lib/interviews';
import { useNow } from '../../lib/useNow';
import { btnPrimary, card, focusRing, input } from '../ui';
import { LEVEL_LABEL, LEVELS, untilText } from './labels';

/** The server's reason a submit was refused, in the user's words. */
function submitError(err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.status === 429) return 'Daily limit reached. Try again later.';
    if (err.status === 400) return 'Enter a public GitHub repository URL.';
    return err.body.message || INTERVIEW_ERROR_MESSAGES.INTERNAL;
  }
  return 'Could not reach the server. Try again.';
}

export function RepoForm({
  data,
  initial,
}: {
  data: InterviewListResponse | undefined;
  initial?: { url: string; level: InterviewLevel };
}) {
  const navigate = useNavigate();
  const create = useCreateInterview();
  const [url, setUrl] = useState(initial?.url ?? '');
  const [level, setLevel] = useState<InterviewLevel>(initial?.level ?? 'AUTO');
  const [error, setError] = useState<string | null>(null);
  const now = useNow(30_000);

  const active = data?.items.find((i) => isActive(i.status));
  const quota = data?.quota;
  const left = quota ? Math.max(0, quota.limit - quota.used) : null;
  const noCapacity = data?.capacity.available === false;
  const disabled = data !== undefined && !data.enabled;
  const blockedNote = disabled
    ? 'AI interviews are not set up on this server.'
    : left === 0
      ? `Daily limit reached${quota?.resetsAt ? ` · resets in ${untilText(quota.resetsAt, now, true)}` : ''}`
      : noCapacity
        ? `The AI has reached its limit for today${data?.capacity.retryAt ? ` · try again in ${untilText(data.capacity.retryAt, now, true)}` : ''}`
        : null;

  const validate = (value: string) => {
    const msg = parseGithubRepoUrl(value) ? null : 'Enter a public GitHub repository URL.';
    setError(msg);
    return msg === null;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!validate(url)) return;
    create.mutate(
      { repoUrl: url.trim(), level },
      {
        onSuccess: ({ id }) => void navigate(`/interviews/${id}`),
        onError: (err) => {
          // The 409 body also names the running analysis (not part of the shared ApiError type).
          const activeId =
            err instanceof ApiRequestError
              ? (err.body as { activeId?: unknown }).activeId
              : undefined;
          if (typeof activeId === 'string') void navigate(`/interviews/${activeId}`);
          else setError(submitError(err));
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className={`${card} p-4 sm:p-5`} noValidate>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="min-w-0 flex-1">
          <label htmlFor="repo-url" className="sr-only">
            GitHub repository URL
          </label>
          <input
            id="repo-url"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://github.com/you/project"
            value={url}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'repo-url-error' : undefined}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError(null);
            }}
            onBlur={() => url.trim() && validate(url)}
            className={`${input} disabled:opacity-50`}
          />
        </div>
        {active ? (
          <Link to={`/interviews/${active.id}`} className={`${btnPrimary} sm:min-w-44`}>
            Analysis in progress
          </Link>
        ) : (
          <button
            type="submit"
            disabled={disabled || blockedNote !== null || create.isPending}
            className={`${btnPrimary} sm:min-w-44`}
          >
            {create.isPending ? 'Starting…' : 'Analyze'}
          </button>
        )}
      </div>
      {error && (
        <p id="repo-url-error" role="alert" className="mt-2 text-sm text-red-400">
          {error}
        </p>
      )}

      <fieldset className="mt-4 flex flex-wrap items-center gap-2" disabled={disabled}>
        <legend className="sr-only">Level</legend>
        <span aria-hidden className="mr-1 text-sm text-ash-300">
          Level
        </span>
        {LEVELS.map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={level === l}
            onClick={() => setLevel(l)}
            className={`h-9 cursor-pointer rounded-full px-4 text-sm transition-colors ${focusRing} ${
              level === l
                ? 'bg-azure/15 text-azure-light ring-1 ring-azure/40'
                : 'bg-white/[0.05] text-ash-300 hover:bg-white/[0.08] hover:text-ink'
            }`}
          >
            {LEVEL_LABEL[l]}
          </button>
        ))}
      </fieldset>

      <p className="mt-4 text-xs text-ash-400">
        {blockedNote ?? (
          <>
            Public repos only · we never run your code
            {left !== null && quota && ` · ${left} of ${quota.limit} left today`}
          </>
        )}
      </p>
    </form>
  );
}
