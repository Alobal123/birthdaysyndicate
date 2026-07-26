import { useEffect, useMemo, useRef, useState } from "react";
import { adminDelete, adminGet, adminPost, getQuizState } from "../lib/api";
import AdminNav from "../components/AdminNav";
import { supabase } from "../lib/supabase";

const ADMIN_TOKEN_KEY = "pub_quiz_admin_token";

export default function AdminPage() {
  const [token, setToken] = useState(localStorage.getItem(ADMIN_TOKEN_KEY) || "");
  const [games, setGames] = useState([]);
  const [selectedGameId, setSelectedGameId] = useState("");
  const [gameNewName, setGameNewName] = useState("");
  const [players, setPlayers] = useState([]);
  const [availableQuestions, setAvailableQuestions] = useState([]);
  const [gameQuestions, setGameQuestions] = useState([]);
  const [answers, setAnswers] = useState([]);
  const [quizState, setQuizState] = useState(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState("");
  const [countdownSeconds, setCountdownSeconds] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [managingQuestions, setManagingQuestions] = useState(false);
  const [usedQuestionIds, setUsedQuestionIds] = useState(new Set());
  const selectedQuestionIdRef = useRef("");

  useEffect(() => {
    selectedQuestionIdRef.current = selectedQuestionId;
  }, [selectedQuestionId]);

  const run = async (fn) => {
    setError("");
    setMessage("");
    try {
      await fn();
      if (selectedGameId) {
        await loadAdminData(token, selectedGameId);
      }
    } catch (err) {
      setError(err.message || "Admin request failed");
    }
  };

  const loadGames = async (authToken) => {
    if (!authToken) {
      setGames([]);
      return;
    }
    try {
      const data = await adminGet("/games", authToken);
      setGames(data.games || []);
      if (data.games && data.games.length > 0 && !selectedGameId) {
        setSelectedGameId(data.games[0].id);
      }
    } catch (err) {
      console.error("Failed to load games:", err);
    }
  };

  const loadAdminData = async (authToken, gameId) => {
    if (!authToken || !gameId) {
      setPlayers([]);
      setAvailableQuestions([]);
      setGameQuestions([]);
      setAnswers([]);
      setQuizState(null);
      setUsedQuestionIds(new Set());
      return;
    }

    setLoading(true);
    try {
      const [playersData, questionsData, gameQuestionsData, answersData, stateData] = await Promise.all([
        adminGet(`/players?game_id=${gameId}`, authToken),
        adminGet("/questions", authToken),
        adminGet(`/games/${gameId}/questions`, authToken),
        adminGet("/answers/current", authToken),
        getQuizState(),
      ]);

      setPlayers(playersData.players || []);
      setAvailableQuestions(questionsData.questions || []);
      setGameQuestions(gameQuestionsData.questions || []);
      
      // Track which questions have been activated (have activated_at timestamp)
      const loadedGameQuestions = gameQuestionsData.questions || [];
      const usedIds = new Set(
        loadedGameQuestions
          .filter(gq => gq.activated_at)
          .map(gq => gq.question_id)
      );
      setUsedQuestionIds(usedIds);
      
      setSelectedQuestionId((currentSelectedId) => {
        const activeSelectedId = currentSelectedId || selectedQuestionIdRef.current;
        if (activeSelectedId && loadedGameQuestions.some((gq) => gq.question_id === activeSelectedId && !usedIds.has(activeSelectedId))) {
          return activeSelectedId;
        }

        // Find first unused question
        const unusedQuestion = loadedGameQuestions.find((gq) => !usedIds.has(gq.question_id));
        if (unusedQuestion) {
          return unusedQuestion.question_id;
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
        await loadGames(token);
        if (selectedGameId) {
          await loadAdminData(token, selectedGameId);
        }
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
      .on("postgres_changes", { event: "*", schema: "public", table: "games" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_questions" }, refresh)
      .subscribe();

    return () => {
      alive = false;
      window.clearInterval(pollTimer);
      supabase.removeChannel(channel);
    };
  }, [token, selectedGameId]);

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

  const currentGame = useMemo(
    () => games.find((g) => g.id === selectedGameId),
    [games, selectedGameId]
  );

  const isGameClosed = currentGame?.status === "closed";

  const handleSpecialPlayerChange = (playerId, checked) =>
    run(async () => {
      await adminPost("/game/special-player", token, {
        special_player_id: checked ? playerId : null,
      });
      setMessage(checked ? "Birthday player selected" : "Birthday player cleared");
    });

  const handleCreateGame = () =>
    run(async () => {
      const name = gameNewName.trim();
      if (!name) {
        throw new Error("Game name cannot be empty");
      }
      await adminPost("/games", token, { name });
      setGameNewName("");
      setMessage(`Game "${name}" created`);
      await loadGames(token);
    });

  const handleAddQuestionToGame = async (questionId) => {
    if (!selectedGameId) return;
    try {
      await adminPost(`/games/${selectedGameId}/questions`, token, {
        question_id: questionId,
      });
      setMessage("Question added to game");
      await loadAdminData(token, selectedGameId);
    } catch (err) {
      setError(err.message || "Failed to add question");
    }
  };

  const handleRemoveQuestionFromGame = async (questionId) => {
    if (!selectedGameId) return;
    try {
      await adminDelete(`/games/${selectedGameId}/questions/${questionId}`, token);
      setMessage("Question removed from game");
      await loadAdminData(token, selectedGameId);
    } catch (err) {
      setError(err.message || "Failed to remove question");
    }
  };

  const handleEndGame = () =>
    run(async () => {
      if (!selectedGameId) throw new Error("No game selected");
      await adminPost(`/games/${selectedGameId}/end`, token);
      setMessage("Game ended. All game data is now read-only.");
      await loadGames(token);
      await loadAdminData(token, selectedGameId);
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

  const availableQuestionsToAdd = useMemo(
    () => availableQuestions.filter(q => !gameQuestions.some(gq => gq.question_id === q.id)),
    [availableQuestions, gameQuestions]
  );

  const unusedGameQuestions = useMemo(
    () => gameQuestions.filter(gq => !usedQuestionIds.has(gq.question_id)),
    [gameQuestions, usedQuestionIds]
  );

  return (
    <main className="mx-auto max-w-6xl p-6">
      <section className="panel p-6 animate-riseIn">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl text-ink">Pub Quiz Admin</h1>
            <AdminNav />
          </div>
          <input
            className="w-48 text-sm"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Admin bearer token"
          />
        </div>

        {/* Status Messages */}
        {message ? <p className="mt-4 text-sm text-mint">{message}</p> : null}
        {error ? <p className="mt-4 text-sm text-ember">{error}</p> : null}

        {/* Game Selection & Management */}
        <div className="mt-6 rounded-xl border border-ink/10 bg-white p-4">
          <h2 className="font-display text-lg text-ink">Select Game</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <select 
              className="flex-1 min-w-[200px]" 
              value={selectedGameId} 
              onChange={(e) => setSelectedGameId(e.target.value)}
            >
              <option value="">Select a game</option>
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} {g.status === 'closed' ? '(Closed)' : '(Active)'}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              type="text"
              className="flex-1 min-w-[200px]"
              value={gameNewName}
              onChange={(e) => setGameNewName(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && handleCreateGame()}
              placeholder="New game name"
              disabled={!token}
            />
            <button className="btn-primary" onClick={handleCreateGame} disabled={!token}>
              Create Game
            </button>
            <button 
              className="btn-danger" 
              onClick={handleEndGame}
              disabled={!token || !selectedGameId || isGameClosed}
            >
              End Game
            </button>
          </div>
          {currentGame && (
            <div className="mt-3 rounded border border-ink/10 bg-ink/5 p-2">
              <p className="text-sm text-ink"><span className="font-semibold">{currentGame.name}</span></p>
              <p className="text-xs text-steel">Status: <span className={currentGame.status === 'closed' ? 'text-ember font-semibold' : 'text-mint font-semibold'}>{currentGame.status.toUpperCase()}</span></p>
            </div>
          )}
        </div>

        {/* Round Status & Controls */}
        {selectedGameId && (
          <>
            <div className="mt-6 rounded-xl border border-ink/10 bg-white p-4">
              <div className="grid gap-4 md:grid-cols-2">
                {/* Status Info */}
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-steel">Round Status</p>
                  <p className={`mt-1 font-display text-2xl ${phaseLabelClass}`}>{phase}</p>
                  <p className="mt-2 text-sm text-steel">
                    {phase === "OPEN"
                      ? `Time left: ${formatCountdown(countdownSeconds)}`
                      : phase === "REVEAL"
                        ? "Answers revealed"
                        : "Waiting for next round"}
                  </p>
                  {birthdayPlayer && (
                    <p className="mt-1 text-sm text-steel">Birthday: {birthdayPlayer.name}</p>
                  )}
                  <p className="mt-2 text-xs text-steel">{loading ? "Syncing..." : `${players.length} players • ${answers.length} answers`}</p>
                </div>

                {/* Question Selection */}
                <div>
                  <label className="text-sm font-semibold text-ink">Question For Next Round</label>
                  <select 
                    className="mt-2 w-full" 
                    value={selectedQuestionId} 
                    onChange={(e) => setSelectedQuestionId(e.target.value)}
                    disabled={!selectedGameId || isGameClosed || unusedGameQuestions.length === 0}
                  >
                    <option value="">{unusedGameQuestions.length === 0 ? 'All questions asked' : 'Select a question'}</option>
                    {unusedGameQuestions.map((gq) => {
                      const q = gq.quiz_questions || gq;
                      return (
                        <option key={gq.id} value={gq.question_id}>
                          {typeof q === 'object' ? q.prompt : 'Question'} ({typeof q === 'object' ? (q.duration_seconds || 30) : 30}s)
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>
            </div>

            {/* Action Buttons - Round Control */}
            <div className="mt-4 flex flex-wrap gap-2">
              <button 
                className="btn-primary" 
                onClick={() => run(async () => {
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
                })}
                disabled={!token || isGameClosed}
              >
                {phase === "OPEN" ? "End & Reveal Round" : "Start Round"}
              </button>
              <button 
                className="btn-ghost"
                onClick={() => setManagingQuestions(!managingQuestions)}
                disabled={!selectedGameId || isGameClosed}
              >
                {managingQuestions ? "Done Managing" : "Manage Questions"}
              </button>
            </div>

            {/* Question Management */}
            {managingQuestions && selectedGameId && (
              <div className="mt-6 rounded-xl border border-ink/10 bg-white p-4">
                <h3 className="font-display text-lg text-ink">Add Questions to Game</h3>
                <p className="mt-2 text-sm text-steel">In game: {gameQuestions.length} • Available: {availableQuestionsToAdd.length}</p>
                <div className="mt-3 max-h-64 overflow-auto space-y-1">
                  {availableQuestionsToAdd.length > 0 ? (
                    availableQuestionsToAdd.map((q) => (
                      <div key={q.id} className="flex items-center justify-between rounded border border-ink/10 p-2 text-sm">
                        <span className="flex-1 truncate">{q.prompt}</span>
                        <button
                          className="btn-primary"
                          onClick={() => handleAddQuestionToGame(q.id)}
                          size="sm"
                          disabled={isGameClosed}
                        >
                          Add
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-steel">All questions added to this game.</p>
                  )}
                </div>
                {gameQuestions.length > 0 && (
                  <div className="mt-4 border-t border-ink/10 pt-4">
                    <p className="text-sm font-semibold text-ink">Questions in game:</p>
                    <div className="mt-2 space-y-1">
                      {gameQuestions.map((gq) => {
                        const q = gq.quiz_questions || gq;
                        return (
                          <div key={gq.id} className="flex items-center justify-between rounded border border-ink/10 p-2 text-sm bg-ink/5">
                            <span className="flex-1 truncate">{typeof q === 'object' ? q.prompt : 'Question'}</span>
                            <button
                              className="btn-ghost"
                              onClick={() => handleRemoveQuestionFromGame(gq.question_id)}
                              size="sm"
                              disabled={isGameClosed}
                            >
                              Remove
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Players & Answers */}
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-ink/10 bg-white p-4">
                <h2 className="font-display text-lg text-ink">Players</h2>
                <ul className="mt-3 space-y-2 text-sm">
                  {players.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 rounded border border-ink/10 p-2">
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={p.id === quizState?.special_player_id}
                          onChange={(e) => handleSpecialPlayerChange(p.id, e.target.checked)}
                          disabled={!token || isGameClosed}
                          title="Mark as birthday player"
                        />
                        <span>{p.name} ({p.score})</span>
                        {p.id === quizState?.special_player_id ? <span className="rounded-full bg-mint/20 px-2 py-0.5 text-xs font-semibold text-mint">Birthday</span> : null}
                      </span>
                      <button 
                        className="btn-ghost" 
                        onClick={() => run(async () => {
                          await adminDelete(`/players/${p.id}`, token);
                          setPlayers((old) => old.filter((x) => x.id !== p.id));
                        })}
                        disabled={!token || isGameClosed}
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-ink/10 bg-white p-4">
                <h2 className="font-display text-lg text-ink">Current Round Answers</h2>
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
          </>
        )}
      </section>
    </main>
  );
}
