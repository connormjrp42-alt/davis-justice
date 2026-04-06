const adminStatus = document.getElementById("admin-status");
const adminMessage = document.getElementById("admin-message");
const settingsForm = document.getElementById("settings-form");
const reloadButton = document.getElementById("reload-settings");
const announcementEnabled = document.getElementById("announcement-enabled");
const announcementTitle = document.getElementById("announcement-title");
const announcementText = document.getElementById("announcement-text");
const consultantEnabled = document.getElementById("consultant-enabled");
const consultantServerSelect = document.getElementById("consultant-server-select");
const consultantFilesInput = document.getElementById("consultant-files-input");
const consultantUploadButton = document.getElementById("consultant-upload");
const consultantUploadMessage = document.getElementById("consultant-upload-message");
const consultantFilesList = document.getElementById("consultant-files-list");
const documentTemplateTitleInput = document.getElementById("document-template-title");
const documentTemplateDescriptionInput = document.getElementById("document-template-description");
const documentTemplateKindSelect = document.getElementById("document-template-kind");
const documentTemplateFileInput = document.getElementById("document-template-file");
const documentTemplateUploadButton = document.getElementById("document-template-upload");
const documentTemplateUploadMessage = document.getElementById("document-template-upload-message");
const documentTemplateList = document.getElementById("document-template-list");

const leadersStatus = document.getElementById("leaders-status");
const leadersForm = document.getElementById("leaders-form");
const leadersMessage = document.getElementById("leaders-message");
const leadersList = document.getElementById("leaders-list");
const leaderDiscordIdInput = document.getElementById("leader-discord-id");
const grantLeaderButton = document.getElementById("grant-leader");
const revokeLeaderButton = document.getElementById("revoke-leader");
const refreshLeadersButton = document.getElementById("refresh-leaders");

let consultantServers = [];
let documentFlowTemplates = [];

if (settingsForm) {
  settingsForm.addEventListener("submit", onSaveSettings);
}

if (reloadButton) {
  reloadButton.addEventListener("click", loadAdminSettings);
}

if (consultantServerSelect) {
  consultantServerSelect.addEventListener("change", renderSelectedServerFiles);
}

if (consultantUploadButton) {
  consultantUploadButton.addEventListener("click", onUploadConsultantFiles);
}

if (documentTemplateUploadButton) {
  documentTemplateUploadButton.addEventListener("click", onUploadDocumentTemplate);
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
  setConsultantUploadMessage("");
  setDocumentTemplateUploadMessage("");
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
    const consultant = payload.consultant || {};
    const documentFlow = payload.documentFlow || {};

    announcementEnabled.checked = Boolean(announcement.enabled);
    announcementTitle.value = announcement.title || "";
    announcementText.value = announcement.text || "";
    consultantEnabled.checked = Boolean(consultant.enabled);

    consultantServers = Array.isArray(consultant.servers) ? consultant.servers : [];
    populateConsultantServers(consultantServers);
    renderSelectedServerFiles();

    documentFlowTemplates = Array.isArray(documentFlow.templates) ? documentFlow.templates : [];
    renderDocumentTemplateList();
    setConsultantUploadMessage("");
    setDocumentTemplateUploadMessage("");
  } catch (error) {
    console.error("Load admin settings error:", error);
    setMessage("Не удалось загрузить настройки.", true);
  }
}

function populateConsultantServers(servers) {
  if (!consultantServerSelect) return;
  const currentSelected = String(consultantServerSelect.value || "").trim();
  consultantServerSelect.innerHTML = "";

  servers.forEach((server) => {
    const option = document.createElement("option");
    option.value = String(server.id || "").trim();
    option.textContent = String(server.name || option.value || "Server");
    consultantServerSelect.appendChild(option);
  });

  if (!servers.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Список серверов недоступен";
    consultantServerSelect.appendChild(option);
    consultantServerSelect.value = "";
    return;
  }

  const canRestore = servers.some((server) => String(server.id || "") === currentSelected);
  consultantServerSelect.value = canRestore ? currentSelected : String(servers[0].id || "");
}

function renderSelectedServerFiles() {
  if (!consultantFilesList) return;
  consultantFilesList.innerHTML = "";
  setConsultantUploadMessage("");

  const serverId = String(consultantServerSelect?.value || "").trim();
  const selected = consultantServers.find((server) => String(server.id || "") === serverId);
  const files = Array.isArray(selected?.files) ? selected.files : [];

  if (!selected) {
    const empty = document.createElement("p");
    empty.className = "admin-status";
    empty.textContent = "Выберите сервер.";
    consultantFilesList.appendChild(empty);
    return;
  }

  if (!files.length) {
    const empty = document.createElement("p");
    empty.className = "admin-status";
    empty.textContent = "Для этого сервера пока нет загруженных файлов.";
    consultantFilesList.appendChild(empty);
    return;
  }

  files.forEach((file) => {
    const pill = document.createElement("span");
    pill.className = "leader-pill";
    const sizeKb = Math.max(1, Math.round(Number(file.size || 0) / 1024));
    pill.textContent = `${file.name || "file"} (${sizeKb} KB)`;
    consultantFilesList.appendChild(pill);
  });
}

async function onUploadConsultantFiles() {
  const serverId = String(consultantServerSelect?.value || "").trim();
  if (!serverId) {
    setConsultantUploadMessage("Сначала выберите сервер Majestic.", true);
    return;
  }

  const files = Array.from(consultantFilesInput?.files || []);
  if (!files.length) {
    setConsultantUploadMessage("Выберите минимум один файл для загрузки.", true);
    return;
  }

  setConsultantUploadBusy(true);
  setConsultantUploadMessage("Загрузка и обработка файлов...");

  try {
    const formData = new FormData();
    formData.append("serverId", serverId);
    files.forEach((file) => formData.append("lawsFiles", file, file.name));

    const response = await fetch("/api/admin/consultant/upload", {
      method: "POST",
      credentials: "include",
      body: formData,
    });

    const payload = await safeJson(response);
    if (!response.ok) {
      const reason = payload && payload.error ? payload.error : "Ошибка загрузки";
      const details = payload && payload.details ? ` ${payload.details}` : "";
      setConsultantUploadMessage(`${reason}.${details}`.trim(), true);
      return;
    }

    const nextServers =
      payload && payload.settings && payload.settings.consultant
        ? payload.settings.consultant.servers
        : [];
    consultantServers = Array.isArray(nextServers) ? nextServers : consultantServers;
    populateConsultantServers(consultantServers);
    consultantServerSelect.value = serverId;
    renderSelectedServerFiles();

    if (consultantFilesInput) {
      consultantFilesInput.value = "";
    }
    const uploadedCount = Number(payload?.uploadedCount || files.length);
    setConsultantUploadMessage(`Файлы загружены: ${uploadedCount}.`, false, true);
  } catch (error) {
    console.error("Consultant upload error:", error);
    setConsultantUploadMessage("Не удалось загрузить файлы. Попробуйте снова.", true);
  } finally {
    setConsultantUploadBusy(false);
  }
}

function renderDocumentTemplateList() {
  if (!documentTemplateList) return;
  documentTemplateList.innerHTML = "";

  if (!documentFlowTemplates.length) {
    const empty = document.createElement("p");
    empty.className = "admin-status";
    empty.textContent = "Шаблоны пока не загружены.";
    documentTemplateList.appendChild(empty);
    return;
  }

  documentFlowTemplates.forEach((template) => {
    const item = document.createElement("a");
    item.className = "leader-pill";
    item.href = template.downloadUrl || "#";
    item.target = "_blank";
    item.rel = "noopener noreferrer";

    const sizeKb = Math.max(1, Math.round(Number(template.size || 0) / 1024));
    const kindMap = {
      criminal_case: "Используется: возбуждение дела",
      appeal_acceptance: "Используется: принятие обращения",
      none: "Только скачивание",
    };
    const kindLabel = kindMap[String(template.templateKind || "none")] || "Только скачивание";
    item.textContent = `${template.title || template.name || "Шаблон"} (${sizeKb} KB, ${kindLabel})`;
    documentTemplateList.appendChild(item);
  });
}

async function onUploadDocumentTemplate() {
  const file = documentTemplateFileInput?.files?.[0] || null;
  if (!file) {
    setDocumentTemplateUploadMessage("Выберите файл шаблона.", true);
    return;
  }

  const title = String(documentTemplateTitleInput?.value || "")
    .replace(/\s+/g, " ")
    .trim();
  const description = String(documentTemplateDescriptionInput?.value || "")
    .replace(/\s+/g, " ")
    .trim();
  const templateKind = String(documentTemplateKindSelect?.value || "none")
    .trim()
    .toLowerCase();

  setDocumentTemplateUploadBusy(true);
  setDocumentTemplateUploadMessage("Загружаем шаблон...");

  try {
    const formData = new FormData();
    formData.append("templateFile", file, file.name);
    if (title) {
      formData.append("title", title);
    }
    if (description) {
      formData.append("description", description);
    }
    formData.append("templateKind", templateKind);

    const response = await fetch("/api/admin/document-flow/templates/upload", {
      method: "POST",
      credentials: "include",
      body: formData,
    });

    const payload = await safeJson(response);
    if (!response.ok) {
      const reason = payload && payload.error ? payload.error : "Ошибка загрузки";
      const details = payload && payload.details ? ` ${payload.details}` : "";
      setDocumentTemplateUploadMessage(`${reason}.${details}`.trim(), true);
      return;
    }

    const nextTemplates =
      payload && payload.settings && payload.settings.documentFlow
        ? payload.settings.documentFlow.templates
        : [];
    documentFlowTemplates = Array.isArray(nextTemplates) ? nextTemplates : documentFlowTemplates;
    renderDocumentTemplateList();

    if (documentTemplateFileInput) {
      documentTemplateFileInput.value = "";
    }
    if (documentTemplateTitleInput) {
      documentTemplateTitleInput.value = "";
    }
    if (documentTemplateDescriptionInput) {
      documentTemplateDescriptionInput.value = "";
    }
    if (documentTemplateKindSelect) {
      documentTemplateKindSelect.value = "none";
    }

    setDocumentTemplateUploadMessage("Шаблон загружен и добавлен в документооборот.", false, true);
  } catch (error) {
    console.error("Document template upload error:", error);
    setDocumentTemplateUploadMessage("Не удалось загрузить шаблон. Попробуйте снова.", true);
  } finally {
    setDocumentTemplateUploadBusy(false);
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
    consultant: {
      enabled: consultantEnabled.checked,
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
    const savedConsultant =
      result.settings && result.settings.consultant ? result.settings.consultant : {};
    const savedDocumentFlow =
      result.settings && result.settings.documentFlow ? result.settings.documentFlow : {};
    announcementEnabled.checked = Boolean(saved.enabled);
    announcementTitle.value = saved.title || "";
    announcementText.value = saved.text || "";
    consultantEnabled.checked = Boolean(savedConsultant.enabled);
    consultantServers = Array.isArray(savedConsultant.servers) ? savedConsultant.servers : consultantServers;
    populateConsultantServers(consultantServers);
    renderSelectedServerFiles();
    documentFlowTemplates = Array.isArray(savedDocumentFlow.templates)
      ? savedDocumentFlow.templates
      : documentFlowTemplates;
    renderDocumentTemplateList();

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

function setConsultantUploadMessage(text, isError = false, isOk = false) {
  if (!consultantUploadMessage) return;
  consultantUploadMessage.textContent = text;
  consultantUploadMessage.classList.remove("error", "ok");
  if (isError) consultantUploadMessage.classList.add("error");
  if (isOk) consultantUploadMessage.classList.add("ok");
}

function setDocumentTemplateUploadMessage(text, isError = false, isOk = false) {
  if (!documentTemplateUploadMessage) return;
  documentTemplateUploadMessage.textContent = text;
  documentTemplateUploadMessage.classList.remove("error", "ok");
  if (isError) documentTemplateUploadMessage.classList.add("error");
  if (isOk) documentTemplateUploadMessage.classList.add("ok");
}

function setConsultantUploadBusy(isBusy) {
  if (consultantUploadButton) {
    consultantUploadButton.disabled = isBusy;
  }
  if (consultantFilesInput) {
    consultantFilesInput.disabled = isBusy;
  }
  if (consultantServerSelect) {
    consultantServerSelect.disabled = isBusy;
  }
}

function setDocumentTemplateUploadBusy(isBusy) {
  if (documentTemplateUploadButton) {
    documentTemplateUploadButton.disabled = isBusy;
  }
  if (documentTemplateFileInput) {
    documentTemplateFileInput.disabled = isBusy;
  }
  if (documentTemplateTitleInput) {
    documentTemplateTitleInput.disabled = isBusy;
  }
  if (documentTemplateDescriptionInput) {
    documentTemplateDescriptionInput.disabled = isBusy;
  }
  if (documentTemplateKindSelect) {
    documentTemplateKindSelect.disabled = isBusy;
  }
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
