"""LiteLLM embedder implementation for text embeddings."""

from __future__ import annotations

import logging
from typing import Any, Sequence

import litellm
import numpy as np
from numpy.typing import NDArray

from ..config import LiteLLMConfig, get_config
from ..interfaces.embedder import AbstractEmbedder

logger = logging.getLogger(__name__)


class LiteLLMEmbedder(AbstractEmbedder):
    """LiteLLM embedder implementation.

    Supports multiple embedding providers (OpenAI, etc.) through LiteLLM's unified interface.

    Example:
        embedder = LiteLLMEmbedder(model="default")
        vectors = embedder.embed(["Hello world", "Another text"])
        print(vectors.shape)  # (2, 1536)
    """

    def __init__(
        self,
        model: str = "default",
        config: LiteLLMConfig | None = None,
        **litellm_kwargs: Any,
    ) -> None:
        """Initialize LiteLLM embedder.

        Args:
            model: Model name from configuration (default: "default")
            config: Configuration instance (default: use global config)
            **litellm_kwargs: Additional arguments to pass to litellm.embedding()
        """
        self._config = config or get_config()
        self._model_name = model
        self._litellm_kwargs = litellm_kwargs

        # Get embedding model configuration
        try:
            self._model_config = self._config.get_embedding_model(model)
        except ValueError as e:
            logger.error(f"Failed to get embedding model configuration: {e}")
            raise

        # Get provider configuration
        try:
            self._provider_config = self._config.get_provider(self._model_config.provider)
        except ValueError as e:
            logger.error(f"Failed to get provider configuration: {e}")
            raise

        # Set up LiteLLM environment
        self._setup_litellm()

    def _setup_litellm(self) -> None:
        """Configure LiteLLM with provider settings."""
        provider = self._model_config.provider

        # Set API key
        if self._provider_config.api_key:
            litellm.api_key = self._provider_config.api_key
            # Also set environment-specific keys
            if provider == "openai":
                litellm.openai_key = self._provider_config.api_key
            elif provider == "anthropic":
                litellm.anthropic_key = self._provider_config.api_key

        # Set API base
        if self._provider_config.api_base:
            litellm.api_base = self._provider_config.api_base

    def _format_model_name(self) -> str:
        """Format model name for LiteLLM.

        Returns:
            Formatted model name (e.g., "openai/text-embedding-3-small")
        """
        provider = self._model_config.provider
        model = self._model_config.model

        # For some providers, LiteLLM expects explicit prefix
        if provider in ["azure", "vertex_ai", "bedrock"]:
            return f"{provider}/{model}"

        # For providers with custom api_base (OpenAI-compatible endpoints),
        # use openai/ prefix to tell LiteLLM to use OpenAI API format
        if self._provider_config.api_base and provider not in ["openai", "anthropic"]:
            return f"openai/{model}"

        return model

    @property
    def dimensions(self) -> int:
        """Embedding vector size."""
        return self._model_config.dimensions

    @property
    def max_input_tokens(self) -> int:
        """Maximum token limit for embeddings.

        Returns the configured max_input_tokens from model config,
        enabling adaptive batch sizing based on actual model capacity.
        """
        return self._model_config.max_input_tokens

    def _estimate_tokens(self, text: str) -> int:
        """Estimate token count for a text using fast heuristic.

        Args:
            text: Text to estimate tokens for

        Returns:
            Estimated token count (len/4 is a reasonable approximation)
        """
        return len(text) // 4

    def _create_batches(
        self,
        texts: list[str],
        max_tokens: int = 30000
    ) -> list[list[str]]:
        """Split texts into batches that fit within token limits.

        Args:
            texts: List of texts to batch
            max_tokens: Maximum tokens per batch (default: 30000, safe margin for 40960 limit)

        Returns:
            List of text batches
        """
        batches = []
        current_batch = []
        current_tokens = 0

        for text in texts:
            text_tokens = self._estimate_tokens(text)

            # If single text exceeds limit, truncate it
            if text_tokens > max_tokens:
                logger.warning(f"Text with {text_tokens} estimated tokens exceeds limit, truncating")
                # Truncate to fit (rough estimate: 4 chars per token)
                max_chars = max_tokens * 4
                text = text[:max_chars]
                text_tokens = self._estimate_tokens(text)

            # Start new batch if current would exceed limit
            if current_tokens + text_tokens > max_tokens and current_batch:
                batches.append(current_batch)
                current_batch = []
                current_tokens = 0

            current_batch.append(text)
            current_tokens += text_tokens

        # Add final batch
        if current_batch:
            batches.append(current_batch)

        return batches

    def embed(
        self,
        texts: str | Sequence[str],
        *,
        batch_size: int | None = None,
        max_tokens_per_batch: int | None = None,
        **kwargs: Any,
    ) -> NDArray[np.floating]:
        """Embed one or more texts.

        Args:
            texts: Single text or sequence of texts
            batch_size: Batch size for processing (deprecated, use max_tokens_per_batch)
            max_tokens_per_batch: Maximum estimated tokens per API call.
                If None, uses 90% of model's max_input_tokens for safety margin.
            **kwargs: Additional arguments for litellm.embedding()

        Returns:
            A numpy array of shape (n_texts, dimensions).

        Raises:
            Exception: If LiteLLM embedding fails
        """
        # Normalize input to list
        if isinstance(texts, str):
            text_list = [texts]
        else:
            text_list = list(texts)

        if not text_list:
            # Return empty array with correct shape
            return np.empty((0, self.dimensions), dtype=np.float32)

        # Merge kwargs
        embedding_kwargs = {**self._litellm_kwargs, **kwargs}

        # For OpenAI-compatible endpoints, ensure encoding_format is set
        if self._provider_config.api_base and "encoding_format" not in embedding_kwargs:
            embedding_kwargs["encoding_format"] = "float"

        # Determine adaptive max_tokens_per_batch
        # Use 90% of model's max_input_tokens as safety margin
        if max_tokens_per_batch is None:
            max_tokens_per_batch = int(self.max_input_tokens * 0.9)
            logger.debug(
                f"Using adaptive batch size: {max_tokens_per_batch} tokens "
                f"(90% of {self.max_input_tokens})"
            )

        # Split into token-aware batches
        batches = self._create_batches(text_list, max_tokens_per_batch)

        if len(batches) > 1:
            logger.info(f"Split {len(text_list)} texts into {len(batches)} batches for embedding")

        all_embeddings = []

        for batch_idx, batch in enumerate(batches):
            try:
                # Build call kwargs with explicit api_base
                call_kwargs = {**embedding_kwargs}
                if self._provider_config.api_base:
                    call_kwargs["api_base"] = self._provider_config.api_base
                if self._provider_config.api_key:
                    call_kwargs["api_key"] = self._provider_config.api_key

                # Call LiteLLM embedding for this batch
                response = litellm.embedding(
                    model=self._format_model_name(),
                    input=batch,
                    **call_kwargs,
                )

                # Extract embeddings
                batch_embeddings = [item["embedding"] for item in response.data]
                all_embeddings.extend(batch_embeddings)

            except Exception as e:
                logger.error(f"LiteLLM embedding failed for batch {batch_idx + 1}/{len(batches)}: {e}")
                raise

        # Convert to numpy array
        result = np.array(all_embeddings, dtype=np.float32)

        # Validate dimensions
        if result.shape[1] != self.dimensions:
            logger.warning(
                f"Expected {self.dimensions} dimensions, got {result.shape[1]}. "
                f"Configuration may be incorrect."
            )

        return result

    @property
    def model_name(self) -> str:
        """Get configured model name."""
        return self._model_name

    @property
    def provider(self) -> str:
        """Get configured provider name."""
        return self._model_config.provider
