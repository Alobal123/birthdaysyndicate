import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { loadPlayerSession } from "../lib/session";
import { supabase } from "../lib/supabase";

export default function RevealPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const session = loadPlayerSession();
  const [encounter, setEncounter] = useState(location.state?.encounter || null);

  useEffect(() => {
    if (!id) {
      return;
    }

    const channel = supabase
      .channel(`reveal-encounter-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "encounters", filter: `id=eq.${id}` },
        (payload) => setEncounter(payload.new)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  const playerDelta = (() => {
    if (!encounter || !session?.id) {
      return null;
    }
    if (encounter.p1_id === session.id) {
      if (encounter.p1_choice === "ALLIANCE" && encounter.p2_choice === "ALLIANCE") return 12;
      if (encounter.p1_choice === "ALLIANCE" && encounter.p2_choice === "CUT") return 4;
      if (encounter.p1_choice === "ALLIANCE" && encounter.p2_choice === "HEIST") return 0;
      if (encounter.p1_choice === "CUT" && encounter.p2_choice === "ALLIANCE") return 14;
      if (encounter.p1_choice === "CUT" && encounter.p2_choice === "CUT") return 8;
      if (encounter.p1_choice === "CUT" && encounter.p2_choice === "HEIST") return 2;
      if (encounter.p1_choice === "HEIST" && encounter.p2_choice === "ALLIANCE") return 20;
      if (encounter.p1_choice === "HEIST" && encounter.p2_choice === "CUT") return 14;
      if (encounter.p1_choice === "HEIST" && encounter.p2_choice === "HEIST") return 2;
      return null;
    }

    if (encounter.p2_id === session.id) {
      if (encounter.p1_choice === "ALLIANCE" && encounter.p2_choice === "ALLIANCE") return 12;
      if (encounter.p1_choice === "ALLIANCE" && encounter.p2_choice === "CUT") return 14;
      if (encounter.p1_choice === "ALLIANCE" && encounter.p2_choice === "HEIST") return 20;
      if (encounter.p1_choice === "CUT" && encounter.p2_choice === "ALLIANCE") return 4;
      if (encounter.p1_choice === "CUT" && encounter.p2_choice === "CUT") return 8;
      if (encounter.p1_choice === "CUT" && encounter.p2_choice === "HEIST") return 14;
      if (encounter.p1_choice === "HEIST" && encounter.p2_choice === "ALLIANCE") return 0;
      if (encounter.p1_choice === "HEIST" && encounter.p2_choice === "CUT") return 2;
      if (encounter.p1_choice === "HEIST" && encounter.p2_choice === "HEIST") return 2;
      return null;
    }

    return null;
  })();

  return (
    <main className="mx-auto max-w-xl p-6">
      <section className="panel p-6 text-center animate-riseIn">
        <h1 className="font-display text-3xl text-ink">Reveal</h1>
        {!encounter ? (
          <p className="mt-3 text-sm text-steel">Waiting for final result...</p>
        ) : (
          <>
            <p className="mt-3 text-sm text-steel">Choices</p>
            <p className="mt-1 font-semibold text-ink">
              {encounter.p1_choice || "?"} vs {encounter.p2_choice || "?"}
            </p>
            <p className="mt-5 text-sm text-steel">Your gain</p>
            <p className={`font-display text-5xl ${playerDelta >= 12 ? "text-mint" : playerDelta <= 2 ? "text-ember" : "text-ink"}`}>
              +{playerDelta ?? "?"}
            </p>
          </>
        )}

        <button className="btn-primary mt-7" onClick={() => navigate("/dashboard")}>Back To Dashboard</button>
      </section>
    </main>
  );
}
