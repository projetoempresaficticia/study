// Sends repository_dispatch events to GitHub so the update-plan.yml Action
// can edit STUDY PLAN 2026.xlsx and regenerate data/study-plan.json.
// If no repo/token is configured, changes just stay local (in-memory) and a
// message explains why nothing was saved remotely.

const GithubSync = {
  async dispatch(eventType, clientPayload) {
    const { repo, token } = Settings.get();
    if (!repo || !token) {
      console.warn("GitHub sync not configured — change kept locally only.");
      return { ok: false, reason: "not-configured" };
    }

    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ event_type: eventType, client_payload: clientPayload }),
      });

      if (res.status === 204) {
        return { ok: true };
      }
      const body = await res.text();
      console.error("GitHub dispatch failed:", res.status, body);
      return { ok: false, reason: `http-${res.status}`, body };
    } catch (err) {
      console.error("GitHub dispatch error:", err);
      return { ok: false, reason: "network" };
    }
  },

  toggleSlot({ sheet, statusCell, currentStatus }) {
    const nextStatus = currentStatus === "DONE" ? "NOT DONE" : "DONE";
    return this.dispatch("toggle-slot", { sheet, statusCell, status: nextStatus });
  },

  setSlot({ sheet, subjectCell, statusCell, subject, status }) {
    return this.dispatch("set-slot", { sheet, subjectCell, statusCell, subject, status });
  },

  logPomodoroSession({ minutes, subject, note }) {
    return this.dispatch("log-session", {
      timestamp: new Date().toISOString(),
      minutes,
      subject: subject || "",
      note: note || "",
    });
  },

  addEvent({ id, date, title, color, note }) {
    return this.dispatch("add-event", { id, date, title, color: color || "", note: note || "" });
  },

  deleteEvent({ id }) {
    return this.dispatch("delete-event", { id });
  },

  addBook(book) {
    return this.dispatch("add-book", book);
  },

  updateBook({ row, fields }) {
    return this.dispatch("update-book", { row, fields });
  },

  // Manually-uploaded book covers commit straight to the repo via the
  // Contents API instead of a repository_dispatch — there's no xlsx/JSON to
  // update, just a static image file, so the Action pipeline is unnecessary.
  async uploadCoverImage(row, base64Content) {
    const { repo, token } = Settings.get();
    if (!repo || !token) {
      console.warn("GitHub sync not configured — cover kept locally only.");
      return { ok: false, reason: "not-configured" };
    }

    const path = `covers/book-${row}.jpg`;
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    };

    // The Contents API needs the current file's sha to overwrite it — this
    // is how "trocar capa" replaces an already-uploaded cover, not just a
    // first-time add. No existing file just means a plain create (no sha).
    let sha;
    try {
      const existing = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, { headers });
      if (existing.ok) {
        sha = (await existing.json()).sha;
      }
    } catch (err) {
      // Couldn't check — fall through and attempt a create; a real conflict
      // still surfaces as a clean error from the PUT below.
    }

    try {
      const body = { message: `chore: ${sha ? "update" : "add"} cover for book row ${row}`, content: base64Content };
      if (sha) body.sha = sha;
      const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(body),
      });
      if (res.status === 201 || res.status === 200) {
        return { ok: true };
      }
      const respBody = await res.text();
      console.error("Cover upload failed:", res.status, respBody);
      return { ok: false, reason: `http-${res.status}`, body: respBody };
    } catch (err) {
      console.error("Cover upload error:", err);
      return { ok: false, reason: "network" };
    }
  },
};

window.GithubSync = GithubSync;
