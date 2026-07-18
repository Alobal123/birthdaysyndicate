export const PLAYER_ID_KEY = "pub_quiz_player_id";
export const PLAYER_NAME_KEY = "pub_quiz_player_name";

export function savePlayerSession(player) {
  localStorage.setItem(PLAYER_ID_KEY, player.id);
  localStorage.setItem(PLAYER_NAME_KEY, player.name);
}

export function loadPlayerSession() {
  const id = localStorage.getItem(PLAYER_ID_KEY);
  const name = localStorage.getItem(PLAYER_NAME_KEY);
  if (!id || !name) {
    return null;
  }
  return { id, name };
}

export function clearPlayerSession() {
  localStorage.removeItem(PLAYER_ID_KEY);
  localStorage.removeItem(PLAYER_NAME_KEY);
}
