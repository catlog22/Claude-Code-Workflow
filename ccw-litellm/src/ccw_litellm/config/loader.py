"""Configuration loader with environment variable substitution."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

import yaml

from .models import LiteLLMConfig

# Default configuration paths
# JSON format (UI config) takes priority over YAML format
DEFAULT_JSON_CONFIG_PATH = Path.home() / ".ccw" / "config" / "litellm-api-config.json"
DEFAULT_YAML_CONFIG_PATH = Path.home() / ".ccw" / "config" / "litellm-config.yaml"
# Keep backward compatibility
DEFAULT_CONFIG_PATH = DEFAULT_YAML_CONFIG_PATH

# Global configuration singleton
_config_instance: LiteLLMConfig | None = None


def _substitute_env_vars(value: Any) -> Any:
    """Recursively substitute environment variables in configuration values.

    Supports ${ENV_VAR} and ${ENV_VAR:-default} syntax.

    Args:
        value: Configuration value (str, dict, list, or primitive)

    Returns:
        Value with environment variables substituted
    """
    if isinstance(value, str):
        # Pattern: ${VAR} or ${VAR:-default}
        pattern = r"\$\{([^:}]+)(?::-(.*?))?\}"

        def replace_var(match: re.Match) -> str:
            var_name = match.group(1)
            default_value = match.group(2) if match.group(2) is not None else ""
            return os.environ.get(var_name, default_value)

        return re.sub(pattern, replace_var, value)

    if isinstance(value, dict):
        return {k: _substitute_env_vars(v) for k, v in value.items()}

    if isinstance(value, list):
        return [_substitute_env_vars(item) for item in value]

    return value


def _get_default_config() -> dict[str, Any]:
    """Get default configuration when no config file exists.

    Returns:
        Default configuration dictionary
    """
    return {
        "version": 1,
        "default_provider": "openai",
        "providers": {
            "openai": {
                "api_key": "${OPENAI_API_KEY}",
                "api_base": "https://api.openai.com/v1",
            },
        },
        "llm_models": {
            "default": {
                "provider": "openai",
                "model": "gpt-4",
            },
            "fast": {
                "provider": "openai",
                "model": "gpt-3.5-turbo",
            },
        },
        "embedding_models": {
            "default": {
                "provider": "openai",
                "model": "text-embedding-3-small",
                "dimensions": 1536,
            },
        },
    }


def _convert_json_to_internal_format(json_config: dict[str, Any]) -> dict[str, Any]:
    """Convert UI JSON config format to internal format.

    The UI stores config in a different structure:
    - providers: array of {id, name, type, apiKey, apiBase, llmModels[], embeddingModels[]}

    Internal format uses:
    - providers: dict of {provider_id: {api_key, api_base}}
    - llm_models: dict of {model_id: {provider, model}}
    - embedding_models: dict of {model_id: {provider, model, dimensions}}

    Args:
        json_config: Configuration in UI JSON format

    Returns:
        Configuration in internal format
    """
    providers: dict[str, Any] = {}
    llm_models: dict[str, Any] = {}
    embedding_models: dict[str, Any] = {}
    reranker_models: dict[str, Any] = {}
    default_provider: str | None = None

    for provider in json_config.get("providers", []):
        if not provider.get("enabled", True):
            continue

        provider_id = provider.get("id", "")
        if not provider_id:
            continue

        # Set first enabled provider as default
        if default_provider is None:
            default_provider = provider_id

        # Convert provider with advanced settings
        provider_config: dict[str, Any] = {
            "api_key": provider.get("apiKey", ""),
            "api_base": provider.get("apiBase"),
        }

        # Map advanced settings
        adv = provider.get("advancedSettings", {})
        if adv.get("timeout"):
            provider_config["timeout"] = adv["timeout"]
        if adv.get("maxRetries"):
            provider_config["max_retries"] = adv["maxRetries"]
        if adv.get("organization"):
            provider_config["organization"] = adv["organization"]
        if adv.get("apiVersion"):
            provider_config["api_version"] = adv["apiVersion"]
        if adv.get("customHeaders"):
            provider_config["custom_headers"] = adv["customHeaders"]

        providers[provider_id] = provider_config

        # Convert LLM models
        for model in provider.get("llmModels", []):
            if not model.get("enabled", True):
                continue
            model_id = model.get("id", "")
            if not model_id:
                continue

            llm_model_config: dict[str, Any] = {
                "provider": provider_id,
                "model": model.get("name", ""),
            }
            # Add model-specific endpoint settings
            endpoint = model.get("endpointSettings", {})
            if endpoint.get("baseUrl"):
                llm_model_config["api_base"] = endpoint["baseUrl"]
            if endpoint.get("timeout"):
                llm_model_config["timeout"] = endpoint["timeout"]
            if endpoint.get("maxRetries"):
                llm_model_config["max_retries"] = endpoint["maxRetries"]

            # Add capabilities
            caps = model.get("capabilities", {})
            if caps.get("contextWindow"):
                llm_model_config["context_window"] = caps["contextWindow"]
            if caps.get("maxOutputTokens"):
                llm_model_config["max_output_tokens"] = caps["maxOutputTokens"]

            llm_models[model_id] = llm_model_config

        # Convert embedding models
        for model in provider.get("embeddingModels", []):
            if not model.get("enabled", True):
                continue
            model_id = model.get("id", "")
            if not model_id:
                continue

            embedding_model_config: dict[str, Any] = {
                "provider": provider_id,
                "model": model.get("name", ""),
                "dimensions": model.get("capabilities", {}).get("embeddingDimension", 1536),
                "max_input_tokens": model.get("capabilities", {}).get("maxInputTokens", 8192),
            }
            # Add model-specific endpoint settings
            endpoint = model.get("endpointSettings", {})
            if endpoint.get("baseUrl"):
                embedding_model_config["api_base"] = endpoint["baseUrl"]
            if endpoint.get("timeout"):
                embedding_model_config["timeout"] = endpoint["timeout"]

            embedding_models[model_id] = embedding_model_config

        # Convert reranker models
        for model in provider.get("rerankerModels", []):
            if not model.get("enabled", True):
                continue
            model_id = model.get("id", "")
            if not model_id:
                continue

            reranker_model_config: dict[str, Any] = {
                "provider": provider_id,
                "model": model.get("name", ""),
                "max_input_tokens": model.get("capabilities", {}).get("maxInputTokens", 8192),
                "top_k": model.get("capabilities", {}).get("topK", 50),
            }
            # Add model-specific endpoint settings
            endpoint = model.get("endpointSettings", {})
            if endpoint.get("baseUrl"):
                reranker_model_config["api_base"] = endpoint["baseUrl"]
            if endpoint.get("timeout"):
                reranker_model_config["timeout"] = endpoint["timeout"]

            reranker_models[model_id] = reranker_model_config

    # Ensure we have defaults if no models found
    if not llm_models:
        llm_models["default"] = {
            "provider": default_provider or "openai",
            "model": "gpt-4",
        }

    if not embedding_models:
        embedding_models["default"] = {
            "provider": default_provider or "openai",
            "model": "text-embedding-3-small",
            "dimensions": 1536,
            "max_input_tokens": 8191,
        }

    return {
        "version": json_config.get("version", 1),
        "default_provider": default_provider or "openai",
        "providers": providers,
        "llm_models": llm_models,
        "embedding_models": embedding_models,
        "reranker_models": reranker_models,
    }


def load_config(config_path: Path | str | None = None) -> LiteLLMConfig:
    """Load LiteLLM configuration from JSON or YAML file.

    Priority order:
    1. Explicit config_path if provided
    2. JSON config (UI format): ~/.ccw/config/litellm-api-config.json
    3. YAML config: ~/.ccw/config/litellm-config.yaml
    4. Default configuration

    Args:
        config_path: Path to configuration file (optional)

    Returns:
        Parsed and validated configuration

    Raises:
        FileNotFoundError: If config file not found and no default available
        ValueError: If configuration is invalid
    """
    raw_config: dict[str, Any] | None = None
    is_json_format = False

    if config_path is not None:
        config_path = Path(config_path)
        if config_path.exists():
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    if config_path.suffix == ".json":
                        raw_config = json.load(f)
                        is_json_format = True
                    else:
                        raw_config = yaml.safe_load(f)
            except Exception as e:
                raise ValueError(f"Failed to load configuration from {config_path}: {e}") from e

    # Check JSON config first (UI format)
    if raw_config is None and DEFAULT_JSON_CONFIG_PATH.exists():
        try:
            with open(DEFAULT_JSON_CONFIG_PATH, "r", encoding="utf-8") as f:
                raw_config = json.load(f)
                is_json_format = True
        except Exception:
            pass  # Fall through to YAML

    # Check YAML config
    if raw_config is None and DEFAULT_YAML_CONFIG_PATH.exists():
        try:
            with open(DEFAULT_YAML_CONFIG_PATH, "r", encoding="utf-8") as f:
                raw_config = yaml.safe_load(f)
        except Exception:
            pass  # Fall through to default

    # Use default configuration
    if raw_config is None:
        raw_config = _get_default_config()

    # Convert JSON format to internal format if needed
    if is_json_format:
        raw_config = _convert_json_to_internal_format(raw_config)

    # Substitute environment variables
    config_data = _substitute_env_vars(raw_config)

    # Validate and parse with Pydantic
    try:
        return LiteLLMConfig.model_validate(config_data)
    except Exception as e:
        raise ValueError(f"Invalid configuration: {e}") from e


def get_config(config_path: Path | str | None = None, reload: bool = False) -> LiteLLMConfig:
    """Get global configuration singleton.

    Args:
        config_path: Path to configuration file (default: ~/.ccw/config/litellm-config.yaml)
        reload: Force reload configuration from disk

    Returns:
        Global configuration instance
    """
    global _config_instance

    if _config_instance is None or reload:
        _config_instance = load_config(config_path)

    return _config_instance


def reset_config() -> None:
    """Reset global configuration singleton.

    Useful for testing.
    """
    global _config_instance
    _config_instance = None
