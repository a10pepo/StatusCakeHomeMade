import csv
import io
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.application import Application
from app.models.check_result import CheckResult
from app.models.incident import Incident
from app.models.sample_data_state import SampleDataState
from app.models.test import Test
from app.models.user import User
from app.schemas.history import CsvImportResult


def _set_csv_field_size_limit() -> None:
    limit = sys.maxsize
    while True:
        try:
            csv.field_size_limit(limit)
            return
        except OverflowError:
            limit //= 10


def _is_http_method(value: str) -> bool:
    return value.upper() in {"GET", "POST"}


def _normalize_seed_row(row: dict[str, str]) -> tuple[str, str, str, str, str, str, int]:
    name = (row.get("name") or "").strip()
    if not name:
        raise ValueError("Missing application name")
    check_name = (row.get("checkname") or "").strip()

    # Preferred format:
    # name;checkname;baseurl;testbaseurl;testpath;testmethod;testresult;freq
    test_base_url = (row.get("testbaseurl") or "").strip()
    test_path = (row.get("testpath") or "").strip()
    if test_base_url or test_path:
        base_url = (row.get("baseurl") or "").strip()
        raw_method = (row.get("testmethod") or "").strip()
        raw_expected_result = row.get("testresult") or ""
        raw_freq = (row.get("freq") or "").strip()

        # Tolerate a common malformed 6-column variant:
        # name;baseurl;testbaseurl;testpath;testresult;freq
        # In this case DictReader shifts values into testmethod/testresult and leaves freq empty.
        if not _is_http_method(raw_method) and raw_expected_result.strip().isdigit() and not raw_freq:
            method = "GET"
            expected_result = raw_method
            frequency_seconds = max(15, int(raw_expected_result.strip()))
        else:
            method = raw_method.upper()
            expected_result = raw_expected_result
            frequency_seconds = max(15, int((raw_freq or "15").strip()))

        if not base_url or not method or not test_path:
            raise ValueError("Missing required fields for extended seed format")
        endpoint = (
            test_path
            if not test_base_url or test_base_url == base_url
            else f"{test_base_url.rstrip('/')}/{test_path.lstrip('/')}"
        )
        return name, (check_name or endpoint), base_url, endpoint, method, expected_result, frequency_seconds

    # Legacy compact format:
    # name;full_test_url;testmethod;testresult;freq
    full_test_url = (row.get("baseurl") or "").strip()
    method = (row.get("testbaseurl") or "").strip().upper()
    expected_result = row.get("testpath") or ""
    frequency_seconds = max(15, int((row.get("testmethod") or "15").strip()))
    if not full_test_url or not method:
        raise ValueError("Missing required fields for compact seed format")

    parsed = urlsplit(full_test_url)
    if not parsed.scheme or not parsed.netloc:
        raise ValueError(f"Invalid seed URL: {full_test_url}")
    base_url = f"{parsed.scheme}://{parsed.netloc}"
    endpoint = parsed.path or "/"
    if parsed.query:
        endpoint = f"{endpoint}?{parsed.query}"
    return name, (check_name or endpoint), base_url, endpoint, method, expected_result, frequency_seconds


def _split_endpoint_for_csv(application_url: str, endpoint: str) -> tuple[str, str]:
    if endpoint.startswith("http://") or endpoint.startswith("https://"):
        parsed = urlsplit(endpoint)
        test_base_url = f"{parsed.scheme}://{parsed.netloc}"
        test_path = parsed.path or "/"
        if parsed.query:
            test_path = f"{test_path}?{parsed.query}"
        return test_base_url, test_path
    return application_url, endpoint or "/"


def seed_startup_checks_from_csv(db: Session) -> None:
    settings = get_settings()
    csv_path = Path(settings.startup_seed_csv_path)
    if not csv_path.exists():
        print(f"Startup seed skipped: CSV not found at {csv_path}", flush=True)
        return

    if db.query(Application).count() > 0:
        print("Startup seed skipped: applications already exist", flush=True)
        return

    admin = db.query(User).filter(User.is_admin.is_(True)).first()
    if not admin:
        print("Startup seed skipped: admin user not found", flush=True)
        return

    grouped_rows: dict[tuple[str, str], list[tuple[str, str, str, str, int]]] = {}
    _set_csv_field_size_limit()
    with csv_path.open("r", encoding="utf-8") as handle:
        reader = csv.DictReader(handle, delimiter=";")
        for row in reader:
            app_name, check_name, base_url, endpoint, method, expected_result, frequency_seconds = _normalize_seed_row(row)
            grouped_rows.setdefault((app_name, base_url), []).append(
                (check_name, endpoint, method, expected_result, frequency_seconds)
            )

    now = datetime.now(timezone.utc)
    for (app_name, base_url), rows in grouped_rows.items():
        application = Application(
            name=app_name,
            url=base_url,
            owner_id=admin.id,
            created_at=now,
        )
        db.add(application)
        db.flush()

        for check_name, endpoint, method, expected_result, frequency_seconds in rows:
            test = Test(
                application_id=application.id,
                name=check_name,
                endpoint=endpoint,
                method=method,
                expected_result=expected_result,
                payload=None,
                frequency_seconds=frequency_seconds,
                created_at=now,
            )
            db.add(test)

    db.commit()
    print(f"Startup seed loaded {len(grouped_rows)} application(s) from {csv_path}", flush=True)


def import_checks_from_csv(db: Session, csv_content: str) -> CsvImportResult:
    grouped_rows: dict[tuple[str, str], list[tuple[str, str, str, str, int]]] = {}
    _set_csv_field_size_limit()
    reader = csv.DictReader(io.StringIO(csv_content), delimiter=";")
    for row in reader:
        app_name, check_name, base_url, endpoint, method, expected_result, frequency_seconds = _normalize_seed_row(row)
        grouped_rows.setdefault((app_name, base_url), []).append(
            (check_name, endpoint, method, expected_result, frequency_seconds)
        )

    applications_created = 0
    applications_updated = 0
    tests_created = 0
    tests_updated = 0

    for (app_name, base_url), rows in grouped_rows.items():
        application = db.query(Application).filter(Application.name == app_name).first()
        if application:
            if application.url != base_url:
                application.url = base_url
                applications_updated += 1
        else:
            admin = db.query(User).filter(User.is_admin.is_(True)).first()
            if not admin:
                raise ValueError("Admin user not found")
            application = Application(name=app_name, url=base_url, owner_id=admin.id)
            db.add(application)
            db.flush()
            applications_created += 1

        for check_name, endpoint, method, expected_result, frequency_seconds in rows:
            test = db.query(Test).filter(Test.application_id == application.id, Test.name == check_name).first()
            if not test:
                test = (
                    db.query(Test)
                    .filter(
                        Test.application_id == application.id,
                        Test.endpoint == endpoint,
                        Test.method == method,
                    )
                    .first()
                )
            if test:
                test.name = check_name
                test.endpoint = endpoint
                test.method = method
                test.expected_result = expected_result
                test.frequency_seconds = frequency_seconds
                tests_updated += 1
            else:
                test = Test(
                    application_id=application.id,
                    name=check_name,
                    endpoint=endpoint,
                    method=method,
                    expected_result=expected_result,
                    payload=None,
                    frequency_seconds=frequency_seconds,
                )
                db.add(test)
                tests_created += 1

            db.add(application)
            db.add(test)

    db.commit()
    return CsvImportResult(
        applications_created=applications_created,
        applications_updated=applications_updated,
        tests_created=tests_created,
        tests_updated=tests_updated,
    )


def export_checks_to_csv(db: Session) -> str:
    output = io.StringIO()
    writer = csv.writer(output, delimiter=";", lineterminator="\n")
    writer.writerow(["name", "checkname", "baseurl", "testbaseurl", "testpath", "testmethod", "testresult", "freq"])

    applications = db.query(Application).order_by(Application.name.asc(), Application.created_at.asc()).all()
    for application in applications:
        tests = db.query(Test).filter(Test.application_id == application.id).order_by(Test.created_at.asc(), Test.id.asc()).all()
        for test in tests:
            test_base_url, test_path = _split_endpoint_for_csv(application.url, test.endpoint)
            writer.writerow(
                [
                    application.name,
                    test.name,
                    application.url,
                    test_base_url,
                    test_path,
                    test.method,
                    test.expected_result,
                    test.frequency_seconds,
                ]
            )

    return output.getvalue()


def get_or_create_sample_state(db: Session) -> SampleDataState:
    state = db.query(SampleDataState).filter(SampleDataState.id == 1).first()
    if not state:
        state = SampleDataState(id=1, is_loaded=False)
        db.add(state)
        db.commit()
        db.refresh(state)
    return state


def load_sample_data(db: Session) -> SampleDataState:
    settings = get_settings()
    state = get_or_create_sample_state(db)
    if state.is_loaded:
        return state

    admin = db.query(User).filter(User.is_admin.is_(True)).first()
    if not admin:
        raise ValueError("Admin user not found")

    now = datetime.now(timezone.utc)
    applications: list[Application] = []
    for index in range(3):
        app = Application(
            name=f"Sample App {index + 1}",
            url=f"https://sample-{index + 1}.example.com",
            owner_id=admin.id,
            created_at=now - timedelta(days=30 + index * 7),
        )
        db.add(app)
        applications.append(app)

    db.flush()

    tests: list[Test] = []
    for index, app in enumerate(applications):
        for test_index in range(2):
            test = Test(
                application_id=app.id,
                name=f"Check {test_index + 1}",
                endpoint=f"/health/{test_index + 1}",
                method="GET",
                expected_result="OK",
                payload=None,
                frequency_seconds=30,
                created_at=app.created_at,
            )
            db.add(test)
            tests.append(test)

    db.flush()

    for idx, test in enumerate(tests):
        sample_count = 0
        success_count = 0
        failure_count = 0
        average_response_time_ms = 0.0
        last_response_time_ms: float | None = None
        previous_response_time_ms: float | None = None
        for offset in reversed(range(settings.sample_data_size)):
            created_at = now - timedelta(minutes=offset * 30)
            response_time_ms = float(180 + (idx * 35) + (offset % 9) * 22)
            penalty = 0.0
            if last_response_time_ms and response_time_ms > last_response_time_ms:
                penalty += min(((response_time_ms - last_response_time_ms) / max(last_response_time_ms, 1.0)) * 4.0, 4.0)
            if sample_count > 0 and response_time_ms > average_response_time_ms:
                penalty += min(((response_time_ms - average_response_time_ms) / max(average_response_time_ms, 1.0)) * 3.0, 3.0)
            penalty = round(min(penalty, 6.0), 3)

            is_failure = (offset + idx) % 17 == 0
            check_result = CheckResult(
                application_id=test.application_id,
                test_id=test.id,
                status="failure" if is_failure else "success",
                http_status_code=500 if is_failure and offset % 2 == 0 else 200,
                error_code="HTTP_ERROR" if is_failure and offset % 2 == 0 else ("TIMEOUT" if is_failure else None),
                response_time_ms=response_time_ms,
                response_time_penalty=penalty,
                started_at=created_at,
                created_at=created_at,
            )
            db.add(check_result)

            if is_failure:
                failure_count += 1
                incident = Incident(
                    application_id=test.application_id,
                    test_id=test.id,
                    status="failure",
                    http_status_code=500 if offset % 2 == 0 else None,
                    error_code="HTTP_ERROR" if offset % 2 == 0 else "TIMEOUT",
                    response_body="sample failure",
                    detail="Generated sample incident",
                    started_at=created_at,
                    created_at=created_at,
                )
                db.add(incident)
                test.last_result_status = "failure"
                test.last_error_code = incident.error_code
                test.last_http_status_code = incident.http_status_code
                test.last_result_detail = incident.detail
            else:
                success_count += 1
                test.last_result_status = "success"
                test.last_error_code = None
                test.last_http_status_code = 200
                test.last_result_detail = "Response matched expected result"

            sample_count += 1
            previous_response_time_ms = last_response_time_ms
            last_response_time_ms = response_time_ms
            average_response_time_ms = (
                ((average_response_time_ms * (sample_count - 1)) + response_time_ms) / sample_count
            )

        test.success_count = success_count
        test.failure_count = failure_count
        test.response_time_samples = sample_count
        test.average_response_time_ms = round(average_response_time_ms, 3) if sample_count else None
        test.previous_response_time_ms = round(previous_response_time_ms, 3) if previous_response_time_ms is not None else None
        test.last_response_time_ms = round(last_response_time_ms, 3) if last_response_time_ms is not None else None
        test.last_checked_at = now

    state.is_loaded = True
    state.loaded_at = now
    db.add(state)
    db.commit()
    db.refresh(state)
    return state


def clear_sample_data(db: Session) -> SampleDataState:
    state = get_or_create_sample_state(db)
    sample_apps = db.query(Application).filter(Application.name.like("Sample App %")).all()
    sample_app_ids = [app.id for app in sample_apps]

    if sample_app_ids:
        db.query(CheckResult).filter(CheckResult.application_id.in_(sample_app_ids)).delete(synchronize_session=False)
        db.query(Incident).filter(Incident.application_id.in_(sample_app_ids)).delete(synchronize_session=False)
        db.query(Test).filter(Test.application_id.in_(sample_app_ids)).delete(synchronize_session=False)
        db.query(Application).filter(Application.id.in_(sample_app_ids)).delete(synchronize_session=False)

    state.is_loaded = False
    state.loaded_at = None
    db.add(state)
    db.commit()
    db.refresh(state)
    return state
