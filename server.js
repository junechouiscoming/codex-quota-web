import { createServer } from "node:http";
import { readFile, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const authFile = join(os.homedir(), ".codex", "auth.json");
const port = Number(process.env.PORT || 8787);
const cacheMs = Number(process.env.CACHE_MS || 45_000);
const clientId = "app_EMoamEEZ73f0CkXaXp7hrann";

let cache = null;
let inFlight = null;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (url.pathname === "/api/quota") {
      const force = url.searchParams.get("refresh") === "1";
      const data = await getQuota({ force });
      sendJson(res, 200, data);
      return;
    }

    await serveStatic(url.pathname, res);
  } catch (error) {
    const status = error.statusCode || 500;
    sendJson(res, status, {
      ok: false,
      error: presentableError(error),
      updatedAt: new Date().toISOString(),
    });
  }
});

server.listen(port, () => {
  console.log(`Codex quota web is running at http://localhost:${port}`);
});

async function getQuota({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache && now - cache.cachedAt < cacheMs) {
    return { ...cache.payload, cached: true };
  }

  if (!inFlight) {
    inFlight = fetchQuota()
      .then((payload) => {
        cache = { payload, cachedAt: Date.now() };
        return payload;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  try {
    return await inFlight;
  } catch (error) {
    if (cache) {
      return {
        ...cache.payload,
        ok: false,
        cached: true,
        stale: true,
        error: presentableError(error),
      };
    }
    throw error;
  }
}

async function fetchQuota() {
  const credentials = await validCredentials();
  const [usage, profile] = await Promise.all([
    getJson("https://chatgpt.com/backend-api/wham/usage", credentials),
    getJson("https://chatgpt.com/backend-api/wham/profiles/me", credentials).catch(() => null),
  ]);

  const profileInfo = profile?.profile || {};
  const fallbackName =
    cleanString(credentials.displayName) ||
    cleanString(usage.email?.split("@")[0]) ||
    "Codex";
  const displayName =
    cleanString(profileInfo.name) ||
    cleanString(profileInfo.display_name) ||
    cleanString(profileInfo.displayName) ||
    fallbackName;
  const username = cleanString(profileInfo.username) || displayName;
  const avatarURL = cleanString(profileInfo.profile_picture_url) || cleanString(profileInfo.profilePictureUrl) || null;

  return {
    ok: true,
    cached: false,
    stale: false,
    updatedAt: new Date().toISOString(),
    username,
    displayName,
    avatarURL,
    planName: formatPlan(usage.plan_type || usage.planType || credentials.planType),
    quotas: [
      makeWindow("primary", "5小时额度", usage.rate_limit?.primary_window || usage.rateLimit?.primaryWindow),
      makeWindow("secondary", "周额度", usage.rate_limit?.secondary_window || usage.rateLimit?.secondaryWindow),
    ],
  };
}

async function validCredentials() {
  let credentials = await readCredentials();
  if (expiresSoon(credentials.accessToken)) {
    credentials = await refreshCredentials(credentials);
  }
  return credentials;
}

async function readCredentials() {
  let root;
  try {
    root = JSON.parse(await readFile(authFile, "utf8"));
  } catch {
    throw new Error("未找到或无法读取 ~/.codex/auth.json，请先运行 codex login。");
  }

  const tokens = root.tokens || {};
  if (!tokens.access_token) {
    throw new Error("Codex 登录信息里没有 access token，请重新运行 codex login。");
  }

  const accessClaims = jwtClaims(tokens.access_token);
  const idClaims = tokens.id_token ? jwtClaims(tokens.id_token) : {};
  const authClaims = accessClaims["https://api.openai.com/auth"] || idClaims["https://api.openai.com/auth"] || {};
  const profileClaims = accessClaims["https://api.openai.com/profile"] || {};

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    accountID: tokens.account_id || authClaims.chatgpt_user_id,
    displayName: idClaims.name,
    email: profileClaims.email || idClaims.email,
    planType: authClaims.chatgpt_plan_type,
  };
}

async function refreshCredentials(credentials) {
  if (!credentials.refreshToken) {
    throw new Error("登录已过期，且没有 refresh token，请重新运行 codex login。");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: credentials.refreshToken,
  });

  const response = await fetch("https://auth.openai.com/oauth/token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "CodexQuotaWeb/0.1",
    },
    body,
  });

  if (!response.ok) {
    throw new Error("刷新 Codex 登录 token 失败，请重新运行 codex login。");
  }

  const refreshed = await response.json();
  if (!refreshed.access_token) {
    throw new Error("刷新 Codex 登录 token 失败，请重新运行 codex login。");
  }

  await updateAuthFile(refreshed);

  return {
    ...credentials,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token || credentials.refreshToken,
    idToken: refreshed.id_token || credentials.idToken,
  };
}

async function updateAuthFile(refreshed) {
  const root = JSON.parse(await readFile(authFile, "utf8"));
  root.tokens ||= {};

  for (const key of ["access_token", "refresh_token", "id_token"]) {
    if (typeof refreshed[key] === "string") {
      root.tokens[key] = refreshed[key];
    }
  }

  root.last_refresh = new Date().toISOString();
  await writeFile(authFile, `${JSON.stringify(root, null, 2)}\n`, { mode: 0o600 });
}

async function getJson(endpoint, credentials) {
  const headers = {
    accept: "application/json",
    authorization: `Bearer ${credentials.accessToken}`,
    "user-agent": "CodexQuotaWeb/0.1",
  };

  if (credentials.accountID) {
    headers["chatgpt-account-id"] = credentials.accountID;
  }

  const response = await fetch(endpoint, { headers, signal: AbortSignal.timeout(20_000) });
  if (response.status === 401 || response.status === 403) {
    throw new Error("Codex 额度接口拒绝访问，请重新运行 codex login。");
  }
  if (!response.ok) {
    throw new Error(`Codex 额度接口返回 HTTP ${response.status}。`);
  }
  return response.json();
}

function makeWindow(id, title, apiWindow = {}) {
  const usedPercent = number(apiWindow.used_percent ?? apiWindow.usedPercent) ?? 0;
  const remainingPercent = clamp(100 - usedPercent, 0, 100);
  const resetTimestamp = number(apiWindow.reset_at ?? apiWindow.resetAt);

  return {
    id,
    title,
    remainingPercent,
    resetAt: resetTimestamp ? new Date(resetTimestamp * 1000).toISOString() : null,
  };
}

async function serveStatic(pathname, res) {
  const requested = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = normalize(join(publicDir, requested));

  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { ok: false, error: "Forbidden" });
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      throw new Error("Not a file");
    }
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const type = mimeTypes[extname(filePath)] || "application/octet-stream";
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  createReadStream(filePath).pipe(res);
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function jwtClaims(token) {
  const payload = token.split(".")[1];
  if (!payload) return {};
  try {
    const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return {};
  }
}

function expiresSoon(token) {
  const exp = number(jwtClaims(token).exp);
  return Boolean(exp && exp * 1000 - Date.now() < 120_000);
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatPlan(value) {
  if (!value) return "Unknown";
  const normalized = String(value).toLowerCase();
  const known = {
    plus: "Plus",
    pro: "Pro",
    free: "Free",
    team: "Team",
    teams: "Team",
    enterprise: "Enterprise",
    self_serve_business_usage_based: "Business",
    enterprise_cbp_usage_based: "Enterprise",
  };
  return known[normalized] || String(value).split("_").map(capitalize).join(" ");
}

function capitalize(value) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function presentableError(error) {
  return error instanceof Error ? error.message : String(error);
}
