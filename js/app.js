// Main app: view switching, loads data/study-plan.json, renders the home
// cards and the weekly timetable, wires status toggles to GithubSync.

const QUOTES = [
  "Um passo de cada vez também é progresso.",
  "Estudar 30 minutos com foco vale mais que 3 horas distraído.",
  "Consistência bate intensidade.",
  "Cada idioma é uma vida a mais.",
  "Descansar 5 minutos também faz parte do plano.",
  "O que é feito aos poucos, todo dia, vira fluência.",
];

const State = {
  data: null,
  monthIdx: 0,
  weekIdx: 0,
};

function showView(view) {
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  ["home", "timetable", "pomodoro", "calendar", "books", "settings"].forEach((v) => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.hidden = v !== view;
  });
}

function setTodayDate() {
  const el = document.getElementById("today-date");
  if (!el) return;
  const fmt = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
  el.textContent = fmt.format(new Date());
}

function pickQuote() {
  const el = document.getElementById("quote-text");
  if (!el) return;
  el.textContent = QUOTES[Math.floor(Math.random() * QUOTES.length)];
}

function findDefaultSelection(data) {
  // Prefer the first month/week that actually has DONE/NOT DONE data.
  for (let mi = 0; mi < data.months.length; mi++) {
    const month = data.months[mi];
    for (let wi = 0; wi < month.weeks.length; wi++) {
      const stats = month.weeks[wi].stats;
      if (stats.done + stats.notDone > 0) {
        return { monthIdx: mi, weekIdx: wi };
      }
    }
  }
  return { monthIdx: 0, weekIdx: 0 };
}

function currentWeek() {
  const month = State.data.months[State.monthIdx];
  if (!month) return null;
  return month.weeks[State.weekIdx] || month.weeks[0];
}

function renderProgressRing(stats) {
  const circle = document.getElementById("progress-ring-fg");
  const pctLabel = document.getElementById("progress-ring-pct");
  const countLabel = document.getElementById("progress-ring-count");
  if (!circle) return;

  const r = 52;
  const circumference = 2 * Math.PI * r;
  const total = stats.done + stats.notDone;
  const ratio = total ? stats.done / total : 0;

  circle.style.strokeDasharray = String(circumference);
  circle.style.strokeDashoffset = String(circumference * (1 - ratio));
  pctLabel.textContent = `${Math.round(ratio * 100)}%`;
  countLabel.textContent = `${stats.done}/${total}`;
}

function renderLanguageList(stats) {
  const list = document.getElementById("language-list");
  if (!list) return;
  list.innerHTML = "";

  const entries = Object.entries(stats.byLanguage).sort((a, b) => b[1].done - a[1].done);
  if (entries.length === 0) {
    list.innerHTML = '<li class="slot-empty">Sem dados nesta semana.</li>';
    return;
  }

  entries.forEach(([lang, counts]) => {
    const total = counts.done + counts.notDone;
    const pct = total ? Math.round((counts.done / total) * 100) : 0;
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="lang-name">${lang.toLowerCase()}</span>
      <span class="lang-bar"><span class="lang-bar-fill" style="width:${pct}%"></span></span>
      <span class="lang-count">${counts.done}/${total}</span>
    `;
    list.appendChild(li);
  });
}

function renderHomeCards() {
  const week = currentWeek();
  if (!week) return;
  renderProgressRing(week.stats);
  renderLanguageList(week.stats);
}

function renderMonthSelect() {
  const select = document.getElementById("month-select");
  select.innerHTML = "";
  State.data.months.forEach((m, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    opt.textContent = m.name.toLowerCase();
    select.appendChild(opt);
  });
  select.value = String(State.monthIdx);
  select.addEventListener("change", () => {
    State.monthIdx = Number(select.value);
    State.weekIdx = 0;
    renderWeekButtons();
    renderTimetable();
    renderHomeCards();
  });
}

function renderWeekButtons() {
  const wrap = document.getElementById("week-buttons");
  wrap.innerHTML = "";
  const month = State.data.months[State.monthIdx];
  month.weeks.forEach((week, idx) => {
    const btn = document.createElement("button");
    btn.textContent = week.label.replace("WEEK ", "Sem. ");
    btn.classList.toggle("active", idx === State.weekIdx);
    btn.addEventListener("click", () => {
      State.weekIdx = idx;
      renderWeekButtons();
      renderTimetable();
      renderHomeCards();
    });
    wrap.appendChild(btn);
  });
}

function slotCellHtml(sheet, slot) {
  const hasSubject = Boolean(slot.subject);
  const statusHtml = hasSubject
    ? `<button class="slot-status ${slot.status === "DONE" ? "done" : "not-done"}" data-sheet="${sheet}" data-cell="${slot.statusCell}" data-status="${slot.status || ""}">${slot.status || "?"}</button>`
    : "";
  const subjectBtn = hasSubject
    ? `<button class="slot-subject-btn" data-current="${slot.subject}" title="Editar">${slot.subject.toLowerCase()}</button>`
    : `<button class="slot-subject-btn empty" data-current="" title="Adicionar tarefa"><i data-lucide="plus"></i> adicionar</button>`;
  return `
    <div class="slot-cell" data-sheet="${sheet}" data-subject-cell="${slot.subjectCell}" data-status-cell="${slot.statusCell}">
      ${subjectBtn}
      ${statusHtml}
    </div>
  `;
}

function renderTimetable() {
  const month = State.data.months[State.monthIdx];
  const week = month.weeks[State.weekIdx];
  const head = document.getElementById("timetable-head");
  const body = document.getElementById("timetable-body");

  head.innerHTML = week.days.map((d) => `<th>${(d.name || "").toLowerCase()}</th>`).join("");

  const rowCount = Math.max(...week.days.map((d) => d.slots.length), 0);
  const rows = [];
  for (let i = 0; i < rowCount; i++) {
    const cells = week.days
      .map((day) => `<td>${slotCellHtml(month.sheet, day.slots[i])}</td>`)
      .join("");
    rows.push(`<tr>${cells}</tr>`);
  }
  body.innerHTML = rows.join("");
  if (window.lucide) lucide.createIcons();

  attachTimetableHandlers(body);
}

function attachTimetableHandlers(body) {
  body.querySelectorAll(".slot-status").forEach((btn) => {
    btn.addEventListener("click", () => handleStatusToggle(btn));
  });
  body.querySelectorAll(".slot-subject-btn").forEach((btn) => {
    btn.addEventListener("click", () => startEditingSlot(btn));
  });
}

async function handleStatusToggle(btn) {
  const sheet = btn.dataset.sheet;
  const statusCell = btn.dataset.cell;
  const currentStatus = btn.dataset.status;
  const nextStatus = currentStatus === "DONE" ? "NOT DONE" : "DONE";

  // Optimistic UI update.
  btn.textContent = nextStatus;
  btn.dataset.status = nextStatus;
  btn.classList.toggle("done", nextStatus === "DONE");
  btn.classList.toggle("not-done", nextStatus === "NOT DONE");
  updateInMemoryStatus(sheet, statusCell, nextStatus);
  renderHomeCards();

  const result = await GithubSync.toggleSlot({ sheet, statusCell, currentStatus });
  warnIfNotSynced(result);
}

function startEditingSlot(btn) {
  const wrap = btn.closest(".slot-cell");
  const sheet = wrap.dataset.sheet;
  const subjectCell = wrap.dataset.subjectCell;
  const statusCell = wrap.dataset.statusCell;
  const current = btn.dataset.current || "";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "slot-edit-input";
  input.value = current;
  input.placeholder = "o que vai ser feito...";
  input.maxLength = 40;
  btn.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const value = input.value.trim().toUpperCase();
    if (save && value && value !== current) {
      commitSlotSubject(sheet, subjectCell, statusCell, value);
    } else {
      input.replaceWith(btn);
    }
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

function findSlotByCell(sheet, subjectCell) {
  const month = State.data.months.find((m) => m.sheet === sheet);
  if (!month) return null;
  for (const week of month.weeks) {
    for (const day of week.days) {
      for (const slot of day.slots) {
        if (slot.subjectCell === subjectCell) return { week, slot };
      }
    }
  }
  return null;
}

function adjustLanguageStats(week, subject, status, delta) {
  if (!subject || !status) return;
  const entry = week.stats.byLanguage[subject] || (week.stats.byLanguage[subject] = { done: 0, notDone: 0 });
  if (status === "DONE") {
    entry.done += delta;
    week.stats.done += delta;
  } else if (status === "NOT DONE") {
    entry.notDone += delta;
    week.stats.notDone += delta;
  }
}

async function commitSlotSubject(sheet, subjectCell, statusCell, newSubject) {
  const found = findSlotByCell(sheet, subjectCell);
  if (!found) return;
  const { week, slot } = found;

  adjustLanguageStats(week, slot.subject, slot.status, -1);
  const nextStatus = slot.status === "DONE" || slot.status === "NOT DONE" ? slot.status : "NOT DONE";
  slot.subject = newSubject;
  slot.status = nextStatus;
  adjustLanguageStats(week, newSubject, nextStatus, 1);

  if (!State.data.languages.includes(newSubject)) {
    State.data.languages.push(newSubject);
    State.data.languages.sort();
    if (window.Pomodoro) Pomodoro.populateSubjects(State.data.languages);
  }

  renderTimetable();
  renderHomeCards();

  const result = await GithubSync.setSlot({ sheet, subjectCell, statusCell, subject: newSubject, status: nextStatus });
  warnIfNotSynced(result);
}

function warnIfNotSynced(result) {
  if (result.ok || result.reason !== "not-configured") return;
  const status = document.getElementById("settings-status");
  if (status) {
    status.textContent = "Configure o GitHub em Ajustes para salvar essa mudança na planilha.";
    status.style.color = "#d9534f";
  }
}

function updateInMemoryStatus(sheet, statusCell, nextStatus) {
  const month = State.data.months.find((m) => m.sheet === sheet);
  if (!month) return;
  for (const week of month.weeks) {
    for (const day of week.days) {
      for (const slot of day.slots) {
        if (slot.statusCell === statusCell) {
          const wasDone = slot.status === "DONE";
          const nowDone = nextStatus === "DONE";
          if (wasDone !== nowDone) {
            week.stats.done += nowDone ? 1 : -1;
            week.stats.notDone += nowDone ? -1 : 1;
            const lang = week.stats.byLanguage[slot.subject];
            if (lang) {
              lang.done += nowDone ? 1 : -1;
              lang.notDone += nowDone ? -1 : 1;
            }
          }
          slot.status = nextStatus;
        }
      }
    }
  }
}

async function loadData() {
  const res = await fetch("data/study-plan.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load study-plan.json: ${res.status}`);
  return res.json();
}

async function loadBooksData() {
  const res = await fetch("data/books.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load books.json: ${res.status}`);
  return res.json();
}

async function init() {
  if (window.lucide) lucide.createIcons();
  setTodayDate();
  pickQuote();

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => showView(btn.dataset.view));
  });

  try {
    State.data = await loadData();
  } catch (err) {
    console.error(err);
    document.querySelector(".content").insertAdjacentHTML(
      "afterbegin",
      '<p class="muted">Não foi possível carregar data/study-plan.json. Rode scripts/xlsx_to_json.py.</p>'
    );
    return;
  }

  const defaults = findDefaultSelection(State.data);
  State.monthIdx = defaults.monthIdx;
  State.weekIdx = defaults.weekIdx;

  renderHomeCards();
  renderMonthSelect();
  renderWeekButtons();
  renderTimetable();

  if (window.Pomodoro) {
    Pomodoro.populateSubjects(State.data.languages);
  }

  if (window.Calendar) {
    Calendar.init(State.data.events || []);
  }

  if (window.Books) {
    try {
      const booksData = await loadBooksData();
      Books.init(booksData);
    } catch (err) {
      console.error(err);
      const el = document.getElementById("books-summary");
      if (el) el.innerHTML = '<p class="muted">Não foi possível carregar data/books.json. Rode scripts/books_to_json.py.</p>';
    }
  }

  if (window.lucide) lucide.createIcons();
}

window.SPApp = { showView, warnIfNotSynced };

document.addEventListener("DOMContentLoaded", init);
