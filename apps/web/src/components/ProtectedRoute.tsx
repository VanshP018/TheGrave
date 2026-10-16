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

export function FullScreenMessage({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen grid place-items-center bg-zinc-950 text-zinc-400">
      {children}
    </main>
  );
}
