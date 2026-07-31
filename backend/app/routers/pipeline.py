"""Pipeline run/status endpoints."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from ..db import get_settings
from ..state import AppState
from .deps import get_state

router = APIRouter(prefix="/api/pipeline", tags=["pipeline"])


@router.post("/run")
def run_pipeline(state: AppState = Depends(get_state)):
    conn = state.db()
    try:
        settings = get_settings(conn)
    finally:
        conn.close()
    nml = settings["collection_nml_path"]
    if not nml:
        raise HTTPException(
            status_code=400,
            detail="No Traktor collection configured — set collection_nml_path in Settings first",
        )
    if not Path(nml).is_file():
        raise HTTPException(status_code=400, detail=f"collection.nml not found at: {nml}")
    try:
        run_id = state.pipeline.start()
    except RuntimeError:
        raise HTTPException(status_code=409, detail="A pipeline run is already in progress") from None
    return JSONResponse(status_code=202, content={"run_id": run_id})


@router.get("/status")
def pipeline_status(state: AppState = Depends(get_state)) -> dict:
    return state.pipeline.status()
