import { Link } from 'react-router';
import { AppShell } from '../components/AppShell';
import { btnSecondary } from '../components/ui';

/** Placeholder for the interview practice section, which is not built yet. */
export function InterviewsPage() {
  return (
    <AppShell>
      <section className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-4 py-16 text-center sm:px-6">
        <p className="text-xs font-medium uppercase tracking-[0.3em] text-azure">Interviews</p>
        <h1 className="mt-3 text-[clamp(2.5rem,7vw,4.5rem)] font-bold leading-[0.95] tracking-[-0.05em] text-ink">
          Coming soon
        </h1>
        <p className="mt-5 max-w-md text-pretty text-[15px] font-light leading-relaxed text-ash-300">
          Mock interviews, live with another player. We are still building this one, check back
          soon.
        </p>
        <Link to="/play" className={`${btnSecondary} mt-8 rounded-md`}>
          Back to DSA
        </Link>
      </section>
    </AppShell>
  );
}
