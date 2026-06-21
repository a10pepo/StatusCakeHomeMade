from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models.application import Application
from app.models.check_result import CheckResult
from app.models.test import Test


def history_step(window_hours: float) -> timedelta:
    if window_hours <= 1:
        return timedelta(seconds=15)
    if window_hours <= 6:
        return timedelta(minutes=1)
    if window_hours <= 12:
        return timedelta(minutes=5)
    if window_hours <= 24:
        return timedelta(minutes=15)
    if window_hours <= 72:
        return timedelta(minutes=30)
    return timedelta(hours=1)


def align_time_to_step(value: datetime, step: timedelta) -> datetime:
    step_seconds = int(step.total_seconds())
    if step_seconds <= 0:
        return value.astimezone(timezone.utc)

    utc_value = value.astimezone(timezone.utc)
    aligned_timestamp = int(utc_value.timestamp()) // step_seconds * step_seconds
    return datetime.fromtimestamp(aligned_timestamp, tz=timezone.utc)


def _latest_health_score_from_results(results: list[CheckResult]) -> float:
    if not results:
        return 0.0
    successful = sum(1 for result in results if result.status == "success")
    base_score = (successful / len(results)) * 100
    response_penalty = sum(result.response_time_penalty for result in results) / len(results)
    return round(max(0.0, base_score - response_penalty), 3)


def _latest_results_by_test(results: list[CheckResult]) -> list[CheckResult]:
    latest_by_test: dict[int, CheckResult] = {}
    for result in results:
        latest_by_test[result.test_id] = result
    return list(latest_by_test.values())


def build_health_timeline(
    application: Application,
    tests: list[Test],
    check_results: list[CheckResult],
    start_time: datetime,
    end_time: datetime,
    step: timedelta,
) -> list[dict]:
    points: list[dict] = []
    cursor = start_time
    weighted_score: float | None = None
    now = datetime.now(timezone.utc)
    results_by_test: dict[int, list[CheckResult]] = defaultdict(list)

    for result in check_results:
        results_by_test[result.test_id].append(result)

    first_results = [series[0].started_at for series in results_by_test.values() if series]
    first_full_evaluation_at = max(first_results) if len(first_results) == len(tests) and first_results else None

    while cursor <= end_time:
        if cursor > now or cursor < application.created_at:
            points.append(
                {
                    "timestamp": cursor,
                    "healthy": None,
                    "raw_score": None,
                    "score": None,
                    "error_code": None,
                    "http_status_code": None,
                    "response_times": {},
                }
            )
            cursor += step
            continue

        bucket_end = min(cursor + step, end_time + timedelta(microseconds=1), now + timedelta(microseconds=1))
        if first_full_evaluation_at is not None and bucket_end <= first_full_evaluation_at:
            points.append(
                {
                    "timestamp": cursor,
                    "healthy": None,
                    "raw_score": None,
                    "score": None,
                    "error_code": None,
                    "http_status_code": None,
                    "response_times": {},
                }
            )
            cursor += step
            continue

        latest_results: list[CheckResult] = []
        bucket_failure: CheckResult | None = None
        response_times: dict[str, float | None] = {}

        for test in tests:
            test_results = results_by_test.get(test.id, [])
            latest_result = next((result for result in reversed(test_results) if result.started_at < bucket_end), None)

            if latest_result is None:
                continue

            latest_results.append(latest_result)
            response_times[str(test.id)] = latest_result.response_time_ms

            bucket_results = [result for result in test_results if cursor <= result.started_at < bucket_end]

            if bucket_failure is None:
                bucket_failure = next((result for result in bucket_results if result.status == "failure"), None)

        if len(latest_results) < len(tests):
            points.append(
                {
                    "timestamp": cursor,
                    "healthy": False if bucket_failure else True,
                    "raw_score": None,
                    "score": None,
                    "error_code": bucket_failure.error_code if bucket_failure else None,
                    "http_status_code": bucket_failure.http_status_code if bucket_failure else None,
                    "response_times": response_times,
                }
            )
            cursor += step
            continue

        raw_score = _latest_health_score_from_results(latest_results)
        if weighted_score is None:
            weighted_score = raw_score
        elif raw_score < weighted_score:
            weighted_score = round(weighted_score - ((weighted_score - raw_score) * 0.9), 3)
        else:
            weighted_score = round(weighted_score + ((raw_score - weighted_score) * 0.1), 3)

        points.append(
            {
                "timestamp": cursor,
                "healthy": False if bucket_failure else True,
                "raw_score": raw_score,
                "score": weighted_score,
                "error_code": bucket_failure.error_code if bucket_failure else None,
                "http_status_code": bucket_failure.http_status_code if bucket_failure else None,
                "response_times": response_times,
            }
        )
        cursor += step

    return points


def calculate_application_health(db: Session, application: Application, now: datetime | None = None) -> float:
    now = now or datetime.now(timezone.utc)
    return calculate_application_health_for_period(
        db,
        application,
        max(application.created_at, now - timedelta(hours=24)),
        now,
    )


def calculate_application_health_for_period(
    db: Session,
    application: Application,
    start_time: datetime,
    end_time: datetime,
) -> float:
    end_time = min(end_time, datetime.now(timezone.utc))
    start_time = min(start_time, end_time)
    tests = db.query(Test).filter(Test.application_id == application.id).all()
    if not tests:
        return 0.0

    check_results = (
        db.query(CheckResult)
        .filter(CheckResult.application_id == application.id)
        .filter(CheckResult.started_at <= end_time)
        .order_by(CheckResult.started_at.asc())
        .all()
    )
    hours_span = max((end_time - start_time).total_seconds() / 3600, 0.5)
    points = build_health_timeline(application, tests, check_results, start_time, end_time, history_step(hours_span))
    scored_points = [point["score"] for point in points if point["score"] is not None]
    if scored_points:
        return scored_points[-1]
    latest_results = _latest_results_by_test(check_results)
    return _latest_health_score_from_results(latest_results)


def calculate_current_health(db: Session, application: Application) -> float:
    tests = db.query(Test).filter(Test.application_id == application.id).all()
    if not tests:
        return 0.0

    evaluated_tests = [test for test in tests if test.last_result_status is not None]
    if not evaluated_tests:
        return 0.0

    successful_tests = sum(1 for test in evaluated_tests if test.last_result_status == "success")
    return round((successful_tests / len(evaluated_tests)) * 100, 3)


def calculate_global_score(db: Session, application: Application, start_time: datetime, end_time: datetime) -> float:
    all_results = (
        db.query(CheckResult)
        .filter(
            CheckResult.application_id == application.id,
            CheckResult.started_at <= end_time,
        )
        .order_by(CheckResult.started_at.asc())
        .all()
    )

    score = 999.0
    # Calibrate score erosion for week-scale monitoring. With a 15-second check
    # interval, one continuously failing endpoint should take about 20 hours to
    # move from 999 down to roughly 500.
    failure_penalty = 499.0 / ((20 * 60 * 60) / 15)
    latency_penalty = failure_penalty / 2
    slow_success_penalty = 0.001
    has_success = False
    response_time_totals: dict[int, float] = defaultdict(float)
    response_time_counts: dict[int, int] = defaultdict(int)

    for result in all_results:
        prior_average = None
        if response_time_counts[result.test_id] > 0:
            prior_average = response_time_totals[result.test_id] / response_time_counts[result.test_id]

        if start_time <= result.started_at <= end_time:
            if result.status == "failure":
                score -= failure_penalty
                if (
                    result.response_time_ms is not None
                    and prior_average is not None
                    and prior_average > 0
                    and result.response_time_ms >= prior_average * 1.1
                ):
                    score -= latency_penalty
            else:
                has_success = True
                if (
                    result.response_time_ms is not None
                    and prior_average is not None
                    and prior_average > 0
                    and result.response_time_ms >= prior_average * 1.1
                ):
                    score -= slow_success_penalty

        if result.response_time_ms is not None:
            response_time_totals[result.test_id] += result.response_time_ms
            response_time_counts[result.test_id] += 1

    floor = 1.0 if has_success else 0.0
    return round(max(floor, score), 3)
