from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.db.session import get_db
from app.models.user import User
from app.schemas.history import CsvImportResult, SampleDataStatus
from app.services.sample_data import (
    clear_sample_data,
    export_checks_to_csv,
    get_or_create_sample_state,
    import_checks_from_csv,
    load_sample_data,
)

router = APIRouter(prefix="/api/sample-data", tags=["sample-data"])


@router.get("", response_model=SampleDataStatus)
def get_sample_data_status(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    state = get_or_create_sample_state(db)
    return SampleDataStatus(loaded=state.is_loaded, loaded_at=state.loaded_at)


@router.post("/load", response_model=SampleDataStatus)
def load_sample_data_route(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    state = load_sample_data(db)
    return SampleDataStatus(loaded=state.is_loaded, loaded_at=state.loaded_at)


@router.delete("", response_model=SampleDataStatus)
def clear_sample_data_route(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    state = clear_sample_data(db)
    return SampleDataStatus(loaded=state.is_loaded, loaded_at=state.loaded_at)


@router.post("/import", response_model=CsvImportResult)
async def import_sample_checks_route(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_admin(current_user)
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only CSV files are supported")
    content = await file.read()
    try:
        csv_content = content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV file must be UTF-8 encoded") from exc
    try:
        return import_checks_from_csv(db, csv_content)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/export")
def export_sample_checks_route(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_admin(current_user)
    csv_content = export_checks_to_csv(db)
    return Response(
        content=csv_content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="checks-config.csv"'},
    )
