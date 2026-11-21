import {
  INTERVIEW_ERROR_MESSAGES,
  type InterviewLevel,
  type InterviewSummary,
} from '@thegrave/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { isActive, useCreateInterview, useDeleteInterview } from '../../lib/interviews';
import { btnSecondary, card, focusRing } from '../ui';
import { LEVEL_LABEL, levelText, repoUrl, stageLabel, timeAgo } from './labels';

const PILL: Record<InterviewSummary['status'], { text: string; tone: string }> = {
  DONE: { text: 'Done', tone: 'text-emerald-400' },
  RUNNING: { text: 'Running', tone: 'text-azure-light' },
  QUEUED: { text: 'Queued', tone: 'text-ash-300' },
  FAILED: { text: 'Failed', tone: 'text-red-400' },
};

export function StatusPill({
  status,
  retrying = false,
}: {
  status: InterviewSummary['status'];
  retrying?: boolean;
}) {
  const p = PILL[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-medium ${p.tone}`}>
      <span
        aria-hidden
        className={`size-1.5 rounded-full bg-current ${isActive(status) ? 'animate-pulse' : ''}`}
      />
      {retrying ? 'Queued · retrying' : p.text}
    </span>
  );
}

function detailText(i: InterviewSummary) {
  if (i.status === 'DONE') return `${i.questionCount} questions`;
  if (i.status === 'FAILED') return INTERVIEW_ERROR_MESSAGES[i.errorCode ?? 'INTERNAL'];
  return i.stage === 'QUEUED' ? 'Waiting to start…' : `${stageLabel(i.stage)}…`;
}

function Row({
  item,
  onRetry,
  retryDisabled,
}: {
  item: InterviewSummary;
  onRetry: (url: string, level: InterviewLevel) => void;
  retryDisabled: boolean;
}) {
  const remove = useDeleteInterview();
  const [confirming, setConfirming] = useState(false);
  const name = `${item.owner}/${item.repo}`;
  const meta = [
    item.commitSha?.slice(0, 7),
    item.apparentLevel && item.requestedLevel === 'AUTO'
      ? LEVEL_LABEL[item.apparentLevel]
      : LEVEL_LABEL[item.requestedLevel],
    detailText(item),
    timeAgo(item.createdAt),
  ].filter(Boolean);

  return (
    <li className={`${card} flex flex-wrap items-center gap-x-4 gap-y-2 p-4`}>
      <Link
        to={`/interviews/${item.id}`}
        className={`min-w-0 flex-1 basis-60 rounded-sm ${focusRing}`}
        title={levelText(item)}
      >
        <span className="block truncate font-medium text-ink">{name}</span>
        <span className="mt-0.5 block text-sm text-ash-300">{meta.join(' · ')}</span>
      </Link>
      <StatusPill status={item.status} />
      {confirming ? (
        <span className="flex items-center gap-2 text-sm">
          <span className="text-ash-300">Delete?</span>
          <button
            type="button"
            onClick={() => remove.mutate(item.id)}
            disabled={remove.isPending}
            className={`${btnSecondary} min-h-9 border-red-400/40 text-red-400`}
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className={`${btnSecondary} min-h-9`}
          >
            No
          </button>
        </span>
      ) : (
        <span className="flex items-center gap-2">
          {item.status === 'FAILED' && (
            <button
              type="button"
              aria-label={`Retry ${name}`}
              disabled={retryDisabled}
              onClick={() => onRetry(repoUrl(item), item.requestedLevel)}
              className={`${btnSecondary} min-h-9`}
            >
              Retry
            </button>
          )}
          <button
            type="button"
            aria-label={`Delete ${name}`}
            onClick={() => setConfirming(true)}
            className={`${btnSecondary} min-h-9`}
          >
            Delete
          </button>
        </span>
      )}
    </li>
  );
}

export function AnalysisList({
  items,
  blocked,
  onRetried,
}: {
  items: InterviewSummary[];
  blocked: boolean;
  onRetried: (id: string) => void;
}) {
  const create = useCreateInterview();
  return (
    <ul className="mt-3 space-y-3">
      {items.map((i) => (
        <Row
          key={i.id}
          item={i}
          retryDisabled={blocked || create.isPending}
          onRetry={(repoUrl, level) =>
            create.mutate({ repoUrl, level }, { onSuccess: ({ id }) => onRetried(id) })
          }
        />
      ))}
    </ul>
  );
}
