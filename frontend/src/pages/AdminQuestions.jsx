import { useEffect, useState } from "react";
import { adminDelete, adminGet, adminPost, adminUploadQuestionImage } from "../lib/api";
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
    image_url: "",
    correct_option: "",
    duration_seconds: 20,
  });
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [draftImageFile, setDraftImageFile] = useState(null);
  const [editImageFile, setEditImageFile] = useState(null);
  const [uploading, setUploading] = useState(false);
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

    const created = await adminPost("/questions", token, {
      prompt,
      option_a,
      option_b,
      option_c,
      option_d,
      image_url: draft.image_url.trim() || null,
      correct_option: draft.correct_option || null,
      duration_seconds,
    });

    if (draftImageFile && created?.id) {
      const payload = await adminUploadQuestionImage(created.id, token, draftImageFile);
      const uploadedUrl = payload?.image_url || "";
      if (!uploadedUrl) {
        throw new Error("Image uploaded, but image URL was not returned.");
      }
    }

    setDraft({
      prompt: "",
      option_a: "",
      option_b: "",
      option_c: "",
      option_d: "",
      image_url: "",
      correct_option: "",
      duration_seconds: 20,
    });
    setDraftImageFile(null);
    setMessage("Question created");
  };

  const beginEdit = (row) => {
    setEditingId(row.id);
    setEditImageFile(null);
    setEditDraft({
      prompt: row.prompt || "",
      option_a: row.option_a || "",
      option_b: row.option_b || "",
      option_c: row.option_c || "",
      option_d: row.option_d || "",
      image_url: row.image_url || "",
      correct_option: row.correct_option || "",
      duration_seconds: row.duration_seconds || 20,
    });
  };

  const saveEdit = async () => {
    if (!editingId || !editDraft) {
      return;
    }
    const prompt = editDraft.prompt.trim();
    const option_a = editDraft.option_a.trim();
    const option_b = editDraft.option_b.trim();
    const option_c = editDraft.option_c.trim();
    const option_d = editDraft.option_d.trim();
    const duration_seconds = Number(editDraft.duration_seconds || 20);

    if (prompt.length < 5) {
      throw new Error("Prompt must be at least 5 characters.");
    }
    if (!option_a || !option_b || !option_c || !option_d) {
      throw new Error("All answer options (A-D) are required.");
    }
    if (Number.isNaN(duration_seconds) || duration_seconds < 5 || duration_seconds > 600) {
      throw new Error("Default time must be between 5 and 600 seconds.");
    }

    const updated = await adminPost(`/questions/${editingId}/update`, token, {
      prompt,
      option_a,
      option_b,
      option_c,
      option_d,
      image_url: editDraft.image_url.trim() || null,
      correct_option: editDraft.correct_option || null,
      duration_seconds,
    });

    if (editImageFile) {
      const payload = await adminUploadQuestionImage(editingId, token, editImageFile);
      const uploadedUrl = payload?.image_url || "";
      if (!uploadedUrl) {
        throw new Error("Image uploaded, but image URL was not returned.");
      }
      if (updated) {
        updated.image_url = uploadedUrl;
      }
    }

    setMessage("Question updated");
    setEditingId(null);
    setEditDraft(null);
    setEditImageFile(null);
  };

  const validateSelectedImage = (file) => {
    if (!file) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      throw new Error("Only image files are allowed.");
    }
    if (file.size > 8 * 1024 * 1024) {
      throw new Error("Image must be 8MB or smaller.");
    }
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

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                try {
                  validateSelectedImage(file);
                  setDraftImageFile(file || null);
                } catch (err) {
                  setError(err.message || "Image selection failed");
                }
                e.target.value = "";
              }}
            />
            {draftImageFile ? <span className="text-xs text-steel">Selected: {draftImageFile.name}</span> : null}
          </div>

          {draft.image_url ? (
            <img
              src={draft.image_url}
              alt="Question clue"
              className="max-h-40 rounded-lg border border-ink/10 object-contain"
            />
          ) : null}

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
                    {editingId === row.id && editDraft ? (
                      <div className="space-y-3">
                        <div>
                          <label className="text-xs font-semibold text-ink">Prompt</label>
                          <input
                            className="mt-1 w-full"
                            value={editDraft.prompt}
                            onChange={(e) => setEditDraft((prev) => ({ ...prev, prompt: e.target.value }))}
                          />
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <input className="w-full" value={editDraft.option_a} onChange={(e) => setEditDraft((prev) => ({ ...prev, option_a: e.target.value }))} placeholder="Option A" />
                          <input className="w-full" value={editDraft.option_b} onChange={(e) => setEditDraft((prev) => ({ ...prev, option_b: e.target.value }))} placeholder="Option B" />
                          <input className="w-full" value={editDraft.option_c} onChange={(e) => setEditDraft((prev) => ({ ...prev, option_c: e.target.value }))} placeholder="Option C" />
                          <input className="w-full" value={editDraft.option_d} onChange={(e) => setEditDraft((prev) => ({ ...prev, option_d: e.target.value }))} placeholder="Option D" />
                        </div>

                        <div className="grid gap-2 sm:grid-cols-[160px_140px] sm:items-end">
                          <div>
                            <label className="text-xs font-semibold text-ink">Reference</label>
                            <select
                              className="mt-1 w-full"
                              value={editDraft.correct_option}
                              onChange={(e) => setEditDraft((prev) => ({ ...prev, correct_option: e.target.value }))}
                            >
                              <option value="">No right answer</option>
                              <option value="A">A</option>
                              <option value="B">B</option>
                              <option value="C">C</option>
                              <option value="D">D</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-xs font-semibold text-ink">Default Time</label>
                            <input
                              className="mt-1 w-full"
                              type="number"
                              min="5"
                              max="600"
                              value={editDraft.duration_seconds}
                              onChange={(e) => setEditDraft((prev) => ({ ...prev, duration_seconds: Number(e.target.value || 20) }))}
                            />
                          </div>
                        </div>

                        {editDraft.image_url ? (
                          <img
                            src={editDraft.image_url}
                            alt="Question clue"
                            className="max-h-40 rounded-lg border border-ink/10 object-contain"
                          />
                        ) : null}

                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              try {
                                validateSelectedImage(file);
                                setEditImageFile(file || null);
                              } catch (err) {
                                setError(err.message || "Image selection failed");
                              }
                              e.target.value = "";
                            }}
                          />
                          {editImageFile ? <span className="text-xs text-steel">Selected: {editImageFile.name}</span> : null}
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="font-semibold text-ink">{row.prompt}</p>
                        {row.image_url ? (
                          <img
                            src={row.image_url}
                            alt="Question clue"
                            className="mt-2 max-h-40 rounded-lg border border-ink/10 object-contain"
                          />
                        ) : null}
                        <p className="text-steel">A: {row.option_a}</p>
                        <p className="text-steel">B: {row.option_b}</p>
                        <p className="text-steel">C: {row.option_c}</p>
                        <p className="text-steel">D: {row.option_d}</p>
                        <p className="text-ink">Reference: {row.correct_option || "N/A"}</p>
                        <p className="text-steel">Default time: {row.duration_seconds || 20}s</p>
                      </>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {editingId === row.id ? (
                      <>
                        <button className="btn-accent" onClick={() => run(saveEdit)}>Save</button>
                        <button className="btn-ghost" onClick={() => {
                          setEditingId(null);
                          setEditDraft(null);
                          setEditImageFile(null);
                        }}>Cancel</button>
                      </>
                    ) : (
                      <button className="btn-ghost" onClick={() => beginEdit(row)}>Edit</button>
                    )}
                    <button
                      className="btn-ghost"
                      onClick={() => run(async () => {
                        await adminDelete(`/questions/${row.id}`, token);
                        setMessage("Question deleted");
                        if (editingId === row.id) {
                          setEditingId(null);
                          setEditDraft(null);
                        }
                      })}
                    >
                      Delete
                    </button>
                  </div>
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