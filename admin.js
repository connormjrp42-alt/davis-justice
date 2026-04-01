const adminStatus = document.getElementById("admin-status");
const adminMessage = document.getElementById("admin-message");
const settingsForm = document.getElementById("settings-form");
const reloadButton = document.getElementById("reload-settings");
const announcementEnabled = document.getElementById("announcement-enabled");
const announcementTitle = document.getElementById("announcement-title");
const announcementText = document.getElementById("announcement-text");

const leadersStatus = document.getElementById("leaders-status");
const leadersForm = document.getElementById("leaders-form");
const leadersMessage = document.getElementById("leaders-message");
const leadersList = document.getElementById("leaders-list");
const leaderDiscordIdInput = document.getElementById("leader-discord-id");
const grantLeaderButton = document.getElementById("grant-leader");
const revokeLeaderButton = document.getElementById("revoke-leader");
const refreshLeadersButton = document.getElementById("refresh-leaders");

if (settingsForm) {
  settingsForm.addEventListener("submit", onSaveSettings);
}

if (reloadButton) {
  reloadButton.addEventListener("click", loadAdminSettings);
}

if (grantLeaderButton) {
  grantLeaderButton.addEventListener("click", () => updateLeaderAccess("grant"));
}

if (revokeLeaderButton) {
  revokeLeaderButton.addEventListener("click", () => updateLeaderAccess("revoke"));
}

if (refreshLeadersButton) {
  refreshLeadersButton.addEventListener("click", loadLeaders);
}

loadAdminPanel();

async function loadAdminPanel() {
  setMessage("");
  setLeadersMessage("");
  setStatus("Проверка доступа...");

  const access = await verifyAdminAccess();
  if (!access) {
    toggleForm(false);
    toggleLeadersForm(false);
    return;
  }

  setStatus("Доступ подтвержден. Можно редактировать настройки.", false, true);
  toggleForm(true);
  toggleLeadersForm(true);

  await Promise.all([loadAdminSettings(), loadLeaders()]);
}

async function verifyAdminAccess() {
  try {
    const response = await fetch("/api/admin/status", {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    });

    if (response.status === 401) {
      setStatus("Требуется вход через Discord.", true);
      setLeadersStatus("Требуется вход через Discord.", true);
      return false;
    }

    if (response.status === 403) {
      setStatus("Доступ запрещен. Вы не являетесь администратором.", true);
      setLeadersStatus("Недостаточно прав.", true);
      return false;
    }

    if (!response.ok) {
      throw new Error(`Status ${response.status}`);
    }

    return true;
  } catch (error) {
    console.error("Admin access check error:", error);
    setStatus("Не удалось проверить доступ.", true);
    setLeadersStatus("Не удалось проверить доступ.", true);
    return false;
  }
}

async function loadAdminSettings() {
  try {
    const response = await fetch("/api/admin/settings", {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Status ${response.status}`);
    }

    const payload = await response.json();
    const announcement = payload.announcement || {};

    announcementEnabled.checked = Boolean(announcement.enabled);
    announcementTitle.value = announcement.title || "";
    announcementText.value = announcement.text || "";
  } catch (error) {
    console.error("Load admin settings error:", error);
    setMessage("Не удалось загрузить настройки.", true);
  }
}

async function onSaveSettings(event) {
  event.preventDefault();
  setMessage("Сохранение...");

  const payload = {
    announcement: {
      enabled: announcementEnabled.checked,
      title: announcementTitle.value.trim(),
      text: announcementText.value.trim(),
    },
  };

  try {
    const response = await fetch("/api/admin/settings", {
      method: "PUT",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const failPayload = await safeJson(response);
      const reason = failPayload && failPayload.error ? failPayload.error : "Ошибка сохранения";
      setMessage(reason, true);
      return;
    }

    const result = await response.json();
    const saved = result.settings && result.settings.announcement ? result.settings.announcement : {};
    announcementEnabled.checked = Boolean(saved.enabled);
    announcementTitle.value = saved.title || "";
    announcementText.value = saved.text || "";

    setMessage("Настройки сохранены.", false, true);
  } catch (error) {
    console.error("Save admin settings error:", error);
    setMessage("Сохранение не удалось. Попробуйте снова.", true);
  }
}

async function loadLeaders() {
  setLeadersMessage("");
  setLeadersStatus("Загрузка списка Leader...");

  try {
    const response = await fetch("/api/admin/leaders", {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const payload = await safeJson(response);
      const reason = payload && payload.error ? payload.error : "Ошибка загрузки";
      setLeadersStatus(reason, true);
      return;
    }

    const payload = await response.json();
    renderLeaders(payload.leaders || []);
    setLeadersStatus("Список Leader загружен.", false, true);
  } catch (error) {
    console.error("Load leaders error:", error);
    setLeadersStatus("Не удалось загрузить список Leader.", true);
  }
}

async function updateLeaderAccess(action) {
  const discordId = String(leaderDiscordIdInput.value || "").trim();
  if (!/^\d{8,30}$/.test(discordId)) {
    setLeadersMessage("Введите корректный Discord ID.", true);
    return;
  }

  setLeadersMessage(action === "grant" ? "Выдача доступа..." : "Снятие доступа...");

  try {
    const response = await fetch("/api/admin/leaders", {
      method: "PUT",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        discordId,
        action,
      }),
    });

    const payload = await safeJson(response);
    if (!response.ok) {
      const reason = payload && payload.error ? payload.error : "Ошибка обновления";
      setLeadersMessage(reason, true);
      return;
    }

    renderLeaders(payload.leaders || []);
    setLeadersMessage(
      action === "grant" ? "Доступ Leader выдан." : "Доступ Leader снят.",
      false,
      true
    );
    setLeadersStatus("Список Leader обновлён.", false, true);
  } catch (error) {
    console.error("Update leader access error:", error);
    setLeadersMessage("Не удалось обновить доступ Leader.", true);
  }
}

function renderLeaders(leaders) {
  if (!leadersList) return;
  leadersList.innerHTML = "";

  if (!leaders.length) {
    const empty = document.createElement("p");
    empty.className = "admin-status";
    empty.textContent = "Пока нет участников с доступом Leader.";
    leadersList.appendChild(empty);
    return;
  }

  leaders.forEach((leaderId) => {
    const pill = document.createElement("span");
    pill.className = "leader-pill";
    pill.textContent = leaderId;
    leadersList.appendChild(pill);
  });
}

function setStatus(text, isError = false, isOk = false) {
  if (!adminStatus) return;
  adminStatus.textContent = text;
  adminStatus.classList.remove("error", "ok");
  if (isError) adminStatus.classList.add("error");
  if (isOk) adminStatus.classList.add("ok");
}

function setLeadersStatus(text, isError = false, isOk = false) {
  if (!leadersStatus) return;
  leadersStatus.textContent = text;
  leadersStatus.classList.remove("error", "ok");
  if (isError) leadersStatus.classList.add("error");
  if (isOk) leadersStatus.classList.add("ok");
}

function setMessage(text, isError = false, isOk = false) {
  if (!adminMessage) return;
  adminMessage.textContent = text;
  adminMessage.classList.remove("error", "ok");
  if (isError) adminMessage.classList.add("error");
  if (isOk) adminMessage.classList.add("ok");
}

function setLeadersMessage(text, isError = false, isOk = false) {
  if (!leadersMessage) return;
  leadersMessage.textContent = text;
  leadersMessage.classList.remove("error", "ok");
  if (isError) leadersMessage.classList.add("error");
  if (isOk) leadersMessage.classList.add("ok");
}

function toggleForm(visible) {
  if (!settingsForm) return;
  settingsForm.hidden = !visible;
}

function toggleLeadersForm(visible) {
  if (!leadersForm) return;
  leadersForm.hidden = !visible;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
