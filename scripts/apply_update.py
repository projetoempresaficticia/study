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

  add-event     {"id": "...", "date": "2026-09-20", "title": "...",
                  "color": "#FFD1DC", "note": "..."}
      Appends a row to an "EVENTS" sheet (created with a header row on first
      use) — a calendar event.

  delete-event  {"id": "..."}
      Removes the row from "EVENTS" whose id matches.

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
EVENTS_SHEET = "EVENTS"
EVENTS_HEADERS = ["id", "date", "title", "color", "note"]


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


def apply_add_event(wb, payload):
    if EVENTS_SHEET not in wb.sheetnames:
        ws = wb.create_sheet(EVENTS_SHEET)
        ws.append(EVENTS_HEADERS)
    else:
        ws = wb[EVENTS_SHEET]
    ws.append(
        [
            payload["id"],
            payload["date"],
            payload.get("title", ""),
            payload.get("color", ""),
            payload.get("note", ""),
        ]
    )
    print(f"Added event {payload['id']!r} on {payload['date']!r} to '{EVENTS_SHEET}'")


def apply_delete_event(wb, payload):
    target_id = str(payload["id"])
    if EVENTS_SHEET not in wb.sheetnames:
        print(f"No '{EVENTS_SHEET}' sheet — nothing to delete")
        return
    ws = wb[EVENTS_SHEET]
    for row in range(ws.max_row, 1, -1):
        if str(ws.cell(row=row, column=1).value) == target_id:
            ws.delete_rows(row, 1)
            print(f"Deleted event {target_id!r} (row {row})")
            return
    print(f"Event {target_id!r} not found in '{EVENTS_SHEET}'")


HANDLERS = {
    "toggle-slot": apply_toggle_slot,
    "set-slot": apply_set_slot,
    "log-session": apply_log_session,
    "add-event": apply_add_event,
    "delete-event": apply_delete_event,
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
