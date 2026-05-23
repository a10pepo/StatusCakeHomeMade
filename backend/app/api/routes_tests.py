from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin_or_owner
from app.db.session import get_db
from app.models.application import Application
from app.models.test import Test
from app.models.user import User
from app.schemas.test import TestCreate, TestResponse, TestUpdate

router = APIRouter(prefix="/api", tags=["tests"])


@router.get("/applications/{application_id}/tests", response_model=list[TestResponse])
def list_tests(application_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    application = db.query(Application).filter(Application.id == application_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    return db.query(Test).filter(Test.application_id == application.id).order_by(Test.created_at.desc()).all()


@router.post("/applications/{application_id}/tests", response_model=TestResponse, status_code=status.HTTP_201_CREATED)
def create_test(application_id: int, payload: TestCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    application = db.query(Application).filter(Application.id == application_id).first()
    if not application:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    require_admin_or_owner(application, current_user)

    test = Test(application_id=application.id, **payload.model_dump())
    db.add(test)
    db.commit()
    db.refresh(test)
    return test


@router.put("/tests/{test_id}", response_model=TestResponse)
def update_test(test_id: int, payload: TestUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    test = db.query(Test).filter(Test.id == test_id).first()
    if not test:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Test not found")
    require_admin_or_owner(test.application, current_user)

    for key, value in payload.model_dump().items():
        setattr(test, key, value)

    db.add(test)
    db.commit()
    db.refresh(test)
    return test


@router.delete("/tests/{test_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_test(test_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    test = db.query(Test).filter(Test.id == test_id).first()
    if not test:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Test not found")
    require_admin_or_owner(test.application, current_user)
    db.delete(test)
    db.commit()
