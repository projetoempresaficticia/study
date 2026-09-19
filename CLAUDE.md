# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A study planner site: a weekly language-study timetable (sourced from
`STUDY PLAN 2026.xlsx`) plus a 30-minute-focus/5-minute-break Pomodoro timer.
Plain HTML/CSS/JS, no build step, deployed as a static site on GitHub Pages.

## Running locally

```
python3 -m http.server 8000
```

Then open `http://localhost:8000`. No install step for the frontend itself.

## Data pipeline

`STUDY PLAN 2026.xlsx` is the source of truth. `data/study-plan.json` is a
generated snapshot the frontend actually reads (`js/app.js` does
`fetch('data/study-plan.json')`) — regenerate it after editing the xlsx:

```
python3 scripts/xlsx_to_json.py
```

`scripts/xlsx_to_json.py` uses only the Python standard library (`zipfile` +
`xml.etree`, no `openpyxl` needed) so it runs anywhere. It parses the fixed
19-row-per-week layout of each month sheet (see the docstring for the exact
row offsets) and recomputes DONE/NOT DONE aggregates itself in Python rather
than trusting the spreadsheet's cached `COUNTIF`/`COUNTIFS` formula results,
which go stale the moment a cell is edited outside Excel.

It also handles two on-disk encodings of the same worksheet content: Excel's
shared-string table (`t="s"`, `xl/sharedStrings.xml`) and openpyxl's inline
strings (`t="inlineStr"`), and both relative (`worksheets/sheet1.xml`) and
openpyxl's package-absolute (`/xl/worksheets/sheet1.xml`) `workbook.xml.rels`
targets. `scripts/apply_update.py` (which runs inside the GitHub Action, see
below) re-saves the workbook with `openpyxl`, which is where the inline-string
and absolute-path forms come from — losing either handler silently produces
an empty `data/study-plan.json` after the first write-back.

## Write-back: GitHub Actions, not a server

GitHub Pages serves static files only — there's no backend. Toggling a
timetable slot or completing a Pomodoro focus cycle calls
`js/github-sync.js`, which sends a `repository_dispatch` event straight to
the GitHub API using a token the user pastes once into Ajustes (stored only
in that browser's `localStorage`, never committed). `.github/workflows/
update-plan.yml` receives it, runs `scripts/apply_update.py` (edits the
xlsx — toggles a status cell, or appends a row to a `POMODORO LOG` sheet it
creates on first use) and then `scripts/xlsx_to_json.py`, and commits both
files. GitHub Pages redeploys from that commit automatically — expect a
short delay, not an instant update. If no repo/token is configured in
Ajustes, the UI still updates optimistically in memory but nothing is
persisted remotely.

Because of this, always test `scripts/apply_update.py` changes against a
**copy** of the xlsx, not the real file — see how it round-trips through
`scripts/xlsx_to_json.py` afterward, since that's the exact sequence the
Action runs.

## No Figma dependency

Visuals are hand-written CSS (`css/styles.css`, warm peach/cream palette,
serif headline + sans-serif body) and Lucide icons loaded from a CDN
(`<script src="https://unpkg.com/lucide@latest">`, then `lucide.createIcons()`).
This was a deliberate choice after the project's Figma account access turned
out to be blocked (view-only seat) — don't reintroduce a Figma MCP/API
dependency without checking that access works first.
