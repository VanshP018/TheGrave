import type { InterviewDetail } from '@thegrave/shared';
import { useNow } from '../../lib/useNow';
import { card } from '../ui';
import { STEPS, untilText } from './labels';

/** The four stages of a running analysis, with the server's detail line and a rate-limit countdown. */
export function ProgressSteps({ d }: { d: InterviewDetail }) {
  const now = useNow(1000);
  const current = STEPS.findIndex((s) => s.stage === d.stage);
  const waiting = d.progress?.waitingUntil;
  const waitingActive = waiting && new Date(waiting).getTime() > now ? waiting : null;
  // Before the first stage starts (queued, or parked for a retry) the first step carries the wait.
  const activeIdx = current === -1 ? 0 : current;

  return (
    <div className={`${card} p-5 sm:p-6`}>
      <ol className="space-y-4">
        {STEPS.map((s, i) => {
          const done = current !== -1 && i < current;
          const isCurrent = i === activeIdx;
          const detail = isCurrent ? d.progress?.detail || s.idle : null;
          return (
            <li
              key={s.stage}
              aria-current={isCurrent ? 'step' : undefined}
              className="flex items-start gap-3"
            >
              <span
                aria-hidden
                className={`mt-1 flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
                  done
                    ? 'bg-emerald-400/20 text-emerald-400'
                    : isCurrent
                      ? 'animate-pulse bg-azure shadow-[0_0_12px_rgb(92_184_255/0.7)]'
                      : 'border border-ash-600'
                }`}
              >
                {done ? '✓' : ''}
              </span>
              <div className="min-w-0">
                <p className={isCurrent || done ? 'text-ink' : 'text-ash-400'}>
                  {s.label}
                  <span className="sr-only">
                    {done ? ' (done)' : isCurrent ? ' (in progress)' : ''}
                  </span>
                </p>
                {detail && <p className="text-sm text-ash-300">{detail}</p>}
                {isCurrent && waitingActive && (
                  <p className="text-sm text-ash-400">
                    Waiting for AI capacity · resuming in {untilText(waitingActive, now)}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-5 text-xs text-ash-400">
        This usually takes about a minute (longer when the AI is busy). You can leave this page.
      </p>
    </div>
  );
}
