"""LiteLLM embedder wrapper for CodexLens.

Provides integration with ccw-litellm's LiteLLMEmbedder for embedding generation.
"""

from __future__ import annotations

from typing import Iterable

import numpy as np

from .base import BaseEmbedder


class LiteLLMEmbedderWrapper(BaseEmbedder):
    """Wrapper for ccw-litellm LiteLLMEmbedder.

    This wrapper adapts the ccw-litellm LiteLLMEmbedder to the CodexLens
    BaseEmbedder interface, enabling seamless integration with CodexLens
    semantic search functionality.

    Args:
        model: Model identifier for LiteLLM (default: "default")
        **kwargs: Additional arguments passed to LiteLLMEmbedder

    Raises:
        ImportError: If ccw-litellm package is not installed
    """

    def __init__(self, model: str = "default", **kwargs) -> None:
        """Initialize LiteLLM embedder wrapper.

        Args:
            model: Model identifier for LiteLLM (default: "default")
            **kwargs: Additional arguments passed to LiteLLMEmbedder

        Raises:
            ImportError: If ccw-litellm package is not installed
        """
        try:
            from ccw_litellm import LiteLLMEmbedder
            self._embedder = LiteLLMEmbedder(model=model, **kwargs)
        except ImportError as e:
            raise ImportError(
                "ccw-litellm not installed. Install with: pip install ccw-litellm"
            ) from e

    @property
    def embedding_dim(self) -> int:
        """Return embedding dimensions from LiteLLMEmbedder.

        Returns:
            int: Dimension of the embedding vectors.
        """
        return self._embedder.dimensions

    @property
    def model_name(self) -> str:
        """Return model name from LiteLLMEmbedder.

        Returns:
            str: Name or identifier of the underlying model.
        """
        return self._embedder.model_name

    @property
    def max_tokens(self) -> int:
        """Return maximum token limit for the embedding model.

        Returns:
            int: Maximum number of tokens that can be embedded at once.
                Reads from LiteLLM config's max_input_tokens property.
        """
        # Get from LiteLLM embedder's max_input_tokens property (now exposed)
        if hasattr(self._embedder, 'max_input_tokens'):
            return self._embedder.max_input_tokens

        # Fallback: infer from model name
        model_name_lower = self.model_name.lower()

        # Large models (8B or "large" in name)
        if '8b' in model_name_lower or 'large' in model_name_lower:
            return 32768

        # OpenAI text-embedding-3-* models
        if 'text-embedding-3' in model_name_lower:
            return 8191

        # Default fallback
        return 8192

    def _sanitize_text(self, text: str) -> str:
        """Sanitize text to work around ModelScope API routing bug.

        ModelScope incorrectly routes text starting with lowercase 'import'
        to an Ollama endpoint, causing failures. This adds a leading space
        to work around the issue without affecting embedding quality.

        Args:
            text: Text to sanitize.

        Returns:
            Sanitized text safe for embedding API.
        """
        if text.startswith('import'):
            return ' ' + text
        return text

    def embed_to_numpy(self, texts: str | Iterable[str], **kwargs) -> np.ndarray:
        """Embed texts to numpy array using LiteLLMEmbedder.

        Args:
            texts: Single text or iterable of texts to embed.
            **kwargs: Additional arguments (ignored for LiteLLM backend).
                      Accepts batch_size for API compatibility with fastembed.

        Returns:
            numpy.ndarray: Array of shape (n_texts, embedding_dim) containing embeddings.
        """
        if isinstance(texts, str):
            texts = [texts]
        else:
            texts = list(texts)

        # Sanitize texts to avoid ModelScope routing bug
        texts = [self._sanitize_text(t) for t in texts]

        # LiteLLM handles batching internally, ignore batch_size parameter
        return self._embedder.embed(texts)

    def embed_single(self, text: str) -> list[float]:
        """Generate embedding for a single text.

        Args:
            text: Text to embed.

        Returns:
            list[float]: Embedding vector as a list of floats.
        """
        # Sanitize text before embedding
        sanitized = self._sanitize_text(text)
        embedding = self._embedder.embed([sanitized])
        return embedding[0].tolist()

