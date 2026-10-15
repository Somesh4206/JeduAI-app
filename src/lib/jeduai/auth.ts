// JeduAI — server-side auth (scrypt hashing + DB sessions + httpOnly cookie)
// Session transport is hybrid on purpose:
//  1) httpOnly cookie — preferred (same-site, direct access)
//  2) Authorization: Bearer <token> — fallback when cookies are unavailable.
//     The sandbox preview renders the app inside a cross-site iframe over HTTPS;
//     browsers reject SameSite=Lax cookies in that third-party context (and Safari
//     blocks third-party cookies entirely), so the client also keeps the session
//     token in localStorage and sends it as a Bearer header.
import "server-only";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import { AVATAR_COLORS } from "./constants";

export const SESSION_COOKIE = "jeduai_session";
const SESSION_DAYS = 30;

export function hashPassword(pw: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(pw: string, stored: string) {
  try {
    const [salt, hash] = stored.split(":");
    const test = scryptSync(pw, salt, 64);
    return timingSafeEqual(Buffer.from(hash, "hex"), test);
  } catch {
    return false;
  }
}

export function pickAvatarColor(seed: string) {
  let n = 0;
  for (const c of seed) n = (n + c.charCodeAt(0)) % 997;
  return AVATAR_COLORS[n % AVATAR_COLORS.length];
}

async function requestIsHttps() {
  try {
    const h = await headers();
    const proto = (h.get("x-forwarded-proto") || "").split(",")[0].trim().toLowerCase();
    return proto === "https";
  } catch {
    return false;
  }
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.session.create({ data: { token, userId, expiresAt } });
  const jar = await cookies();
  // HTTPS (sandbox preview / production behind proxy): the app may be embedded in
  // a cross-site iframe, so the cookie must be SameSite=None; Secure and
  // Partitioned (CHIPS) to be accepted by the browser in that context.
  // Plain HTTP (direct localhost dev): SameSite=Lax is the most compatible.
  const https = await requestIsHttps();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    path: "/",
    expires: expiresAt,
    ...(https ? { sameSite: "none", secure: true, partitioned: true } : { sameSite: "lax" }),
  });
  return token;
}

async function bearerTokenFromRequest() {
  try {
    const h = await headers();
    const authz = h.get("authorization");
    if (authz && authz.toLowerCase().startsWith("bearer ")) {
      const t = authz.slice(7).trim();
      if (t) return t;
    }
  } catch {}
  return null;
}

export async function userFromToken(token?: string | null) {
  if (!token) return null;
  const s = await db.session.findUnique({ where: { token }, include: { user: true } }).catch(() => null);
  if (!s) return null;
  if (s.expiresAt < new Date()) {
    await db.session.delete({ where: { token } }).catch(() => {});
    return null;
  }
  return s.user;
}

export async function destroySession() {
  const jar = await cookies();
  let token = jar.get(SESSION_COOKIE)?.value || null;
  if (!token) token = await bearerTokenFromRequest();
  if (token) {
    await db.session.deleteMany({ where: { token } }).catch(() => {});
  }
  jar.delete(SESSION_COOKIE);
}

export async function getSessionUser() {
  try {
    const jar = await cookies();
    // 1) httpOnly cookie (first-party / same-site access)
    let token = jar.get(SESSION_COOKIE)?.value || null;
    // 2) Bearer token fallback (iframe previews where cookies are blocked)
    if (!token) token = await bearerTokenFromRequest();
    if (!token) return null;
    return (await userFromToken(token)) || null;
  } catch {
    return null;
  }
}

export class AuthError extends Error {}

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) throw new AuthError("Not signed in");
  return user;
}

export async function requireRole(roles: string[]) {
  const user = await requireUser();
  if (!roles.includes(user.role)) throw new AuthError(`Requires ${roles.join(" or ")} role`);
  return user;
}

export function publicUser(u: {
  id: string;
  email: string;
  name: string;
  role: string;
  avatarColor: string;
  profileImage: string | null;
  educationLevel: string;
  interfaceLang: string;
  explanationLang: string;
  subjects: string;
  interests: string;
  dailyGoalMin: number;
  points: number;
  streak: number;
  theme: string;
  fontScale: number;
  onboarded: boolean;
  notifPrefs: string;
}) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    avatarColor: u.avatarColor,
    profileImage: u.profileImage,
    educationLevel: u.educationLevel,
    interfaceLang: u.interfaceLang,
    explanationLang: u.explanationLang,
    subjects: JSON.parse(u.subjects || "[]"),
    interests: JSON.parse(u.interests || "[]"),
    dailyGoalMin: u.dailyGoalMin,
    points: u.points,
    streak: u.streak,
    theme: u.theme,
    fontScale: u.fontScale,
    onboarded: u.onboarded,
    notifPrefs: JSON.parse(u.notifPrefs || "{}"),
  };
}
