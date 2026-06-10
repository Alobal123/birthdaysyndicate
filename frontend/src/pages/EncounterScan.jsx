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

  const parseEncounterId = (text) => {
    const raw = (text || "").trim();
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

    // Accept direct UUID payloads.
    if (uuidRegex.test(raw)) {
      return raw.match(uuidRegex)?.[0] || "";
    }

    // Accept full links like https://.../encounter/<uuid>.
    const pathMatch = raw.match(/\/encounter\/([0-9a-f-]{36})/i);
    if (pathMatch?.[1]) {
      return pathMatch[1];
    }

    return "";
  };

  const handleScan = useCallback(
    async (text) => {
      if (!session || busy) {
        return false;
      }

      const encounterId = parseEncounterId(text);
      if (!encounterId) {
        setError("Invalid encounter QR");
        return false;
      }

      setBusy(true);
      setError("");
      try {
        await joinEncounter(encounterId, session.id);
        navigate(`/encounter/${encounterId}/strategy`);
        return true;
      } catch (err) {
        setError(err.message || "Could not join encounter");
        return false;
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
