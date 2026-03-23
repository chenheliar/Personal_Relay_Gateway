import { getEnabledRoutes } from "./db.js";
import { isRouteMatch, joinPaths, text, withCors } from "./utils.js";

export async function maybeHandleProxy(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const routes = await getEnabledRoutes(env.DB);
  const route = routes.find((item) => isRouteMatch(url.pathname, item.mount_path));

  if (!route) {
    return null;
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: withCors({
        "x-gateway-route": route.mount_path,
      }),
    });
  }

  try {
    const upstream = buildTargetUrl(url, route);
    const upstreamRequest = new Request(upstream.toString(), {
      method: request.method,
      headers: rewriteRequestHeaders(request.headers, route, url),
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    });

    const upstreamResponse = await fetch(upstreamRequest);
    const headers = rewriteResponseHeaders(upstreamResponse.headers, route, url, upstream);

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
    });
  } catch (error) {
    return text(`Gateway upstream error: ${error.message || "unknown error"}`, {
      status: 502,
      headers: withCors(),
    });
  }
}

function buildTargetUrl(incomingUrl, route) {
  const target = new URL(route.target_base);
  const remainder = route.strip_prefix
    ? incomingUrl.pathname.slice(route.mount_path.length) || "/"
    : incomingUrl.pathname;
  target.pathname = joinPaths(target.pathname || "/", remainder || "/");
  target.search = incomingUrl.search;
  return target;
}

function rewriteRequestHeaders(sourceHeaders, route, incomingUrl) {
  const headers = new Headers(sourceHeaders);
  const removeHeaders = ["host", "cf-connecting-ip", "cf-ipcountry", "cf-ray", "x-forwarded-host", "x-forwarded-proto"];

  for (const name of removeHeaders.concat(route.remove_headers || [])) {
    headers.delete(name);
  }

  headers.set("x-forwarded-host", incomingUrl.host);
  headers.set("x-forwarded-proto", incomingUrl.protocol.replace(":", ""));
  headers.set("x-gateway-route", route.mount_path);

  for (const [key, value] of Object.entries(route.inject_headers || {})) {
    headers.set(key, value);
  }

  return headers;
}

function rewriteResponseHeaders(sourceHeaders, route, incomingUrl, upstreamUrl) {
  const headers = new Headers(sourceHeaders);
  headers.set("x-gateway-route", route.mount_path);
  headers.set("cache-control", headers.get("cache-control") || "no-store");

  const location = headers.get("location");
  if (location) {
    const rewritten = rewriteLocation(location, route, incomingUrl, upstreamUrl);
    if (rewritten) headers.set("location", rewritten);
  }

  for (const [key, value] of Object.entries(withCors())) {
    headers.set(key, value);
  }
  return headers;
}

function rewriteLocation(location, route, incomingUrl, upstreamUrl) {
  try {
    const resolved = new URL(location, upstreamUrl);
    if (resolved.origin !== upstreamUrl.origin) {
      return location;
    }
    const basePath = new URL(route.target_base).pathname.replace(/\/$/, "");
    const suffix = resolved.pathname.startsWith(basePath) ? resolved.pathname.slice(basePath.length) : resolved.pathname;
    const next = new URL(incomingUrl.toString());
    next.pathname = route.strip_prefix ? joinPaths(route.mount_path, suffix || "/") : resolved.pathname;
    next.search = resolved.search;
    return next.toString();
  } catch {
    return location;
  }
}
