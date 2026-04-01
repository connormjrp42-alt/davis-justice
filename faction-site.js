
const titleNode = document.getElementById("faction-site-title");
const descriptionNode = document.getElementById("faction-site-description");
const rootNode = document.getElementById("faction-site-root");
const statusNode = document.getElementById("faction-site-status");

const slug = extractSlugFromPath();
const MAX_FILE_SIZE = 3 * 1024 * 1024;
const MAX_DATA_URL_CHARS = 3_000_000;
const PRIORITY_ORDER = { critical: 0, high: 1, normal: 2, low: 3 };
const PRIORITY_LABELS = {
  critical: "Критично",
  high: "Высокий",
  normal: "Обычный",
  low: "Низкий",
};

const state = {
  draft: null,
  canEdit: false,
  isAuthenticated: false,
  search: "",
  sort: "priority",
  kind: "all",
  tag: "",
  favoritesOnly: false,
  readerId: "",
  documentReaderId: "",
  documentFieldValues: {},
  statementStatus: "",
  statementStatusType: "",
  statementDraft: {
    type: "request",
    title: "",
    text: "",
  },
  editorTab: "settings",
  favorites: new Set(),
  flash: { text: "", type: "" },
};

initFactionSite();

async function initFactionSite() {
  if (!slug) {
    setStatus("Неверная ссылка фракции.", true);
    return;
  }

  state.favorites = loadFavorites();

  try {
    const response = await fetch(`/api/faction/site/${encodeURIComponent(slug)}`, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });

    if (response.status === 404) {
      setStatus("Фракция не найдена.", true);
      return;
    }

    if (!response.ok) {
      setStatus("Не удалось загрузить сайт фракции.", true);
      return;
    }

    const payload = await response.json();
    state.canEdit = Boolean(payload.canEdit);
    state.isAuthenticated = Boolean(payload.authenticated);
    state.draft = normalizeFaction(payload.faction || {});
    render();
  } catch (error) {
    console.error("Faction site init error:", error);
    setStatus("Ошибка загрузки страницы.", true);
  }
}

function normalizeFaction(faction) {
  const source = faction && typeof faction === "object" ? faction : {};
  return {
    name: String(source.name || ""),
    description: String(source.description || ""),
    serverId: String(source.serverId || ""),
    roleId: String(source.roleId || ""),
    avatarUrl: String(source.avatarUrl || ""),
    bannerUrl: String(source.bannerUrl || ""),
    memos: normalizeMaterials(source.memos, "memo"),
    guides: normalizeMaterials(source.guides, "guide"),
    documents: normalizeDocuments(source.documents),
    statementWebhookUrl: String(source.statementWebhookUrl || ""),
    revisionLog: Array.isArray(source.revisionLog) ? source.revisionLog : [],
  };
}

function normalizeMaterials(input, prefix) {
  if (!Array.isArray(input)) return [];
  return input.map((row) => normalizeMaterial(row, prefix)).filter(Boolean);
}

function normalizeDocuments(input) {
  if (!Array.isArray(input)) return [];
  return input.map((row) => normalizeDocument(row)).filter(Boolean);
}

function normalizeDocument(entry) {
  const nowIso = new Date().toISOString();
  const source = entry && typeof entry === "object" ? entry : {};
  return {
    id: String(source.id || `doc_${makeId()}`).slice(0, 64),
    title: String(source.title || "Документ").trim().slice(0, 120),
    category: String(source.category || "").trim().slice(0, 60),
    summary: String(source.summary || "").trim().slice(0, 300),
    template: String(source.template || "").trim().slice(0, 12000),
    tags: normalizeTags(source.tags),
    status: normalizeStatus(source.status),
    createdAt: String(source.createdAt || nowIso),
    updatedAt: String(source.updatedAt || nowIso),
  };
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value
      .map((x) => String(x || "").trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 20);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 20);
  }
  return [];
}

function normalizeStatus(value) {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "draft" ? "draft" : "published";
}

function normalizeMedia(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry) => {
      if (typeof entry === "string") {
        const url = normalizeUrl(entry);
        if (!url) return null;
        return { type: inferMediaType(url), url };
      }
      const source = entry && typeof entry === "object" ? entry : {};
      const url = normalizeUrl(source.url);
      if (!url) return null;
      const type = String(source.type || "").trim().toLowerCase();
      return {
        type: type === "video" ? "video" : inferMediaType(url),
        url,
      };
    })
    .filter(Boolean)
    .slice(0, 16);
}

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  return /^https?:\/\/\S+$/i.test(raw) ? raw.slice(0, 4096) : "";
}

function inferMediaType(url) {
  const value = String(url || "").toLowerCase();
  if (
    value.includes("youtube.com/") ||
    value.includes("youtu.be/") ||
    /\.(mp4|webm|ogg)(\?|#|$)/i.test(value)
  ) {
    return "video";
  }
  return "image";
}

function normalizeMaterial(entry, prefix) {
  const nowIso = new Date().toISOString();
  if (typeof entry === "string") {
    const text = String(entry || "").trim();
    if (!text) return null;
    return {
      id: `${prefix}_${makeId()}`,
      title: text.split(/\r?\n/)[0].slice(0, 100),
      details: text,
      steps: [],
      whenToUse: "",
      mistakes: "",
      reportItems: "",
      tags: [],
      priority: "normal",
      minutes: null,
      status: "published",
      media: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  }

  const source = entry && typeof entry === "object" ? entry : {};
  const steps = Array.isArray(source.steps)
    ? source.steps.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const tags = normalizeTags(source.tags);

  return {
    id: String(source.id || `${prefix}_${makeId()}`),
    title: String(source.title || "Без названия").trim().slice(0, 100),
    details: String(source.details || "").trim().slice(0, 5000),
    steps: steps.slice(0, 30),
    whenToUse: String(source.whenToUse || "").trim().slice(0, 500),
    mistakes: String(source.mistakes || "").trim().slice(0, 900),
    reportItems: String(source.reportItems || "").trim().slice(0, 900),
    tags: tags.slice(0, 20),
    priority: normalizePriority(source.priority),
    minutes: normalizeMinutes(source.minutes),
    status: normalizeStatus(source.status),
    media: normalizeMedia(source.media),
    createdAt: String(source.createdAt || nowIso),
    updatedAt: String(source.updatedAt || nowIso),
  };
}

function normalizePriority(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return PRIORITY_ORDER[normalized] !== undefined ? normalized : "normal";
}

function normalizeMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 1 || rounded > 240) return null;
  return rounded;
}

function render() {
  if (!state.draft) {
    setStatus("Фракция не найдена.", true);
    return;
  }

  titleNode.textContent = state.draft.name || "Без названия";
  descriptionNode.textContent = state.draft.description || "Информационный сайт фракции проекта Majestic.";

  const items = getAllItems();
  const filtered = sortItems(filterItems(items));
  const tags = getAllTags();

  rootNode.innerHTML = `
    <div class="faction-web-shell">
      <section class="faction-hero-v2">
        <div class="faction-hero-v2-bg" style="${heroBgStyle()}"></div>
        <div class="faction-hero-v2-content">
          <div class="faction-hero-v2-avatar">
            ${state.draft.avatarUrl ? `<img src="${escapeHtml(state.draft.avatarUrl)}" alt="Аватар"/>` : `<span>${escapeHtml(getInitials(state.draft.name || "F"))}</span>`}
          </div>
          <div>
            <p class="faction-kicker">Официальный портал фракции</p>
            <h2>${escapeHtml(state.draft.name || "Без названия")}</h2>
            <p>${escapeHtml(state.draft.description || "Описание пока не заполнено.")}</p>
            <div class="faction-hero-v2-pills">
              <span>ID сервера: ${escapeHtml(state.draft.serverId || "—")}</span>
              <span>ID роли: ${escapeHtml(state.draft.roleId || "—")}</span>
              <span>Материалов: ${items.length}</span>
            </div>
          </div>
        </div>
      </section>

      <section class="faction-web-layout-v2">
        <aside class="faction-side-nav">
          <p>Разделы</p>
          <button type="button" data-scroll="#faction-dashboard">Дашборд</button>
          <button type="button" data-scroll="#faction-about">О фракции</button>
          <button type="button" data-scroll="#faction-library">Памятки и гайды</button>
          <button type="button" data-scroll="#faction-docs">Документооборот</button>
          <button type="button" data-scroll="#faction-updates">Обновления</button>
          ${state.canEdit ? `<button type="button" data-scroll="#leader-studio">Leader Studio</button>` : ""}
        </aside>

        <div class="faction-web-content">
          ${renderDashboardMarkup(items)}
          ${renderAboutSectionMarkup(items)}
          ${renderLibrarySectionMarkup(filtered, tags)}
          ${renderDocumentsSectionMarkup()}
          ${renderUpdatesMarkup()}
        </div>
      </section>

      ${state.canEdit ? renderLeaderStudioMarkup() : ""}
    </div>

    ${state.readerId ? renderReaderMarkup(findItemById(items, state.readerId)) : ""}
    ${
      state.documentReaderId
        ? renderDocumentReaderMarkup(findDocumentById(state.documentReaderId))
        : ""
    }
  `;

  bindCommonEvents(items);
  if (state.canEdit) {
    bindLeaderEvents();
  }

  setStatus("");
}

function renderDashboardMarkup(items) {
  const published = items.filter((row) => row.material.status !== "draft");
  const critical = published.filter((row) => row.material.priority === "critical");
  const latest = [...published]
    .sort(
      (a, b) =>
        new Date(b.material.updatedAt || b.material.createdAt || 0).getTime() -
        new Date(a.material.updatedAt || a.material.createdAt || 0).getTime()
    )
    .slice(0, 3);

  return `
    <section id="faction-dashboard" class="faction-content-section">
      <header>
        <p class="faction-kicker">Дашборд</p>
        <h3>Быстрый обзор портала фракции</h3>
      </header>
      <div class="dashboard-grid-v2">
        <article class="dashboard-card-v2">
          <h4>Обязательные материалы</h4>
          <p>${critical.length} критичных материалов к изучению.</p>
        </article>
        <article class="dashboard-card-v2">
          <h4>Документооборот</h4>
          <p>${state.draft.documents.length} шаблонов документов в базе.</p>
        </article>
        <article class="dashboard-card-v2">
          <h4>Опубликовано</h4>
          <p>${published.length} материалов доступно сотрудникам прямо сейчас.</p>
        </article>
      </div>
      <div class="dashboard-latest-v2">
        <h4>Последние обновления материалов</h4>
        ${
          latest.length
            ? `<ul>${latest
                .map(
                  (row) =>
                    `<li>${escapeHtml(row.material.title)} • ${escapeHtml(
                      formatDate(row.material.updatedAt || row.material.createdAt)
                    )}</li>`
                )
                .join("")}</ul>`
            : `<p class="library-empty">Пока нет опубликованных материалов.</p>`
        }
      </div>
    </section>
  `;
}

function renderAboutSectionMarkup(items) {
  const critical = items.filter((x) => x.material.priority === "critical").length;
  const minutes = items.map((x) => normalizeMinutes(x.material.minutes)).filter((x) => x !== null);
  const avg = minutes.length ? Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length) : 0;
  return `
    <section id="faction-about" class="faction-content-section">
      <header>
        <p class="faction-kicker">О фракции</p>
        <h3>Ключевая информация</h3>
      </header>
      <div class="about-grid-v2">
        <article class="about-card-v2">
          <h4>Профиль</h4>
          <p>${escapeHtml(state.draft.description || "Описание отсутствует.")}</p>
        </article>
        <article class="about-card-v2">
          <h4>Статистика</h4>
          <ul>
            <li>Памяток: ${state.draft.memos.length}</li>
            <li>Гайдов: ${state.draft.guides.length}</li>
            <li>Критичных: ${critical}</li>
            <li>Среднее время чтения: ${avg || "—"} мин</li>
          </ul>
        </article>
      </div>
    </section>
  `;
}

function renderLibrarySectionMarkup(items, tags) {
  return `
    <section id="faction-library" class="faction-content-section">
      <header>
        <p class="faction-kicker">База знаний</p>
        <h3>Памятки и гайды</h3>
      </header>

      <div class="library-toolbar-v2">
        <input class="field-input" id="library-search" type="text" placeholder="Поиск по материалам..." value="${escapeHtml(state.search)}" />
        <select class="field-input" id="library-sort">
          <option value="priority" ${state.sort === "priority" ? "selected" : ""}>По важности</option>
          <option value="updated" ${state.sort === "updated" ? "selected" : ""}>По обновлению</option>
          <option value="title" ${state.sort === "title" ? "selected" : ""}>По названию</option>
        </select>
        <button class="ghost-pill ${state.favoritesOnly ? "active" : ""}" id="library-favorites" type="button">
          ${state.favoritesOnly ? "Только избранное" : "Избранные"}
        </button>
      </div>

      <div class="library-switch-v2" role="tablist" aria-label="Тип материала">
        <button class="ghost-pill ${state.kind === "all" ? "active" : ""}" data-kind="all" type="button">Все</button>
        <button class="ghost-pill ${state.kind === "memo" ? "active" : ""}" data-kind="memo" type="button">Памятки</button>
        <button class="ghost-pill ${state.kind === "guide" ? "active" : ""}" data-kind="guide" type="button">Гайды</button>
      </div>

      <div class="library-tags-v2">
        <button class="ghost-pill ${state.tag ? "" : "active"}" data-tag="" type="button">Все теги</button>
        ${tags.map((tag) => `<button class="ghost-pill ${state.tag === tag ? "active" : ""}" data-tag="${escapeHtml(tag)}" type="button">#${escapeHtml(tag)}</button>`).join("")}
      </div>

      <div class="library-grid-v2">
        ${items.length ? items.map((item, index) => renderMaterialCardMarkup(item, index)).join("") : `<p class="library-empty">По выбранным фильтрам ничего не найдено.</p>`}
      </div>
    </section>
  `;
}

function renderMaterialCardMarkup(item, index) {
  const entry = item.material;
  const fav = isFavorite(entry.id);
  const isDraft = entry.status === "draft";
  const previewMedia = entry.media[0];
  return `
    <article class="library-card-v2">
      <div class="library-card-v2-top">
        <div class="library-badges">
          <span class="type-badge">${item.kind === "memo" ? "Памятка" : "Гайд"}</span>
          <span class="priority-badge ${priorityClass(entry.priority)}">${formatPriority(entry.priority)}</span>
          ${
            isDraft
              ? `<span class="type-badge draft-badge">Черновик</span>`
              : `<span class="type-badge published-badge">Опубликовано</span>`
          }
          ${entry.minutes ? `<span class="type-badge">${entry.minutes} мин</span>` : ""}
        </div>
        <button class="fav-btn ${fav ? "active" : ""}" type="button" data-fav="${escapeHtml(entry.id)}">${fav ? "★" : "☆"}</button>
      </div>
      ${
        previewMedia && previewMedia.type === "image"
          ? `<img class="material-preview-image" src="${escapeHtml(
              previewMedia.url
            )}" alt="Превью материала" />`
          : ""
      }
      <h4>${escapeHtml(entry.title || `Материал ${index + 1}`)}</h4>
      <p>${escapeHtml(truncate(entry.details || entry.whenToUse || "Контент не заполнен.", 170))}</p>
      <div class="library-card-v2-footer">
        <span>${escapeHtml(formatDate(entry.updatedAt || entry.createdAt))}</span>
        <button class="btn btn-secondary" type="button" data-open="${escapeHtml(entry.id)}">Открыть</button>
      </div>
    </article>
  `;
}

function renderDocumentsSectionMarkup() {
  return `
    <section id="faction-docs" class="faction-content-section">
      <header>
        <p class="faction-kicker">Документооборот</p>
        <h3>Шаблоны и заявления</h3>
      </header>

      <div class="documents-grid-v2">
        ${
          state.draft.documents.length
            ? state.draft.documents
                .map((doc) => renderDocumentCardMarkup(doc))
                .join("")
            : `<p class="library-empty">Шаблоны документов пока не добавлены.</p>`
        }
      </div>

      <div class="statement-box-v2">
        <h4>Отправка заявления в Discord</h4>
        ${
          state.isAuthenticated
            ? `
            <form id="statement-form" class="statement-form-v2">
              <div class="statement-inline-v2">
                <select class="field-input" id="statement-type">
                  <option value="request" ${
                    state.statementDraft.type === "request" ? "selected" : ""
                  }>Запрос</option>
                  <option value="report" ${
                    state.statementDraft.type === "report" ? "selected" : ""
                  }>Рапорт</option>
                  <option value="complaint" ${
                    state.statementDraft.type === "complaint" ? "selected" : ""
                  }>Жалоба</option>
                  <option value="appeal" ${
                    state.statementDraft.type === "appeal" ? "selected" : ""
                  }>Апелляция</option>
                  <option value="other" ${
                    state.statementDraft.type === "other" ? "selected" : ""
                  }>Другое</option>
                </select>
                <input class="field-input" id="statement-title" type="text" maxlength="180" placeholder="Краткий заголовок заявления" value="${escapeHtml(
                  state.statementDraft.title
                )}" />
              </div>
              <textarea class="field-textarea" id="statement-text" maxlength="3500" placeholder="Текст заявления...">${escapeHtml(
                state.statementDraft.text
              )}</textarea>
              <button class="btn btn-primary" type="submit">Отправить в Discord</button>
              <p class="admin-message ${escapeHtml(
                state.statementStatusType
              )}" id="statement-status">${escapeHtml(state.statementStatus)}</p>
            </form>
          `
            : `<p class="library-empty">Чтобы отправить заявление, авторизуйтесь через Discord.</p>`
        }
      </div>
    </section>
  `;
}

function renderDocumentCardMarkup(doc) {
  return `
    <article class="document-card-v2">
      <div class="library-badges">
        <span class="type-badge">${escapeHtml(doc.category || "Документ")}</span>
        ${
          doc.status === "draft"
            ? `<span class="type-badge draft-badge">Черновик</span>`
            : `<span class="type-badge published-badge">Опубликовано</span>`
        }
      </div>
      <h4>${escapeHtml(doc.title)}</h4>
      <p>${escapeHtml(doc.summary || "Шаблон документа фракции.")}</p>
      <div class="library-card-v2-footer">
        <span>${escapeHtml(formatDate(doc.updatedAt || doc.createdAt))}</span>
        <button class="btn btn-secondary" type="button" data-doc-open="${escapeHtml(
          doc.id
        )}">Открыть шаблон</button>
      </div>
    </article>
  `;
}

function renderUpdatesMarkup() {
  const updates = Array.isArray(state.draft.revisionLog) ? state.draft.revisionLog.slice(0, 8) : [];
  return `
    <section id="faction-updates" class="faction-content-section">
      <header>
        <p class="faction-kicker">Хронология</p>
        <h3>Последние обновления</h3>
      </header>
      <div class="updates-grid-v2">
        ${updates.length ? updates.map((row) => `
          <article class="update-card-v2">
            <p>${escapeHtml(formatDate(row.at))}</p>
            <h4>${escapeHtml(row.editorName || "Leader")}</h4>
            <span>${escapeHtml(row.action || "Обновлен контент фракции")}</span>
          </article>`).join("") : `<p class="library-empty">Обновлений пока нет.</p>`}
      </div>
    </section>
  `;
}

function bindCommonEvents(items) {
  document.querySelectorAll("[data-scroll]").forEach((button) => {
    button.addEventListener("click", () => {
      const selector = button.getAttribute("data-scroll");
      const target = selector ? document.querySelector(selector) : null;
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });

  const search = document.getElementById("library-search");
  if (search) {
    search.addEventListener("input", () => {
      state.search = search.value.trim();
      render();
    });
  }

  const sort = document.getElementById("library-sort");
  if (sort) {
    sort.addEventListener("change", () => {
      state.sort = sort.value;
      render();
    });
  }

  const favoritesBtn = document.getElementById("library-favorites");
  if (favoritesBtn) {
    favoritesBtn.addEventListener("click", () => {
      state.favoritesOnly = !state.favoritesOnly;
      render();
    });
  }

  document.querySelectorAll("[data-kind]").forEach((button) => {
    button.addEventListener("click", () => {
      state.kind = button.getAttribute("data-kind") || "all";
      render();
    });
  });

  document.querySelectorAll("[data-tag]").forEach((button) => {
    button.addEventListener("click", () => {
      state.tag = button.getAttribute("data-tag") || "";
      render();
    });
  });

  document.querySelectorAll("[data-fav]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleFavorite(button.getAttribute("data-fav"));
      render();
    });
  });

  document.querySelectorAll("[data-open]").forEach((button) => {
    button.addEventListener("click", () => {
      state.readerId = button.getAttribute("data-open") || "";
      state.documentReaderId = "";
      render();
    });
  });

  document.querySelectorAll("[data-doc-open]").forEach((button) => {
    button.addEventListener("click", () => {
      state.documentReaderId = button.getAttribute("data-doc-open") || "";
      state.readerId = "";
      render();
    });
  });

  const close = document.querySelector("[data-reader-close]");
  if (close) {
    close.addEventListener("click", () => {
      state.readerId = "";
      render();
    });
  }

  const overlay = document.querySelector(".reader-overlay-v2");
  if (overlay) {
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        state.readerId = "";
        state.documentReaderId = "";
        render();
      }
    });
  }

  const docClose = document.querySelector("[data-doc-close]");
  if (docClose) {
    docClose.addEventListener("click", () => {
      state.documentReaderId = "";
      render();
    });
  }

  document.querySelectorAll("[data-doc-field]").forEach((input) => {
    input.addEventListener("input", () => {
      const doc = findDocumentById(state.documentReaderId);
      if (!doc) return;
      const field = input.getAttribute("data-doc-field") || "";
      if (!field) return;
      const values = getDocumentValues(doc.id);
      values[field] = input.value;
      state.documentFieldValues[doc.id] = values;
      const target = document.getElementById("document-filled-template");
      if (target) {
        target.value = applyTemplateValues(doc.template, values);
      }
    });
  });

  const docCopy = document.querySelector("[data-doc-copy]");
  if (docCopy) {
    docCopy.addEventListener("click", async () => {
      const target = document.getElementById("document-filled-template");
      if (!target) return;
      await copyText(target.value);
      setFlash("Текст документа скопирован в буфер.", "ok");
      render();
    });
  }

  const statementForm = document.getElementById("statement-form");
  if (statementForm) {
    const statementType = document.getElementById("statement-type");
    const statementTitle = document.getElementById("statement-title");
    const statementText = document.getElementById("statement-text");

    if (statementType) {
      statementType.addEventListener("change", () => {
        state.statementDraft.type = statementType.value || "request";
      });
    }
    if (statementTitle) {
      statementTitle.addEventListener("input", () => {
        state.statementDraft.title = statementTitle.value;
      });
    }
    if (statementText) {
      statementText.addEventListener("input", () => {
        state.statementDraft.text = statementText.value;
      });
    }

    statementForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitStatement();
    });
  }
}
function renderLeaderStudioMarkup() {
  return `
    <section id="leader-studio" class="leader-studio-v2">
      <header class="leader-studio-v2-head">
        <div>
          <p class="faction-kicker">Leader Studio</p>
          <h3>Редактирование сайта фракции</h3>
        </div>
        <div class="leader-tabs-v2">
          <button class="${state.editorTab === "settings" ? "active" : ""}" data-tab="settings" type="button">Главные настройки</button>
          <button class="${state.editorTab === "memos" ? "active" : ""}" data-tab="memos" type="button">Памятки</button>
          <button class="${state.editorTab === "guides" ? "active" : ""}" data-tab="guides" type="button">Гайды</button>
          <button class="${state.editorTab === "docs" ? "active" : ""}" data-tab="docs" type="button">Документооборот</button>
        </div>
      </header>

      <div class="leader-studio-v2-body">
        ${
          state.editorTab === "settings"
            ? renderSettingsPaneMarkup()
            : state.editorTab === "docs"
              ? renderDocumentsPaneMarkup()
              : renderMaterialsPaneMarkup(state.editorTab === "memos" ? "memo" : "guide")
        }
      </div>

      <div class="leader-studio-v2-foot">
        <button class="btn btn-primary" type="button" id="leader-save">Сохранить изменения</button>
        <p class="admin-message ${state.flash.type}" id="leader-flash">${escapeHtml(state.flash.text || "")}</p>
      </div>
    </section>
  `;
}

function renderSettingsPaneMarkup() {
  return `
    <div class="leader-settings-grid-v2">
      <article class="leader-card-v2">
        <h4>Основное</h4>
        <div class="form-group">
          <label class="form-label">Название фракции</label>
          <input class="field-input" id="edit-name" type="text" maxlength="120" value="${escapeHtml(state.draft.name)}" />
        </div>
        <div class="form-group">
          <label class="form-label">Описание</label>
          <textarea class="field-textarea" id="edit-description" maxlength="1600">${escapeHtml(state.draft.description)}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">ID сервера</label>
          <input class="field-input" id="edit-server-id" type="text" maxlength="64" value="${escapeHtml(state.draft.serverId)}" />
        </div>
        <div class="form-group">
          <label class="form-label">ID роли</label>
          <input class="field-input" id="edit-role-id" type="text" maxlength="64" value="${escapeHtml(state.draft.roleId)}" />
        </div>
        <div class="form-group">
          <label class="form-label">Webhook для заявлений Discord</label>
          <input class="field-input" id="edit-statement-webhook" type="text" maxlength="4096" value="${escapeHtml(
            state.draft.statementWebhookUrl || ""
          )}" placeholder="https://discord.com/api/webhooks/..." />
          <p class="form-help">Используется для публикации заявлений из раздела документооборота.</p>
        </div>
      </article>

      <article class="leader-card-v2">
        <h4>Оформление</h4>
        <div class="form-group">
          <label class="form-label">Аватар (ссылка или файл)</label>
          <input class="field-input" id="edit-avatar-url" type="text" maxlength="4096" value="${escapeHtml(state.draft.avatarUrl)}" />
          <input class="field-input" id="edit-avatar-file" type="file" accept="image/*" />
        </div>
        <div class="form-group">
          <label class="form-label">Баннер (ссылка или файл)</label>
          <input class="field-input" id="edit-banner-url" type="text" maxlength="4096" value="${escapeHtml(state.draft.bannerUrl)}" />
          <input class="field-input" id="edit-banner-file" type="file" accept="image/*" />
        </div>
      </article>
    </div>
  `;
}

function renderMaterialsPaneMarkup(kind) {
  const isMemo = kind === "memo";
  const entries = isMemo ? state.draft.memos : state.draft.guides;
  return `
    <div class="leader-materials-v2">
      <div class="leader-materials-v2-head">
        <h4>${isMemo ? "Памятки" : "Гайды"}</h4>
        <button class="btn btn-secondary" data-add="${kind}" type="button">+ Добавить</button>
      </div>
      <div class="leader-materials-v2-list">
        ${entries.length ? entries.map((entry, index) => renderEditorCardMarkup(kind, entry, index)).join("") : `<p class="library-empty">Раздел пока пуст.</p>`}
      </div>
    </div>
  `;
}

function renderDocumentsPaneMarkup() {
  return `
    <div class="leader-materials-v2">
      <div class="leader-materials-v2-head">
        <h4>Шаблоны документов</h4>
        <button class="btn btn-secondary" data-doc-add type="button">+ Добавить шаблон</button>
      </div>
      <div class="leader-materials-v2-list">
        ${
          state.draft.documents.length
            ? state.draft.documents
                .map((doc, index) => renderDocumentEditorCardMarkup(doc, index))
                .join("")
            : `<p class="library-empty">Раздел пока пуст.</p>`
        }
      </div>
    </div>
  `;
}

function renderDocumentEditorCardMarkup(doc, index) {
  return `
    <article class="editor-card-v2">
      <div class="editor-card-v2-head">
        <h5>Шаблон #${index + 1}</h5>
        <button class="btn btn-secondary" type="button" data-doc-remove="${escapeHtml(
          doc.id
        )}">Удалить</button>
      </div>
      <div class="form-group">
        <label class="form-label">Название</label>
        <input class="field-input" data-doc-field="title" data-doc-id="${escapeHtml(
          doc.id
        )}" type="text" maxlength="120" value="${escapeHtml(doc.title)}" />
      </div>
      <div class="editor-inline-v2">
        <input class="field-input" data-doc-field="category" data-doc-id="${escapeHtml(
          doc.id
        )}" type="text" maxlength="60" placeholder="Категория" value="${escapeHtml(doc.category)}" />
        <select class="field-input" data-doc-field="status" data-doc-id="${escapeHtml(doc.id)}">
          <option value="published" ${
            doc.status !== "draft" ? "selected" : ""
          }>Опубликовано</option>
          <option value="draft" ${doc.status === "draft" ? "selected" : ""}>Черновик</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Краткое описание</label>
        <textarea class="field-textarea" data-doc-field="summary" data-doc-id="${escapeHtml(
          doc.id
        )}" maxlength="300">${escapeHtml(doc.summary)}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Шаблон текста (переменные: {{ФИО}}, {{ID}}, ...)</label>
        <textarea class="field-textarea" data-doc-field="template" data-doc-id="${escapeHtml(
          doc.id
        )}" maxlength="12000">${escapeHtml(doc.template)}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Теги (через запятую)</label>
        <input class="field-input" data-doc-field="tags" data-doc-id="${escapeHtml(
          doc.id
        )}" type="text" maxlength="700" value="${escapeHtml(doc.tags.join(", "))}" />
      </div>
    </article>
  `;
}

function renderEditorCardMarkup(kind, entry, index) {
  return `
    <article class="editor-card-v2">
      <div class="editor-card-v2-head">
        <h5>${kind === "memo" ? "Памятка" : "Гайд"} #${index + 1}</h5>
        <button class="btn btn-secondary" type="button" data-remove="${kind}:${escapeHtml(entry.id)}">Удалить</button>
      </div>
      <div class="form-group">
        <label class="form-label">Заголовок</label>
        <input class="field-input" data-field="title" data-kind="${kind}" data-id="${escapeHtml(entry.id)}" type="text" value="${escapeHtml(entry.title)}" maxlength="100" />
      </div>
      <div class="editor-inline-v2">
        <select class="field-input" data-field="priority" data-kind="${kind}" data-id="${escapeHtml(entry.id)}">
          ${["critical", "high", "normal", "low"].map((p) => `<option value="${p}" ${entry.priority === p ? "selected" : ""}>${PRIORITY_LABELS[p]}</option>`).join("")}
        </select>
        <input class="field-input" data-field="minutes" data-kind="${kind}" data-id="${escapeHtml(entry.id)}" type="number" min="1" max="240" value="${entry.minutes || ""}" placeholder="Мин" />
      </div>
      <div class="editor-inline-v2">
        <select class="field-input" data-field="status" data-kind="${kind}" data-id="${escapeHtml(
          entry.id
        )}">
          <option value="published" ${
            entry.status !== "draft" ? "selected" : ""
          }>Опубликовано</option>
          <option value="draft" ${entry.status === "draft" ? "selected" : ""}>Черновик</option>
        </select>
        <input class="field-input" type="text" value="${escapeHtml(
          entry.whenToUse || ""
        )}" data-field="whenToUse" data-kind="${kind}" data-id="${escapeHtml(
          entry.id
        )}" placeholder="Когда применять" maxlength="500" />
      </div>
      <div class="form-group">
        <label class="form-label">Подробности</label>
        <textarea class="field-textarea" data-field="details" data-kind="${kind}" data-id="${escapeHtml(entry.id)}" maxlength="5000">${escapeHtml(entry.details)}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Медиа URL (по одному на строку)</label>
        <textarea class="field-textarea" data-field="media" data-kind="${kind}" data-id="${escapeHtml(
          entry.id
        )}" maxlength="12000">${escapeHtml((entry.media || []).map((m) => m.url).join("\n"))}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Теги (через запятую)</label>
        <input class="field-input" data-field="tags" data-kind="${kind}" data-id="${escapeHtml(entry.id)}" type="text" value="${escapeHtml(entry.tags.join(", "))}" maxlength="700" />
      </div>
    </article>
  `;
}

function bindLeaderEvents() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editorTab = button.getAttribute("data-tab") || "settings";
      render();
    });
  });

  const saveButton = document.getElementById("leader-save");
  if (saveButton) {
    saveButton.addEventListener("click", saveFaction);
  }

  if (state.editorTab === "settings") {
    bindSettingsPaneEvents();
    return;
  }

  if (state.editorTab === "docs") {
    const addDocButton = document.querySelector("[data-doc-add]");
    if (addDocButton) {
      addDocButton.addEventListener("click", () => {
        state.draft.documents.push(createEmptyDocument());
        render();
      });
    }

    document.querySelectorAll("[data-doc-remove]").forEach((button) => {
      button.addEventListener("click", () => {
        const docId = button.getAttribute("data-doc-remove") || "";
        state.draft.documents = state.draft.documents.filter(
          (doc) => String(doc.id) !== String(docId)
        );
        render();
      });
    });

    document.querySelectorAll("[data-doc-field][data-doc-id]").forEach((input) => {
      input.addEventListener("input", () => {
        const docId = input.getAttribute("data-doc-id") || "";
        const field = input.getAttribute("data-doc-field") || "";
        const doc = findDocumentById(docId);
        if (!doc || !field) return;
        applyDocumentField(doc, field, input.value);
      });
    });

    return;
  }

  document.querySelectorAll("[data-add]").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.getAttribute("data-add") || "memo";
      const target = kind === "memo" ? state.draft.memos : state.draft.guides;
      target.push(createEmptyMaterial(kind));
      render();
    });
  });

  document.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      const raw = button.getAttribute("data-remove") || "";
      const [kind, id] = raw.split(":");
      const target = kind === "memo" ? state.draft.memos : state.draft.guides;
      const next = target.filter((entry) => String(entry.id) !== String(id));
      if (kind === "memo") {
        state.draft.memos = next;
      } else {
        state.draft.guides = next;
      }
      render();
    });
  });

  document.querySelectorAll("[data-field][data-kind][data-id]").forEach((input) => {
    input.addEventListener("input", () => {
      const kind = input.getAttribute("data-kind") || "memo";
      const id = input.getAttribute("data-id") || "";
      const field = input.getAttribute("data-field") || "title";
      const entry = findEntry(kind, id);
      if (!entry) return;
      applyEntryField(entry, field, input.value);
    });
  });
}
function bindSettingsPaneEvents() {
  const nameInput = document.getElementById("edit-name");
  const descriptionInput = document.getElementById("edit-description");
  const serverIdInput = document.getElementById("edit-server-id");
  const roleIdInput = document.getElementById("edit-role-id");
  const statementWebhookInput = document.getElementById("edit-statement-webhook");
  const avatarUrlInput = document.getElementById("edit-avatar-url");
  const bannerUrlInput = document.getElementById("edit-banner-url");
  const avatarFileInput = document.getElementById("edit-avatar-file");
  const bannerFileInput = document.getElementById("edit-banner-file");

  if (nameInput) nameInput.addEventListener("input", () => { state.draft.name = nameInput.value; });
  if (descriptionInput) descriptionInput.addEventListener("input", () => { state.draft.description = descriptionInput.value; });
  if (serverIdInput) serverIdInput.addEventListener("input", () => { state.draft.serverId = serverIdInput.value; });
  if (roleIdInput) roleIdInput.addEventListener("input", () => { state.draft.roleId = roleIdInput.value; });
  if (statementWebhookInput) statementWebhookInput.addEventListener("input", () => { state.draft.statementWebhookUrl = statementWebhookInput.value.trim(); });
  if (avatarUrlInput) avatarUrlInput.addEventListener("input", () => { state.draft.avatarUrl = avatarUrlInput.value.trim(); });
  if (bannerUrlInput) bannerUrlInput.addEventListener("input", () => { state.draft.bannerUrl = bannerUrlInput.value.trim(); });

  if (avatarFileInput) {
    avatarFileInput.addEventListener("change", async () => {
      const file = avatarFileInput.files && avatarFileInput.files[0];
      if (!file) return;
      try {
        state.draft.avatarUrl = await toDataUrl(file);
        setFlash("Аватар загружен. Нажмите сохранить.", "ok");
        render();
      } catch (error) {
        setFlash(error.message || "Ошибка загрузки аватара.", "error");
        render();
      }
    });
  }

  if (bannerFileInput) {
    bannerFileInput.addEventListener("change", async () => {
      const file = bannerFileInput.files && bannerFileInput.files[0];
      if (!file) return;
      try {
        state.draft.bannerUrl = await toDataUrl(file);
        setFlash("Баннер загружен. Нажмите сохранить.", "ok");
        render();
      } catch (error) {
        setFlash(error.message || "Ошибка загрузки баннера.", "error");
        render();
      }
    });
  }
}

async function saveFaction() {
  setFlash("Сохранение...", "");
  render();

  const payload = {
    name: String(state.draft.name || "").trim(),
    description: String(state.draft.description || "").trim(),
    serverId: String(state.draft.serverId || "").trim(),
    roleId: String(state.draft.roleId || "").trim(),
    statementWebhookUrl: String(state.draft.statementWebhookUrl || "").trim(),
    avatarUrl: String(state.draft.avatarUrl || "").trim(),
    bannerUrl: String(state.draft.bannerUrl || "").trim(),
    memos: state.draft.memos.map(toPayloadMaterial),
    guides: state.draft.guides.map(toPayloadMaterial),
    documents: state.draft.documents.map(toPayloadDocument),
  };

  try {
    const response = await fetch(`/api/faction/site/${encodeURIComponent(slug)}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const fail = await safeJson(response);
      const reason = fail?.error || "Не удалось сохранить изменения.";
      const details = fail?.details ? ` ${fail.details}` : "";
      setFlash(`${reason}${details}`, "error");
      render();
      return;
    }

    const data = await response.json();
    state.draft = normalizeFaction(data.faction || state.draft);
    setFlash("Изменения сохранены.", "ok");
    render();
  } catch (error) {
    console.error("Save faction error:", error);
    setFlash("Ошибка сохранения.", "error");
    render();
  }
}

function toPayloadMaterial(entry) {
  return {
    id: String(entry.id || `mat_${makeId()}`).slice(0, 64),
    title: String(entry.title || "").trim().slice(0, 100),
    details: String(entry.details || "").trim().slice(0, 5000),
    steps: Array.isArray(entry.steps) ? entry.steps : [],
    whenToUse: String(entry.whenToUse || "").trim().slice(0, 500),
    mistakes: String(entry.mistakes || "").trim().slice(0, 900),
    reportItems: String(entry.reportItems || "").trim().slice(0, 900),
    tags: Array.isArray(entry.tags) ? entry.tags.slice(0, 20) : [],
    priority: normalizePriority(entry.priority),
    minutes: normalizeMinutes(entry.minutes),
    status: normalizeStatus(entry.status),
    media: normalizeMedia(entry.media),
    createdAt: String(entry.createdAt || new Date().toISOString()),
    updatedAt: new Date().toISOString(),
  };
}

function createEmptyMaterial(prefix) {
  return {
    id: `${prefix}_${makeId()}`,
    title: "",
    details: "",
    steps: [],
    whenToUse: "",
    mistakes: "",
    reportItems: "",
    tags: [],
    priority: "normal",
    minutes: null,
    status: "draft",
    media: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function applyEntryField(entry, field, raw) {
  if (field === "tags") {
    entry.tags = String(raw || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean).slice(0, 20);
  } else if (field === "media") {
    entry.media = String(raw || "")
      .split(/\r?\n/)
      .map((x) => normalizeUrl(x))
      .filter(Boolean)
      .map((url) => ({ type: inferMediaType(url), url }))
      .slice(0, 16);
  } else if (field === "priority") {
    entry.priority = normalizePriority(raw);
  } else if (field === "status") {
    entry.status = normalizeStatus(raw);
  } else if (field === "minutes") {
    entry.minutes = normalizeMinutes(raw);
  } else {
    entry[field] = String(raw || "");
  }
  entry.updatedAt = new Date().toISOString();
}

function toPayloadDocument(doc) {
  return {
    id: String(doc.id || `doc_${makeId()}`).slice(0, 64),
    title: String(doc.title || "").trim().slice(0, 120),
    category: String(doc.category || "").trim().slice(0, 60),
    summary: String(doc.summary || "").trim().slice(0, 300),
    template: String(doc.template || "").trim().slice(0, 12000),
    tags: normalizeTags(doc.tags),
    status: normalizeStatus(doc.status),
    createdAt: String(doc.createdAt || new Date().toISOString()),
    updatedAt: new Date().toISOString(),
  };
}

function createEmptyDocument() {
  return {
    id: `doc_${makeId()}`,
    title: "Новый шаблон",
    category: "",
    summary: "",
    template: "",
    tags: [],
    status: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function applyDocumentField(doc, field, raw) {
  if (field === "tags") {
    doc.tags = normalizeTags(raw);
  } else if (field === "status") {
    doc.status = normalizeStatus(raw);
  } else {
    doc[field] = String(raw || "");
  }
  doc.updatedAt = new Date().toISOString();
}

function getAllItems() {
  return [
    ...state.draft.memos.map((material) => ({ kind: "memo", material })),
    ...state.draft.guides.map((material) => ({ kind: "guide", material })),
  ];
}

function filterItems(items) {
  const query = state.search.toLowerCase();
  return items.filter((item) => {
    if (state.kind !== "all" && item.kind !== state.kind) return false;
    if (state.tag && !item.material.tags.includes(state.tag)) return false;
    if (state.favoritesOnly && !isFavorite(item.material.id)) return false;
    if (!query) return true;
    const haystack = [item.material.title, item.material.details, item.material.tags.join(" ")].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function sortItems(items) {
  const copy = [...items];
  if (state.sort === "title") return copy.sort((a, b) => a.material.title.localeCompare(b.material.title, "ru"));
  if (state.sort === "updated") return copy.sort((a, b) => new Date(b.material.updatedAt || 0).getTime() - new Date(a.material.updatedAt || 0).getTime());
  return copy.sort((a, b) => {
    const pDiff = (PRIORITY_ORDER[a.material.priority] ?? 2) - (PRIORITY_ORDER[b.material.priority] ?? 2);
    if (pDiff !== 0) return pDiff;
    return a.material.title.localeCompare(b.material.title, "ru");
  });
}

function getAllTags() {
  const tags = new Set();
  state.draft.memos.forEach((m) => m.tags.forEach((t) => tags.add(t)));
  state.draft.guides.forEach((m) => m.tags.forEach((t) => tags.add(t)));
  return Array.from(tags).sort((a, b) => a.localeCompare(b, "ru"));
}

function findEntry(kind, id) {
  const list = kind === "memo" ? state.draft.memos : state.draft.guides;
  return list.find((x) => String(x.id) === String(id));
}

function findDocumentById(id) {
  return state.draft.documents.find((x) => String(x.id) === String(id));
}

function findItemById(items, id) {
  return items.find((x) => String(x.material.id) === String(id));
}

function getDocumentValues(docId) {
  if (!state.documentFieldValues[docId]) {
    state.documentFieldValues[docId] = {};
  }
  return state.documentFieldValues[docId];
}

function extractTemplatePlaceholders(template) {
  const text = String(template || "");
  const regexp = /\{\{([^{}]{1,40})\}\}/g;
  const placeholders = new Set();
  let match;
  while ((match = regexp.exec(text))) {
    const key = String(match[1] || "").trim();
    if (key) placeholders.add(key);
  }
  return Array.from(placeholders);
}

function applyTemplateValues(template, values) {
  return String(template || "").replace(/\{\{([^{}]{1,40})\}\}/g, (_, key) => {
    const cleaned = String(key || "").trim();
    return String(values[cleaned] || "");
  });
}

function renderReaderMarkup(item) {
  if (!item) return "";
  const material = item.material;
  const media = Array.isArray(material.media) ? material.media : [];
  return `
    <div class="reader-overlay-v2">
      <article class="reader-card-v2">
        <button class="reader-close-v2" type="button" data-reader-close>×</button>
        <p class="faction-kicker">${item.kind === "memo" ? "Памятка" : "Гайд"}</p>
        <h3>${escapeHtml(material.title || "Без названия")}</h3>
        <div class="reader-meta-v2">
          <span class="priority-badge ${priorityClass(material.priority)}">${formatPriority(material.priority)}</span>
          ${material.minutes ? `<span class="type-badge">~ ${material.minutes} мин</span>` : ""}
          ${
            material.status === "draft"
              ? `<span class="type-badge draft-badge">Черновик</span>`
              : `<span class="type-badge published-badge">Опубликовано</span>`
          }
        </div>
        ${material.whenToUse ? `<p><strong>Когда применять:</strong> ${escapeHtml(material.whenToUse)}</p>` : ""}
        ${material.details ? `<p>${escapeHtml(material.details)}</p>` : ""}
        ${material.steps.length ? `<ol>${material.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>` : ""}
        ${
          material.mistakes
            ? `<p><strong>Частые ошибки:</strong> ${escapeHtml(material.mistakes)}</p>`
            : ""
        }
        ${
          material.reportItems
            ? `<p><strong>Что отправить в отчет:</strong> ${escapeHtml(material.reportItems)}</p>`
            : ""
        }
        ${
          media.length
            ? `<div class="reader-media-v2">${media
                .map((entry) => renderMediaMarkup(entry))
                .join("")}</div>`
            : ""
        }
      </article>
    </div>
  `;
}

function renderMediaMarkup(entry) {
  const url = escapeHtml(entry.url || "");
  if (!url) return "";
  if (entry.type === "video") {
    const youtubeEmbed = toYoutubeEmbedUrl(entry.url);
    if (youtubeEmbed) {
      return `<iframe class="reader-media-frame" src="${escapeHtml(
        youtubeEmbed
      )}" title="Видео материал" loading="lazy" allowfullscreen></iframe>`;
    }
    return `<video class="reader-media-video" controls src="${url}"></video>`;
  }
  return `<img class="reader-media-image" src="${url}" alt="Медиа материал" />`;
}

function renderDocumentReaderMarkup(doc) {
  if (!doc) return "";
  const placeholders = extractTemplatePlaceholders(doc.template);
  const values = getDocumentValues(doc.id);
  const filledTemplate = applyTemplateValues(doc.template, values);

  return `
    <div class="reader-overlay-v2">
      <article class="reader-card-v2 document-reader-v2">
        <button class="reader-close-v2" type="button" data-doc-close>×</button>
        <p class="faction-kicker">Документооборот</p>
        <h3>${escapeHtml(doc.title)}</h3>
        <p>${escapeHtml(doc.summary || "Шаблон документа")}</p>
        ${
          placeholders.length
            ? `<div class="document-fields-v2">
                ${placeholders
                  .map(
                    (field) => `
                  <label class="form-label">
                    ${escapeHtml(field)}
                    <input class="field-input" type="text" data-doc-field="${escapeHtml(
                      field
                    )}" value="${escapeHtml(values[field] || "")}" />
                  </label>
                `
                  )
                  .join("")}
              </div>`
            : ""
        }
        <div class="document-template-v2">
          <h4>Готовый текст</h4>
          <textarea id="document-filled-template" class="field-textarea">${escapeHtml(
            filledTemplate
          )}</textarea>
          <button class="btn btn-secondary" type="button" data-doc-copy>Скопировать текст</button>
        </div>
      </article>
    </div>
  `;
}
function heroBgStyle() {
  if (!state.draft.bannerUrl) {
    return "background: linear-gradient(120deg, rgba(12,12,12,.95), rgba(22,22,22,.78));";
  }
  return `background-image: linear-gradient(120deg, rgba(0,0,0,.75), rgba(0,0,0,.5)), url('${escapeHtml(state.draft.bannerUrl)}');`;
}

function toDataUrl(file) {
  if (!file) return Promise.resolve("");
  if (file.size > MAX_FILE_SIZE) {
    return Promise.reject(new Error("Файл больше 3 MB."));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      if (result.length > MAX_DATA_URL_CHARS) {
        reject(new Error("Изображение слишком большое после кодирования."));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(new Error("Не удалось прочитать файл."));
    reader.readAsDataURL(file);
  });
}

function loadFavorites() {
  try {
    const raw = localStorage.getItem(`dj_favorites_${slug}`);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((x) => String(x || "")));
  } catch {
    return new Set();
  }
}

function toggleFavorite(id) {
  const key = String(id || "");
  if (!key) return;
  if (state.favorites.has(key)) {
    state.favorites.delete(key);
  } else {
    state.favorites.add(key);
  }
  try {
    localStorage.setItem(`dj_favorites_${slug}`, JSON.stringify(Array.from(state.favorites)));
  } catch {
    // ignore localStorage failures
  }
}

function isFavorite(id) {
  return state.favorites.has(String(id || ""));
}

function priorityClass(priority) {
  return `priority-${normalizePriority(priority)}`;
}

function formatPriority(priority) {
  return PRIORITY_LABELS[normalizePriority(priority)] || PRIORITY_LABELS.normal;
}

function formatDate(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "Недавно";
  const diffMinutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMinutes < 1) return "только что";
  if (diffMinutes < 60) return `${diffMinutes} мин назад`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} ч назад`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} д назад`;
  return date.toLocaleDateString("ru-RU");
}

function getInitials(text) {
  const value = String(text || "").trim();
  if (!value) return "F";
  const parts = value.split(/\s+/).filter(Boolean);
  return `${parts[0][0] || "F"}${parts[1] ? parts[1][0] : ""}`.toUpperCase();
}

function extractSlugFromPath() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] !== "factions") return "";
  return parts[1] || "";
}

function truncate(value, max = 180) {
  const text = String(value || "");
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function submitStatement() {
  const payload = {
    type: String(state.statementDraft.type || "other"),
    title: String(state.statementDraft.title || "").trim(),
    text: String(state.statementDraft.text || "").trim(),
  };

  state.statementStatus = "Отправка заявления...";
  state.statementStatusType = "";
  render();

  try {
    const response = await fetch(`/api/faction/site/${encodeURIComponent(slug)}/statements`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const fail = await safeJson(response);
      const reason = fail?.error || "Не удалось отправить заявление.";
      const details = fail?.details ? ` ${fail.details}` : "";
      state.statementStatus = `${reason}${details}`;
      state.statementStatusType = "error";
      render();
      return;
    }

    state.statementStatus = "Заявление отправлено в Discord.";
    state.statementStatusType = "ok";
    state.statementDraft.title = "";
    state.statementDraft.text = "";
    state.statementDraft.type = "request";
    render();
  } catch (error) {
    console.error("Statement submit error:", error);
    state.statementStatus = "Ошибка отправки заявления.";
    state.statementStatusType = "error";
    render();
  }
}

function toYoutubeEmbedUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.hostname.includes("youtu.be")) {
      const id = parsed.pathname.replace("/", "").trim();
      return id ? `https://www.youtube.com/embed/${id}` : "";
    }
    if (parsed.hostname.includes("youtube.com")) {
      const id = parsed.searchParams.get("v");
      return id ? `https://www.youtube.com/embed/${id}` : "";
    }
    return "";
  } catch {
    return "";
  }
}

async function copyText(text) {
  const content = String(text || "");
  if (!content) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(content);
    return;
  }
  const probe = document.createElement("textarea");
  probe.value = content;
  document.body.appendChild(probe);
  probe.select();
  document.execCommand("copy");
  probe.remove();
}

function setFlash(text, type = "") {
  state.flash.text = text || "";
  state.flash.type = type || "";
}

function setStatus(text, isError = false) {
  if (!statusNode) return;
  statusNode.textContent = text;
  statusNode.classList.remove("error");
  if (isError) statusNode.classList.add("error");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
