class PubQuizEngine:
    def __init__(self, points_for_correct: int = 10) -> None:
        self.points_for_correct = points_for_correct

    def score_answer(self, submitted_option: str, correct_option: str) -> dict:
        is_correct = submitted_option == correct_option
        return {
            "is_correct": is_correct,
            "points_awarded": self.points_for_correct if is_correct else 0,
        }
