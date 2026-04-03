const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");
const { URL } = require("node:url");

const ROOT_DIR = __dirname;
const ENV_PATH = path.join(ROOT_DIR, ".env");
const SESSION_COOKIE_NAME = "dj_sid";
const OAUTH_NEXT_COOKIE_NAME = "dj_next";
const AUTH_USER_COOKIE_NAME = "dj_auth";
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
const REQUIRED_DISCORD_OAUTH_SCOPES = ["identify", "guilds", "guilds.members.read"];
const DISCORD_OAUTH_SCOPE = buildDiscordOAuthScope(process.env.DISCORD_OAUTH_SCOPE || "");
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || "";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomUUID();
const USE_SECURE_COOKIE = process.env.NODE_ENV === "production";
const DISCORD_API_BASE_URL = "https://discord.com/api/v10";
const DISCORD_MEMBER_CACHE_TTL_MS = Number(process.env.DISCORD_MEMBER_CACHE_TTL_MS || 90_000);
const ADMIN_DISCORD_IDS = (process.env.ADMIN_DISCORD_IDS || "953290565838053466")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const DATA_DIR = path.join(ROOT_DIR, "data");
const SETTINGS_PATH = path.join(DATA_DIR, "site-settings.json");
const FACTION_STATE_PATH = path.join(DATA_DIR, "faction-state.json");
const MAX_JSON_BODY_BYTES = Number(process.env.MAX_JSON_BODY_BYTES || 16 * 1024 * 1024);
const CONSULTANT_MAX_FILES_PER_UPLOAD = Number(process.env.CONSULTANT_MAX_FILES_PER_UPLOAD || 8);
const CONSULTANT_MAX_FILES_PER_SERVER = Number(process.env.CONSULTANT_MAX_FILES_PER_SERVER || 60);
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
const MAJESTIC_SERVERS = [
  { id: "new-york", name: "New York" },
  { id: "washington", name: "Washington" },
  { id: "dallas", name: "Dallas" },
  { id: "boston", name: "Boston" },
  { id: "houston", name: "Houston" },
  { id: "seattle", name: "Seattle" },
  { id: "phoenix", name: "Phoenix" },
  { id: "denver", name: "Denver" },
  { id: "portland", name: "Portland" },
  { id: "orlando", name: "Orlando" },
  { id: "detroit", name: "Detroit" },
  { id: "chicago", name: "Chicago" },
  { id: "san-francisco", name: "San Francisco" },
  { id: "atlanta", name: "Atlanta" },
  { id: "san-diego", name: "San Diego" },
  { id: "los-angeles", name: "Los Angeles" },
  { id: "miami", name: "Miami" },
  { id: "las-vegas", name: "Las Vegas" },
];
const MAJESTIC_SERVER_MAP = new Map(MAJESTIC_SERVERS.map((server) => [server.id, server]));
const CONSULTANT_ALLOWED_FILE_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".txt"]);
const DEFAULT_SETTINGS = {
  announcement: {
    enabled: false,
    title: "",
    text: "",
  },
  consultant: {
    enabled: true,
    serverBases: {},
  },
};
const DEFAULT_FACTION_STATE = {
  leaders: [],
  factions: {},
};
const CONSULTANT_STOP_WORDS = new Set([
  "и",
  "в",
  "во",
  "на",
  "с",
  "со",
  "по",
  "к",
  "ко",
  "о",
  "об",
  "от",
  "до",
  "за",
  "под",
  "из",
  "для",
  "при",
  "между",
  "или",
  "либо",
  "а",
  "но",
  "что",
  "как",
  "когда",
  "где",
  "зачем",
  "почему",
  "это",
  "этот",
  "эта",
  "эти",
  "тот",
  "та",
  "те",
  "его",
  "ее",
  "их",
  "мы",
  "вы",
  "они",
  "я",
  "он",
  "она",
  "у",
  "же",
  "бы",
  "не",
  "да",
  "нет",
  "также",
  "так",
  "только",
  "если",
  "то",
  "из-за",
  "без",
  "the",
  "a",
  "an",
  "to",
  "of",
  "in",
  "on",
  "for",
  "and",
  "or",
  "is",
  "are",
]);

const sessions = new Map();
const discordMemberCache = new Map();
const discordMemberPending = new Map();
let cachedPdfParse = null;
let cachedMammoth = null;
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
      return await handleFactionSiteRead(req, res, decodeURIComponent(factionApiMatch[1]));
    }

    if (factionApiMatch && req.method === "PUT") {
      return handleFactionSiteUpdate(req, res, decodeURIComponent(factionApiMatch[1]));
    }

    if (pathname === "/api/settings/public" && req.method === "GET") {
      return handlePublicSettings(req, res);
    }

    if (pathname === "/api/consultant/ask" && req.method === "POST") {
      return handleConsultantAsk(req, res);
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

    if (pathname === "/api/admin/consultant/upload" && req.method === "POST") {
      return handleAdminConsultantUpload(req, res);
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

    if (pathname === "/api/faction/nav" && req.method === "GET") {
      return await handleFactionNav(req, res);
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
      return await handleFactionSitePage(
        req,
        res,
        req.method,
        decodeURIComponent(factionPageMatch[1])
      );
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

function buildDiscordOAuthScope(rawScope) {
  const extras = String(rawScope || "")
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);

  const uniqueExtras = extras.filter((scope, index) => extras.indexOf(scope) === index);
  const required = REQUIRED_DISCORD_OAUTH_SCOPES.slice();
  const merged = [...required];
  uniqueExtras.forEach((scope) => {
    if (!merged.includes(scope)) {
      merged.push(scope);
    }
  });

  return merged.join(" ");
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
  const consultant =
    source.consultant && typeof source.consultant === "object" ? source.consultant : {};
  const consultantEnabled =
    consultant.enabled === undefined
      ? DEFAULT_SETTINGS.consultant.enabled
      : Boolean(consultant.enabled);

  const title = String(announcement.title || "").trim().slice(0, 120);
  const text = String(announcement.text || "").trim().slice(0, 700);
  const rawServerBases =
    consultant.serverBases && typeof consultant.serverBases === "object"
      ? consultant.serverBases
      : {};
  const serverBases = {};
  let hasAnyServerText = false;

  MAJESTIC_SERVERS.forEach((server) => {
    const base = sanitizeConsultantServerBase(rawServerBases[server.id]);
    if (base.lawsText) {
      hasAnyServerText = true;
    }
    serverBases[server.id] = base;
  });

  // Migration for legacy schema with one global text field.
  const legacyLawsText = String(consultant.lawsText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .trim();
  if (!hasAnyServerText && legacyLawsText) {
    serverBases[MAJESTIC_SERVERS[0].id] = sanitizeConsultantServerBase({
      lawsText: legacyLawsText,
      files: [
        {
          id: `legacy-${Date.now()}`,
          name: "legacy-laws-text.txt",
          type: "text/plain",
          size: Buffer.byteLength(legacyLawsText, "utf-8"),
          uploadedAt: new Date().toISOString(),
        },
      ],
    });
  }

  return {
    announcement: {
      enabled: Boolean(announcement.enabled && text),
      title,
      text,
    },
    consultant: {
      enabled: consultantEnabled,
      serverBases,
    },
  };
}

function saveSettings(nextSettings) {
  siteSettings = sanitizeSettings(nextSettings);
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(siteSettings, null, 2), "utf-8");
  return siteSettings;
}

function sanitizeConsultantServerBase(input) {
  const source = input && typeof input === "object" ? input : {};
  const lawsText = String(source.lawsText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .trim();
  const files = Array.isArray(source.files)
    ? source.files
        .map((entry) => sanitizeConsultantFileMeta(entry))
        .filter(Boolean)
        .slice(0, CONSULTANT_MAX_FILES_PER_SERVER)
    : [];
  return {
    lawsText,
    files,
  };
}

function sanitizeConsultantFileMeta(input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const id = String(input.id || "").trim().slice(0, 120);
  const name = String(input.name || "").trim().slice(0, 240);
  if (!id || !name) {
    return null;
  }

  const type = String(input.type || "").trim().slice(0, 80) || "application/octet-stream";
  const size = Number(input.size || 0);
  const uploadedAtRaw = String(input.uploadedAt || "").trim();
  const uploadedAt = uploadedAtRaw && !Number.isNaN(Date.parse(uploadedAtRaw))
    ? new Date(uploadedAtRaw).toISOString()
    : new Date().toISOString();

  return {
    id,
    name,
    type,
    size: Number.isFinite(size) ? Math.max(0, Math.floor(size)) : 0,
    uploadedAt,
  };
}

function getMajesticServerInfo(serverId) {
  const cleanId = String(serverId || "").trim().toLowerCase();
  return MAJESTIC_SERVER_MAP.get(cleanId) || null;
}

function toPublicSettings(settings) {
  const source = settings && typeof settings === "object" ? settings : DEFAULT_SETTINGS;
  const announcement =
    source.announcement && typeof source.announcement === "object"
      ? source.announcement
      : DEFAULT_SETTINGS.announcement;
  const consultant =
    source.consultant && typeof source.consultant === "object"
      ? source.consultant
      : DEFAULT_SETTINGS.consultant;
  const consultantEnabled =
    consultant.enabled === undefined
      ? DEFAULT_SETTINGS.consultant.enabled
      : Boolean(consultant.enabled);
  const serverBases =
    consultant.serverBases && typeof consultant.serverBases === "object"
      ? consultant.serverBases
      : {};
  const servers = MAJESTIC_SERVERS.map((server) => {
    const base = sanitizeConsultantServerBase(serverBases[server.id]);
    return {
      id: server.id,
      name: server.name,
      hasLaws: Boolean(base.lawsText),
      filesCount: Array.isArray(base.files) ? base.files.length : 0,
    };
  });

  return {
    announcement: {
      enabled: Boolean(announcement.enabled && announcement.text),
      title: String(announcement.title || ""),
      text: String(announcement.text || ""),
    },
    consultant: {
      enabled: consultantEnabled,
      servers,
    },
  };
}

function toAdminSettingsResponse(settings) {
  const source = settings && typeof settings === "object" ? settings : DEFAULT_SETTINGS;
  const consultant =
    source.consultant && typeof source.consultant === "object"
      ? source.consultant
      : DEFAULT_SETTINGS.consultant;
  const serverBases =
    consultant.serverBases && typeof consultant.serverBases === "object"
      ? consultant.serverBases
      : {};
  const servers = MAJESTIC_SERVERS.map((server) => {
    const base = sanitizeConsultantServerBase(serverBases[server.id]);
    return {
      id: server.id,
      name: server.name,
      files: base.files,
      hasLaws: Boolean(base.lawsText),
      textChars: base.lawsText.length,
    };
  });

  return {
    announcement: {
      enabled: Boolean(source.announcement?.enabled),
      title: String(source.announcement?.title || ""),
      text: String(source.announcement?.text || ""),
    },
    consultant: {
      enabled: consultant.enabled === undefined ? true : Boolean(consultant.enabled),
      servers,
      limits: {
        maxFilesPerUpload: CONSULTANT_MAX_FILES_PER_UPLOAD,
        allowedExtensions: Array.from(CONSULTANT_ALLOWED_FILE_EXTENSIONS),
      },
    },
  };
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

function normalizeDiscordIdInput(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  // Accept pasted Discord mentions/URLs and keep only numeric ID.
  return raw.replace(/\D+/g, "").slice(0, 30);
}

function validateFactionDiscordConfig(faction) {
  const serverId = String(faction?.serverId || "").trim();
  const roleId = String(faction?.roleId || "").trim();

  if (serverId && !isDiscordSnowflake(serverId)) {
    return {
      ok: false,
      error: "Invalid faction server ID",
      details: "Server ID must be a valid numeric Discord ID (usually 17-20 digits).",
      field: "serverId",
    };
  }

  if (roleId && !isDiscordSnowflake(roleId)) {
    return {
      ok: false,
      error: "Invalid faction role ID",
      details: "Role ID must be a valid numeric Discord ID (usually 17-20 digits), or empty.",
      field: "roleId",
    };
  }

  return { ok: true };
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
    serverId: normalizeDiscordIdInput(source.serverId),
    roleId: normalizeDiscordIdInput(source.roleId),
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

function clearDiscordOAuthSession(session) {
  if (!session || typeof session !== "object") {
    return;
  }

  session.discordAccessToken = null;
  session.discordTokenType = null;
  session.discordAccessTokenExpiresAt = null;
}

function sanitizeGuildIdList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const guildIds = [];
  value.forEach((entry) => {
    const guildId = String(entry || "").trim();
    if (!isDiscordSnowflake(guildId) || seen.has(guildId)) {
      return;
    }
    seen.add(guildId);
    guildIds.push(guildId);
  });

  return guildIds.slice(0, 500);
}

function sanitizeAuthCookieUser(input) {
  const source = input && typeof input === "object" ? input : {};
  const id = String(source.id || "").trim().slice(0, 64);
  if (!id) {
    return null;
  }

  return {
    id,
    username: String(source.username || "").trim().slice(0, 120),
    discriminator: String(source.discriminator || "").trim().slice(0, 16),
    displayName: String(source.displayName || source.username || "").trim().slice(0, 160),
    avatarUrl: String(source.avatarUrl || "").trim().slice(0, 500),
    guildIds: sanitizeGuildIdList(source.guildIds),
  };
}

function toBase64Url(text) {
  return Buffer.from(String(text || ""), "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(input) {
  const normalized = String(input || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
  const padded = normalized + "=".repeat(padding);
  return Buffer.from(padded, "base64").toString("utf-8");
}

function createSignedAuthUserToken(user, ttlMs = SESSION_TTL_MS) {
  const sanitized = sanitizeAuthCookieUser(user);
  if (!sanitized) {
    return null;
  }

  const payload = toBase64Url(JSON.stringify(sanitized));
  const expiresAt = (Date.now() + Math.max(60 * 1000, Number(ttlMs) || SESSION_TTL_MS)).toString(36);
  const signedData = `${payload}.${expiresAt}`;
  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(`auth:${signedData}`)
    .digest("hex");
  return `${signedData}.${signature}`;
}

function parseSignedAuthUserToken(token) {
  if (!token || typeof token !== "string") {
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [payload, expiresAtRaw, signature] = parts;
  if (!payload || !expiresAtRaw || !signature || !/^[a-f0-9]{64}$/i.test(signature)) {
    return null;
  }

  const signedData = `${payload}.${expiresAtRaw}`;
  const expected = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(`auth:${signedData}`)
    .digest("hex");

  const providedBuffer = Buffer.from(signature, "utf-8");
  const expectedBuffer = Buffer.from(expected, "utf-8");
  if (providedBuffer.length !== expectedBuffer.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    return null;
  }

  const expiresAt = parseInt(expiresAtRaw, 36);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return null;
  }

  try {
    const decoded = fromBase64Url(payload);
    const parsed = JSON.parse(decoded);
    return sanitizeAuthCookieUser(parsed);
  } catch (error) {
    return null;
  }
}

function setAuthUserCookie(res, user, maxAgeSec = Math.floor(SESSION_TTL_MS / 1000)) {
  const token = createSignedAuthUserToken(user, maxAgeSec * 1000);
  if (!token) {
    return;
  }

  const secureFlag = USE_SECURE_COOKIE ? "; Secure" : "";
  appendSetCookie(
    res,
    `${AUTH_USER_COOKIE_NAME}=${encodeURIComponent(
      token
    )}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSec}${secureFlag}`
  );
}

function clearAuthUserCookie(res) {
  const secureFlag = USE_SECURE_COOKIE ? "; Secure" : "";
  appendSetCookie(
    res,
    `${AUTH_USER_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secureFlag}`
  );
}

function getAuthUserFromCookie(req) {
  const cookies = parseCookies(req);
  return parseSignedAuthUserToken(cookies[AUTH_USER_COOKIE_NAME]);
}

function getAuthenticatedUser(req, res, { createSessionIfNeeded = true } = {}) {
  let { session } = getSession(req, res);
  if (session && session.user) {
    return session.user;
  }

  const cookieUser = getAuthUserFromCookie(req);
  if (!cookieUser) {
    return null;
  }

  if (!session && createSessionIfNeeded) {
    ({ session } = getSession(req, res, { createIfMissing: true }));
  }

  if (session) {
    session.user = cookieUser;
    session.updatedAt = Date.now();
    return session.user;
  }

  return cookieUser;
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
    discordAccessToken: null,
    discordTokenType: null,
    discordAccessTokenExpiresAt: null,
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

function isDiscordSnowflake(value) {
  return /^\d{15,30}$/.test(String(value || "").trim());
}

async function fetchDiscordGuildMember(guildId, userId) {
  if (!DISCORD_BOT_TOKEN) {
    return { available: false, isMember: false, roles: [] };
  }

  if (!isDiscordSnowflake(guildId) || !isDiscordSnowflake(userId)) {
    return { available: false, isMember: false, roles: [] };
  }

  try {
    const response = await fetch(
      `${DISCORD_API_BASE_URL}/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(
        userId
      )}`,
      {
        headers: {
          Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
          Accept: "application/json",
        },
      }
    );

    if (response.status === 404) {
      return { available: true, isMember: false, roles: [] };
    }

    if (!response.ok) {
      const details = await response.text();
      console.error(
        `Discord guild member check failed (${response.status}) for guild ${guildId}:`,
        details
      );
      return { available: false, isMember: false, roles: [] };
    }

    const payload = await response.json();
    const roles = Array.isArray(payload.roles)
      ? payload.roles.map((roleId) => String(roleId || "").trim()).filter(Boolean)
      : [];
    return { available: true, isMember: true, roles };
  } catch (error) {
    console.error("Discord guild member request failed:", error);
    return { available: false, isMember: false, roles: [] };
  }
}

async function getDiscordGuildMember(guildId, userId) {
  const cacheKey = `${String(guildId)}:${String(userId)}`;
  const now = Date.now();
  const cached = discordMemberCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  if (discordMemberPending.has(cacheKey)) {
    return discordMemberPending.get(cacheKey);
  }

  const pending = fetchDiscordGuildMember(guildId, userId)
    .then((value) => {
      discordMemberCache.set(cacheKey, {
        value,
        expiresAt: Date.now() + Math.max(15_000, DISCORD_MEMBER_CACHE_TTL_MS),
      });
      return value;
    })
    .finally(() => {
      discordMemberPending.delete(cacheKey);
    });

  discordMemberPending.set(cacheKey, pending);
  return pending;
}

function getDiscordOAuthCredentialsFromSession(req, res) {
  const { session } = getSession(req, res);
  if (!session) {
    return null;
  }

  const accessToken = String(session.discordAccessToken || "").trim();
  if (!accessToken) {
    return null;
  }

  const expiresAt = Number(session.discordAccessTokenExpiresAt || 0);
  if (Number.isFinite(expiresAt) && expiresAt > 0 && Date.now() >= expiresAt) {
    return null;
  }

  const tokenType = String(session.discordTokenType || "Bearer").trim() || "Bearer";
  return { accessToken, tokenType };
}

async function fetchDiscordGuildMemberWithUserToken(guildId, oauth) {
  if (!oauth || !oauth.accessToken || !isDiscordSnowflake(guildId)) {
    return { available: false, isMember: false, roles: [] };
  }

  try {
    const response = await fetch(
      `${DISCORD_API_BASE_URL}/users/@me/guilds/${encodeURIComponent(guildId)}/member`,
      {
        headers: {
          Authorization: `${oauth.tokenType} ${oauth.accessToken}`,
          Accept: "application/json",
        },
      }
    );

    if (response.status === 404) {
      return { available: true, isMember: false, roles: [] };
    }

    if (!response.ok) {
      const details = await response.text();
      console.error(
        `Discord OAuth member check failed (${response.status}) for guild ${guildId}:`,
        details
      );
      return { available: false, isMember: false, roles: [] };
    }

    const payload = await response.json();
    const roles = Array.isArray(payload.roles)
      ? payload.roles.map((roleId) => String(roleId || "").trim()).filter(Boolean)
      : [];
    return { available: true, isMember: true, roles };
  } catch (error) {
    console.error("Discord OAuth guild member request failed:", error);
    return { available: false, isMember: false, roles: [] };
  }
}

async function fetchDiscordUserGuildIds(oauth) {
  if (!oauth || !oauth.accessToken) {
    return { available: false, guildIds: [] };
  }

  try {
    const response = await fetch(`${DISCORD_API_BASE_URL}/users/@me/guilds`, {
      headers: {
        Authorization: `${oauth.tokenType} ${oauth.accessToken}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const details = await response.text();
      console.error(`Discord OAuth guild list check failed (${response.status}):`, details);
      return { available: false, guildIds: [] };
    }

    const payload = await response.json();
    const guildIds = Array.isArray(payload)
      ? sanitizeGuildIdList(payload.map((guild) => guild?.id))
      : [];
    return { available: true, guildIds };
  } catch (error) {
    console.error("Discord OAuth guild list request failed:", error);
    return { available: false, guildIds: [] };
  }
}

async function fetchDiscordGuildMembershipFromUserGuilds(guildId, oauth) {
  if (!oauth || !oauth.accessToken || !isDiscordSnowflake(guildId)) {
    return { available: false, isMember: false, roles: [] };
  }

  const guildList = await fetchDiscordUserGuildIds(oauth);
  if (!guildList.available) {
    return { available: false, isMember: false, roles: [] };
  }

  return {
    available: true,
    isMember: guildList.guildIds.includes(String(guildId)),
    roles: [],
  };
}

async function getDiscordGuildMemberForRequest(req, res, guildId, userId) {
  const botMembership = await getDiscordGuildMember(guildId, userId);
  if (botMembership.available) {
    return botMembership;
  }

  const oauth = getDiscordOAuthCredentialsFromSession(req, res);
  if (!oauth) {
    return botMembership;
  }

  const oauthMember = await fetchDiscordGuildMemberWithUserToken(guildId, oauth);
  if (oauthMember.available) {
    return oauthMember;
  }

  const oauthGuildList = await fetchDiscordGuildMembershipFromUserGuilds(guildId, oauth);
  if (oauthGuildList.available) {
    return oauthGuildList;
  }

  return botMembership;
}

async function resolveFactionAccess(req, res, user, ownerId, faction) {
  const isOwnerLeader = Boolean(
    user && String(user.id) === String(ownerId) && isLeaderUser(user)
  );

  if (isOwnerLeader) {
    return {
      canView: true,
      canEdit: true,
      matchedBy: "leader",
    };
  }

  if (!user || !user.id) {
    return {
      canView: false,
      canEdit: false,
      matchedBy: "unauthenticated",
    };
  }

  const guildId = String(faction?.serverId || "").trim();
  const roleId = String(faction?.roleId || "").trim();
  if (!isDiscordSnowflake(guildId)) {
    return {
      canView: false,
      canEdit: false,
      matchedBy: "missing_server",
    };
  }

  const membership = await getDiscordGuildMemberForRequest(req, res, guildId, String(user.id));
  if (!membership.available) {
    const cachedGuildIds = sanitizeGuildIdList(user.guildIds);
    if (cachedGuildIds.includes(guildId)) {
      return {
        canView: true,
        canEdit: false,
        matchedBy: "guild_cache",
      };
    }
  }

  if (!membership.available || !membership.isMember) {
    return {
      canView: false,
      canEdit: false,
      matchedBy: membership.available ? "not_member" : "membership_check_failed",
    };
  }

  if (isDiscordSnowflake(roleId) && membership.roles.includes(roleId)) {
    return {
      canView: true,
      canEdit: false,
      matchedBy: "role",
    };
  }

  return {
    canView: true,
    canEdit: false,
    matchedBy: "member",
  };
}

async function getFactionTabsForUser(req, res, user) {
  if (!user || !user.id) {
    return [];
  }

  const checks = await Promise.all(
    Object.entries(factionState.factions).map(async ([ownerId, faction]) => {
      const access = await resolveFactionAccess(req, res, user, ownerId, faction);
      if (!access.canView) {
        return null;
      }

      const publicFaction = toPublicFaction(faction, {
        includeDrafts: access.canEdit,
        includePrivate: false,
      });
      if (!publicFaction?.siteUrl) {
        return null;
      }

      return {
        slug: publicFaction.slug,
        siteUrl: publicFaction.siteUrl,
        name: publicFaction.name || "Фракция",
        avatarUrl: publicFaction.avatarUrl || "",
        canEdit: access.canEdit,
      };
    })
  );

  return checks
    .filter(Boolean)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru"));
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
  const user = getAuthenticatedUser(req, res, { createSessionIfNeeded: true });
  if (!user) {
    sendJson(res, 401, { error: "Auth required" });
    return null;
  }
  return user;
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
  const user = getAuthenticatedUser(req, res, { createSessionIfNeeded: true });
  if (!user) {
    return sendJson(res, 200, { authenticated: false });
  }

  const admin = isAdminUser(user);
  const leader = isLeaderUser(user);
  return sendJson(res, 200, {
    authenticated: true,
    isAdmin: admin,
    isLeader: leader,
    user: {
      ...user,
      isAdmin: admin,
      isLeader: leader,
    },
  });
}

function handlePublicSettings(req, res) {
  return sendJson(res, 200, toPublicSettings(siteSettings));
}

async function handleConsultantAsk(req, res) {
  try {
    const payload = await parseJsonBody(req, MAX_JSON_BODY_BYTES);
    const question = String(payload?.question || "")
      .replace(/\s+/g, " ")
      .trim();
    const serverId = String(payload?.serverId || "")
      .trim()
      .toLowerCase();
    const serverInfo = getMajesticServerInfo(serverId);

    if (!question) {
      return sendJson(res, 400, {
        error: "Question is required",
        details: "Send question in JSON body: {\"question\":\"...\"}",
      });
    }
    if (!serverInfo) {
      return sendJson(res, 400, {
        error: "Invalid serverId",
        details: "Choose one of Majestic servers before sending the question.",
      });
    }

    const consultant =
      siteSettings?.consultant && typeof siteSettings.consultant === "object"
        ? siteSettings.consultant
        : DEFAULT_SETTINGS.consultant;
    if (!consultant.enabled) {
      return sendJson(res, 503, {
        error: "Consultant is disabled",
      });
    }

    const serverBases =
      consultant.serverBases && typeof consultant.serverBases === "object"
        ? consultant.serverBases
        : {};
    const serverBase = sanitizeConsultantServerBase(serverBases[serverInfo.id]);
    const lawsText = String(serverBase.lawsText || "").trim();
    if (!lawsText) {
      return sendJson(res, 409, {
        error: "Law base is empty",
        details: `Add files for ${serverInfo.name} in admin panel first.`,
      });
    }

    const result = buildConsultantResponse(question, lawsText);
    return sendJson(res, 200, {
      ok: true,
      server: {
        id: serverInfo.id,
        name: serverInfo.name,
      },
      ...result,
    });
  } catch (error) {
    return sendBodyParseError(res, error);
  }
}

function buildConsultantResponse(question, lawsText) {
  const chunks = splitLawTextIntoChunks(lawsText);
  const keywords = tokenizeConsultantQuery(question);
  const normalizedQuestion = normalizeConsultantText(question);
  const hasQuestionPhrase = normalizedQuestion.length >= 8;

  const ranked = chunks
    .map((chunk, index) => {
      const normalizedChunk = normalizeConsultantText(chunk.text);
      let score = 0;
      const matchedKeywords = [];

      keywords.forEach((keyword) => {
        if (!normalizedChunk.includes(keyword)) {
          return;
        }

        matchedKeywords.push(keyword);
        score += 2 + Math.min(4, Math.floor(keyword.length / 3));
      });

      for (let i = 0; i < keywords.length - 1; i += 1) {
        const phrase = `${keywords[i]} ${keywords[i + 1]}`;
        if (phrase.length > 7 && normalizedChunk.includes(phrase)) {
          score += 4;
        }
      }

      if (hasQuestionPhrase && normalizedChunk.includes(normalizedQuestion)) {
        score += 12;
      }

      if (/стат(ья|ьи|ей|ью)/i.test(question) && /стат(ья|ьи|ей|ью)/i.test(chunk.text)) {
        score += 2;
      }

      return {
        index,
        score,
        title: chunk.title || `Фрагмент ${index + 1}`,
        text: chunk.text,
        keywords: Array.from(new Set(matchedKeywords)).slice(0, 8),
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 3);

  if (!ranked.length) {
    return {
      question,
      answer:
        "В загруженных текстах не найдено прямого совпадения по формулировке вопроса. " +
        "Уточните ключевые слова (например: статья, срок, ответственность, порядок).",
      matches: [],
      notice:
        "Ответ формируется только по материалам, добавленным в админ-панели, и носит справочный характер.",
    };
  }

  const matches = ranked.map((entry, idx) => ({
    title: entry.title || `Фрагмент ${idx + 1}`,
    excerpt: buildConsultantExcerpt(entry.text, entry.keywords, 460),
    keywords: entry.keywords,
  }));

  const answerBody = matches
    .map((match, idx) => `${idx + 1}. ${match.excerpt}`)
    .join("\n\n");

  return {
    question,
    answer:
      `По вашему запросу найдены релевантные фрагменты:\n\n${answerBody}\n\n` +
      "Проверьте оригинальную формулировку нормы перед применением.",
    matches,
    notice:
      "Ответ формируется только по материалам, добавленным в админ-панели, и не заменяет юридическую консультацию.",
  };
}

function splitLawTextIntoChunks(rawText) {
  const normalized = String(rawText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .trim();
  if (!normalized) {
    return [];
  }

  const blocks = normalized
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  const chunks = [];

  blocks.forEach((block) => {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) {
      return;
    }

    const titleCandidate =
      lines.find((line) =>
        /^(статья|глава|раздел|часть|пункт|article|chapter)\b/i.test(line)
      ) || lines[0];
    const title = String(titleCandidate || "").slice(0, 120);
    const compact = lines.join(" ").replace(/\s+/g, " ").trim();
    if (!compact) {
      return;
    }

    if (compact.length <= 700) {
      chunks.push({ title, text: compact });
      return;
    }

    const sentences = compact.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (!sentences.length) {
      const parts = compact.match(/.{1,700}/g) || [];
      parts.forEach((part) => {
        chunks.push({ title, text: part.trim() });
      });
      return;
    }

    let buffer = "";
    sentences.forEach((sentence) => {
      const nextText = buffer ? `${buffer} ${sentence}` : sentence;
      if (nextText.length > 700 && buffer) {
        chunks.push({ title, text: buffer.trim() });
        buffer = sentence;
      } else {
        buffer = nextText;
      }
    });

    if (buffer.trim()) {
      chunks.push({ title, text: buffer.trim() });
    }
  });

  return chunks;
}

function normalizeConsultantText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeConsultantQuery(question) {
  const tokens = normalizeConsultantText(question).match(/[a-zа-я0-9]{2,}/g) || [];
  const unique = [];
  tokens.forEach((token) => {
    if (token.length < 2 || CONSULTANT_STOP_WORDS.has(token) || unique.includes(token)) {
      return;
    }
    unique.push(token);
  });
  return unique.slice(0, 24);
}

function buildConsultantExcerpt(text, keywords = [], maxLength = 460) {
  const source = String(text || "").replace(/\s+/g, " ").trim();
  if (source.length <= maxLength) {
    return source;
  }

  const lower = source.toLowerCase().replace(/ё/g, "е");
  let firstKeywordIndex = -1;
  keywords.forEach((keyword) => {
    const idx = lower.indexOf(keyword);
    if (idx < 0) return;
    if (firstKeywordIndex === -1 || idx < firstKeywordIndex) {
      firstKeywordIndex = idx;
    }
  });

  const pivot = firstKeywordIndex >= 0 ? firstKeywordIndex : 0;
  const start = Math.max(0, pivot - Math.floor(maxLength * 0.35));
  const rawSnippet = source.slice(start, start + maxLength).trim();
  const prefix = start > 0 ? "..." : "";
  const suffix = start + maxLength < source.length ? "..." : "";
  return `${prefix}${rawSnippet}${suffix}`;
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

  return sendJson(res, 200, toAdminSettingsResponse(siteSettings));
}

async function handleAdminSettingsUpdate(req, res) {
  const user = getAuthorizedAdmin(req, res);
  if (!user) {
    return;
  }

  try {
    const payload = await parseJsonBody(req);
    const current = siteSettings && typeof siteSettings === "object" ? siteSettings : {};
    const incoming = payload && typeof payload === "object" ? payload : {};
    const nextSettings = saveSettings({
      ...current,
      ...incoming,
      announcement: {
        ...(current.announcement || {}),
        ...(incoming.announcement && typeof incoming.announcement === "object"
          ? incoming.announcement
          : {}),
      },
      consultant: {
        ...(current.consultant || {}),
        enabled:
          incoming.consultant && typeof incoming.consultant === "object"
            ? Boolean(incoming.consultant.enabled)
            : Boolean(current.consultant?.enabled),
      },
    });
    return sendJson(res, 200, {
      ok: true,
      settings: toAdminSettingsResponse(nextSettings),
    });
  } catch (error) {
    return sendBodyParseError(res, error);
  }
}

async function handleAdminConsultantUpload(req, res) {
  const user = getAuthorizedAdmin(req, res);
  if (!user) {
    return;
  }

  try {
    const payload = await parseMultipartFormData(req);
    const serverId = String(payload.fields?.serverId || "")
      .trim()
      .toLowerCase();
    const serverInfo = getMajesticServerInfo(serverId);
    if (!serverInfo) {
      return sendJson(res, 400, {
        error: "Invalid serverId",
        details: "Select a Majestic server before uploading files.",
      });
    }

    const files = Array.isArray(payload.files) ? payload.files.filter((file) => file.data?.length) : [];
    if (!files.length) {
      return sendJson(res, 400, {
        error: "No files uploaded",
        details: "Attach at least one PDF/Word file.",
      });
    }
    if (files.length > CONSULTANT_MAX_FILES_PER_UPLOAD) {
      return sendJson(res, 400, {
        error: "Too many files",
        details: `Upload up to ${CONSULTANT_MAX_FILES_PER_UPLOAD} files at once.`,
      });
    }

    const consultant =
      siteSettings?.consultant && typeof siteSettings.consultant === "object"
        ? siteSettings.consultant
        : DEFAULT_SETTINGS.consultant;
    const serverBases =
      consultant.serverBases && typeof consultant.serverBases === "object"
        ? { ...consultant.serverBases }
        : {};
    const currentBase = sanitizeConsultantServerBase(serverBases[serverInfo.id]);
    const appendBlocks = [];
    const appendedMeta = [];

    for (const file of files) {
      const text = await extractConsultantTextFromFile(file);
      if (!text) {
        continue;
      }
      const uploadedAt = new Date().toISOString();
      appendBlocks.push(
        `[Источник: ${file.filename}; дата: ${uploadedAt}]\n${text.trim()}`
      );
      appendedMeta.push({
        id: `f_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
        name: file.filename,
        type: file.contentType || "application/octet-stream",
        size: file.size,
        uploadedAt,
      });
    }

    if (!appendBlocks.length) {
      return sendJson(res, 400, {
        error: "No readable content",
        details: "Unable to extract text from uploaded files.",
      });
    }

    const mergedText = [currentBase.lawsText, ...appendBlocks]
      .filter(Boolean)
      .join("\n\n")
      .replace(/\r\n/g, "\n")
      .trim();

    const mergedFiles = [...appendedMeta, ...(currentBase.files || [])]
      .map((entry) => sanitizeConsultantFileMeta(entry))
      .filter(Boolean)
      .slice(0, CONSULTANT_MAX_FILES_PER_SERVER);

    serverBases[serverInfo.id] = {
      lawsText: mergedText,
      files: mergedFiles,
    };

    const nextSettings = saveSettings({
      ...siteSettings,
      consultant: {
        ...(siteSettings.consultant || {}),
        serverBases,
      },
    });

    const settingsResponse = toAdminSettingsResponse(nextSettings);
    const serverSummary = settingsResponse.consultant.servers.find((server) => server.id === serverInfo.id);

    return sendJson(res, 200, {
      ok: true,
      uploadedCount: appendedMeta.length,
      server: serverSummary || {
        id: serverInfo.id,
        name: serverInfo.name,
        files: [],
        hasLaws: false,
        textChars: 0,
      },
      settings: settingsResponse,
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
  const user = getAuthenticatedUser(req, res, { createSessionIfNeeded: true });
  if (!user) {
    return sendJson(res, 200, {
      authenticated: false,
      isLeader: false,
      faction: null,
    });
  }

  const leader = isLeaderUser(user);
  const faction = factionState.factions[String(user.id)] || null;
  return sendJson(res, 200, {
    authenticated: true,
    isLeader: leader,
    faction: faction
      ? toPublicFaction(faction, { includeDrafts: leader, includePrivate: leader })
      : null,
  });
}

async function handleFactionNav(req, res) {
  const user = getAuthenticatedUser(req, res, { createSessionIfNeeded: true });
  if (!user) {
    return sendJson(res, 200, {
      authenticated: false,
      isLeader: false,
      tabs: [],
    });
  }

  const ownFaction = factionState.factions[String(user.id)] || null;
  const ownFactionValidation = ownFaction ? validateFactionDiscordConfig(ownFaction) : { ok: true };
  const tabs = await getFactionTabsForUser(req, res, user);
  return sendJson(res, 200, {
    authenticated: true,
    isLeader: isLeaderUser(user),
    tabs,
    diagnostics: {
      ownFactionConfig: ownFactionValidation,
    },
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
    const configValidation = validateFactionDiscordConfig(sanitized);
    if (!configValidation.ok) {
      return sendJson(res, 400, {
        error: configValidation.error,
        details: configValidation.details,
        field: configValidation.field,
      });
    }
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

async function handleFactionSiteRead(req, res, rawSlug) {
  const record = getFactionRecordBySlug(rawSlug);
  if (!record) {
    return sendJson(res, 404, { error: "Faction not found" });
  }

  const user = getAuthenticatedUser(req, res, { createSessionIfNeeded: true });
  if (!user) {
    return sendJson(res, 401, { error: "Auth required" });
  }

  const access = await resolveFactionAccess(req, res, user, record.ownerId, record.faction);
  if (!access.canView) {
    return sendJson(res, 403, {
      error: "Faction access denied",
      reason: access.matchedBy,
    });
  }

  return sendJson(res, 200, {
    authenticated: true,
    isLeader: isLeaderUser(user),
    canEdit: access.canEdit,
    faction: toPublicFaction(record.faction, {
      includeDrafts: access.canEdit,
      includePrivate: access.canEdit,
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
    const configValidation = validateFactionDiscordConfig(sanitized);
    if (!configValidation.ok) {
      return sendJson(res, 400, {
        error: configValidation.error,
        details: configValidation.details,
        field: configValidation.field,
      });
    }

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

  const access = await resolveFactionAccess(req, res, user, record.ownerId, record.faction);
  if (!access.canView) {
    return sendJson(res, 403, {
      error: "Faction access denied",
      reason: access.matchedBy,
    });
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
  authUrl.searchParams.set("scope", DISCORD_OAUTH_SCOPE);
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
    clearDiscordOAuthSession(session);
    return redirect(res, appendAuthError(redirectPath, "config"));
  }

  const error = requestUrl.searchParams.get("error");
  if (error) {
    clearOAuthNextCookie(res);
    clearDiscordOAuthSession(session);
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
    clearDiscordOAuthSession(session);
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
      clearDiscordOAuthSession(session);
      session.oauthState = null;
      session.nextPath = null;
      session.updatedAt = Date.now();
      return redirect(res, appendAuthError(redirectPath, "token"));
    }

    const tokenPayload = await tokenResponse.json();
    const accessToken = tokenPayload.access_token;
    const tokenType = String(tokenPayload.token_type || "Bearer").trim() || "Bearer";
    if (!accessToken) {
      clearOAuthNextCookie(res);
      clearDiscordOAuthSession(session);
      session.oauthState = null;
      session.nextPath = null;
      session.updatedAt = Date.now();
      return redirect(res, appendAuthError(redirectPath, "token"));
    }

    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: {
        Authorization: `${tokenType} ${accessToken}`,
      },
    });

    if (!userResponse.ok) {
      console.error("Discord user fetch failed:", await userResponse.text());
      clearOAuthNextCookie(res);
      clearDiscordOAuthSession(session);
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
    const oauthContext = { accessToken, tokenType };
    const guildList = await fetchDiscordUserGuildIds(oauthContext);
    const guildIds = guildList.available ? guildList.guildIds : [];
    const expiresInSec = Number(tokenPayload.expires_in);
    const safeExpiresInSec = Number.isFinite(expiresInSec)
      ? Math.max(120, Math.min(expiresInSec, 60 * 60 * 24 * 30))
      : 55 * 60;

    session.user = {
      id: userPayload.id,
      username,
      discriminator,
      displayName,
      avatarUrl,
      guildIds,
    };
    session.discordAccessToken = accessToken;
    session.discordTokenType = tokenType;
    session.discordAccessTokenExpiresAt = Date.now() + safeExpiresInSec * 1000;
    setAuthUserCookie(res, session.user);
    clearOAuthNextCookie(res);
    session.oauthState = null;
    session.nextPath = null;
    session.updatedAt = Date.now();

    return redirect(res, appendAuthSuccess(redirectPath));
  } catch (error) {
    console.error("Discord callback error:", error);
    clearOAuthNextCookie(res);
    clearDiscordOAuthSession(session);
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
  clearAuthUserCookie(res);
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

function parseMultipartFormData(req, maxBytes = Number.POSITIVE_INFINITY) {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers["content-type"] || "");
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    const boundary = (boundaryMatch?.[1] || boundaryMatch?.[2] || "").trim();
    if (!boundary) {
      reject(new Error("Invalid multipart form-data boundary"));
      return;
    }

    const chunks = [];
    let total = 0;
    let tooLarge = false;

    req.on("data", (chunk) => {
      if (tooLarge) return;
      total += chunk.length;
      if (Number.isFinite(maxBytes) && total > maxBytes) {
        tooLarge = true;
        reject(new Error("Payload too large"));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (tooLarge) return;
      const bodyBuffer = Buffer.concat(chunks);
      const raw = bodyBuffer.toString("latin1");
      const delimiter = `--${boundary}`;
      const segments = raw.split(delimiter);
      const fields = {};
      const files = [];

      for (const segment of segments) {
        if (!segment || segment === "--" || segment === "--\r\n") continue;

        let normalizedPart = segment;
        if (normalizedPart.startsWith("\r\n")) {
          normalizedPart = normalizedPart.slice(2);
        }
        if (normalizedPart.endsWith("--")) {
          normalizedPart = normalizedPart.slice(0, -2);
        }
        if (normalizedPart.endsWith("\r\n")) {
          normalizedPart = normalizedPart.slice(0, -2);
        }

        const headerEnd = normalizedPart.indexOf("\r\n\r\n");
        if (headerEnd < 0) {
          continue;
        }

        const headerRaw = normalizedPart.slice(0, headerEnd);
        const bodyRaw = normalizedPart.slice(headerEnd + 4);
        const headers = Object.fromEntries(
          headerRaw
            .split("\r\n")
            .map((line) => line.split(":"))
            .filter((parts) => parts.length >= 2)
            .map((parts) => [parts[0].trim().toLowerCase(), parts.slice(1).join(":").trim()])
        );
        const disposition = String(headers["content-disposition"] || "");
        const nameMatch = disposition.match(/name="([^"]+)"/i);
        const filenameMatch = disposition.match(/filename="([^"]*)"/i);
        const fieldName = String(nameMatch?.[1] || "").trim();
        if (!fieldName) {
          continue;
        }

        if (filenameMatch) {
          const originalName = sanitizeUploadFileName(filenameMatch[1] || "");
          if (!originalName) {
            continue;
          }
          const data = Buffer.from(bodyRaw, "latin1");
          files.push({
            fieldName,
            filename: originalName,
            contentType: String(headers["content-type"] || "application/octet-stream")
              .trim()
              .toLowerCase(),
            data,
            size: data.length,
          });
          continue;
        }

        fields[fieldName] = Buffer.from(bodyRaw, "latin1").toString("utf-8").trim();
      }

      resolve({ fields, files });
    });

    req.on("error", (error) => reject(error));
  });
}

function sanitizeUploadFileName(value) {
  const baseName = path.basename(String(value || "").trim());
  return baseName.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "_").slice(0, 220);
}

async function extractConsultantTextFromFile(file) {
  const filename = String(file?.filename || "").trim();
  const ext = path.extname(filename).toLowerCase();
  if (!CONSULTANT_ALLOWED_FILE_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported file type: ${ext || "unknown"}. Use PDF, DOC, DOCX or TXT.`);
  }

  let extracted = "";
  if (ext === ".txt") {
    extracted = file.data.toString("utf-8");
  } else if (ext === ".pdf") {
    const pdfParse = getPdfParse();
    const parsed = await pdfParse(file.data, { max: 0 });
    extracted = String(parsed?.text || "");
  } else if (ext === ".doc" || ext === ".docx") {
    const mammoth = getMammoth();
    try {
      const parsed = await mammoth.extractRawText({ buffer: file.data });
      extracted = String(parsed?.value || "");
    } catch (error) {
      if (ext === ".doc") {
        throw new Error(
          `File ${filename}: old .doc format is not fully supported. Save it as .docx and upload again.`
        );
      }
      throw error;
    }
  }

  const normalized = normalizeExtractedLawText(extracted);
  if (!normalized) {
    throw new Error(`File ${filename}: no readable text found.`);
  }
  return normalized;
}

function normalizeExtractedLawText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getPdfParse() {
  if (cachedPdfParse) {
    return cachedPdfParse;
  }
  try {
    cachedPdfParse = require("pdf-parse");
    return cachedPdfParse;
  } catch (error) {
    throw new Error("Missing dependency: pdf-parse. Run `npm install pdf-parse`.");
  }
}

function getMammoth() {
  if (cachedMammoth) {
    return cachedMammoth;
  }
  try {
    cachedMammoth = require("mammoth");
    return cachedMammoth;
  } catch (error) {
    throw new Error("Missing dependency: mammoth. Run `npm install mammoth`.");
  }
}

function sendBodyParseError(res, error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("payload too large")) {
    const maxMb = Math.max(1, Math.round(MAX_JSON_BODY_BYTES / (1024 * 1024)));
    return sendJson(res, 413, {
      error: "Payload too large",
      details: `Use a smaller request payload. Max JSON request size is ${maxMb} MB.`,
    });
  }

  if (message.includes("multipart")) {
    return sendJson(res, 400, {
      error: "Invalid multipart body",
      details: error?.message || "Unknown parse error",
    });
  }

  return sendJson(res, 400, {
    error: "Invalid request body",
    details: error?.message || "Unknown parse error",
  });
}

function handleAdminPage(req, res, method) {
  const user = getAuthenticatedUser(req, res, { createSessionIfNeeded: true });
  if (!user) {
    return redirect(res, appendAuthError("/", "auth_required"));
  }

  if (!isAdminUser(user)) {
    return redirect(res, appendAuthError("/", "forbidden"));
  }

  return serveStaticFile("/admin.html", res, method);
}

async function handleFactionSitePage(req, res, method, rawSlug) {
  const record = getFactionRecordBySlug(rawSlug);
  if (!record) {
    return sendJson(res, 404, { error: "Faction not found" });
  }

  const user = getAuthenticatedUser(req, res, { createSessionIfNeeded: true });
  if (!user) {
    return redirect(res, appendAuthError("/", "auth_required"));
  }

  const access = await resolveFactionAccess(req, res, user, record.ownerId, record.faction);
  if (!access.canView) {
    return redirect(res, appendAuthError("/", "forbidden"));
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

