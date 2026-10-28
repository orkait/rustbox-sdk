<div align="center">

# 🐍 rustbox for Python

**Async client for the Rustbox judge API.**

[![PyPI](https://img.shields.io/pypi/v/rustbox?logo=pypi&logoColor=white)](https://pypi.org/project/rustbox/)
[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)](./pyproject.toml)
[![Typed](https://img.shields.io/badge/typing-strict-2a6db2)](./rustbox/py.typed)

</div>

---

`rustbox` runs untrusted code on Rustbox and returns typed results. It is async (built on `httpx`) and fully typed. Behaviour shared with the other SDKs (retries, regions, verdicts) is described in the [SDK index](../README.md).

## 🚀 Quickstart

```bash
uv add rustbox
```

```python
import asyncio
import os

from rustbox import Rustbox, Verdict


async def main() -> None:
    async with Rustbox(os.environ["RUSTBOX_API_KEY"]) as client:
        execution = await client.run("python", "print(6 * 7)")
        if execution.result.verdict is Verdict.AC:
            print(execution.output.stdout)


asyncio.run(main())
```

## ⚖️ Judge against test cases

```python
from rustbox import JudgeCase

judged = await client.judge(
    "python",
    "a, b = map(int, input().split())\nprint(a + b)",
    [JudgeCase(stdin="1 2", expected="3"), JudgeCase(stdin="2 2", expected="4")],
)
print(judged.all_passed, [case.verdict for case in judged.results])
```

## 📨 Queue now, read later

```python
accepted = await client.submit("python", "print(1)", idempotency_key=str(uuid.uuid4()))
execution = await client.get_result(accepted.id)
```

A `submit` with an `idempotency_key` is retried on transient failures; without one it is sent once.

## ⚙️ Configuration

| Argument | Default | Meaning |
|---|---|---|
| `api_key` | required | Your Rustbox API key |
| `base_url` | `None` | Fixed endpoint; wins over everything else |
| `region` | `None` | A key of `regions`; `RUSTBOX_REGION` is read when unset |
| `regions` | `{"in": "https://api.rustbox.sh"}` | Region table |
| `timeout_secs` | `65.0` | Per-request timeout |
| `max_retries` | `2` | Retries for reads and idempotent submits |

`RUSTBOX_BASE_URL` and `RUSTBOX_REGION` are the only environment variables read.

## 🧾 Results

`run` and `get_result` return an `Execution`: `id`, `language`, `status` (`Status`), `done`, `timestamps`, `result` (`verdict`, `exit_code`, `signal`, `error_message`), `output` (`stdout`, `stderr`), `metrics` (`cpu_time_secs`, `wall_time_secs`, `memory_peak_bytes`) and `evidence`. Missing values are `None`.

## 🔒 Errors

Every error derives from `RustboxError`.

| Error | When |
|---|---|
| `RustboxConfigError` | Missing key, bad URL, unknown region, or a closed client |
| `RustboxAuthError` | 401 / 403 (`.status`) |
| `RustboxRateLimitError` | 429 (`.retry_after_secs`) |
| `RustboxServerError` | 5xx after retries (`.status`) |
| `RustboxApiError` | Other 4xx (`.status`, `.message`) |
| `RustboxTimeoutError` | A request timed out |
| `RustboxStillRunningError` | `run` used up its polling budget; `run_id` is the run to fetch later with `get_result` |
| `RustboxTransportError` | The service could not be reached |
| `RustboxDecodeError` | The response did not match the contract |

## 🧪 Development

```bash
uv sync --extra dev
uv run mypy rustbox
uv run pytest
```

The tests replay [`../contract`](../contract), shared with the other SDKs.
