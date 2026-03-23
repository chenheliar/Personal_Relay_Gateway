import { formatRouteRow } from "./utils.js";

let routeCache = {
  expiresAt: 0,
  routes: [],
};

export async function getAdminCount(db) {
  const row = await db.prepare("SELECT COUNT(*) AS count FROM admins").first();
  return Number(row?.count || 0);
}

export async function createAdmin(db, username, passwordHash, passwordSalt) {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `INSERT INTO admins (username, password_hash, password_salt, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(username, passwordHash, passwordSalt, now, now)
    .run();
  return result.meta.last_row_id;
}

export async function findAdminByUsername(db, username) {
  return db
    .prepare("SELECT id, username, password_hash, password_salt, created_at FROM admins WHERE username = ? LIMIT 1")
    .bind(username)
    .first();
}

export async function createSession(db, adminId, tokenHash, expiresAt) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO sessions (admin_id, token_hash, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(adminId, tokenHash, expiresAt, now, now)
    .run();
}

export async function getSessionByHash(db, tokenHash) {
  return db
    .prepare(
      `SELECT sessions.id, sessions.admin_id, sessions.expires_at, admins.username
       FROM sessions
       INNER JOIN admins ON admins.id = sessions.admin_id
       WHERE sessions.token_hash = ?
       LIMIT 1`,
    )
    .bind(tokenHash)
    .first();
}

export async function touchSession(db, sessionId) {
  await db
    .prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), sessionId)
    .run();
}

export async function deleteSessionByHash(db, tokenHash) {
  await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
}

export async function cleanupExpiredSessions(db) {
  await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(new Date().toISOString()).run();
}

export async function getRouteList(db, forceRefresh = false) {
  if (!forceRefresh && routeCache.expiresAt > Date.now()) {
    return routeCache.routes;
  }
  const result = await db
    .prepare("SELECT * FROM routes ORDER BY LENGTH(mount_path) DESC, mount_path ASC")
    .all();
  routeCache = {
    expiresAt: Date.now() + 5000,
    routes: (result.results || []).map(formatRouteRow),
  };
  return routeCache.routes;
}

export async function getEnabledRoutes(db, forceRefresh = false) {
  const routes = await getRouteList(db, forceRefresh);
  return routes.filter((route) => route.enabled);
}

export async function getRouteById(db, id) {
  const row = await db.prepare("SELECT * FROM routes WHERE id = ? LIMIT 1").bind(id).first();
  return row ? formatRouteRow(row) : null;
}

export async function insertRoute(db, route) {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `INSERT INTO routes
       (name, mount_path, target_base, description, strip_prefix, enabled, inject_headers, remove_headers, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      route.name,
      route.mountPath,
      route.targetBase,
      route.description,
      route.stripPrefix,
      route.enabled,
      route.injectHeaders,
      route.removeHeaders,
      now,
      now,
    )
    .run();
  await getRouteList(db, true);
  return result.meta.last_row_id;
}

export async function updateRoute(db, id, route) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE routes
       SET name = ?, mount_path = ?, target_base = ?, description = ?, strip_prefix = ?, enabled = ?,
           inject_headers = ?, remove_headers = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      route.name,
      route.mountPath,
      route.targetBase,
      route.description,
      route.stripPrefix,
      route.enabled,
      route.injectHeaders,
      route.removeHeaders,
      now,
      id,
    )
    .run();
  await getRouteList(db, true);
}

export async function deleteRoute(db, id) {
  await db.prepare("DELETE FROM routes WHERE id = ?").bind(id).run();
  await getRouteList(db, true);
}
