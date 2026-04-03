const revealElements = document.querySelectorAll(".reveal");

if ("IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    {
      threshold: 0.18,
    }
  );

  revealElements.forEach((element) => revealObserver.observe(element));
} else {
  revealElements.forEach((element) => element.classList.add("is-visible"));
}

const authWidget = document.querySelector("[data-auth-widget]");
const overviewAnnouncementCard = document.getElementById("overview-announcement");
const departmentNav = document.querySelector(".department-nav");
const pageUrl = new URL(window.location.href);
const authError = pageUrl.searchParams.get("auth_error");
const authSuccess = pageUrl.searchParams.get("auth");
let publicSettingsPromise = null;

initDynamicNav();

if (authError || authSuccess) {
  pageUrl.searchParams.delete("auth_error");
  pageUrl.searchParams.delete("auth");
  const cleanQuery = pageUrl.searchParams.toString();
  const cleanUrl = `${pageUrl.pathname}${cleanQuery ? `?${cleanQuery}` : ""}${pageUrl.hash}`;
  window.history.replaceState({}, "", cleanUrl);
}

if (authWidget) {
  initAuthWidget(authWidget, authError);
}

initAnnouncement();
initOverviewAnnouncement();

async function initDynamicNav() {
  if (!departmentNav) return;

  renderDynamicNav({ authenticated: false, isLeader: false, tabs: [] });
  try {
    const response = await fetch("/api/faction/nav", {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    renderDynamicNav(payload);
  } catch (error) {
    console.error("Dynamic nav load error:", error);
  }
}

function normalizePath(pathname) {
  const path = String(pathname || "").trim().toLowerCase();
  if (!path || path === "/") return "/";
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

function isOverviewPath(pathname) {
  const normalized = normalizePath(pathname);
  return normalized === "/" || normalized === "/index.html";
}

function isConsultantPath(pathname) {
  const normalized = normalizePath(pathname);
  return normalized === "/consultant.html";
}

function buildNavLink(href, text, isActive = false) {
  const link = document.createElement("a");
  link.href = href;
  link.textContent = text;
  if (isActive) {
    link.classList.add("active");
  }
  return link;
}

function buildFactionNavLink(tab, currentPath) {
  const siteUrl = String(tab?.siteUrl || "").trim();
  if (!siteUrl || !siteUrl.startsWith("/factions/")) {
    return null;
  }

  const link = document.createElement("a");
  link.href = siteUrl;
  link.className = "department-nav-faction-link";

  if (normalizePath(siteUrl) === currentPath) {
    link.classList.add("active");
  }

  const avatarWrap = document.createElement("span");
  avatarWrap.className = "department-nav-avatar";

  if (tab.avatarUrl) {
    const image = document.createElement("img");
    image.src = tab.avatarUrl;
    image.alt = `${tab.name || "Фракция"} avatar`;
    avatarWrap.appendChild(image);
  } else {
    const title = String(tab.name || "Ф").trim();
    avatarWrap.textContent = title[0] ? title[0].toUpperCase() : "Ф";
  }

  const textNode = document.createElement("span");
  textNode.textContent = String(tab.name || "Фракция");
  link.append(avatarWrap, textNode);
  return link;
}

function renderDynamicNav(payload) {
  if (!departmentNav) return;

  const currentPath = normalizePath(window.location.pathname);
  const tabs = Array.isArray(payload?.tabs) ? payload.tabs : [];
  const isLeader = Boolean(payload?.authenticated && payload?.isLeader);

  departmentNav.innerHTML = "";
  departmentNav.appendChild(
    buildNavLink("/index.html", "\u041e\u0431\u0437\u043e\u0440", isOverviewPath(currentPath))
  );
  departmentNav.appendChild(
    buildNavLink(
      "/consultant.html",
      "\u041a\u043e\u043d\u0441\u0443\u043b\u044c\u0442\u0430\u043d\u0442",
      isConsultantPath(currentPath)
    )
  );

  const seenUrls = new Set();
  tabs.forEach((tab) => {
    const key = String(tab?.siteUrl || "").trim();
    if (!key || seenUrls.has(key)) {
      return;
    }
    seenUrls.add(key);

    const link = buildFactionNavLink(tab, currentPath);
    if (link) {
      departmentNav.appendChild(link);
    }
  });

  if (isLeader) {
    departmentNav.appendChild(
      buildNavLink("/my-faction.html", "\u041c\u043e\u044f \u0444\u0440\u0430\u043a\u0446\u0438\u044f", currentPath === "/my-faction.html")
    );
  }
}

async function initAuthWidget(widget, authErrorCode) {
  const errorText = mapAuthError(authErrorCode);

  try {
    const response = await fetch("/api/me", {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Auth status failed: ${response.status}`);
    }

    const payload = await response.json();

    if (!payload.authenticated || !payload.user) {
      renderLogin(widget, errorText);
      return;
    }

    renderUser(widget, payload.user, errorText);
  } catch (error) {
    console.error("Auth widget error:", error);
    renderLogin(widget, errorText);
  }
}

function mapAuthError(code) {
  if (!code) return "";

  const errors = {
    auth_required: "Сначала войдите через Discord.",
    forbidden: "У вас нет доступа к этому разделу.",
    config: "OAuth Discord не настроен на сервере.",
    state: "Сессия входа устарела, попробуйте ещё раз.",
    discord: "Discord отклонил авторизацию.",
    token: "Ошибка токена Discord, повторите вход.",
    user: "Не удалось получить профиль Discord.",
    session: "Сессия не найдена, войдите повторно.",
    internal: "Внутренняя ошибка авторизации.",
  };

  return errors[code] || `Ошибка авторизации: ${code}`;
}

function renderLogin(widget, errorText = "") {
  widget.innerHTML = "";

  const nextPath = `${window.location.pathname}${window.location.search}`;
  const loginLink = document.createElement("a");
  loginLink.className = "auth-login-link";
  loginLink.href = `/auth/discord?next=${encodeURIComponent(nextPath)}`;
  loginLink.textContent = "Войти через Discord";
  widget.appendChild(loginLink);

  if (errorText) {
    const error = document.createElement("span");
    error.className = "auth-error";
    error.textContent = errorText;
    widget.appendChild(error);
  }
}

function renderUser(widget, user, errorText = "") {
  widget.innerHTML = "";

  const userPill = document.createElement("div");
  userPill.className = "auth-user";

  const avatar = document.createElement("img");
  avatar.className = "auth-avatar";
  avatar.src = user.avatarUrl || "https://cdn.discordapp.com/embed/avatars/0.png";
  avatar.alt = "Discord avatar";

  const name = document.createElement("span");
  name.className = "auth-name";
  name.textContent = user.displayName || user.username || "Discord";

  const logoutButton = document.createElement("button");
  logoutButton.type = "button";
  logoutButton.className = "auth-logout-btn";
  logoutButton.textContent = "Выйти";
  logoutButton.addEventListener("click", logout);

  userPill.append(avatar, name);
  widget.appendChild(userPill);

  if (user.isAdmin) {
    const adminLink = document.createElement("a");
    adminLink.className = "auth-admin-link";
    adminLink.href = "/admin.html";
    adminLink.textContent = "Админ";
    widget.appendChild(adminLink);
  }

  widget.appendChild(logoutButton);

  if (errorText) {
    const error = document.createElement("span");
    error.className = "auth-error";
    error.textContent = errorText;
    widget.appendChild(error);
  }
}

async function logout() {
  try {
    await fetch("/auth/logout", {
      method: "POST",
      credentials: "include",
    });
  } catch (error) {
    console.error("Logout error:", error);
  } finally {
    window.location.reload();
  }
}

async function initAnnouncement() {
  try {
    const payload = await getPublicSettings();
    if (!payload) return;

    const announcement = payload && payload.announcement;
    if (!announcement || !announcement.enabled || !announcement.text) {
      return;
    }

    const header = document.querySelector(".site-header");
    if (!header) return;

    const bar = document.createElement("section");
    bar.className = "announcement-bar";

    const container = document.createElement("div");
    container.className = "container announcement-wrap";

    const title = document.createElement("p");
    title.className = "announcement-title";
    title.textContent = announcement.title || "Объявление";

    const text = document.createElement("p");
    text.className = "announcement-text";
    text.textContent = announcement.text;

    container.append(title, text);
    bar.appendChild(container);
    header.insertAdjacentElement("afterend", bar);
  } catch (error) {
    console.error("Announcement load error:", error);
  }
}

async function initOverviewAnnouncement() {
  if (!overviewAnnouncementCard) return;

  const stateElement = document.getElementById("overview-announcement-state");
  const titleElement = document.getElementById("overview-announcement-title");
  const textElement = document.getElementById("overview-announcement-text");
  if (!stateElement || !titleElement || !textElement) return;

  try {
    const payload = await getPublicSettings();
    if (!payload) {
      stateElement.textContent = "Не удалось загрузить объявления.";
      titleElement.textContent = "Попробуйте обновить страницу";
      textElement.textContent =
        "Если проблема повторяется, проверьте доступность API и настройки сервера.";
      overviewAnnouncementCard.classList.add("is-empty");
      return;
    }

    const announcement = payload && payload.announcement;
    if (!announcement || !announcement.enabled || !announcement.text) {
      stateElement.textContent = "Сейчас активных объявлений нет.";
      titleElement.textContent = "Объявление пока не опубликовано";
      textElement.textContent =
        "Администратор может создать его в панели управления, после чего оно появится здесь автоматически.";
      overviewAnnouncementCard.classList.add("is-empty");
      return;
    }

    stateElement.textContent = "Актуальное объявление";
    titleElement.textContent = announcement.title || "Объявление";
    textElement.textContent = announcement.text;
    overviewAnnouncementCard.classList.remove("is-empty");
  } catch (error) {
    console.error("Overview announcement load error:", error);
    stateElement.textContent = "Ошибка загрузки.";
    titleElement.textContent = "Не удалось получить объявление";
    textElement.textContent = "Проверьте соединение и повторите попытку позже.";
    overviewAnnouncementCard.classList.add("is-empty");
  }
}

async function getPublicSettings() {
  if (!publicSettingsPromise) {
    publicSettingsPromise = fetch("/api/settings/public", {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    })
      .then((response) => {
        if (!response.ok) return null;
        return response.json();
      })
      .catch((error) => {
        console.error("Public settings load error:", error);
        return null;
      });
  }

  return publicSettingsPromise;
}
