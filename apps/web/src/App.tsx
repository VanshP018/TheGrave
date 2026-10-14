import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { FullScreenMessage, GuestRoute, ProtectedRoute } from './components/ProtectedRoute';
import { refreshSession } from './lib/api';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';

// Monaco is large: only load it when a battle opens.
const BattlePage = lazy(() => import('./pages/BattlePage'));

export default function App() {
  // Silent refresh on boot: the access token lives in memory, so every page load restores it from the cookie.
  useEffect(() => {
    void refreshSession();
  }, []);

  return (
    <Routes>
      <Route element={<GuestRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<HomePage />} />
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
