import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { FullScreenMessage, GuestRoute, ProtectedRoute } from './components/ProtectedRoute';
import { refreshSession } from './lib/api';
import { HomePage } from './pages/HomePage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { LoginPage } from './pages/LoginPage';
import { ProfilePage } from './pages/ProfilePage';
import { RegisterPage } from './pages/RegisterPage';

// Monaco is large: only load it when a battle opens.
const BattlePage = lazy(() => import('./pages/BattlePage'));
// framer-motion + the Spline loader stay out of the app bundle for signed-in pages.
const LandingPage = lazy(() => import('./pages/LandingPage'));

export default function App() {
  // Silent refresh on boot: the access token lives in memory, so every page load restores it from the cookie.
  useEffect(() => {
    void refreshSession();
  }, []);

  return (
    <Routes>
      <Route
        path="/"
        element={
          <Suspense fallback={<div className="min-h-screen bg-hero-bg" />}>
            <LandingPage />
          </Suspense>
        }
      />
      <Route element={<GuestRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>
      <Route element={<ProtectedRoute />}>
        <Route path="/play" element={<HomePage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/u/:username" element={<ProfilePage />} />
        <Route
          path="/battle/:id"
          element={
            <Suspense fallback={<FullScreenMessage>Loading battle…</FullScreenMessage>}>
              <BattlePage />
            </Suspense>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
