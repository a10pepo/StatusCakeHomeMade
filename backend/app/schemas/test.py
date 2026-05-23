from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class TestCreate(BaseModel):
    name: str
    endpoint: str
    method: str = Field(pattern="^(GET|POST)$")
    expected_result: str
    payload: str | None = None
    frequency_seconds: int = Field(default=15, ge=15)


class TestUpdate(BaseModel):
    name: str
    endpoint: str
    method: str = Field(pattern="^(GET|POST)$")
    expected_result: str
    payload: str | None = None
    frequency_seconds: int = Field(default=15, ge=15)


class TestResponse(BaseModel):
    id: int
    application_id: int
    name: str
    endpoint: str
    method: str
    expected_result: str
    payload: str | None
    frequency_seconds: int
    last_checked_at: datetime | None
    last_result_status: str | None
    last_error_code: str | None
    last_http_status_code: int | None
    last_result_detail: str | None
    last_response_time_ms: float | None
    previous_response_time_ms: float | None
    average_response_time_ms: float | None
    response_time_samples: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
