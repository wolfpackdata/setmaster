"""SetMaster 3 backend entry point.

Run from backend/:
    .venv/Scripts/python.exe -m uvicorn app.main:app --port 8137

The app-data dir resolves per platform (Windows %APPDATA%/SetMaster3, macOS
~/Library/Application Support/SetMaster3), overridable via SM3_DATA_DIR.
The built frontend (frontend/dist) is served at / when present.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import FileResponse

from . import APP_VERSION, config, instance
from .routers import (
    backup,
    comparison,
    fs,
    matrix,
    pipeline,
    sets,
    settings,
    validation_lists,
)
from .state import AppState

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


def create_app(data_dir: Path | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.sm3 = AppState(data_dir or config.default_data_dir())
        try:
            yield
        finally:
            instance.remove(app.state.sm3.data_dir)

    app = FastAPI(title="SetMaster 3", version=APP_VERSION, lifespan=lifespan)
    for mod in (settings, pipeline, matrix, sets, validation_lists, comparison, fs, backup):
        app.include_router(mod.router)

    # serve the built frontend at / (routers above win; static is the fallback)
    if FRONTEND_DIST.is_dir():

        class SpaStaticFiles(StaticFiles):
            """SPA fallback: unknown non-API paths get index.html (BrowserRouter deep links)."""

            async def get_response(self, path: str, scope):
                try:
                    return await super().get_response(path, scope)
                except StarletteHTTPException as exc:
                    if exc.status_code == 404 and not path.startswith("api"):
                        return FileResponse(FRONTEND_DIST / "index.html")
                    raise

        app.mount("/", SpaStaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
    return app


app = create_app()
