from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.api.deps import (
    can_limited_update_application,
    get_current_user,
    require_admin,
    require_admin_or_owner,
    require_project_management,
)
from app.db.session import get_db
from app.models.application import Application
from app.models.check_result import CheckResult
from app.models.incident import Incident
from app.models.test import Test
from app.models.user import User, UserRole
from app.schemas.application import (
    ApplicationConfigResponse,
    ApplicationCreate,
    ApplicationResponse,
    ApplicationUpdate,
)
from app.schemas.history import DashboardApplication, HistoryPoint, TestResultRow
from app.services.health import (
    align_time_to_step,
    build_health_timeline,
    calculate_application_health,
    calculate_application_health_for_period,
    calculate_current_health,
    calculate_global_score,
    history_step,
)

router = APIRouter(prefix="/api", tags=["applications"])


def _application_test_counts(db: Session) -> dict[int, int]:
    return {
        application_id: tests_count
        for application_id, tests_count in (
            db.query(Test.application_id, func.count(Test.id))
            .group_by(Test.application_id)
            .all()
        )
    }


def _serialize_application_config(application: Application, tests_count: int) -> ApplicationConfigResponse:
    return ApplicationConfigResponse(
        id=application.id,
        name=application.name,
        url=application.url,
        owner_id=application.owner_id,
        owner_username=application.owner.username,
        created_at=application.created_at,
        tests_count=tests_count,
    )


def _serialize_application(db: Session, application: Application) -> ApplicationResponse:
    tests_count = db.query(Test).filter(Test.application_id == application.id).count()
    return ApplicationResponse(
        id=application.id,
        name=application.name,
        url=application.url,
        owner_id=application.owner_id,
        owner_username=application.owner.username,
        created_at=application.created_at,
        healthy_score=calculate_application_health(db, application),
        current_health=calculate_current_health(db, application),
        tests_count=tests_count,
    )


def _serialize_dashboard_application(
    db: Session,
    application: Application,
    period_start: datetime,
    period_end: datetime,
) -> DashboardApplication:
    current_score = calculate_application_health_for_period(db, application, period_start, period_end)
    previous_score = calculate_application_health_for_period(
        db,
        application,
        max(application.created_at, period_start - (period_end - period_start)),
        period_start,
    )
    if current_score > previous_score + 0.01:
        score_trend = "up"
    elif current_score < previous_score - 0.01:
        score_trend = "down"
    else:
        score_trend = "flat"

    failures_last_24h = (
        db.query(Incident)
        .filter(Incident.application_id == application.id, Incident.created_at >= period_end - timedelta(hours=24))
        .count()
    )
    total_tests = db.query(Test).filter(Test.application_id == application.id).count()
    return DashboardApplication(
        application_id=application.id,
        application_name=application.name,
        owner_username=application.owner.username,
        healthy_score=current_score,
        current_health=calculate_current_health(db, application),
        global_score=calculate_global_score(db, application, period_start, period_end),
        score_trend=score_trend,
        total_tests=total_tests,
        failures_last_24h=failures_last_24h,
    )


@router.get("/applications/config", response_model=list[ApplicationConfigResponse])
def list_application_configs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    applications = (
        db.query(Application)
        .options(joinedload(Application.owner))
        .order_by(Application.created_at.desc())
        .all()
    )
    tests_count_by_application = _application_test_counts(db)
    return [
        _serialize_application_config(application, tests_count_by_application.get(application.id, 0))
        for application in applications
    ]


@router.get("/applications", response_model=list[ApplicationResponse])
def list_applications(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    applications = db.query(Application).order_by(Application.created_at.desc()).all()
    return [_serialize_application(db, application) for application in applications]


@router.post("/applications", response_model=ApplicationResponse, status_code=status.HTTP_201_CREATED)
def create_application(payload: ApplicationCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_project_management(current_user)
    application = Application(name=payload.name, url=payload.url, owner_id=current_user.id)
    db.add(application)
    db.commit()
    db.refresh(application)
    return _serialize_application(db, application)


@router.get("/applications/{application_id}", response_model=ApplicationResponse)
def get_application(application_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    application = db.query(Application).filter(Application.id == application_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    return _serialize_application(db, application)


@router.put("/applications/{application_id}", response_model=ApplicationResponse)
def update_application(application_id: int, payload: ApplicationUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    application = db.query(Application).filter(Application.id == application_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")

    if not can_limited_update_application(application, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")
    if current_user.role != UserRole.READONLY:
        require_admin_or_owner(application, current_user)
        application.name = payload.name
    application.url = payload.url
    if current_user.is_admin and payload.owner_id:
        application.owner_id = payload.owner_id
    db.add(application)
    db.commit()
    db.refresh(application)
    return _serialize_application(db, application)


@router.delete("/applications/{application_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_application(application_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    application = db.query(Application).filter(Application.id == application_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    require_project_management(current_user)
    require_admin_or_owner(application, current_user)
    db.delete(application)
    db.commit()


@router.post("/applications/{application_id}/reset-global-score", status_code=status.HTTP_204_NO_CONTENT)
def reset_global_score(application_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_admin(current_user)
    application = db.query(Application).filter(Application.id == application_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")

    db.query(CheckResult).filter(CheckResult.application_id == application.id).delete(synchronize_session=False)
    db.query(Incident).filter(Incident.application_id == application.id).delete(synchronize_session=False)

    tests = db.query(Test).filter(Test.application_id == application.id).all()
    for test in tests:
        test.success_count = 0
        test.failure_count = 0
        test.last_checked_at = None
        test.last_result_status = None
        test.last_error_code = None
        test.last_http_status_code = None
        test.last_result_detail = None
        test.last_response_time_ms = None
        test.previous_response_time_ms = None
        test.average_response_time_ms = None
        test.response_time_samples = 0
        db.add(test)

    db.commit()


@router.get("/dashboard", response_model=list[DashboardApplication])
def get_dashboard(
    start_at: datetime | None = None,
    end_at: datetime | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    applications = db.query(Application).order_by(Application.name.asc()).all()
    period_end = end_at or datetime.now(timezone.utc)
    period_start = start_at or (period_end - timedelta(hours=24))
    result = [
        _serialize_dashboard_application(db, application, period_start, period_end)
        for application in applications
    ]
    return sorted(result, key=lambda item: (item.global_score, item.healthy_score), reverse=True)


@router.get("/applications/{application_id}/dashboard", response_model=DashboardApplication)
def get_application_dashboard(
    application_id: int,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    application = (
        db.query(Application)
        .options(joinedload(Application.owner))
        .filter(Application.id == application_id)
        .first()
    )
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")

    period_end = end_at or datetime.now(timezone.utc)
    period_start = start_at or (period_end - timedelta(hours=24))
    return _serialize_dashboard_application(db, application, period_start, period_end)


@router.get("/applications/{application_id}/history", response_model=list[HistoryPoint])
def get_application_history(
    application_id: int,
    window_hours: float = Query(default=24, ge=0.5, le=24 * 90),
    start_at: datetime | None = None,
    end_at: datetime | None = None,
    error_code: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    application = db.query(Application).filter(Application.id == application_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    tests = db.query(Test).filter(Test.application_id == application.id).all()

    now = datetime.now(timezone.utc)
    end_time = end_at or now
    start_time = start_at or (end_time - timedelta(hours=window_hours))
    window_hours = max((end_time - start_time).total_seconds() / 3600, 0.5)
    step = history_step(window_hours)
    if end_at is None:
        end_time = align_time_to_step(min(end_time, now), step)
        if start_at is None:
            start_time = end_time - timedelta(hours=window_hours)

    check_results_query = db.query(CheckResult).filter(
        CheckResult.application_id == application.id,
        CheckResult.started_at <= min(end_time, now),
    )
    all_check_results = check_results_query.order_by(CheckResult.started_at.asc()).all()
    if error_code:
        visible_failures = [
            result
            for result in all_check_results
            if result.status == "failure" and result.error_code == error_code
        ]
    else:
        visible_failures = [result for result in all_check_results if result.status == "failure"]

    timeline = build_health_timeline(application, tests, all_check_results, start_time, end_time, step)
    return [
        HistoryPoint(
            timestamp=point["timestamp"],
            healthy=point["healthy"],
            score=point["score"],
            response_times=point["response_times"],
            error_code=next(
                (
                    result.error_code
                    for result in visible_failures
                    if point["timestamp"] <= result.started_at < point["timestamp"] + step
                ),
                None,
            ),
            http_status_code=next(
                (
                    result.http_status_code
                    for result in visible_failures
                    if point["timestamp"] <= result.started_at < point["timestamp"] + step
                ),
                None,
            ),
        )
        for point in timeline
    ]


@router.get("/applications/{application_id}/results", response_model=list[TestResultRow])
def get_application_results(
    application_id: int,
    limit: int = Query(default=100, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    application = db.query(Application).filter(Application.id == application_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")

    incidents = (
        db.query(Incident, Test.name)
        .join(Test, Test.id == Incident.test_id)
        .filter(Incident.application_id == application.id)
        .order_by(Incident.started_at.desc())
        .limit(limit)
        .all()
    )
    return [
        TestResultRow(
            id=incident.id,
            test_id=incident.test_id,
            test_name=test_name,
            status=incident.status,
            http_status_code=incident.http_status_code,
            error_code=incident.error_code,
            detail=incident.detail,
            started_at=incident.started_at,
        )
        for incident, test_name in incidents
    ]
