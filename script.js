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
const pageUrl = new URL(window.location.href);
const authError = pageUrl.searchParams.get("auth_error");
const authSuccess = pageUrl.searchParams.get("auth");

ensureMyFactionNavLink();

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

function ensureMyFactionNavLink() {
  const nav = document.querySelector(".department-nav");
  if (!nav) return;

  let link = Array.from(nav.querySelectorAll("a")).find((anchor) => {
    const href = anchor.getAttribute("href") || "";
    return href.includes("my-faction.html");
  });

  if (!link) {
    link = document.createElement("a");
    link.href = "/my-faction.html";
    link.textContent = "Моя фракция";
    nav.appendChild(link);
  }

  const isMyFactionPage = window.location.pathname.toLowerCase().endsWith("/my-faction.html");
  if (isMyFactionPage) {
    nav.querySelectorAll("a").forEach((anchor) => anchor.classList.remove("active"));
    link.classList.add("active");
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
    forbidden: "Доступ к админ-панели только для администраторов.",
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
    const response = await fetch("/api/settings/public", {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) return;

    const payload = await response.json();
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
