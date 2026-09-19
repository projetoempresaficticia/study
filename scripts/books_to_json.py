#!/usr/bin/env python3
"""Convert Books.xlsx into data/books.json for the static site.

Only the "BOOKS" sheet is treated as the reading list (it's the master list
with everything, ~199 entries) — the "Planilha1" webtoon subset and the
per-year sheets in the source file are ignored; they're manual copies/filters
that the site doesn't need and would otherwise go stale.

Uses only the Python standard library (zipfile + xml.etree), same approach
as scripts/xlsx_to_json.py — no dependencies needed to run this locally.

Sheet layout (fixed, from inspecting the file):
  row 1  title banner ("MANHWA / WEBTOON / LIVROS")
  row 2  blank
  row 3  summary formulas (COUNTA/COUNTIF/AVERAGE/SUM) — cached values go
         stale the moment a row is added without reopening in Excel, so this
         script recomputes totals itself from the actual rows instead.
  row 4  headers: Title, Author, Genre, Status, Format, Rating (1-5), Pages,
         Star Display, Date Finished, Review / Notes
  row 5+ one book per row (title in column A); trailing rows with no title
         are just leftover formatting, not data.
"""
import json
import posixpath
import sys
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

BOOKS_SHEET_NAME = "BOOKS"
FIRST_DATA_ROW = 5
COLUMNS = {
    "title": "A",
    "author": "B",
    "genre": "C",
    "status": "D",
    "format": "E",
    "rating": "F",
    "pages": "G",
    "starDisplay": "H",
    "dateFinished": "I",
    "notes": "J",
}

ROOT = Path(__file__).resolve().parent.parent
XLSX_PATH = ROOT / "Books.xlsx"
OUT_PATH = ROOT / "data" / "books.json"


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
    """See scripts/xlsx_to_json.py for why both forms must resolve the same
    way: Excel writes relative targets, openpyxl writes package-absolute
    ones when it re-saves a file."""
    if target.startswith("/"):
        return target.lstrip("/")
    return posixpath.normpath(posixpath.join("xl", target))


def load_workbook_sheets(z):
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
    """Handles both Excel's shared-string cells (t="s") and openpyxl's
    inline-string re-save format (t="inlineStr") — see xlsx_to_json.py."""
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


def max_row_number(cells):
    max_row = FIRST_DATA_ROW - 1
    for ref in cells:
        i = 0
        while ref[i].isalpha():
            i += 1
        max_row = max(max_row, int(ref[i:]))
    return max_row


def excel_serial_to_iso_date(value):
    """Excel serial date -> 'YYYY-MM-DD', or None if not a plausible date."""
    try:
        serial = float(value)
    except (TypeError, ValueError):
        return None
    if serial <= 0 or serial > 100000:
        return None
    try:
        return (datetime(1899, 12, 30) + timedelta(days=serial)).strftime("%Y-%m-%d")
    except OverflowError:
        return None


def to_number(value):
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    return int(num) if num.is_integer() else num


def main():
    if not XLSX_PATH.exists():
        print(f"ERROR: {XLSX_PATH} not found", file=sys.stderr)
        raise SystemExit(1)

    with zipfile.ZipFile(XLSX_PATH) as z:
        shared = load_shared_strings(z)
        sheets = load_workbook_sheets(z)
        sheet_path = None
        for name, path in sheets:
            if name.strip().upper() == BOOKS_SHEET_NAME:
                sheet_path = path
                break
        if sheet_path is None:
            print(f"ERROR: sheet '{BOOKS_SHEET_NAME}' not found in {XLSX_PATH}", file=sys.stderr)
            raise SystemExit(1)
        cells = parse_sheet_cells(z, sheet_path, shared)

    last_row = max_row_number(cells)

    books = []
    genres = set()
    statuses = set()
    formats = set()
    last_title_row = FIRST_DATA_ROW - 1

    for row in range(FIRST_DATA_ROW, last_row + 1):
        title = cells.get(f"{COLUMNS['title']}{row}")
        if not title:
            continue
        last_title_row = row
        genre = cells.get(f"{COLUMNS['genre']}{row}")
        status = cells.get(f"{COLUMNS['status']}{row}")
        fmt = cells.get(f"{COLUMNS['format']}{row}")
        if genre:
            genres.add(genre)
        if status:
            statuses.add(status)
        if fmt:
            formats.add(fmt)
        books.append(
            {
                "row": row,
                "title": title,
                "author": cells.get(f"{COLUMNS['author']}{row}"),
                "genre": genre,
                "status": status,
                "format": fmt,
                "rating": to_number(cells.get(f"{COLUMNS['rating']}{row}")),
                "pages": to_number(cells.get(f"{COLUMNS['pages']}{row}")),
                "dateFinished": excel_serial_to_iso_date(cells.get(f"{COLUMNS['dateFinished']}{row}")),
                "notes": cells.get(f"{COLUMNS['notes']}{row}"),
            }
        )

    ratings = [b["rating"] for b in books if isinstance(b["rating"], (int, float)) and b["rating"] > 0]
    stats = {
        "total": len(books),
        "finished": sum(1 for b in books if b["status"] == "Finished"),
        "avgRating": round(sum(ratings) / len(ratings), 2) if ratings else None,
        "totalPages": sum(b["pages"] for b in books if isinstance(b["pages"], (int, float))),
    }

    output = {
        "generatedAt": datetime.now().astimezone().isoformat(),
        "sourceFile": XLSX_PATH.name,
        "nextRow": last_title_row + 1,
        "genres": sorted(genres),
        "statuses": sorted(statuses),
        "formats": sorted(formats),
        "stats": stats,
        "books": books,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {OUT_PATH} — {len(books)} books, next free row {last_title_row + 1}")


if __name__ == "__main__":
    main()
