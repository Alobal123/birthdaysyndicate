import { Navigate, Route, Routes } from "react-router-dom";
import ClaimPage from "./pages/Claim";
import DashboardPage from "./pages/Dashboard";
import EncounterHostPage from "./pages/EncounterHost";
import EncounterLinkJoinPage from "./pages/EncounterLinkJoin";
import EncounterScanPage from "./pages/EncounterScan";
import LoginPage from "./pages/Login";
import RevealPage from "./pages/Reveal";
import StrategyPage from "./pages/Strategy";
import AdminPage from "./pages/Admin";
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
      <Route
        path="/encounter/host"
        element={
          <RequirePlayer>
            <EncounterHostPage />
          </RequirePlayer>
        }
      />
      <Route
        path="/encounter/scan"
        element={
          <RequirePlayer>
            <EncounterScanPage />
          </RequirePlayer>
        }
      />
      <Route
        path="/encounter/:id"
        element={
          <RequirePlayer>
            <EncounterLinkJoinPage />
          </RequirePlayer>
        }
      />
      <Route
        path="/encounter/:id/strategy"
        element={
          <RequirePlayer>
            <StrategyPage />
          </RequirePlayer>
        }
      />
      <Route
        path="/encounter/:id/reveal"
        element={
          <RequirePlayer>
            <RevealPage />
          </RequirePlayer>
        }
      />
      <Route
        path="/claim"
        element={
          <RequirePlayer>
            <ClaimPage />
          </RequirePlayer>
        }
      />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
