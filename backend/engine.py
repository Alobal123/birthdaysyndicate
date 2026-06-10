from typing import Optional


class SyndicateGameEngine:
    def __init__(self) -> None:
        self.base_matrix = {
            ("ALLIANCE", "ALLIANCE"): (12, 12),
            ("ALLIANCE", "CUT"): (4, 14),
            ("ALLIANCE", "HEIST"): (0, 20),
            ("CUT", "ALLIANCE"): (14, 4),
            ("CUT", "CUT"): (8, 8),
            ("CUT", "HEIST"): (2, 14),
            ("HEIST", "ALLIANCE"): (20, 0),
            ("HEIST", "CUT"): (14, 2),
            ("HEIST", "HEIST"): (2, 2),
        }

    def evaluate(
        self,
        p1_choice: str,
        p2_choice: str,
        p1_item: Optional[str] = None,
        p2_item: Optional[str] = None,
    ) -> dict:
        p1_choice, p2_choice = self._apply_pre_hooks(p1_choice, p2_choice, p1_item, p2_item)

        p1_score, p2_score = self.base_matrix[(p1_choice, p2_choice)]
        state = {
            "p1_score": p1_score,
            "p2_score": p2_score,
            "p1_choice": p1_choice,
            "p2_choice": p2_choice,
            "p1_item": p1_item,
            "p2_item": p2_item,
            "is_canceled": False,
        }
        state = self._apply_post_hooks(state)

        if state["is_canceled"]:
            return {"p1_delta": 0, "p2_delta": 0, "status": "CANCELED"}

        return {
            "p1_delta": state["p1_score"],
            "p2_delta": state["p2_score"],
            "status": "COMPLETED",
        }

    def _apply_pre_hooks(
        self,
        p1_choice: str,
        p2_choice: str,
        p1_item: Optional[str],
        p2_item: Optional[str],
    ) -> tuple[str, str]:
        return p1_choice, p2_choice

    def _apply_post_hooks(self, state: dict) -> dict:
        return state
