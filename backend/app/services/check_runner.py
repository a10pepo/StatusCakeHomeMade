import asyncio
from datetime import datetime, timezone
from time import perf_counter
from urllib.parse import urljoin

import httpx
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.application import Application
from app.models.check_result import CheckResult
from app.models.incident import Incident
from app.models.test import Test

MAX_ERROR_TEXT_LENGTH = 1000


def _build_url(base_url: str, endpoint: str) -> str:
    if endpoint.startswith("http://") or endpoint.startswith("https://"):
        return endpoint
    return urljoin(base_url.rstrip("/") + "/", endpoint.lstrip("/"))


def _truncate_error_text(value: str, limit: int = MAX_ERROR_TEXT_LENGTH) -> str:
    if len(value) <= limit:
        return value
    return f"{value[:limit]}..."


def _build_body_mismatch_detail(expected_result: str, actual_result: str) -> str:
    expected_text = _truncate_error_text(expected_result)
    actual_text = _truncate_error_text(actual_result)
    return f"Expected: {expected_text}\nActual: {actual_text}"


def _store_incident(db: Session, application_id: int, test_id: int, status: str, error_code: str, detail: str, started_at: datetime, http_status_code: int | None = None, response_body: str | None = None) -> None:
    incident = Incident(
        application_id=application_id,
        test_id=test_id,
        status=status,
        error_code=error_code,
        detail=detail,
        started_at=started_at,
        http_status_code=http_status_code,
        response_body=response_body,
    )
    db.add(incident)


def _store_check_result(
    db: Session,
    test: Test,
    status: str,
    started_at: datetime,
    response_time_ms: float | None,
    response_time_penalty: float,
    error_code: str | None = None,
    http_status_code: int | None = None,
) -> None:
    db.add(
        CheckResult(
            application_id=test.application.id,
            test_id=test.id,
            status=status,
            error_code=error_code,
            http_status_code=http_status_code,
            response_time_ms=round(response_time_ms, 3) if response_time_ms is not None else None,
            response_time_penalty=response_time_penalty,
            started_at=started_at,
        )
    )


def _compute_response_time_penalty(test: Test, response_time_ms: float | None) -> float:
    if response_time_ms is None:
        return 0.0

    penalty = 0.0
    if test.last_response_time_ms and response_time_ms > test.last_response_time_ms:
        slowdown_ratio = (response_time_ms - test.last_response_time_ms) / max(test.last_response_time_ms, 1.0)
        penalty += min(slowdown_ratio * 4.0, 4.0)

    if test.average_response_time_ms and test.response_time_samples > 0 and response_time_ms > test.average_response_time_ms:
        average_ratio = (response_time_ms - test.average_response_time_ms) / max(test.average_response_time_ms, 1.0)
        penalty += min(average_ratio * 3.0, 3.0)

    return round(min(penalty, 6.0), 3)


def _set_test_result(
    test: Test,
    started_at: datetime,
    status: str,
    detail: str,
    error_code: str | None = None,
    http_status_code: int | None = None,
    response_time_ms: float | None = None,
) -> None:
    test.last_checked_at = started_at
    test.last_result_status = status
    test.last_result_detail = detail
    test.last_error_code = error_code
    test.last_http_status_code = http_status_code
    if response_time_ms is not None:
        previous_sample_count = test.response_time_samples
        previous_average = test.average_response_time_ms or 0.0
        test.previous_response_time_ms = test.last_response_time_ms
        test.last_response_time_ms = round(response_time_ms, 3)
        test.response_time_samples = previous_sample_count + 1
        test.average_response_time_ms = round(
            ((previous_average * previous_sample_count) + response_time_ms) / test.response_time_samples,
            3,
        )


def _mark_failure(
    db: Session,
    test: Test,
    started_at: datetime,
    error_code: str,
    detail: str,
    http_status_code: int | None = None,
    response_body: str | None = None,
    response_time_ms: float | None = None,
) -> None:
    response_time_penalty = _compute_response_time_penalty(test, response_time_ms)
    test.failure_count += 1
    _set_test_result(test, started_at, "failure", detail, error_code, http_status_code, response_time_ms)
    _store_check_result(
        db,
        test,
        "failure",
        started_at,
        response_time_ms,
        response_time_penalty,
        error_code=error_code,
        http_status_code=http_status_code,
    )
    _store_incident(
        db,
        test.application.id,
        test.id,
        "failure",
        error_code,
        detail,
        started_at,
        http_status_code=http_status_code,
        response_body=response_body,
    )


def _mark_success(
    db: Session,
    test: Test,
    started_at: datetime,
    http_status_code: int | None = None,
    response_time_ms: float | None = None,
) -> None:
    response_time_penalty = _compute_response_time_penalty(test, response_time_ms)
    test.success_count += 1
    _set_test_result(test, started_at, "success", "Response matched expected result", None, http_status_code, response_time_ms)
    _store_check_result(
        db,
        test,
        "success",
        started_at,
        response_time_ms,
        response_time_penalty,
        http_status_code=http_status_code,
    )


async def run_all_checks() -> None:
    db = SessionLocal()
    try:
        tests = db.query(Test).join(Application).all()
        async with httpx.AsyncClient(timeout=10.0) as client:
            for test in tests:
                if test.last_checked_at is not None:
                    elapsed = (datetime.now(timezone.utc) - test.last_checked_at).total_seconds()
                    if elapsed < test.frequency_seconds:
                        continue
                await _run_single_test(db, client, test)
        db.commit()
    finally:
        db.close()


async def _run_single_test(db: Session, client: httpx.AsyncClient, test: Test) -> None:
    started_at = datetime.now(timezone.utc)
    started_perf = perf_counter()
    application = test.application
    url = _build_url(application.url, test.endpoint)
    payload = test.payload

    try:
        if test.method == "POST":
            response = await client.post(url, content=payload or "")
        else:
            response = await client.get(url)
    except httpx.TimeoutException:
        _mark_failure(
            db,
            test,
            started_at,
            "TIMEOUT",
            "Request timed out",
            response_time_ms=(perf_counter() - started_perf) * 1000,
        )
        return
    except httpx.RequestError as exc:
        _mark_failure(
            db,
            test,
            started_at,
            "REQUEST_ERROR",
            str(exc),
            response_time_ms=(perf_counter() - started_perf) * 1000,
        )
        return

    response_time_ms = (perf_counter() - started_perf) * 1000
    body = response.text
    if response.status_code >= 400:
        _mark_failure(
            db,
            test,
            started_at,
            "HTTP_ERROR",
            f"Unexpected HTTP status {response.status_code}",
            response.status_code,
            body[:4000],
            response_time_ms=response_time_ms,
        )
        return

    if body != test.expected_result:
        _mark_failure(
            db,
            test,
            started_at,
            "BODY_MISMATCH",
            _build_body_mismatch_detail(test.expected_result, body),
            response.status_code,
            body[:4000],
            response_time_ms=response_time_ms,
        )
        return

    _mark_success(db, test, started_at, response.status_code, response_time_ms)


async def check_loop(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            await run_all_checks()
        except Exception as exc:
            print(f"Check loop iteration failed: {exc}", flush=True)
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=15)
        except asyncio.TimeoutError:
            continue
