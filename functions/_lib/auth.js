import {
  buildCookie,
  clearCookie,
  hashPassword,
  parseCookies,
  randomToken,
  sessionCookieName,
  sha256Hex,
  timingSafeEqual,
} from "./utils.js";
import {
  cleanupExpiredSessions,
  createAdmin,
  createSession,
  deleteSessionByHash,
  findAdminByUsername,
  getAdminCount,
  getSessionByHash,
  touchSession,
} from "./db.js";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export async function setupInitialAdmin(db, request, username, password) {
  const adminCount = await getAdminCount(db);
  if (adminCount > 0) {
    throw new Error("系统已初始化，不能再次创建首个管理员。");
  }
  validateCredentials(username, password);
  const salt = randomToken(16);
  const passwordHash = await hashPassword(password, salt);
  const adminId = await createAdmin(db, username, passwordHash, salt);
  return createAuthSession(db, request, adminId, username);
}

export async function login(db, request, username, password) {
  validateCredentials(username, password);
  await cleanupExpiredSessions(db);
  const admin = await findAdminByUsername(db, username);
  if (!admin) {
    throw new Error("用户名或密码错误。");
  }
  const computed = await hashPassword(password, admin.password_salt);
  if (!timingSafeEqual(computed, admin.password_hash)) {
    throw new Error("用户名或密码错误。");
  }
  return createAuthSession(db, request, admin.id, admin.username);
}

export async function getCurrentSession(db, request) {
  await cleanupExpiredSessions(db);
  const cookies = parseCookies(request);
  const token = cookies[sessionCookieName(request)];
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const session = await getSessionByHash(db, tokenHash);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await deleteSessionByHash(db, tokenHash);
    return null;
  }
  await touchSession(db, session.id);
  return {
    id: session.id,
    adminId: session.admin_id,
    username: session.username,
    expiresAt: session.expires_at,
    tokenHash,
  };
}

export async function logout(db, request) {
  const cookies = parseCookies(request);
  const token = cookies[sessionCookieName(request)];
  if (token) {
    const tokenHash = await sha256Hex(token);
    await deleteSessionByHash(db, tokenHash);
  }
  return clearCookie(sessionCookieName(request), request);
}

export async function requireAuth(db, request) {
  const session = await getCurrentSession(db, request);
  if (!session) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}

function validateCredentials(username, password) {
  const normalizedUsername = `${username || ""}`.trim();
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(normalizedUsername)) {
    throw new Error("用户名需为 3-32 位，仅支持字母、数字、点、下划线、短横线。");
  }
  if (`${password || ""}`.length < 10) {
    throw new Error("密码至少需要 10 个字符。");
  }
}

async function createAuthSession(db, request, adminId, username) {
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await createSession(db, adminId, tokenHash, expiresAt);
  return {
    session: {
      username,
      expiresAt,
    },
    cookie: buildCookie(sessionCookieName(request), token, request, SESSION_TTL_SECONDS),
  };
}
