const factionHero = document.getElementById("my-faction-hero");
const factionApp = document.getElementById("my-faction-app");

initMyFactionPage();

async function initMyFactionPage() {
  try {
    const response = await fetch("/api/faction/me", {
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
    if (!payload.authenticated || !payload.isLeader) {
      return;
    }

    factionHero.hidden = false;
    factionApp.hidden = false;

    if (!payload.faction) {
      renderCreateCard();
      return;
    }

    renderFactionSiteCard(payload.faction);
  } catch (error) {
    console.error("My faction init error:", error);
  }
}

function renderCreateCard() {
  factionApp.innerHTML = `
    <button class="faction-create-button" id="create-faction-button" type="button">
      <span class="plus-icon">+</span>
      <span class="plus-label">Создать сайт фракции</span>
    </button>
  `;

  const createButton = document.getElementById("create-faction-button");
  createButton.addEventListener("click", createFactionSite);
}

function renderFactionSiteCard(faction) {
  const safeName = escapeHtml(faction.name || "Моя фракция");
  const siteUrl = String(faction.siteUrl || "").trim();

  factionApp.innerHTML = `
    <section class="faction-site-card">
      <p class="page-kicker">Сайт создан</p>
      <h2>${safeName}</h2>
      <p class="hero-description">
        Редактирование и просмотр теперь проходят на отдельной странице фракции.
      </p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="${siteUrl}?edit=1">Открыть для редактирования</a>
        <a class="btn btn-secondary" href="${siteUrl}">Открыть режим просмотра</a>
      </div>
      <p class="admin-status">Ссылка фракции: <a class="home-link" href="${siteUrl}">${siteUrl}</a></p>
    </section>
  `;
}

async function createFactionSite() {
  try {
    const response = await fetch("/api/faction/me/create", {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    const siteUrl = payload?.faction?.siteUrl;
    if (siteUrl) {
      window.location.href = `${siteUrl}?edit=1`;
      return;
    }

    renderFactionSiteCard(payload.faction || {});
  } catch (error) {
    console.error("Create faction site error:", error);
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
