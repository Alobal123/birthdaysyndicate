import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import QRScanner from "../components/QRScanner";
import { joinEncounter } from "../lib/api";
import { loadPlayerSession } from "../lib/session";

export default function EncounterScanPage() {
  const session = loadPlayerSession();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleScan = useCallback(
    async (text) => {
      if (!session || busy) {
        return;
      }

      const match = text.match(/\/encounter\/([0-9a-f-]{36})/i);
      if (!match?.[1]) {
        setError("Invalid encounter QR");
        return;
      }

      setBusy(true);
      setError("");
      try {
        const encounterId = match[1];
        await joinEncounter(encounterId, session.id);
        navigate(`/encounter/${encounterId}/strategy`);
      } catch (err) {
        setError(err.message || "Could not join encounter");
      } finally {
        setBusy(false);
      }
    },
    [busy, navigate, session]
  );

  return (
    <main className="mx-auto max-w-xl p-6">
      <section className="panel p-6 animate-riseIn">
        <h1 className="font-display text-3xl text-ink">Scan Encounter</h1>
        <p className="mt-2 text-sm text-steel">Point your camera at your rival's QR code.</p>
        <div className="mt-4">
          <QRScanner onScan={handleScan} />
        </div>
        {error ? <p className="mt-3 text-sm text-ember">{error}</p> : null}
        {busy ? <p className="mt-2 text-sm text-steel">Processing...</p> : null}
        <div className="mt-4">
          <button className="btn-ghost" onClick={() => navigate("/dashboard")}>Back To Dashboard</button>
        </div>
      </section>
    </main>
  );
}
