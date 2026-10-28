from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import Enum
from typing import TypedDict

from .constants import UNKNOWN as UNKNOWN_VALUE
from .errors import RustboxDecodeError

JsonObject = Mapping[str, object]


class Verdict(str, Enum):
    AC = "AC"
    WA = "WA"
    RE = "RE"
    TLE = "TLE"
    MLE = "MLE"
    OLE = "OLE"
    PLE = "PLE"
    FSE = "FSE"
    SIG = "SIG"
    SV = "SV"
    ABUSE = "ABUSE"
    IE = "IE"
    TIMEOUT = "TIMEOUT"
    UNKNOWN = UNKNOWN_VALUE

    @classmethod
    def _missing_(cls, value: object) -> Verdict:
        return cls.UNKNOWN


class Status(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    ERROR = "error"
    UNKNOWN = UNKNOWN_VALUE

    @classmethod
    def _missing_(cls, value: object) -> Status:
        return cls.UNKNOWN


TERMINAL_STATUSES: frozenset[Status] = frozenset({Status.COMPLETED, Status.ERROR})


class HealthStatus(str, Enum):
    OK = "ok"
    READY = "ready"
    NOT_READY = "not_ready"
    UNKNOWN = UNKNOWN_VALUE

    @classmethod
    def _missing_(cls, value: object) -> HealthStatus:
        return cls.UNKNOWN


def _as_object(value: object, what: str) -> JsonObject:
    if not isinstance(value, dict):
        raise RustboxDecodeError(f"{what}: expected an object")
    return value


def _field(obj: JsonObject, key: str, what: str) -> object:
    if key not in obj:
        raise RustboxDecodeError(f"{what}: missing {key}")
    return obj[key]


def _text(obj: JsonObject, key: str, what: str) -> str:
    value = _field(obj, key, what)
    if not isinstance(value, str):
        raise RustboxDecodeError(f"{what}.{key}: expected a string")
    return value


def _optional_text(obj: JsonObject, key: str, what: str) -> str | None:
    value = _field(obj, key, what)
    if value is None or isinstance(value, str):
        return value
    raise RustboxDecodeError(f"{what}.{key}: expected a string or null")


def _optional_int(obj: JsonObject, key: str, what: str) -> int | None:
    value = _field(obj, key, what)
    if value is None or (isinstance(value, int) and not isinstance(value, bool)):
        return value
    raise RustboxDecodeError(f"{what}.{key}: expected an integer or null")


def _optional_float(obj: JsonObject, key: str, what: str) -> float | None:
    value = _field(obj, key, what)
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    raise RustboxDecodeError(f"{what}.{key}: expected a number or null")


def _flag(obj: JsonObject, key: str, what: str) -> bool:
    value = _field(obj, key, what)
    if not isinstance(value, bool):
        raise RustboxDecodeError(f"{what}.{key}: expected a boolean")
    return value


def _optional_verdict(obj: JsonObject, what: str) -> Verdict | None:
    raw = _optional_text(obj, "verdict", what)
    return None if raw is None else Verdict(raw)


@dataclass(frozen=True, slots=True)
class Timestamps:
    created_at: str
    started_at: str | None
    completed_at: str | None

    @classmethod
    def parse(cls, value: object) -> Timestamps:
        obj = _as_object(value, "timestamps")
        return cls(
            created_at=_text(obj, "created_at", "timestamps"),
            started_at=_optional_text(obj, "started_at", "timestamps"),
            completed_at=_optional_text(obj, "completed_at", "timestamps"),
        )


@dataclass(frozen=True, slots=True)
class Outcome:
    verdict: Verdict | None
    exit_code: int | None
    signal: int | None
    error_message: str | None

    @classmethod
    def parse(cls, value: object) -> Outcome:
        obj = _as_object(value, "result")
        return cls(
            verdict=_optional_verdict(obj, "result"),
            exit_code=_optional_int(obj, "exit_code", "result"),
            signal=_optional_int(obj, "signal", "result"),
            error_message=_optional_text(obj, "error_message", "result"),
        )


@dataclass(frozen=True, slots=True)
class Output:
    stdout: str | None
    stderr: str | None

    @classmethod
    def parse(cls, value: object) -> Output:
        obj = _as_object(value, "output")
        return cls(
            stdout=_optional_text(obj, "stdout", "output"),
            stderr=_optional_text(obj, "stderr", "output"),
        )


@dataclass(frozen=True, slots=True)
class Metrics:
    cpu_time_secs: float | None
    wall_time_secs: float | None
    memory_peak_bytes: int | None

    @classmethod
    def parse(cls, value: object) -> Metrics:
        obj = _as_object(value, "metrics")
        return cls(
            cpu_time_secs=_optional_float(obj, "cpu_time_secs", "metrics"),
            wall_time_secs=_optional_float(obj, "wall_time_secs", "metrics"),
            memory_peak_bytes=_optional_int(obj, "memory_peak_bytes", "metrics"),
        )


@dataclass(frozen=True, slots=True)
class Execution:
    id: str
    language: str
    status: Status
    timestamps: Timestamps
    result: Outcome
    output: Output
    metrics: Metrics
    evidence: JsonObject | None

    @property
    def done(self) -> bool:
        return self.status in TERMINAL_STATUSES or self.result.verdict is not None

    @classmethod
    def parse(cls, value: object) -> Execution:
        obj = _as_object(value, "execution")
        evidence = obj.get("evidence")
        return cls(
            id=_text(obj, "id", "execution"),
            language=_text(obj, "language", "execution"),
            status=Status(_text(obj, "status", "execution")),
            timestamps=Timestamps.parse(_field(obj, "timestamps", "execution")),
            result=Outcome.parse(_field(obj, "result", "execution")),
            output=Output.parse(_field(obj, "output", "execution")),
            metrics=Metrics.parse(_field(obj, "metrics", "execution")),
            evidence=None if evidence is None else _as_object(evidence, "evidence"),
        )


@dataclass(frozen=True, slots=True)
class Accepted:
    id: str
    status: Status

    @classmethod
    def parse(cls, value: object) -> Accepted:
        obj = _as_object(value, "accepted")
        return cls(id=_text(obj, "id", "accepted"), status=Status(_text(obj, "status", "accepted")))


@dataclass(frozen=True, slots=True)
class JudgeCase:
    stdin: str
    expected: str

    def to_json(self) -> JudgeCaseBody:
        return JudgeCaseBody(stdin=self.stdin, expected=self.expected)


class RunBody(TypedDict):
    language: str
    code: str
    stdin: str


class JudgeCaseBody(TypedDict):
    stdin: str
    expected: str


class JudgeBody(TypedDict):
    language: str
    code: str
    cases: list[JudgeCaseBody]


@dataclass(frozen=True, slots=True)
class CaseResult:
    verdict: Verdict | None
    passed: bool
    stdout: str | None
    stderr: str | None
    expected: str
    exit_code: int | None
    wall_time_secs: float | None

    @classmethod
    def parse(cls, value: object) -> CaseResult:
        obj = _as_object(value, "case")
        return cls(
            verdict=_optional_verdict(obj, "case"),
            passed=_flag(obj, "passed", "case"),
            stdout=_optional_text(obj, "stdout", "case"),
            stderr=_optional_text(obj, "stderr", "case"),
            expected=_text(obj, "expected", "case"),
            exit_code=_optional_int(obj, "exit_code", "case"),
            wall_time_secs=_optional_float(obj, "wall_time_secs", "case"),
        )


@dataclass(frozen=True, slots=True)
class JudgeResult:
    results: tuple[CaseResult, ...]
    all_passed: bool

    @classmethod
    def parse(cls, value: object) -> JudgeResult:
        obj = _as_object(value, "judge")
        cases = _field(obj, "results", "judge")
        if not isinstance(cases, list):
            raise RustboxDecodeError("judge.results: expected a list")
        return cls(
            results=tuple(CaseResult.parse(case) for case in cases),
            all_passed=_flag(obj, "all_passed", "judge"),
        )


def parse_languages(value: object) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise RustboxDecodeError("languages: expected a list of strings")
    return [str(item) for item in value]


def parse_health(value: object) -> HealthStatus:
    return HealthStatus(_text(_as_object(value, "health"), "status", "health"))


def parse_pending_id(value: object) -> str:
    return _text(_as_object(value, "pending"), "id", "pending")
