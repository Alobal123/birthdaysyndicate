import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createPlayer } from "../lib/api";
import { savePlayerSession } from "../lib/session";

export default function LoginPage() {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const onSubmit = async (event) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("Enter a name to join.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const player = await createPlayer(name.trim());
      savePlayerSession(player);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message || "Unable to join");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <section className="panel w-full max-w-md p-7 animate-riseIn">
        <p className="text-xs uppercase tracking-[0.22em] text-steel">The Great Birthday Syndicate</p>
        <h1 className="mt-2 font-display text-3xl text-ink">Enter The Family</h1>
        <p className="mt-2 text-sm text-steel">Use your name. No password. No mercy.</p>
        <form onSubmit={onSubmit} className="mt-6 space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="w-full"
            maxLength={60}
          />
          {error ? <p className="text-sm text-ember">{error}</p> : null}
          <button className="btn-primary w-full" type="submit" disabled={busy}>
            {busy ? "Joining..." : "Join Game"}
          </button>
        </form>
      </section>
    </main>
  );
}
