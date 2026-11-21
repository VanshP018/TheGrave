import { AppShell } from '../components/AppShell';
import { FindMatchCard, Lobby } from '../components/Lobby';
import { RoomPanel } from '../components/play/RoomPanel';
import { ProjectPracticeList } from '../components/project/ProjectPracticeList';
import { useRoom } from '../stores/room';

/**
 * Programming (decision.md D-066, D-067, D-069): ranked matchmaking and private rooms on top, the practice
 * set below, laid out like the DSA page.
 */
export function ProjectsPage() {
  const inRoom = useRoom((st) => !!st.room);

  return (
    <AppShell wide>
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
        <div className="max-w-2xl">
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-azure">Programming</p>
          <h1 className="mt-2 text-[clamp(1.75rem,4vw,2.5rem)] font-semibold leading-tight tracking-[-0.03em] text-ink">
            Debug real codebases
          </h1>
          <p className="mt-3 text-[15px] font-light leading-relaxed text-ash-300">
            Each challenge is a small project with bugs planted in it. Read the bug reports, explore
            the files, run things in the terminal, and submit when the hidden tests should pass.
          </p>
        </div>

        {/* Same matchmaking and rooms as DSA, against their own queue (decision.md D-067). */}
        <div className="mt-8">
          <Lobby />
          <p className="mt-3 text-xs text-ash-400">
            {inRoom
              ? 'You’re in a private room: leave or close it to queue for ranked.'
              : 'Both players get the same buggy codebase · first to pass every hidden test wins · When few players are online you may be matched with a practice bot'}
          </p>
          <div className="mt-4">
            <RoomPanel defaultMode="PROGRAMMING" lead={<FindMatchCard mode="PROGRAMMING" />} />
          </div>
        </div>

        <ProjectPracticeList />
      </section>
    </AppShell>
  );
}
