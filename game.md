Here is the comprehensive game specification and development blueprint compiled into a single Markdown document. You can feed this file directly into another AI assistant to begin generating the code for your frontend, backend, and database.

---

# Technical Specification: "The Great Birthday Syndicate"

## 1. Project Overview

"The Great Birthday Syndicate" is a mobile-first, real-time web application designed as a social deduction game for a 30th birthday party. The game re-themes the classic Game Theory "Prisoner's Dilemma" (expanded to a 3-choice matrix) into an underground mafia syndicate setting.

* **Objective:** Players interact face-to-face, negotiate deals, and execute "Encounters" via QR codes to earn points and climb a live leaderboard.
* **Target Stack:** React (Vite) + Tailwind CSS (Frontend), FastAPI (Python Backend Logic Engine), and Supabase (Database & Real-time WebSockets).
* **Hosting:** Vercel (Frontend), Render/Railway (Backend API), Supabase Cloud (Database).

---

## 2. Core Game Loop & QR Mechanics

To ensure maximum security and prevent spoofing or remote cheating, the interaction follows a strict state machine bound to a unique **Encounter ID**, rather than static Player IDs.

```
[Player A] clicks "Propose Deal" 
   └── App creates an entry in 'encounters' table (Status: 'PENDING')
   └── App displays a QR code containing: https://domain.com/encounter/[encounter_id]

[Player B] scans Player A's screen
   └── App extracts [encounter_id]
   └── App updates the 'encounters' row, setting p2_id = Player B, status = 'LOCKED'

[Both Phones] listen to the same row in Supabase via Real-time WebSockets.
   └── Both UIs automatically transition to the "Strategy Selection Screen".

```

---

## 3. The 3-Choice Payoff Matrix

The game uses three options with varying risk/reward profiles.

1. 🤝 **ALLIANCE (Cooperate):** Maximizes mutual gains. High reward, high risk.
2. 🔪 **CUT (Split):** The protective shield. Caps upside but blunts enemy backstabs.
3. 💰 **HEIST (Defect):** The predatory strike. Steals everything from trusting players.

### Points Evaluation Rules

| Player 1 Choice | Player 2 Choice | Player 1 Outcome | Player 2 Outcome |
| --- | --- | --- | --- |
| **ALLIANCE** | **ALLIANCE** | **+12 pts** *(Mutual Trust)* | **+12 pts** *(Mutual Trust)* |
| **ALLIANCE** | **CUT** | **+4 pts** | **+14 pts** |
| **ALLIANCE** | **HEIST** | **0 pts** *(Blindsided)* | **+20 pts** *(The Thief)* |
| **CUT** | **ALLIANCE** | **+14 pts** | **+4 pts** |
| **CUT** | **CUT** | **+8 pts** *(Safe Play)* | **+8 pts** *(Safe Play)* |
| **CUT** | **HEIST** | **+2 pts** *(Shielded)* | **+14 pts** |
| **HEIST** | **ALLIANCE** | **+20 pts** *(The Thief)* | **0 pts** *(Blindsided)* |
| **HEIST** | **CUT** | **+14 pts** | **+2 pts** *(Shielded)* |
| **HEIST** | **HEIST** | **+2 pts** *(Mutual Chaos)* | **+2 pts** *(Mutual Chaos)* |

---

## 4. Database Schema (Supabase PostgreSQL)

```sql
-- Enable Realtime replication for the encounters table
alter publication supabase_realtime add table encounters;

-- 1. Players Table
CREATE TABLE players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    score INT DEFAULT 0,
    inventory TEXT[] DEFAULT '{}' -- Stores item keys, e.g., ['smoke_bomb', 'wiretap']
);

-- 2. Encounters Table
CREATE TABLE encounters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    p1_id UUID REFERENCES players(id) ON DELETE CASCADE,
    p2_id UUID REFERENCES players(id) ON DELETE CASCADE,
    p1_choice TEXT DEFAULT NULL, -- 'ALLIANCE', 'CUT', 'HEIST'
    p2_choice TEXT DEFAULT NULL,
    p1_item TEXT DEFAULT NULL,   -- Active item played by P1
    p2_item TEXT DEFAULT NULL,   -- Active item played by P2
    status TEXT DEFAULT 'PENDING' -- 'PENDING', 'LOCKED', 'COMPLETED', 'CANCELED'
);

```

---

## 5. Backend Logic Engine (FastAPI / Python)

The backend exposes a single critical endpoint: `POST /api/evaluate`.
When both players have submitted their choices, the frontend invokes this endpoint to safely process game logic, process item hooks, update player scores, and flip the encounter state to `COMPLETED`.

```python
class SyndicateGameEngine:
    def __init__(self):
        self.base_matrix = {
            ("ALLIANCE", "ALLIANCE"): (12, 12),
            ("ALLIANCE", "CUT"):      (4, 14),
            ("ALLIANCE", "HEIST"):    (0, 20),
            ("CUT", "ALLIANCE"):      (14, 4),
            ("CUT", "CUT"):           (8, 8),
            ("CUT", "HEIST"):         (2, 14),
            ("HEIST", "ALLIANCE"):    (20, 0),
            ("HEIST", "CUT"):         (14, 2),
            ("HEIST", "HEIST"):       (2, 2)
        }

    def evaluate(self, p1_choice, p2_choice, p1_item=None, p2_item=None):
        # 1. Pre-choice hooks (Items that alter choices before calculation)
        p1_choice, p2_choice = self._apply_pre_hooks(p1_choice, p2_choice, p1_item, p2_item)
        
        # 2. Fetch base calculation
        p1_score, p2_score = self.base_matrix[(p1_choice, p2_choice)]
        is_canceled = False

        # 3. Post-score hooks (Items modifying final outputs, e.g., Shields or Multipliers)
        state = {
            "p1_score": p1_score, "p2_score": p2_score,
            "p1_choice": p1_choice, "p2_choice": p2_choice,
            "p1_item": p1_item, "p2_item": p2_item,
            "is_canceled": is_canceled
        }
        state = self._apply_post_hooks(state)

        if state["is_canceled"]:
            return {"p1_delta": 0, "p2_delta": 0, "status": "CANCELED"}

        return {
            "p1_delta": state["p1_score"],
            "p2_delta": state["p2_score"],
            "status": "COMPLETED"
        }

    def _apply_pre_hooks(self, p1_c, p2_c, p1_i, p2_i):
        # Placeholder for information/manipulation items
        return p1_c, p2_c

    def _apply_post_hooks(self, state):
        # Placeholder for defensive/multiplier items
        return state

```

---

## 6. Frontend UI State Machine (React)

The React frontend handles the player session persistence inside `LocalStorage` so refreshing the browser does not lose player points or configuration.

### UI Screens Required:

1. **Login/Onboarding Screen:** User enters their name. The app creates a row in the `players` table and saves the resulting `player_id` to local storage.
2. **Dashboard Screen:** Displays the player's name, current score, a list of their inventory items, and a persistent "Leaderboard" component tracking total player rankings. Features a large action button: **"Initiate Syndicate Deal"**.
3. **Encounter Host/Scanner View:**
* If initiating: App creates a new encounter row and generates a QR code matching its unique ID.
* If scanning: App fires the device camera scanner, reads the QR ID, links the player as `p2_id`, and patches the status to `LOCKED`.


4. **Strategy Selection Screen:** Triggered automatically via Supabase Realtime when `status === 'LOCKED'`. Displays three choice buttons (Alliance, Cut, Heist) along with an optional dropdown menu pulling from their item inventory. Hitting submit locks their choice into the database.
5. **Reveal Screen:** Fires once `status === 'COMPLETED'`. Animates the final points calculated by the Python API using dramatic UI cues (e.g., green splash for successful theft, red tint for getting backstabbed).

---

## 7. Item Loot System Strategy

To distribute items throughout the physical party venue:

* Static QR codes are printed and hidden across the physical venue.
* The QR URLs embed an item type and a validation signature (e.g., `/claim?item=smoke_bomb&sig=secret_token`).
* When scanned, a lightweight endpoint verifies the token and pushes the item tag directly into that player's `inventory` array in the database.

---