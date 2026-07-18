function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function detectApiBaseUrl() {
  const configured = (import.meta.env.VITE_API_BASE_URL || "").trim();
  if (configured) {
    return stripTrailingSlash(configured);
  }

  if (typeof window === "undefined") {
    return "http://localhost:8000";
  }

  const { hostname, origin } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://localhost:8000";
  }

  // In deployed environments, default to same-origin API unless explicitly overridden.
  return stripTrailingSlash(origin);
}

const API_BASE_URL = detectApiBaseUrl();

function formatError(payload) {
  if (Array.isArray(payload?.detail)) {
    return payload.detail
      .map((item) => {
        const field = Array.isArray(item?.loc) ? item.loc.slice(1).join(".") : "field";
        return `${field}: ${item?.msg || "Invalid value"}`;
      })
      .join(" | ");
  }

  if (typeof payload?.detail === "string") {
    return payload.detail;
  }

  if (payload?.detail && typeof payload.detail === "object") {
    try {
      return JSON.stringify(payload.detail);
    } catch {
      return "Request failed";
    }
  }

  if (typeof payload?.message === "string") {
    return payload.message;
  }

  if (payload?.message && typeof payload.message === "object") {
    try {
      return JSON.stringify(payload.message);
    } catch {
      return "Request failed";
    }
  }

  return "Request failed";
}

async function request(path, options = {}) {
  const url = `${API_BASE_URL}${path}`;
  const headers = {
    ...(options.headers || {}),
  };
  if (options.body !== undefined && !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
    headers["Content-Type"] = "application/json";
  }

  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers,
    });
  } catch {
    throw new Error(`Network error reaching ${url}. Check backend URL and CORS configuration.`);
  }

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(formatError(payload));
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
