#!/usr/bin/env python3
"""Apply a repository_dispatch payload to STUDY PLAN 2026.xlsx.

Run only inside the GitHub Action (needs `openpyxl`, installed as a workflow
step — not a dependency for local/browser use). Two event types:

  toggle-slot   {"sheet": "AGOSTO", "statusCell": "B4", "status": "DONE"}
      Writes `status` into `statusCell` on `sheet`.

  set-slot      {"sheet": "AGOSTO", "subjectCell": "A4", "statusCell": "B4",
                  "subject": "FRANCÊS", "status": "NOT DONE"}
      Writes both `subject` and `status` — used when the site adds a task to
      an empty slot, or edits what's planned in an existing one.

  log-session   {"timestamp": "...", "minutes": 30, "subject": "...", "note": "..."}
      Appends a row to a "POMODORO LOG" sheet (created with a header row on
      first use).

After writing, run scripts/xlsx_to_json.py separately to refresh the JSON
snapshot the frontend reads — this script only touches the .xlsx.
"""
import json
import sys
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parent.parent
XLSX_PATH = ROOT / "STUDY PLAN 2026.xlsx"
POMODORO_SHEET = "POMODORO LOG"
POMODORO_HEADERS = ["timestamp", "minutes", "subject", "note"]


def apply_toggle_slot(wb, payload):
    sheet_name = payload["sheet"]
    cell = payload["statusCell"]
    status = payload["status"]
    if status not in ("DONE", "NOT DONE"):
        raise ValueError(f"Invalid status: {status!r}")
    if sheet_name not in wb.sheetnames:
        raise ValueError(f"Unknown sheet: {sheet_name!r}")
    ws = wb[sheet_name]
    ws[cell] = status
    print(f"Set {sheet_name}!{cell} = {status}")


def apply_set_slot(wb, payload):
    sheet_name = payload["sheet"]
    subject_cell = payload["subjectCell"]
    status_cell = payload["statusCell"]
    subject = payload["subject"]
    status = payload["status"]
    if status not in ("DONE", "NOT DONE"):
        raise ValueError(f"Invalid status: {status!r}")
    if sheet_name not in wb.sheetnames:
        raise ValueError(f"Unknown sheet: {sheet_name!r}")
    ws = wb[sheet_name]
    ws[subject_cell] = subject
    ws[status_cell] = status
    print(f"Set {sheet_name}!{subject_cell} = {subject!r}, {sheet_name}!{status_cell} = {status!r}")


def apply_log_session(wb, payload):
    if POMODORO_SHEET not in wb.sheetnames:
        ws = wb.create_sheet(POMODORO_SHEET)
        ws.append(POMODORO_HEADERS)
    else:
        ws = wb[POMODORO_SHEET]
    ws.append(
        [
            payload.get("timestamp", ""),
            payload.get("minutes", ""),
            payload.get("subject", ""),
            payload.get("note", ""),
        ]
    )
    print(f"Logged pomodoro session to '{POMODORO_SHEET}': {payload}")


HANDLERS = {
    "toggle-slot": apply_toggle_slot,
    "set-slot": apply_set_slot,
    "log-session": apply_log_session,
}


def main():
    if len(sys.argv) != 3:
        print("Usage: apply_update.py <event_type> '<json_payload>'", file=sys.stderr)
        raise SystemExit(1)

    event_type, payload_raw = sys.argv[1], sys.argv[2]
    handler = HANDLERS.get(event_type)
    if handler is None:
        print(f"ERROR: unknown event_type {event_type!r}", file=sys.stderr)
        raise SystemExit(1)

    payload = json.loads(payload_raw)

    if not XLSX_PATH.exists():
        print(f"ERROR: {XLSX_PATH} not found", file=sys.stderr)
        raise SystemExit(1)

    wb = load_workbook(XLSX_PATH)
    handler(wb, payload)
    wb.save(XLSX_PATH)
    print(f"Saved {XLSX_PATH}")


if __name__ == "__main__":
    main()
