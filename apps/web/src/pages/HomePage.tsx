import { useQuery } from '@tanstack/react-query';
import type { PublicUser } from '@thegrave/shared';
import { useNavigate } from 'react-router';
import { api, authApi } from '../lib/api';
import { useAuth } from '../stores/auth';

export function HomePage() {
  const clear = useAuth((s) => s.clear);
  const navigate = useNavigate();
  // Fetched through the API (not just read from the store) so the 401 → refresh → retry path is exercised.
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api<PublicUser>('/me') });

  const logout = async () => {
    await authApi.logout().catch(() => undefined);
    clear();
    navigate('/login', { replace: true });
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3 sm:px-6">
        <span className="font-bold tracking-tight">theGrave</span>
        <button onClick={logout} className="text-sm text-zinc-400 hover:text-zinc-100">
          Log out
        </button>
      </header>
      <section className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-bold">Welcome, {me?.username ?? '…'}</h1>
        <p className="mt-2 text-zinc-400">
          Rating <span className="font-mono text-emerald-400">{me?.rating ?? '—'}</span>.
          Matchmaking arrives in Phase 3.
        </p>
      </section>
    </main>
  );
}
