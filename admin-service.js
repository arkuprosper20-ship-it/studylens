// StudyLens admin service layer.
//
// Provides a clean boundary between the admin dashboard (admin.js / admin.html)
// and the data sources (Firebase Firestore + the local Groq status endpoint).
//
// When Firestore analytics are not yet provisioned, every method falls back to
// clearly-labelled demo data so the dashboard is never empty.
//
// Public surface:
//   initFirebase()            -> { firebase, auth, db } or null
//   waitForUser(auth)         -> Firebase User | null
//   checkAdmin(user, db)      -> boolean
//   logAnalysisEvent(db, data) -> void  (called by app.js after each analysis)
//   fetchStats(db)            -> overview stats
//   fetchAIUsage(db)          -> AI usage statistics
//   fetchAssignments(db)      -> recent assignment rows
//   fetchSystemHealth(db)     -> system health indicators
//   fetchModelManagement(db)  -> model management details
//   fetchActivityLog(db)      -> recent activity events
//   isDemo(data)              -> true when data was generated as demo

import { FIREBASE_CONFIG, ADMIN_UID } from "./firebase-config.js";

const FIREBASE_CDN = "https://www.gstatic.com/firebasejs/10.12.2/";

export const isDemo = (data) => data && data.isDemo === true;

export function isAdminUID(uid) {
  return uid === ADMIN_UID;
}

async function loadFirebase() {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(FIREBASE_CDN + "firebase-app.js"),
    import(FIREBASE_CDN + "firebase-auth.js"),
    import(FIREBASE_CDN + "firebase-firestore.js"),
  ]);
  return { initializeApp, Auth: A, Firestore: F };
}

export async function initFirebase() {
  if (!FIREBASE_CONFIG || !FIREBASE_CONFIG.apiKey) return null;
  const lib = await loadFirebase();
  const app = lib.initializeApp(FIREBASE_CONFIG);
  return {
    firebase: true,
    auth: lib.Auth.getAuth(app),
    db: lib.Firestore.getFirestore(app),
  };
}

const AUTH_RESOLVE_TIMEOUT = 5000;

export function waitForUser(auth) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, AUTH_RESOLVE_TIMEOUT);
    import(FIREBASE_CDN + "firebase-auth.js").then((mod) => {
      if (settled) return;
      const unsub = mod.onAuthStateChanged(auth, (user) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsub();
        resolve(user);
      });
    });
  });
}

export async function checkAdmin(user, db) {
  if (!user || !user.uid) return false;
  if (isAdminUID(user.uid)) return true;
  if (!db) return false;
  try {
    const F = (await import(FIREBASE_CDN + "firebase-firestore.js")).Firestore;
    const snap = await F.getDoc(F.doc(db, "users", user.uid));
    return snap.exists() && snap.data().role === "admin";
  } catch {
    return false;
  }
}

async function fetchStatsFromFirestore(db) {
  const F = (await import(FIREBASE_CDN + "firebase-firestore.js")).Firestore;

  const usersSnap = await F.getDocs(F.collection(db, "users"));
  const userDocs = usersSnap.docs;
  const totalUsers = userDocs.length;

  let totalAssignments = 0;
  let assignmentsToday = 0;
  let aiAnalyses = 0;
  let rulesAnalyses = 0;
  let groqAnalyses = 0;
  let onDeviceAnalyses = 0;
  let completionSum = 0;
  let completionCount = 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const userDoc of userDocs) {
    const uid = userDoc.id;
    const assignSnap = await F.getDocs(F.collection(db, "users", uid, "assignments"));
    for (const a of assignSnap.docs) {
      const data = a.data();
      totalAssignments++;
      const created = data.createdAt ? new Date(data.createdAt) : null;
      if (created && created >= today) assignmentsToday++;

      const provider = data.analysis?.analysisProvider || "rules";
      if (provider === "rules") rulesAnalyses++;
      else {
        aiAnalyses++;
        if (provider === "groq") groqAnalyses++;
        if (provider === "webllm") onDeviceAnalyses++;
      }

      const tasks = data.result?.tasks || [];
      if (tasks.length) {
        const done = (data.done || []).filter(Boolean).length;
        completionSum += Math.round((done / tasks.length) * 100);
        completionCount++;
      }
    }
  }

  return {
    isDemo: false,
    totalUsers,
    totalAssignments,
    assignmentsToday,
    aiAnalyses,
    rulesAnalyses,
    groqAnalyses,
    onDeviceAnalyses,
    averageCompletionRate: completionCount ? Math.round(completionSum / completionCount) : 0,
  };
}

async function fetchAIUsageFromFirestore(db) {
  const F = (await import(FIREBASE_CDN + "firebase-firestore.js")).Firestore;
  const eventsSnap = await F.getDocs(F.collection(db, "analytics", "events"));
  const events = eventsSnap.docs.map((d) => d.data());

  const counts = { rules: 0, webllm: 0, groq: 0 };
  const times = { rules: [], webllm: [], groq: [] };
  let totalAI = 0;
  let fallbackCount = 0;
  let errorCount = 0;

  for (const event of events) {
    if (event.type === "assignment_analysis") {
      const provider = event.provider || "rules";
      if (provider === "rules") counts.rules++;
      else {
        counts.webllm += provider === "webllm" ? 1 : 0;
        counts.groq += provider === "groq" ? 1 : 0;
        totalAI++;
        if (event.ms && typeof event.ms === "number") {
          if (provider === "webllm") times.webllm.push(event.ms);
          if (provider === "groq") times.groq.push(event.ms);
        }
        if (event.fallbackFrom) fallbackCount++;
      }
    }
    if (event.type === "groq_error" || event.type === "groq_failure") errorCount++;
  }

  const avgTime = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);

  return {
    isDemo: false,
    rulesUsage: counts.rules,
    webllmUsage: counts.webllm,
    groqUsage: counts.groq,
    aiSuccessRate: totalAI > 0 ? Math.round(((totalAI - fallbackCount) / totalAI) * 100) : 0,
    fallbackRate: totalAI > 0 ? Math.round((fallbackCount / totalAI) * 100) : 0,
    avgAnalysisTime: avgTime(times.webllm.concat(times.groq)),
    providerErrors: errorCount,
    times: { rules: avgTime(times.rules), webllm: avgTime(times.webllm), groq: avgTime(times.groq) },
  };
}

async function fetchAssignmentsFromFirestore(db) {
  const F = (await import(FIREBASE_CDN + "firebase-firestore.js")).Firestore;
  const usersSnap = await F.getDocs(F.collection(db, "users"));
  const rows = [];
  for (const userDoc of usersSnap.docs) {
    const assignSnap = await F.getDocs(
      F.query(
        F.collection(db, "users", userDoc.id, "assignments"),
        F.orderBy("createdAt", "desc"),
        F.limit(50)
      )
    );
    for (const a of assignSnap.docs) {
      const data = a.data();
      rows.push({
        id: a.id,
        userId: userDoc.id,
        userName: userDoc.data().name || "Unknown",
        type: data.analysis?.type || data.result?.type || "—",
        date: data.createdAt ? new Date(data.createdAt).toISOString() : null,
        provider: data.analysis?.analysisProvider || "rules",
        confidence: data.analysis?.analysisConfidence,
        progress: Math.round(
          (data.done || []).filter(Boolean).length /
            (data.result?.tasks.length || 1) *
            100
        ) || 0,
        status: data.confirmed ? "completed" : "in-progress",
      });
    }
  }
  rows.sort((a, b) => (b.date || "") > (a.date || ""));
  return { isDemo: false, rows: rows.slice(0, 50) };
}

export async function logAnalysisEvent(db, event) {
  if (!db) return;
  try {
    const F = (await import(FIREBASE_CDN + "firebase-firestore.js")).Firestore;
    await F.addDoc(F.collection(db, "analytics", "events"), {
      type: "assignment_analysis",
      userId: event.userId,
      provider: event.provider,
      model: event.model,
      confidence: event.confidence,
      ms: event.ms,
      fallbackFrom: event.fallbackFrom || null,
      isAssignment: event.isAssignment,
      timestamp: F.serverTimestamp(),
    });
  } catch {
    /* analytics are non-critical */
  }
}

export async function logGroqError(db, errorInfo) {
  if (!db) return;
  try {
    const F = (await import(FIREBASE_CDN + "firebase-firestore.js")).Firestore;
    await F.addDoc(F.collection(db, "analytics", "events"), {
      type: "groq_error",
      userId: errorInfo.userId,
      code: errorInfo.code,
      message: errorInfo.message,
      timestamp: F.serverTimestamp(),
    });
  } catch {
    /* non-critical */
  }
}

export async function fetchGroqServerStatus() {
  try {
    const res = await fetch("/api/groq?status=1", { cache: "no-store" });
    if (!res.ok) return { configured: false, reachable: false };
    const data = await res.json();
    return {
      configured: data.configured === true,
      reachable: true,
      textModel: data.textModel,
      visionModel: data.visionModel,
      visionSupported: data.visionSupported,
    };
  } catch {
    return { configured: false, reachable: false };
  }
}

export async function fetchOnDeviceStatus() {
  const webgpu = !!globalThis.navigator?.gpu;
  let tier = "unsupported";
  if (webgpu) {
    try {
      const adapter = await globalThis.navigator.gpu.requestAdapter();
      const maxSSBO = adapter?.limits?.maxStorageBufferBindingSize || 0;
      if (maxSSBO >= 3_000_000_000) tier = "advanced";
      else if (maxSSBO >= 1_000_000_000) tier = "standard";
      else tier = "basic";
    } catch {
      tier = "basic";
    }
  }
  return { webgpu, tier };
}

const DEMO_DATA = {
  overview: {
    isDemo: true,
    totalUsers: 1247,
    totalAssignments: 3842,
    assignmentsToday: 43,
    aiAnalyses: 1567,
    rulesAnalyses: 2275,
    groqAnalyses: 892,
    onDeviceAnalyses: 675,
    averageCompletionRate: 68,
  },
  aiUsage: {
    isDemo: true,
    rulesUsage: 2275,
    webllmUsage: 675,
    groqUsage: 892,
    aiSuccessRate: 94,
    fallbackRate: 8,
    avgAnalysisTime: 1200,
    providerErrors: 32,
    times: { rules: 0, webllm: 800, groq: 2400 },
  },
  assignments: {
    isDemo: true,
    rows: [
      { id: "demo-1", userId: "user_a", userName: "Alex Chen", type: "Essay / Paper", date: "2026-09-30T14:30:00Z", provider: "rules", confidence: 0.96, progress: 85, status: "in-progress" },
      { id: "demo-2", userId: "user_b", userName: "Sam Rivera", type: "Coding Project", date: "2026-09-30T10:15:00Z", provider: "groq", confidence: 0.88, progress: 100, status: "completed" },
      { id: "demo-3", userId: "user_c", userName: "Jordan Lee", type: "Lab Report", date: "2026-09-29T18:45:00Z", provider: "webllm", confidence: 0.92, progress: 45, status: "in-progress" },
      { id: "demo-4", userId: "user_a", userName: "Alex Chen", type: "Presentation", date: "2026-09-29T09:20:00Z", provider: "rules", confidence: 0.89, progress: 100, status: "completed" },
      { id: "demo-5", userId: "user_d", userName: "Maria Santos", type: "Essay / Paper", date: "2026-09-28T16:10:00Z", provider: "groq", confidence: 0.84, progress: 30, status: "in-progress" },
    ],
  },
  systemHealth: {
    isDemo: true,
    rulesEngine: "online",
    webllm: { available: false, reason: "WebGPU not available in this browser" },
    groq: { configured: false, reachable: false },
    lastSuccessfulAnalysis: "2026-09-30T14:30:00Z",
    recentErrors: [],
  },
  modelManagement: {
    isDemo: true,
    selectedModel: "Qwen2.5-0.5B-Instruct-q4f32_1-MLC",
    installedModel: "Qwen2.5-0.5B-Instruct-q4f32_1-MLC",
    modelSize: 266,
    webgpuSupport: false,
    groqModel: "qwen/qwen3.6-27b",
    providerStatus: "ready",
  },
  activityLog: {
    isDemo: true,
    events: [
      { type: "analysis", message: "Assignment analyzed with rules engine", ts: "2026-09-30T14:30:00Z", provider: "rules" },
      { type: "analysis", message: "Assignment enhanced with Groq Cloud", ts: "2026-09-30T14:22:00Z", provider: "groq" },
      { type: "webllm", message: "WebLLM engine initialized", ts: "2026-09-30T11:05:00Z", provider: "webllm" },
      { type: "groq_success", message: "Groq request succeeded", ts: "2026-09-30T10:45:00Z", provider: "groq" },
      { type: "fallback", message: "Groq failed, fell back to WebLLM", ts: "2026-09-30T09:12:00Z", provider: "webllm" },
      { type: "model_download", message: "Model downloaded: StudyLens Small", ts: "2026-09-29T16:40:00Z", provider: "webllm" },
      { type: "model_remove", message: "Model removed: StudyLens Medium", ts: "2026-09-29T15:30:00Z", provider: "webllm" },
    ],
  },
};

export async function fetchStats(db) {
  if (!db) return DEMO_DATA.overview;
  try {
    return await fetchStatsFromFirestore(db);
  } catch (e) {
    console.warn("[StudyLens Admin] Could not fetch stats from Firestore, using demo data:", e.message);
    return { ...DEMO_DATA.overview, isDemo: true, error: e.message };
  }
}

export async function fetchAIUsage(db) {
  if (!db) return DEMO_DATA.aiUsage;
  try {
    return await fetchAIUsageFromFirestore(db);
  } catch (e) {
    console.warn("[StudyLens Admin] Could not fetch AI usage from Firestore, using demo data:", e.message);
    return { ...DEMO_DATA.aiUsage, isDemo: true, error: e.message };
  }
}

export async function fetchAssignments(db) {
  if (!db) return DEMO_DATA.assignments;
  try {
    return await fetchAssignmentsFromFirestore(db);
  } catch (e) {
    console.warn("[StudyLens Admin] Could not fetch assignments from Firestore, using demo data:", e.message);
    return { ...DEMO_DATA.assignments, isDemo: true, error: e.message };
  }
}

export async function fetchSystemHealth(db) {
  const groq = await fetchGroqServerStatus();
  const onDevice = await fetchOnDeviceStatus();
  if (!db) {
    return { ...DEMO_DATA.systemHealth, isDemo: true, groq, webllm: onDevice };
  }
  try {
    const F = (await import(FIREBASE_CDN + "firebase-firestore.js")).Firestore;
    const eventsSnap = await F.getDocs(
      F.query(F.collection(db, "analytics", "events"), F.orderBy("timestamp", "desc"), F.limit(10))
    );
    const events = eventsSnap.docs.map((d) => d.data());
    const lastSuccess = events.find((e) => e.type === "assignment_analysis");
    const errors = events
      .filter((e) => e.type?.includes("error") || e.type?.includes("failure"))
      .slice(0, 5);
    return {
      isDemo: false,
      rulesEngine: "online",
      webllm: onDevice,
      groq,
      lastSuccessfulAnalysis: lastSuccess ? new Date(lastSuccess.timestamp?.toDate?.() || lastSuccess.timestamp || 0).toISOString() : null,
      recentErrors: errors.map((e) => ({
        message: e.message || e.code || "Unknown error",
        ts: e.timestamp?.toDate?.() ? e.timestamp.toDate().toISOString() : new Date().toISOString(),
      })),
    };
  } catch (e) {
    console.warn("[StudyLens Admin] Could not fetch system health from Firestore, using demo data:", e.message);
    return { ...DEMO_DATA.systemHealth, isDemo: true, groq, webllm: onDevice, error: e.message };
  }
}

export async function fetchModelManagement() {
  const onDevice = await fetchOnDeviceStatus();
  const groq = await fetchGroqServerStatus();
  return {
    isDemo: false,
    webgpuSupport: onDevice.webgpu,
    deviceTier: onDevice.tier,
    groqModel: groq.textModel || "not configured",
    groqVisionModel: groq.visionModel || "not configured",
    groqConfigured: groq.configured,
    groqReachable: groq.reachable,
  };
}

export async function fetchActivityLog(db) {
  if (!db) return DEMO_DATA.activityLog;
  try {
    const F = (await import(FIREBASE_CDN + "firebase-firestore.js")).Firestore;
    const eventsSnap = await F.getDocs(
      F.query(F.collection(db, "analytics", "events"), F.orderBy("timestamp", "desc"), F.limit(50))
    );
    const events = eventsSnap.docs.map((d) => d.data()).map((e) => {
      const ts = e.timestamp?.toDate?.();
      return {
        type: e.type,
        message: formatEventMessage(e),
        ts: ts ? ts.toISOString() : new Date().toISOString(),
        provider: e.provider || null,
      };
    });
    return { isDemo: false, events };
  } catch (e) {
    console.warn("[StudyLens Admin] Could not fetch activity log from Firestore, using demo data:", e.message);
    return { ...DEMO_DATA.activityLog, isDemo: true, error: e.message };
  }
}

function formatEventMessage(event) {
  switch (event.type) {
    case "assignment_analysis":
      return `Assignment analyzed with ${event.provider === "rules" ? "rules engine" : event.provider === "groq" ? "Groq Cloud" : "on-device AI"}`;
    case "groq_error":
      return `Groq request failed: ${event.message || event.code || "unknown error"}`;
    case "model_download":
      return `Model downloaded: ${event.model || "on-device model"}`;
    case "model_remove":
      return `Model removed: ${event.model || "on-device model"}`;
    default:
      return event.type || "Activity event";
  }
}
