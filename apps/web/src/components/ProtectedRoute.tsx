import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../stores/auth';
import { RealtimeProvider } from './RealtimeProvider';

export function ProtectedRoute() {
  const status = useAuth((s) => s.status);
  const location = useLocation();
  if (status === 'loading') return <FullScreenMessage>Loading…</FullScreenMessage>;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location }} />;
  return (
    <RealtimeProvider>
      <Outlet />
    </RealtimeProvider>
  );
}

/** For /login and /register: bounce signed-in users to the app. */
export function GuestRoute() {
  const status = useAuth((s) => s.status);
  if (status === 'loading') return <FullScreenMessage>Loading…</FullScreenMessage>;
  if (status === 'authenticated') return <Navigate to="/play" replace />;
  return <Outlet />;
}

/** For "/": the landing page is for visitors only; signed-in users (including via the logo) go to the app. */
export function LandingRoute() {
  const status = useAuth((s) => s.status);
  if (status === 'loading') return <FullScreenMessage>Loading…</FullScreenMessage>;
  if (status === 'authenticated') return <Navigate to="/play" replace />;
  return <Outlet />;
}

export function FullScreenMessage({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center text-sm uppercase tracking-widest text-ash-300">
      <span className="flex items-center gap-3">
        <span className="h-2 w-2 rounded-full bg-azure motion-safe:animate-pulse" aria-hidden />
        {children}
      </span>
    </main>
  );
}
