// Calendar: mini month view on the home cards, a full month page, and a
// day modal (view all events + delete + add) shared by both. Events sync
// to the "EVENTS" sheet in the spreadsheet via GithubSync, same pattern as
// the timetable toggles and pomodoro log.

const PASTEL_COLORS = [
  "#FFD1DC", // rosa
  "#FFDAC1", // pêssego
  "#FFF5BA", // amarelo
  "#C7F2D5", // verde
  "#C1FFF1", // menta
  "#C1E1FF", // azul
  "#E0C1FF", // lavanda
  "#F0C1FF", // lilás
];

const MAX_VISIBLE_EVENTS = 3;

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function capitalize(str) {
  return str.replace(/^\p{L}/u, (c) => c.toUpperCase());
}

const Calendar = {
  events: [],
  viewYear: null,
  viewMonth: null,
  selectedDate: null,

  init(events) {
    this.events = events || [];
    const today = new Date();
    this.viewYear = today.getFullYear();
    this.viewMonth = today.getMonth();

    document.getElementById("calendar-prev").addEventListener("click", () => this.shiftMonth(-1));
    document.getElementById("calendar-next").addEventListener("click", () => this.shiftMonth(1));
    document.getElementById("mini-calendar-open").addEventListener("click", () => {
      window.SPApp && window.SPApp.showView("calendar");
    });
    document.getElementById("day-modal-close").addEventListener("click", () => this.closeModal());
    document.getElementById("day-modal-overlay").addEventListener("click", (e) => {
      if (e.target.id === "day-modal-overlay") this.closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.closeModal();
    });
    document.getElementById("day-event-form").addEventListener("submit", (e) => {
      e.preventDefault();
      this.submitNewEvent();
    });

    this.renderColorSwatches();
    this.renderMiniCalendar();
    this.renderFullCalendar();
  },

  setEvents(events) {
    this.events = events || [];
    this.renderMiniCalendar();
    this.renderFullCalendar();
    if (this.selectedDate) this.renderDayEventList();
  },

  shiftMonth(delta) {
    this.viewMonth += delta;
    if (this.viewMonth < 0) {
      this.viewMonth = 11;
      this.viewYear -= 1;
    } else if (this.viewMonth > 11) {
      this.viewMonth = 0;
      this.viewYear += 1;
    }
    this.renderFullCalendar();
  },

  eventsByDate(dateStr) {
    return this.events.filter((e) => e.date === dateStr);
  },

  toDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  },

  // 6x7 grid of Date objects for the given month, Sunday-first, including
  // the leading/trailing days from adjacent months that fill the grid.
  buildMonthGrid(year, month) {
    const first = new Date(year, month, 1);
    const gridStart = new Date(year, month, 1 - first.getDay());
    const days = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      days.push(d);
    }
    return days;
  },

  renderColorSwatches() {
    const wrap = document.getElementById("color-swatches");
    wrap.innerHTML = "";
    PASTEL_COLORS.forEach((color, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "color-swatch";
      btn.style.background = color;
      btn.dataset.color = color;
      if (i === 0) btn.classList.add("selected");
      btn.addEventListener("click", () => {
        wrap.querySelectorAll(".color-swatch").forEach((s) => s.classList.remove("selected"));
        btn.classList.add("selected");
      });
      wrap.appendChild(btn);
    });
  },

  selectedColor() {
    const sel = document.querySelector("#color-swatches .color-swatch.selected");
    return sel ? sel.dataset.color : PASTEL_COLORS[0];
  },

  renderMiniCalendar() {
    const monthLabel = document.getElementById("mini-calendar-month");
    const head = document.getElementById("mini-calendar-head");
    const grid = document.getElementById("mini-calendar-grid");
    if (!head || !grid) return;

    const today = new Date();
    const todayStr = this.toDateStr(today);
    const fmt = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });
    if (monthLabel) monthLabel.textContent = capitalize(fmt.format(today));

    head.innerHTML = ["D", "S", "T", "Q", "Q", "S", "S"].map((w) => `<span>${w}</span>`).join("");

    const days = this.buildMonthGrid(today.getFullYear(), today.getMonth());
    grid.innerHTML = days
      .map((d) => {
        const dateStr = this.toDateStr(d);
        const classes = ["mini-day"];
        if (d.getMonth() !== today.getMonth()) classes.push("outside");
        if (dateStr === todayStr) classes.push("today");
        const dot = this.eventsByDate(dateStr).length > 0 ? '<span class="mini-day-dot"></span>' : "";
        return `<button type="button" class="${classes.join(" ")}" data-date="${dateStr}">${d.getDate()}${dot}</button>`;
      })
      .join("");

    grid.querySelectorAll(".mini-day").forEach((btn) => {
      btn.addEventListener("click", () => this.openModal(btn.dataset.date));
    });
  },

  renderFullCalendar() {
    const label = document.getElementById("calendar-month-label");
    const head = document.getElementById("calendar-grid-head");
    const grid = document.getElementById("calendar-grid");
    if (!label || !grid) return;

    const fmt = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });
    label.textContent = capitalize(fmt.format(new Date(this.viewYear, this.viewMonth, 1)));

    head.innerHTML = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((w) => `<span>${w}</span>`).join("");

    const today = new Date();
    const todayStr = this.toDateStr(today);
    const days = this.buildMonthGrid(this.viewYear, this.viewMonth);

    grid.innerHTML = days
      .map((d) => {
        const dateStr = this.toDateStr(d);
        const dayEvents = this.eventsByDate(dateStr);
        const visible = dayEvents.slice(0, MAX_VISIBLE_EVENTS);
        const extra = dayEvents.length - visible.length;

        const pills = visible
          .map((ev) => `<span class="event-pill" style="background:${ev.color || "#eee"}">${escapeHtml(ev.title)}</span>`)
          .join("");
        const moreLink = extra > 0 ? `<button type="button" class="event-more" data-date="${dateStr}">+ ver mais (${extra})</button>` : "";

        const classes = ["calendar-day"];
        if (d.getMonth() !== this.viewMonth) classes.push("outside");
        if (dateStr === todayStr) classes.push("today");

        return `
          <div class="${classes.join(" ")}" data-date="${dateStr}">
            <span class="calendar-day-num">${d.getDate()}</span>
            <div class="calendar-day-events">${pills}${moreLink}</div>
          </div>
        `;
      })
      .join("");

    grid.querySelectorAll(".calendar-day").forEach((cell) => {
      cell.addEventListener("click", (e) => {
        if (e.target.closest(".event-more")) return;
        this.openModal(cell.dataset.date);
      });
    });
    grid.querySelectorAll(".event-more").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.openModal(btn.dataset.date);
      });
    });
  },

  openModal(dateStr) {
    this.selectedDate = dateStr;
    const overlay = document.getElementById("day-modal-overlay");
    const [y, m, d] = dateStr.split("-").map(Number);
    const fmt = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    document.getElementById("day-modal-date").textContent = capitalize(fmt.format(new Date(Date.UTC(y, m - 1, d))));
    document.getElementById("day-event-title").value = "";
    document.getElementById("day-event-note").value = "";
    this.renderDayEventList();
    overlay.hidden = false;
    if (window.lucide) lucide.createIcons();
  },

  closeModal() {
    document.getElementById("day-modal-overlay").hidden = true;
    this.selectedDate = null;
  },

  renderDayEventList() {
    const list = document.getElementById("day-event-list");
    const dayEvents = this.eventsByDate(this.selectedDate);
    if (dayEvents.length === 0) {
      list.innerHTML = '<li class="slot-empty">Nenhum evento neste dia ainda.</li>';
      return;
    }
    list.innerHTML = dayEvents
      .map(
        (ev) => `
        <li class="day-event-item" style="background:${ev.color || "#eee"}">
          <div class="day-event-text">
            <span class="day-event-title">${escapeHtml(ev.title)}</span>
            ${ev.note ? `<span class="day-event-note">${escapeHtml(ev.note)}</span>` : ""}
          </div>
          <button type="button" class="day-event-delete" data-id="${ev.id}" aria-label="Remover evento"><i data-lucide="x"></i></button>
        </li>
      `
      )
      .join("");
    list.querySelectorAll(".day-event-delete").forEach((btn) => {
      btn.addEventListener("click", () => this.deleteEvent(btn.dataset.id));
    });
    if (window.lucide) lucide.createIcons();
  },

  async submitNewEvent() {
    const input = document.getElementById("day-event-title");
    const noteInput = document.getElementById("day-event-note");
    const title = input.value.trim();
    if (!title || !this.selectedDate) return;

    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const note = noteInput ? noteInput.value.trim() : "";
    const event = { id, date: this.selectedDate, title, color: this.selectedColor(), note };

    this.events.push(event);
    input.value = "";
    if (noteInput) noteInput.value = "";
    this.renderDayEventList();
    this.renderMiniCalendar();
    this.renderFullCalendar();

    const result = await GithubSync.addEvent(event);
    if (window.SPApp) window.SPApp.warnIfNotSynced(result);
  },

  async deleteEvent(id) {
    this.events = this.events.filter((e) => e.id !== id);
    this.renderDayEventList();
    this.renderMiniCalendar();
    this.renderFullCalendar();

    const result = await GithubSync.deleteEvent({ id });
    if (window.SPApp) window.SPApp.warnIfNotSynced(result);
  },
};

window.Calendar = Calendar;
