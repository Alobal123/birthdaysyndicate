import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getPlayer } from "../lib/api";
import { clearPlayerSession, loadPlayerSession } from "../lib/session";
import { supabase } from "../lib/supabase";

export default function DashboardPage() {
  const navigate = useNavigate();
  const session = loadPlayerSession();
  const [player, setPlayer] = useState(session || null);

  useEffect(() => {
    if (!session) {
      return;
    }

    let alive = true;

    const load = async () => {
      try {
        const p = await getPlayer(session.id);
        if (alive) {
          setPlayer(p);
        }
      } catch {
      }
    };

    load();

    const channel = supabase
      .channel(`player-${session.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "players", filter: `id=eq.${session.id}` },
        (payload) => setPlayer(payload.new)
      )
      .subscribe();

    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [session]);

  if (!session) {
    return null;
  }

  return (
    <main className="mx-auto max-w-3xl p-4 md:p-8">
      <section className="panel p-6 animate-riseIn">
        <p className="text-xs uppercase tracking-[0.22em] text-steel">Operative</p>
        <h1 className="mt-2 font-display text-3xl text-ink">{player?.name || session.name}</h1>
        <p className="mt-3 text-sm text-steel">Score</p>
        <p className="font-display text-5xl text-ink">{player?.score ?? 0}</p>

        <p className="mt-6 text-sm font-semibold text-ink">Inventory</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(player?.inventory || []).length ? (
            (player?.inventory || []).map((item, i) => (
              <span key={`${item}-${i}`} className="rounded-full bg-mint/25 px-3 py-1 text-xs font-semibold text-ink">
                {item}
              </span>
            ))
          ) : (
            <span className="text-sm text-steel">No items yet.</span>
          )}
        </div>

        <div className="mt-8 grid gap-2 sm:grid-cols-2">
          <button className="btn-accent" onClick={() => navigate("/encounter/host")}>Initiate Syndicate Deal</button>
          <button className="btn-ghost" onClick={() => navigate("/encounter/scan")}>Scan Incoming Deal</button>
          <button className="btn-ghost" onClick={() => navigate("/claim")}>Claim Loot</button>
          <button
            className="btn-ghost"
            onClick={() => {
              clearPlayerSession();
              navigate("/");
            }}
          >
            Leave Identity
          </button>
        </div>
      </section>
    </main>
  );
}
