"""Tests for Reciprocal Rank Fusion (RRF) algorithm (P2).

Tests RRF fusion logic, score computation, weight handling, and result ranking.
"""

import math

import pytest

from codexlens.entities import SearchResult
from codexlens.search.ranking import (
    apply_symbol_boost,
    QueryIntent,
    detect_query_intent,
    normalize_bm25_score,
    normalize_weights,
    reciprocal_rank_fusion,
    rerank_results,
    tag_search_source,
)


class TestReciprocalRankFusion:
    """Tests for reciprocal_rank_fusion function."""

    def test_single_source_ranking(self):
        """Test RRF with single source returns ranked results."""
        results = [
            SearchResult(path="a.py", score=10.0, excerpt="..."),
            SearchResult(path="b.py", score=8.0, excerpt="..."),
            SearchResult(path="c.py", score=6.0, excerpt="..."),
        ]
        results_map = {"exact": results}

        fused = reciprocal_rank_fusion(results_map)

        assert len(fused) == 3
        # Order should be preserved (highest original score first)
        assert fused[0].path == "a.py"
        assert fused[1].path == "b.py"
        assert fused[2].path == "c.py"

    def test_two_sources_fusion(self):
        """Test RRF combines rankings from two sources."""
        exact_results = [
            SearchResult(path="a.py", score=10.0, excerpt="..."),
            SearchResult(path="b.py", score=8.0, excerpt="..."),
            SearchResult(path="c.py", score=6.0, excerpt="..."),
        ]
        fuzzy_results = [
            SearchResult(path="b.py", score=9.0, excerpt="..."),
            SearchResult(path="c.py", score=7.0, excerpt="..."),
            SearchResult(path="d.py", score=5.0, excerpt="..."),
        ]
        results_map = {"exact": exact_results, "fuzzy": fuzzy_results}

        fused = reciprocal_rank_fusion(results_map)

        # Should have all unique paths
        paths = [r.path for r in fused]
        assert set(paths) == {"a.py", "b.py", "c.py", "d.py"}

        # Results appearing in both should rank higher
        # b.py and c.py appear in both sources
        assert fused[0].path in ["b.py", "c.py"], "Items in both sources should rank highest"

    def test_rrf_score_calculation(self):
        """Test RRF scores are calculated correctly with default k=60."""
        # Simple scenario: single source
        results = [SearchResult(path="a.py", score=10.0, excerpt="...")]
        results_map = {"exact": results}

        fused = reciprocal_rank_fusion(results_map, k=60)

        # RRF score = weight / (k + rank) = 1.0 / (60 + 1) ≈ 0.0164
        expected_score = 1.0 / 61
        assert abs(fused[0].score - expected_score) < 0.001

    def test_custom_weights(self):
        """Test custom weights affect RRF scores."""
        results_a = [SearchResult(path="a.py", score=10.0, excerpt="...")]
        results_b = [SearchResult(path="a.py", score=10.0, excerpt="...")]

        results_map = {"exact": results_a, "fuzzy": results_b}

        # Higher weight for exact
        weights = {"exact": 0.7, "fuzzy": 0.3}
        fused = reciprocal_rank_fusion(results_map, weights=weights, k=60)

        # Score should be: 0.7/(60+1) + 0.3/(60+1) = 1.0/61 ≈ 0.0164
        expected_score = (0.7 + 0.3) / 61
        assert abs(fused[0].score - expected_score) < 0.001

    def test_weight_normalization(self):
        """Test weights are normalized to sum to 1.0."""
        results = [SearchResult(path="a.py", score=10.0, excerpt="...")]
        results_map = {"exact": results}

        # Weights not summing to 1.0
        weights = {"exact": 2.0}  # Will be normalized to 1.0
        fused = reciprocal_rank_fusion(results_map, weights=weights)

        # Should work without error and produce normalized scores
        assert len(fused) == 1
        assert fused[0].score > 0

    def test_empty_results_map(self):
        """Test RRF with empty results returns empty list."""
        fused = reciprocal_rank_fusion({})
        assert fused == []

    def test_zero_weight_source_ignored(self):
        """Test sources with zero weight are ignored."""
        results_a = [SearchResult(path="a.py", score=10.0, excerpt="...")]
        results_b = [SearchResult(path="b.py", score=10.0, excerpt="...")]

        results_map = {"exact": results_a, "fuzzy": results_b}
        weights = {"exact": 1.0, "fuzzy": 0.0}  # Ignore fuzzy

        fused = reciprocal_rank_fusion(results_map, weights=weights)

        # Should only have result from exact source
        assert len(fused) == 1
        assert fused[0].path == "a.py"

    def test_fusion_score_in_metadata(self):
        """Test fusion score is stored in result metadata."""
        results = [SearchResult(path="a.py", score=10.0, excerpt="...")]
        results_map = {"exact": results}

        fused = reciprocal_rank_fusion(results_map)

        # Check metadata
        assert "fusion_score" in fused[0].metadata
        assert "original_score" in fused[0].metadata
        assert fused[0].metadata["original_score"] == 10.0

    def test_rank_order_matters(self):
        """Test rank position affects RRF score (lower rank = higher score)."""
        results = [
            SearchResult(path="a.py", score=10.0, excerpt="..."),  # rank 1
            SearchResult(path="b.py", score=8.0, excerpt="..."),   # rank 2
            SearchResult(path="c.py", score=6.0, excerpt="..."),   # rank 3
        ]
        results_map = {"exact": results}

        fused = reciprocal_rank_fusion(results_map, k=60)

        # a.py (rank 1): score = 1/(60+1) ≈ 0.0164
        # b.py (rank 2): score = 1/(60+2) ≈ 0.0161
        # c.py (rank 3): score = 1/(60+3) ≈ 0.0159
        assert fused[0].score > fused[1].score > fused[2].score


class TestRRFSyntheticRankings:
    """Tests with synthetic rankings to verify RRF correctness."""

    def test_perfect_agreement(self):
        """Test RRF when all sources rank items identically."""
        # All sources rank a > b > c
        exact = [
            SearchResult(path="a.py", score=10.0, excerpt="..."),
            SearchResult(path="b.py", score=8.0, excerpt="..."),
            SearchResult(path="c.py", score=6.0, excerpt="..."),
        ]
        fuzzy = [
            SearchResult(path="a.py", score=9.0, excerpt="..."),
            SearchResult(path="b.py", score=7.0, excerpt="..."),
            SearchResult(path="c.py", score=5.0, excerpt="..."),
        ]

        results_map = {"exact": exact, "fuzzy": fuzzy}
        fused = reciprocal_rank_fusion(results_map)

        # Order should match both sources
        assert fused[0].path == "a.py"
        assert fused[1].path == "b.py"
        assert fused[2].path == "c.py"

    def test_complete_disagreement(self):
        """Test RRF when sources have opposite rankings."""
        # exact: a > b > c
        # fuzzy: c > b > a
        exact = [
            SearchResult(path="a.py", score=10.0, excerpt="..."),
            SearchResult(path="b.py", score=8.0, excerpt="..."),
            SearchResult(path="c.py", score=6.0, excerpt="..."),
        ]
        fuzzy = [
            SearchResult(path="c.py", score=9.0, excerpt="..."),
            SearchResult(path="b.py", score=7.0, excerpt="..."),
            SearchResult(path="a.py", score=5.0, excerpt="..."),
        ]

        results_map = {"exact": exact, "fuzzy": fuzzy}
        fused = reciprocal_rank_fusion(results_map)

        # With opposite rankings, a.py and c.py get equal RRF scores:
        # a.py: 0.5/(60+1) + 0.5/(60+3) = 0.01613
        # c.py: 0.5/(60+3) + 0.5/(60+1) = 0.01613 (same!)
        # b.py: 0.5/(60+2) + 0.5/(60+2) = 0.01613 (slightly lower due to rounding)
        # So top result should be a.py or c.py (tied)
        assert fused[0].path in ["a.py", "c.py"], "Items with symmetric ranks should tie for first"

    def test_partial_overlap(self):
        """Test RRF with partial overlap between sources."""
        # exact: [A, B, C]
        # fuzzy: [B, C, D]
        exact = [
            SearchResult(path="A", score=10.0, excerpt="..."),
            SearchResult(path="B", score=8.0, excerpt="..."),
            SearchResult(path="C", score=6.0, excerpt="..."),
        ]
        fuzzy = [
            SearchResult(path="B", score=9.0, excerpt="..."),
            SearchResult(path="C", score=7.0, excerpt="..."),
            SearchResult(path="D", score=5.0, excerpt="..."),
        ]

        results_map = {"exact": exact, "fuzzy": fuzzy}
        fused = reciprocal_rank_fusion(results_map)

        # B and C appear in both, should rank higher than A and D
        paths = [r.path for r in fused]
        b_idx = paths.index("B")
        c_idx = paths.index("C")
        a_idx = paths.index("A")
        d_idx = paths.index("D")

        assert b_idx < a_idx, "B (in both) should outrank A (in one)"
        assert c_idx < d_idx, "C (in both) should outrank D (in one)"

    def test_three_sources(self):
        """Test RRF with three sources (exact, fuzzy, vector)."""
        exact = [SearchResult(path="a.py", score=10.0, excerpt="...")]
        fuzzy = [SearchResult(path="b.py", score=9.0, excerpt="...")]
        vector = [SearchResult(path="c.py", score=8.0, excerpt="...")]

        results_map = {"exact": exact, "fuzzy": fuzzy, "vector": vector}
        weights = {"exact": 0.3, "fuzzy": 0.1, "vector": 0.6}

        fused = reciprocal_rank_fusion(results_map, weights=weights)

        assert len(fused) == 3
        # Each appears in one source only, so scores differ by weights
        # c.py: 0.6/61 ≈ 0.0098 (vector, highest weight)
        # a.py: 0.3/61 ≈ 0.0049 (exact)
        # b.py: 0.1/61 ≈ 0.0016 (fuzzy)
        assert fused[0].path == "c.py", "Vector (higher weight) should rank first"


class TestNormalizeBM25Score:
    """Tests for normalize_bm25_score function."""

    def test_negative_bm25_normalization(self):
        """Test BM25 scores (negative) are normalized to 0-1 range."""
        # SQLite FTS5 returns negative BM25 scores
        scores = [-20.0, -10.0, -5.0, -1.0, 0.0]

        for score in scores:
            normalized = normalize_bm25_score(score)
            assert 0.0 <= normalized <= 1.0, f"Normalized score {normalized} out of range"

    def test_better_match_higher_score(self):
        """Test more negative BM25 (better match) gives higher normalized score."""
        good_match = -15.0
        weak_match = -2.0

        norm_good = normalize_bm25_score(good_match)
        norm_weak = normalize_bm25_score(weak_match)

        assert norm_good > norm_weak, "Better match should have higher normalized score"

    def test_zero_score(self):
        """Test zero BM25 score normalization."""
        normalized = normalize_bm25_score(0.0)
        assert 0.0 <= normalized <= 1.0

    def test_positive_score_handling(self):
        """Test positive scores (edge case) are handled."""
        normalized = normalize_bm25_score(5.0)
        # Should still be in valid range
        assert 0.0 <= normalized <= 1.0


class TestNormalizeWeights:
    """Tests for normalize_weights function."""

    def test_normalize_weights_with_nan(self):
        """NaN total returns unchanged weights without division."""
        weights = {"exact": float("nan"), "fuzzy": None}

        normalized = normalize_weights(weights)

        assert normalized is not weights
        assert set(normalized.keys()) == set(weights.keys())
        assert math.isnan(normalized["exact"])
        assert normalized["fuzzy"] is None

    def test_normalize_weights_with_infinity(self):
        """Infinity total returns unchanged weights without division."""
        weights = {"exact": float("inf"), "fuzzy": None}

        normalized = normalize_weights(weights)

        assert normalized is not weights
        assert normalized == weights

    def test_normalize_weights_with_all_none(self):
        """All-None weights return unchanged weights without division."""
        weights = {"exact": None, "fuzzy": None}

        normalized = normalize_weights(weights)

        assert normalized is not weights
        assert normalized == weights

    def test_normalize_weights_with_zero_total(self):
        """Zero total returns unchanged weights without division."""
        weights = {"exact": 0.0, "fuzzy": 0.0}

        normalized = normalize_weights(weights)

        assert normalized is not weights
        assert normalized == weights

    def test_normalize_weights_with_negative_total(self):
        """Negative total returns unchanged weights without division."""
        weights = {"exact": -1.0, "fuzzy": -0.5}

        normalized = normalize_weights(weights)

        assert normalized is not weights
        assert normalized == weights

    def test_normalize_weights_valid_total_normalizes(self):
        """Valid finite positive total performs normalization correctly."""
        weights = {"exact": 2.0, "fuzzy": 1.0}

        normalized = normalize_weights(weights)

        assert normalized is not weights
        assert normalized["exact"] == pytest.approx(2.0 / 3.0)
        assert normalized["fuzzy"] == pytest.approx(1.0 / 3.0)
        assert (normalized["exact"] + normalized["fuzzy"]) == pytest.approx(1.0)


class TestTagSearchSource:
    """Tests for tag_search_source function."""

    def test_tagging_adds_source_metadata(self):
        """Test tagging adds search_source to metadata."""
        results = [
            SearchResult(path="a.py", score=10.0, excerpt="..."),
            SearchResult(path="b.py", score=8.0, excerpt="..."),
        ]

        tagged = tag_search_source(results, "exact")

        for result in tagged:
            assert "search_source" in result.metadata
            assert result.metadata["search_source"] == "exact"

    def test_tagging_preserves_existing_metadata(self):
        """Test tagging preserves existing metadata fields."""
        results = [
            SearchResult(
                path="a.py",
                score=10.0,
                excerpt="...",
                metadata={"custom_field": "value"}
            ),
        ]

        tagged = tag_search_source(results, "fuzzy")

        assert "custom_field" in tagged[0].metadata
        assert tagged[0].metadata["custom_field"] == "value"
        assert "search_source" in tagged[0].metadata
        assert tagged[0].metadata["search_source"] == "fuzzy"

    def test_tagging_empty_list(self):
        """Test tagging empty list returns empty list."""
        tagged = tag_search_source([], "exact")
        assert tagged == []

    def test_tagging_preserves_result_fields(self):
        """Test tagging preserves all SearchResult fields."""
        results = [
            SearchResult(
                path="a.py",
                score=10.0,
                excerpt="test excerpt",
                content="full content",
                start_line=10,
                end_line=20,
                symbol_name="test_func",
                symbol_kind="function"
            ),
        ]

        tagged = tag_search_source(results, "exact")

        assert tagged[0].path == "a.py"
        assert tagged[0].score == 10.0
        assert tagged[0].excerpt == "test excerpt"
        assert tagged[0].content == "full content"
        assert tagged[0].start_line == 10
        assert tagged[0].end_line == 20
        assert tagged[0].symbol_name == "test_func"
        assert tagged[0].symbol_kind == "function"


class TestSymbolBoost:
    """Tests for apply_symbol_boost function."""

    def test_symbol_boost(self):
        results = [
            SearchResult(path="a.py", score=0.2, excerpt="...", symbol_name="foo"),
            SearchResult(path="b.py", score=0.21, excerpt="..."),
        ]

        boosted = apply_symbol_boost(results, boost_factor=1.5)

        assert boosted[0].path == "a.py"
        assert boosted[0].score == pytest.approx(0.2 * 1.5)
        assert boosted[0].metadata["boosted"] is True
        assert boosted[0].metadata["original_fusion_score"] == pytest.approx(0.2)

        assert boosted[1].path == "b.py"
        assert boosted[1].score == pytest.approx(0.21)
        assert "boosted" not in boosted[1].metadata


class TestEmbeddingReranking:
    """Tests for rerank_results embedding-based similarity."""

    def test_rerank_embedding_similarity(self):
        class DummyEmbedder:
            def embed(self, texts):
                if isinstance(texts, str):
                    texts = [texts]
                mapping = {
                    "query": [1.0, 0.0],
                    "doc1": [1.0, 0.0],
                    "doc2": [0.0, 1.0],
                }
                return [mapping[t] for t in texts]

        results = [
            SearchResult(path="a.py", score=0.2, excerpt="doc1"),
            SearchResult(path="b.py", score=0.9, excerpt="doc2"),
        ]

        reranked = rerank_results("query", results, DummyEmbedder(), top_k=2)

        assert reranked[0].path == "a.py"
        assert reranked[0].metadata["reranked"] is True
        assert reranked[0].metadata["rrf_score"] == pytest.approx(0.2)
        assert reranked[0].metadata["cosine_similarity"] == pytest.approx(1.0)
        assert reranked[0].score == pytest.approx(0.5 * 0.2 + 0.5 * 1.0)

        assert reranked[1].path == "b.py"
        assert reranked[1].metadata["reranked"] is True
        assert reranked[1].metadata["rrf_score"] == pytest.approx(0.9)
        assert reranked[1].metadata["cosine_similarity"] == pytest.approx(0.0)
        assert reranked[1].score == pytest.approx(0.5 * 0.9 + 0.5 * 0.0)


@pytest.mark.parametrize("k_value", [30, 60, 100])
class TestRRFParameterized:
    """Parameterized tests for RRF with different k values."""

    def test_k_value_affects_scores(self, k_value):
        """Test k parameter affects RRF score magnitude."""
        results = [SearchResult(path="a.py", score=10.0, excerpt="...")]
        results_map = {"exact": results}

        fused = reciprocal_rank_fusion(results_map, k=k_value)

        # Score should be 1.0 / (k + 1)
        expected = 1.0 / (k_value + 1)
        assert abs(fused[0].score - expected) < 0.001


class TestRRFEdgeCases:
    """Edge case tests for RRF."""

    def test_duplicate_paths_in_same_source(self):
        """Test handling of duplicate paths in single source."""
        results = [
            SearchResult(path="a.py", score=10.0, excerpt="..."),
            SearchResult(path="a.py", score=8.0, excerpt="..."),  # Duplicate
        ]
        results_map = {"exact": results}

        fused = reciprocal_rank_fusion(results_map)

        # Should deduplicate (first occurrence wins)
        assert len(fused) == 1
        assert fused[0].path == "a.py"

    def test_very_large_result_lists(self):
        """Test RRF handles large result sets efficiently."""
        # Create 1000 results
        results = [
            SearchResult(path=f"file{i}.py", score=1000-i, excerpt="...")
            for i in range(1000)
        ]
        results_map = {"exact": results}

        fused = reciprocal_rank_fusion(results_map)

        assert len(fused) == 1000
        # Should maintain ranking
        assert fused[0].path == "file0.py"
        assert fused[-1].path == "file999.py"

    def test_all_same_score(self):
        """Test RRF when all results have same original score."""
        results = [
            SearchResult(path="a.py", score=10.0, excerpt="..."),
            SearchResult(path="b.py", score=10.0, excerpt="..."),
            SearchResult(path="c.py", score=10.0, excerpt="..."),
        ]
        results_map = {"exact": results}

        fused = reciprocal_rank_fusion(results_map)

        # Should still rank by position (rank matters)
        assert len(fused) == 3
        assert fused[0].score > fused[1].score > fused[2].score

    def test_missing_weight_for_source(self):
        """Test missing weight for source uses default."""
        results = [SearchResult(path="a.py", score=10.0, excerpt="...")]
        results_map = {"exact": results, "fuzzy": results}

        # Only provide weight for exact
        weights = {"exact": 1.0}

        fused = reciprocal_rank_fusion(results_map, weights=weights)

        # Should work with normalization
        assert len(fused) == 1  # Deduplicated
        assert fused[0].score > 0


class TestSymbolBoostAndIntentV1:
    """Tests for symbol boosting and query intent detection (v1.0)."""

    def test_symbol_boost_application(self):
        """Results with symbol_name receive a multiplicative boost (default 1.5x)."""
        results = [
            SearchResult(path="a.py", score=0.4, excerpt="...", symbol_name="AuthManager"),
            SearchResult(path="b.py", score=0.41, excerpt="..."),
        ]

        boosted = apply_symbol_boost(results, boost_factor=1.5)

        assert boosted[0].score == pytest.approx(0.4 * 1.5)
        assert boosted[0].metadata["boosted"] is True
        assert boosted[0].metadata["original_fusion_score"] == pytest.approx(0.4)
        assert boosted[1].score == pytest.approx(0.41)
        assert "boosted" not in boosted[1].metadata

    @pytest.mark.parametrize(
        ("query", "expected"),
        [
            ("def authenticate", QueryIntent.KEYWORD),
            ("MyClass", QueryIntent.KEYWORD),
            ("user_id", QueryIntent.KEYWORD),
            ("UserService::authenticate", QueryIntent.KEYWORD),
            ("ptr->next", QueryIntent.KEYWORD),
            ("how to handle user login", QueryIntent.SEMANTIC),
            ("what is authentication?", QueryIntent.SEMANTIC),
            ("where is this used?", QueryIntent.SEMANTIC),
            ("why does FooBar crash?", QueryIntent.MIXED),
            ("how to use user_id in query", QueryIntent.MIXED),
        ],
    )
    def test_query_intent_detection(self, query, expected):
        """Detect intent for representative queries (Python/TypeScript parity)."""
        assert detect_query_intent(query) == expected
