const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.detail || payload?.message || "Request failed");
  }
  return payload;
}

export function createPlayer(name) {
  return request("/api/players", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function getPlayer(id) {
  return request(`/api/players/${id}`);
}

export function getLeaderboard() {
  return request("/api/leaderboard");
}

export function getQuizState() {
  return request("/api/quiz/state");
}

export function submitAnswer(playerId, option) {
  return request("/api/quiz/answer", {
    method: "POST",
    body: JSON.stringify({ player_id: playerId, option }),
  });
}

export function getPlayerAnswer(questionId, playerId) {
  return request(`/api/quiz/answers/${questionId}/${playerId}`);
}

export function getPublicQuestions() {
  return request("/api/questions");
}

export function adminPost(path, token, body = {}) {
  return request(`/api/admin${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

export function adminGet(path, token) {
  return request(`/api/admin${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function adminDelete(path, token) {
  return request(`/api/admin${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}
