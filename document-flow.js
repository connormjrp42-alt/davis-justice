const documentFillForm = document.getElementById("document-fill-form");
const documentTemplateKind = document.getElementById("document-template-kind");
const documentPreviewCard = document.getElementById("document-preview-card");
const documentPreview = document.getElementById("document-preview");
const documentFillMessage = document.getElementById("document-fill-message");
const documentCopyButton = document.getElementById("document-copy");
const documentDownloadButton = document.getElementById("document-download");
const documentClearButton = document.getElementById("document-clear");

const docNumberInput = document.getElementById("doc-number");
const decisionDateInput = document.getElementById("decision-date");
const appealDateInput = document.getElementById("appeal-date");
const caseIdentifierInput = document.getElementById("case-identifier");
const prosecutorRoleInput = document.getElementById("prosecutor-role");
const prosecutorNameInput = document.getElementById("prosecutor-name");
const applicantNameInput = document.getElementById("applicant-name");
const applicantPassportInput = document.getElementById("applicant-passport");
const unitNameInput = document.getElementById("unit-name");
const officerNameInput = document.getElementById("officer-name");
const officerPassportInput = document.getElementById("officer-passport");
const responsibleCopyInput = document.getElementById("responsible-copy");
const violationDescriptionInput = document.getElementById("violation-description");
const legalGroundsInput = document.getElementById("legal-grounds");

const defaultResponsibleCopy =
  "Шефа Los Santos Police Department/Шерифа Los Santos Country Shariff Department/" +
  "Директора Federal Investigation Bureau/Главного врача Emergensy Medical Servise/" +
  "Генерала San Andreas National Guard/Директора Weasl News/Губернатора штата San Andreas";

let generatedDocumentText = "";
let generatedTemplateKind = "criminal_case";
let generatedDocNumber = "";

if (documentFillForm) {
  documentFillForm.addEventListener("submit", onDocumentFillSubmit);
}

if (documentTemplateKind) {
  documentTemplateKind.addEventListener("change", onTemplateKindChange);
}

if (documentCopyButton) {
  documentCopyButton.addEventListener("click", onCopyDocumentText);
}

if (documentDownloadButton) {
  documentDownloadButton.addEventListener("click", onDownloadDocumentText);
}

if (documentClearButton) {
  documentClearButton.addEventListener("click", onClearDocumentForm);
}

initDocumentFill();

function initDocumentFill() {
  const today = formatDate(new Date());
  if (decisionDateInput && !decisionDateInput.value.trim()) {
    decisionDateInput.value = today;
  }
  if (appealDateInput && !appealDateInput.value.trim()) {
    appealDateInput.value = today;
  }
  if (responsibleCopyInput && !responsibleCopyInput.value.trim()) {
    responsibleCopyInput.value = defaultResponsibleCopy;
  }
  onTemplateKindChange();
}

function onTemplateKindChange() {
  const kind = String(documentTemplateKind?.value || "criminal_case").trim();
  const showCaseFields = kind === "criminal_case";
  toggleFieldVisibility(caseIdentifierInput, showCaseFields);
  toggleFieldVisibility(responsibleCopyInput, showCaseFields);
}

function toggleFieldVisibility(input, visible) {
  const wrap = input?.parentElement;
  if (!wrap) return;
  wrap.hidden = !visible;
}

function onDocumentFillSubmit(event) {
  event.preventDefault();

  const payload = collectDocumentPayload();
  const text =
    payload.templateKind === "appeal_acceptance"
      ? buildAppealAcceptanceDocument(payload)
      : buildCriminalCaseDocument(payload);

  generatedDocumentText = text;
  generatedTemplateKind = payload.templateKind;
  generatedDocNumber = payload.docNumber;

  if (documentPreview) {
    documentPreview.textContent = text;
  }
  if (documentPreviewCard) {
    documentPreviewCard.hidden = false;
  }
  setDocumentFillMessage("Документ сформирован. Можно копировать текст или скачать PDF.", false, true);
}

function collectDocumentPayload() {
  return {
    templateKind: String(documentTemplateKind?.value || "criminal_case").trim(),
    docNumber: cleanInput(docNumberInput?.value),
    decisionDate: cleanInput(decisionDateInput?.value),
    appealDate: cleanInput(appealDateInput?.value),
    caseIdentifier: cleanInput(caseIdentifierInput?.value),
    prosecutorRole: cleanInput(prosecutorRoleInput?.value),
    prosecutorName: cleanInput(prosecutorNameInput?.value),
    applicantName: cleanInput(applicantNameInput?.value),
    applicantPassport: cleanInput(applicantPassportInput?.value),
    unitName: cleanInput(unitNameInput?.value),
    officerName: cleanInput(officerNameInput?.value),
    officerPassport: cleanInput(officerPassportInput?.value),
    responsibleCopy: cleanInput(responsibleCopyInput?.value) || defaultResponsibleCopy,
    violationDescription: cleanInput(violationDescriptionInput?.value),
    legalGrounds: cleanInput(legalGroundsInput?.value),
  };
}

function cleanInput(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function fallback(value, emptyValue = "____________") {
  return value || emptyValue;
}

function buildCriminalCaseDocument(payload) {
  const prosecutorFull = `${fallback(payload.prosecutorRole)} ${fallback(payload.prosecutorName)}`;
  const applicant = fallback(payload.applicantName);
  const applicantPassport = fallback(payload.applicantPassport);
  const unitName = fallback(payload.unitName);
  const officerName = fallback(payload.officerName);
  const officerPassport = fallback(payload.officerPassport);

  return [
    "Офис Генерального прокурора",
    "",
    `Постановление "о возбуждении уголовного дела" №${fallback(payload.docNumber)}`,
    "",
    `Офис Генерального прокурора, в лице ${prosecutorFull}, в рамках рассмотрения обращения от гражданина ${applicant} с номером паспорта ${applicantPassport},`,
    "",
    "Установил:",
    "",
    `${fallback(payload.appealDate)} в офис Генерального прокурора поступило обращение от гражданина ${applicant} с номером паспорта ${applicantPassport}.`,
    `В настоящем обращении заявитель указывает на противоправность действий сотрудника ${unitName} ${officerName} с номером паспорта ${officerPassport}, выразившихся в ${fallback(payload.violationDescription)}.`,
    `В соответствии с ${fallback(payload.legalGrounds)} офис Генерального прокурора`,
    "",
    "Постановил:",
    "",
    `Возбудить уголовное дело в отношении гражданина ${officerName} с номером паспорта ${officerPassport};`,
    `Признать гражданина ${officerName} с номером паспорта ${officerPassport} обвиняемым в настоящем уголовном деле;`,
    `Назначить уголовному делу идентификатор ${fallback(payload.caseIdentifier, "[DJR/DGA]")};`,
    "Передать копию настоящего постановления обвиняемому;",
    `Обязанность за передачу копии постановления возложить на ${fallback(payload.responsibleCopy)};`,
    "Установить срок на передачу копии постановления 24 часа.",
    "",
    "",
    prosecutorFull,
    fallback(payload.decisionDate),
    "",
    "Подпись",
  ].join("\n");
}

function buildAppealAcceptanceDocument(payload) {
  const prosecutorFull = `${fallback(payload.prosecutorRole)} ${fallback(payload.prosecutorName)}`;
  const applicant = fallback(payload.applicantName);
  const applicantPassport = fallback(payload.applicantPassport);
  const unitName = fallback(payload.unitName);
  const officerName = fallback(payload.officerName);
  const officerPassport = fallback(payload.officerPassport);

  return [
    "Офис Генерального прокурора",
    "",
    `Постановление "о принятии обращения" №${fallback(payload.docNumber)}`,
    "",
    `Офис Генерального прокурора, в лице ${prosecutorFull}, в рамках рассмотрения обращения от гражданина ${applicant} с номером паспорта ${applicantPassport},`,
    "",
    "Установил:",
    "",
    `${fallback(payload.appealDate)} в офис Генерального прокурора поступило обращение от гражданина ${applicant} с номером паспорта ${applicantPassport}.`,
    `В настоящем обращении заявитель указывает на противоправность действий сотрудника ${unitName} ${officerName} с номером паспорта ${officerPassport}, выразившихся в ${fallback(payload.violationDescription)}.`,
    `В соответствии с ${fallback(payload.legalGrounds)} офис Генерального прокурора`,
    "",
    "Постановил:",
    "",
    `Принять обращение в офис Генерального прокурора от гражданина ${applicant} в производство ${prosecutorFull};`,
    `Назначить прокурорскую проверку изложенных в обращении действий сотрудника ${unitName} ${officerName} с номером паспорта ${officerPassport} на факт совершения правонарушения;`,
    "Передать копию настоящего постановления заявителю.",
    "",
    "",
    prosecutorFull,
    fallback(payload.decisionDate),
    "",
    "Подпись",
  ].join("\n");
}

async function onCopyDocumentText() {
  if (!generatedDocumentText) {
    setDocumentFillMessage("Сначала сформируйте документ.", true);
    return;
  }

  try {
    await navigator.clipboard.writeText(generatedDocumentText);
    setDocumentFillMessage("Текст документа скопирован в буфер обмена.", false, true);
  } catch (error) {
    console.error("Clipboard copy error:", error);
    copyViaFallbackTextarea(generatedDocumentText);
    setDocumentFillMessage("Текст скопирован через резервный режим.", false, true);
  }
}

function copyViaFallbackTextarea(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

async function onDownloadDocumentText() {
  if (!generatedDocumentText) {
    setDocumentFillMessage("Сначала сформируйте документ.", true);
    return;
  }

  try {
    const response = await fetch("/api/document-flow/pdf", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/pdf,application/json",
      },
      body: JSON.stringify({
        templateKind: generatedTemplateKind,
        documentText: generatedDocumentText,
        documentNumber: generatedDocNumber,
      }),
    });

    if (!response.ok) {
      const payload = await safeJson(response);
      const details = payload?.details ? ` ${payload.details}` : "";
      const error = payload?.error || `HTTP ${response.status}`;
      setDocumentFillMessage(`Не удалось скачать PDF: ${error}.${details}`.trim(), true);
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const filePrefix =
      generatedTemplateKind === "appeal_acceptance"
        ? "postanovlenie-prinyatie-obrashcheniya"
        : "postanovlenie-vozbuzhdenie-ugolovnogo-dela";
    const safeNumber = String(generatedDocNumber || "draft")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    anchor.href = url;
    anchor.download = `${filePrefix}-${safeNumber || "draft"}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    setDocumentFillMessage("PDF скачан. В файл включены изображения шаблона.", false, true);
  } catch (error) {
    console.error("PDF download error:", error);
    setDocumentFillMessage("Ошибка сети при скачивании PDF.", true);
  }
}

function onClearDocumentForm() {
  documentFillForm?.reset();
  generatedDocumentText = "";
  generatedTemplateKind = "criminal_case";
  generatedDocNumber = "";
  if (documentPreview) {
    documentPreview.textContent = "";
  }
  if (documentPreviewCard) {
    documentPreviewCard.hidden = true;
  }
  initDocumentFill();
  setDocumentFillMessage("Форма очищена.");
}

function setDocumentFillMessage(text, isError = false, isOk = false) {
  if (!documentFillMessage) return;
  documentFillMessage.textContent = text;
  documentFillMessage.classList.remove("error", "ok");
  if (isError) documentFillMessage.classList.add("error");
  if (isOk) documentFillMessage.classList.add("ok");
}

function formatDate(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());
  return `${day}.${month}.${year}`;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
