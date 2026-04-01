const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");
const { URL } = require("node:url");

const ROOT_DIR = __dirname;
const ENV_PATH = path.join(ROOT_DIR, ".env");
const SESSION_COOKIE_NAME = "dj_sid";
const OAUTH_NEXT_COOKIE_NAME = "dj_next";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

loadEnvFile(ENV_PATH);

const PORT = Number(process.env.PORT || 3000);
const IS_RAILWAY = Boolean(
  process.env.RAILWAY_ENVIRONMENT ||
    process.env.RAILWAY_PROJECT_ID ||
    process.env.RAILWAY_SERVICE_ID
);
const HOST = process.env.HOST || (IS_RAILWAY ? "0.0.0.0" : "127.0.0.1");
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "";
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || "";
const DISCORD_REDIRECT_URI =
  process.env.DISCORD_REDIRECT_URI || `${BASE_URL}/auth/discord/callback`;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomUUID();
const USE_SECURE_COOKIE = process.env.NODE_ENV === "production";
const ADMIN_DISCORD_IDS = (process.env.ADMIN_DISCORD_IDS || "953290565838053466")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const DATA_DIR = path.join(ROOT_DIR, "data");
const SETTINGS_PATH = path.join(DATA_DIR, "site-settings.json");
const FACTION_STATE_PATH = path.join(DATA_DIR, "faction-state.json");
const MAX_JSON_BODY_BYTES = Number(process.env.MAX_JSON_BODY_BYTES || 16 * 1024 * 1024);
const MAX_IMAGE_DATA_URL_CHARS = Number(
  process.env.MAX_IMAGE_DATA_URL_CHARS || 3_200_000
);
const MATERIAL_PRIORITY_VALUES = new Set(["low", "normal", "high", "critical"]);
const MATERIAL_STATUS_VALUES = new Set(["draft", "published"]);
const STATEMENT_TYPE_VALUES = new Set([
  "complaint",
  "report",
  "request",
  "appeal",
  "other",
]);
const GLOBAL_STATEMENTS_WEBHOOK_URL = process.env.STATEMENTS_WEBHOOK_URL || "";
const DEFAULT_SETTINGS = {
  announcement: {
    enabled: false,
    title: "",
    text: "",
  },
};
const DEFAULT_FACTION_STATE = {
  leaders: [],
  factions: {},
};

const sessions = new Map();
let siteSettings = loadSettings();
let factionState = loadFactionState();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

const server = http.createServer(async (req, res) => {
  try {
    cleanupExpiredSessions();

    const requestUrl = new URL(req.url, BASE_URL);
    const pathname = requestUrl.pathname;
    const factionPageMatch = pathname.match(/^\/factions\/([^/]+)$/i);
    const factionApiMatch = pathname.match(/^\/api\/faction\/site\/([^/]+)$/i);
    const factionStatementApiMatch = pathname.match(
      /^\/api\/faction\/site\/([^/]+)\/statements$/i
    );

    if (factionStatementApiMatch && req.method === "POST") {
      return handleFactionStatementCreate(
        req,
        res,
        decodeURIComponent(factionStatementApiMatch[1])
      );
    }

    if (factionApiMatch && req.method === "GET") {
      return handleFactionSiteRead(req, res, decodeURIComponent(factionApiMatch[1]));
    }

    if (factionApiMatch && req.method === "PUT") {
      return handleFactionSiteUpdate(req, res, decodeURIComponent(factionApiMatch[1]));
    }

    if (pathname === "/api/settings/public" && req.method === "GET") {
      return handlePublicSettings(req, res);
    }

    if (pathname === "/api/me" && req.method === "GET") {
      return handleMe(req, res);
    }

    if (pathname === "/api/admin/status" && req.method === "GET") {
      return handleAdminStatus(req, res);
    }

    if (pathname === "/api/admin/leaders" && req.method === "GET") {
      return handleAdminLeaders(req, res);
    }

    if (pathname === "/api/admin/leaders" && req.method === "PUT") {
      return handleAdminLeadersUpdate(req, res);
    }

    if (pathname === "/api/admin/settings" && req.method === "GET") {
      return handleAdminSettings(req, res);
    }

    if (pathname === "/api/admin/settings" && req.method === "PUT") {
      return handleAdminSettingsUpdate(req, res);
    }

    if ((pathname === "/auth/discord" || pathname === "/auth/discord/") && req.method === "GET") {
      return handleDiscordAuth(req, res, requestUrl);
    }

    if (
      (pathname === "/auth/discord/callback" || pathname === "/auth/discord/callback/") &&
      req.method === "GET"
    ) {
      return handleDiscordCallback(req, res, requestUrl);
    }

    if (pathname === "/auth/logout" && req.method === "POST") {
      return handleLogout(req, res);
    }

    if (pathname === "/api/faction/me" && req.method === "GET") {
      return handleMyFaction(req, res);
    }

    if (pathname === "/api/faction/me/create" && req.method === "POST") {
      return handleCreateMyFaction(req, res);
    }

    if (pathname === "/api/faction/me" && req.method === "PUT") {
      return handleUpdateMyFaction(req, res);
    }

    if (pathname === "/admin.html" && (req.method === "GET" || req.method === "HEAD")) {
      return handleAdminPage(req, res, req.method);
    }

    if (factionPageMatch && (req.method === "GET" || req.method === "HEAD")) {
      return handleFactionSitePage(req, res, req.method, decodeURIComponent(factionPageMatch[1]));
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      return sendJson(res, 405, { error: "Method not allowed" });
    }

    return serveStaticFile(pathname, res, req.method);
  } catch (error) {
    console.error("Unhandled server error:", error);
    return sendJson(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Davis Justice server running on ${BASE_URL}`);
});

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    value = value.replace(/^['"]|['"]$/g, "");

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function loadSettings() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (!fs.existsSync(SETTINGS_PATH)) {
      const defaults = JSON.stringify(DEFAULT_SETTINGS, null, 2);
      fs.writeFileSync(SETTINGS_PATH, defaults, "utf-8");
      return JSON.parse(defaults);
    }

    const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return sanitizeSettings(parsed);
  } catch (error) {
    console.error("Failed to load settings, using defaults:", error);
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }
}

function sanitizeSettings(input) {
  const source = input && typeof input === "object" ? input : {};
  const announcement =
    source.announcement && typeof source.announcement === "object"
      ? source.announcement
      : {};

  const title = String(announcement.title || "").trim().slice(0, 120);
  const text = String(announcement.text || "").trim().slice(0, 700);

  return {
    announcement: {
      enabled: Boolean(announcement.enabled && text),
      title,
      text,
    },
  };
}

function saveSettings(nextSettings) {
  siteSettings = sanitizeSettings(nextSettings);
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(siteSettings, null, 2), "utf-8");
  return siteSettings;
}

function loadFactionState() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (!fs.existsSync(FACTION_STATE_PATH)) {
      const defaults = JSON.stringify(DEFAULT_FACTION_STATE, null, 2);
      fs.writeFileSync(FACTION_STATE_PATH, defaults, "utf-8");
      return JSON.parse(defaults);
    }

    const raw = fs.readFileSync(FACTION_STATE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return sanitizeFactionState(parsed);
  } catch (error) {
    console.error("Failed to load faction state, using defaults:", error);
    return JSON.parse(JSON.stringify(DEFAULT_FACTION_STATE));
  }
}

function sanitizeFactionState(input) {
  const source = input && typeof input === "object" ? input : {};

  const leaders = Array.isArray(source.leaders)
    ? source.leaders
        .map((id) => String(id || "").trim())
        .filter(Boolean)
        .slice(0, 500)
    : [];

  const factionsSource =
    source.factions && typeof source.factions === "object" ? source.factions : {};
  const factions = {};
  const usedSlugs = new Set();

  for (const [ownerId, faction] of Object.entries(factionsSource)) {
    const cleanOwnerId = String(ownerId || "").trim();
    if (!cleanOwnerId) continue;
    const seedSlug = slugifyFactionName(
      String(faction?.slug || faction?.name || `faction-${cleanOwnerId.slice(-6)}`)
    );
    const uniqueSlug = ensureUniqueFactionSlug(seedSlug, usedSlugs, "", false);
    factions[cleanOwnerId] = sanitizeFactionPayload(
      {
        ...(faction && typeof faction === "object" ? faction : {}),
        slug: uniqueSlug,
      },
      cleanOwnerId,
      true
    );
  }

  return {
    leaders: Array.from(new Set(leaders)),
    factions,
  };
}

function saveFactionState(nextState) {
  factionState = sanitizeFactionState(nextState);
  fs.writeFileSync(FACTION_STATE_PATH, JSON.stringify(factionState, null, 2), "utf-8");
  return factionState;
}

function slugifyFactionName(value) {
  const ascii = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return ascii || "faction";
}

function ensureUniqueFactionSlug(
  baseSlug,
  usedSet,
  skipOwnerId = "",
  includeCurrentState = true
) {
  const base = slugifyFactionName(baseSlug);
  let candidate = base;
  let idx = 2;

  const existsInState = (slug) => {
    return Object.entries(factionState.factions).some(([ownerId, faction]) => {
      if (skipOwnerId && ownerId === skipOwnerId) return false;
      return String(faction?.slug || "") === slug;
    });
  };

  while (usedSet.has(candidate) || (includeCurrentState && existsInState(candidate))) {
    candidate = `${base}-${idx}`;
    idx += 1;
  }

  usedSet.add(candidate);
  return candidate;
}

function createMaterialId(prefix = "mat") {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function normalizeMaterialPriority(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (MATERIAL_PRIORITY_VALUES.has(normalized)) {
    return normalized;
  }
  return "normal";
}

function normalizeMaterialMinutes(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const rounded = Math.round(numeric);
  if (rounded < 1 || rounded > 240) {
    return null;
  }

  return rounded;
}

function normalizeMaterialStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return MATERIAL_STATUS_VALUES.has(normalized) ? normalized : "published";
}

function sanitizeMediaUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return /^https?:\/\/\S+$/i.test(raw) ? raw.slice(0, 4096) : "";
}

function sanitizeMediaType(value, urlValue) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "image" || raw === "video") return raw;
  const lowered = String(urlValue || "").toLowerCase();
  if (
    lowered.includes("youtube.com/") ||
    lowered.includes("youtu.be/") ||
    /\.(mp4|webm|ogg)(\?|#|$)/i.test(lowered)
  ) {
    return "video";
  }
  return "image";
}

function sanitizeMediaArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry === "string") {
        const url = sanitizeMediaUrl(entry);
        if (!url) return null;
        return { type: sanitizeMediaType("", url), url };
      }

      const source = entry && typeof entry === "object" ? entry : {};
      const url = sanitizeMediaUrl(source.url);
      if (!url) return null;
      return {
        type: sanitizeMediaType(source.type, url),
        url,
      };
    })
    .filter(Boolean)
    .slice(0, 16);
}

function createDocumentId() {
  return `doc_${crypto.randomBytes(6).toString("hex")}`;
}

function sanitizeDocumentItem(input, preserveMeta) {
  const source = input && typeof input === "object" ? input : {};
  const nowIso = new Date().toISOString();
  const toString = (value, max) => String(value || "").trim().slice(0, max);
  const toTags = (value) => {
    if (Array.isArray(value)) {
      return value
        .map((entry) => toString(entry, 40).toLowerCase())
        .filter(Boolean)
        .slice(0, 20);
    }
    if (typeof value === "string") {
      return value
        .split(",")
        .map((entry) => toString(entry, 40).toLowerCase())
        .filter(Boolean)
        .slice(0, 20);
    }
    return [];
  };

  return {
    id: toString(source.id, 64) || createDocumentId(),
    title: toString(source.title, 120) || "Untitled document",
    category: toString(source.category, 60),
    summary: toString(source.summary, 300),
    template: toString(source.template, 12000),
    tags: toTags(source.tags),
    status: normalizeMaterialStatus(source.status),
    createdAt: preserveMeta && source.createdAt ? String(source.createdAt) : nowIso,
    updatedAt: preserveMeta && source.updatedAt ? String(source.updatedAt) : nowIso,
  };
}

function sanitizeDocumentArray(value, preserveMeta) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => sanitizeDocumentItem(entry, preserveMeta))
    .slice(0, 120);
}

function sanitizeWebhookUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!/^https:\/\/\S+$/i.test(raw)) {
    return "";
  }
  return raw.slice(0, 4096);
}

function sanitizeStatementType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return STATEMENT_TYPE_VALUES.has(normalized) ? normalized : "other";
}

function sanitizeMaterialItem(input, preserveMeta, prefix = "mat") {
  const source = input && typeof input === "object" ? input : {};
  const rawText = typeof input === "string" ? String(input || "").trim() : "";
  const nowIso = new Date().toISOString();

  const toString = (value, max) => String(value || "").trim().slice(0, max);
  const toStringArray = (value, maxItems, maxLen) => {
    if (Array.isArray(value)) {
      return value
        .map((entry) => toString(entry, maxLen))
        .filter(Boolean)
        .slice(0, maxItems);
    }

    if (typeof value === "string") {
      return value
        .split(/\r?\n/)
        .map((entry) => toString(entry, maxLen))
        .filter(Boolean)
        .slice(0, maxItems);
    }

    return [];
  };

  const toTags = (value) => {
    if (Array.isArray(value)) {
      return value
        .map((entry) => toString(entry, 40).toLowerCase())
        .filter(Boolean)
        .slice(0, 20);
    }

    if (typeof value === "string") {
      return value
        .split(",")
        .map((entry) => toString(entry, 40).toLowerCase())
        .filter(Boolean)
        .slice(0, 20);
    }

    return [];
  };

  const titleFromText = rawText ? toString(rawText.split(/\r?\n/)[0], 100) : "";
  const title = toString(source.title || titleFromText, 100);
  const details = toString(source.details || rawText, 5000);

  return {
    id: toString(source.id, 64) || createMaterialId(prefix),
    title: title || "Untitled",
    priority: normalizeMaterialPriority(source.priority),
    minutes: normalizeMaterialMinutes(source.minutes),
    status: normalizeMaterialStatus(source.status),
    whenToUse: toString(source.whenToUse, 500),
    steps: toStringArray(source.steps, 30, 300),
    mistakes: toString(source.mistakes, 900),
    reportItems: toString(source.reportItems, 900),
    details,
    tags: toTags(source.tags),
    media: sanitizeMediaArray(source.media),
    createdAt: preserveMeta && source.createdAt ? String(source.createdAt) : nowIso,
    updatedAt: preserveMeta && source.updatedAt ? String(source.updatedAt) : nowIso,
  };
}

function sanitizeMaterialArray(value, preserveMeta, prefix = "mat") {
  const source = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray(value.items)
      ? value.items
      : [];
  if (!source.length) {
    return [];
  }

  return source
    .map((entry) => sanitizeMaterialItem(entry, preserveMeta, prefix))
    .slice(0, 120);
}

function sanitizeRevisionLog(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const source = entry && typeof entry === "object" ? entry : {};
      const toString = (input, max) => String(input || "").trim().slice(0, max);
      return {
        at: toString(source.at, 80) || new Date().toISOString(),
        editorId: toString(source.editorId, 40),
        editorName: toString(source.editorName, 120),
        action: toString(source.action, 240),
      };
    })
    .slice(0, 100);
}

function sanitizeFactionPayload(input, ownerDiscordId, preserveMeta) {
  const source = input && typeof input === "object" ? input : {};
  const nowIso = new Date().toISOString();

  const toString = (value, max) => String(value || "").trim().slice(0, max);
  const toImageRef = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/^https?:\/\/\S+$/i.test(raw)) {
      return raw.slice(0, 4096);
    }
    if (raw.startsWith("data:image/") && raw.length <= MAX_IMAGE_DATA_URL_CHARS) {
      return raw;
    }
    return "";
  };

  const result = {
    ownerDiscordId: String(ownerDiscordId),
    slug: slugifyFactionName(source.slug || `faction-${String(ownerDiscordId).slice(-6)}`),
    name: toString(source.name, 120),
    description: toString(source.description, 1600),
    serverId: toString(source.serverId, 64),
    roleId: toString(source.roleId, 64),
    avatarUrl: toImageRef(source.avatarUrl),
    bannerUrl: toImageRef(source.bannerUrl),
    memos: sanitizeMaterialArray(source.memos, preserveMeta, "memo"),
    guides: sanitizeMaterialArray(source.guides, preserveMeta, "guide"),
    documents: sanitizeDocumentArray(source.documents, preserveMeta),
    statementWebhookUrl: sanitizeWebhookUrl(source.statementWebhookUrl),
    revisionLog: sanitizeRevisionLog(source.revisionLog),
    updatedAt: preserveMeta && source.updatedAt ? String(source.updatedAt) : nowIso,
  };

  if (preserveMeta && source.createdAt) {
    result.createdAt = String(source.createdAt);
  } else {
    result.createdAt = nowIso;
  }

  return result;
}

function createSessionId() {
  const entropy = `${crypto.randomUUID()}:${Date.now()}`;
  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(entropy)
    .digest("hex");
}

function parseCookies(req) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) {
    return {};
  }

  const result = {};
  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const [rawName, ...rawValueParts] = pair.trim().split("=");
    if (!rawName) {
      continue;
    }
    result[rawName] = decodeURIComponent(rawValueParts.join("=") || "");
  }
  return result;
}

function appendSetCookie(res, cookieValue) {
  const existing = res.getHeader("Set-Cookie");
  if (!existing) {
    res.setHeader("Set-Cookie", cookieValue);
    return;
  }

  if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", [...existing, cookieValue]);
    return;
  }

  res.setHeader("Set-Cookie", [String(existing), cookieValue]);
}

function setSessionCookie(res, sessionId, maxAgeSec = Math.floor(SESSION_TTL_MS / 1000)) {
  const secureFlag = USE_SECURE_COOKIE ? "; Secure" : "";
  appendSetCookie(
    res,
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(
      sessionId
    )}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSec}${secureFlag}`
  );
}

function clearSessionCookie(res) {
  const secureFlag = USE_SECURE_COOKIE ? "; Secure" : "";
  appendSetCookie(
    res,
    `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secureFlag}`
  );
}

function setOAuthNextCookie(res, nextPath, maxAgeSec = Math.floor(OAUTH_STATE_TTL_MS / 1000)) {
  const secureFlag = USE_SECURE_COOKIE ? "; Secure" : "";
  appendSetCookie(
    res,
    `${OAUTH_NEXT_COOKIE_NAME}=${encodeURIComponent(
      nextPath
    )}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSec}${secureFlag}`
  );
}

function clearOAuthNextCookie(res) {
  const secureFlag = USE_SECURE_COOKIE ? "; Secure" : "";
  appendSetCookie(
    res,
    `${OAUTH_NEXT_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secureFlag}`
  );
}

function createSignedOAuthState() {
  const nonce = crypto.randomBytes(16).toString("hex");
  const ts = Date.now().toString(36);
  const payload = `${nonce}.${ts}`;
  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(`oauth:${payload}`)
    .digest("hex")
    .slice(0, 32);
  return `${payload}.${signature}`;
}

function verifySignedOAuthState(stateValue) {
  if (!stateValue || typeof stateValue !== "string") {
    return false;
  }

  const [nonce, ts, signature] = stateValue.split(".");
  if (!nonce || !ts || !signature) {
    return false;
  }

  if (!/^[a-f0-9]{32}$/i.test(nonce) || !/^[a-z0-9]+$/i.test(ts) || !/^[a-f0-9]{32}$/i.test(signature)) {
    return false;
  }

  const payload = `${nonce}.${ts}`;
  const expected = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(`oauth:${payload}`)
    .digest("hex")
    .slice(0, 32);

  const providedBuffer = Buffer.from(signature, "utf-8");
  const expectedBuffer = Buffer.from(expected, "utf-8");
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    return false;
  }

  const issuedAt = parseInt(ts, 36);
  if (!Number.isFinite(issuedAt)) {
    return false;
  }

  const now = Date.now();
  if (issuedAt > now + 60 * 1000) {
    return false;
  }

  return now - issuedAt <= OAUTH_STATE_TTL_MS;
}

function getSession(req, res, { createIfMissing = false } = {}) {
  const cookies = parseCookies(req);
  let sessionId = cookies[SESSION_COOKIE_NAME];
  let session = sessionId ? sessions.get(sessionId) : null;

  if (session) {
    session.updatedAt = Date.now();
    return { sessionId, session };
  }

  if (!createIfMissing) {
    return { sessionId: null, session: null };
  }

  sessionId = createSessionId();
  session = {
    createdAt: Date.now(),
    updatedAt: Date.now(),
    user: null,
    oauthState: null,
    nextPath: null,
  };
  sessions.set(sessionId, session);
  setSessionCookie(res, sessionId);
  return { sessionId, session };
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    const age = now - (session.updatedAt || session.createdAt);
    if (age > SESSION_TTL_MS) {
      sessions.delete(sessionId);
    }
  }
}

function isAdminUser(user) {
  if (!user || !user.id) {
    return false;
  }
  return ADMIN_DISCORD_IDS.includes(String(user.id));
}

function isLeaderUser(user) {
  if (!user || !user.id) {
    return false;
  }
  return factionState.leaders.includes(String(user.id));
}

function getAuthorizedUser(req, res) {
  const { session } = getSession(req, res);
  if (!session || !session.user) {
    sendJson(res, 401, { error: "Auth required" });
    return null;
  }
  return session.user;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
  });
  res.end();
}

function handleMe(req, res) {
  const { session } = getSession(req, res);
  if (!session || !session.user) {
    return sendJson(res, 200, { authenticated: false });
  }

  const admin = isAdminUser(session.user);
  const leader = isLeaderUser(session.user);
  return sendJson(res, 200, {
    authenticated: true,
    isAdmin: admin,
    isLeader: leader,
    user: {
      ...session.user,
      isAdmin: admin,
      isLeader: leader,
    },
  });
}

function handlePublicSettings(req, res) {
  return sendJson(res, 200, siteSettings);
}

function getAuthorizedAdmin(req, res) {
  const user = getAuthorizedUser(req, res);
  if (!user) {
    return null;
  }

  if (!isAdminUser(user)) {
    sendJson(res, 403, { error: "Admin access denied" });
    return null;
  }

  return user;
}

function getAuthorizedLeader(req, res) {
  const user = getAuthorizedUser(req, res);
  if (!user) {
    return null;
  }

  if (!isLeaderUser(user)) {
    sendJson(res, 403, { error: "Leader access denied" });
    return null;
  }

  return user;
}

function handleAdminStatus(req, res) {
  const user = getAuthorizedAdmin(req, res);
  if (!user) {
    return;
  }

  return sendJson(res, 200, {
    ok: true,
    user: {
      ...user,
      isAdmin: true,
      isLeader: isLeaderUser(user),
    },
  });
}

function handleAdminLeaders(req, res) {
  const user = getAuthorizedAdmin(req, res);
  if (!user) {
    return;
  }

  return sendJson(res, 200, {
    leaders: factionState.leaders,
  });
}

async function handleAdminLeadersUpdate(req, res) {
  const user = getAuthorizedAdmin(req, res);
  if (!user) {
    return;
  }

  try {
    const payload = await parseJsonBody(req);
    const discordId = String(payload.discordId || "").trim();
    const action = String(payload.action || "").trim().toLowerCase();

    if (!discordId || !/^\d{8,30}$/.test(discordId)) {
      return sendJson(res, 400, { error: "Invalid Discord ID" });
    }

    const nextLeaders = new Set(factionState.leaders);
    if (action === "grant") {
      nextLeaders.add(discordId);
    } else if (action === "revoke") {
      nextLeaders.delete(discordId);
    } else {
      return sendJson(res, 400, { error: "Action must be grant or revoke" });
    }

    saveFactionState({
      ...factionState,
      leaders: Array.from(nextLeaders),
    });

    return sendJson(res, 200, {
      ok: true,
      leaders: factionState.leaders,
    });
  } catch (error) {
    return sendBodyParseError(res, error);
  }
}

function handleAdminSettings(req, res) {
  const user = getAuthorizedAdmin(req, res);
  if (!user) {
    return;
  }

  return sendJson(res, 200, siteSettings);
}

async function handleAdminSettingsUpdate(req, res) {
  const user = getAuthorizedAdmin(req, res);
  if (!user) {
    return;
  }

  try {
    const payload = await parseJsonBody(req);
    const nextSettings = saveSettings(payload || {});
    return sendJson(res, 200, {
      ok: true,
      settings: nextSettings,
    });
  } catch (error) {
    return sendBodyParseError(res, error);
  }
}

function getFactionRecordBySlug(rawSlug) {
  const slug = slugifyFactionName(rawSlug);
  for (const [ownerId, faction] of Object.entries(factionState.factions)) {
    if (String(faction?.slug || "") === slug) {
      return { ownerId, faction };
    }
  }
  return null;
}

function toPublicFaction(faction, { includeDrafts = false, includePrivate = false } = {}) {
  if (!faction) return null;
  const slug = String(faction.slug || "");
  const memos = sanitizeMaterialArray(faction.memos, true, "memo").filter(
    (entry) => includeDrafts || entry.status === "published"
  );
  const guides = sanitizeMaterialArray(faction.guides, true, "guide").filter(
    (entry) => includeDrafts || entry.status === "published"
  );
  const documents = sanitizeDocumentArray(faction.documents, true).filter(
    (entry) => includeDrafts || entry.status === "published"
  );
  return {
    slug,
    siteUrl: slug ? `/factions/${slug}` : "",
    name: faction.name,
    description: faction.description,
    serverId: faction.serverId,
    roleId: faction.roleId,
    avatarUrl: faction.avatarUrl || "",
    bannerUrl: faction.bannerUrl || "",
    memos,
    guides,
    documents,
    revisionLog: sanitizeRevisionLog(faction.revisionLog),
    ...(includePrivate
      ? {
          statementWebhookUrl: sanitizeWebhookUrl(faction.statementWebhookUrl || ""),
        }
      : {}),
    createdAt: faction.createdAt || null,
    updatedAt: faction.updatedAt || null,
  };
}

function handleMyFaction(req, res) {
  const { session } = getSession(req, res);
  if (!session || !session.user) {
    return sendJson(res, 200, {
      authenticated: false,
      isLeader: false,
      faction: null,
    });
  }

  const leader = isLeaderUser(session.user);
  const faction = factionState.factions[String(session.user.id)] || null;
  return sendJson(res, 200, {
    authenticated: true,
    isLeader: leader,
    faction: faction
      ? toPublicFaction(faction, { includeDrafts: leader, includePrivate: leader })
      : null,
  });
}

function handleCreateMyFaction(req, res) {
  const user = getAuthorizedLeader(req, res);
  if (!user) {
    return;
  }

  const ownerId = String(user.id);
  if (!factionState.factions[ownerId]) {
    const uniqueSlug = ensureUniqueFactionSlug(
      slugifyFactionName(`faction-${ownerId.slice(-6)}`),
      new Set(),
      ownerId
    );
    factionState.factions[ownerId] = sanitizeFactionPayload(
      { slug: uniqueSlug },
      ownerId,
      false
    );
    saveFactionState(factionState);
  }

  return sendJson(res, 200, {
    ok: true,
    faction: toPublicFaction(factionState.factions[ownerId], {
      includeDrafts: true,
      includePrivate: true,
    }),
  });
}

async function handleUpdateMyFaction(req, res) {
  const user = getAuthorizedLeader(req, res);
  if (!user) {
    return;
  }

  const ownerId = String(user.id);
  if (!factionState.factions[ownerId]) {
    return sendJson(res, 404, { error: "Faction not created yet" });
  }

  try {
    const payload = await parseJsonBody(req);
    const currentFaction = factionState.factions[ownerId];
    let nextSlug = slugifyFactionName(currentFaction.slug || "");
    if (!nextSlug) {
      nextSlug = ensureUniqueFactionSlug(
        slugifyFactionName(payload?.name || `faction-${ownerId.slice(-6)}`),
        new Set(),
        ownerId
      );
    }

    const sanitized = sanitizeFactionPayload(
      {
        ...currentFaction,
        ...(payload || {}),
        slug: nextSlug,
        revisionLog: currentFaction.revisionLog,
      },
      ownerId,
      true
    );
    factionState.factions[ownerId] = {
      ...currentFaction,
      ...sanitized,
      ownerDiscordId: ownerId,
      updatedAt: new Date().toISOString(),
      createdAt: currentFaction.createdAt || new Date().toISOString(),
    };
    saveFactionState(factionState);

    return sendJson(res, 200, {
      ok: true,
      faction: toPublicFaction(factionState.factions[ownerId], {
        includeDrafts: true,
        includePrivate: true,
      }),
    });
  } catch (error) {
    return sendBodyParseError(res, error);
  }
}

function handleFactionSiteRead(req, res, rawSlug) {
  const record = getFactionRecordBySlug(rawSlug);
  if (!record) {
    return sendJson(res, 404, { error: "Faction not found" });
  }

  const { session } = getSession(req, res);
  const user = session?.user || null;
  const isOwnerLeader = Boolean(
    user && String(user.id) === String(record.ownerId) && isLeaderUser(user)
  );

  return sendJson(res, 200, {
    authenticated: Boolean(user),
    isLeader: Boolean(user && isLeaderUser(user)),
    canEdit: isOwnerLeader,
    faction: toPublicFaction(record.faction, {
      includeDrafts: isOwnerLeader,
      includePrivate: isOwnerLeader,
    }),
  });
}

async function handleFactionSiteUpdate(req, res, rawSlug) {
  const record = getFactionRecordBySlug(rawSlug);
  if (!record) {
    return sendJson(res, 404, { error: "Faction not found" });
  }

  const user = getAuthorizedUser(req, res);
  if (!user) {
    return;
  }

  const isOwnerLeader =
    String(user.id) === String(record.ownerId) && isLeaderUser(user);
  if (!isOwnerLeader) {
    return sendJson(res, 403, { error: "Only faction Leader can edit this site" });
  }

  try {
    const payload = await parseJsonBody(req);
    const currentFaction = factionState.factions[record.ownerId];
    const sanitized = sanitizeFactionPayload(
      {
        ...currentFaction,
        ...(payload || {}),
        slug: currentFaction.slug,
        revisionLog: currentFaction.revisionLog,
      },
      record.ownerId,
      true
    );

    const nowIso = new Date().toISOString();
    const revisionLog = [
      {
        at: nowIso,
        editorId: String(user.id || ""),
        editorName: String(user.displayName || user.username || "Leader"),
        action: "Обновлены настройки, памятки и гайды фракции",
      },
      ...sanitizeRevisionLog(currentFaction.revisionLog),
    ].slice(0, 100);

    factionState.factions[record.ownerId] = {
      ...currentFaction,
      ...sanitized,
      ownerDiscordId: String(record.ownerId),
      slug: currentFaction.slug,
      revisionLog,
      updatedAt: nowIso,
      createdAt: currentFaction.createdAt || new Date().toISOString(),
    };
    saveFactionState(factionState);

    return sendJson(res, 200, {
      ok: true,
      faction: toPublicFaction(factionState.factions[record.ownerId], {
        includeDrafts: true,
        includePrivate: true,
      }),
    });
  } catch (error) {
    return sendBodyParseError(res, error);
  }
}

async function handleFactionStatementCreate(req, res, rawSlug) {
  const record = getFactionRecordBySlug(rawSlug);
  if (!record) {
    return sendJson(res, 404, { error: "Faction not found" });
  }

  const user = getAuthorizedUser(req, res);
  if (!user) {
    return;
  }

  let payload;
  try {
    payload = await parseJsonBody(req);
  } catch (error) {
    return sendBodyParseError(res, error);
  }

  try {
    const type = sanitizeStatementType(payload?.type);
    const title = String(payload?.title || "").trim().slice(0, 180) || "Заявление";
    const text = String(payload?.text || "").trim().slice(0, 3500);

    if (text.length < 10) {
      return sendJson(res, 400, {
        error: "Statement text is too short",
        details: "Minimum length is 10 characters.",
      });
    }

    const faction = factionState.factions[record.ownerId];
    const webhookUrl = sanitizeWebhookUrl(
      faction?.statementWebhookUrl || GLOBAL_STATEMENTS_WEBHOOK_URL
    );
    if (!webhookUrl) {
      return sendJson(res, 400, {
        error: "Statement webhook is not configured",
        details: "Set webhook URL in faction settings or STATEMENTS_WEBHOOK_URL in .env.",
      });
    }

    const statementTypeLabelMap = {
      complaint: "Жалоба",
      report: "Рапорт",
      request: "Запрос",
      appeal: "Апелляция",
      other: "Другое",
    };

    const embed = {
      title,
      description: text,
      color: 11184810,
      fields: [
        {
          name: "Фракция",
          value: String(faction?.name || "Unknown faction").slice(0, 1024),
          inline: true,
        },
        {
          name: "Тип",
          value: statementTypeLabelMap[type] || "Другое",
          inline: true,
        },
        {
          name: "Автор",
          value: String(user.displayName || user.username || "Unknown user").slice(0, 1024),
          inline: true,
        },
        {
          name: "Discord ID",
          value: String(user.id || "").slice(0, 1024) || "Unknown",
          inline: true,
        },
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: "Davis Justice • Заявление с сайта фракции",
      },
    };

    const webhookPayload = {
      username: "Davis Justice",
      embeds: [embed],
    };

    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(webhookPayload),
    });

    if (!webhookResponse.ok) {
      const responseText = await webhookResponse.text();
      console.error("Statement webhook failed:", webhookResponse.status, responseText);
      return sendJson(res, 502, {
        error: "Failed to deliver statement to webhook",
        details: `Discord responded with status ${webhookResponse.status}.`,
      });
    }

    return sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error("Failed to create statement:", error);
    return sendJson(res, 500, {
      error: "Failed to process statement",
      details: "Unexpected server error.",
    });
  }
}

function validateDiscordConfig() {
  return Boolean(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && DISCORD_REDIRECT_URI);
}

function handleDiscordAuth(req, res, requestUrl) {
  const requestedNext = sanitizeNextPath(requestUrl.searchParams.get("next"));
  const redirectPath = requestedNext || "/";

  if (!validateDiscordConfig()) {
    const configErrorTarget = appendAuthError(redirectPath, "config");
    return redirect(res, configErrorTarget);
  }

  const { session } = getSession(req, res, { createIfMissing: true });
  const state = createSignedOAuthState();
  session.oauthState = state;
  session.nextPath = redirectPath;
  session.updatedAt = Date.now();
  setOAuthNextCookie(res, redirectPath);

  const authUrl = new URL("https://discord.com/oauth2/authorize");
  authUrl.searchParams.set("client_id", DISCORD_CLIENT_ID);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "identify");
  authUrl.searchParams.set("redirect_uri", DISCORD_REDIRECT_URI);
  authUrl.searchParams.set("state", state);

  return redirect(res, authUrl.toString());
}

async function handleDiscordCallback(req, res, requestUrl) {
  const { session } = getSession(req, res, { createIfMissing: true });
  const cookies = parseCookies(req);
  const cookieNextPath = sanitizeNextPath(cookies[OAUTH_NEXT_COOKIE_NAME]);
  const redirectPath = sanitizeNextPath(session.nextPath) || cookieNextPath || "/";

  if (!validateDiscordConfig()) {
    clearOAuthNextCookie(res);
    return redirect(res, appendAuthError(redirectPath, "config"));
  }

  const error = requestUrl.searchParams.get("error");
  if (error) {
    clearOAuthNextCookie(res);
    session.oauthState = null;
    session.nextPath = null;
    session.updatedAt = Date.now();
    return redirect(res, appendAuthError(redirectPath, "discord"));
  }

  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const stateMatchesSession = Boolean(session.oauthState && state === session.oauthState);
  const stateHasValidSignature = verifySignedOAuthState(state);
  if (!code || !state || (!stateMatchesSession && !stateHasValidSignature)) {
    clearOAuthNextCookie(res);
    session.oauthState = null;
    session.nextPath = null;
    session.updatedAt = Date.now();
    return redirect(res, appendAuthError(redirectPath, "state"));
  }

  try {
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: DISCORD_REDIRECT_URI,
      }),
    });

    if (!tokenResponse.ok) {
      console.error("Discord token exchange failed:", await tokenResponse.text());
      clearOAuthNextCookie(res);
      session.oauthState = null;
      session.nextPath = null;
      session.updatedAt = Date.now();
      return redirect(res, appendAuthError(redirectPath, "token"));
    }

    const tokenPayload = await tokenResponse.json();
    const accessToken = tokenPayload.access_token;
    if (!accessToken) {
      clearOAuthNextCookie(res);
      session.oauthState = null;
      session.nextPath = null;
      session.updatedAt = Date.now();
      return redirect(res, appendAuthError(redirectPath, "token"));
    }

    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!userResponse.ok) {
      console.error("Discord user fetch failed:", await userResponse.text());
      clearOAuthNextCookie(res);
      session.oauthState = null;
      session.nextPath = null;
      session.updatedAt = Date.now();
      return redirect(res, appendAuthError(redirectPath, "user"));
    }

    const userPayload = await userResponse.json();
    const username = userPayload.username || "Unknown";
    const discriminator = userPayload.discriminator || "0";
    const displayName = userPayload.global_name || username;
    const avatarUrl = buildDiscordAvatarUrl(userPayload);

    session.user = {
      id: userPayload.id,
      username,
      discriminator,
      displayName,
      avatarUrl,
    };
    clearOAuthNextCookie(res);
    session.oauthState = null;
    session.nextPath = null;
    session.updatedAt = Date.now();

    return redirect(res, appendAuthSuccess(redirectPath));
  } catch (error) {
    console.error("Discord callback error:", error);
    clearOAuthNextCookie(res);
    session.oauthState = null;
    session.nextPath = null;
    session.updatedAt = Date.now();
    return redirect(res, appendAuthError(redirectPath, "internal"));
  }
}

function buildDiscordAvatarUrl(user) {
  if (!user || !user.id) {
    return null;
  }

  if (user.avatar) {
    const isGif = user.avatar.startsWith("a_");
    const ext = isGif ? "gif" : "png";
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`;
  }

  const fallbackIndex = Number(user.discriminator) % 5;
  return `https://cdn.discordapp.com/embed/avatars/${fallbackIndex}.png`;
}

function handleLogout(req, res) {
  const { sessionId } = getSession(req, res);
  if (sessionId) {
    sessions.delete(sessionId);
  }
  clearSessionCookie(res);
  clearOAuthNextCookie(res);
  res.writeHead(204, {
    "Cache-Control": "no-store",
  });
  res.end();
}

function parseJsonBody(req, maxBytes = MAX_JSON_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let body = "";
    let tooLarge = false;
    req.on("data", (chunk) => {
      if (tooLarge) {
        return;
      }

      body += chunk.toString("utf-8");
      if (Buffer.byteLength(body, "utf-8") > maxBytes) {
        tooLarge = true;
        reject(new Error("Payload too large"));
      }
    });

    req.on("end", () => {
      if (tooLarge) {
        return;
      }

      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", (error) => reject(error));
  });
}

function sendBodyParseError(res, error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("payload too large")) {
    const maxMb = Math.max(1, Math.round(MAX_JSON_BODY_BYTES / (1024 * 1024)));
    return sendJson(res, 413, {
      error: "Payload too large",
      details: `Reduce image size or use smaller files. Max request size is ${maxMb} MB.`,
    });
  }

  return sendJson(res, 400, {
    error: "Invalid JSON body",
    details: error?.message || "Unknown parse error",
  });
}

function handleAdminPage(req, res, method) {
  const { session } = getSession(req, res);
  if (!session || !session.user) {
    return redirect(res, appendAuthError("/", "auth_required"));
  }

  if (!isAdminUser(session.user)) {
    return redirect(res, appendAuthError("/", "forbidden"));
  }

  return serveStaticFile("/admin.html", res, method);
}

function handleFactionSitePage(req, res, method, rawSlug) {
  const record = getFactionRecordBySlug(rawSlug);
  if (!record) {
    return sendJson(res, 404, { error: "Faction not found" });
  }
  return serveStaticFile("/faction-site.html", res, method);
}

function serveStaticFile(pathname, res, method) {
  const normalizedPathname = pathname === "/" ? "/index.html" : pathname;
  const decodedPathname = decodeURIComponent(normalizedPathname);
  const safePath = path.normalize(decodedPathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(ROOT_DIR, safePath);

  if (!filePath.startsWith(ROOT_DIR)) {
    return sendJson(res, 400, { error: "Invalid path" });
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      return sendJson(res, 404, { error: "Not found" });
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stats.size,
    });

    if (method === "HEAD") {
      return res.end();
    }

    fs.createReadStream(filePath).pipe(res);
  });
}

function sanitizeNextPath(nextPath) {
  if (!nextPath || typeof nextPath !== "string") {
    return null;
  }

  const trimmed = nextPath.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.includes("\r") || trimmed.includes("\n")) {
    return null;
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("/auth/discord")) {
    return null;
  }

  if (lower.startsWith("/auth/logout")) {
    return null;
  }

  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return null;
  }

  return trimmed;
}

function appendAuthError(targetPath, code) {
  const target = new URL(targetPath, BASE_URL);
  target.searchParams.set("auth_error", code);
  return `${target.pathname}${target.search}${target.hash}`;
}

function appendAuthSuccess(targetPath) {
  const target = new URL(targetPath, BASE_URL);
  target.searchParams.set("auth", "success");
  return `${target.pathname}${target.search}${target.hash}`;
}

