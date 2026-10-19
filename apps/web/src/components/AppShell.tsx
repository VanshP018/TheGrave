import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { authApi } from '../lib/api';
import { useAuth } from '../stores/auth';
import { focusRing, GlowBackdrop, Wordmark } from './ui';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `relative py-1 text-xs uppercase tracking-widest transition-colors duration-200 ${focusRing} ${
    isActive
      ? 'text-ink after:absolute after:inset-x-0 after:-bottom-[13px] after:h-px after:bg-azure'
      : 'text-ash-300 hover:text-ink'
  }`;

/** Header + nav for the signed-in pages (the battle screen has its own header). */
export function AppShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const user = useAuth((s) => s.user);
  const clear = useAuth((s) => s.clear);
  const navigate = useNavigate();

  const logout = async () => {
    await authApi.logout().catch(() => undefined);
    clear();
    navigate('/login', { replace: true });
  };

  return (
    <div className="relative min-h-screen">
      <GlowBackdrop fixed />
      <header className="sticky top-0 z-40 border-b border-ash-700/60 bg-hero-bg/75 backdrop-blur-md">
        {/* On phones the nav drops to its own row so nothing has to shrink below a tappable size. */}
        <div
          className={`mx-auto flex ${wide ? 'max-w-6xl' : 'max-w-5xl'} flex-wrap items-center justify-between gap-x-8 gap-y-3 px-4 py-3 sm:px-6`}
        >
          <Wordmark className="text-lg" />
          <nav className="order-last flex w-full gap-6 sm:order-none sm:w-auto sm:flex-1">
            <NavLink to="/play" className={linkClass}>
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
          <button
            onClick={logout}
            className={`min-h-9 cursor-pointer text-xs uppercase tracking-widest text-ash-300 transition-colors duration-200 hover:text-azure ${focusRing}`}
          >
            Log out
          </button>
        </div>
      </header>
      <main className="relative">{children}</main>
    </div>
  );
}
