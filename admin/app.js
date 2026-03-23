const state = {
  initialized: false,
  session: null,
  routes: [],
  editingId: null,
};

const presets = {
  openai: {
    name: "OpenAI 主通道",
    mountPath: "/openai",
    targetBase: "https://api.openai.com",
    description: "适合对接 OpenAI REST / SSE 接口。",
    injectHeaders: '{\n  "Authorization": "Bearer sk-..."\n}',
    removeHeaders: '["origin"]',
    stripPrefix: true,
    enabled: true,
  },
  gemini: {
    name: "Gemini 通道",
    mountPath: "/gemini",
    targetBase: "https://generativelanguage.googleapis.com",
    description: "Generative Language API 转发。",
    injectHeaders: '{\n  "x-goog-api-key": "YOUR_API_KEY"\n}',
    removeHeaders: '["origin"]',
    stripPrefix: true,
    enabled: true,
  },
  npm: {
    name: "npm Registry",
    mountPath: "/npm",
    targetBase: "https://registry.npmjs.org",
    description: "用于 npm install / npm view 等请求镜像中转。",
    injectHeaders: "{}",
    removeHeaders: "[]",
    stripPrefix: true,
    enabled: true,
  },
  docker: {
    name: "Docker Hub Registry",
    mountPath: "/docker",
    targetBase: "https://registry-1.docker.io",
    description: "Docker Registry HTTP API v2 中转入口。",
    injectHeaders: "{}",
    removeHeaders: '["origin"]',
    stripPrefix: true,
    enabled: true,
  },
};

const authView = document.getElementById("auth-view");
const dashboardView = document.getElementById("dashboard-view");
const sessionUser = document.getElementById("session-user");
const statsGrid = document.getElementById("stats-grid");
const routesList = document.getElementById("routes-list");
const routeForm = document.getElementById("route-form");
const editorTitle = document.getElementById("editor-title");
const cancelEditButton = document.getElementById("cancel-edit");
const routePreview = document.getElementById("route-preview");
const toast = document.getElementById("toast");

init().catch((error) => showToast(error.message || "初始化失败"));

async function init() {
  bindEvents();
  const bootstrap = await api("/api/public/bootstrap");
  state.initialized = bootstrap.initialized;
  state.session = bootstrap.session;
  if (!state.initialized) {
    renderSetup();
    return;
  }
  if (!state.session) {
    renderLogin();
    return;
  }
  await loadDashboard();
}

function bindEvents() {
  routeForm.addEventListener("submit", onSubmitRoute);
  cancelEditButton.addEventListener("click", resetEditor);
  document.getElementById("logout-button").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    state.session = null;
    state.routes = [];
    renderLogin();
    showToast("已退出登录。");
  });

  document.querySelectorAll(".preset").forEach((button) => {
    button.addEventListener("click", () => applyPreset(button.dataset.preset));
  });

  ["route-mountPath", "route-targetBase"].forEach((id) => {
    document.getElementById(id).addEventListener("input", updatePreview);
  });
}

function renderSetup() {
  dashboardView.classList.add("hidden");
  authView.classList.remove("hidden");
  authView.innerHTML = `
    <div class="auth-card">
      <span class="eyebrow">First Run</span>
      <h2>初始化管理员账户</h2>
      <p class="subtle">当前 D1 数据库中还没有管理员。创建第一个账号后即可进入完整后台。</p>
      <form id="setup-form" class="auth-form">
        <label>
          <span>管理员用户名</span>
          <input name="username" autocomplete="username" placeholder="admin" required />
        </label>
        <label>
          <span>登录密码</span>
          <input name="password" type="password" autocomplete="new-password" placeholder="至少 10 位" required />
        </label>
        <button class="button primary" type="submit">创建并登录</button>
      </form>
    </div>
  `;

  document.getElementById("setup-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const result = await api("/api/auth/setup", {
      method: "POST",
      body: payload,
    });
    state.initialized = true;
    state.session = result.session;
    showToast("管理员已创建。");
    await loadDashboard();
  });
}

function renderLogin() {
  dashboardView.classList.add("hidden");
  authView.classList.remove("hidden");
  authView.innerHTML = `
    <div class="auth-card">
      <span class="eyebrow">Sign In</span>
      <h2>登录管理后台</h2>
      <p class="subtle">使用你在 D1 中初始化过的管理员账户进入后台。</p>
      <form id="login-form" class="auth-form">
        <label>
          <span>用户名</span>
          <input name="username" autocomplete="username" required />
        </label>
        <label>
          <span>密码</span>
          <input name="password" type="password" autocomplete="current-password" required />
        </label>
        <button class="button primary" type="submit">登录</button>
      </form>
    </div>
  `;

  document.getElementById("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const result = await api("/api/auth/login", {
      method: "POST",
      body: payload,
    });
    state.session = result.session;
    showToast("欢迎回来。");
    await loadDashboard();
  });
}

async function loadDashboard() {
  const overview = await api("/api/overview");
  state.session = overview.user;
  state.routes = overview.routes;
  authView.classList.add("hidden");
  dashboardView.classList.remove("hidden");
  sessionUser.textContent = overview.user.username;
  renderStats(overview.stats);
  renderRoutes();
  resetEditor();
}

function renderStats(stats) {
  const items = [
    { label: "总路由数", value: stats.totalRoutes },
    { label: "启用中", value: stats.enabledRoutes },
    { label: "已停用", value: stats.disabledRoutes },
  ];
  statsGrid.innerHTML = items
    .map(
      (item) => `
        <div class="surface stat-card">
          <span>${item.label}</span>
          <strong>${item.value}</strong>
        </div>
      `,
    )
    .join("");
}

function renderRoutes() {
  if (!state.routes.length) {
    routesList.innerHTML = `
      <div class="route-card">
        <div class="route-header">
          <div class="route-path">还没有任何路由</div>
        </div>
        <p class="subtle">先从 OpenAI、Gemini、npm 或 Docker 预设开始，或者手动创建一条新规则。</p>
      </div>
    `;
    return;
  }

  routesList.innerHTML = state.routes
    .map(
      (route) => `
        <article class="route-card" data-id="${route.id}">
          <div class="route-header">
            <div>
              <div class="route-path">${escapeHtml(route.mount_path)}</div>
              <strong>${escapeHtml(route.name)}</strong>
            </div>
            <span class="status-pill ${route.enabled ? "enabled" : "disabled"}">${route.enabled ? "enabled" : "disabled"}</span>
          </div>
          <p class="route-target">${escapeHtml(route.target_base)}</p>
          <p class="subtle">${escapeHtml(route.description || "未填写描述。")}</p>
          <div class="route-meta">
            <code>${escapeHtml(route.strip_prefix ? "strip-prefix:on" : "strip-prefix:off")}</code>
            <span class="linkish">${window.location.origin}${escapeHtml(route.mount_path)}</span>
          </div>
          <div class="route-actions">
            <button class="button ghost" type="button" data-action="edit" data-id="${route.id}">编辑</button>
            <button class="button ghost" type="button" data-action="delete" data-id="${route.id}">删除</button>
          </div>
        </article>
      `,
    )
    .join("");

  routesList.querySelectorAll("[data-action='edit']").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const route = state.routes.find((item) => item.id === Number(button.dataset.id));
      if (route) populateEditor(route);
    });
  });

  routesList.querySelectorAll("[data-action='delete']").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const id = Number(button.dataset.id);
      const route = state.routes.find((item) => item.id === id);
      if (!route || !window.confirm(`确定删除路由 ${route.mount_path} 吗？`)) return;
      await api(`/api/routes/${id}`, { method: "DELETE" });
      showToast("路由已删除。");
      await refreshRoutes();
      resetEditor();
    });
  });

  routesList.querySelectorAll(".route-card").forEach((card) => {
    card.addEventListener("click", () => {
      const route = state.routes.find((item) => item.id === Number(card.dataset.id));
      if (route) populateEditor(route);
    });
  });
}

function populateEditor(route) {
  state.editingId = route.id;
  editorTitle.textContent = `编辑路由 #${route.id}`;
  cancelEditButton.classList.remove("hidden");
  document.getElementById("route-id").value = route.id;
  document.getElementById("route-name").value = route.name || "";
  document.getElementById("route-mountPath").value = route.mount_path || "";
  document.getElementById("route-targetBase").value = route.target_base || "";
  document.getElementById("route-description").value = route.description || "";
  document.getElementById("route-injectHeaders").value = JSON.stringify(route.inject_headers || {}, null, 2);
  document.getElementById("route-removeHeaders").value = JSON.stringify(route.remove_headers || [], null, 2);
  document.getElementById("route-stripPrefix").checked = Boolean(route.strip_prefix);
  document.getElementById("route-enabled").checked = Boolean(route.enabled);
  document.getElementById("submit-button").textContent = "更新路由";
  updatePreview();
}

function resetEditor() {
  state.editingId = null;
  editorTitle.textContent = "添加新路由";
  cancelEditButton.classList.add("hidden");
  routeForm.reset();
  document.getElementById("route-id").value = "";
  document.getElementById("route-stripPrefix").checked = true;
  document.getElementById("route-enabled").checked = true;
  document.getElementById("route-injectHeaders").value = "{}";
  document.getElementById("route-removeHeaders").value = "[]";
  document.getElementById("submit-button").textContent = "保存路由";
  updatePreview();
}

function applyPreset(name) {
  const preset = presets[name];
  if (!preset) return;
  document.getElementById("route-name").value = preset.name;
  document.getElementById("route-mountPath").value = preset.mountPath;
  document.getElementById("route-targetBase").value = preset.targetBase;
  document.getElementById("route-description").value = preset.description;
  document.getElementById("route-injectHeaders").value = preset.injectHeaders;
  document.getElementById("route-removeHeaders").value = preset.removeHeaders;
  document.getElementById("route-stripPrefix").checked = preset.stripPrefix;
  document.getElementById("route-enabled").checked = preset.enabled;
  updatePreview();
}

async function onSubmitRoute(event) {
  event.preventDefault();
  const payload = {
    name: document.getElementById("route-name").value,
    mountPath: document.getElementById("route-mountPath").value,
    targetBase: document.getElementById("route-targetBase").value,
    description: document.getElementById("route-description").value,
    injectHeaders: document.getElementById("route-injectHeaders").value,
    removeHeaders: document.getElementById("route-removeHeaders").value,
    stripPrefix: document.getElementById("route-stripPrefix").checked,
    enabled: document.getElementById("route-enabled").checked,
  };

  if (state.editingId) {
    await api(`/api/routes/${state.editingId}`, {
      method: "PUT",
      body: payload,
    });
    showToast("路由已更新。");
  } else {
    await api("/api/routes", {
      method: "POST",
      body: payload,
    });
    showToast("路由已创建。");
  }

  await refreshRoutes();
  resetEditor();
}

async function refreshRoutes() {
  const overview = await api("/api/overview");
  state.routes = overview.routes;
  renderStats(overview.stats);
  renderRoutes();
}

function updatePreview() {
  const mountPath = document.getElementById("route-mountPath").value.trim() || "/example";
  const targetBase = document.getElementById("route-targetBase").value.trim() || "https://upstream.example.com";
  routePreview.textContent = `${window.location.origin}${mountPath.replace(/\/$/, "")}/v1/example  →  ${targetBase.replace(/\/$/, "")}/v1/example`;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
    },
    credentials: "same-origin",
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 204) return {};
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.error || "请求失败");
  }
  return data;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("hidden"), 2600);
}

function escapeHtml(value) {
  return `${value ?? ""}`
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
