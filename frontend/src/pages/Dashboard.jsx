import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getLeaderboard, getPlayer, getPlayerAnswer, getQuizState, submitAnswer } from "../lib/api";
import { clearPlayerSession, loadPlayerSession } from "../lib/session";
import { supabase } from "../lib/supabase";

const ANSWER_OPTIONS = ["A", "B", "C", "D"];
const DASHBOARD_REFRESH_MS = 1000;

function derivePhase(state) {
  if (state?.phase) {
    return String(state.phase).toUpperCase();
  }
  if (!state?.current_question_id) {
    return "IDLE";
  }
  if (state?.is_active) {
    return "OPEN";
  }
  if (state?.reveal_answers) {
    return "REVEAL";
  }
  return "CLOSED";
}

function localizeErrorMessage(message) {
  const normalized = String(message || "").trim();
  if (!normalized) {
    return "Došlo k chybě.";
  }

  if (normalized === "Player not found") {
    return "Hráč nebyl nalezen.";
  }
  if (normalized === "No active question") {
    return "Momentálně není aktivní otázka.";
  }
  if (normalized === "Answer window is closed") {
    return "Čas na odpověď už vypršel.";
  }
  if (normalized === "Failed to load quiz state") {
    return "Nepodařilo se načíst stav kola.";
  }
  if (normalized === "Failed to save answer") {
    return "Nepodařilo se uložit odpověď.";
  }

  return "Došlo k chybě.";
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const session = loadPlayerSession();
  const sessionId = session?.id || null;
  const sessionName = session?.name || "";

  const [player, setPlayer] = useState(session || null);
  // Single atomic snapshot so state, question, and the player's answer are
  // always rendered together. This is what makes the UI refresh-robust.
  const [snapshot, setSnapshot] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [countdownSeconds, setCountdownSeconds] = useState(0);

  const loadRequestRef = useRef(0);
  const loadInFlightRef = useRef(false);
  const selectedResetForRef = useRef(null);
  const submittedForQuestionRef = useRef(null);
  const previousPhaseRef = useRef(null);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    let alive = true;

    const loadAll = async () => {
      if (loadInFlightRef.current) {
        return;
      }
      loadInFlightRef.current = true;
      const requestId = ++loadRequestRef.current;
      try {
        const [playerData, quiz] = await Promise.all([getPlayer(sessionId), getQuizState(sessionId)]);

        const state = quiz.state || null;
        const question = quiz.question || null;
        const phase = derivePhase(state);
        const questionId = state?.current_question_id ?? question?.id ?? null;
        const gameOver = Boolean(state?.game_over);

        let leaderboardPlayers = [];
        if (gameOver) {
          try {
            const board = await getLeaderboard();
            leaderboardPlayers = board?.players || [];
          } catch {
            leaderboardPlayers = [];
          }
        }

        if (!alive || requestId !== loadRequestRef.current) {
          return;
        }

        setPlayer(playerData);
        setLeaderboard(leaderboardPlayers);
        setSnapshot((prev) => {
          // If backend is in reveal mode but briefly omits question payload,
          // keep the last known question to avoid "No active question" flicker.
          const effectiveQuestion = phase === "REVEAL" && !question ? (prev?.question || null) : question;
          const effectiveQuestionId = questionId ?? (phase === "REVEAL" ? (prev?.questionId || null) : null);
          const previousAnswer = prev?.questionId === effectiveQuestionId ? (prev?.myAnswer || null) : null;
          return { state, question: effectiveQuestion, questionId: effectiveQuestionId, myAnswer: previousAnswer };
        });
        setLoaded(true);
        setError("");

        // Do not block question rendering on answer lookup.
        if (questionId && !gameOver) {
          getPlayerAnswer(questionId, sessionId)
            .then((answerData) => {
              if (!alive || requestId !== loadRequestRef.current) {
                return;
              }
              const answer = answerData?.answer || null;
              setSnapshot((prev) => {
                if (!prev || prev.questionId !== questionId) {
                  return prev;
                }
                return { ...prev, myAnswer: answer };
              });
            })
            .catch(() => {
              // Best-effort hydration only; keep UI responsive.
            });
        }
      } catch (err) {
        if (!alive || requestId !== loadRequestRef.current) {
          return;
        }
        if ((err?.message || "") === "Player not found") {
          clearPlayerSession();
          navigate("/", { replace: true });
          return;
        }
        setError(localizeErrorMessage(err.message || "Failed to load quiz state"));
      } finally {
        if (requestId === loadRequestRef.current) {
          loadInFlightRef.current = false;
        } else {
          loadInFlightRef.current = false;
        }
      }
    };

    loadAll();

    const refreshTimer = window.setInterval(loadAll, DASHBOARD_REFRESH_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        loadAll();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    const channel = supabase
      .channel(`quiz-dashboard-${sessionId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "players", filter: `id=eq.${sessionId}` },
        (payload) => setPlayer(payload.new)
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "game_state" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "player_answers" }, loadAll)
      .subscribe();

    return () => {
      alive = false;
      window.clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      supabase.removeChannel(channel);
    };
  }, [sessionId, navigate]);

  const state = snapshot?.state || null;
  const question = snapshot?.question || null;
  const questionId = snapshot?.questionId || null;
  const myAnswer = snapshot?.myAnswer || null;
  const phase = derivePhase(state);
  const isGameOver = Boolean(state?.game_over);

  // Reset the pending selection whenever the active question changes.
  useEffect(() => {
    if (selectedResetForRef.current !== questionId) {
      selectedResetForRef.current = questionId;
      setSelected(myAnswer?.selected_option || null);
      setBusy(false);
      submittedForQuestionRef.current = null;
    }
  }, [questionId, myAnswer?.selected_option]);

  // Countdown is only meaningful while the round is OPEN.
  useEffect(() => {
    if (phase !== "OPEN" || !state?.round_ends_at) {
      setCountdownSeconds(0);
      return;
    }

    const getRemaining = () => {
      const end = new Date(state.round_ends_at).getTime();
      return Math.max(0, Math.ceil((end - Date.now()) / 1000));
    };

    setCountdownSeconds(getRemaining());
    const timer = window.setInterval(() => {
      setCountdownSeconds(getRemaining());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [phase, state?.round_ends_at]);

  const formatCountdown = (value) => {
    const safe = Math.max(0, value || 0);
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };

  const submitCurrentSelection = useCallback(async (targetQuestionId, selectedOption) => {
    if (!sessionId || !targetQuestionId || !selectedOption) {
      return;
    }
    if (submittedForQuestionRef.current === targetQuestionId) {
      return;
    }

    setBusy(true);
    try {
      const result = await submitAnswer(sessionId, selectedOption);
      submittedForQuestionRef.current = targetQuestionId;
      setSnapshot((prev) => {
        if (!prev || prev.questionId !== targetQuestionId) {
          return prev;
        }
        return { ...prev, myAnswer: result.answer || prev.myAnswer };
      });
    } catch (err) {
      const message = err?.message || "";
      if (message === "Player not found") {
        clearPlayerSession();
        navigate("/", { replace: true });
        return;
      }
      // If round ended before this request arrived, avoid noisy UI errors.
      if (message === "No active question" || message === "Answer window is closed") {
        return;
      }
      setError(localizeErrorMessage(message || "Failed to save answer"));
    } finally {
      setBusy(false);
    }
  }, [sessionId, navigate]);

  useEffect(() => {
    if (!sessionId || !questionId || phase !== "OPEN" || isGameOver || !state?.round_ends_at || !selected) {
      return;
    }

    if (myAnswer?.selected_option === selected || submittedForQuestionRef.current === questionId) {
      return;
    }

    const submittingQuestionId = questionId;
    const selectedOption = selected;
    const msRemaining = new Date(state.round_ends_at).getTime() - Date.now();
    const delayMs = Math.max(0, msRemaining);

    const timer = window.setTimeout(() => {
      submitCurrentSelection(submittingQuestionId, selectedOption);
    }, delayMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [sessionId, questionId, phase, isGameOver, state?.round_ends_at, selected, myAnswer?.selected_option, submitCurrentSelection]);

  useEffect(() => {
    const previousPhase = previousPhaseRef.current;
    previousPhaseRef.current = phase;

    if (
      previousPhase === "OPEN" &&
      phase !== "OPEN" &&
      !isGameOver &&
      questionId &&
      selected &&
      !myAnswer &&
      submittedForQuestionRef.current !== questionId
    ) {
      submitCurrentSelection(questionId, selected);
    }
  }, [phase, isGameOver, questionId, selected, myAnswer, submitCurrentSelection]);

  if (!session) {
    return null;
  }

  const revealMode = phase === "REVEAL";
  const birthdayAnswer = revealMode ? (state?.special_player_answer || null) : null;
  const benchmarkOption = revealMode ? (question?.correct_option || null) : null;
  const hasQuestion = Boolean(question);
  const showQuestion = hasQuestion && phase !== "IDLE";
  const isGameReadOnly = state?.game_status === "closed";
  const canSelect = phase === "OPEN" && countdownSeconds > 0 && !isGameReadOnly;

  return (
    <main className="mx-auto max-w-3xl p-3 sm:p-4 md:p-8">
      <section className="panel p-4 sm:p-5 md:p-6 animate-riseIn">
        <div className="flex items-start justify-between gap-3">
          <p className="font-display text-5xl sm:text-6xl leading-none text-ink">{player?.score ?? 0}</p>
          <p className="max-w-[52%] text-right font-display text-xl sm:text-2xl leading-tight text-ink break-words">{player?.name || sessionName}</p>
        </div>

        <div className="mt-5 rounded-2xl border border-ink/10 bg-white p-4 sm:p-5">
          {!loaded ? (
            <p className="text-base text-steel">Načítání...</p>
          ) : isGameReadOnly ? (
            <>
              <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-steel">Hra je uzavřena</p>
              <p className="text-base text-steel">Tato hra byla ukončena. Všechna data jsou nyní pouze pro čtení.</p>
              {isGameOver && leaderboard.length > 0 ? (
                <>
                  <p className="mt-5 mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-steel">Konečné pořadí</p>
                  <ul className="space-y-3">
                    {leaderboard.map((entry, index) => {
                      const rank = index + 1;
                      const isTop3 = rank <= 3;
                      const rankTone =
                        rank === 1
                          ? "border-amber-400 bg-amber-50"
                          : rank === 2
                            ? "border-slate-300 bg-slate-50"
                            : rank === 3
                              ? "border-orange-300 bg-orange-50"
                              : "border-ink/10 bg-white";

                      return (
                        <li
                          key={entry.id}
                          className={`rounded-xl border px-4 py-3 ${rankTone} ${isTop3 ? "text-lg sm:text-xl font-semibold" : "text-base"}`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate">{rank}. {entry.name}</span>
                            <span className="font-display text-xl sm:text-2xl">{entry.score}</span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : null}
            </>
          ) : isGameOver ? (
            <>
              <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-steel">Konečné pořadí</p>
              <ul className="space-y-3">
                {leaderboard.map((entry, index) => {
                  const rank = index + 1;
                  const isTop3 = rank <= 3;
                  const rankTone =
                    rank === 1
                      ? "border-amber-400 bg-amber-50"
                      : rank === 2
                        ? "border-slate-300 bg-slate-50"
                        : rank === 3
                          ? "border-orange-300 bg-orange-50"
                          : "border-ink/10 bg-white";

                  return (
                    <li
                      key={entry.id}
                      className={`rounded-xl border px-4 py-3 ${rankTone} ${isTop3 ? "text-lg sm:text-xl font-semibold" : "text-base"}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate">{rank}. {entry.name}</span>
                        <span className="font-display text-xl sm:text-2xl">{entry.score}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : !showQuestion ? (
            <p className="text-base text-steel">Momentálně není aktivní otázka.</p>
          ) : (
            <>
              {phase === "OPEN" ? (
                <p className="mb-2 font-display text-2xl text-ink">{formatCountdown(countdownSeconds)}</p>
              ) : null}
              {phase === "CLOSED" ? (
                <p className="mb-2 text-sm text-steel">Kolo je uzavřené. Čeká se na další krok moderátora.</p>
              ) : null}
              <p className="text-xl sm:text-2xl font-semibold leading-snug text-ink">{question.prompt}</p>

              {question.image_url ? (
                <div className="mt-4 overflow-hidden rounded-xl border border-ink/10 bg-fog/40">
                  <img
                    src={question.image_url}
                    alt="Nápověda k otázce"
                    className="max-h-80 w-full object-contain"
                    loading="lazy"
                  />
                </div>
              ) : null}

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {ANSWER_OPTIONS.map((optionKey) => {
                  const optionLabel = question[`option_${optionKey.toLowerCase()}`];
                  const isSelected = selected === optionKey;
                  const isLockedChoice = myAnswer?.selected_option === optionKey;
                  const isCorrectOption = revealMode && benchmarkOption && benchmarkOption === optionKey;
                  const isBirthdayOption = revealMode && birthdayAnswer && birthdayAnswer === optionKey;
                  const isWrongLockedOption = revealMode && isLockedChoice && !isCorrectOption;

                  let stateClass = "border-ink/20 bg-white text-ink";
                  if (isCorrectOption) {
                    stateClass = "border-mint bg-mint/20 text-ink";
                  } else if (isWrongLockedOption) {
                    stateClass = "border-pink-400 bg-pink-100 text-ink";
                  } else if (canSelect && isSelected) {
                    stateClass = "border-ink bg-ink text-white";
                  } else if (myAnswer && isLockedChoice) {
                    stateClass = "border-ink bg-ink text-white";
                  }

                  return (
                    <button
                      key={optionKey}
                      type="button"
                      className={`min-h-14 rounded-xl border px-4 py-3 text-left text-base leading-snug transition ${stateClass}`}
                      onClick={() => setSelected(optionKey)}
                      disabled={!canSelect}
                    >
                      <span className="font-semibold mr-1">{optionKey}.</span>
                      <span>{optionLabel}</span>
                      {isBirthdayOption ? <span className="ml-2" aria-label="narozeninová odpověď">🎉</span> : null}
                    </button>
                  );
                })}
              </div>

            </>
          )}
          {error ? <p className="mt-4 text-sm sm:text-base text-ember">{error}</p> : null}
        </div>
      </section>
    </main>
  );
}
