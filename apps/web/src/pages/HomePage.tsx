import { useQuery } from '@tanstack/react-query';
import type { PublicUser } from '@thegrave/shared';
import { AppShell } from '../components/AppShell';
import { Lobby } from '../components/Lobby';
import { api } from '../lib/api';

export function HomePage() {
  // Fetched through the API (not just read from the store) so the 401 → refresh → retry path is exercised,
  // and refetched after every battle so the rating shown is current.
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api<PublicUser>('/me') });

  return (
    <AppShell>
      <section className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-bold">Welcome, {me?.username ?? '…'}</h1>
        <p className="mt-2 text-zinc-400">
          Rating <span className="font-mono text-zinc-100">{me?.rating ?? '—'}</span>
        </p>
        <Lobby />
      </section>
    </AppShell>
  );
}
