import type {
  InterviewCategory,
  InterviewDetail,
  InterviewLevel,
  InterviewStage,
  InterviewSummary,
} from '@thegrave/shared';
import { DIFF } from '../play/PracticeList';

export const CATEGORY_LABEL: Record<InterviewCategory, string> = {
  ARCHITECTURE: 'Architecture',
  DESIGN_TRADEOFF: 'Trade-offs',
  CODE_QUALITY: 'Code quality',
  BUG_RISK: 'Bugs & risks',
  TESTING: 'Testing',
  PERFORMANCE_SCALING: 'Performance & scale',
  SECURITY: 'Security',
  DEPENDENCIES: 'Dependencies',
  DATA_MODEL: 'Data model',
  DEVOPS: 'DevOps',
};

export const LEVEL_LABEL: Record<InterviewLevel, string> = {
  AUTO: 'Auto',
  INTERN: 'Intern',
  JUNIOR: 'Junior',
  MID: 'Mid',
  SENIOR: 'Senior',
};
export const LEVELS = Object.keys(LEVEL_LABEL) as InterviewLevel[];

/** The four visible steps of a running analysis, in order. */
export const STEPS: { stage: InterviewStage; label: string; idle: string }[] = [
  { stage: 'FETCHING', label: 'Cloning', idle: 'Fetching the repository' },
  { stage: 'READING', label: 'Reading code', idle: 'Picking the files an interviewer would open' },
  { stage: 'WRITING', label: 'Writing questions', idle: 'Drafting questions from the code' },
  { stage: 'REVIEWING', label: 'Reviewing questions', idle: 'Dropping weak or ungrounded ones' },
];

export const stageLabel = (stage: InterviewStage) =>
  STEPS.find((s) => s.stage === stage)?.label ?? 'Queued';

/** "Mid · inferred" or "Senior · chosen". */
export function levelText(s: Pick<InterviewSummary, 'requestedLevel' | 'apparentLevel'>) {
  if (s.requestedLevel === 'AUTO')
    return s.apparentLevel ? `${LEVEL_LABEL[s.apparentLevel]} · inferred` : 'Auto';
  return `${LEVEL_LABEL[s.requestedLevel]} · chosen`;
}

export const repoUrl = (s: Pick<InterviewSummary, 'owner' | 'repo'>) =>
  `https://github.com/${s.owner}/${s.repo}`;

/** Link to the exact lines at the analysed commit. */
export function evidenceUrl(
  s: Pick<InterviewSummary, 'owner' | 'repo' | 'commitSha'>,
  e: { path: string; startLine: number; endLine: number },
) {
  if (!s.commitSha) return null;
  const path = e.path.split('/').map(encodeURIComponent).join('/');
  return `${repoUrl(s)}/blob/${s.commitSha}/${path}#L${e.startLine}-L${e.endLine}`;
}

export const lineRange = (e: { startLine: number; endLine: number }) =>
  e.startLine === e.endLine ? `L${e.startLine}` : `L${e.startLine}–L${e.endLine}`;

export function timeAgo(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

/** "35 s" / "5 min" / "5h" for a wait that ends at `iso`. */
export function untilText(iso: string, now = Date.now(), long = false) {
  const s = Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000));
  if (s < 90 && !long) return `${s} s`;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  return `${Math.max(1, Math.round(s / 3600))}h`;
}

const bullets = (items: string[]) => items.map((i) => `- ${i}`).join('\n');

/** The whole set as Markdown, for pasting into notes. */
export function toMarkdown(d: InterviewDetail): string {
  const out = [`# Interview questions: ${d.owner}/${d.repo}`, ''];
  d.questions.forEach((q, i) => {
    out.push(
      `## ${i + 1}. ${q.question}`,
      '',
      `*${CATEGORY_LABEL[q.category]} · ${DIFF[q.difficulty].label}*`,
      '',
      `Why we ask: ${q.whyAsked}`,
      '',
    );
    for (const e of q.evidence) out.push(`Evidence: \`${e.path}\` ${lineRange(e)}`, '');
    if (q.strongAnswer.length) out.push('**A strong answer covers**', bullets(q.strongAnswer), '');
    if (q.followUps.length) out.push('**Follow-up probes**', bullets(q.followUps), '');
    if (q.redFlags.length) out.push('**Red flags**', bullets(q.redFlags), '');
  });
  return out.join('\n');
}
