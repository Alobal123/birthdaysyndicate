import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { joinEncounter } from "../lib/api";
import { loadPlayerSession } from "../lib/session";

export default function EncounterLinkJoinPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const session = loadPlayerSession();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const onJoin = async () => {
    if (!session?.id || !id) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await joinEncounter(id, session.id);
      navigate(`/encounter/${id}/strategy`);
    } catch (err) {
      setError(err.message || "Could not join encounter");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!session?.id || !id || busy) {
      return;
    }
    onJoin();
    // Intentionally trigger when link id/session become available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, session?.id]);

  return (
    <main className="mx-auto max-w-xl p-6">
      <section className="panel p-6 animate-riseIn">
        <h1 className="font-display text-3xl text-ink">Encounter Invite</h1>
        <p className="mt-2 text-sm text-steel">Join this encounter from the shared QR link.</p>

        {!session ? <p className="mt-4 text-sm text-ember">Sign in first to join this encounter.</p> : null}
        {error ? <p className="mt-4 text-sm text-ember">{error}</p> : null}

        {session ? <p className="mt-4 text-sm text-steel">Joining encounter...</p> : null}

        <button className="btn-primary mt-6" onClick={onJoin} disabled={!session || busy}>
          {busy ? "Joining..." : "Join Encounter Manually"}
        </button>
        <div className="mt-3">
          <button className="btn-ghost" onClick={() => navigate("/dashboard")}>Back To Dashboard</button>
        </div>
      </section>
    </main>
  );
}
