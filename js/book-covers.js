// Book cover lookup: Google Books first (better coverage of Brazilian
// Portuguese editions, but unauthenticated quota can be flaky), falling
// back to Open Library (reliable, CORS-open, no key — but weak matches on
// translated titles). Both run entirely client-side, no server needed.
// Results (including "not found") are cached in localStorage so a repeat
// visit, or scrolling past the same book twice, never re-queries.

const CoverCache = {
  KEY: "sp_book_covers_v1",
  data: null,

  load() {
    if (this.data) return this.data;
    try {
      this.data = JSON.parse(localStorage.getItem(this.KEY) || "{}");
    } catch (err) {
      this.data = {};
    }
    return this.data;
  },

  save() {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(this.data));
    } catch (err) {
      // localStorage full or unavailable — cover lookups just won't persist.
    }
  },

  cacheKey(title, author) {
    return `${(title || "").trim().toLowerCase()}|${(author || "").trim().toLowerCase()}`;
  },

  // undefined = never looked up · null = looked up, no cover found · string = url
  get(title, author) {
    return this.load()[this.cacheKey(title, author)];
  },

  set(title, author, value) {
    const d = this.load();
    d[this.cacheKey(title, author)] = value;
    this.save();
  },
};

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGoogleCover(title, author) {
  const q = `intitle:${title}${author ? ` inauthor:${author}` : ""}`;
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=1`;
  const res = await fetchWithTimeout(url, 4000);
  if (!res.ok) return null;
  const data = await res.json();
  const link = data.items && data.items[0] && data.items[0].volumeInfo && data.items[0].volumeInfo.imageLinks
    ? data.items[0].volumeInfo.imageLinks.thumbnail
    : null;
  return link ? link.replace(/^http:/, "https:") : null;
}

async function fetchOpenLibraryCover(title, author) {
  const q = `${title} ${author || ""}`.trim();
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=1&fields=cover_i`;
  const res = await fetchWithTimeout(url, 4000);
  if (!res.ok) return null;
  const data = await res.json();
  const coverId = data.docs && data.docs[0] ? data.docs[0].cover_i : null;
  return coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : null;
}

async function resolveCoverUrl(title, author) {
  const cached = CoverCache.get(title, author);
  if (cached !== undefined) return cached;

  let url = null;
  try {
    url = await fetchGoogleCover(title, author);
  } catch (err) {
    // network error, timeout, or rate limit — fall through to Open Library.
  }
  if (!url) {
    try {
      url = await fetchOpenLibraryCover(title, author);
    } catch (err) {
      // both sources failed — cache the miss so we don't retry every render.
    }
  }
  CoverCache.set(title, author, url);
  return url;
}

function manualCoverPath(row) {
  return `covers/book-${row}.jpg`;
}

function imageExists(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

function setCoverImage(el, src) {
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  img.loading = "lazy";
  img.className = "book-cover-img";
  el.innerHTML = "";
  el.appendChild(img);
}

function showUploadButton(el, row, title) {
  const initial = (title || "?").trim().charAt(0).toUpperCase();
  el.innerHTML = `
    <span class="book-cover-fallback">${initial}</span>
    <label class="book-cover-upload" title="Adicionar capa">
      <i data-lucide="plus"></i>
      <input type="file" accept="image/*" class="book-cover-upload-input" data-row="${row}" hidden />
    </label>
  `;
  if (window.lucide) lucide.createIcons();
}

// Watches .book-cover[data-pending] placeholders and resolves their cover
// only once scrolled near the viewport, so a 199-book list doesn't fire
// 199 lookups on load. Checks for a manually-uploaded cover first
// (covers/book-<row>.jpg, committed straight to the repo — see
// GithubSync.uploadCoverImage), then Google Books / Open Library, and
// finally offers the "+" upload button when nothing is found anywhere.
const CoverObserver = {
  observer: null,

  ensure() {
    if (this.observer) return this.observer;
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          this.observer.unobserve(entry.target);
          this.resolve(entry.target);
        });
      },
      { rootMargin: "200px" }
    );
    return this.observer;
  },

  observeAll(root) {
    const obs = this.ensure();
    root.querySelectorAll(".book-cover[data-pending]").forEach((el) => obs.observe(el));
  },

  async resolve(el) {
    const title = el.dataset.title || "";
    const author = el.dataset.author || "";
    const row = el.dataset.row;
    delete el.dataset.pending;

    const manualPath = manualCoverPath(row);
    if (await imageExists(manualPath)) {
      setCoverImage(el, manualPath);
      return;
    }

    const url = await resolveCoverUrl(title, author);
    if (url) {
      setCoverImage(el, url);
      return;
    }

    showUploadButton(el, row, title);
  },
};

window.CoverObserver = CoverObserver;

async function resizeImageToDataUrl(file, maxDim, quality) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = dataUrl;
  });
  let { width, height } = img;
  if (width > height && width > maxDim) {
    height = Math.round((height * maxDim) / width);
    width = maxDim;
  } else if (height > maxDim) {
    width = Math.round((width * maxDim) / height);
    height = maxDim;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

async function handleCoverUpload(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const row = input.dataset.row;
  const wrap = input.closest(".book-cover");

  const dataUrl = await resizeImageToDataUrl(file, 640, 0.82);
  if (wrap) setCoverImage(wrap, dataUrl);

  const base64 = dataUrl.split(",")[1];
  const result = await GithubSync.uploadCoverImage(row, base64);
  if (window.SPApp) window.SPApp.warnIfNotSynced(result);
}

document.addEventListener("change", (e) => {
  if (e.target.classList && e.target.classList.contains("book-cover-upload-input")) {
    handleCoverUpload(e.target);
  }
});
