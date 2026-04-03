const consultantForm = document.getElementById("consultant-form");
const consultantQuestionInput = document.getElementById("consultant-question");
const consultantState = document.getElementById("consultant-state");
const consultantResult = document.getElementById("consultant-result");
const consultantAnswer = document.getElementById("consultant-answer");
const consultantNotice = document.getElementById("consultant-notice");
const consultantMatches = document.getElementById("consultant-matches");
const consultantSubmitButton = document.getElementById("consultant-submit");
const consultantClearButton = document.getElementById("consultant-clear");

if (consultantForm) {
  consultantForm.addEventListener("submit", onConsultantSubmit);
}

if (consultantClearButton) {
  consultantClearButton.addEventListener("click", onConsultantClear);
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
    const hasLaws = Boolean(consultant.hasLaws);
    const maxQuestionChars = Number(consultant.maxQuestionChars || 1000);

    if (!enabled) {
      setConsultantState("Консультант отключен администратором.", true);
      return;
    }

    if (!hasLaws) {
      setConsultantState("База норм пока не заполнена. Обратитесь к администратору.", true);
      return;
    }

    if (consultantQuestionInput && Number.isFinite(maxQuestionChars) && maxQuestionChars > 0) {
      consultantQuestionInput.maxLength = maxQuestionChars;
    }

    setFormEnabled(true);
    setConsultantState("Консультант готов к работе.", false, true);
  } catch (error) {
    console.error("Consultant settings load error:", error);
    setConsultantState("Не удалось загрузить настройки консультанта.", true);
  }
}

async function onConsultantSubmit(event) {
  event.preventDefault();

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
      body: JSON.stringify({ question }),
    });

    const payload = await safeJson(response);
    if (!response.ok) {
      const error = payload && payload.error ? payload.error : "Не удалось получить ответ";
      const details = payload && payload.details ? ` ${payload.details}` : "";
      setConsultantState(`${error}.${details}`.trim(), true);
      return;
    }

    renderConsultantResult(payload || {});
    setConsultantState("Ответ готов.", false, true);
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
}

function setFormEnabled(enabled) {
  if (!consultantForm || !consultantQuestionInput || !consultantSubmitButton || !consultantClearButton) {
    return;
  }
  consultantQuestionInput.disabled = !enabled;
  consultantSubmitButton.disabled = !enabled;
  consultantClearButton.disabled = !enabled;
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
