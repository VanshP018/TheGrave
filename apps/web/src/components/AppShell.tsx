import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { authApi } from '../lib/api';
import { useAuth } from '../stores/auth';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-2.5 py-1 text-sm ${isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100'}`;

/** Header + nav for the signed-in pages (the battle screen has its own header). */
export function AppShell({ children }: { children: ReactNode }) {
  const user = useAuth((s) => s.user);
  const clear = useAuth((s) => s.clear);
  const navigate = useNavigate();

  const logout = async () => {
    await authApi.logout().catch(() => undefined);
    clear();
    navigate('/login', { replace: true });
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3 sm:px-6">
        <nav className="flex items-center gap-1">
          <span className="mr-3 font-bold tracking-tight">theGrave</span>
          <NavLink to="/" end className={linkClass}>
            Play
          </NavLink>
          <NavLink to="/leaderboard" className={linkClass}>
            Leaderboard
          </NavLink>
          {user && (
            <NavLink to={`/u/${user.username}`} className={linkClass}>
              Profile
            </NavLink>
          )}
        </nav>
        <button onClick={logout} className="text-sm text-zinc-400 hover:text-zinc-100">
          Log out
        </button>
      </header>
      {children}
    </main>
  );
}
