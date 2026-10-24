import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProjectDetail } from '@thegrave/shared';
import { Link, useParams } from 'react-router';
import { BackIcon } from '../components/battle/icons';
import { HintBot } from '../components/project/HintBot';
import { PROJECT_DIFF, ProjectWorkspace } from '../components/project/ProjectWorkspace';
import { FullScreenMessage } from '../components/ProtectedRoute';
import { focusRing } from '../components/ui';
import { api, ApiRequestError } from '../lib/api';

/** Practice on one programming challenge (decision.md D-066). */
export default function ProjectPage() {
  const { slug = '' } = useParams();
  const qc = useQueryClient();
  const { data: project, error } = useQuery({
    queryKey: ['project', slug],
    queryFn: () => api<ProjectDetail>(`/projects/${slug}`),
  });

  if (error) {
    return (
      <FullScreenMessage>
        {error instanceof ApiRequestError && error.status === 404
          ? 'Challenge not found.'
          : 'Could not load the challenge.'}
      </FullScreenMessage>
    );
  }
  if (!project) return <FullScreenMessage>Loading workspace…</FullScreenMessage>;

  return (
    <ProjectWorkspace
      project={project}
      storageKey={`project:${slug}:files`}
      submit={async (files) =>
        (
          await api<{ id: string }>(`/projects/${slug}/runs`, {
            method: 'POST',
            json: { kind: 'SUBMIT', files },
          })
        ).id
      }
      onSubmitted={() => void qc.invalidateQueries({ queryKey: ['projects'] })}
      renderAssistant={({ files, activeFile }) => (
        <HintBot slug={project.slug} title={project.title} files={files} activeFile={activeFile} />
      )}
      headerStart={
        <>
          <Link
            to="/projects"
            className={`flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-ash-800 ${focusRing}`}
          >
            <BackIcon className="h-4 w-4" />
            Programming
          </Link>
          <span className="h-5 w-px shrink-0 bg-ash-700" aria-hidden />
          <p className="truncate text-sm font-semibold text-ink">{project.title}</p>
          <span
            className={`hidden shrink-0 rounded-sm border px-2 py-0.5 text-[11px] font-medium capitalize sm:inline ${PROJECT_DIFF[project.difficulty]}`}
          >
            {project.difficulty.toLowerCase()}
          </span>
        </>
      }
    />
  );
}
