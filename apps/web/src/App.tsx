import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { GuestRoute, ProtectedRoute } from './components/ProtectedRoute';
import { refreshSession } from './lib/api';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';

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
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
