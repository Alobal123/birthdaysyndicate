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

export function createEncounter(p1_id) {
  return request("/api/encounters", {
    method: "POST",
    body: JSON.stringify({ p1_id }),
  });
}

export function joinEncounter(encounterId, player_id) {
  return request(`/api/encounters/${encounterId}/join`, {
    method: "PATCH",
    body: JSON.stringify({ player_id }),
  });
}

export function submitChoice(encounterId, player_id, choice, item = null) {
  return request(`/api/encounters/${encounterId}/choice`, {
    method: "PATCH",
    body: JSON.stringify({ player_id, choice, item }),
  });
}

export function claimLoot(player_id, token) {
  return request("/api/loot/claim", {
    method: "POST",
    body: JSON.stringify({ player_id, token }),
  });
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
