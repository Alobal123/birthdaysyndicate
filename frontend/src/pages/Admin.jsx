import { useState } from "react";
import { adminDelete, adminGet, adminPost } from "../lib/api";

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [players, setPlayers] = useState([]);
  const [loot, setLoot] = useState([]);
  const [itemType, setItemType] = useState("smoke_bomb");
  const [count, setCount] = useState(10);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const run = async (fn) => {
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (err) {
      setError(err.message || "Admin request failed");
    }
  };

  return (
    <main className="mx-auto max-w-6xl p-6">
      <section className="panel p-6 animate-riseIn">
        <h1 className="font-display text-3xl text-ink">Admin Console</h1>
        <input
          className="mt-4 w-full max-w-md"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Admin bearer token"
        />

        <div className="mt-5 flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => run(async () => {
            await adminPost("/game/start", token);
            setMessage("Game started");
          })}>Start Game</button>
          <button className="btn-ghost" onClick={() => run(async () => {
            await adminPost("/game/stop", token);
            setMessage("Game stopped");
          })}>Stop Game</button>
          <button className="btn-ghost" onClick={() => run(async () => {
            await adminPost("/game/reset", token);
            setMessage("Game reset");
          })}>Reset Scores</button>
          <button className="btn-ghost" onClick={() => run(async () => {
            const data = await adminGet("/players", token);
            setPlayers(data.players || []);
            setMessage("Players loaded");
          })}>Load Players</button>
          <button className="btn-ghost" onClick={() => run(async () => {
            const data = await adminGet("/loot", token);
            setLoot(data.tokens || []);
            setMessage("Loot loaded");
          })}>Load Loot</button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_120px_auto] sm:items-end">
          <div>
            <label className="text-sm font-semibold text-ink">Item Type</label>
            <input className="mt-1 w-full" value={itemType} onChange={(e) => setItemType(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-semibold text-ink">Count</label>
            <input className="mt-1 w-full" type="number" min="1" max="500" value={count} onChange={(e) => setCount(Number(e.target.value || 1))} />
          </div>
          <button className="btn-accent" onClick={() => run(async () => {
            const data = await adminPost("/loot/generate", token, { item_type: itemType, count });
            setLoot(data.tokens || []);
            setMessage("Tokens generated");
          })}>Generate Tokens</button>
        </div>

        {message ? <p className="mt-4 text-sm text-mint">{message}</p> : null}
        {error ? <p className="mt-4 text-sm text-ember">{error}</p> : null}

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-ink/10 bg-white p-4">
            <h2 className="font-display text-xl text-ink">Players</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {players.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 rounded border border-ink/10 p-2">
                  <span>{p.name} ({p.score})</span>
                  <button className="btn-ghost" onClick={() => run(async () => {
                    await adminDelete(`/players/${p.id}`, token);
                    setPlayers((old) => old.filter((x) => x.id !== p.id));
                  })}>Delete</button>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-ink/10 bg-white p-4">
            <h2 className="font-display text-xl text-ink">Loot Tokens</h2>
            <ul className="mt-3 max-h-80 space-y-2 overflow-auto text-xs">
              {loot.map((row) => (
                <li key={row.id} className="rounded border border-ink/10 p-2">
                  <p className="font-semibold text-ink">{row.item_type}</p>
                  <p className="text-steel break-all">{row.token}</p>
                  <p className={row.is_used ? "text-ember" : "text-mint"}>{row.is_used ? "USED" : "UNUSED"}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
