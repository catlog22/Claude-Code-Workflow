"""Base class for rerankers.

Defines the interface that all rerankers must implement.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Sequence


class BaseReranker(ABC):
    """Base class for all rerankers.

    All reranker implementations must inherit from this class and implement
    the abstract methods to ensure a consistent interface.
    """

    @property
    def max_input_tokens(self) -> int:
        """Return maximum token limit for reranking.

        Returns:
            int: Maximum number of tokens that can be processed at once.
                Default is 8192 if not overridden by implementation.
        """
        return 8192

    @abstractmethod
    def score_pairs(
        self,
        pairs: Sequence[tuple[str, str]],
        *,
        batch_size: int = 32,
    ) -> list[float]:
        """Score (query, doc) pairs.

        Args:
            pairs: Sequence of (query, doc) string pairs to score.
            batch_size: Batch size for scoring.

        Returns:
            List of scores (one per pair).
        """
        ...

