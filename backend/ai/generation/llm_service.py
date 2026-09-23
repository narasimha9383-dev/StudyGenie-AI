"""
StudyGenie AI - LLM Provider Service

Architecture:

    RAGService
        |
        v
    LLMService
        |
        +----------------------+
        |                      |
        v                      v
    LocalLLMProvider       GroqProvider / OpenRouterProvider
        |                         |
        v                         v
    llama.cpp               OpenAI-compatible hosted API
        |
        v
      Qwen

Responsibilities:
    - Provider selection
    - Prompt validation
    - Request construction
    - Response normalization
    - Timeout handling
    - Retry handling
    - Health checks
    - Local llama.cpp reachability checks

This module does NOT:
    - perform retrieval
    - access ChromaDB
    - generate embeddings
    - implement RAG ranking
"""

from __future__ import annotations

import json
import logging
import os
import time
import socket
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from dotenv import load_dotenv
from tenacity import (
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

load_dotenv()

logger = logging.getLogger(__name__)


# ============================================================
# Exceptions
# ============================================================


class LLMConfigurationError(RuntimeError):
    """Raised when the LLM configuration is invalid."""


class LLMGenerationError(RuntimeError):
    """Raised when LLM generation fails."""

    def __init__(
        self,
        message: str,
        *,
        unavailable: bool = False,
        timeout: bool = False,
        no_retry: bool = False,
    ) -> None:
        super().__init__(message)

        self.unavailable = unavailable
        self.timeout = timeout
        self.no_retry = no_retry


class RateLimitError(LLMGenerationError):
    """Raised when a configured hosted provider returns HTTP 429."""


class OpenRouterRateLimitError(RateLimitError):
    """Raised when OpenRouter returns HTTP 429."""


class GroqRateLimitError(RateLimitError):
    """Raised when Groq returns HTTP 429."""


# ============================================================
# Helpers
# ============================================================


def _env_bool(
    name: str,
    default: bool = False,
) -> bool:
    value = os.getenv(name)

    if value is None:
        return default

    return value.strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _env_int(
    name: str,
    default: int,
) -> int:
    try:
        return max(
            1,
            int(
                os.getenv(
                    name,
                    str(default),
                )
            ),
        )
    except (TypeError, ValueError):
        logger.warning(
            "Invalid %s. Using %s.",
            name,
            default,
        )
        return default


def _env_float(
    name: str,
    default: float,
) -> float:
    try:
        return float(
            os.getenv(
                name,
                str(default),
            )
        )
    except (TypeError, ValueError):
        logger.warning(
            "Invalid %s. Using %s.",
            name,
            default,
        )
        return default


# ============================================================
# Retry policy
# ============================================================


def _should_retry(
    error: BaseException,
) -> bool:
    """
    Retry only transient LLM failures.

    Never retry:
        - configuration errors
        - rate-limit errors
        - explicitly non-retryable failures
        - local llama.cpp failures
    """

    return (
        isinstance(
            error,
            LLMGenerationError,
        )
        and not isinstance(
            error,
            RateLimitError,
        )
        and not error.no_retry
    )


# ============================================================
# Provider Interface
# ============================================================


class LLMProvider(ABC):
    """
    Common interface for all LLM providers.
    """

    name: str

    model: str

    @abstractmethod
    def generate(
        self,
        prompt: str,
        *,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        system: Optional[str] = None,
        images: Optional[List[str]] = None,
        json_mode: bool = False,
        timeout: Optional[float] = None,
    ) -> str:
        """Generate text from the provider."""

    @abstractmethod
    def health_check(self) -> bool:
        """Check provider availability."""


# ============================================================
# OpenAI-compatible HTTP Provider
# ============================================================


class OpenAICompatibleProvider(LLMProvider):
    """
    Base provider for OpenAI-compatible chat-completion APIs.
    """

    def __init__(
        self,
        *,
        base_url: str,
        model: str,
        api_key: str = "",
        timeout: float = 45.0,
        connect_timeout: float = 10.0,
        temperature: float = 0.7,
        max_tokens: int = 2048,
        client: Optional[Any] = None,
    ) -> None:

        self.base_url = base_url.rstrip("/")
        self.api_url = f"{self.base_url}/chat/completions"

        self.model = model
        self.api_key = api_key

        self.timeout = timeout
        self.connect_timeout = connect_timeout

        self.default_temperature = temperature
        self.default_max_tokens = max_tokens

        self.client = client

    # --------------------------------------------------------
    # Headers
    # --------------------------------------------------------

    def _headers(self) -> Dict[str, str]:
        headers = {
            "Content-Type": "application/json",
        }

        if self.api_key:
            headers["Authorization"] = (
                f"Bearer {self.api_key}"
            )

        return headers

    def _request_extras(self, *, json_mode: bool) -> Dict[str, Any]:
        """Provider-specific OpenAI-compatible request fields."""
        return {}

    # --------------------------------------------------------
    # Prompt validation
    # --------------------------------------------------------

    @staticmethod
    def _validate_prompt(
        prompt: str,
    ) -> str:

        if not isinstance(prompt, str):
            raise LLMGenerationError(
                "Prompt must be a string."
            )

        prompt = prompt.strip()

        if not prompt:
            raise LLMGenerationError(
                "Prompt cannot be empty."
            )

        return prompt

    # --------------------------------------------------------
    # Message construction
    # --------------------------------------------------------

    @staticmethod
    def _build_messages(
        prompt: str,
        system: Optional[str],
        images: Optional[List[str]],
    ) -> List[Dict[str, Any]]:

        messages: List[Dict[str, Any]] = []

        if system and system.strip():
            messages.append(
                {
                    "role": "system",
                    "content": system.strip(),
                }
            )

        if images:

            content: List[Dict[str, Any]] = [
                {
                    "type": "text",
                    "text": prompt,
                }
            ]

            for image in images:

                if not isinstance(image, str):
                    continue

                if not image.strip():
                    continue

                content.append(
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": image,
                        },
                    }
                )

            messages.append(
                {
                    "role": "user",
                    "content": content,
                }
            )

        else:

            messages.append(
                {
                    "role": "user",
                    "content": prompt,
                }
            )

        return messages

    # --------------------------------------------------------
    # Response extraction
    # --------------------------------------------------------

    def _extract_text(
        self,
        payload: Any,
    ) -> str:

        if not isinstance(
            payload,
            dict,
        ):
            raise LLMGenerationError(
                f"{self.name} returned invalid response."
            )

        if payload.get("error"):

            error = payload["error"]

            if isinstance(error, dict):

                code = error.get(
                    "code",
                    "unknown",
                )

                message = str(
                    error.get(
                        "message",
                        "Unknown provider error.",
                    )
                )

                raise LLMGenerationError(
                    f"{self.name} API error "
                    f"{code}: {message}"
                )

            raise LLMGenerationError(
                f"{self.name} API error: {error}"
            )

        try:
            choices = payload["choices"]

            choice = choices[0]

            message = choice["message"]

            content = message.get(
                "content"
            )

        except (
            KeyError,
            IndexError,
            TypeError,
        ) as error:

            raise LLMGenerationError(
                f"{self.name} returned an "
                "invalid response shape."
            ) from error

        # Normal string response
        if isinstance(
            content,
            str,
        ):

            text = content.strip()

        # Multimodal response
        elif isinstance(
            content,
            list,
        ):

            parts: List[str] = []

            for item in content:

                if not isinstance(
                    item,
                    dict,
                ):
                    continue

                text = item.get(
                    "text"
                )

                if isinstance(
                    text,
                    str,
                ):
                    parts.append(text)

            text = "".join(parts).strip()

        else:
            text = ""

        if text:
            return text

        refusal = message.get(
            "refusal"
        )

        if refusal:
            raise LLMGenerationError(
                f"{self.name} refused the request: "
                f"{refusal}"
            )

        finish_reason = choice.get(
            "finish_reason"
        )

        detail = ""

        if finish_reason:
            detail = (
                f" "
                f"(finish_reason={finish_reason})"
            )

        raise LLMGenerationError(
            f"{self.name} returned no message content."
            f"{detail}"
        )

    # --------------------------------------------------------
    # HTTP request
    # --------------------------------------------------------

    def _post(
        self,
        body: Dict[str, Any],
        *,
        timeout: Optional[float] = None,
    ) -> Any:

        timeout_value = (
            timeout
            if timeout is not None
            else self.timeout
        )

        # ----------------------------------------------------
        # Injected HTTP client
        # ----------------------------------------------------

        if self.client is not None:

            try:

                response = self.client.post(
                    self.api_url,
                    headers=self._headers(),
                    json=body,
                    timeout=timeout_value,
                )

                if hasattr(
                    response,
                    "raise_for_status",
                ):
                    response.raise_for_status()

                if hasattr(
                    response,
                    "json",
                ):
                    return response.json()

                return response

            except LLMGenerationError:
                raise

            except Exception as error:

                raise LLMGenerationError(
                    f"{self.name} request failed: "
                    f"{error}"
                ) from error

        # ----------------------------------------------------
        # urllib fallback
        # ----------------------------------------------------

        request = Request(
            self.api_url,
            data=json.dumps(
                body
            ).encode("utf-8"),
            headers=self._headers(),
            method="POST",
        )

        try:

            with urlopen(
                request,
                timeout=timeout_value,
            ) as response:

                raw = response.read().decode(
                    "utf-8"
                )

        except HTTPError as error:

            detail = self._http_error_detail(
                error
            )

            if error.code == 429 and self.name in {"OpenRouter", "Groq"}:

                retry_after = None

                if error.headers:
                    retry_after = error.headers.get(
                        "Retry-After"
                    )

                if retry_after:

                    message = (
                        f"{self.name} rate limit reached "
                        f"(HTTP 429). Retry after "
                        f"{retry_after} seconds."
                    )

                else:

                    message = (
                        f"{self.name} rate limit reached "
                        "(HTTP 429)."
                    )

                rate_limit_error = (
                    GroqRateLimitError
                    if self.name == "Groq"
                    else OpenRouterRateLimitError
                )
                raise rate_limit_error(message) from error

            raise LLMGenerationError(
                f"{self.name} HTTP error "
                f"{error.code}: {detail}"
            ) from error

        except (
            TimeoutError,
            socket.timeout,
        ) as error:

            raise LLMGenerationError(
                f"{self.name} request timed out "
                f"after {timeout_value:.0f}s.",
                timeout=True,
            ) from error

        except (
            URLError,
            OSError,
        ) as error:

            reason = getattr(
                error,
                "reason",
                error,
            )

            raise LLMGenerationError(
                f"{self.name} connection failed: "
                f"{reason}",
                unavailable=True,
            ) from error

        try:

            return json.loads(
                raw
            )

        except json.JSONDecodeError as error:

            raise LLMGenerationError(
                f"{self.name} returned invalid JSON."
            ) from error

    # --------------------------------------------------------
    # HTTP error details
    # --------------------------------------------------------

    def _http_error_detail(
        self,
        error: HTTPError,
    ) -> str:

        try:

            raw = error.read().decode(
                "utf-8",
                errors="replace",
            )[:500]

            payload = json.loads(
                raw
            )

            detail = payload.get(
                "error",
                {}
            )

            if isinstance(
                detail,
                dict,
            ):
                detail = detail.get(
                    "message",
                    raw,
                )

            detail = str(
                detail
            )

        except Exception:

            detail = str(
                error.reason
            )

        # Never expose API key
        if self.api_key:
            detail = detail.replace(
                self.api_key,
                "[REDACTED]",
            )

        return detail

    # --------------------------------------------------------
    # Generation
    # --------------------------------------------------------

    @retry(
        retry=retry_if_exception(
            _should_retry
        ),
        stop=stop_after_attempt(3),
        wait=wait_exponential(
            multiplier=1,
            min=1,
            max=8,
        ),
        reraise=True,
    )
    def generate(
        self,
        prompt: str,
        *,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        system: Optional[str] = None,
        images: Optional[List[str]] = None,
        json_mode: bool = False,
        timeout: Optional[float] = None,
    ) -> str:

        prompt = self._validate_prompt(
            prompt
        )

        messages = self._build_messages(
            prompt,
            system,
            images,
        )

        body: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": (
                self.default_temperature
                if temperature is None
                else temperature
            ),
            "max_tokens": (
                self.default_max_tokens
                if max_tokens is None
                else max_tokens
            ),
        }

        if json_mode:

            body["response_format"] = {
                "type": "json_object"
            }

        body.update(self._request_extras(json_mode=json_mode))

        try:

            payload = self._post(
                body,
                timeout=timeout,
            )

            return self._extract_text(
                payload
            )

        except LLMGenerationError as error:

            self._mark_retry_policy(
                error
            )

            raise

    # --------------------------------------------------------
    # Retry policy
    # --------------------------------------------------------

    def _mark_retry_policy(
        self,
        error: LLMGenerationError,
    ) -> None:
        """
        Provider-specific retry policy.

        Local inference should not immediately repeat an expensive
        generation request.
        """

        return None

    # --------------------------------------------------------
    # Health
    # --------------------------------------------------------

    def health_check(self) -> bool:

        try:

            response = self.generate(
                "Reply with exactly one word: OK.",
                temperature=0,
                max_tokens=8,
            )

            return bool(
                response.strip()
            )

        except LLMGenerationError:

            logger.warning(
                "%s health check failed.",
                self.name,
                exc_info=True,
            )

            return False


# ============================================================
# Local llama.cpp Provider
# ============================================================


class LocalLLMProvider(
    OpenAICompatibleProvider
):
    """
    llama.cpp OpenAI-compatible provider.
    """

    name = "llama.cpp"

    def __init__(
        self,
        *,
        base_url: str,
        model: str,
        timeout: float,
        connect_timeout: float,
        temperature: float,
        max_tokens: int,
        reasoning: str,
        client: Optional[Any] = None,
    ) -> None:

        super().__init__(
            base_url=base_url,
            model=model,
            timeout=timeout,
            connect_timeout=connect_timeout,
            temperature=temperature,
            max_tokens=max_tokens,
            client=client,
        )

        self.reasoning = reasoning

    # --------------------------------------------------------
    # Reachability
    # --------------------------------------------------------

    def _assert_reachable(self) -> None:

        # The probe is a raw TCP connect against base_url's host:port, so it is
        # only meaningful for the default urlopen transport. When a custom client
        # is injected the transport may not be TCP to that port at all (tests,
        # alternate HTTP stacks), and its own errors are authoritative — probing
        # here would bypass the seam _post() honours and fail on a live client.
        if self.client is not None:
            return

        parsed = urlsplit(
            self.base_url
        )

        host = (
            parsed.hostname
            or "127.0.0.1"
        )

        port = (
            parsed.port
            or 80
        )

        try:

            with socket.create_connection(
                (
                    host,
                    port,
                ),
                timeout=self.connect_timeout,
            ):
                return

        except OSError as error:

            raise LLMGenerationError(
                f"llama.cpp is not reachable "
                f"at {host}:{port}.",
                unavailable=True,
                no_retry=True,
            ) from error

    # --------------------------------------------------------
    # llama.cpp specific generation
    # --------------------------------------------------------

    def generate(
        self,
        prompt: str,
        *,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        system: Optional[str] = None,
        images: Optional[List[str]] = None,
        json_mode: bool = False,
        timeout: Optional[float] = None,
    ) -> str:

        self._assert_reachable()

        if images:

            raise LLMGenerationError(
                "The configured local llama.cpp model "
                "does not support image input.",
                no_retry=True,
            )

        prompt = self._validate_prompt(
            prompt
        )

        messages = self._build_messages(
            prompt,
            system,
            None,
        )

        body: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": (
                self.default_temperature
                if temperature is None
                else temperature
            ),
            "max_tokens": (
                self.default_max_tokens
                if max_tokens is None
                else max_tokens
            ),
        }

        if json_mode:

            body["response_format"] = {
                "type": "json_object"
            }

        # Qwen3 reasoning control
        if self.reasoning == "off":

            body[
                "chat_template_kwargs"
            ] = {
                "enable_thinking": False
            }

        try:

            payload = self._post(
                body,
                timeout=timeout,
            )

            return self._extract_text(
                payload
            )

        except LLMGenerationError as error:

            error.no_retry = True

            raise


# ============================================================
# OpenRouter Provider
# ============================================================


class OpenRouterProvider(
    OpenAICompatibleProvider
):
    """
    OpenRouter provider.
    """

    name = "OpenRouter"

    API_URL = (
        "https://openrouter.ai/api/v1"
    )

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        timeout: float,
        temperature: float,
        max_tokens: int,
        client: Optional[Any] = None,
    ) -> None:

        if not api_key:

            raise LLMConfigurationError(
                "OPENROUTER_API_KEY is missing."
            )

        super().__init__(
            base_url=self.API_URL,
            model=model,
            api_key=api_key,
            timeout=timeout,
            temperature=temperature,
            max_tokens=max_tokens,
            client=client,
        )

    def _headers(
        self,
    ) -> Dict[str, str]:

        headers = super()._headers()

        headers.update(
            {
                "HTTP-Referer":
                    "https://studygenie.ai",
                "X-Title":
                    "StudyGenie AI",
            }
        )

        return headers


# ============================================================
# Groq Provider (fast hosted inference, OpenAI-compatible)
# ============================================================


class GroqProvider(OpenAICompatibleProvider):
    """Groq's OpenAI-compatible chat-completions API.

    No model is downloaded or loaded by this process.  A single LLMService
    owns one provider object for the lifetime of a materials job / answer
    worker, while retrieval remains entirely in the existing Python RAG path.
    """

    name = "Groq"
    API_URL = "https://api.groq.com/openai/v1"

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        timeout: float,
        temperature: float,
        max_tokens: int,
        reasoning_effort: str = "low",
        client: Optional[Any] = None,
    ) -> None:
        if not api_key:
            raise LLMConfigurationError("GROQ_API_KEY is missing.")

        super().__init__(
            base_url=self.API_URL,
            model=model,
            api_key=api_key,
            timeout=timeout,
            temperature=temperature,
            max_tokens=max_tokens,
            client=client,
        )
        self.reasoning_effort = reasoning_effort

    def _request_extras(self, *, json_mode: bool) -> Dict[str, Any]:
        # GPT-OSS defaults to medium reasoning.  Low keeps exam answers grounded
        # but avoids spending a large fraction of the latency on hidden reasoning.
        # The common provider still owns context/system-message handling, JSON mode,
        # response validation, retry, and secret redaction.
        if self.reasoning_effort in {"low", "medium", "high"}:
            return {"reasoning_effort": self.reasoning_effort}
        return {}


# ============================================================
# LLM Service
# ============================================================


class LLMService:
    """
    Application-facing LLM service.

    Other application services should depend on this class,
    not directly on llama.cpp or OpenRouter.
    """

    def __init__(
        self,
        client: Optional[Any] = None,
    ) -> None:

        # LLM_PROVIDER is authoritative.  The LOCAL_LLM_ENABLED fallback retains
        # compatibility with existing installations that pre-date provider routing.
        configured_provider = os.getenv("LLM_PROVIDER", "").strip().lower()
        legacy_local_enabled = _env_bool("LOCAL_LLM_ENABLED", False)
        self.provider_key = (
            configured_provider
            or ("local" if legacy_local_enabled else "openrouter")
        )
        aliases = {"new_fast_llm": "groq", "llama.cpp": "local"}
        self.provider_key = aliases.get(self.provider_key, self.provider_key)
        if self.provider_key not in {"groq", "openrouter", "local"}:
            raise LLMConfigurationError(
                "LLM_PROVIDER must be one of: groq, openrouter, local."
            )
        self.local_enabled = self.provider_key == "local"

        self.connect_timeout = _env_float(
            "LLM_CONNECT_TIMEOUT",
            10.0,
        )

        # LLM_REQUEST_TIMEOUT is the current name and wins when set. LOCAL_LLM_TIMEOUT
        # is the older documented knob (.env.example) and is still honoured as the
        # fallback so a config that sets only it is not silently ignored.
        self.request_timeout = _env_float(
            "LLM_REQUEST_TIMEOUT",
            _env_float(
                "LOCAL_LLM_TIMEOUT",
                45.0,
            ),
        )

        self.notes_timeout = _env_float(
            "NOTES_LLM_TIMEOUT",
            max(
                self.request_timeout,
                240.0,
            ),
        )

        if self.provider_key == "local":

            self.provider = (
                LocalLLMProvider(
                    base_url=os.getenv(
                        "LOCAL_LLM_BASE_URL",
                        "http://127.0.0.1:8080/v1",
                    ),
                    model=os.getenv(
                        "LOCAL_LLM_MODEL",
                        "ggml-org/Qwen3.5-0.8B-GGUF",
                    ),
                    timeout=self.request_timeout,
                    connect_timeout=self.connect_timeout,
                    temperature=_env_float(
                        "LOCAL_LLM_TEMPERATURE",
                        0.2,
                    ),
                    max_tokens=_env_int(
                        "LOCAL_LLM_MAX_TOKENS",
                        1024,
                    ),
                    reasoning=os.getenv(
                        "LOCAL_LLM_REASONING",
                        "off",
                    ).strip().lower(),
                    client=client,
                )
            )

        elif self.provider_key == "openrouter":

            self.provider = (
                OpenRouterProvider(
                    api_key=os.getenv(
                        "OPENROUTER_API_KEY",
                        "",
                    ).strip(),
                    model=os.getenv(
                        "OPENROUTER_MODEL",
                        "openrouter/free",
                    ).strip()
                    or "openrouter/free",
                    timeout=_env_float(
                        "OPENROUTER_TIMEOUT_SECONDS",
                        45.0,
                    ),
                    temperature=0.7,
                    max_tokens=2048,
                    client=client,
                )
            )

        else:
            self.provider = GroqProvider(
                api_key=os.getenv("GROQ_API_KEY", "").strip(),
                model=(
                    os.getenv("GROQ_MODEL", "openai/gpt-oss-20b").strip()
                    or "openai/gpt-oss-20b"
                ),
                timeout=_env_float("GROQ_TIMEOUT_SECONDS", self.request_timeout),
                temperature=_env_float("GROQ_TEMPERATURE", 0.2),
                max_tokens=_env_int("GROQ_MAX_TOKENS", 2048),
                reasoning_effort=os.getenv("GROQ_REASONING_EFFORT", "low").strip().lower(),
                client=client,
            )

        logger.info(
            "LLM configured: provider=%s model=%s",
            self.provider.name,
            self.provider.model,
        )

    # --------------------------------------------------------
    # Provider information
    # --------------------------------------------------------

    @property
    def provider_name(self) -> str:
        return self.provider.name

    @property
    def model_name(self) -> str:
        return self.provider.model

    # --------------------------------------------------------
    # Generate
    # --------------------------------------------------------

    def generate(
        self,
        prompt: str,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        system: Optional[str] = None,
        images: Optional[List[str]] = None,
        timeout: Optional[float] = None,
    ) -> str:

        started = time.perf_counter()
        result = self.provider.generate(
            prompt,
            temperature=temperature,
            max_tokens=max_tokens,
            system=system,
            images=images,
            timeout=timeout,
        )
        self._log_perf("answer", prompt, result, started)
        return result

    # --------------------------------------------------------
    # JSON generation
    # --------------------------------------------------------

    def generate_json(
        self,
        prompt: str,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        images: Optional[List[str]] = None,
        timeout: Optional[float] = None,
    ) -> str:

        started = time.perf_counter()
        result = self.provider.generate(
            prompt,
            temperature=temperature,
            max_tokens=max_tokens,
            images=images,
            json_mode=True,
            timeout=timeout,
        )
        self._log_perf("generate_json", prompt, result, started)
        return result

    @staticmethod
    def _log_perf(call: str, prompt: str, result: str, started: float) -> None:
        """Emit lightweight, PII-safe LLM timing diagnostics to stderr."""
        elapsed = max(time.perf_counter() - started, 1e-9)
        input_tokens = len(str(prompt or "").split())
        output_tokens = len(str(result or "").split())
        logging.getLogger("StudyGenie.AI").info(
            "[LLM-PERF] Call: %s Input tokens: %d Output tokens: %d Total tokens: %d Time: %.2fs Tokens/sec: %.2f",
            call, input_tokens, output_tokens, input_tokens + output_tokens, elapsed, output_tokens / elapsed,
        )

    # --------------------------------------------------------
    # Notes generation
    # --------------------------------------------------------

    def generate_notes(
        self,
        prompt: str,
        *,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ) -> str:

        return self.generate(
            prompt,
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=self.notes_timeout,
        )

    # --------------------------------------------------------
    # Health check
    # --------------------------------------------------------

    def health_check(self) -> bool:

        return self.provider.health_check()


# ============================================================
# Shared Service
# ============================================================


llm_service = LLMService()


__all__ = [
    "LLMConfigurationError",
    "LLMGenerationError",
    "RateLimitError",
    "OpenRouterRateLimitError",
    "GroqRateLimitError",
    "LLMProvider",
    "LocalLLMProvider",
    "OpenRouterProvider",
    "GroqProvider",
    "LLMService",
    "llm_service",
]
