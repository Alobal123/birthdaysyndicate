import { useEffect, useState } from "react";
import { adminDelete, adminGet, adminPost } from "../lib/api";
import AdminNav from "../components/AdminNav";

const ADMIN_TOKEN_KEY = "pub_quiz_admin_token";

export default function AdminQuestionsPage() {
  const [token, setToken] = useState(localStorage.getItem(ADMIN_TOKEN_KEY) || "");
  const [questions, setQuestions] = useState([]);
  const [draft, setDraft] = useState({
    prompt: "",
    option_a: "",
    option_b: "",
    option_c: "",
    option_d: "",
    correct_option: "",
    duration_seconds: 20,
  });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadQuestions = async (authToken) => {
    if (!authToken) {
      setQuestions([]);
      return;
    }

    const data = await adminGet("/questions", authToken);
    setQuestions(data.questions || []);
  };

  useEffect(() => {
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
    let alive = true;

    const refresh = async () => {
      try {
        await loadQuestions(token);
      } catch (err) {
        if (alive) {
          setError(err.message || "Failed to load questions");
        }
      }
    };

    refresh();
    const pollTimer = window.setInterval(refresh, 3000);

    return () => {
      alive = false;
      window.clearInterval(pollTimer);
    };
  }, [token]);

  const run = async (fn) => {
    setError("");
    setMessage("");
    try {
      await fn();
      await loadQuestions(token);
    } catch (err) {
      setError(err.message || "Question admin request failed");
    }
  };

  const createQuestion = async () => {
    const prompt = draft.prompt.trim();
    const option_a = draft.option_a.trim();
    const option_b = draft.option_b.trim();
    const option_c = draft.option_c.trim();
    const option_d = draft.option_d.trim();
    const duration_seconds = Number(draft.duration_seconds || 20);

    if (prompt.length < 5) {
      throw new Error("Prompt must be at least 5 characters.");
    }
    if (!option_a || !option_b || !option_c || !option_d) {
      throw new Error("All answer options (A-D) are required.");
    }
    if (Number.isNaN(duration_seconds) || duration_seconds < 5 || duration_seconds > 600) {
      throw new Error("Default time must be between 5 and 600 seconds.");
    }

    await adminPost("/questions", token, {
      prompt,
      option_a,
      option_b,
      option_c,
      option_d,
      correct_option: draft.correct_option || null,
      duration_seconds,
    });

    setDraft({
      prompt: "",
      option_a: "",
      option_b: "",
      option_c: "",
      option_d: "",
      correct_option: "",
      duration_seconds: 20,
    });
    setMessage("Question created");
  };

  return (
    <main className="mx-auto max-w-6xl p-6">
      <section className="panel p-6 animate-riseIn">
        <h1 className="font-display text-3xl text-ink">Question Bank</h1>
        <AdminNav />

        <input
          className="mt-4 w-full max-w-md"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Admin bearer token"
        />

        <div className="mt-6 grid gap-3 rounded-xl border border-ink/10 bg-white p-4">
          <h2 className="font-display text-xl text-ink">Create Question</h2>
          <div>
            <label className="text-sm font-semibold text-ink">Prompt</label>
            <input
              className="mt-1 w-full"
              value={draft.prompt}
              onChange={(e) => setDraft((prev) => ({ ...prev, prompt: e.target.value }))}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-sm font-semibold text-ink">Option A</label>
              <input className="mt-1 w-full" value={draft.option_a} onChange={(e) => setDraft((prev) => ({ ...prev, option_a: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-semibold text-ink">Option B</label>
              <input className="mt-1 w-full" value={draft.option_b} onChange={(e) => setDraft((prev) => ({ ...prev, option_b: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-semibold text-ink">Option C</label>
              <input className="mt-1 w-full" value={draft.option_c} onChange={(e) => setDraft((prev) => ({ ...prev, option_c: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-semibold text-ink">Option D</label>
              <input className="mt-1 w-full" value={draft.option_d} onChange={(e) => setDraft((prev) => ({ ...prev, option_d: e.target.value }))} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_140px_auto] sm:items-end">
            <div>
              <label className="text-sm font-semibold text-ink">Reference Answer</label>
              <select
                className="mt-1 w-full"
                value={draft.correct_option}
                onChange={(e) => setDraft((prev) => ({ ...prev, correct_option: e.target.value }))}
              >
                <option value="">No right answer</option>
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
                <option value="D">D</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold text-ink">Default Time</label>
              <input
                className="mt-1 w-full"
                type="number"
                min="5"
                max="600"
                value={draft.duration_seconds}
                onChange={(e) => setDraft((prev) => ({ ...prev, duration_seconds: Number(e.target.value || 20) }))}
              />
            </div>
            <button className="btn-accent" onClick={() => run(createQuestion)}>Create</button>
          </div>
        </div>

        {message ? <p className="mt-4 text-sm text-mint">{message}</p> : null}
        {error ? <p className="mt-4 text-sm text-ember">{error}</p> : null}

        <div className="mt-6 rounded-xl border border-ink/10 bg-white p-4">
          <h2 className="font-display text-xl text-ink">Questions</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {questions.map((row) => (
              <li key={row.id} className="rounded border border-ink/10 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{row.prompt}</p>
                    <p className="text-steel">A: {row.option_a}</p>
                    <p className="text-steel">B: {row.option_b}</p>
                    <p className="text-steel">C: {row.option_c}</p>
                    <p className="text-steel">D: {row.option_d}</p>
                    <p className="text-ink">Reference: {row.correct_option || "N/A"}</p>
                    <p className="text-steel">Default time: {row.duration_seconds || 20}s</p>
                  </div>
                  <button
                    className="btn-ghost shrink-0"
                    onClick={() => run(async () => {
                      await adminDelete(`/questions/${row.id}`, token);
                      setMessage("Question deleted");
                    })}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
            {!questions.length ? <li className="text-sm text-steel">No questions yet.</li> : null}
          </ul>
        </div>
      </section>
    </main>
  );
}