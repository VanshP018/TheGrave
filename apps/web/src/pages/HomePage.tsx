import { useQuery } from '@tanstack/react-query';
import type { PublicUser } from '@thegrave/shared';
import { Link } from 'react-router';
import { AppShell } from '../components/AppShell';
import { Lobby } from '../components/Lobby';
import { PracticeList } from '../components/play/PracticeList';
import { RoomPanel } from '../components/play/RoomPanel';
import { focusRing } from '../components/ui';
import { api } from '../lib/api';
import { usePreferredLanguage } from '../lib/preferences';
import { useRoom } from '../stores/room';

/** The play page (decision.md D-064, D-065): ranked matchmaking and private rooms on top, practice below. */
export function HomePage() {
  // Fetched through the API (not just read from the store) so the 401 → refresh → retry path is exercised,
  // and refetched after every battle so the rating shown is current.
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api<PublicUser>('/me') });
  const [language, setLanguage] = usePreferredLanguage();
  const inRoom = useRoom((s) => !!s.room);

  return (
    <AppShell wide>
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-azure">Lobby</p>
            <h1 className="mt-2 text-[clamp(1.75rem,4vw,2.5rem)] font-semibold leading-tight tracking-[-0.03em] text-ink">
              {`Welcome, ${me?.username ?? '…'}`}
            </h1>
          </div>
          <div className="flex items-center gap-6 text-sm">
            <div className="text-right">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ash-400">
                Rating
              </p>
              <p className="font-mono text-2xl font-semibold text-azure">{me?.rating ?? '—'}</p>
            </div>
            {me && (
              <Link
                to={`/u/${me.username}`}
                className={`rounded-md bg-white/[0.05] px-4 py-2 text-ash-300 transition-colors hover:bg-white/[0.09] hover:text-ink ${focusRing}`}
              >
                View profile
              </Link>
            )}
          </div>
        </div>

        <Lobby language={language} onLanguage={setLanguage} />
        <p className="mt-3 text-xs text-ash-400">
          {inRoom
            ? 'You’re in a private room: leave or close it to queue for ranked.'
            : 'First fully accepted solution wins · ratings update the moment the match ends'}
        </p>

        <div className="mt-4">
          <RoomPanel />
        </div>

        <PracticeList />
      </section>
    </AppShell>
  );
}
