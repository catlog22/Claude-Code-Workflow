"""Environment configuration loader for CodexLens.

Loads .env files from workspace .codexlens directory with fallback to project root.
Provides unified access to API configurations.

Priority order:
1. Environment variables (already set)
2. .codexlens/.env (workspace-local)
3. .env (project root)
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional

log = logging.getLogger(__name__)

# Supported environment variables with descriptions
ENV_VARS = {
    # Reranker configuration (overrides settings.json)
    "RERANKER_MODEL": "Reranker model name (overrides settings.json)",
    "RERANKER_BACKEND": "Reranker backend: fastembed, onnx, api, litellm, legacy",
    "RERANKER_ENABLED": "Enable reranker: true/false",
    "RERANKER_API_KEY": "API key for reranker service (SiliconFlow/Cohere/Jina)",
    "RERANKER_API_BASE": "Base URL for reranker API (overrides provider default)",
    "RERANKER_PROVIDER": "Reranker provider: siliconflow, cohere, jina",
    "RERANKER_POOL_ENABLED": "Enable reranker high availability pool: true/false",
    "RERANKER_STRATEGY": "Reranker load balance strategy: round_robin, latency_aware, weighted_random",
    "RERANKER_COOLDOWN": "Reranker rate limit cooldown in seconds",
    # Embedding configuration (overrides settings.json)
    "EMBEDDING_MODEL": "Embedding model/profile name (overrides settings.json)",
    "EMBEDDING_BACKEND": "Embedding backend: fastembed, litellm",
    "EMBEDDING_API_KEY": "API key for embedding service",
    "EMBEDDING_API_BASE": "Base URL for embedding API",
    "EMBEDDING_POOL_ENABLED": "Enable embedding high availability pool: true/false",
    "EMBEDDING_STRATEGY": "Embedding load balance strategy: round_robin, latency_aware, weighted_random",
    "EMBEDDING_COOLDOWN": "Embedding rate limit cooldown in seconds",
    # LiteLLM configuration
    "LITELLM_API_KEY": "API key for LiteLLM",
    "LITELLM_API_BASE": "Base URL for LiteLLM",
    "LITELLM_MODEL": "LiteLLM model name",
    # General configuration
    "CODEXLENS_DATA_DIR": "Custom data directory path",
    "CODEXLENS_DEBUG": "Enable debug mode (true/false)",
}


def _parse_env_line(line: str) -> tuple[str, str] | None:
    """Parse a single .env line, returning (key, value) or None."""
    line = line.strip()
    
    # Skip empty lines and comments
    if not line or line.startswith("#"):
        return None
    
    # Handle export prefix
    if line.startswith("export "):
        line = line[7:].strip()
    
    # Split on first =
    if "=" not in line:
        return None
    
    key, _, value = line.partition("=")
    key = key.strip()
    value = value.strip()
    
    # Remove surrounding quotes
    if len(value) >= 2:
        if (value.startswith('"') and value.endswith('"')) or \
           (value.startswith("'") and value.endswith("'")):
            value = value[1:-1]
    
    return key, value


def load_env_file(env_path: Path) -> Dict[str, str]:
    """Load environment variables from a .env file.
    
    Args:
        env_path: Path to .env file
        
    Returns:
        Dictionary of environment variables
    """
    if not env_path.is_file():
        return {}
    
    env_vars: Dict[str, str] = {}
    
    try:
        content = env_path.read_text(encoding="utf-8")
        for line in content.splitlines():
            result = _parse_env_line(line)
            if result:
                key, value = result
                env_vars[key] = value
    except Exception as exc:
        log.warning("Failed to load .env file %s: %s", env_path, exc)
    
    return env_vars


def _get_global_data_dir() -> Path:
    """Get global CodexLens data directory."""
    env_override = os.environ.get("CODEXLENS_DATA_DIR")
    if env_override:
        return Path(env_override).expanduser().resolve()
    return (Path.home() / ".codexlens").resolve()


def load_global_env() -> Dict[str, str]:
    """Load environment variables from global ~/.codexlens/.env file.

    Returns:
        Dictionary of environment variables from global config
    """
    global_env_path = _get_global_data_dir() / ".env"
    if global_env_path.is_file():
        env_vars = load_env_file(global_env_path)
        log.debug("Loaded %d vars from global %s", len(env_vars), global_env_path)
        return env_vars
    return {}


def load_workspace_env(workspace_root: Path | None = None) -> Dict[str, str]:
    """Load environment variables from workspace .env files.

    Priority (later overrides earlier):
    1. Global ~/.codexlens/.env (lowest priority)
    2. Project root .env
    3. .codexlens/.env (highest priority)

    Args:
        workspace_root: Workspace root directory. If None, uses current directory.

    Returns:
        Merged dictionary of environment variables
    """
    if workspace_root is None:
        workspace_root = Path.cwd()

    workspace_root = Path(workspace_root).resolve()

    env_vars: Dict[str, str] = {}

    # Load from global ~/.codexlens/.env (lowest priority)
    global_vars = load_global_env()
    if global_vars:
        env_vars.update(global_vars)

    # Load from project root .env (medium priority)
    root_env = workspace_root / ".env"
    if root_env.is_file():
        loaded = load_env_file(root_env)
        env_vars.update(loaded)
        log.debug("Loaded %d vars from %s", len(loaded), root_env)

    # Load from .codexlens/.env (highest priority)
    codexlens_env = workspace_root / ".codexlens" / ".env"
    if codexlens_env.is_file():
        loaded = load_env_file(codexlens_env)
        env_vars.update(loaded)
        log.debug("Loaded %d vars from %s", len(loaded), codexlens_env)

    return env_vars


def apply_workspace_env(workspace_root: Path | None = None, *, override: bool = False) -> int:
    """Load .env files and apply to os.environ.
    
    Args:
        workspace_root: Workspace root directory
        override: If True, override existing environment variables
        
    Returns:
        Number of variables applied
    """
    env_vars = load_workspace_env(workspace_root)
    applied = 0
    
    for key, value in env_vars.items():
        if override or key not in os.environ:
            os.environ[key] = value
            applied += 1
            log.debug("Applied env var: %s", key)
    
    return applied


def get_env(key: str, default: str | None = None, *, workspace_root: Path | None = None) -> str | None:
    """Get environment variable with .env file fallback.
    
    Priority:
    1. os.environ (already set)
    2. .codexlens/.env
    3. .env
    4. default value
    
    Args:
        key: Environment variable name
        default: Default value if not found
        workspace_root: Workspace root for .env file lookup
        
    Returns:
        Value or default
    """
    # Check os.environ first
    if key in os.environ:
        return os.environ[key]
    
    # Load from .env files
    env_vars = load_workspace_env(workspace_root)
    if key in env_vars:
        return env_vars[key]
    
    return default


def get_api_config(
    prefix: str,
    *,
    workspace_root: Path | None = None,
    defaults: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """Get API configuration from environment.
    
    Loads {PREFIX}_API_KEY, {PREFIX}_API_BASE, {PREFIX}_MODEL, etc.
    
    Args:
        prefix: Environment variable prefix (e.g., "RERANKER", "EMBEDDING")
        workspace_root: Workspace root for .env file lookup
        defaults: Default values
        
    Returns:
        Dictionary with api_key, api_base, model, etc.
    """
    defaults = defaults or {}
    
    config: Dict[str, Any] = {}
    
    # Standard API config fields
    field_mapping = {
        "api_key": f"{prefix}_API_KEY",
        "api_base": f"{prefix}_API_BASE",
        "model": f"{prefix}_MODEL",
        "provider": f"{prefix}_PROVIDER",
        "timeout": f"{prefix}_TIMEOUT",
    }
    
    for field, env_key in field_mapping.items():
        value = get_env(env_key, workspace_root=workspace_root)
        if value is not None:
            # Type conversion for specific fields
            if field == "timeout":
                try:
                    config[field] = float(value)
                except ValueError:
                    pass
            else:
                config[field] = value
        elif field in defaults:
            config[field] = defaults[field]
    
    return config


def generate_env_example() -> str:
    """Generate .env.example content with all supported variables.
    
    Returns:
        String content for .env.example file
    """
    lines = [
        "# CodexLens Environment Configuration",
        "# Copy this file to .codexlens/.env and fill in your values",
        "",
    ]
    
    # Group by prefix
    groups: Dict[str, list] = {}
    for key, desc in ENV_VARS.items():
        prefix = key.split("_")[0]
        if prefix not in groups:
            groups[prefix] = []
        groups[prefix].append((key, desc))
    
    for prefix, items in groups.items():
        lines.append(f"# {prefix} Configuration")
        for key, desc in items:
            lines.append(f"# {desc}")
            lines.append(f"# {key}=")
        lines.append("")
    
    return "\n".join(lines)
