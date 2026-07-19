import { Navigate, Route, Routes } from "react-router-dom";
import DashboardPage from "./pages/Dashboard";
import LoginPage from "./pages/Login";
import AdminPage from "./pages/Admin";
import AdminQuestionsPage from "./pages/AdminQuestions";
import { loadPlayerSession } from "./lib/session";

function RequirePlayer({ children }) {
  const session = loadPlayerSession();
  if (!session) {
    return <Navigate to="/" replace />;
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route
        path="/dashboard"
        element={
          <RequirePlayer>
            <DashboardPage />
          </RequirePlayer>
        }
      />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/admin/questions" element={<AdminQuestionsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
