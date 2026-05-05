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

> ⏳ First release (v0.1.0) ships once `sdk/py/v0.1.0` tag is pushed. Pipeline ready: see [`PUBLISHING.md`](../PUBLISHING.md). Until then, install from the [public source mirror](https://github.com/orkait/rustbox-sdk).

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

| Method | Returns | Notes |
|---|---|---|
| `Rustbox(api_key, base_url=DEFAULT_BASE_URL)` | `Rustbox` | empty `base_url` raises `ValueError` |
| `await client.run(language, code, stdin="")` | `dict` | Submit + wait + auto-poll |
| `await client.submit(language, code, stdin="", wait=False)` | `dict` | Low-level, no polling |
| `await client.get_result(job_id)` | `dict` | Poll a job by id |
| `await client.get_languages()` | `list[str]` | Available runtimes |
| `await client.get_health()` | `dict` | Service health |
| `await client.get_ready()` | `dict` | K8s-style readiness |

</details>

<details>
<summary><strong>🧪 Tests</strong></summary>

```bash
cd sdk/python
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
