import {
  deleteRoute,
  getAdminCount,
  getRouteById,
  getRouteList,
  insertRoute,
  updateRoute,
} from "./_lib/db.js";
import { getCurrentSession, login, logout, requireAuth, setupInitialAdmin } from "./_lib/auth.js";
import { maybeHandleProxy } from "./_lib/proxy.js";
import { json, noContent, readJson, sanitizeRouteInput, withCors } from "./_lib/utils.js";

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (url.pathname === "/admin") {
    return Response.redirect(`${url.origin}/admin/`, 301);
  }

  if (url.pathname.startsWith("/api/")) {
    return handleApi(context);
  }

  const proxyResponse = await maybeHandleProxy(context);
  if (proxyResponse) return proxyResponse;

  if (request.method === "GET" || request.method === "HEAD") {
    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status !== 404) {
      return assetResponse;
    }
  }

  if (request.method === "GET" || request.method === "HEAD") {
    const fallback = await env.ASSETS.fetch(new Request(new URL("/", request.url), request));
    if (fallback.status !== 404) return fallback;
  }

  return json(
    {
      success: false,
      error: "No matching static asset or proxy route was found.",
    },
    { status: 404 },
  );
}

async function handleApi(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: withCors() });
  }

  try {
    ensureDatabaseBinding(env);

    if (url.pathname === "/api/public/bootstrap" && method === "GET") {
      const initialized = (await getAdminCount(env.DB)) > 0;
      const session = initialized ? await getCurrentSession(env.DB, request) : null;
      const routes = initialized && session ? await getRouteList(env.DB) : [];
      return json(
        {
          success: true,
          initialized,
          session: session
            ? {
                username: session.username,
                expiresAt: session.expiresAt,
              }
            : null,
          stats: {
            totalRoutes: routes.length,
            enabledRoutes: routes.filter((route) => route.enabled).length,
          },
        },
        { headers: withCors() },
      );
    }

    if (url.pathname === "/api/auth/setup" && method === "POST") {
      await requireSameOrigin(request);
      const body = await readJson(request);
      const result = await setupInitialAdmin(env.DB, request, body?.username, body?.password);
      return json(
        {
          success: true,
          message: "Administrator account created.",
          session: result.session,
        },
        {
          status: 201,
          headers: {
            ...withCors(),
            "set-cookie": result.cookie,
          },
        },
      );
    }

    if (url.pathname === "/api/auth/login" && method === "POST") {
      await requireSameOrigin(request);
      const body = await readJson(request);
      const result = await login(env.DB, request, body?.username, body?.password);
      return json(
        {
          success: true,
          message: "Signed in successfully.",
          session: result.session,
        },
        {
          headers: {
            ...withCors(),
            "set-cookie": result.cookie,
          },
        },
      );
    }

    if (url.pathname === "/api/auth/logout" && method === "POST") {
      await requireSameOrigin(request);
      const cookie = await logout(env.DB, request);
      return noContent({
        ...withCors(),
        "set-cookie": cookie,
      });
    }

    if (url.pathname === "/api/auth/session" && method === "GET") {
      const session = await getCurrentSession(env.DB, request);
      return json(
        {
          success: true,
          authenticated: Boolean(session),
          session: session
            ? {
                username: session.username,
                expiresAt: session.expiresAt,
              }
            : null,
        },
        { headers: withCors() },
      );
    }

    if (url.pathname === "/api/overview" && method === "GET") {
      const session = await requireAuth(env.DB, request);
      const routes = await getRouteList(env.DB);
      return json(
        {
          success: true,
          user: {
            username: session.username,
          },
          stats: {
            totalRoutes: routes.length,
            enabledRoutes: routes.filter((route) => route.enabled).length,
            disabledRoutes: routes.filter((route) => !route.enabled).length,
          },
          routes,
        },
        { headers: withCors() },
      );
    }

    if (url.pathname === "/api/routes" && method === "GET") {
      await requireAuth(env.DB, request);
      return json(
        {
          success: true,
          routes: await getRouteList(env.DB),
        },
        { headers: withCors() },
      );
    }

    if (url.pathname === "/api/routes" && method === "POST") {
      await requireSameOrigin(request);
      await requireAuth(env.DB, request);
      const body = await readJson(request);
      const route = sanitizeRouteInput(body);
      const id = await insertRoute(env.DB, route);
      const created = await getRouteById(env.DB, id);
      return json(
        {
          success: true,
          message: "Route created.",
          route: created,
        },
        {
          status: 201,
          headers: withCors(),
        },
      );
    }

    const routeMatch = url.pathname.match(/^\/api\/routes\/(\d+)$/);
    if (routeMatch && method === "PUT") {
      await requireSameOrigin(request);
      await requireAuth(env.DB, request);
      const existing = await getRouteById(env.DB, Number(routeMatch[1]));
      if (!existing) {
        throw new Error("The route you want to update does not exist.");
      }
      const body = await readJson(request);
      const route = sanitizeRouteInput(body);
      await updateRoute(env.DB, Number(routeMatch[1]), route);
      const updated = await getRouteById(env.DB, Number(routeMatch[1]));
      return json(
        {
          success: true,
          message: "Route updated.",
          route: updated,
        },
        { headers: withCors() },
      );
    }

    if (routeMatch && method === "DELETE") {
      await requireSameOrigin(request);
      await requireAuth(env.DB, request);
      const existing = await getRouteById(env.DB, Number(routeMatch[1]));
      if (!existing) {
        throw new Error("The route you want to delete does not exist.");
      }
      await deleteRoute(env.DB, Number(routeMatch[1]));
      return noContent(withCors());
    }

    if (url.pathname === "/api/health" && method === "GET") {
      return json(
        {
          success: true,
          runtime: "cloudflare-pages",
          time: new Date().toISOString(),
        },
        { headers: withCors() },
      );
    }

    return json(
      {
        success: false,
        error: "Undefined API route.",
      },
      {
        status: 404,
        headers: withCors(),
      },
    );
  } catch (error) {
    const message = error?.message || "Unknown error";
    const status = message === "UNAUTHORIZED" ? 401 : 400;
    return json(
      {
        success: false,
        error: message === "UNAUTHORIZED" ? "Please sign in to continue." : message,
      },
      {
        status,
        headers: withCors(),
      },
    );
  }
}

async function requireSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const current = new URL(request.url).origin;
  if (origin !== current) {
    throw new Error("Cross-origin request rejected.");
  }
}

function ensureDatabaseBinding(env) {
  if (!env?.DB || typeof env.DB.prepare !== "function") {
    throw new Error("The D1 database binding named DB is missing from this Pages project.");
  }
}
