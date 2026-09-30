'use strict';
/* StudyLens — vanilla JS. Sections: config · analysis · auth/data providers · UI. */

// Production auth: paste your Firebase web config here (see README). null = local prototype mode.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBvdq6jnAptb9LXY55GBrxc_heGJrRq6J4",
  authDomain: "pawidhack.firebaseapp.com",
  projectId: "pawidhack",
  storageBucket: "pawidhack.firebasestorage.app",
  messagingSenderId: "64849933348",
  appId: "1:64849933348:web:899cbbb5c678a87bfc14b1",
  measurementId: "G-VZWM75QS7J"
};
// Optional AI enhancement: async (text) => result object. null = local engine only.
const AI_PROVIDER = null;

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fail = m => { throw Object.assign(new Error(m), { friendly: true }); };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_HISTORY = 30;

// <analysis>
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const DAYS = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday';
const MON = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const DATE = `today|tonight|tomorrow|next week|(?:(?:next|this)\\s+)?(?:${DAYS})|(?:${MON})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?|\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?`;
const KEYS = [['Introduction', 'introduction'], ['Conclusion', 'conclusion'], ['Causes', 'cause'], ['Effects', 'effect'], ['Solutions', 'solution'], ['References', 'reference'],
  ['Citations', 'citation'], ['Research', 'research'], ['Compare', 'compare'], ['Explain', 'explain'], ['Analyze', 'analy[sz]e'], ['Discuss', 'discuss'], ['Present', 'present'], ['Submit', 'submit']];
const TYPES = [
  ['Coding project', /\b(code|coding|program(?:ming)?|app|website|function|algorithm|python|javascript|java|html|css|debug|implement|software)\b/gi],
  ['Lab / experiment', /\b(lab|experiment|hypothesis|procedure|specimen|observations?|apparatus)\b/gi],
  ['Presentation', /\b(presentation|slides?|powerpoint|speech|pitch|present)\b/gi],
  ['Study / exam', /\b(exam|quiz|midterm|final|study|test|revise|revision|chapters?)\b/gi],
  ['Essay / Paper', /\b(essay|paper|thesis|article|reflection|report|write|argumentative)\b/gi]];

function analyzeLocal(text) {
  let type = 'General assignment', best = 0;
  for (const [name, re] of TYPES) { const n = (text.match(re) || []).length; if (n > best) { best = n; type = name; } }
  const w = text.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*-?\s*words?\b/i);
  const words = w ? parseInt(w[1].replace(/,/g, ''), 10) : null;
  const s = text.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:[a-z-]+\s+){0,3}?(?:sources?|references?|citations?)\b/i);
  const sources = s ? (NUM[s[1].toLowerCase()] ?? parseInt(s[1], 10)) : null;
  const cue = text.match(new RegExp(`(?:due|submit\\w*|deadline|by|before|until|on)\\s+(?:on\\s+)?(${DATE})`, 'i')) || text.match(new RegExp(`\\b(${DATE})`, 'i'));
  const deadline = cue ? cue[1].replace(/^./, c => c.toUpperCase()) : null;
  const keywords = KEYS.filter(([, stem]) => new RegExp('\\b' + stem, 'i').test(text)).map(k => k[0]);
  const requirements = text.split(/(?<=[.!?])\s+|\n+/).map(x => x.replace(/^[\s\-*•\d.)]+/, '').trim())
    .filter(x => x.length > 3 && (KEYS.some(([, st]) => new RegExp('\\b' + st, 'i').test(x)) || /\d+\s*-?\s*words?\b/i.test(x)));
  return { type, words, sources, deadline, keywords, requirements, tasks: buildTasks(type, { words, sources, deadline, keywords }), engine: 'local' };
}
function buildTasks(type, d) {
  const by = d.deadline ? ` before the ${d.deadline} deadline` : '';
  const outline = { 'Coding project': 'Plan features, inputs/outputs and file structure', 'Presentation': 'Outline the slides and key points', 'Study / exam': 'List every topic and rank them by difficulty', 'Lab / experiment': 'Review the procedure, materials and expected results' }[type] || 'Create a short outline before writing';
  const draft = { 'Coding project': 'Build the core functionality', 'Presentation': 'Create the slides and practice the talk', 'Study / exam': 'Review each topic and test yourself', 'Lab / experiment': 'Run the experiment and record results' }[type]
    || (d.words ? `Complete the first draft (about ${d.words.toLocaleString()} words)` : 'Complete the first draft');
  return [
    'Read the prompt and highlight every requirement',
    d.sources ? `Find and save at least ${d.sources} credible sources` : 'Gather the information or sources you need',
    outline, draft,
    d.keywords.length ? `Review against the prompt (check: ${d.keywords.slice(0, 6).join(', ').toLowerCase()})` : 'Review against the original requirements',
    `Proofread, test and prepare the final submission${by}`];
}
// </analysis>

function normalize(r, engine) {
  const n = v => (Number.isFinite(+v) && +v > 0 ? +v : null);
  const arr = v => (Array.isArray(v) ? v.map(String) : []);
  const type = r?.type ? String(r.type) : 'General assignment', out = { type, words: n(r?.words), sources: n(r?.sources), deadline: r?.deadline ? String(r.deadline) : null, keywords: arr(r?.keywords), requirements: arr(r?.requirements), engine };
  out.tasks = arr(r?.tasks).length ? arr(r.tasks) : buildTasks(type, out);
  return out;
}
async function analyze(text) {
  if (AI_PROVIDER) { try { return normalize(await AI_PROVIDER(text), 'ai'); } catch { /* fall back to the local engine */ } }
  return analyzeLocal(text);
}

/* ---------- Providers: same interface for local prototype and Firebase ---------- */
function localProvider() {
  const K = { u: 'sl_users', s: 'sl_session', h: 'sl_hist_' };
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const users = () => read(K.u, []), putUsers = u => localStorage.setItem(K.u, JSON.stringify(u));
  const b64 = b => btoa(String.fromCharCode(...new Uint8Array(b))), unb = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const pub = u => u && { uid: u.uid, name: u.name, email: u.email };
  const cur = () => pub(users().find(u => u.uid === localStorage.getItem(K.s)));
  async function hash(pw, salt) {
    if (!globalThis.crypto?.subtle) fail('Secure sign-in needs HTTPS. Please open the deployed site.');
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
    return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 150000 }, k, 256));
  }
  let cb = () => {};
  return {
    mode: 'local',
    onChange(f) { cb = f; f(cur()); },
    async register(name, email, pw) {
      const list = users();
      if (list.some(u => u.email === email)) fail('An account already exists with this email.');
      const salt = crypto.getRandomValues(new Uint8Array(16)), now = new Date().toISOString();
      const u = { uid: Date.now().toString(36) + Math.random().toString(36).slice(2), name, email, role: 'student', salt: b64(salt), hash: await hash(pw, salt), createdAt: now, updatedAt: now };
      list.push(u); putUsers(list); localStorage.setItem(K.s, u.uid); cb(pub(u));
    },
    async login(email, pw) {
      const u = users().find(x => x.email === email);
      if (!u || (await hash(pw, unb(u.salt))) !== u.hash) fail('Email or password is incorrect.');
      localStorage.setItem(K.s, u.uid); cb(pub(u));
    },
    async logout() { localStorage.removeItem(K.s); cb(null); },
    async updateName(uid, name) {
      const list = users(), u = list.find(x => x.uid === uid); if (!u) return;
      u.name = name; u.updatedAt = new Date().toISOString(); putUsers(list); cb(pub(u));
    },
    async list(uid) { return read(K.h + uid, []); },
    async save(uid, item) {
      const l = read(K.h + uid, []).filter(x => x.id !== item.id); l.unshift(item);
      l.sort((a, b) => b.createdAt - a.createdAt); localStorage.setItem(K.h + uid, JSON.stringify(l.slice(0, MAX_HISTORY)));
    },
    async getUser(uid) {
      const u = users().find(x => x.uid === uid);
      return u ? { uid: u.uid, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt, updatedAt: u.updatedAt } : null;
    }
  };
}

async function firebaseProvider(cfg) {
  const B = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const [{ initializeApp }, A, F] = await Promise.all([import(B + 'firebase-app.js'), import(B + 'firebase-auth.js'), import(B + 'firebase-firestore.js')]);
  const app = initializeApp(cfg), auth = A.getAuth(app), db = F.getFirestore(app);
  const MAP = { 'auth/email-already-in-use': 'An account already exists with this email.', 'auth/invalid-email': 'Please enter a valid email address.', 'auth/weak-password': 'Password must be at least 8 characters.',
    'auth/invalid-credential': 'Email or password is incorrect.', 'auth/wrong-password': 'Email or password is incorrect.', 'auth/user-not-found': 'Email or password is incorrect.',
    'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.', 'auth/network-request-failed': 'Network problem. Check your connection and try again.' };
  const wrap = f => async (...a) => { try { return await f(...a); } catch (e) { if (e.friendly) throw e; fail(MAP[e.code] || 'Something went wrong. Please try again.'); } };
  const pub = u => u && { uid: u.uid, name: u.displayName || '', email: u.email };
  let cb = () => {};
  return {
    mode: 'firebase',
    onChange(f) { cb = f; A.onAuthStateChanged(auth, u => cb(pub(u))); },
    register: wrap(async (name, email, pw) => {
      const { user } = await A.createUserWithEmailAndPassword(auth, email, pw);
      await A.updateProfile(user, { displayName: name });
      await F.setDoc(F.doc(db, 'users', user.uid), { name, email, role: 'student', createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp() });
      cb(pub(user));
    }),
    login: wrap((email, pw) => A.signInWithEmailAndPassword(auth, email, pw)),
    logout: wrap(() => A.signOut(auth)),
    updateName: wrap(async (uid, name) => {
      await A.updateProfile(auth.currentUser, { displayName: name });
      await F.setDoc(F.doc(db, 'users', uid), { name, email: auth.currentUser.email, updatedAt: F.serverTimestamp() }, { merge: true });
      cb(pub(auth.currentUser));
    }),
    list: wrap(async uid => {
      const q = F.query(F.collection(db, 'users', uid, 'assignments'), F.orderBy('createdAt', 'desc'), F.limit(MAX_HISTORY));
      return (await F.getDocs(q)).docs.map(d => d.data());
    }),
    save: wrap((uid, item) => F.setDoc(F.doc(db, 'users', uid, 'assignments', item.id), item)),
    getUser: wrap(async uid => {
      const d = await F.getDoc(F.doc(db, 'users', uid));
      return d.exists() ? d.data() : null;
    })
  };
}

/* ---------- UI ---------- */
let P;
const S = { user: null, ready: false, cur: null, hist: [], draft: '', tab: 'login', err: '', msg: '', busy: false, fatal: '', adminUid: 'AXYnNwTzgWhwlLqhqDsNjcm8Wzr1', adminUser: null, adminAssignments: [], adminSearched: false };
const route = () => { const r = location.hash.replace(/^#\/?/, ''); return ['dashboard', 'history', 'account', 'admin'].includes(r) ? r : 'dashboard'; };
const initials = n => (n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const fmt = ts => new Date(ts).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
const doneCount = a => a.done.filter(Boolean).length;
const pct = a => Math.round(doneCount(a) / a.result.tasks.length * 100);

function authView() {
  const reg = S.tab === 'register';
  return `<div class="auth"><section class="hero"><div class="brand"><span class="logo">S</span>StudyLens</div>
  <h1>Know exactly what your assignment asks for.</h1><p>Paste the prompt. Get the requirements, the deadline and a plan you can tick off.</p>
  <div class="flow"><span><b>Assignment</b> → what was asked</span><span><b>Analysis</b> → requirements found</span><span><b>Plan</b> → steps to follow</span><span><b>Progress</b> → what's left</span></div></section>
  <section class="formwrap"><div class="card"><div class="tabs" role="tablist"><button class="${reg ? '' : 'on'}" data-a="tab" data-v="login">Log in</button><button class="${reg ? 'on' : ''}" data-a="tab" data-v="register">Create account</button></div>
  <form class="form" data-form="${reg ? 'register' : 'login'}" novalidate>
  ${reg ? '<label for="n">Name</label><input id="n" name="name" autocomplete="name">' : ''}
  <label for="e">Email</label><input id="e" name="email" type="email" autocomplete="email">
  <label for="p">Password</label><input id="p" name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}">
  ${reg ? '<label for="c">Confirm password</label><input id="c" name="confirm" type="password" autocomplete="new-password">' : ''}
  <p class="err" role="alert">${esc(S.err)}</p><button class="btn pri" ${S.busy ? 'disabled' : ''}>${reg ? 'Create account' : 'Log in'}</button></form>
  ${P.mode === 'local' ? '<p class="note">Prototype mode: accounts are stored only in this browser. Connect Firebase for production sign-in (see README).</p>' : ''}</div></section></div>`;
}

function shell(page) {
  const links = [['dashboard', 'Dashboard'], ['history', 'History'], ['account', 'Account'], ['admin', 'Admin']];
  const a = (id, l) => `<a href="#/${id}" class="${page === id ? 'on' : ''}">${l}</a>`;
  return `<header class="top"><div class="brand"><span class="logo">S</span>StudyLens</div><nav>${links.map(([i, l]) => a(i, l)).join('')}<button data-a="logout">Log out</button></nav></header>
  <div class="shell"><aside class="side"><div class="brand"><span class="logo">S</span>StudyLens</div>
  <div class="me"><span class="av">${esc(initials(S.user.name))}</span><div><p>${esc(S.user.name || 'Student')}</p><p class="mu">${esc(S.user.email)}</p></div></div>
  <nav class="nav">${a('dashboard', 'Dashboard')}${a('history', 'Assignment History')}${a('account', 'Account')}${a('admin', 'Admin')}</nav>
  <div class="foot"><span class="mu"><i class="dot"></i>Offline-ready</span><button class="btn" data-a="logout">Log out</button></div></aside>
  <main>${page === 'history' ? historyView() : page === 'account' ? accountView() : page === 'admin' ? adminView() : dashView()}</main></div>`;
}

function dashView() {
  return `<div><h1>What are you working on?</h1><p class="mu" style="margin-top:.6rem">Paste the full assignment prompt below.</p></div>
  <form class="card" data-form="analyze"><textarea name="text" aria-label="Assignment prompt" placeholder="e.g. Write a 1,500-word essay about climate change. Use at least 3 credible sources…">${esc(S.draft)}</textarea>
  <p class="err" role="alert">${esc(S.err)}</p><button class="btn pri" ${S.busy ? 'disabled' : ''}>Analyze assignment →</button></form>
  ${S.cur ? resultView(S.cur) : `<div class="card empty"><svg viewBox="0 0 120 90" fill="none" stroke="#A78BFA" stroke-width="2"><rect x="22" y="8" width="60" height="74" rx="8" fill="#0C131E"/><path d="M34 26h36M34 38h36M34 50h20" opacity=".5"/><circle cx="82" cy="58" r="17" fill="#A78BFA22"/><path d="M94 70l12 12"/></svg><h3 style="color:var(--tx)">No assignment yet</h3><p>Paste a prompt above and StudyLens will find the requirements and build your plan.</p></div>`}`;
}

function resultView(a) {
  const r = a.result, ns = 'Not specified';
  return `<section class="card head"><div class="orb"></div><div><p class="mu">Analysis complete</p><h2>${esc(r.type)}</h2><p class="mu">${r.engine === 'ai' ? 'Analyzed with an AI provider' : 'Analyzed locally in your browser — no AI used'}</p></div></section>
  <div class="stats"><div class="stat"><b>${r.words ? r.words.toLocaleString() : ns}</b><span>Target words</span></div><div class="stat"><b>${r.sources ?? ns}</b><span>Sources</span></div><div class="stat"><b>${esc(r.deadline || ns)}</b><span>Deadline</span></div></div>
  <section class="card"><h3>Important requirements</h3>${r.requirements.length ? `<ul class="reqs">${r.requirements.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="mu" style="margin-top:.6rem">Not specified</p>'}
  ${r.keywords.length ? `<div class="chips">${r.keywords.map(k => `<span>${esc(k)}</span>`).join('')}</div>` : ''}</section>
  <section class="card"><h3>Action plan</h3><div class="prog"><span>Progress</span><span id="pct">${pct(a)}%</span></div><div class="bar"><i id="bar" style="width:${pct(a)}%"></i></div>
  <ul class="tasks">${r.tasks.map((t, i) => `<li class="${a.done[i] ? 'done' : ''}"><label><input type="checkbox" data-t="${i}" ${a.done[i] ? 'checked' : ''}><span>${esc(t)}</span></label></li>`).join('')}</ul></section>`;
}

function historyView() {
  return `<h1>Assignment history</h1>${S.hist.length ? `<div class="hist">${S.hist.map(a => `<div class="card item"><div><h3>${esc(a.result.type)}</h3><p class="mu">${esc(fmt(a.createdAt))}</p><p class="mu">${doneCount(a)}/${a.result.tasks.length} tasks complete</p></div><button class="btn" data-a="open" data-id="${esc(a.id)}">Open</button></div>`).join('')}</div>`
    : '<div class="card empty"><p>Nothing here yet. Analyze an assignment and it will be saved here.</p></div>'}`;
}

function accountView() {
  return `<h1>Profile</h1><form class="card form" data-form="profile" novalidate><div class="acc"><span class="av big">${esc(initials(S.user.name))}</span><h3>${esc(S.user.name || 'Student')}</h3></div>
  <label for="pn">Name</label><input id="pn" name="name" value="${esc(S.user.name)}" autocomplete="name"><label for="pe">Email</label><input id="pe" value="${esc(S.user.email)}" disabled>
  <p class="err ${S.msg ? 'okmsg' : ''}" role="alert">${esc(S.msg || S.err)}</p><button class="btn pri" style="width:auto" ${S.busy ? 'disabled' : ''}>Save profile</button></form>`;
}

function adminView() {
  const u = S.adminUser;
  let out = `<h1>Admin lookup</h1>
  <form class="card form" data-form="admin" novalidate>
  <label for="uid">User UID</label><input id="uid" name="uid" value="${esc(S.adminUid)}" autocomplete="off" placeholder="Enter a Firebase UID">
  <p class="err" role="alert">${esc(S.err)}</p>
  <button class="btn pri" ${S.busy ? 'disabled' : ''}>Look up user →</button>
  </form>`;
  if (P.mode === 'local') out += '<p class="note">Admin features require Firebase (Firestore) to look up other users. Local mode can only show the signed-in user.</p>';
  if (u) {
    out += `<div class="card"><div class="acc"><span class="av big">${esc(initials(u.name))}</span>
    <div><h3>${esc(u.name || 'Unknown')}</h3><p class="mu">${esc(u.email || '—')}</p></div></div>
    <p class="mu" style="margin-top:.6rem">Role: <b>${esc(u.role)}</b> · Created: ${u.createdAt ? esc(fmt(u.createdAt)) : '—'} · Updated: ${u.updatedAt ? esc(fmt(u.updatedAt)) : '—'}
    </p></div>
    <h3>Assignments (${S.adminAssignments.length})</h3>`;
    out += S.adminAssignments.length ? `<div class="hist">${S.adminAssignments.map(a => `<div class="card item"><div><h3>${esc(a.result && a.result.type ? a.result.type : '—')}</h3><p class="mu">${a.createdAt ? esc(fmt(a.createdAt)) : '—'}</p><p class="mu">${a.result && a.result.tasks ? doneCount(a) + '/' + a.result.tasks.length + ' tasks done' : '—'}</p></div></div>`).join('')}</div>`
      : '<p class="mu">No assignments saved.</p>';
  } else if (S.adminSearched) out += '<p class="note">No user found with that UID.</p>';
  else out += '<p class="note">Enter a UID and click Look up to see user details and assignments.</p>';
  return out;
}

function render() {
  const root = $('#app');
  if (S.fatal) root.innerHTML = `<p class="boot">${esc(S.fatal)}</p>`;
  else if (!S.ready) root.innerHTML = '<p class="boot">Loading StudyLens…</p>';
  else root.innerHTML = S.user ? shell(route()) : authView();
}
const go = () => { S.err = ''; S.msg = ''; render(); window.scrollTo(0, 0); };
const friendly = e => (e && e.friendly ? e.message : 'Something went wrong. Please try again.');

async function run(fn) {
  S.busy = true; S.err = ''; S.msg = ''; render();
  try { await fn(); } catch (e) { S.err = friendly(e); if (!e.friendly) console.error(e); }
  S.busy = false; render();
}

document.addEventListener('submit', e => {
  const f = e.target.closest('[data-form]'); if (!f) return; e.preventDefault();
  const v = Object.fromEntries(new FormData(f)), kind = f.dataset.form;
  if (kind === 'analyze') {
    S.draft = (v.text || '').trim();
    if (!S.draft) { S.err = 'Please paste an assignment prompt first.'; return render(); }
    return run(async () => {
      const result = await analyze(S.draft);
      const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), createdAt: Date.now(), text: S.draft, result, done: result.tasks.map(() => false) };
      await P.save(S.user.uid, item); S.cur = item; S.hist = [item, ...S.hist].slice(0, MAX_HISTORY);
    });
  }
  if (kind === 'profile') {
    const name = (v.name || '').trim();
    if (!name) { S.err = 'Please complete all required fields.'; return render(); }
    return run(async () => { await P.updateName(S.user.uid, name); S.msg = 'Profile saved.'; });
  }
  if (kind === 'admin') {
    const uid = (v.uid || '').trim();
    if (!uid) { S.err = 'Please enter a UID.'; return render(); }
    return run(async () => {
      S.adminUid = uid;
      const user = await P.getUser(uid);
      S.adminUser = user || null;
      S.adminSearched = true;
      if (user) { S.adminAssignments = await P.list(uid).catch(() => []); }
      else { S.adminAssignments = []; }
    });
  }
  const email = (v.email || '').trim().toLowerCase(), pw = v.password || '', reg = kind === 'register';
  if (!email || !pw || (reg && (!(v.name || '').trim() || !v.confirm))) { S.err = 'Please complete all required fields.'; return render(); }
  if (!EMAIL.test(email)) { S.err = 'Please enter a valid email address.'; return render(); }
  if (reg && pw.length < 8) { S.err = 'Password must be at least 8 characters.'; return render(); }
  if (reg && pw !== v.confirm) { S.err = 'Passwords do not match.'; return render(); }
  run(() => (reg ? P.register(v.name.trim(), email, pw) : P.login(email, pw)));
});

document.addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a;
  if (a === 'tab') { S.tab = b.dataset.v; go(); }
  else if (a === 'logout') run(async () => { await P.logout(); location.hash = ''; });
  else if (a === 'open') { S.cur = S.hist.find(x => x.id === b.dataset.id) || null; S.draft = S.cur?.text || ''; location.hash = '#/dashboard'; go(); }
});

document.addEventListener('change', async e => {
  const c = e.target.closest('[data-t]'); if (!c || !S.cur) return;
  const cur = S.cur; cur.done[+c.dataset.t] = c.checked;
  c.closest('li').classList.toggle('done', c.checked);
  $('#pct').textContent = pct(cur) + '%'; $('#bar').style.width = pct(cur) + '%';
  try { await P.save(S.user.uid, cur); } catch { S.err = 'Could not save your progress. Check your connection.'; c.checked = !c.checked; cur.done[+c.dataset.t] = c.checked; render(); }
});
document.addEventListener('input', e => { if (e.target.name === 'text') S.draft = e.target.value; });
window.addEventListener('hashchange', go);

(async function init() {
  try { P = FIREBASE_CONFIG ? await firebaseProvider(FIREBASE_CONFIG) : localProvider(); }
  catch (e) { console.error(e); S.fatal = 'Sign-in service is unavailable. Please try again later.'; return render(); }
  let last = null;
  P.onChange(async u => {
    if (u && u.uid !== last) S.hist = await P.list(u.uid).catch(() => []);
    if (!u || u.uid !== last) { S.cur = null; S.draft = ''; }
    if (!u) S.hist = [];
    last = u ? u.uid : null; S.user = u; S.ready = true; S.err = ''; render();
  });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
