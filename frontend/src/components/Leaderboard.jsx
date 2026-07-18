import { useEffect, useState } from "react";
import { getLeaderboard } from "../lib/api";
import { supabase } from "../lib/supabase";

export default function Leaderboard() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const data = await getLeaderboard();
        if (mounted) {
          setRows(data.players || []);
        }
      } catch {
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    load();

    const channel = supabase
      .channel("leaderboard-players")
      .on("postgres_changes", { event: "*", schema: "public", table: "players" }, load)
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <section className="panel p-4 animate-riseIn">
      <h3 className="font-display text-lg font-bold text-ink">Live Leaderboard</h3>
      {loading ? <p className="mt-3 text-sm text-steel">Loading...</p> : null}
      <ol className="mt-3 space-y-2">
        {rows.slice(0, 12).map((row, idx) => (
          <li key={row.id} className="flex items-center justify-between rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm">
            <span>
              {idx + 1}. {row.name}
            </span>
            <span className="font-semibold text-ink">{row.score}</span>
          </li>
        ))}
        {!rows.length && !loading ? <li className="text-sm text-steel">No players yet.</li> : null}
      </ol>
    </section>
  );
}
