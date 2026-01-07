"""Pydantic configuration models for LiteLLM integration."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ProviderConfig(BaseModel):
    """Provider API configuration.

    Supports environment variable substitution in the format ${ENV_VAR}.
    """

    api_key: str | None = None
    api_base: str | None = None

    model_config = {"extra": "allow"}


class LLMModelConfig(BaseModel):
    """LLM model configuration."""

    provider: str
    model: str

    model_config = {"extra": "allow"}


class EmbeddingModelConfig(BaseModel):
    """Embedding model configuration."""

    provider: str  # "openai", "fastembed", "ollama", etc.
    model: str
    dimensions: int
    max_input_tokens: int = 8192  # Maximum tokens per embedding request

    model_config = {"extra": "allow"}


class RerankerModelConfig(BaseModel):
    """Reranker model configuration."""

    provider: str  # "siliconflow", "cohere", "jina", etc.
    model: str
    max_input_tokens: int = 8192  # Maximum tokens per reranking request
    top_k: int = 50  # Default top_k for reranking

    model_config = {"extra": "allow"}


class LiteLLMConfig(BaseModel):
    """Root configuration for LiteLLM integration.

    Example YAML:
        version: 1
        default_provider: openai
        providers:
          openai:
            api_key: ${OPENAI_API_KEY}
            api_base: https://api.openai.com/v1
          anthropic:
            api_key: ${ANTHROPIC_API_KEY}
        llm_models:
          default:
            provider: openai
            model: gpt-4
          fast:
            provider: openai
            model: gpt-3.5-turbo
        embedding_models:
          default:
            provider: openai
            model: text-embedding-3-small
            dimensions: 1536
    """

    version: int = 1
    default_provider: str = "openai"
    providers: dict[str, ProviderConfig] = Field(default_factory=dict)
    llm_models: dict[str, LLMModelConfig] = Field(default_factory=dict)
    embedding_models: dict[str, EmbeddingModelConfig] = Field(default_factory=dict)
    reranker_models: dict[str, RerankerModelConfig] = Field(default_factory=dict)

    model_config = {"extra": "allow"}

    def get_llm_model(self, model: str = "default") -> LLMModelConfig:
        """Get LLM model configuration by name.

        Args:
            model: Model name or "default"

        Returns:
            LLM model configuration

        Raises:
            ValueError: If model not found
        """
        if model not in self.llm_models:
            raise ValueError(
                f"LLM model '{model}' not found in configuration. "
                f"Available models: {list(self.llm_models.keys())}"
            )
        return self.llm_models[model]

    def get_embedding_model(self, model: str = "default") -> EmbeddingModelConfig:
        """Get embedding model configuration by name.

        Args:
            model: Model name or "default"

        Returns:
            Embedding model configuration

        Raises:
            ValueError: If model not found
        """
        if model not in self.embedding_models:
            raise ValueError(
                f"Embedding model '{model}' not found in configuration. "
                f"Available models: {list(self.embedding_models.keys())}"
            )
        return self.embedding_models[model]

    def get_reranker_model(self, model: str = "default") -> RerankerModelConfig:
        """Get reranker model configuration by name.

        Args:
            model: Model name or "default"

        Returns:
            Reranker model configuration

        Raises:
            ValueError: If model not found
        """
        if model not in self.reranker_models:
            raise ValueError(
                f"Reranker model '{model}' not found in configuration. "
                f"Available models: {list(self.reranker_models.keys())}"
            )
        return self.reranker_models[model]

    def get_provider(self, provider: str) -> ProviderConfig:
        """Get provider configuration by name.

        Args:
            provider: Provider name

        Returns:
            Provider configuration

        Raises:
            ValueError: If provider not found
        """
        if provider not in self.providers:
            raise ValueError(
                f"Provider '{provider}' not found in configuration. "
                f"Available providers: {list(self.providers.keys())}"
            )
        return self.providers[provider]
