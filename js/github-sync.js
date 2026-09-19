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
};
