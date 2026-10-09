import { env } from "cloudflare:workers";

export type FirebaseUser = {
  id: string;
  email: string;
  name: string;
  picture: string;
};

type FirebaseTokenPayload = {
  sub?: string;
  user_id?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  aud?: string;
  iss?: string;
  exp?: number;
};

type FirebaseJwk = JsonWebKey & { kid?: string };

export const FIREBASE_COOKIE = "urijangbu_firebase_id";
const DEFAULT_PROJECT_ID = "uri-jangbu";
let jwkCache: { expiresAt: number; keys: FirebaseJwk[] } | null = null;

export function firebaseProjectId() {
  return String((env as Cloudflare.Env & { FIREBASE_PROJECT_ID?: string }).FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID).trim();
}

const decodeBase64Url = (value: string) => {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
};

const decodeJson = <T,>(value: string): T => JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;

async function firebaseKeys() {
  if (jwkCache && jwkCache.expiresAt > Date.now()) return jwkCache.keys;
  const response = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com", { cache: "no-store" });
  if (!response.ok) throw new Error("Firebase 인증서를 확인하지 못했습니다.");
  const body = await response.json() as { keys?: FirebaseJwk[] };
  const keys = body.keys || [];
  jwkCache = { keys, expiresAt: Date.now() + 60 * 60 * 1000 };
  return keys;
}

export async function verifyFirebaseCredential(credential: string): Promise<FirebaseUser> {
  const projectId = firebaseProjectId();
  const [encodedHeader, encodedPayload, encodedSignature] = credential.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) throw new Error("로그인 정보가 올바르지 않습니다.");
  const header = decodeJson<{ alg?: string; kid?: string }>(encodedHeader);
  const payload = decodeJson<FirebaseTokenPayload>(encodedPayload);
  if (header.alg !== "RS256" || !header.kid) throw new Error("지원하지 않는 로그인 형식입니다.");
  const key = (await firebaseKeys()).find((candidate) => candidate.kid === header.kid);
  if (!key) throw new Error("Firebase 로그인 인증서를 찾지 못했습니다.");
  const cryptoKey = await crypto.subtle.importKey("jwk", key, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const validSignature = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    decodeBase64Url(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;
  if (!validSignature || payload.iss !== expectedIssuer || payload.aud !== projectId || !payload.exp || payload.exp * 1000 <= Date.now() || !payload.sub || !payload.email || !payload.email_verified) {
    throw new Error("Firebase 로그인 확인에 실패했습니다.");
  }
  return { id: payload.user_id || payload.sub, email: payload.email, name: payload.name || payload.email.split("@")[0], picture: payload.picture || "" };
}

export function readFirebaseCredential(request: Request) {
  const cookies = request.headers.get("cookie") || "";
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${FIREBASE_COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : "";
}

export async function firebaseUserFromRequest(request: Request) {
  const credential = readFirebaseCredential(request);
  if (!credential) return null;
  try { return await verifyFirebaseCredential(credential); } catch { return null; }
}

export function firebaseCookie(credential: string, request: Request, maxAge = 3600) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${FIREBASE_COOKIE}=${encodeURIComponent(credential)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
