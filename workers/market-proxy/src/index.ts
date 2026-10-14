interface Env {
  KIS_APP_KEY: string;
  KIS_APP_SECRET: string;
  KIS_TOKEN_STORE?: KVNamespace;
}

type Quote = { ticker: string; name: string; market: string; price: number; date: string };
type KisPayload = {
  rt_cd?: string;
  msg_cd?: string;
  msg1?: string;
  output?: Record<string, unknown>;
};

const PROJECT_ID = "uri-jangbu";
const ALLOWED_ORIGINS = new Set(["https://uri-jangbu.web.app", "http://localhost:5173", "http://127.0.0.1:5173"]);
const KIS_BASE_URL = "https://openapi.koreainvestment.com:9443";
const FIREBASE_JWKS = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const KIS_TOKEN_CACHE_KEY = "https://cache.urijangbu.app/kis-access-token";
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_KEY_BASE = "https://cache.urijangbu.app/quote-rate-limit/";

let signingKeys: Record<string, JsonWebKey> = {};
let certificatesExpireAt = 0;
let kisAccessToken = "";
let kisTokenExpiresAt = 0;
let kisTokenRequest: Promise<string> | null = null;
const localRateLimits = new Map<string, number>();

class RateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("시세 갱신은 사용자당 1분에 한 번만 요청할 수 있습니다.");
  }
}

const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://uri-jangbu.web.app",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});

const json = (body: unknown, status = 200, origin: string | null = null) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors(origin) } });
const base64UrlBytes = (value: string) => Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), character => character.charCodeAt(0));
const todayKst = () => {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || "";
  return `${value("year")}${value("month")}${value("day")}`;
};
const wait = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

async function verifyFirebaseToken(authorization: string | null) {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new Error("로그인이 필요합니다.");
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) throw new Error("로그인 정보를 확인할 수 없습니다.");
  const header = JSON.parse(new TextDecoder().decode(base64UrlBytes(encodedHeader))) as { alg?: string; kid?: string };
  const payload = JSON.parse(new TextDecoder().decode(base64UrlBytes(encodedPayload))) as { aud?: string; iss?: string; exp?: number; sub?: string };
  if (header.alg !== "RS256" || !header.kid || payload.aud !== PROJECT_ID || payload.iss !== `https://securetoken.google.com/${PROJECT_ID}` || !payload.sub || !payload.exp || payload.exp * 1000 <= Date.now()) throw new Error("로그인 정보가 유효하지 않습니다.");
  if (Date.now() >= certificatesExpireAt || !signingKeys[header.kid]) {
    const response = await fetch(FIREBASE_JWKS);
    if (!response.ok) throw new Error("로그인 확인 서버에 연결하지 못했습니다.");
    const jwks = await response.json() as { keys?: JsonWebKey[] };
    signingKeys = Object.fromEntries((jwks.keys || []).filter(key => typeof key.kid === "string").map(key => [key.kid!, key]));
    const cacheSeconds = Number(response.headers.get("Cache-Control")?.match(/max-age=(\d+)/)?.[1] || 3600);
    certificatesExpireAt = Date.now() + cacheSeconds * 1000;
  }
  const signingKey = signingKeys[header.kid];
  if (!signingKey) throw new Error("로그인 인증서를 찾지 못했습니다.");
  const key = await crypto.subtle.importKey("jwk", signingKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const signed = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64UrlBytes(encodedSignature), signed)) throw new Error("로그인 서명을 확인하지 못했습니다.");
  return { uid: payload.sub };
}

async function enforceQuoteRateLimit(uid: string) {
  const now = Date.now();
  const locallyBlockedUntil = localRateLimits.get(uid) || 0;
  if (locallyBlockedUntil > now) throw new RateLimitError(Math.ceil((locallyBlockedUntil - now) / 1000));

  const key = `${RATE_LIMIT_KEY_BASE}${encodeURIComponent(uid)}`;
  const stored = await caches.default.match(key);
  if (stored) {
    const retryAfter = Number(stored.headers.get("X-Retry-After") || "60");
    throw new RateLimitError(Math.max(1, retryAfter));
  }

  const blockedUntil = now + RATE_LIMIT_WINDOW_MS;
  localRateLimits.set(uid, blockedUntil);
  await caches.default.put(key, new Response(null, {
    headers: {
      "Cache-Control": "max-age=60",
      "X-Retry-After": "60",
    },
  }));
}

async function getKisAccessToken(env: Env) {
  if (kisAccessToken && Date.now() < kisTokenExpiresAt) return kisAccessToken;
  if (kisTokenRequest) return kisTokenRequest;
  kisTokenRequest = loadOrIssueKisAccessToken(env).finally(() => {
    kisTokenRequest = null;
  });
  return kisTokenRequest;
}

async function loadOrIssueKisAccessToken(env: Env) {
  let saved: { accessToken?: string; expiresAt?: number } | null = null;
  if (env.KIS_TOKEN_STORE) {
    saved = await env.KIS_TOKEN_STORE.get<{ accessToken?: string; expiresAt?: number }>("access-token", "json");
  } else {
    const cached = await caches.default.match(KIS_TOKEN_CACHE_KEY);
    saved = cached ? await cached.json().catch(() => null) as { accessToken?: string; expiresAt?: number } | null : null;
  }
  if (saved?.accessToken && typeof saved.expiresAt === "number" && Date.now() < saved.expiresAt) {
    kisAccessToken = saved.accessToken;
    kisTokenExpiresAt = saved.expiresAt;
    return kisAccessToken;
  }
  if (!env.KIS_APP_KEY || !env.KIS_APP_SECRET) throw new Error("한국투자 API 비밀값이 아직 등록되지 않았습니다.");
  const response = await fetch(`${KIS_BASE_URL}/oauth2/tokenP`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", appkey: env.KIS_APP_KEY, appsecret: env.KIS_APP_SECRET }),
  });
  const payload = await response.json().catch(() => null) as { access_token?: string; expires_in?: number; error_description?: string } | null;
  if (!response.ok || !payload?.access_token) throw new Error(payload?.error_description || `한국투자 인증 요청 실패(${response.status})`);
  kisAccessToken = payload.access_token;
  kisTokenExpiresAt = Date.now() + Math.max(60, Number(payload.expires_in || 86400) - 120) * 1000;
  const savedToken = { accessToken: kisAccessToken, expiresAt: kisTokenExpiresAt };
  const tokenTtl = Math.max(60, Math.floor((kisTokenExpiresAt - Date.now()) / 1000));
  if (env.KIS_TOKEN_STORE) {
    await env.KIS_TOKEN_STORE.put("access-token", JSON.stringify(savedToken), { expirationTtl: tokenTtl });
  } else {
    await caches.default.put(KIS_TOKEN_CACHE_KEY, new Response(JSON.stringify(savedToken), { headers: { "Cache-Control": `max-age=${tokenTtl}` } }));
  }
  return kisAccessToken;
}

async function inquirePrice(ticker: string, token: string, env: Env, path: string, trId: string, retried = false) {
  const url = new URL(`${KIS_BASE_URL}${path}`);
  url.searchParams.set("FID_COND_MRKT_DIV_CODE", "J");
  url.searchParams.set("FID_INPUT_ISCD", ticker);
  const response = await fetch(url, { headers: { "Content-Type": "application/json", "authorization": `Bearer ${token}`, "appkey": env.KIS_APP_KEY, "appsecret": env.KIS_APP_SECRET, "tr_id": trId, "custtype": "P" } });
  const payload = await response.json().catch(() => null) as KisPayload | null;
  if (payload?.msg_cd === "EGW00201") {
    if (!retried) {
      await wait(1200);
      return inquirePrice(ticker, token, env, path, trId, true);
    }
    throw new Error("한국투자 시세 요청 한도에 도달했습니다. 잠시 후 다시 시도해주세요.");
  }
  if (!response.ok) throw new Error(payload?.msg1 || payload?.msg_cd || `한국투자 시세 요청 실패(${response.status})`);
  if (payload?.rt_cd !== "0") {
    if (payload?.msg_cd?.startsWith("EGW")) throw new Error(payload.msg1 || "한국투자 API 인증을 확인해주세요.");
    return null;
  }
  const output = payload.output;
  const price = Number(output?.stck_prpr);
  if (!output || !Number.isFinite(price) || price <= 0) return null;
  return {
    ticker,
    // 종목명이 없는 응답은 빈 값으로 반환하여 기존 사용자가 입력한 종목명을 덮어쓰지 않는다.
    name: String(output.hts_kor_isnm || output.prdt_name || ""),
    market: "KRX",
    price,
    date: String(output.stck_bsop_date || todayKst()),
  } satisfies Quote;
}

async function fetchQuote(ticker: string, env: Env) {
  const cacheKey = `https://cache.urijangbu.app/kis-quotes/${ticker}`;
  const cached = await caches.default.match(cacheKey);
  if (cached) return await cached.json() as Quote | null;
  const token = await getKisAccessToken(env);
  // 국내주식 현재가 API의 J 시장 구분은 일반 주식, ETF, ETN을 모두 지원한다.
  // 종목당 요청을 한 번으로 제한해 호출 한도를 피한다.
  const quote = await inquirePrice(
    ticker,
    token,
    env,
    "/uapi/domestic-stock/v1/quotations/inquire-price",
    "FHKST01010100",
  );
  if (quote) await caches.default.put(cacheKey, new Response(JSON.stringify(quote), { headers: { "Cache-Control": "max-age=900" } }));
  return quote;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    if (request.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
    if (request.method !== "POST" || new URL(request.url).pathname !== "/quotes") return json({ message: "찾을 수 없는 요청입니다." }, 404, origin);
    try {
      const user = await verifyFirebaseToken(request.headers.get("Authorization"));
      await enforceQuoteRateLimit(user.uid);
      const body = await request.json() as { symbols?: unknown };
      const symbols = [...new Set((Array.isArray(body.symbols) ? body.symbols : []).filter((symbol): symbol is string => typeof symbol === "string").map(symbol => symbol.trim().toUpperCase()))].filter(symbol => /^[0-9A-Z]{6}$/.test(symbol)).slice(0, 30);
      if (!symbols.length) return json({ message: "6자리 영문·숫자 국내 종목코드를 입력해주세요." }, 400, origin);
      // 한국투자 API는 초당 호출 제한이 있으므로 한 종목씩 700ms 간격으로 조회한다.
      const quotes: Quote[] = [];
      for (let index = 0; index < symbols.length; index += 1) {
        const quote = await fetchQuote(symbols[index], env);
        if (quote) quotes.push(quote);
        if (index < symbols.length - 1) await wait(700);
      }
      const found = new Set(quotes.map(quote => quote.ticker));
      return json({ quotes, missing: symbols.filter(ticker => !found.has(ticker)) }, 200, origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : "시세를 불러오지 못했습니다.";
      const status = error instanceof RateLimitError ? 429 : message.includes("로그인") ? 401 : 502;
      return json({ message, ...(error instanceof RateLimitError ? { retryAfter: error.retryAfterSeconds } : {}) }, status, origin);
    }
  },
};
