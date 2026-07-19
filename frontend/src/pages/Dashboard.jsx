import { useEffect, useRef, useState } from "react";
import { getPlayer, getPlayerAnswer, getQuizState, submitAnswer } from "../lib/api";
import { loadPlayerSession } from "../lib/session";
import { supabase } from "../lib/supabase";

const ANSWER_OPTIONS = ["A", "B", "C", "D"];

export default function DashboardPage() {
  const session = loadPlayerSession();
  const [player, setPlayer] = useState(session || null);
  const [quizState, setQuizState] = useState(null);
  const [question, setQuestion] = useState(null);
  const [selected, setSelected] = useState("A");
  const [myAnswer, setMyAnswer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [countdownSeconds, setCountdownSeconds] = useState(0);
  const loadRequestRef = useRef(0);
  const lastQuestionIdRef = useRef(null);

  useEffect(() => {
    if (!session) {
      return;
    }

    let alive = true;

    const loadAll = async () => {
      const requestId = ++loadRequestRef.current;
      try {
        const [p, quiz] = await Promise.all([getPlayer(session.id), getQuizState()]);
        if (alive && requestId === loadRequestRef.current) {
          setPlayer(p);
          setQuizState(quiz.state || null);
          setQuestion(quiz.question || null);
        }

        const currentQuestionId = quiz.state?.current_question_id || null;
        if (!currentQuestionId) {
          if (alive && requestId === loadRequestRef.current) {
            setMyAnswer(null);
          }
          return;
        }

        const answerData = await getPlayerAnswer(currentQuestionId, session.id);
        if (alive && requestId === loadRequestRef.current) {
          setMyAnswer(answerData.answer || null);
        }
      } catch (err) {
        if (alive && requestId === loadRequestRef.current) {
          setError(err.message || "Failed to load quiz state");
        }
      }
    };

    loadAll();

    const refreshTimer = window.setInterval(loadAll, 5000);

    const channel = supabase
      .channel(`quiz-dashboard-${session.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "players", filter: `id=eq.${session.id}` },
        (payload) => setPlayer(payload.new)
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "game_state" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "player_answers" }, loadAll)
      .subscribe();

    return () => {
      alive = false;
      window.clearInterval(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [session]);

  useEffect(() => {
    const currentQuestionId = quizState?.current_question_id || null;
    if (lastQuestionIdRef.current !== currentQuestionId) {
      lastQuestionIdRef.current = currentQuestionId;
      setMyAnswer(null);
      setBusy(false);
      setSelected("A");
    }
  }, [quizState?.current_question_id]);

  useEffect(() => {
    if (!quizState?.is_active || !quizState?.round_ends_at) {
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
  }, [quizState?.is_active, quizState?.round_ends_at]);

  const formatCountdown = (value) => {
    const safe = Math.max(0, value || 0);
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };

  const onSubmit = async () => {
    if (!session?.id || !quizState?.current_question_id || myAnswer || busy) {
      return;
    }

    const submittingQuestionId = quizState.current_question_id;
    setBusy(true);
    setError("");
    try {
      const result = await submitAnswer(session.id, selected);
      if (quizState?.current_question_id === submittingQuestionId) {
        setMyAnswer(result.answer || null);
      }
      const p = await getPlayer(session.id);
      setPlayer(p);
    } catch (err) {
      setError(err.message || "Failed to submit answer");
    } finally {
      setBusy(false);
    }
  };

  if (!session) {
    return null;
  }

  const revealMode = Boolean(quizState?.reveal_answers && question?.correct_option);
  const showQuestion = Boolean(question && (quizState?.is_active || revealMode));

  return (
    <main className="mx-auto max-w-3xl p-3 sm:p-4 md:p-8">
      <section className="panel p-4 sm:p-5 md:p-6 animate-riseIn">
        <div className="flex items-start justify-between gap-3">
          <p className="font-display text-5xl sm:text-6xl leading-none text-ink">{player?.score ?? 0}</p>
          <p className="max-w-[52%] text-right font-display text-xl sm:text-2xl leading-tight text-ink break-words">{player?.name || session.name}</p>
        </div>

        <div className="mt-5 rounded-2xl border border-ink/10 bg-white p-4 sm:p-5">
          {!showQuestion ? (
            <p className="text-base text-steel">No active question.</p>
          ) : (
            <>
              {quizState?.is_active ? (
                <p className="mb-2 font-display text-2xl text-ink">{formatCountdown(countdownSeconds)}</p>
              ) : null}
              <p className="text-xl sm:text-2xl font-semibold leading-snug text-ink">{question.prompt}</p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {ANSWER_OPTIONS.map((optionKey) => {
                  const optionLabel = question[`option_${optionKey.toLowerCase()}`];
                  const isSelected = selected === optionKey;
                  const isLockedChoice = myAnswer?.selected_option === optionKey;
                  const isCorrectOption = revealMode && question.correct_option === optionKey;
                  const isWrongLockedOption = revealMode && isLockedChoice && !isCorrectOption;

                  let stateClass = "border-ink/20 bg-white text-ink";
                  if (isCorrectOption) {
                    stateClass = "border-mint bg-mint/20 text-ink";
                  } else if (isWrongLockedOption) {
                    stateClass = "border-ember bg-ember/20 text-ink";
                  } else if (myAnswer && isLockedChoice) {
                    stateClass = "border-ink bg-ink text-white";
                  } else if (!myAnswer && isSelected) {
                    stateClass = "border-ink bg-ink text-white";
                  }

                  return (
                    <button
                      key={optionKey}
                      type="button"
                      className={`min-h-14 rounded-xl border px-4 py-3 text-left text-base leading-snug transition ${stateClass}`}
                      onClick={() => setSelected(optionKey)}
                      disabled={!!myAnswer || busy}
                    >
                      <span className="font-semibold mr-1">{optionKey}.</span>
                      <span>{optionLabel}</span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-5">
                <button className="btn-accent w-full sm:w-auto min-h-12 px-6 text-base" onClick={onSubmit} disabled={!!myAnswer || busy}>
                  {busy ? "Submitting..." : myAnswer ? "Locked In" : "Lock In"}
                </button>
              </div>
            </>
          )}
          {error ? <p className="mt-4 text-sm sm:text-base text-ember">{error}</p> : null}
        </div>
      </section>
    </main>
  );
}
