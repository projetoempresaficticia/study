#!/usr/bin/env python3
"""Convert STUDY PLAN 2026.xlsx into data/study-plan.json for the static site.

Uses only the Python standard library (zipfile + xml.etree) so it runs both
locally and inside the GitHub Action without extra dependencies for this step.

The workbook has one sheet per month (AGOSTO..DEZEMBRO). Each sheet holds four
fixed-layout "WEEK" blocks of 19 rows, starting at rows 1, 20, 39, 58:

  row+0  TIMETABLE
  row+1  WEEK N
  row+2  day headers (MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY in cols A,C,E,G,I)
  row+3..row+14   12 slot rows; each day uses a (subject, status) column pair
  row+15 blank
  row+16 per-language summary header
  row+17 per-language summary values (COUNTIFS formulas in the source file)
  row+18 blank

Row 16/17 in the source are Excel formulas (COUNTIF/COUNTIFS) whose cached
values go stale the moment a status cell is edited without reopening in
Excel. Rather than trust those cached values, this script recomputes DONE /
NOT DONE counts directly from the slot data it already parsed.
"""
import json
import posixpath
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

DAY_COLUMN_PAIRS = [("A", "B"), ("C", "D"), ("E", "F"), ("G", "H"), ("I", "J")]
WEEK_START_ROWS = [1, 20, 39, 58]
SLOT_ROW_COUNT = 12

ROOT = Path(__file__).resolve().parent.parent
XLSX_PATH = ROOT / "STUDY PLAN 2026.xlsx"
OUT_PATH = ROOT / "data" / "study-plan.json"


def col_row(cell_ref):
    """Split 'B4' into ('B', 4)."""
    i = 0
    while cell_ref[i].isalpha():
        i += 1
    return cell_ref[:i], int(cell_ref[i:])


def load_shared_strings(z):
    if "xl/sharedStrings.xml" not in z.namelist():
        return []
    root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    shared = []
    for si in root:
        texts = si.findall(".//m:t", NS)
        shared.append("".join(t.text or "" for t in texts))
    return shared


def resolve_workbook_rel_target(target):
    """Resolve a workbook.xml.rels Target into a path inside the zip.

    Excel writes relative targets ("worksheets/sheet1.xml", resolved against
    the "xl/" folder). openpyxl instead writes package-absolute targets
    ("/xl/worksheets/sheet1.xml") when it re-saves a file — both must resolve
    to the same "xl/worksheets/sheet1.xml" zip entry.
    """
    if target.startswith("/"):
        return target.lstrip("/")
    return posixpath.normpath(posixpath.join("xl", target))


def load_workbook_sheets(z):
    """Return [(sheet_name, worksheet_path), ...] in workbook order."""
    wb_root = ET.fromstring(z.read("xl/workbook.xml"))
    rels_root = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rel_map = {rel.get("Id"): rel.get("Target") for rel in rels_root}

    sheets = []
    for sh in wb_root.find("m:sheets", NS):
        name = sh.get("name")
        rid = sh.get(f"{REL_NS}id")
        target = rel_map.get(rid)
        if target is None:
            continue
        sheets.append((name, resolve_workbook_rel_target(target)))
    return sheets


def parse_sheet_cells(z, path, shared):
    """Return {cell_ref: value} for every non-empty cell in a worksheet.

    Handles both cell text encodings found in the wild: Excel's shared-string
    table (t="s", value is an index resolved against sharedStrings.xml) and
    openpyxl's default inline strings (t="inlineStr", text lives in <is><t>)
    when it re-saves a workbook.
    """
    root = ET.fromstring(z.read(path))
    sheet_data = root.find("m:sheetData", NS)
    cells = {}
    if sheet_data is None:
        return cells
    for row in sheet_data:
        for c in row:
            cell_type = c.get("t")
            if cell_type == "inlineStr":
                is_el = c.find("m:is", NS)
                if is_el is None:
                    continue
                texts = is_el.findall(".//m:t", NS)
                val = "".join(t.text or "" for t in texts)
            else:
                v = c.find("m:v", NS)
                if v is None or v.text is None:
                    continue
                val = v.text
                if cell_type == "s":
                    val = shared[int(val)]
            cells[c.get("r")] = val
    return cells


def parse_week(cells, start_row):
    header_row = start_row + 2
    week_label = cells.get(f"A{start_row + 1}")
    if week_label is None:
        return None

    days = []
    for subj_col, status_col in DAY_COLUMN_PAIRS:
        day_name = cells.get(f"{subj_col}{header_row}")
        slots = []
        for offset in range(SLOT_ROW_COUNT):
            row_num = start_row + 3 + offset
            subject_cell = f"{subj_col}{row_num}"
            status_cell = f"{status_col}{row_num}"
            subject = cells.get(subject_cell)
            status = cells.get(status_cell)
            # Always include the slot, even when empty — the frontend needs a
            # stable cell reference to let the user add a task into it.
            slots.append(
                {
                    "row": row_num,
                    "subject": subject,
                    "status": status,
                    "subjectCell": subject_cell,
                    "statusCell": status_cell,
                }
            )
        days.append({"name": day_name, "headerCell": f"{subj_col}{header_row}", "slots": slots})

    done = 0
    not_done = 0
    by_language = {}
    for day in days:
        for slot in day["slots"]:
            lang = slot["subject"]
            status = slot["status"]
            if lang is None:
                continue
            entry = by_language.setdefault(lang, {"done": 0, "notDone": 0})
            if status == "DONE":
                done += 1
                entry["done"] += 1
            elif status == "NOT DONE":
                not_done += 1
                entry["notDone"] += 1

    total = done + not_done
    ratio = round(done / total, 4) if total else None

    return {
        "label": week_label,
        "startRow": start_row,
        "days": days,
        "stats": {"done": done, "notDone": not_done, "ratio": ratio, "byLanguage": by_language},
    }


def parse_month_sheet(cells):
    weeks = []
    for start_row in WEEK_START_ROWS:
        week = parse_week(cells, start_row)
        if week is not None:
            weeks.append(week)
    return weeks


def parse_pomodoro_log(cells):
    """Optional 'POMODORO LOG' sheet: header row 1 (timestamp, minutes,
    subject, note), data from row 2 onward. Returns [] if not present."""
    if not cells:
        return []
    entries = []
    row = 2
    while f"A{row}" in cells:
        minutes_raw = cells.get(f"B{row}")
        try:
            minutes = float(minutes_raw)
            if minutes.is_integer():
                minutes = int(minutes)
        except (TypeError, ValueError):
            minutes = minutes_raw
        entries.append(
            {
                "timestamp": cells.get(f"A{row}"),
                "minutes": minutes,
                "subject": cells.get(f"C{row}"),
                "note": cells.get(f"D{row}"),
            }
        )
        row += 1
    return entries


def parse_events(cells):
    """Optional 'EVENTS' sheet: header row 1 (id, date, title, color, note),
    data from row 2 onward. Returns [] if not present."""
    if not cells:
        return []
    entries = []
    row = 2
    while f"A{row}" in cells:
        entries.append(
            {
                "id": cells.get(f"A{row}"),
                "date": cells.get(f"B{row}"),
                "title": cells.get(f"C{row}"),
                "color": cells.get(f"D{row}"),
                "note": cells.get(f"E{row}"),
            }
        )
        row += 1
    return entries


def main():
    if not XLSX_PATH.exists():
        print(f"ERROR: {XLSX_PATH} not found", file=sys.stderr)
        raise SystemExit(1)

    with zipfile.ZipFile(XLSX_PATH) as z:
        shared = load_shared_strings(z)
        sheets = load_workbook_sheets(z)

        months = []
        pomodoro_log = []
        events = []
        languages = set()

        for name, path in sheets:
            cells = parse_sheet_cells(z, path, shared)
            if name.strip().upper() == "POMODORO LOG":
                pomodoro_log = parse_pomodoro_log(cells)
                continue
            if name.strip().upper() == "EVENTS":
                events = parse_events(cells)
                continue
            weeks = parse_month_sheet(cells)
            if not weeks:
                continue
            for week in weeks:
                languages.update(week["stats"]["byLanguage"].keys())
            months.append({"name": name, "sheet": name, "weeks": weeks})

    from datetime import datetime, timezone

    output = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceFile": XLSX_PATH.name,
        "languages": sorted(languages),
        "months": months,
        "pomodoroLog": pomodoro_log,
        "events": events,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    total_slots = sum(len(d["slots"]) for m in months for w in m["weeks"] for d in w["days"])
    print(
        f"Wrote {OUT_PATH} — {len(months)} months, {total_slots} slots, "
        f"{len(pomodoro_log)} pomodoro log entries, {len(events)} calendar events"
    )


if __name__ == "__main__":
    main()
