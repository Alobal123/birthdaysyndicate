import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import QRDisplay from "../components/QRDisplay";
import { createEncounter, getEncounter } from "../lib/api";
import { loadPlayerSession } from "../lib/session";
import { supabase } from "../lib/supabase";

export default function EncounterHostPage() {
  const session = loadPlayerSession();
  const navigate = useNavigate();
  const [encounter, setEncounter] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session?.id || encounter?.id) {
      return;
    }

    const run = async () => {
      try {
        const row = await createEncounter(session.id);
        setEncounter(row);
      } catch (err) {
        setError(err.message || "Could not create encounter");
      }
    };

    run();
  }, [session?.id, encounter?.id]);

  useEffect(() => {
    if (!encounter?.id) {
      return;
    }

    let canceled = false;

    const checkStatus = async () => {
      try {
        const latest = await getEncounter(encounter.id);
        if (canceled) {
          return;
        }
        setEncounter((prev) => ({ ...(prev || {}), ...latest }));
        if (latest.status === "LOCKED") {
          navigate(`/encounter/${latest.id}/strategy`);
        }
      } catch {
        // Keep UI responsive if a polling call fails.
      }
    };

    const timerId = window.setInterval(checkStatus, 1800);
    checkStatus();

    const channel = supabase
      .channel(`encounter-${encounter.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "encounters", filter: `id=eq.${encounter.id}` },
        (payload) => {
          const next = payload.new;
          setEncounter(next);
          if (next.status === "LOCKED") {
            navigate(`/encounter/${next.id}/strategy`);
          }
        }
      )
      .subscribe();

    return () => {
      canceled = true;
      window.clearInterval(timerId);
      supabase.removeChannel(channel);
    };
  }, [encounter?.id, navigate]);

  const qrUrl = useMemo(() => {
    if (!encounter?.id) {
      return "";
    }
    return `${window.location.origin}/#/encounter/${encounter.id}`;
  }, [encounter?.id]);

  return (
    <main className="mx-auto max-w-xl p-6">
      <section className="panel p-6 text-center animate-riseIn">
        <h1 className="font-display text-3xl text-ink">Host Encounter</h1>
        <p className="mt-2 text-sm text-steel">Show this QR to the player you are negotiating with.</p>
        {error ? <p className="mt-4 text-sm text-ember">{error}</p> : null}
        {encounter?.id ? (
          <div className="mt-5 flex justify-center">
            <QRDisplay url={qrUrl} />
          </div>
        ) : (
          <p className="mt-5 text-sm text-steel">Creating encounter...</p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {encounter?.status === "LOCKED" ? (
            <button className="btn-accent" onClick={() => navigate(`/encounter/${encounter.id}/strategy`)}>
              Choose Strategy
            </button>
          ) : null}
          <button className="btn-ghost" onClick={() => navigate("/dashboard")}>Back To Dashboard</button>
        </div>
      </section>
    </main>
  );
}
