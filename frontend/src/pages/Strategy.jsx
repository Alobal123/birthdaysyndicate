import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { submitChoice } from "../lib/api";
import { loadPlayerSession } from "../lib/session";
import { supabase } from "../lib/supabase";

const CHOICES = ["ALLIANCE", "CUT", "HEIST"];

export default function StrategyPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const session = loadPlayerSession();
  const [selection, setSelection] = useState("ALLIANCE");
  const [item, setItem] = useState("");
  const [inventory, setInventory] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!session?.id) {
      return;
    }

    const playerChannel = supabase
      .channel(`strategy-player-${session.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `id=eq.${session.id}` },
        (payload) => setInventory(payload.new?.inventory || [])
      )
      .subscribe();

    const encounterChannel = supabase
      .channel(`strategy-encounter-${id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "encounters", filter: `id=eq.${id}` },
        (payload) => {
          const row = payload.new;
          if (row.status === "COMPLETED" || row.status === "CANCELED") {
            navigate(`/encounter/${id}/reveal`, { state: { encounter: row } });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(playerChannel);
      supabase.removeChannel(encounterChannel);
    };
  }, [id, navigate, session?.id]);

  const itemOptions = useMemo(() => ["", ...inventory], [inventory]);

  const onSubmit = async () => {
    if (!session?.id || !id || submitted) {
      return;
    }

    setBusy(true);
    setError("");
    try {
      const result = await submitChoice(id, session.id, selection, item || null);
      setSubmitted(true);
      if (result.status === "COMPLETED" || result.status === "CANCELED") {
        navigate(`/encounter/${id}/reveal`, { state: result });
      }
    } catch (err) {
      setError(err.message || "Failed to submit choice");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl p-6">
      <section className="panel p-6 animate-riseIn">
        <h1 className="font-display text-3xl text-ink">Choose Your Move</h1>
        <p className="mt-2 text-sm text-steel">Both players must lock choices before reveal.</p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {CHOICES.map((choice) => (
            <button
              key={choice}
              className={`rounded-xl border px-3 py-3 text-sm font-semibold transition ${
                selection === choice ? "border-ink bg-ink text-white" : "border-ink/15 bg-white text-ink hover:bg-fog"
              }`}
              onClick={() => setSelection(choice)}
              disabled={busy || submitted}
            >
              {choice}
            </button>
          ))}
        </div>

        <div className="mt-5">
          <label className="text-sm font-semibold text-ink">Item (optional)</label>
          <select value={item} onChange={(e) => setItem(e.target.value)} className="mt-2 w-full" disabled={busy || submitted}>
            {itemOptions.map((opt, idx) => (
              <option key={`${opt}-${idx}`} value={opt}>
                {opt || "No item"}
              </option>
            ))}
          </select>
        </div>

        {error ? <p className="mt-3 text-sm text-ember">{error}</p> : null}
        {submitted ? <p className="mt-3 text-sm text-steel">Choice locked. Waiting for the other player...</p> : null}

        <div className="mt-6 flex flex-wrap gap-2">
          <button className="btn-accent" onClick={onSubmit} disabled={busy || submitted}>
            {busy ? "Submitting..." : submitted ? "Choice Locked" : "Lock Choice"}
          </button>
          <button className="btn-ghost" onClick={() => navigate("/dashboard")}>Cancel And Return</button>
        </div>
      </section>
    </main>
  );
}
