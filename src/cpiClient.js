// SAP Cloud Integration (CPI) OData client.
// Handles OAuth2 client-credentials token retrieval (with caching) and
// authenticated requests against the CPI OData v1 API (/api/v1).

// Read configuration from process.env at CALL TIME (not module-load time).
// This matters because ES `import` statements execute before the .env loader
// in index.js runs, so capturing these at module top would see empty values.
function config() {
  return {
    CPI_BASE_URL: process.env.CPI_BASE_URL, // https://<tenant>.../api/v1
    CPI_TOKEN_URL: process.env.CPI_TOKEN_URL, // https://<subdomain>.../oauth/token
    CPI_CLIENT_ID: process.env.CPI_CLIENT_ID,
    CPI_CLIENT_SECRET: process.env.CPI_CLIENT_SECRET,
  };
}

function assertConfig() {
  const cfg = config();
  const missing = Object.entries(cfg)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        `Copy .env.example and fill in your CPI service-key values.`
    );
  }
}

// --- Host masking ------------------------------------------------------------
// Tool results (and error messages) must never expose the real CPI tenant
// hostname to callers. Hosts are derived from env at call time so this works
// for whatever tenant is configured — nothing tenant-specific is hardcoded.
function maskTargets() {
  const cfg = config();
  const targets = [];
  const add = (raw, placeholder) => {
    if (!raw) return;
    try {
      const { host } = new URL(raw);
      if (host) targets.push({ host, placeholder });
    } catch {
      // Not a valid URL — nothing to mask.
    }
  };
  add(cfg.CPI_BASE_URL, "<cpi-tenant-host>");
  add(cfg.CPI_TOKEN_URL, "<cpi-auth-host>");
  // Longest host first so overlapping hostnames don't get partially replaced.
  return targets.sort((a, b) => b.host.length - a.host.length);
}

/** Replace any configured CPI hostname found in a string with a generic placeholder. */
export function maskString(value) {
  if (typeof value !== "string" || !value) return value;
  let out = value;
  for (const { host, placeholder } of maskTargets()) {
    if (out.includes(host)) out = out.split(host).join(placeholder);
  }
  return out;
}

/** Recursively apply maskString to every string in an object/array. */
export function maskDeep(value) {
  if (typeof value === "string") return maskString(value);
  if (Array.isArray(value)) return value.map(maskDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = maskDeep(v);
    return out;
  }
  return value;
}

// --- Token cache -----------------------------------------------------------
let cachedToken = null;
let cachedTokenExpiry = 0; // epoch ms

async function getAccessToken() {
  assertConfig();
  const { CPI_TOKEN_URL, CPI_CLIENT_ID, CPI_CLIENT_SECRET } = config();
  const now = Date.now();
  // Reuse token until 60s before expiry.
  if (cachedToken && now < cachedTokenExpiry - 60_000) {
    return cachedToken;
  }

  const basic = Buffer.from(`${CPI_CLIENT_ID}:${CPI_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(CPI_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OAuth token request failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  const expiresInSec = Number(data.expires_in) || 3600;
  cachedTokenExpiry = now + expiresInSec * 1000;
  return cachedToken;
}

// --- Core request helper ---------------------------------------------------
/**
 * Perform an authenticated GET against a CPI OData path.
 * @param {string} path  Path relative to CPI_BASE_URL, e.g. "/MessageProcessingLogs"
 * @param {Object} [query]  Key/value query params (OData system query options).
 * @param {Object} [opts]
 * @param {boolean} [opts.raw]  If true, return the raw text body (used for textual $value
 *   endpoints like ErrorInformation — NOT safe for binary content, see opts.binary).
 * @param {boolean} [opts.binary]  If true, return the raw response body as a Buffer (used for
 *   binary $value endpoints, e.g. downloading an integration flow's zip). Reading binary content
 *   via res.text() corrupts it: any byte sequence that isn't valid UTF-8 gets irreversibly
 *   replaced (U+FFFD), so it must be read via res.arrayBuffer() instead.
 */
export async function cpiGet(path, query = {}, opts = {}) {
  const token = await getAccessToken();
  const { CPI_BASE_URL } = config();

  // Cosmetic system query options that some CPI entity sets don't support.
  // If the API complains about one, we drop it and retry (filter is NOT dropped,
  // since removing it would silently change the result set).
  const effectiveQuery = { ...query };
  let useFormat = !opts.raw && !opts.binary && query.$format === undefined;

  const doFetch = () => {
    const url = new URL(`${CPI_BASE_URL}${path}`);
    if (useFormat) url.searchParams.set("$format", "json");
    for (const [k, v] of Object.entries(effectiveQuery)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    return fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: opts.binary
          ? "application/octet-stream, */*"
          : opts.raw
            ? "text/plain, */*"
            : "application/json",
      },
    });
  };

  const DROPPABLE = ["$top", "$skip", "$select", "$orderby", "$expand", "$inlinecount"];
  let res = await doFetch();
  for (let i = 0; i < 6 && !res.ok && (res.status === 400 || res.status === 501); i++) {
    const peek = await res.clone().text().catch(() => "");
    // $format=json is purely a serialization hint (the Accept: application/json header
    // already asks for the same thing) — dropping it can't change query semantics, so
    // try that first on any 400/501, regardless of the error text. Some CPI entities
    // (media-link entries like IntegrationDesigntimeArtifacts) 501 on $format=json for
    // single-entity GETs with an unrelated-looking error message ("No message reference
    // given...") instead of a clean "format not supported" one, so the text-based check
    // below never catches it.
    if (useFormat) {
      useFormat = false;
      res = await doFetch();
      continue;
    }
    if (!/not supported|not implemented/i.test(peek)) break;
    const offending = DROPPABLE.find(
      (opt) => effectiveQuery[opt] !== undefined && new RegExp(`\\$?${opt.slice(1)}\\b`, "i").test(peek)
    );
    if (!offending) break;
    delete effectiveQuery[offending];
    res = await doFetch();
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`CPI API GET ${path} failed (${res.status}): ${text.slice(0, 2000)}`);
  }

  // Binary content (e.g. a zipped integration flow) must be read as bytes, never as text —
  // res.text() assumes/decodes UTF-8 and silently corrupts any byte sequence that isn't valid
  // UTF-8, which most compressed/binary data isn't.
  if (opts.binary) return Buffer.from(await res.arrayBuffer());

  if (opts.raw) return res.text();

  const data = await res.json();
  // OData v2 wraps collections in { d: { results: [...] } } and entities in { d: {...} }.
  if (data && data.d !== undefined) {
    return data.d.results !== undefined ? data.d.results : data.d;
  }
  return data;
}

// --- Write guard -----------------------------------------------------------
/**
 * Throw unless ALLOW_WRITE=true. Called by every create/update/delete/deploy tool.
 */
export function assertWriteAllowed() {
  if (String(process.env.ALLOW_WRITE).toLowerCase() !== "true") {
    throw new Error(
      "Write operations are disabled. Set ALLOW_WRITE=true in your .env (and restart the " +
        "server) to enable deploy / create / update / delete tools."
    );
  }
}

// --- CSRF token cache ------------------------------------------------------
// CPI requires an X-CSRF-Token (fetched via a GET) plus its session cookie for
// any modifying request (POST/PUT/DELETE and most function imports).
let csrfCache = { token: null, cookies: null, at: 0 };

async function getCsrf(token, force = false) {
  const now = Date.now();
  if (!force && csrfCache.token && now - csrfCache.at < 15 * 60 * 1000) {
    return csrfCache;
  }
  const { CPI_BASE_URL } = config();
  const res = await fetch(`${CPI_BASE_URL}/`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-CSRF-Token": "Fetch",
      Accept: "application/json",
    },
  });
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  csrfCache = {
    token: res.headers.get("x-csrf-token"),
    cookies: setCookies.map((c) => c.split(";")[0]).join("; "),
    at: now,
  };
  return csrfCache;
}

// --- Modifying request helper (POST/PUT/DELETE) ----------------------------
/**
 * Perform an authenticated modifying request against the CPI OData API.
 * Handles CSRF token + cookie, with a single automatic retry on 403 (stale token).
 * @param {"POST"|"PUT"|"DELETE"|"MERGE"|"GET"} method
 * @param {string} path  Path relative to CPI_BASE_URL, e.g. "/IntegrationPackages"
 * @param {Object} [opts]
 * @param {Object} [opts.query]  Query params (values used verbatim — pre-quote OData literals).
 * @param {Object|string} [opts.body]  Request body (object is JSON-stringified).
 * @param {string} [opts.contentType]
 * @param {boolean} [opts.raw]  Return raw text instead of parsed JSON.
 */
export async function cpiRequest(method, path, opts = {}) {
  const { query = {}, body, contentType = "application/json", raw = false } = opts;
  const token = await getAccessToken();
  const { CPI_BASE_URL } = config();

  const buildUrl = () => {
    const url = new URL(`${CPI_BASE_URL}${path}`);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    return url.toString();
  };

  const attempt = async (csrf) => {
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
    if (method !== "GET" && method !== "DELETE") headers["Content-Type"] = contentType;
    if (csrf) {
      if (csrf.token) headers["X-CSRF-Token"] = csrf.token;
      if (csrf.cookies) headers["Cookie"] = csrf.cookies;
    }
    const payload =
      body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    return fetch(buildUrl(), { method, headers, body: payload });
  };

  let csrf = await getCsrf(token);
  let res = await attempt(csrf);
  if (res.status === 403) {
    // Token likely stale — refetch once and retry.
    csrf = await getCsrf(token, true);
    res = await attempt(csrf);
  }

  const text = await res.text().catch(() => "");
  if (!res.ok && res.status !== 202) {
    throw new Error(`CPI ${method} ${path} failed (${res.status}): ${text.slice(0, 1500)}`);
  }
  if (raw) return text;
  if (!text) return { status: res.status, ok: true };
  try {
    const data = JSON.parse(text);
    if (data && data.d !== undefined) return data.d.results !== undefined ? data.d.results : data.d;
    return data;
  } catch {
    return { status: res.status, body: text };
  }
}

/**
 * Invoke an OData function import (e.g. DeployIntegrationDesigntimeArtifact).
 * String params are wrapped in OData string literals automatically.
 * @param {string} functionName
 * @param {Object} [params]  Function parameters.
 * @param {"POST"|"GET"} [method]
 */
export async function cpiInvoke(functionName, params = {}, method = "POST") {
  const query = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    query[k] = typeof v === "string" ? odataString(v) : v;
  }
  return cpiRequest(method, `/${functionName}`, { query });
}

/**
 * Escape a value for use inside an OData string literal.
 */
export function odataString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Build a single-key OData entity path segment, e.g. "('PREM')".
 * For composite keys pass an object: { Id: 'x', Version: 'active' } -> "(Id='x',Version='active')".
 */
export function odataKey(key) {
  if (key && typeof key === "object") {
    const parts = Object.entries(key).map(([k, v]) => `${k}=${odataString(v)}`);
    return `(${parts.join(",")})`;
  }
  return `(${odataString(key)})`;
}

/**
 * Build an OData datetime literal from an ISO string.
 * CPI's MPL API uses the datetime'...' literal form for LogStart/LogEnd.
 */
export function odataDateTime(isoString) {
  // Strip trailing Z / milliseconds; OData datetime literal has no timezone suffix.
  const d = new Date(isoString);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date/time: ${isoString}`);
  }
  const s = d.toISOString().replace(/\.\d{3}Z$/, "").replace(/Z$/, "");
  return `datetime'${s}'`;
}
