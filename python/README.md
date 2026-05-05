<div align="center">

# 🐍 Rustbox Python SDK

[![PyPI version](https://img.shields.io/pypi/v/rustbox?logo=pypi&logoColor=white)](https://pypi.org/project/rustbox/)
[![Python](https://img.shields.io/badge/Python-3.9%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)

</div>

Async-first via `httpx`. One required dep. Typed exceptions.

> ⚠️ **Async-only.** All public methods are coroutines. Wrap with `asyncio.run()` from sync code.

## 🚀 Install

```bash
pip install rustbox        # or: uv pip install rustbox / poetry add rustbox
```

## ⚡ Quickstart

```python
import asyncio, os
from rustbox import Rustbox

async def main():
    client = Rustbox(os.environ["RUSTBOX_API_KEY"])
    result = await client.run(language="python", code="print('hello')")
    print(result["verdict"], result["stdout"])  # AC hello

asyncio.run(main())
```

`run()` submits, waits for sync completion, polls if needed, returns the verdict.

### Profiles

```python
# Judge profile (default) - short evaluation runs, no egress proxy.
await client.run("python", "print(1)")

# Agent profile - longer jobs, egress proxy on, per-key byte budget.
# Requires a non-trial API key.
await client.run("python", "...", profile="agent")
```

## 🔒 Errors

```python
from rustbox import (
    RustboxAuthError, RustboxRateLimitError, RustboxServerError, RustboxError,
)

try:
    await client.run("python", "...")
except RustboxAuthError:       pass  # 401/403
except RustboxRateLimitError:  pass  # 429 - back off
except RustboxServerError:     pass  # 5xx - retry
except RustboxError:           pass  # other
```

<details>
<summary><strong>🧰 Full API</strong></summary>

```python
Rustbox(
    api_key: str,
    base_url: str = DEFAULT_BASE_URL,
    *,
    timeout_secs: float = 65.0,
    max_retries: int = 2,
)

await client.run(
    language: str,
    code: str,
    stdin: str = "",
    profile: Literal["judge", "agent"] | None = None,
)  # -> dict

await client.submit(
    language, code, stdin="",
    profile=None, wait=False,
    idempotency_key=None,
    webhook_url=None,
    webhook_secret=None,
)  # -> dict

await client.get_result(job_id)    # -> dict
await client.get_languages()       # -> list[str]
await client.get_health()          # -> dict
await client.get_ready()           # -> dict
await client.aclose()              # close httpx connection pool
```

</details>

<details>
<summary><strong>🧪 Tests</strong></summary>

```bash
cd python
uv pip install pytest pytest-asyncio respx httpx
python -m pytest -q
```

`respx` mocks `httpx`. No network.

</details>

## 🔗

- 📦 [PyPI: rustbox](https://pypi.org/project/rustbox/)
- 🪝 [Webhooks](../WEBHOOKS.md)
- 🛣️ [Roadmap](../ROADMAP.md)
- 🦀 [SDK index](../README.md)
