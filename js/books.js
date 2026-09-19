// Books: home summary card + a full "Livros" page reading the BOOKS sheet
// from Books.xlsx (data/books.json). Adding a book and editing status /
// rating / notes on an existing one sync through GithubSync, same pipeline
// as the timetable and calendar.

const STATUS_LABELS = {
  "Want to Read": "Quero ler",
  Reading: "Lendo",
  Finished: "Concluído",
};

const STATUS_ORDER = ["Reading", "Want to Read", "Finished"];

function statusPriority(status) {
  const idx = STATUS_ORDER.indexOf(status);
  return idx === -1 ? STATUS_ORDER.length : idx;
}

function starRatingHtml(row, rating) {
  const value = typeof rating === "number" ? rating : 0;
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  const buttons = [];
  for (let i = 1; i <= 10; i++) {
    buttons.push(`<button type="button" class="star-btn" data-row="${row}" data-value="${i / 2}"></button>`);
  }
  return `
    <div class="star-rating" data-row="${row}" data-rating="${value}">
      <div class="star-rating-display">
        <span class="star-track">★★★★★</span>
        <span class="star-fill" style="width:${pct}%">★★★★★</span>
      </div>
      <div class="star-rating-hit">${buttons.join("")}</div>
    </div>
  `;
}

const Books = {
  data: null,
  filterStatus: "all",
  filterQuery: "",

  init(data) {
    this.data = data;
    this.renderHomeSummary();
    this.populateFormOptions();
    this.renderStatusTabs();
    this.renderList();
    this.updateStatsLine();

    document.getElementById("books-open").addEventListener("click", () => {
      window.SPApp && window.SPApp.showView("books");
    });
    document.getElementById("books-add-open").addEventListener("click", () => this.openAddModal());
    document.getElementById("book-modal-close").addEventListener("click", () => this.closeAddModal());
    document.getElementById("book-modal-overlay").addEventListener("click", (e) => {
      if (e.target.id === "book-modal-overlay") this.closeAddModal();
    });
    document.getElementById("book-form").addEventListener("submit", (e) => {
      e.preventDefault();
      this.submitNewBook();
    });
    document.getElementById("books-search").addEventListener("input", (e) => {
      this.filterQuery = e.target.value.trim().toLowerCase();
      this.renderList();
    });

    const list = document.getElementById("books-list");
    list.addEventListener("click", (e) => {
      const starBtn = e.target.closest(".star-btn");
      if (starBtn) {
        this.setRating(Number(starBtn.dataset.row), Number(starBtn.dataset.value));
        return;
      }
      const notesBtn = e.target.closest(".book-notes-btn");
      if (notesBtn) {
        this.startEditingNotes(notesBtn);
      }
    });
    list.addEventListener("change", (e) => {
      if (e.target.classList.contains("book-status-select")) {
        this.setStatus(Number(e.target.dataset.row), e.target.value);
      }
    });
  },

  sortedFilteredBooks() {
    let books = this.data.books;
    if (this.filterStatus !== "all") {
      books = books.filter((b) => b.status === this.filterStatus);
    }
    if (this.filterQuery) {
      books = books.filter((b) => {
        const haystack = `${b.title || ""} ${b.author || ""}`.toLowerCase();
        return haystack.includes(this.filterQuery);
      });
    }
    return [...books].sort((a, b) => {
      const pa = statusPriority(a.status);
      const pb = statusPriority(b.status);
      if (pa !== pb) return pa - pb;
      return b.row - a.row;
    });
  },

  renderHomeSummary() {
    const el = document.getElementById("books-summary");
    if (!el) return;
    const { stats } = this.data;
    const reading = this.data.books.filter((b) => b.status === "Reading");
    const readingLine =
      reading.length > 0
        ? `<p class="books-reading-line">Lendo agora: ${reading.map((b) => escapeHtmlBooks(b.title)).slice(0, 2).join(", ")}${reading.length > 2 ? "…" : ""}</p>`
        : '<p class="books-reading-line muted">Nada em andamento agora.</p>';
    el.innerHTML = `
      <div class="books-stat-row">
        <div><strong>${stats.total}</strong><span>livros</span></div>
        <div><strong>${stats.finished}</strong><span>lidos</span></div>
        <div><strong>${stats.avgRating ?? "—"}</strong><span>média</span></div>
      </div>
      ${readingLine}
    `;
  },

  updateStatsLine() {
    const el = document.getElementById("books-stats-line");
    if (!el) return;
    const { stats } = this.data;
    el.textContent = `${stats.total} livros · ${stats.finished} concluídos · nota média ${stats.avgRating ?? "—"} · ${stats.totalPages.toLocaleString("pt-BR")} páginas lidas`;
  },

  renderStatusTabs() {
    const wrap = document.getElementById("books-status-tabs");
    const tabs = [{ value: "all", label: "Todos" }, ...STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABELS[s] }))];
    wrap.innerHTML = tabs
      .map((t) => `<button type="button" class="status-tab ${t.value === this.filterStatus ? "active" : ""}" data-status="${t.value}">${t.label}</button>`)
      .join("");
    wrap.querySelectorAll(".status-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.filterStatus = btn.dataset.status;
        this.renderStatusTabs();
        this.renderList();
      });
    });
  },

  renderList() {
    const list = document.getElementById("books-list");
    const books = this.sortedFilteredBooks();
    if (books.length === 0) {
      list.innerHTML = '<p class="slot-empty">Nenhum livro encontrado.</p>';
      return;
    }
    list.innerHTML = books.map((b) => this.bookItemHtml(b)).join("");
    if (window.lucide) lucide.createIcons();
  },

  bookItemHtml(b) {
    const metaParts = [b.author, b.genre, b.format, b.pages ? `${b.pages} págs.` : null].filter(Boolean);
    const statusOptions = STATUS_ORDER.map(
      (s) => `<option value="${s}" ${s === b.status ? "selected" : ""}>${STATUS_LABELS[s]}</option>`
    ).join("");
    return `
      <article class="book-item">
        <div class="book-item-main">
          <h4 class="book-title">${escapeHtmlBooks(b.title)}</h4>
          ${metaParts.length ? `<p class="book-meta">${metaParts.map(escapeHtmlBooks).join(" · ")}</p>` : ""}
          ${starRatingHtml(b.row, b.rating)}
          <button type="button" class="book-notes-btn" data-row="${b.row}" data-current="${escapeHtmlBooks(b.notes || "")}">
            ${b.notes ? escapeHtmlBooks(b.notes) : '<span class="muted">+ adicionar nota</span>'}
          </button>
        </div>
        <select class="book-status-select" data-row="${b.row}">${statusOptions}</select>
      </article>
    `;
  },

  findBook(row) {
    return this.data.books.find((b) => b.row === row);
  },

  async setRating(row, value) {
    const book = this.findBook(row);
    if (!book) return;
    book.rating = value;
    this.renderList();
    this.renderHomeSummary();
    const result = await GithubSync.updateBook({ row, fields: { rating: value } });
    if (window.SPApp) window.SPApp.warnIfNotSynced(result);
  },

  async setStatus(row, status) {
    const book = this.findBook(row);
    if (!book) return;
    book.status = status;
    const fields = { status };
    if (status === "Finished" && !book.dateFinished) {
      const today = new Date().toISOString().slice(0, 10);
      book.dateFinished = today;
      fields.dateFinished = today;
    }
    this.renderList();
    this.renderHomeSummary();
    const result = await GithubSync.updateBook({ row, fields });
    if (window.SPApp) window.SPApp.warnIfNotSynced(result);
  },

  startEditingNotes(btn) {
    const row = Number(btn.dataset.row);
    const current = btn.dataset.current || "";
    const input = document.createElement("textarea");
    input.className = "book-notes-input";
    input.value = current;
    input.rows = 2;
    input.maxLength = 500;
    btn.replaceWith(input);
    input.focus();

    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      if (save && value !== current) {
        this.setNotes(row, value);
      } else {
        this.renderList();
      }
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") finish(false);
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) finish(true);
    });
    input.addEventListener("blur", () => finish(true));
  },

  async setNotes(row, notes) {
    const book = this.findBook(row);
    if (!book) return;
    book.notes = notes;
    this.renderList();
    const result = await GithubSync.updateBook({ row, fields: { notes } });
    if (window.SPApp) window.SPApp.warnIfNotSynced(result);
  },

  populateFormOptions() {
    const genreList = document.getElementById("book-genre-options");
    genreList.innerHTML = this.data.genres.map((g) => `<option value="${g}"></option>`).join("");

    const formatSelect = document.getElementById("book-format");
    formatSelect.innerHTML = this.data.formats.map((f) => `<option value="${f}">${f}</option>`).join("");

    const statusSelect = document.getElementById("book-status");
    statusSelect.innerHTML = STATUS_ORDER.map((s) => `<option value="${s}">${STATUS_LABELS[s]}</option>`).join("");
  },

  openAddModal() {
    document.getElementById("book-form").reset();
    document.getElementById("book-modal-overlay").hidden = false;
    document.getElementById("book-title").focus();
  },

  closeAddModal() {
    document.getElementById("book-modal-overlay").hidden = true;
  },

  async submitNewBook() {
    const title = document.getElementById("book-title").value.trim();
    if (!title) return;
    const author = document.getElementById("book-author").value.trim();
    const genre = document.getElementById("book-genre").value.trim();
    const format = document.getElementById("book-format").value;
    const status = document.getElementById("book-status").value;
    const pagesRaw = document.getElementById("book-pages").value;
    const pages = pagesRaw ? Number(pagesRaw) : null;
    const notes = document.getElementById("book-notes").value.trim();

    const row = this.data.nextRow;
    const book = { row, title, author, genre, status, format, rating: null, pages, dateFinished: null, notes };

    this.data.books.push(book);
    this.data.nextRow += 1;
    this.data.stats.total += 1;
    if (status === "Finished") this.data.stats.finished += 1;
    if (pages) this.data.stats.totalPages += pages;
    if (genre && !this.data.genres.includes(genre)) {
      this.data.genres.push(genre);
      this.data.genres.sort();
    }

    this.closeAddModal();
    this.renderHomeSummary();
    this.updateStatsLine();
    this.renderList();
    this.populateFormOptions();

    const result = await GithubSync.addBook(book);
    if (window.SPApp) window.SPApp.warnIfNotSynced(result);
  },
};

function escapeHtmlBooks(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

window.Books = Books;
