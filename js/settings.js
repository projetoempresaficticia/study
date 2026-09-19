// Settings: GitHub repo + fine-grained PAT, stored only in this browser's
// localStorage. Never sent anywhere except the GitHub API, never committed.

const SETTINGS_KEYS = {
  repo: "sp_github_repo",
  token: "sp_github_token",
};

const DEFAULT_REPO = "projetoempresaficticia/study";

function buildTokenCreationUrl(repo) {
  const owner = (repo || DEFAULT_REPO).split("/")[0];
  const params = new URLSearchParams({
    name: "Study Planner Site",
    description: "Permite o site gravar status e sessões de pomodoro em STUDY PLAN 2026.xlsx",
    target_name: owner,
    contents: "write",
    expires_in: "366",
  });
  return `https://github.com/settings/personal-access-tokens/new?${params.toString()}`;
}

const Settings = {
  get() {
    return {
      repo: localStorage.getItem(SETTINGS_KEYS.repo) || "",
      token: localStorage.getItem(SETTINGS_KEYS.token) || "",
    };
  },
  set(repo, token) {
    localStorage.setItem(SETTINGS_KEYS.repo, repo.trim());
    localStorage.setItem(SETTINGS_KEYS.token, token.trim());
  },
  clear() {
    localStorage.removeItem(SETTINGS_KEYS.repo);
    localStorage.removeItem(SETTINGS_KEYS.token);
  },
  isConfigured() {
    const { repo, token } = this.get();
    return Boolean(repo && token);
  },
};

function initSettingsView() {
  const repoInput = document.getElementById("settings-repo");
  const tokenInput = document.getElementById("settings-token");
  const saveBtn = document.getElementById("settings-save");
  const clearBtn = document.getElementById("settings-clear");
  const status = document.getElementById("settings-status");
  const tokenLink = document.getElementById("settings-token-link");

  const current = Settings.get();
  repoInput.value = current.repo || DEFAULT_REPO;
  tokenInput.value = current.token;

  const refreshTokenLink = () => {
    if (tokenLink) tokenLink.href = buildTokenCreationUrl(repoInput.value);
  };
  refreshTokenLink();
  repoInput.addEventListener("input", refreshTokenLink);

  saveBtn.addEventListener("click", () => {
    if (!repoInput.value.includes("/")) {
      status.textContent = "Use o formato owner/repo.";
      status.style.color = "#d9534f";
      return;
    }
    Settings.set(repoInput.value, tokenInput.value);
    status.textContent = "Salvo neste navegador.";
    status.style.color = "";
    updateSyncIndicator();
  });

  clearBtn.addEventListener("click", () => {
    Settings.clear();
    repoInput.value = "";
    tokenInput.value = "";
    status.textContent = "Removido.";
    updateSyncIndicator();
  });
}

function updateSyncIndicator() {
  const indicator = document.getElementById("sync-indicator");
  const text = document.getElementById("sync-indicator-text");
  if (!indicator || !text) return;
  if (Settings.isConfigured()) {
    indicator.classList.add("connected");
    text.textContent = "sincronizado";
  } else {
    indicator.classList.remove("connected");
    text.textContent = "local";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initSettingsView();
  updateSyncIndicator();
});
