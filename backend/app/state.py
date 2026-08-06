"""Per-app state object: data dir, DB access, pipeline manager, CSV caches."""
from __future__ import annotations

import sqlite3
from pathlib import Path

from . import config, db, instance
from .pipeline_data import PipelineData


class AppState:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        config.ensure_layout(data_dir)
        instance.write(data_dir)
        db.init_db(self.db_path)
        self.pipeline_data = PipelineData(self.work_dir)
        # imported here to avoid a cycle (pipeline_runner imports notes_merge)
        from .pipeline_runner import PipelineManager
        self.pipeline = PipelineManager(self)

    # --- paths ---
    @property
    def db_path(self) -> Path:
        return config.db_path(self.data_dir)

    @property
    def exportify_dir(self) -> Path:
        return config.exportify_dir(self.data_dir)

    @property
    def work_dir(self) -> Path:
        return config.work_dir(self.data_dir)

    # --- db ---
    def db(self) -> sqlite3.Connection:
        return db.connect(self.db_path)

    def reopen(self) -> None:
        """After a restore swap: re-ensure layout, re-publish identity, drop caches."""
        config.ensure_layout(self.data_dir)
        instance.write(self.data_dir)  # the swapped-in dir carries no identity of ours
        db.init_db(self.db_path)
        self.pipeline_data.invalidate()
