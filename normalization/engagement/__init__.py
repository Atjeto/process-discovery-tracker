"""Engagement workspace — PDT-1.0-SPEC §5.

An Engagement is the new top-level concept above the session: one
consulting deliverable that aggregates many sessions from many workers
into a single Process Backlog + PDD bundle. See ADR-0030.

Folder layout:

    engagements/<engagement_id>/
      engagement.json              metadata, owner, dates, scope
      sessions/                    symlinks or copies of session folders
      backlog.json                 the Process Backlog (deliverable)
      processes/<process_id>/      one folder per identified process
        pdd.md                     polished PDD for this process
        evidence.json              session/case linkage backing each claim
        thumbnail.png              BPMN snapshot for slides
      deliverables/
        backlog.xlsx
        pdd-bundle.pdf
        slide-cards/

The pipeline never writes to engagements/ directly; this module owns the
read/write surface and is consumed by the viewer (engagement Cockpit) and
the deliverable exporters (Phase 1).
"""

from .engagement_io import (
    load_engagement,
    write_engagement,
    list_engagement_sessions,
    new_engagement,
    ENGAGEMENT_SCHEMA_VERSION,
)
from .backlog import build_backlog, write_backlog, load_backlog
from .backlog_export import export_csv as export_backlog_csv
from .backlog_export import export_xlsx as export_backlog_xlsx
from .pdd_export import (
    write_pdd_markdown,
    write_pdd_pdf,
    export_pdd_bundle,
)
from .config_bundle import (
    export_engagement_config,
    import_engagement_config,
    BUNDLE_VERSION,
)

__all__ = [
    "load_engagement",
    "write_engagement",
    "list_engagement_sessions",
    "new_engagement",
    "ENGAGEMENT_SCHEMA_VERSION",
    "build_backlog",
    "write_backlog",
    "load_backlog",
    "export_backlog_csv",
    "export_backlog_xlsx",
    "write_pdd_markdown",
    "write_pdd_pdf",
    "export_pdd_bundle",
    "export_engagement_config",
    "import_engagement_config",
    "BUNDLE_VERSION",
]
