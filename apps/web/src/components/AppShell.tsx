import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { authApi } from '../lib/api';
import { useAuth } from '../stores/auth';
import { Avatar } from './Avatar';
import { UserSearch } from './UserSearch';
import { NAV_ACTIONS, NAV_BRAND, NAV_LINKS, NAV_ROW, navLink } from './nav';
import { focusRing, GlowBackdrop, Wordmark } from './ui';

/** Header + nav for the signed-in pages (the battle screen has its own header). */
export function AppShell({ children }: { children: ReactNode; wide?: boolean }) {
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
      {/* Full width like the landing nav (decision.md D-073): brand far left, sections centred, search +
          profile + log out far right. On phones the sections and search drop to their own row. */}
      <header className="sticky top-0 z-40 border-b border-ash-700/60 bg-hero-bg/75 backdrop-blur-md">
        {/* Below xl the search drops to its own row, so the bar grows instead of keeping NAV_ROW's fixed height. */}
        <div className={`${NAV_ROW} md:h-auto! md:py-2 xl:h-16! xl:py-0`}>
          <Wordmark className={NAV_BRAND} />
          <nav aria-label="Main" className={NAV_LINKS}>
            <NavLink to="/play" className={({ isActive }) => navLink(isActive)}>
              DSA
            </NavLink>
            <NavLink to="/projects" className={({ isActive }) => navLink(isActive)}>
              Programming
            </NavLink>
            {/* Not built yet: the label carries a drifting light, and the page says "coming soon". */}
            <NavLink
              to="/interviews"
              className={({ isActive }) => `${navLink(isActive)} ${isActive ? '' : 'nav-wave'}`}
            >
              Interviews
            </NavLink>
            <NavLink to="/leaderboard" className={({ isActive }) => navLink(isActive)}>
              Leaderboard
            </NavLink>
          </nav>
          <div className={NAV_ACTIONS}>
            <div className="hidden xl:block">
              <UserSearch />
            </div>
            {/* The profile button: your avatar, ringed in blue while you're on your profile (D-070). */}
            {user && (
              <NavLink
                to={`/u/${user.username}`}
                aria-label="Your profile"
                title={`${user.username} · profile`}
                className={`rounded-full transition-transform duration-200 hover:scale-105 ${focusRing}`}
              >
                {({ isActive }) => (
                  <Avatar username={user.username} url={user.avatarUrl} size={36} glow={isActive} />
                )}
              </NavLink>
            )}
            <button
              onClick={logout}
              className={`min-h-9 cursor-pointer whitespace-nowrap text-xs uppercase tracking-widest text-ash-300 transition-colors duration-200 hover:text-azure ${focusRing}`}
            >
              Log out
            </button>
          </div>
          <div className="order-last flex w-full justify-center xl:hidden md:col-span-3">
            <UserSearch />
          </div>
        </div>
      </header>
      <main className="relative">{children}</main>
    </div>
  );
}
