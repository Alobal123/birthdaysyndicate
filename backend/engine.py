class PubQuizEngine:
    def __init__(self, points_for_correct: int = 10) -> None:
        self.points_for_correct = points_for_correct

    def score_answer(self, submitted_option: str, correct_option: str) -> dict:
        is_correct = submitted_option == correct_option
        return {
            "is_correct": is_correct,
            "points_awarded": self.points_for_correct if is_correct else 0,
        }

    def score_birthday_answer(
        self,
        submitted_option: str,
        reference_option: str | None = None,
        special_answer: str | None = None,
        is_special_player: bool = False,
    ) -> dict:
        if is_special_player:
            return {"is_correct": True, "points_awarded": self.points_for_correct}

        matches_special = bool(special_answer) and submitted_option == special_answer
        matches_reference = bool(reference_option) and submitted_option == reference_option
        is_correct = matches_special or matches_reference
        return {
            "is_correct": is_correct,
            "points_awarded": self.points_for_correct if is_correct else 0,
        }
