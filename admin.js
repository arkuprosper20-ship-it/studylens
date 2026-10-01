'use strict';
// StudyLens Admin Dashboard
//
// Standalone admin page (admin.html) that loads Firebase, verifies the user is
// an administrator, and renders analytics from admin-service.js.
// Never exposes GROQ_API_KEY or any server-side secret.

import {
  initFirebase,
  waitForUser,
  checkAdmin,
  fetchStats,
  fetchAIUsage,
  fetchAssignments,
  fetchSystemHealth,
  fetchModelManagement,
  fetchActivityLog,
  isDemo,
  isAdminUID,
} from "./admin-service.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => r.querySelectorAll(s);

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

const NAV_SECTIONS = [
  ["overview", "Overview", "📊"],
  ["ai-usage", "AI Usage", "🤖"],
  ["assignments", "Assignments", "📋"],
  ["health", "System Health", "🩺"],
  ["models", "Model Management", "⚙️"],
  ["activity", "Activity Log", "📜"],
];

let S = {
  section: "overview",
  user: null,
  firebase: null,
  loading: false,
  error: "",
};

function fmtDate(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return ts;
  }
}

function badge(provider) {
  const map = {
    rules: '<span class="badge badge-rules">Rules</span>',
    webllm: '<span class="badge badge-webllm">On-device AI</span>',
    groq: '<span class="badge badge-groq">Groq Cloud</span>',
  };
  return map[provider] || `<span class="badge badge-rules">${esc(provider)}</span>`;
}

function statusDot(ok, text = "") {
  const cls = ok === "online" || ok === true ? "green" : ok === "offline" || ok === false ? "red" : ok === "degraded" ? "yellow" : "gray";
  return `<span class="status-dot ${cls}"></span> ${text}`;
}

function render() {
  const root = $("#admin-app");
  if (!S.user) {
    root.innerHTML = '<div class="boot">Loading admin panel…</div>';
    return;
  }
  root.innerHTML = renderShell();
  renderSection();
}

function renderShell() {
  const links = NAV_SECTIONS.map(
    ([id, label, icon]) =>
      `<a href="#${id}" class="${S.section === id ? "on" : ""}" data-nav="${id}"><span>${icon}</span>${label}</a>`
  ).join("");

  return `
<div class="admin-shell">
  <aside class="side">
    <div class="brand"><span class="logo">S</span>StudyLens Admin</div>
    <nav class="admin-nav">
      ${links}
    </nav>
    <div class="logout" data-nav="logout"><span class="status-dot gray"></span>Back to app</div>
  </aside>
  <main class="admin-main">
    <div id="admin-content"></div>
  </main>
</div>
`;
}

function renderSection() {
  const content = $("#admin-content");
  if (S.loading) {
    content.innerHTML = '<p class="mu">Loading…</p>';
    return;
  }
  if (S.error) {
    content.innerHTML = `<p class="err" role="alert">${esc(S.error)}</p>`;
    return;
  }
  const renderers = {
    overview: renderOverview,
    "ai-usage": renderAIUsage,
    assignments: renderAssignments,
    health: renderHealth,
    models: renderModels,
    activity: renderActivity,
  };
  const fn = renderers[S.section];
  if (fn) content.innerHTML = fn();
}

function demoBanner() {
  return `<div class="demo-banner"><strong>Demo data</strong> shown because real analytics are not yet provisioned on this project. Connect Firestore analytics to see live statistics.</div>`;
}

function renderOverview() {
  const d = S.data?.overview;
  if (!d) return "";
  const cards = [
    ["Total users", d.totalUsers, "danger"],
    ["Total assignments", d.totalAssignments, "danger"],
    ["Assignments today", d.assignmentsToday, "danger"],
    ["AI analyses", d.aiAnalyses, "danger"],
    ["Rules analyses", d.rulesAnalyses, "danger"],
    ["Groq analyses", d.groqAnalyses, "danger"],
    ["On-device analyses", d.onDeviceAnalyses, "danger"],
    ["Avg completion rate", `${d.averageCompletionRate}%`, "danger"],
  ];
  return `
<h1>Admin Dashboard</h1>
${isDemo(d) ? demoBanner() : ""}
<h2>Overview</h2>
<div class="overview-grid">
${cards
  .map(
    ([label, val, cls]) => `
  <div class="overview-card ${cls}">
    <div class="num">${esc(val)}</div>
    <div class="lbl">${label}</div>
  </div>`
  )
  .join("")}
</div>
`;
}

function renderAIUsage() {
  const d = S.data?.aiUsage;
  if (!d) return "";
  const total = d.rulesUsage + d.webllmUsage + d.groqUsage || 1;
  const rulesPct = Math.round((d.rulesUsage / total) * 100);
  const webllmPct = Math.round((d.webllmUsage / total) * 100);
  const groqPct = Math.round((d.groqUsage / total) * 100);

  return `
<h1>Admin Dashboard</h1>
${isDemo(d) ? demoBanner() : ""}
<h2>AI Usage</h2>
<div class="chart-grid">
  <div class="chart-card">
    <div class="chart-title">Analyses by provider</div>
    <div class="bar-chart">
      <div class="bar-group">
        <div class="bar rules" style="height:${rulesPct}%"><span class="bar-val">${d.rulesUsage}</span></div>
        <div class="bar-label">Rules</div>
      </div>
      <div class="bar-group">
        <div class="bar webllm" style="height:${webllmPct}%"><span class="bar-val">${d.webllmUsage}</span></div>
        <div class="bar-label">On-device</div>
      </div>
      <div class="bar-group">
        <div class="bar groq" style="height:${groqPct}%"><span class="bar-val">${d.groqUsage}</span></div>
        <div class="bar-label">Groq</div>
      </div>
    </div>
    <div class="bar-legend">
      <span><i style="background:#475569"></i>Rules: ${d.rulesUsage} (${rulesPct}%)</span>
      <span><i style="background:#2da98d"></i>On-device: ${d.webllmUsage} (${webllmPct}%)</span>
      <span><i style="background:#7C3AED"></i>Groq: ${d.groqUsage} (${groqPct}%)</span>
    </div>
  </div>
  <div class="chart-card">
    <div class="chart-title">Performance metrics</div>
    <table class="status-table">
      <tr><th>Metric</th><th>Value</th></tr>
      <tr><td>AI success rate</td><td>${d.aiSuccessRate}%</td></tr>
      <tr><td>Fallback rate</td><td>${d.fallbackRate}%</td></tr>
      <tr><td>Avg analysis time</td><td>${d.avgAnalysisTime > 0 ? d.avgAnalysisTime + " ms" : "—"}</td></tr>
      <tr><td>Rules avg time</td><td>${d.times.rules > 0 ? d.times.rules + " ms" : "—"}</td></tr>
      <tr><td>WebLLM avg time</td><td>${d.times.webllm > 0 ? d.times.webllm + " ms" : "—"}</td></tr>
      <tr><td>Groq avg time</td><td>${d.times.groq > 0 ? d.times.groq + " ms" : "—"}</td></tr>
      <tr><td>Provider errors</td><td>${d.providerErrors}</td></tr>
    </table>
  </div>
</div>
`;
}

function renderAssignments() {
  const d = S.data?.assignments;
  if (!d) return "";
  const rows = d.rows || [];
  return `
<h1>Admin Dashboard</h1>
${isDemo(d) ? demoBanner() : ""}
<h2>Recent Assignments</h2>
<table class="assignments-table">
  <thead>
    <tr>
      <th>Type</th><th>User</th><th>Date</th><th>Provider</th><th>Confidence</th><th>Progress</th><th>Status</th>
    </tr>
  </thead>
  <tbody>
    ${rows
      .map(
        (a) => `
      <tr>
        <td>${esc(a.type)}</td>
        <td>${esc(a.userName)}</td>
        <td>${fmtDate(a.date)}</td>
        <td>${badge(a.provider)}</td>
        <td>${a.confidence != null ? Math.round(a.confidence * 100) + "%" : "—"}</td>
        <td><div class="progress-bar-mini"><i style="width:${a.progress}%"></i></div></td>
        <td>${esc(a.status)}</td>
      </tr>`
      )
      .join("")}
    ${rows.length === 0 ? '<tr><td colspan="7" class="mu" style="text-align:center;padding:2rem">No assignments yet</td></tr>' : ""}
  </tbody>
</table>
`;
}

function renderHealth() {
  const d = S.data?.health;
  if (!d) return "";
  const webllmOk = d.webllm?.webgpu;
  const groqStatus = d.groq?.configured
    ? d.groq?.reachable
      ? statusDot("online", "Configured & reachable")
      : statusDot("degraded", "Configured but unreachable")
    : statusDot("offline", "Not configured");

  return `
<h1>Admin Dashboard</h1>
${isDemo(d) ? demoBanner() : ""}
<h2>System Health</h2>
<table class="status-table">
  <tr><th>Component</th><th>Status</th><th>Details</th></tr>
  <tr><td>Rules engine</td><td>${statusDot("online", "Online")}</td><td>Always available</td></tr>
  <tr><td>WebLLM</td><td>${webllmOk ? statusDot("online", "Available") : statusDot("offline", "Unavailable")}</td><td>${d.webllm?.tier || "—"} tier, ${d.webllm?.webgpu ? "WebGPU present" : "WebGPU not available"}</td></tr>
  <tr><td>Groq</td><td>${groqStatus}</td><td>Model: ${esc(d.groq?.textModel || "—")}</td></tr>
  <tr><td>Last successful analysis</td><td>—</td><td>${fmtDate(d.lastSuccessfulAnalysis)}</td></tr>
  <tr><td>Recent errors</td><td>—</td><td>${(d.recentErrors || []).map((e) => `<div>${esc(e.message)} — ${fmtDate(e.ts)}</div>`).join("") || "None"}</td></tr>
</table>
`;
}

function renderModels() {
  const d = S.data?.models;
  if (!d) return "";
  return `
<h1>Admin Dashboard</h1>
<h2>Model Management</h2>
<div class="model-grid">
  <div class="model-card">
    <h4>On-device AI</h4>
    <div class="meta">${d.webgpuSupport ? `${d.deviceTier} tier device` : "WebGPU unavailable"}</div>
    <div class="meta">Active model: <b>StudyLens Small</b> (Qwen2.5 0.5B)</div>
    <div class="meta">Model size: ~266 MB</div>
  </div>
  <div class="model-card">
    <h4>Groq Cloud</h4>
    <div class="meta">Text model: <b>${d.groqConfigured ? esc(d.groqModel || "—") : "Not configured"}</b></div>
    <div class="meta">Vision model: <b>${esc(d.groqVisionModel || "—")}</b></div>
    <div class="meta">Status: ${d.groqConfigured ? statusDot("online", "Ready") : statusDot("offline", "Not configured")}</div>
  </div>
  <div class="model-card">
    <h4>Rules engine</h4>
    <div class="meta">Always available</div>
    <div class="meta">No API key required</div>
    <div class="meta">100% offline</div>
  </div>
</div>
`;
}

function renderActivity() {
  const d = S.data?.activity;
  if (!d) return "";
  const events = d.events || [];
  return `
<h1>Admin Dashboard</h1>
${isDemo(d) ? demoBanner() : ""}
<h2>Activity Log</h2>
<ul class="activity-list">
  ${events
    .map(
      (e) => `
  <li>
    <span class="act-icon ${e.provider || "rules"}">${iconFor(e.type)}</span>
    <div>${esc(e.message)}</div>
    <span class="act-time">${fmtDate(e.ts)}</span>
  </li>`
    )
    .join("")}
  ${events.length === 0 ? '<li class="mu">No activity yet</li>' : ""}
</ul>
`;
}

function iconFor(type) {
  if (type === "assignment_analysis") return "📊";
  if (type === "groq_error") return "⚠️";
  if (type === "model_download") return "⬇️";
  if (type === "model_remove") return "🗑";
  if (type === "webllm") return "💻";
  if (type === "fallback") return "🔄";
  return "•";
}

async function loadData() {
  S.loading = true;
  S.error = "";
  render();

  try {
    const db = S.firebase?.db;
    const [overview, aiUsage, assignments, health, models, activity] = await Promise.all([
      fetchStats(db),
      fetchAIUsage(db),
      fetchAssignments(db),
      fetchSystemHealth(db),
      fetchModelManagement(db),
      fetchActivityLog(db),
    ]);

    S.data = { overview, aiUsage, assignments, health, models, activity };
    S.loading = false;
    render();
    renderSection();
  } catch (e) {
    S.loading = false;
    S.error = e.message || "Failed to load admin data.";
    render();
  }
}

document.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-nav]");
  if (!nav) return;
  const target = nav.dataset.nav;
  if (target === "logout") {
    window.location.href = "index.html";
    return;
  }
  S.section = target;
  history.replaceState(null, "", `#${target}`);
  render();
});

window.addEventListener("hashchange", () => {
  const h = location.hash.replace(/^#\//?, "").replace(/^#/, "");
  if (NAV_SECTIONS.some(([id]) => id === h)) S.section = h;
  render();
});

(async function init() {
  const firebase = await initFirebase();
  if (!firebase) {
    S.error = "Firebase is not configured. Admin page requires a production Firebase setup.";
    render();
    return;
  }
  S.firebase = firebase;

  const user = await waitForUser(firebase.auth);
  if (!user || !await checkAdmin(user, firebase.db)) {
    window.location.href = "index.html";
    return;
  }
  S.user = user;
  render();

  const hash = location.hash.replace(/^#\//?, "").replace(/^#/, "");
  if (NAV_SECTIONS.some(([id]) => id === hash)) S.section = hash;

  await loadData();
})();
