import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import {
  FullScreenMessage,
  GuestRoute,
  LandingRoute,
  ProtectedRoute,
} from './components/ProtectedRoute';
import { refreshSession } from './lib/api';
import { HomePage } from './pages/HomePage';
import { InterviewsPage } from './pages/InterviewsPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { LoginPage } from './pages/LoginPage';
import { ProfilePage } from './pages/ProfilePage';
import { ProjectsPage } from './pages/ProjectsPage';
import { RegisterPage } from './pages/RegisterPage';

// Monaco is large: only load it when a battle opens.
const BattlePage = lazy(() => import('./pages/BattlePage'));
const InterviewDetailPage = lazy(() => import('./pages/InterviewDetailPage'));
const PracticePage = lazy(() => import('./pages/PracticePage'));
const ProjectPage = lazy(() => import('./pages/ProjectPage'));
// framer-motion stays out of the app bundle for signed-in pages.
const LandingPage = lazy(() => import('./pages/LandingPage'));

export default function App() {
  // Silent refresh on boot: the access token lives in memory, so every page load restores it from the cookie.
  useEffect(() => {
    void refreshSession();
  }, []);

  return (
    <Routes>
      <Route element={<LandingRoute />}>
        <Route
          path="/"
          element={
            <Suspense fallback={<div className="min-h-screen" />}>
              <LandingPage />
            </Suspense>
          }
        />
      </Route>
      <Route element={<GuestRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>
      <Route element={<ProtectedRoute />}>
        <Route path="/play" element={<HomePage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route
          path="/projects/:slug"
          element={
            <Suspense fallback={<FullScreenMessage>Loading workspace…</FullScreenMessage>}>
              <ProjectPage />
            </Suspense>
          }
        />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/interviews" element={<InterviewsPage />} />
        <Route
          path="/interviews/:id"
          element={
            <Suspense fallback={<FullScreenMessage>Loading analysis…</FullScreenMessage>}>
              <InterviewDetailPage />
            </Suspense>
          }
        />
        <Route path="/u/:username" element={<ProfilePage />} />
        <Route
          path="/practice/:slug"
          element={
            <Suspense fallback={<FullScreenMessage>Loading problem…</FullScreenMessage>}>
              <PracticePage />
            </Suspense>
          }
        />
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
