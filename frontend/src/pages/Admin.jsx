import { useEffect, useMemo, useRef, useState } from "react";
import { adminDelete, adminGet, adminPost, getQuizState } from "../lib/api";
import AdminNav from "../components/AdminNav";
import { supabase } from "../lib/supabase";

const ADMIN_TOKEN_KEY = "pub_quiz_admin_token";

export default function AdminPage() {
  const [token, setToken] = useState(localStorage.getItem(ADMIN_TOKEN_KEY) || "");
  const [players, setPlayers] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState([]);
  const [quizState, setQuizState] = useState(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState("");
  const [countdownSeconds, setCountdownSeconds] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const selectedQuestionIdRef = useRef("");

  useEffect(() => {
    selectedQuestionIdRef.current = selectedQuestionId;
  }, [selectedQuestionId]);

  const run = async (fn) => {
    setError("");
    setMessage("");
    try {
      await fn();
      await loadAdminData(token);
    } catch (err) {
      setError(err.message || "Admin request failed");
    }
  };

  const loadAdminData = async (authToken) => {
    if (!authToken) {
      setPlayers([]);
      setQuestions([]);
      setAnswers([]);
      setQuizState(null);
      return;
    }

    setLoading(true);
    try {
      const [playersData, questionsData, answersData, stateData] = await Promise.all([
        adminGet("/players", authToken),
        adminGet("/questions", authToken),
        adminGet("/answers/current", authToken),
        getQuizState(),
      ]);

      setPlayers(playersData.players || []);
      const loadedQuestions = questionsData.questions || [];
      setQuestions(loadedQuestions);
      setSelectedQuestionId((currentSelectedId) => {
        const activeSelectedId = currentSelectedId || selectedQuestionIdRef.current;
        if (activeSelectedId && loadedQuestions.some((question) => question.id === activeSelectedId)) {
          return activeSelectedId;
        }

        if (loadedQuestions.length) {
          return loadedQuestions[0].id;
        }

        return "";
      });
      setAnswers(answersData.answers || []);
      setQuizState(stateData.state || null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
    let alive = true;

    const refresh = async () => {
      try {
        await loadAdminData(token);
      } catch (err) {
        if (alive) {
          setError(err.message || "Failed to load admin data");
        }
      }
    };

    refresh();

    const pollTimer = window.setInterval(refresh, 3000);

    if (!token) {
      return () => {
        alive = false;
        window.clearInterval(pollTimer);
      };
    }

    const channel = supabase
      .channel("admin-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "players" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "quiz_questions" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "player_answers" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_state" }, refresh)
      .subscribe();

    return () => {
      alive = false;
      window.clearInterval(pollTimer);
      supabase.removeChannel(channel);
    };
  }, [token]);

  const phase = useMemo(() => {
    if (quizState?.phase) {
      return quizState.phase;
    }
    if (!quizState?.current_question_id) {
      return "IDLE";
    }
    if (quizState?.is_active) {
      return "OPEN";
    }
    if (quizState?.reveal_answers) {
      return "REVEAL";
    }
    return "CLOSED";
  }, [quizState]);

  const phaseLabelClass = useMemo(() => {
    if (phase === "OPEN") return "text-mint";
    if (phase === "REVEAL") return "text-ember";
    if (phase === "CLOSED") return "text-ink";
    return "text-steel";
  }, [phase]);

  const birthdayPlayer = useMemo(
    () => players.find((player) => player.id === quizState?.special_player_id),
    [players, quizState?.special_player_id]
  );

  const handleSpecialPlayerChange = (playerId, checked) =>
    run(async () => {
      await adminPost("/game/special-player", token, {
        special_player_id: checked ? playerId : null,
      });
      setMessage(checked ? "Birthday player selected" : "Birthday player cleared");
    });

  useEffect(() => {
    if (phase !== "OPEN" || !quizState?.round_ends_at) {
      setCountdownSeconds(0);
      return;
    }

    const getRemaining = () => {
      const end = new Date(quizState.round_ends_at).getTime();
      const now = Date.now();
      return Math.max(0, Math.ceil((end - now) / 1000));
    };

    setCountdownSeconds(getRemaining());
    const timer = window.setInterval(() => {
      setCountdownSeconds(getRemaining());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [phase, quizState?.round_ends_at]);

  const formatCountdown = (value) => {
    const safe = Math.max(0, value || 0);
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };

  return (
    <main className="mx-auto max-w-6xl p-6">
      <section className="panel p-6 animate-riseIn">
        <h1 className="font-display text-3xl text-ink">Pub Quiz Admin</h1>
        <AdminNav />
        <input
          className="mt-4 w-full max-w-md"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Admin bearer token"
        />

        <div className="mt-4 rounded-xl border border-ink/10 bg-white p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-steel">Round Status</p>
          <p className={`mt-1 font-display text-2xl ${phaseLabelClass}`}>{phase}</p>
          <p className="mt-1 text-sm text-steel">
            {phase === "OPEN"
              ? `Time left: ${formatCountdown(countdownSeconds)}`
              : phase === "REVEAL"
                ? "Answers revealed"
                : "Waiting for next round"}
          </p>
          {birthdayPlayer ? (
            <p className="mt-1 text-sm text-steel">Birthday player: {birthdayPlayer.name}</p>
          ) : null}
          <p className="mt-1 text-sm text-steel">{loading ? "Syncing..." : `${players.length} players • ${answers.length} answers`}</p>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => run(async () => {
            if (phase === "OPEN") {
              await adminPost("/questions/reveal", token, { reveal: true });
              setMessage("Round ended and answers revealed");
              return;
            }

            if (!selectedQuestionId) {
              throw new Error("Pick a question first");
            }
            await adminPost("/questions/activate", token, { question_id: selectedQuestionId });
            setMessage("Round started");
          })}>
            {phase === "OPEN" ? "End & Reveal Round" : "Start Round"}
          </button>
          <button className="btn-ghost" onClick={() => run(async () => {
            await adminPost("/game/reset", token);
            setMessage("Scores and answers reset");
          })}>Reset Scores</button>
          <button className="btn-ghost" onClick={() => run(async () => {
            await adminPost("/game/end", token);
            setMessage("Game ended. Leaderboard is now visible to players.");
          })}>End Game</button>
        </div>

        <div className="mt-6 grid gap-3 rounded-xl border border-ink/10 bg-white p-4 sm:grid-cols-[1fr_120px] sm:items-end">
          <div>
            <label className="text-sm font-semibold text-ink">Question For Next Round</label>
            <select className="mt-1 w-full" value={selectedQuestionId} onChange={(e) => setSelectedQuestionId(e.target.value)}>
              <option value="">Select a question</option>
              {questions.map((q) => (
                <option key={q.id} value={q.id}>{q.prompt} ({q.duration_seconds || 30}s)</option>
              ))}
            </select>
          </div>
        </div>

        {message ? <p className="mt-4 text-sm text-mint">{message}</p> : null}
        {error ? <p className="mt-4 text-sm text-ember">{error}</p> : null}

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-ink/10 bg-white p-4">
            <h2 className="font-display text-xl text-ink">Players</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {players.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 rounded border border-ink/10 p-2">
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={p.id === quizState?.special_player_id}
                      onChange={(e) => handleSpecialPlayerChange(p.id, e.target.checked)}
                      disabled={!token}
                      title="Mark as birthday player"
                    />
                    <span>{p.name} ({p.score})</span>
                    {p.id === quizState?.special_player_id ? <span className="rounded-full bg-mint/20 px-2 py-0.5 text-xs font-semibold text-mint">Birthday</span> : null}
                  </span>
                  <button className="btn-ghost" onClick={() => run(async () => {
                    await adminDelete(`/players/${p.id}`, token);
                    setPlayers((old) => old.filter((x) => x.id !== p.id));
                  })}>Delete</button>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-ink/10 bg-white p-4 md:col-span-2">
            <h2 className="font-display text-xl text-ink">Current Round Answers</h2>
            <ul className="mt-3 max-h-72 space-y-2 overflow-auto text-xs">
              {answers.map((row) => (
                <li key={row.id} className="flex items-center justify-between rounded border border-ink/10 p-2">
                  <span className="flex items-center gap-2">
                    <span>{row.player_name} answered {row.selected_option}</span>
                    {row.player_id === quizState?.special_player_id ? <span aria-label="birthday answer">🎉</span> : null}
                  </span>
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
