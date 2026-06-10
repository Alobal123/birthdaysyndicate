import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { claimLoot } from "../lib/api";
import { loadPlayerSession } from "../lib/session";

export default function ClaimPage() {
  const [searchParams] = useSearchParams();
  const session = loadPlayerSession();
  const initialToken = useMemo(() => searchParams.get("token") || "", [searchParams]);
  const [token, setToken] = useState(initialToken);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const onClaim = async () => {
    if (!session?.id) {
      return;
    }

    try {
      setError("");
      const data = await claimLoot(session.id, token.trim());
      setMessage(`Loot claimed: ${data.item}`);
    } catch (err) {
      setError(err.message || "Claim failed");
      setMessage("");
    }
  };

  return (
    <main className="mx-auto max-w-xl p-6">
      <section className="panel p-6 animate-riseIn">
        <h1 className="font-display text-3xl text-ink">Claim Loot</h1>
        <p className="mt-2 text-sm text-steel">Paste token from a hidden QR or open this page from that QR directly.</p>

        <input className="mt-4 w-full" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Loot token" />
        <button className="btn-accent mt-4" onClick={onClaim}>Claim</button>

        {message ? <p className="mt-3 text-sm text-mint">{message}</p> : null}
        {error ? <p className="mt-3 text-sm text-ember">{error}</p> : null}
      </section>
    </main>
  );
}
