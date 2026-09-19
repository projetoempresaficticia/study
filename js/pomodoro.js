// Pomodoro timer: 30 min focus / 5 min break, looping until paused.
// Completed focus cycles are counted per day (localStorage) and, when a
// GitHub sync is configured, logged back into the spreadsheet's
// "POMODORO LOG" sheet via GithubSync.

const POMODORO = {
  FOCUS_SECONDS: 30 * 60,
  BREAK_SECONDS: 5 * 60,
};

function todayKey() {
  return `sp_pomodoro_cycles_${new Date().toISOString().slice(0, 10)}`;
}

function getCyclesToday() {
  return Number(localStorage.getItem(todayKey()) || "0");
}

function incrementCyclesToday() {
  const next = getCyclesToday() + 1;
  localStorage.setItem(todayKey(), String(next));
  return next;
}

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 660;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch (err) {
    // Audio not available — silently skip, the visual/timer state still updates.
  }
}

const Pomodoro = {
  phase: "focus", // 'focus' | 'break'
  remaining: POMODORO.FOCUS_SECONDS,
  running: false,
  intervalId: null,

  init() {
    this.subjectInput = document.getElementById("pomodoro-subject");
    this.subjectOptions = document.getElementById("pomodoro-subject-options");
    this.render();
    document.getElementById("pomodoro-start").addEventListener("click", () => this.start());
    document.getElementById("pomodoro-pause").addEventListener("click", () => this.pause());
    document.getElementById("pomodoro-reset").addEventListener("click", () => this.reset());
    document.getElementById("pomodoro-mini-start").addEventListener("click", () => {
      window.SPApp && window.SPApp.showView("pomodoro");
    });
  },

  populateSubjects(languages) {
    if (!this.subjectOptions) return;
    this.subjectOptions.innerHTML = "";
    languages.forEach((lang) => {
      const opt = document.createElement("option");
      opt.value = lang;
      this.subjectOptions.appendChild(opt);
    });
  },

  currentSubject() {
    return this.subjectInput ? this.subjectInput.value.trim() : "";
  },

  start() {
    if (this.running) return;
    this.running = true;
    document.getElementById("pomodoro-start").disabled = true;
    document.getElementById("pomodoro-pause").disabled = false;
    this.intervalId = setInterval(() => this.tick(), 1000);
  },

  pause() {
    this.running = false;
    clearInterval(this.intervalId);
    document.getElementById("pomodoro-start").disabled = false;
    document.getElementById("pomodoro-pause").disabled = true;
  },

  reset() {
    this.pause();
    this.phase = "focus";
    this.remaining = POMODORO.FOCUS_SECONDS;
    this.render();
  },

  tick() {
    this.remaining -= 1;
    if (this.remaining <= 0) {
      this.completePhase();
    }
    this.render();
  },

  completePhase() {
    playChime();
    if (this.phase === "focus") {
      const cycles = incrementCyclesToday();
      this.updateCycleCounters(cycles);
      const subject = this.currentSubject();
      if (window.GithubSync) {
        GithubSync.logPomodoroSession({ minutes: 30, subject, note: "ciclo de foco concluído" });
      }
      this.phase = "break";
      this.remaining = POMODORO.BREAK_SECONDS;
    } else {
      this.phase = "focus";
      this.remaining = POMODORO.FOCUS_SECONDS;
    }
  },

  updateCycleCounters(cycles) {
    const a = document.getElementById("pomodoro-cycles-today");
    const b = document.getElementById("pomodoro-cycles-today-2");
    if (a) a.textContent = String(cycles);
    if (b) b.textContent = String(cycles);
  },

  render() {
    const timeStr = formatTime(this.remaining);
    const miniTime = document.getElementById("pomodoro-mini-time");
    const miniPhase = document.getElementById("pomodoro-mini-phase");
    const fullTime = document.getElementById("pomodoro-time");
    const badge = document.getElementById("pomodoro-phase-badge");

    if (miniTime) miniTime.textContent = timeStr;
    if (fullTime) fullTime.textContent = timeStr;

    const isFocus = this.phase === "focus";
    if (miniPhase) miniPhase.textContent = isFocus ? (this.running ? "focando" : "pronto pra focar") : "descansando";
    if (badge) {
      badge.textContent = isFocus ? "Foco" : "Descanso";
      badge.classList.toggle("break", !isFocus);
    }
    this.updateCycleCounters(getCyclesToday());
  },
};

window.Pomodoro = Pomodoro;

document.addEventListener("DOMContentLoaded", () => {
  Pomodoro.init();
});
