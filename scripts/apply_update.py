#!/usr/bin/env python3
"""Apply a repository_dispatch payload to the study or books spreadsheet.

Run only inside the GitHub Action (needs `openpyxl`, installed as a workflow
step — not a dependency for local/browser use). Each event_type is routed to
the .xlsx file it belongs to (see HANDLERS at the bottom).

STUDY PLAN 2026.xlsx events:

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
                  "color": "#FFD1DC", "note": "...", "type": "task",
                  "done": false, "subtasks": [{"id":"..","title":"..","done":false}]}
      Appends a row to an "EVENTS" sheet (created with a header row on first
      use) — a calendar event or task. `type` is "event" or "task";
      `subtasks` only makes sense for tasks and is stored JSON-encoded in
      one cell (a flat sheet can't nest rows under a parent).

  update-event  {"id": "...", "fields": {"done": true, "subtasks": [...]}}
      Updates whichever of title/color/note/type/done/subtasks are given,
      on the row whose id matches — used for toggling a task done and for
      every subtask add/toggle/delete (the frontend always sends the whole
      subtasks array back, not a diff).

  delete-event  {"id": "..."}
      Removes the row from "EVENTS" whose id matches.

Books.xlsx events (only the "BOOKS" sheet is touched — see books_to_json.py
for why the other sheets in that file are ignored):

  add-book      {"row": 204, "title": "...", "author": "...", "genre": "...",
                  "status": "Reading", "format": "Ebook", "rating": 4.5,
                  "pages": 320, "dateFinished": "2026-09-20", "notes": "..."}
      Writes a full new row. `row` comes from data/books.json's `nextRow` —
      the frontend increments its own copy after each add in the same
      session so two rapid adds don't target the same row (see js/books.js).

  update-book   {"row": 12, "fields": {"status": "Finished", "rating": 4.5,
                  "notes": "...", "dateFinished": "2026-09-20"}}
      Only status/rating/notes/dateFinished are editable after a book is
      added — title/author/genre/format/pages are set once at add time.

After writing, run the matching *_to_json.py script separately to refresh
the JSON snapshot the frontend reads — this script only touches the .xlsx.
"""
import json
import sys
from datetime import datetime
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parent.parent
STUDY_XLSX_PATH = ROOT / "STUDY PLAN 2026.xlsx"
BOOKS_XLSX_PATH = ROOT / "Books.xlsx"

POMODORO_SHEET = "POMODORO LOG"
POMODORO_HEADERS = ["timestamp", "minutes", "subject", "note"]
EVENTS_SHEET = "EVENTS"
EVENTS_HEADERS = ["id", "date", "title", "color", "note", "type", "done", "subtasks"]
BOOKS_SHEET = "BOOKS"


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
            payload.get("type", "event"),
            "TRUE" if payload.get("done") else "FALSE",
            json.dumps(payload.get("subtasks", []), ensure_ascii=False),
        ]
    )
    print(f"Added {payload.get('type', 'event')} {payload['id']!r} on {payload['date']!r} to '{EVENTS_SHEET}'")


EVENT_UPDATE_COLUMNS = {"title": 3, "color": 4, "note": 5, "type": 6, "done": 7, "subtasks": 8}


def apply_update_event(wb, payload):
    target_id = str(payload["id"])
    if EVENTS_SHEET not in wb.sheetnames:
        raise ValueError(f"No '{EVENTS_SHEET}' sheet — nothing to update")
    ws = wb[EVENTS_SHEET]
    fields = payload.get("fields", {})
    for row in range(2, ws.max_row + 1):
        if str(ws.cell(row=row, column=1).value) != target_id:
            continue
        for field, value in fields.items():
            col = EVENT_UPDATE_COLUMNS.get(field)
            if col is None:
                continue
            if field == "subtasks":
                value = json.dumps(value, ensure_ascii=False)
            elif field == "done":
                value = "TRUE" if value else "FALSE"
            ws.cell(row=row, column=col, value=value)
        print(f"Updated event {target_id!r} (row {row}): {fields}")
        return
    print(f"Event {target_id!r} not found in '{EVENTS_SHEET}'")


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


def iso_date_to_excel_serial(date_str):
    if not date_str:
        return None
    try:
        d = datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        return None
    return (d - datetime(1899, 12, 30)).days


def apply_add_book(wb, payload):
    if BOOKS_SHEET not in wb.sheetnames:
        raise ValueError(f"Sheet '{BOOKS_SHEET}' not found in {BOOKS_XLSX_PATH.name}")
    ws = wb[BOOKS_SHEET]
    row = payload["row"]
    ws.cell(row=row, column=1, value=payload.get("title") or "")
    ws.cell(row=row, column=2, value=payload.get("author") or None)
    ws.cell(row=row, column=3, value=payload.get("genre") or None)
    ws.cell(row=row, column=4, value=payload.get("status") or "Want to Read")
    ws.cell(row=row, column=5, value=payload.get("format") or None)
    if payload.get("rating") is not None:
        ws.cell(row=row, column=6, value=payload["rating"])
    if payload.get("pages") is not None:
        ws.cell(row=row, column=7, value=payload["pages"])
    serial = iso_date_to_excel_serial(payload.get("dateFinished"))
    if serial is not None:
        ws.cell(row=row, column=9, value=serial)
    if payload.get("notes"):
        ws.cell(row=row, column=10, value=payload["notes"])
    print(f"Added book {payload.get('title')!r} at row {row}")


BOOK_UPDATE_COLUMNS = {"status": 4, "rating": 6, "notes": 10}


def apply_update_book(wb, payload):
    if BOOKS_SHEET not in wb.sheetnames:
        raise ValueError(f"Sheet '{BOOKS_SHEET}' not found in {BOOKS_XLSX_PATH.name}")
    ws = wb[BOOKS_SHEET]
    row = payload["row"]
    fields = payload.get("fields", {})
    for field, value in fields.items():
        if field == "dateFinished":
            serial = iso_date_to_excel_serial(value)
            if serial is not None:
                ws.cell(row=row, column=9, value=serial)
            continue
        col = BOOK_UPDATE_COLUMNS.get(field)
        if col is None:
            continue
        ws.cell(row=row, column=col, value=value)
    print(f"Updated book row {row}: {fields}")


HANDLERS = {
    "toggle-slot": (STUDY_XLSX_PATH, apply_toggle_slot),
    "set-slot": (STUDY_XLSX_PATH, apply_set_slot),
    "log-session": (STUDY_XLSX_PATH, apply_log_session),
    "add-event": (STUDY_XLSX_PATH, apply_add_event),
    "update-event": (STUDY_XLSX_PATH, apply_update_event),
    "delete-event": (STUDY_XLSX_PATH, apply_delete_event),
    "add-book": (BOOKS_XLSX_PATH, apply_add_book),
    "update-book": (BOOKS_XLSX_PATH, apply_update_book),
}


def main():
    if len(sys.argv) != 3:
        print("Usage: apply_update.py <event_type> '<json_payload>'", file=sys.stderr)
        raise SystemExit(1)

    event_type, payload_raw = sys.argv[1], sys.argv[2]
    routing = HANDLERS.get(event_type)
    if routing is None:
        print(f"ERROR: unknown event_type {event_type!r}", file=sys.stderr)
        raise SystemExit(1)
    xlsx_path, handler = routing

    payload = json.loads(payload_raw)

    if not xlsx_path.exists():
        print(f"ERROR: {xlsx_path} not found", file=sys.stderr)
        raise SystemExit(1)

    wb = load_workbook(xlsx_path)
    handler(wb, payload)
    wb.save(xlsx_path)
    print(f"Saved {xlsx_path}")


if __name__ == "__main__":
    main()
