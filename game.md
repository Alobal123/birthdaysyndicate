# Birthday Syndicate: Pub Quiz (Reset Spec)

## Goal
Replace the previous game logic with a simpler live pub-quiz format while keeping the same project structure, FastAPI + React setup, and Supabase backend.

## Core Loop
1. A player joins with a display name.
2. Admin activates a question for a timed round.
3. Players submit one answer (A/B/C/D).
4. Correct answers earn points.
5. Admin reveals the correct answer.
6. Leaderboard updates in realtime.

## Entities
- Player: name, score.
- Quiz Question: prompt, 4 options, correct option.
- Game State: single global row for active round and current question.
- Player Answer: one answer per player per question.

## API Shape
- Public:
1. `POST /api/players`
2. `GET /api/players/{id}`
3. `GET /api/leaderboard`
4. `GET /api/quiz/state`
5. `POST /api/quiz/answer`
6. `GET /api/quiz/answers/{question_id}/{player_id}`
7. `GET /api/questions`

- Admin (Bearer token):
1. `POST /api/admin/game/start`
2. `POST /api/admin/game/stop`
3. `POST /api/admin/game/reset`
4. `GET /api/admin/players`
5. `DELETE /api/admin/players/{player_id}`
6. `POST /api/admin/questions`
7. `GET /api/admin/questions`
8. `POST /api/admin/questions/activate`
9. `POST /api/admin/questions/reveal`
10. `GET /api/admin/answers/current`

## Frontend Screens
- Login: name entry.
- Dashboard: active question + answer form + score + leaderboard.
- Admin: question management, round control, answer monitoring.

## Notes
- Supabase Realtime remains in use for score and round updates.
- This reset intentionally removes encounter/loot mechanics.