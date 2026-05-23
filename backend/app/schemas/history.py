from datetime import datetime

from pydantic import BaseModel, Field


class IncidentResponse(BaseModel):
    id: int
    test_id: int
    application_id: int
    status: str
    http_status_code: int | None
    error_code: str
    response_body: str | None
    detail: str
    started_at: datetime
    created_at: datetime


class HistoryPoint(BaseModel):
    timestamp: datetime
    healthy: bool | None
    score: float | None = None
    error_code: str | None = None
    http_status_code: int | None = None
    response_times: dict[str, float | None] = Field(default_factory=dict)


class DashboardApplication(BaseModel):
    application_id: int
    application_name: str
    owner_username: str
    healthy_score: float
    current_health: float
    global_score: float
    score_trend: str
    total_tests: int
    failures_last_24h: int


class TestResultRow(BaseModel):
    id: int
    test_id: int
    test_name: str
    status: str
    http_status_code: int | None
    error_code: str
    detail: str
    started_at: datetime


class SampleDataStatus(BaseModel):
    loaded: bool
    loaded_at: datetime | None = None
