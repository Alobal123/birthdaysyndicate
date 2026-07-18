import { useState } from "react";
import { adminDelete, adminGet, adminPost } from "../lib/api";

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [players, setPlayers] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState([]);
  const [durationSeconds, setDurationSeconds] = useState(30);
  const [selectedQuestionId, setSelectedQuestionId] = useState("");
  const [draft, setDraft] = useState({
    prompt: "",
    option_a: "",
    option_b: "",
    option_c: "",
    option_d: "",
    correct_option: "A",
    category: "General",
  });
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

  const validateQuestionDraft = () => {
    const prompt = draft.prompt.trim();
    const a = draft.option_a.trim();
    const b = draft.option_b.trim();
    const c = draft.option_c.trim();
    const d = draft.option_d.trim();

    if (prompt.length < 5) {
      throw new Error("Prompt must be at least 5 characters.");
    }
    if (!a || !b || !c || !d) {
      throw new Error("All answer options (A-D) are required.");
    }

    return {
      prompt,
      option_a: a,
      option_b: b,
      option_c: c,
      option_d: d,
      correct_option: draft.correct_option,
      category: draft.category.trim() || null,
    };
  };

  return (
    <main className="mx-auto max-w-6xl p-6">
      <section className="panel p-6 animate-riseIn">
        <h1 className="font-display text-3xl text-ink">Pub Quiz Admin</h1>
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
            setMessage("Scores and answers reset");
          })}>Reset Scores</button>
          <button className="btn-ghost" onClick={() => run(async () => {
            const data = await adminGet("/players", token);
            setPlayers(data.players || []);
            setMessage("Players loaded");
          })}>Load Players</button>
          <button className="btn-ghost" onClick={() => run(async () => {
            const data = await adminGet("/questions", token);
            const loaded = data.questions || [];
            setQuestions(loaded);
            if (!selectedQuestionId && loaded.length) {
              setSelectedQuestionId(loaded[0].id);
            }
            setMessage("Questions loaded");
          })}>Load Questions</button>
          <button className="btn-ghost" onClick={() => run(async () => {
            const data = await adminGet("/answers/current", token);
            setAnswers(data.answers || []);
            setMessage("Answers loaded");
          })}>Load Current Answers</button>
          <button className="btn-ghost" onClick={() => run(async () => {
            await adminPost("/questions/seed", token);
            const data = await adminGet("/questions", token);
            const loaded = data.questions || [];
            setQuestions(loaded);
            if (!selectedQuestionId && loaded.length) {
              setSelectedQuestionId(loaded[0].id);
            }
            setMessage("Sample questions ready");
          })}>Seed Questions</button>
        </div>

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

          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div>
              <label className="text-sm font-semibold text-ink">Correct Option</label>
              <select
                className="mt-1 w-full"
                value={draft.correct_option}
                onChange={(e) => setDraft((prev) => ({ ...prev, correct_option: e.target.value }))}
              >
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
                <option value="D">D</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold text-ink">Category</label>
              <input className="mt-1 w-full" value={draft.category} onChange={(e) => setDraft((prev) => ({ ...prev, category: e.target.value }))} />
            </div>
            <button className="btn-accent" onClick={() => run(async () => {
              const payload = validateQuestionDraft();
              await adminPost("/questions", token, payload);
              const data = await adminGet("/questions", token);
              const loaded = data.questions || [];
              setQuestions(loaded);
              if (!selectedQuestionId && loaded.length) {
                setSelectedQuestionId(loaded[0].id);
              }
              setDraft({
                prompt: "",
                option_a: "",
                option_b: "",
                option_c: "",
                option_d: "",
                correct_option: "A",
                category: "General",
              });
              setMessage("Question created");
            })}>Create</button>
          </div>
        </div>

        <div className="mt-6 grid gap-3 rounded-xl border border-ink/10 bg-white p-4 sm:grid-cols-[1fr_120px_auto_auto] sm:items-end">
          <div>
            <label className="text-sm font-semibold text-ink">Question To Activate</label>
            <select className="mt-1 w-full" value={selectedQuestionId} onChange={(e) => setSelectedQuestionId(e.target.value)}>
              <option value="">Select a question</option>
              {questions.map((q) => (
                <option key={q.id} value={q.id}>{q.prompt}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-semibold text-ink">Seconds</label>
            <input
              className="mt-1 w-full"
              type="number"
              min="5"
              max="600"
              value={durationSeconds}
              onChange={(e) => setDurationSeconds(Number(e.target.value || 30))}
            />
          </div>
          <button className="btn-primary" onClick={() => run(async () => {
            if (!selectedQuestionId) {
              throw new Error("Pick a question first");
            }
            await adminPost("/questions/activate", token, { question_id: selectedQuestionId, duration_seconds: durationSeconds });
            setMessage("Question activated");
          })}>Activate Round</button>
          <button className="btn-ghost" onClick={() => run(async () => {
            await adminPost("/questions/reveal", token, { reveal: true });
            setMessage("Answers revealed");
          })}>Reveal Answer</button>
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
            <h2 className="font-display text-xl text-ink">Question Bank</h2>
            <ul className="mt-3 max-h-80 space-y-2 overflow-auto text-xs">
              {questions.map((row) => (
                <li key={row.id} className="rounded border border-ink/10 p-2">
                  <p className="font-semibold text-ink">{row.prompt}</p>
                  <p className="text-steel">A: {row.option_a}</p>
                  <p className="text-steel">B: {row.option_b}</p>
                  <p className="text-steel">C: {row.option_c}</p>
                  <p className="text-steel">D: {row.option_d}</p>
                  <p className="text-ink">Correct: {row.correct_option}</p>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-ink/10 bg-white p-4 md:col-span-2">
            <h2 className="font-display text-xl text-ink">Current Round Answers</h2>
            <ul className="mt-3 max-h-72 space-y-2 overflow-auto text-xs">
              {answers.map((row) => (
                <li key={row.id} className="flex items-center justify-between rounded border border-ink/10 p-2">
                  <span>{row.player_name} answered {row.selected_option}</span>
                  <span className={row.is_correct ? "text-mint" : "text-ember"}>{row.is_correct ? "Correct" : "Wrong"}</span>
                </li>
              ))}
              {!answers.length ? <li className="text-sm text-steel">No answers yet for active question.</li> : null}
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
