"""SetMaster 3 pipeline package — verbatim port of the SM2 Python pipeline.

The matching/normalization heuristics (clean_track_name, filename and
playlist-name normalization, key mapping, presence_flag logic) are copied
verbatim from the SM2 public-release scripts (legacy/setmaster-2/...) —
years of accumulated fixes; do not "improve" them.

Only plumbing was restructured: argv/config-CSV inputs became function
parameters, subprocess orchestration became direct calls, and the
Excel-era file-lock preflight / repo-path-suffix validation were dropped.
Outputs are byte-compatible with SM2 (same files, schemas, utf-8-sig).
"""

from .api import PipelineResult, StageResult, run_pipeline

__all__ = ["run_pipeline", "PipelineResult", "StageResult"]
