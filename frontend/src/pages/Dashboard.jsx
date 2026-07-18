import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getPlayer, getPlayerAnswer, getQuizState, submitAnswer } from "../lib/api";
import Leaderboard from "../components/Leaderboard";
import { clearPlayerSession, loadPlayerSession } from "../lib/session";
import { supabase } from "../lib/supabase";

const ANSWER_OPTIONS = ["A", "B", "C", "D"];

export default function DashboardPage() {
  const navigate = useNavigate();
  const session = loadPlayerSession();
  const [player, setPlayer] = useState(session || null);
  const [quizState, setQuizState] = useState(null);
  const [question, setQuestion] = useState(null);
  const [answerCount, setAnswerCount] = useState(0);
  const [selected, setSelected] = useState("A");
  const [myAnswer, setMyAnswer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
          setAnswerCount(quiz.answer_count || 0);
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

  const endsAtLabel = useMemo(() => {
    if (!quizState?.round_ends_at) {
      return "-";
    }
    return new Date(quizState.round_ends_at).toLocaleTimeString();
  }, [quizState?.round_ends_at]);

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

  return (
    <main className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
        <section className="panel p-6 animate-riseIn">
          <p className="text-xs uppercase tracking-[0.22em] text-steel">Player</p>
          <h1 className="mt-2 font-display text-3xl text-ink">{player?.name || session.name}</h1>
          <p className="mt-2 text-sm text-steel">Score</p>
          <p className="font-display text-5xl text-ink">{player?.score ?? 0}</p>

          <div className="mt-6 rounded-xl border border-ink/10 bg-white p-4">
            <p className="text-sm font-semibold text-ink">Current Question</p>
            {!quizState?.is_active || !question ? (
              <p className="mt-3 text-sm text-steel">No active question. Waiting for the host to start a round.</p>
            ) : (
              <>
                <p className="mt-2 text-sm text-steel">{question.category || "General"} • Ends at {endsAtLabel}</p>
                <p className="mt-3 text-lg font-semibold text-ink">{question.prompt}</p>

                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {ANSWER_OPTIONS.map((optionKey) => {
                    const optionLabel = question[`option_${optionKey.toLowerCase()}`];
                    const selectedClass = selected === optionKey ? "border-ink bg-ink text-white" : "border-ink/20 bg-white text-ink";
                    return (
                      <button
                        key={optionKey}
                        type="button"
                        className={`rounded-xl border px-3 py-2 text-left text-sm transition ${selectedClass}`}
                        onClick={() => setSelected(optionKey)}
                        disabled={!!myAnswer || busy}
                      >
                        <span className="font-semibold">{optionKey}.</span> {optionLabel}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <button className="btn-accent" onClick={onSubmit} disabled={!!myAnswer || busy}>
                    {busy ? "Submitting..." : myAnswer ? "Answer Locked" : "Submit Answer"}
                  </button>
                  <p className="text-sm text-steel">Answers this round: {answerCount}</p>
                </div>

                {myAnswer ? (
                  <p className="mt-3 text-sm text-mint">
                    You answered {myAnswer.selected_option}. {myAnswer.is_correct ? "Correct!" : "Locked in."}
                  </p>
                ) : null}

                {quizState?.reveal_answers && question?.correct_option ? (
                  <p className="mt-2 text-sm text-ink">Correct answer: {question.correct_option}</p>
                ) : null}
              </>
            )}
            {error ? <p className="mt-3 text-sm text-ember">{error}</p> : null}
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <button
              className="btn-ghost"
              onClick={() => {
                clearPlayerSession();
                navigate("/");
              }}
            >
              Leave Quiz
            </button>
          </div>
        </section>

        <Leaderboard />
      </div>
    </main>
  );
}
