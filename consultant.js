const consultantForm = document.getElementById("consultant-form");
const consultantServerSelect = document.getElementById("consultant-server");
const consultantQuestionInput = document.getElementById("consultant-question");
const consultantState = document.getElementById("consultant-state");
const consultantResult = document.getElementById("consultant-result");
const consultantAnswer = document.getElementById("consultant-answer");
const consultantNotice = document.getElementById("consultant-notice");
const consultantMatches = document.getElementById("consultant-matches");
const consultantSubmitButton = document.getElementById("consultant-submit");
const consultantClearButton = document.getElementById("consultant-clear");

let consultantServers = [];

if (consultantForm) {
  consultantForm.addEventListener("submit", onConsultantSubmit);
}

if (consultantClearButton) {
  consultantClearButton.addEventListener("click", onConsultantClear);
}

if (consultantServerSelect) {
  consultantServerSelect.addEventListener("change", onServerChanged);
}

initConsultantPage();

async function initConsultantPage() {
  setConsultantState("Проверка настроек консультанта...");
  setFormEnabled(false);

  try {
    const response = await fetch("/api/settings/public", {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Status ${response.status}`);
    }

    const settings = await response.json();
    const consultant = settings && settings.consultant ? settings.consultant : {};
    const enabled = Boolean(consultant.enabled);
    consultantServers = Array.isArray(consultant.servers) ? consultant.servers : [];

    if (!enabled) {
      setConsultantState("Консультант отключен администратором.", true);
      populateServerSelect([]);
      return;
    }

    if (!consultantServers.length) {
      setConsultantState("Список серверов недоступен.", true);
      populateServerSelect([]);
      return;
    }

    populateServerSelect(consultantServers);
    setFormEnabled(true);
    onServerChanged();
  } catch (error) {
    console.error("Consultant settings load error:", error);
    setConsultantState("Не удалось загрузить настройки консультанта.", true);
  }
}

function populateServerSelect(servers) {
  if (!consultantServerSelect) return;
  const savedServerId = String(localStorage.getItem("dj_consultant_server_id") || "").trim();
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
    option.textContent = "Нет доступных серверов";
    consultantServerSelect.appendChild(option);
    consultantServerSelect.value = "";
    return;
  }

  const fallbackServer = servers.find((server) => Boolean(server.hasLaws)) || servers[0];
  const canRestore = servers.some((server) => String(server.id || "") === savedServerId);
  consultantServerSelect.value = canRestore ? savedServerId : String(fallbackServer.id || "");
}

function onServerChanged() {
  if (consultantResult) {
    consultantResult.hidden = true;
  }
  if (consultantMatches) {
    consultantMatches.innerHTML = "";
  }

  const serverId = String(consultantServerSelect?.value || "").trim();
  if (!serverId) {
    setConsultantState("Выберите сервер Majestic.", true);
    setFormEnabled(false);
    return;
  }

  localStorage.setItem("dj_consultant_server_id", serverId);
  const server = consultantServers.find((entry) => String(entry.id || "") === serverId);
  if (!server || !server.hasLaws) {
    setConsultantState(
      "Для выбранного сервера база законодательства пока не загружена администратором.",
      true
    );
    setQuestionEnabled(false);
    return;
  }

  setQuestionEnabled(true);
  setConsultantState(`Сервер: ${server.name}. Можно задавать вопрос.`, false, true);
}

async function onConsultantSubmit(event) {
  event.preventDefault();

  const serverId = String(consultantServerSelect?.value || "").trim();
  if (!serverId) {
    setConsultantState("Выберите сервер Majestic.", true);
    return;
  }

  const question = String(consultantQuestionInput?.value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!question) {
    setConsultantState("Введите вопрос.", true);
    return;
  }

  setBusy(true);
  setConsultantState("Подбираем ответ по базе норм...");

  try {
    const response = await fetch("/api/consultant/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ question, serverId }),
    });

    const payload = await safeJson(response);
    if (!response.ok) {
      const error = payload && payload.error ? payload.error : "Не удалось получить ответ";
      const details = payload && payload.details ? ` ${payload.details}` : "";
      setConsultantState(`${error}.${details}`.trim(), true);
      return;
    }

    renderConsultantResult(payload || {});
    const serverName = String(payload?.server?.name || "").trim();
    setConsultantState(serverName ? `Ответ готов (${serverName}).` : "Ответ готов.", false, true);
  } catch (error) {
    console.error("Consultant request error:", error);
    setConsultantState("Ошибка сети. Попробуйте позже.", true);
  } finally {
    setBusy(false);
  }
}

function onConsultantClear() {
  if (consultantQuestionInput) {
    consultantQuestionInput.value = "";
  }
  if (consultantResult) {
    consultantResult.hidden = true;
  }
  if (consultantMatches) {
    consultantMatches.innerHTML = "";
  }
}

function renderConsultantResult(payload) {
  if (!consultantResult || !consultantAnswer || !consultantNotice || !consultantMatches) return;

  consultantAnswer.textContent = payload.answer || "Совпадения не найдены.";
  consultantNotice.textContent =
    payload.notice || "Сервис дает справочные ответы и не заменяет юридическую консультацию.";

  consultantMatches.innerHTML = "";
  const matches = Array.isArray(payload.matches) ? payload.matches : [];
  matches.forEach((match, index) => {
    const card = document.createElement("article");
    card.className = "consultant-match-card";

    const title = document.createElement("h3");
    title.className = "consultant-match-title";
    title.textContent = match.title || `Фрагмент ${index + 1}`;

    const excerpt = document.createElement("p");
    excerpt.className = "consultant-match-excerpt";
    excerpt.textContent = match.excerpt || "";

    card.append(title, excerpt);
    consultantMatches.appendChild(card);
  });

  consultantResult.hidden = false;
}

function setBusy(isBusy) {
  if (consultantSubmitButton) {
    consultantSubmitButton.disabled = isBusy;
  }
  if (consultantQuestionInput) {
    consultantQuestionInput.disabled = isBusy;
  }
  if (consultantServerSelect) {
    consultantServerSelect.disabled = isBusy;
  }
}

function setFormEnabled(enabled) {
  if (!consultantForm || !consultantQuestionInput || !consultantSubmitButton || !consultantClearButton) {
    return;
  }
  if (consultantServerSelect) {
    consultantServerSelect.disabled = !enabled;
  }
  consultantQuestionInput.disabled = !enabled;
  consultantSubmitButton.disabled = !enabled;
  consultantClearButton.disabled = !enabled;
}

function setQuestionEnabled(enabled) {
  if (consultantQuestionInput) {
    consultantQuestionInput.disabled = !enabled;
  }
  if (consultantSubmitButton) {
    consultantSubmitButton.disabled = !enabled;
  }
  if (consultantClearButton) {
    consultantClearButton.disabled = !enabled;
  }
}

function setConsultantState(text, isError = false, isOk = false) {
  if (!consultantState) return;
  consultantState.textContent = text;
  consultantState.classList.remove("error", "ok");
  if (isError) consultantState.classList.add("error");
  if (isOk) consultantState.classList.add("ok");
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
