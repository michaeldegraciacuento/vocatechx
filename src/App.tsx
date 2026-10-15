import { useAuth } from "./auth/context";
import AppLayout from "./layout/AppLayout";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import LoginPage from "./pages/LoginPage";

/**
 * Chooses the screen from the backend session. Protected pages only exist
 * inside AppLayout, which is rendered solely for a fully active session; the
 * backend independently rejects protected commands without one.
 */
function App() {
  const { user, loading } = useAuth();

  if (loading) return <div className="min-h-screen bg-[#101827]" aria-busy="true" />;
  if (!user) return <LoginPage />;
  if (user.mustChangePassword) return <ChangePasswordPage />;
  return <AppLayout />;
}

export default App;
