'use strict';
/* StudyLens — vanilla JS. Sections: config · analysis · auth/data providers · UI. */

import { parseAssignmentDeadline, rebuildAssignmentPlan } from './studylens-analyzer.js';
import { MAX_MODEL_INPUT_CHARS, MODEL_CONFIG, MODEL_REGISTRY, getModelById, onDeviceModel } from './on-device-ai.js';
import { detectDeviceCapabilities } from './studylens-device.js';
import { getCompatibleModels, selectBestModel } from './studylens-model-selector.js';
import { analyzeAssignmentWithAI } from './ai-provider.js';
import { groqProvider } from './groq-provider.js';
import { FIREBASE_CONFIG, ADMIN_UID } from './firebase-config.js';
import { logAnalysisEvent } from './admin-service.js';

const DEMO_PROMPT = 'Write a 1,500-word essay about climate change. Use at least 3 credible sources. Discuss two causes, explain the effects, propose solutions, and submit by Friday.';

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

const VERB_QUESTIONS = {
  analyze: { q: 'What does "analyze" mean here?', opts: ['Write a brief summary', 'Break the topic into parts and explain how they relate', 'Give your opinion'], answer: 1, exp: '"Analyze" means breaking the topic into parts and explaining the relationships between them.' },
  compare: { q: 'What does "compare" require?', opts: ['List similarities only', 'Identify both similarities AND differences', 'State your preference'], answer: 1, exp: 'To compare means identifying both how things are similar and how they differ.' },
  contrast: { q: 'What does "contrast" require?', opts: ['List similarities only', 'Identify both similarities AND differences', 'Focus only on differences and their significance'], answer: 2, exp: '"Contrast" emphasizes the differences and their significance between topics.' },
  discuss: { q: 'What does "discuss" ask for?', opts: ['Mention briefly in one sentence', 'Give the topic attention in writing, considering multiple viewpoints', 'Ignore opposing viewpoints'], answer: 1, exp: '"Discuss" means addressing the topic in writing and considering different angles or arguments.' },
  explain: { q: 'What does "explain" require?', opts: ['Just define the term', 'Make it clear how something works or why it happens, with reasons', 'Provide a one-word answer'], answer: 1, exp: '"Explain" means making something clear by describing how it works or why it happens.' },
  propose: { q: 'What does "propose" mean?', opts: ['List random facts', 'Suggest possible ways to address the problem', 'Copy solutions from a source'], answer: 1, exp: '"Propose" means suggesting possible ways to address or fix the problem.' },
  evaluate: { q: 'What does "evaluate" require?', opts: ['State your opinion only', 'Make a judgment based on criteria and supporting evidence', 'Describe without judging'], answer: 1, exp: '"Evaluate" means making a judgment based on specific criteria and supporting evidence.' },
  describe: { q: 'What does "describe" ask for?', opts: ['Your feelings about it', 'A detailed written account', 'One-word answers'], answer: 1, exp: '"Describe" means giving a detailed written account so the reader can form a clear mental picture.' },
  examine: { q: 'What does "examine" require?', opts: ['Look quickly', 'Inspect closely and report your findings', 'Skip it'], answer: 1, exp: '"Examine" means inspecting closely and reporting what you find.' },
  investigate: { q: 'What does "investigate" mean?', opts: ['Ask a friend', 'Carry out a systematic inquiry to discover facts', 'Guess'], answer: 1, exp: '"Investigate" means carrying out a systematic inquiry to discover facts or principles.' },
  summarize: { q: 'What does "summarize" require?', opts: ['Copy the whole text', 'Present the main points in a shorter form', 'Write more than the original'], answer: 1, exp: '"Summarize" means presenting the main points in a shorter, condensed form.' },
  argue: { q: 'What does "argue/argumentative" require?', opts: ['State your opinion angrily', 'Put forward claims with evidence and address counterarguments', 'Fight with someone'], answer: 1, exp: 'An argumentative piece puts forward claims supported by evidence and addresses counterarguments.' },
  write: { q: 'What does "write an essay" expect?', opts: ['Type any thoughts', 'A structured piece with introduction, body, and conclusion', 'Emojis only'], answer: 1, exp: 'Writing an essay means producing a structured piece with introduction, body, and conclusion.' },
  create: { q: 'What does "create/design" ask for?', opts: ['Copy an existing solution', 'Produce something new using your knowledge', 'Do nothing'], answer: 1, exp: '"Create" or "design" means producing something new using your knowledge and creativity.' },
  research: { q: 'What does "research" require?', opts: ['Read Wikipedia once', 'Gather information from multiple sources', 'Google for 5 minutes'], answer: 1, exp: '"Research" means gathering information from multiple credible sources to support your work.' }
};

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
  return { type, words, sources, deadline, keywords, requirements, tasks: buildTasks(type, { words, sources, deadline, keywords }), factors: buildUnderstanding({ type, words, sources, deadline, keywords, requirements }, text), engine: 'local' };
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
function buildUnderstanding(r, text) {
  const verbs = Object.keys(VERB_QUESTIONS).filter(v => new RegExp('\\b' + v, 'i').test(text));
  const firstVerb = verbs[0];
  const q = VERB_QUESTIONS[firstVerb] || { q: 'What is the first step in understanding an assignment?', opts: ['Jump straight to writing', 'Identify the task type and key verb(s)', 'Ask someone else'], answer: 1, exp: 'First, identify what kind of assignment it is and look for key instruction verbs.' };
  return [
    { id: 'task', title: 'What am I being asked to do?', detail: r.type, explanation: `This assignment is a <b>${r.type}</b>${verbs.length ? `. Key instruction word(s): <b>${verbs.join(', ')}</b>` : ''}.`, quiz: q },
    { id: 'requirements', title: 'What must I include?', detail: r.requirements.length ? r.requirements.join('<br>') : 'No specific section requirements found', explanation: r.keywords.length ? `The prompt mentions these concepts: <b>${r.keywords.join(', ')}</b>. You should address all of them.` : 'No requirement keywords were detected, but make sure to address every part of the prompt.', quiz: { q: 'Why list every requirement before starting?', opts: ['To have a checklist and avoid missing anything', 'To make the assignment longer', 'It is not necessary'], answer: 0, exp: 'Listing requirements gives you a checklist so nothing important is missed.' } },
    { id: 'evidence', title: 'What evidence do I need?', detail: r.sources ? `At least ${r.sources} credible source(s)` : 'No specific source count stated', explanation: r.sources ? `You need <b>at least ${r.sources} credible source(s)</b>. Look for sources with clear authorship, recent publication, and references.` : 'Check if your assignment expects research even if no specific number is stated.', quiz: r.sources ? { q: 'Which is a sign of a credible source?', opts: ['Anyone can publish with no review', 'Author credentials listed; published by a reputable institution', 'No citations to other work', 'Published on any personal blog'], answer: 1, exp: 'Credible sources have identifiable expert authors and are published by reputable institutions.' } : { q: 'Why use credible sources?', opts: ['To copy content directly', 'To support ideas with reliable evidence', 'To fill space'], answer: 1, exp: 'Credible sources give your work authority and let others verify your claims.' } },
    { id: 'output', title: 'How much do I need to produce?', detail: r.words ? `${r.words.toLocaleString()} words` : 'No word count specified', explanation: r.words ? `Target: <b>${r.words.toLocaleString()} words</b> (~${Math.round(r.words / 250)} double-spaced page(s)).` : 'No specific quantity was detected. Re-read the prompt carefully.', quiz: { q: 'How many words is roughly one double-spaced page (12pt font)?', opts: ['250', '500', '1,000'], answer: 0, exp: 'A double-spaced page in a standard 12-point font is roughly 250&ndash;300 words.' } },
    { id: 'submission', title: 'When and how do I submit it?', detail: r.deadline || 'No deadline detected', explanation: r.deadline ? `Due: <b>${r.deadline}</b>.` : 'No specific deadline was detected. Check the syllabus or assignment page.', quiz: { q: 'Why is the deadline important?', opts: ['To plan backwards and avoid last-minute work', 'To skip the assignment', 'Deadlines are optional'], answer: 0, exp: 'Planning backwards from the deadline helps you allocate time to each section.' } }
  ];
}
// </analysis>

async function analyze(text) {
  return analyzeAssignmentWithAI(text, {
    mode: AI.mode,
    groqEnabledInAutomatic: AI.allowGroqFallback,
    getGroqToken: () => P?.getIdToken?.(),
  });
}
function displayAnalysis(analysis, text) {
  const legacy = analyzeLocal(text);
  return { ...analysis, words: analysis.length.words, deadline: analysis.deadline?.raw || analysis.deadlineText,
    keywords: analysis.requirementDetails.map(item => item.text), tasks: analysis.tasks.map(task => task.label), factors: legacy.factors };
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
    db,
    getIdToken: () => auth.currentUser ? A.getIdToken(auth.currentUser) : Promise.resolve(null),
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
const S = { user: null, ready: false, cur: null, hist: [], draft: '', image: null, imageMessage: '', imageBusy: false, tab: 'login', err: '', msg: '', busy: false, fatal: '', adminUid: '', adminUser: null, adminAssignments: [], adminSearched: false, showUnderstand: false, taught: new Set(), answers: {} };
const MODEL_CHOICE_KEY = 'studylens.model-choice.v1';
const MODEL_SETTINGS_KEY = 'studylens.model-settings.v2';
const AI_SETTINGS_KEY = 'studylens.ai-settings.v1';
const M = { supported: null, deviceTier: null, status: 'not-installed', prompt: false, recommendedModel: null, progress: 0, progressText: '', error: '', bannerError: false, userInitiated: false, activeModel: null, modelStatus: {}, preference: 'automatic' };
const AI = { mode: 'automatic', allowGroqFallback: false, groqConfigured: false, groqStatus: 'checking', groqModels: null, groqChecked: false };
const isAdmin = () => S.user?.uid === ADMIN_UID;
const route = () => { const r = location.hash.replace(/^#\/?/, ''); return ['dashboard', 'history', 'account', 'settings', 'admin'].includes(r) && (r !== 'admin' || isAdmin()) ? r : 'dashboard'; };
const initials = n => (n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const fmt = ts => new Date(ts).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
const doneCount = a => a.done.filter(Boolean).length;
const pct = a => a.result.tasks.length ? Math.round(doneCount(a) / a.result.tasks.length * 100) : 0;
const isModelReady = () => onDeviceModel.getActiveModel() && M.modelStatus[onDeviceModel.getActiveModel()] === 'ready';
const saveModelSettings = (settings) => { try { localStorage.setItem(MODEL_SETTINGS_KEY, JSON.stringify(settings)); } catch { /* best-effort */ } };
function loadModelSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(MODEL_SETTINGS_KEY) || 'null');
    if (s) return s;
    const old = JSON.parse(localStorage.getItem(MODEL_CHOICE_KEY) || 'null');
    if (old) return { choice: old.choice, preference: 'automatic', activeModel: null, dismissedAt: old.dismissedAt };
  } catch { }
  return null;
}
function saveModelChoice(choice) {
  saveModelSettings({ choice, preference: M.preference, activeModel: M.activeModel, dismissedAt: Date.now() });
}

function loadAISettings() {
  try {
    const settings = JSON.parse(localStorage.getItem(AI_SETTINGS_KEY) || 'null');
    if (settings && ['automatic', 'on-device', 'groq', 'rules'].includes(settings.mode)) {
      AI.mode = settings.mode;
      AI.allowGroqFallback = settings.allowGroqFallback === true;
    }
  } catch { /* use automatic mode */ }
}

function saveAISettings() {
  try { localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify({ mode: AI.mode, allowGroqFallback: AI.allowGroqFallback })); } catch { /* best-effort */ }
}

async function refreshGroqStatus() {
  AI.groqChecked = true;
  AI.groqStatus = 'checking';
  try {
    const status = await groqProvider.getStatus();
    AI.groqConfigured = status.configured === true;
    AI.groqModels = status;
    AI.groqStatus = AI.groqConfigured ? 'configured' : 'not-configured';
  } catch {
    AI.groqConfigured = false;
    AI.groqStatus = 'unavailable';
  }
  render();
}

function modelBanner() {
  const model = M.recommendedModel || MODEL_CONFIG;
  if (M.prompt) return `<section class="model-banner" role="dialog" aria-label="On-device model choice">
    <div><h2>Make StudyLens smarter on your device</h2><p>A small AI model downloads once (about ${model.sizeMB} MB). AI analysis runs on this device; your text is not sent to an AI server. No API key is needed, and StudyLens works without it.</p>
    <p class="note">Recommended for your device: ${model.name}. <a href="#/settings" class="mu">Choose a different model</a>.</p></div>
    <div class="btns"><button class="btn pri" data-a="enable-model">Download model</button><button class="btn" data-a="dismiss-model">Not now</button></div></section>`;
  if (M.userInitiated && M.status === 'downloading') return `<section class="model-banner" role="status"><div><h3>Downloading ${esc(model.name)}</h3><p class="mu">${esc(M.progressText || 'Preparing the on-device model…')}</p><div class="bar"><i style="width:${Math.round(M.progress * 100)}%"></i></div><p class="mu">${Math.round(M.progress * 100)}%</p></div><button class="btn btn-sm" data-a="cancel-model">Cancel</button></section>`;
  if (M.bannerError) return `<section class="model-banner" role="alert"><div><h3>Model download didn’t finish</h3><p>${esc(M.error || 'Check your connection, available storage, and graphics support, then try again.')}</p></div><div class="btns"><button class="btn pri" data-a="enable-model">Retry</button><button class="btn" data-a="dismiss-model">Not now</button></div></section>`;
  return '';
}

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
  const links = [['dashboard', 'Dashboard'], ['history', 'History'], ['account', 'Account'], ['settings', 'Settings'], ...(isAdmin() ? [['admin', 'Admin']] : [])];
  const a = (id, l) => `<a href="#/${id}" class="${page === id ? 'on' : ''}">${l}</a>`;
  const nav = links.map(([i, l]) => a(i, l)).join('');
  return `<header class="top"><div class="brand"><span class="logo">S</span>StudyLens</div><nav>${nav}<button data-a="logout">Log out</button></nav></header>
  <div class="shell"><aside class="side"><div class="brand"><span class="logo">S</span>StudyLens</div>
  <div class="me"><span class="av">${esc(initials(S.user.name))}</span><div><p>${esc(S.user.name || 'Student')}</p><p class="mu">${esc(S.user.email)}</p></div></div>
  <nav class="nav">${nav}</nav>
  <div class="foot"><span class="mu"><i class="dot"></i>Offline-ready</span><button class="btn" data-a="logout">Log out</button></div></aside>
  <main>${page === 'history' ? historyView() : page === 'account' ? accountView() : page === 'settings' ? settingsView() : page === 'admin' ? adminView() : dashView()}</main></div>`;
}

function settingsView() {
  if (!AI.groqChecked) refreshGroqStatus();
  const pref = M.preference || 'automatic';
  const refreshModelStatus = async () => {
    if (loadModelSettings()?.choice !== 'accepted') {
      for (const model of MODEL_REGISTRY) {
        if (!M.modelStatus[model.id]) M.modelStatus[model.id] = M.supported ? 'not-installed' : 'unavailable';
      }
      return;
    }
    for (const model of MODEL_REGISTRY) {
      if (M.supported && !M.modelStatus[model.id]) {
        try { M.modelStatus[model.id] = await onDeviceModel.isCached(model.id) ? 'ready' : 'not-installed'; }
        catch { M.modelStatus[model.id] = 'not-installed'; }
      }
    }
    render();
  };
  // Show current status synchronously; refresh asynchronously
  let modelsHtml = '';
  for (const model of MODEL_REGISTRY) {
    const st = M.modelStatus[model.id] || (M.supported ? 'checking' : 'unavailable');
    const isActive = onDeviceModel.getActiveModel() === model.id;
    const isDownloading = onDeviceModel.getLoadingModel() === model.id;
    let label, cls, actions;
    if (isActive && st === 'ready') { label = 'Active'; cls = 'status-ready'; }
    else if (isDownloading) { label = 'Downloading…'; cls = 'status-downloading'; }
    else if (st === 'ready') { label = 'Downloaded'; cls = 'status-ready'; }
    else if (st === 'not-installed') { label = 'Not installed'; cls = 'status-not-installed'; }
    else if (st === 'unavailable') { label = 'Not supported'; cls = 'status-not-installed'; }
    else { label = 'Checking…'; cls = 'status-not-installed'; }
    if (isDownloading) {
      actions = `<div class="bar"><i style="width:${Math.round(M.progress * 100)}%"></i></div><button class="btn btn-sm" data-a="cancel-model" data-model="${model.id}">Cancel</button>`;
    } else if (st === 'not-installed' && M.supported) {
      actions = `<button class="btn btn-sm pri" data-a="download-model" data-model="${model.id}">Download (${model.sizeMB} MB)</button>`;
    } else if (st === 'ready' && !isActive) {
      actions = `<button class="btn btn-sm" data-action="switch-model" data-model="${model.id}">Switch to</button><button class="btn btn-sm danger" data-a="remove-model" data-model="${model.id}">Remove</button>`;
    } else if (st === 'ready' && isActive) {
      actions = `<button class="btn btn-sm danger" data-a="remove-model" data-model="${model.id}">Remove</button>`;
    } else {
      actions = '';
    }
    const recommended = M.recommendedModel?.id === model.id ? ' <span class="ai-tag">Recommended</span>' : '';
    modelsHtml += `<div class="model-item"><div><b>${model.name}</b>${recommended}<span class="mu">${model.id} · ${model.sizeMB} MB</span><div class="model-status ${cls}">${label}</div></div>${actions ? `<div class="model-actions">${actions}</div>` : ''}</div>`;
  }
  if (!M.supported) {
    modelsHtml = '<p class="mu">WebGPU is not available on this device. StudyLens uses its rules-based analyzer instead.</p>';
  } else {
    refreshModelStatus();
  }
  const note = M.supported
    ? '<p class="note">When enabled, the model runs on your device with no API key; assignment text is not sent to an AI server. Models are cached by your browser and work offline after download.</p>'
    : '<p class="note">Smarter analysis isn’t supported on this device. StudyLens still analyzes assignments and builds plans.</p>';
  const tech = M.supported ? `<details class="tech-details"><summary class="mu">Technical details</summary>
    <p class="mu" style="font-size:.8rem">Device tier: <b>${M.deviceTier || '—'}</b></p>
    <p class="mu" style="font-size:.8rem">Active model: <b>${onDeviceModel.getActiveModel() || 'none'}</b></p>
    <p class="mu" style="font-size:.8rem">WebGPU adapter: ${M.deviceTier ? 'available' : 'unavailable'}</p></details>` : '';
  const groqStatus = AI.groqStatus === 'checking' ? 'Checking…' : AI.groqStatus === 'configured' ? 'Configured' : AI.groqStatus === 'not-configured' ? 'Not configured' : 'Unavailable';
  const groqModeNote = AI.mode === 'groq' || AI.allowGroqFallback
    ? '<p class="note">When selected or explicitly allowed as an automatic fallback, assignment text is sent to Groq Cloud. You can disable it at any time.</p>'
    : '<p class="note">Groq is not used unless you select Groq Cloud or explicitly allow it as an Automatic fallback.</p>';
  return `<h1>Settings</h1><section class="card model-settings">
    <div><h3>On-device AI</h3><p class="mu">StudyLens analyzes assignments with its rules engine first, then can use the optional local model. Groq Cloud is a separate opt-in mode.</p></div>
    <label>Model preference${M.supported ? '' : ' (unavailable)'}
      <select name="model-preference" data-set-pref ${M.supported ? '' : 'disabled'}>
        <option value="automatic" ${pref === 'automatic' ? 'selected' : ''}>Automatic — StudyLens chooses</option>
        <option value="small" ${pref === 'small' ? 'selected' : ''}>Small (Qwen2.5 0.5B, ~266 MB)</option>
        <option value="medium" ${pref === 'medium' ? 'selected' : ''}>Medium (Qwen2.5 1.5B, ~766 MB)</option>
        <option value="large" ${pref === 'large' ? 'selected' : ''}>Advanced (Qwen2.5 3B, ~1.5 GB)</option>
      </select>
    </label>
    <p class="note">StudyLens recommends: <b>${(M.recommendedModel || MODEL_CONFIG).name}</b> for your device.</p>
    <h4>Available models</h4>
    ${modelsHtml}
    ${M.error && !M.bannerError ? `<p class="err" role="alert">${esc(M.error)}</p>` : ''}${tech}
    ${note}<div class="btns">${M.supported && !onDeviceModel.getActiveModel() && onDeviceModel.getLoadingModel() === null ? `<button class="btn pri" data-a="enable-model">Download ${M.recommendedModel?.name || MODEL_CONFIG.name}</button>` : ''}</div>
    </section>
    <section class="card model-settings ai-provider-settings">
      <div><h3>AI &amp; Analysis</h3><p class="mu">Rules always run first and remain available without AI.</p></div>
      <label>AI Mode<select data-ai-mode>
        <option value="automatic" ${AI.mode === 'automatic' ? 'selected' : ''}>Automatic</option>
        <option value="on-device" ${AI.mode === 'on-device' ? 'selected' : ''}>On-device AI</option>
        <option value="groq" ${AI.mode === 'groq' ? 'selected' : ''}>Groq Cloud</option>
        <option value="rules" ${AI.mode === 'rules' ? 'selected' : ''}>Rules only</option>
      </select></label>
      <label class="provider-toggle"><input type="checkbox" data-allow-groq ${AI.allowGroqFallback ? 'checked' : ''}> Allow Groq as Automatic fallback</label>
      <div class="provider-status"><p><b>Rules engine</b><span class="status-ready">Always available</span></p>
        <p><b>On-device AI</b><span>${M.activeModel ? 'Ready' : M.supported ? 'Available after download' : 'Unavailable on this device'}</span></p>
        <p><b>Groq Cloud</b><span class="${AI.groqConfigured ? 'status-ready' : 'status-not-installed'}">${groqStatus}</span></p></div>
      ${groqModeNote}
      ${!AI.groqConfigured ? '<p class="note">Configure <code>GROQ_API_KEY</code> on the server. It is never stored in this browser.</p>' : ''}
      <button type="button" class="btn btn-sm" data-a="refresh-groq">Refresh Groq status</button>
    </section>`;
}

function dashView() {
  return `<div><h1>What are you working on?</h1><p class="mu" style="margin-top:.6rem">Paste the full assignment prompt below.</p></div>
  <form class="card" data-form="analyze"><div class="input-mode"><button class="btn btn-sm" type="button" data-a="focus-prompt">Paste assignment</button><button class="btn btn-sm" type="button" data-a="choose-image">Upload image</button><input id="assignment-image" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" hidden></div>
  <textarea name="text" aria-label="Assignment prompt" placeholder="Paste the instructions here…">${esc(S.draft)}</textarea>
  <div class="image-dropzone" data-dropzone><span>Drop an assignment image here</span><span class="mu">PNG, JPG, WebP · up to 4 MB</span></div>
  ${S.image ? `<div class="image-preview"><img src="${esc(S.image.dataUrl)}" alt="Preview of ${esc(S.image.name)}"><div><b>${esc(S.image.name)}</b><p class="mu">Image preview stays on this device until you request text extraction.</p><div class="btns"><button class="btn btn-sm pri" type="button" data-a="extract-image" ${S.imageBusy ? 'disabled' : ''}>${S.imageBusy ? 'Extracting…' : 'Extract text with Groq Vision'}</button><button class="btn btn-sm" type="button" data-a="remove-image">Remove image</button></div></div></div>` : ''}
  ${S.imageMessage ? `<p class="note" role="status">${esc(S.imageMessage)}</p>` : ''}
  <p class="note">Image extraction uses Groq Vision only after you click the button. Review and correct the extracted text above before analyzing it. If vision is unavailable, paste the text instead.</p>
  <p class="err" role="alert">${esc(S.err)}</p><div class="btns"><button class="btn pri" ${S.busy ? 'disabled' : ''}>Analyze assignment →</button><button class="btn" type="button" data-a="demo" ${S.busy ? 'disabled' : ''}>Load demo</button></div></form>
  ${S.cur ? resultView(S.cur) : `<div class="card empty"><svg viewBox="0 0 120 90" fill="none" stroke="#A78BFA" stroke-width="2"><rect x="22" y="8" width="60" height="74" rx="8" fill="#0C131E"/><path d="M34 26h36M34 38h36M34 50h20" opacity=".5"/><circle cx="82" cy="58" r="17" fill="#A78BFA22"/><path d="M94 70l12 12"/></svg><h3 style="color:var(--tx)">No assignment yet</h3><p>Paste a prompt above and StudyLens will find the requirements and build your plan.</p></div>`}`;
}

function loadAssignmentImage(file) {
  S.imageMessage = '';
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    S.image = null;
    S.imageMessage = 'PDF processing is not available yet. Export a page as an image or paste its text.';
    render();
    return;
  }
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    S.image = null; S.imageMessage = 'Use a PNG, JPG, or WebP image.'; render(); return;
  }
  if (file.size > 4 * 1024 * 1024) {
    S.image = null; S.imageMessage = 'Choose an image smaller than 4 MB.'; render(); return;
  }
  const reader = new FileReader();
  reader.onload = () => { S.image = { name: file.name, type: file.type, dataUrl: String(reader.result) }; S.imageMessage = ''; render(); };
  reader.onerror = () => { S.image = null; S.imageMessage = 'This image could not be read. Try another file.'; render(); };
  reader.readAsDataURL(file);
}

async function extractImageText() {
  if (!S.image || S.imageBusy) return;
  const groqAllowed = AI.mode === 'groq' || (AI.mode === 'automatic' && AI.allowGroqFallback);
  if (!groqAllowed) {
    S.imageMessage = 'Image analysis unavailable with the current provider. Enable Groq Cloud in Settings or paste the text instead.';
    render();
    return;
  }
  S.imageBusy = true; S.imageMessage = 'Checking Groq Vision…'; render();
  try {
    const status = await groqProvider.getStatus();
    AI.groqConfigured = status.configured === true;
    AI.groqStatus = AI.groqConfigured ? 'configured' : 'not-configured';
    if (!AI.groqConfigured) throw new Error('Groq Cloud is not configured on the server.');
    const token = await P?.getIdToken?.();
    if (!token) throw new Error('Sign in with Firebase to use Groq Cloud.');
    const result = await groqProvider.extractImageText(S.image.dataUrl, { token });
    S.draft = result.extractedText;
    S.imageMessage = `Text extracted with Groq Vision (${result.model}). Review and correct it above before analyzing.`;
  } catch (error) {
    S.imageMessage = error?.message || 'Image analysis unavailable with the current provider. Try a clearer image or paste the text instead.';
  }
  S.imageBusy = false;
  render();
}

function resultView(a) {
  if (!a.analysis) return legacyResultView(a);
  const r = a.result, analysis = a.analysis, ns = 'Not specified';
  const sourceTag = source => !source || source === 'rules' ? '<span class="source-tag rules-tag">Detected</span>' : `<span class="source-tag">${esc(source)}</span>`;
  const tags = field => sourceTag(analysis.fieldSources?.[field]);
  const field = (name, label, source, missing, control) => `<label class="summary-field ${missing ? 'field-missing' : ''}"><span>${label} ${tags(source)}</span>${control}</label>`;
  const required = a.editRequirements || analysis.requirements || [], edits = a.edits || {};
  const requirementInputs = required.map((item, index) => `<div class="requirement-edit"><input name="requirements" data-requirement="${index}" aria-label="Requirement ${index + 1}" value="${esc(item)}"><button class="btn btn-sm" type="button" data-a="remove-requirement" data-index="${index}" aria-label="Remove requirement ${index + 1}">Remove</button></div>`).join('');
  const providerLabels = { rules: 'Analyzed with Rules', webllm: 'Enhanced with On-device AI', groq: 'Enhanced with Groq Cloud AI' };
  const providerLabel = providerLabels[analysis.analysisProvider || 'rules'];
  const fieldsBySource = Object.entries(analysis.fieldSources || {}).reduce((groups, [fieldName, source]) => {
    (groups[source] ||= []).push(fieldName);
    return groups;
  }, {});
  return `<section class="card understood"><p class="mu">What we understood</p><h2>${analysis.isAssignment === false ? 'This may not be an assignment prompt' : 'Check the assignment details'}</h2>
    <div class="analysis-provenance"><span class="provider-badge provider-${esc(analysis.analysisProvider || 'rules')}">${providerLabel}</span>
      <details><summary>View analysis details</summary><div class="analysis-details">
        <p><b>Provider</b><span>${providerLabel}</span></p>
        ${analysis.analysisModel ? `<p><b>Model</b><span>${esc(analysis.analysisModel)}</span></p>` : ''}
        ${Number.isFinite(analysis.analysisMs) ? `<p><b>Processing time</b><span>${(analysis.analysisMs / 1000).toFixed(1)}s</span></p>` : ''}
        <p><b>Rules confidence</b><span>${Math.round((analysis.analysisConfidence ?? analysis.confidence ?? 0) * 100)}%</span></p>
        <p><b>Rules fields</b><span>${esc((fieldsBySource.rules || []).join(', ') || 'none')}</span></p>
        <p><b>AI-enhanced fields</b><span>${esc([...(fieldsBySource['On-device AI'] || []), ...(fieldsBySource['Groq Cloud AI'] || [])].join(', ') || 'none')}</span></p>
        <p><b>Still uncertain</b><span>${esc((analysis.missing || []).join(', ') || 'none')}</span></p>
      </div></details></div>
    ${analysis.isAssignment === false ? '<p class="warning-note">This doesn’t look like assignment instructions. Choose the type that best fits, or edit the details before building a plan.</p>' : ''}
    ${analysis.inputTruncated ? `<p class="warning-note">The prompt is longer than ${MAX_MODEL_INPUT_CHARS.toLocaleString()} characters. Rules analyzed the full text; on-device AI saw only the first ${MAX_MODEL_INPUT_CHARS.toLocaleString()} characters.</p>` : ''}
    <form class="summary-form" data-form="confirm-analysis">
      ${field('type', 'Assignment type', 'type', analysis.typeConfidence < 0.7, `<select name="type" data-understood-field>${['Essay / Paper', 'Presentation', 'Coding Project', 'Lab Report', 'Other'].map(type => `<option ${(edits.type || analysis.type) === type ? 'selected' : ''}>${type}</option>`).join('')}</select>`)}
      ${field('topic', 'Topic', 'topic', !analysis.topic, `<input name="topic" data-understood-field value="${esc(edits.topic ?? analysis.topic ?? '')}" placeholder="Not specified">`)}
      <div class="summary-grid">
        ${field('length', 'Word count', 'length', !analysis.length?.words, `<input name="words" data-understood-field type="number" min="50" max="50000" value="${esc(edits.words ?? analysis.length?.words ?? '')}" placeholder="Not specified">`)}
        ${field('length', 'Pages', 'length', !analysis.length?.pages, `<input name="pages" data-understood-field type="number" min="1" max="200" value="${esc(edits.pages ?? analysis.length?.pages ?? '')}" placeholder="Not specified">`)}
        ${field('length', 'Slides', 'length', !analysis.length?.slides, `<input name="slides" data-understood-field type="number" min="1" max="200" value="${esc(edits.slides ?? analysis.length?.slides ?? '')}" placeholder="Not specified">`)}
        ${field('sources', 'Sources', 'sources', analysis.sources == null, `<input name="sources" data-understood-field type="number" min="0" max="50" value="${esc(edits.sources ?? analysis.sources ?? '')}" placeholder="Not specified">`)}
      </div>
      ${field('citationStyle', 'Citation style', 'citationStyle', !!analysis.sources && !analysis.citationStyle, `<input name="citationStyle" data-understood-field value="${esc(edits.citationStyle ?? analysis.citationStyle ?? '')}" placeholder="Not specified">`)}
      ${field('deadline', 'Deadline text', 'deadline', !analysis.deadline || analysis.deadlineNeedsConfirmation, `<input name="deadlineText" data-understood-field value="${esc(edits.deadlineText ?? analysis.deadlineText ?? '')}" placeholder="Not specified">`)}
      ${analysis.deadlineNeedsConfirmation ? '<p class="warning-note">Please confirm the exact date. This text could not be turned into a calendar date.</p>' : ''}
      <div class="summary-field ${required.length < 2 ? 'field-missing' : ''}"><span>Requirements ${tags('requirements')}</span>${requirementInputs || '<p class="mu">No requirements detected.</p>'}<button class="btn btn-sm" type="button" data-a="add-requirement">Add requirement</button></div>
      ${analysis.formatRules?.length ? `<div class="summary-field"><span>Format rules ${tags('formatRules')}</span><p>${analysis.formatRules.map(esc).join('<br>')}</p></div>` : ''}
      ${analysis.otherInstructions?.length ? `<section class="other-instructions"><h3>Other instructions we found</h3><ul>${analysis.otherInstructions.map(item => `<li>${esc(item)}</li>`).join('')}</ul></section>` : ''}
      <p class="err" role="alert">${esc(S.err)}</p><button class="btn pri" ${S.busy ? 'disabled' : ''}>${a.confirmed ? 'Update summary and rebuild plan' : 'Confirm details and build plan'}</button>
    </form></section>
    <div class="stats"><div class="stat"><b>${esc(analysis.length?.label || ns)}</b><span>Length</span></div><div class="stat"><b>${analysis.sources ?? ns}</b><span>Sources</span></div><div class="stat"><b>${esc(analysis.deadline?.label || (analysis.deadlineText ? 'Needs confirmation' : ns))}</b><span>Deadline</span></div></div>
    ${a.confirmed ? `<section class="card"><h3>Action plan</h3><div class="prog"><span>Progress</span><span id="pct">${pct(a)}%</span></div><div class="bar"><i id="bar" style="width:${pct(a)}%"></i></div>
      <ul class="tasks">${r.tasks.map((task, i) => `<li class="${a.done[i] ? 'done' : ''}"><label><input type="checkbox" data-t="${i}" ${a.done[i] ? 'checked' : ''}><span>${esc(task)}</span></label></li>`).join('')}</ul></section>${S.showUnderstand ? understandSection(a) : ''}` : ''}`;
}

function legacyResultView(a) {
  const r = a.result, ns = 'Not specified';
  return `<section class="card head"><div class="orb"></div><div><p class="mu">Analysis complete</p><h2>${esc(r.type)}</h2>  <p class="mu">${r.engine === 'ai' ? 'Analyzed with an AI provider' : 'Analyzed locally in your browser'}</p></div><button class="btn btn-sm" data-a="understand" ${S.showUnderstand ? '' : ''}>${S.showUnderstand ? 'Hide explanation' : 'Help me understand this'}</button></section>
  <div class="stats"><div class="stat"><b>${r.words ? r.words.toLocaleString() : ns}</b><span>Target words</span></div><div class="stat"><b>${r.sources ?? ns}</b><span>Sources</span></div><div class="stat"><b>${esc(r.deadline || ns)}</b><span>Deadline</span></div></div>
  <section class="card"><h3>Important requirements</h3>${r.requirements.length ? `<ul class="reqs">${r.requirements.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="mu" style="margin-top:.6rem">Not specified</p>'}
  ${r.keywords.length ? `<div class="chips">${r.keywords.map(k => `<span>${esc(k)}</span>`).join('')}</div>` : ''}</section>
  <section class="card"><h3>Action plan</h3><div class="prog"><span>Progress</span><span id="pct">${pct(a)}%</span></div><div class="bar"><i id="bar" style="width:${pct(a)}%"></i></div>
  <ul class="tasks">${r.tasks.map((t, i) => `<li class="${a.done[i] ? 'done' : ''}"><label><input type="checkbox" data-t="${i}" ${a.done[i] ? 'checked' : ''}><span>${esc(t)}</span></label></li>`).join('')}</ul></section>
  ${S.showUnderstand ? understandSection(a) : ''}`;
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
  if (!isAdmin()) return '<h1>Page not found</h1>';
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

function understandSection(a) {
  const factors = a.result.factors || [];
  if (!factors.length) return '';
  const nums = ['①', '②', '③', '④', '⑤'];
  const parts = factors.map((f, i) => {
    const taught = S.taught.has(f.id);
    const answered = S.answers[f.id];
    const isCorrect = answered === f.quiz.answer;
    let html = `<div class="factor"><h4>${nums[i]} ${f.title}</h4><p class="mu">${f.detail}</p>`;
    if (taught) {
      html += `<div class="explain"><p>${f.explanation}</p><p class="quiz-q">${f.quiz.q}</p><div class="quiz-opts">`;
      html += f.quiz.opts.map((opt, j) => {
        let cls = ' btn-opt';
        if (answered !== undefined) {
          if (j === answered && j === f.quiz.answer) cls += ' correct';
          else if (j === answered) cls += ' wrong';
          else if (j === f.quiz.answer) cls += ' correct-dim';
          else cls += ' dimmed';
        }
        return `<button class="btn${cls}" data-a="answer" data-f="${f.id}" data-v="${j}" ${answered !== undefined ? 'disabled' : ''}>${String.fromCharCode(65+j)}. ${opt}</button>`;
      }).join('');
      html += `</div>`;
      if (answered !== undefined) html += `<p class="quiz-fb ${isCorrect ? 'ok' : 'bad'}">${isCorrect ? 'Correct! ' : 'Not quite. '}${f.quiz.exp}</p>`;
      html += `</div>`;
    } else {
      html += `<button class="btn btn-sm" data-a="teach" data-f="${f.id}">Teach me</button>`;
    }
    html += `</div>`;
    return html;
  }).join('');
  return `<section class="card"><h3>Understanding your assignment</h3><p class="mu" style="margin-top:.6rem">Five things to understand before you start.</p>${parts}</section>`;
}

async function loadModelFromConsent(modelId) {
  modelId = modelId || M.recommendedModel?.id || MODEL_CONFIG.id;
  const model = getModelById(modelId) || MODEL_CONFIG;
  saveModelSettings({ choice: 'accepted', preference: M.preference, activeModel: modelId, dismissedAt: Date.now() });
  M.prompt = false; M.status = 'downloading'; M.error = ''; M.bannerError = false; M.userInitiated = true; M.progress = 0; M.modelStatus[modelId] = 'downloading';
  render();
  try {
    let shown = -1;
    await onDeviceModel.load(modelId, progress => {
      M.progress = progress.progress; M.progressText = progress.text;
      const percent = Math.round(M.progress * 100);
      if (percent !== shown) { shown = percent; render(); }
    });
    M.status = 'ready'; M.error = ''; M.bannerError = false; M.userInitiated = false; M.activeModel = modelId; M.modelStatus[modelId] = 'ready';
  } catch (error) {
    console.error("Model load failed:", error);
    const canceled = /canceled/i.test(error?.message || '');
    M.status = 'not-installed'; M.userInitiated = false; M.modelStatus[modelId] = 'not-installed';
    if (canceled) saveModelSettings({ choice: 'declined', preference: M.preference, activeModel: null, dismissedAt: Date.now() });
    else {
      M.error = 'The model could not be loaded. ' + (error?.message || 'Check your connection, available storage, and graphics support.') + ' — try again from Settings.';
      M.bannerError = true;
    }
  }
  render();
}

async function removeModel(modelId) {
  modelId = modelId || M.activeModel || MODEL_CONFIG.id;
  M.status = 'downloading'; M.error = ''; M.bannerError = false; M.userInitiated = false; render();
  try {
    await onDeviceModel.remove(modelId);
    M.modelStatus[modelId] = 'not-installed';
    if (M.activeModel === modelId) {
      M.activeModel = null;
      saveModelSettings({ choice: 'declined', preference: M.preference, activeModel: null, dismissedAt: Date.now() });
    } else {
      saveModelSettings({ choice: 'accepted', preference: M.preference, activeModel: M.activeModel, dismissedAt: Date.now() });
    }
    M.status = 'not-installed'; M.progress = 0;
  } catch {
    M.status = 'ready'; M.error = 'The model could not be removed from this browser. Try again from Settings.';
  }
  render();
}

async function initializeModel() {
  const caps = await detectDeviceCapabilities();
  M.supported = caps.webgpu;
  M.deviceTier = caps.tier;
  if (!caps.webgpu) { M.status = 'unsupported'; M.prompt = false; render(); return; }
  const settings = loadModelSettings();
  if (settings) { M.preference = settings.preference || 'automatic'; }
  // Don't load the WebLLM runtime or inspect its cache before consent.
  const hasConsent = settings?.choice === 'accepted';
  let installed = [];
  for (const model of MODEL_REGISTRY) {
    if (caps.webgpu && getCompatibleModels(caps).some((m) => m.id === model.id)) {
      if (hasConsent) {
        try { M.modelStatus[model.id] = await onDeviceModel.isCached(model.id) ? 'ready' : 'not-installed'; }
        catch { M.modelStatus[model.id] = 'not-installed'; }
      } else {
        M.modelStatus[model.id] = 'not-installed';
      }
      if (M.modelStatus[model.id] === 'ready') installed.push(model.id);
    } else {
      M.modelStatus[model.id] = 'unavailable';
    }
  }
  const recommended = selectBestModel(caps, { installed, preference: M.preference, previousModel: settings?.activeModel });
  M.recommendedModel = recommended || null;
  if (settings?.choice === 'declined' && !M.supported) { M.prompt = false; render(); return; }
  if (settings?.choice === 'declined') { M.prompt = false; M.status = 'not-installed'; render(); return; }
  if (settings?.choice === 'accepted') {
    M.prompt = false;
    const activeId = settings.activeModel;
    if (activeId && installed.includes(activeId)) {
      M.activeModel = activeId; M.status = 'ready';
      M.modelStatus[activeId] = 'ready';
      // Load silently in background
      try {
        await onDeviceModel.load(activeId, progress => { M.progress = progress.progress; M.progressText = progress.text; });
      } catch {
        M.status = 'not-installed'; M.activeModel = null;
        M.modelStatus[activeId] = 'not-installed';
      }
    }
    render(); return;
  }
  // First visit: show the download prompt with the recommended model
  M.prompt = true;
  render();
}

function confirmAnalysis(item, values, requirements) {
  const integer = (name, min, max) => {
    const raw = String(values[name] ?? '').trim();
    if (!raw) return { value: null, invalid: false };
    const value = Number(raw);
    return { value, invalid: !Number.isInteger(value) || value < min || value > max };
  };
  const words = integer('words', 50, 50000), slides = integer('slides', 1, 200), sources = integer('sources', 0, 50);
  const pagesRaw = String(values.pages || '').trim();
  const pagesMatch = pagesRaw.match(/^(\d+)(?:\s*(?:-|–|to)\s*(\d+))?$/i);
  if (words.invalid || slides.invalid || sources.invalid || (pagesRaw && (!pagesMatch || +pagesMatch[1] < 1 || +pagesMatch[1] > 200 || (pagesMatch[2] && (+pagesMatch[2] < +pagesMatch[1] || +pagesMatch[2] > 200))))) {
    S.err = 'Check the numbers: words 50–50,000, pages/slides 1–200, sources 0–50.'; render(); return false;
  }
  const original = item.analysis;
  const analysis = { ...original, length: { ...original.length }, fieldSources: { ...original.fieldSources } };
  analysis.type = values.type;
  analysis.topic = String(values.topic || '').trim() || null;
  analysis.length.words = words.value;
  analysis.length.target = words.value;
  analysis.length.minWords = null; analysis.length.maxWords = null; analysis.length.qualifier = null;
  analysis.length.pages = pagesMatch ? (pagesMatch[2] ? `${pagesMatch[1]}–${pagesMatch[2]}` : Number(pagesMatch[1])) : null;
  analysis.length.slides = slides.value;
  analysis.length.minutes = original.length.minutes;
  analysis.length.label = [words.value ? `${words.value.toLocaleString()} words` : null,
    analysis.length.pages ? `${analysis.length.pages} pages` : null, slides.value ? `${slides.value} slides` : null,
    analysis.length.minutes ? `${analysis.length.minutes} min` : null].filter(Boolean).join(' · ') || null;
  analysis.wordCount = words.value;
  analysis.sources = sources.value;
  analysis.citationStyle = String(values.citationStyle || '').trim() || null;
  analysis.deadlineText = String(values.deadlineText || '').trim() || null;
  analysis.deadline = analysis.deadlineText ? parseAssignmentDeadline(analysis.deadlineText) : null;
  analysis.deadlineNeedsConfirmation = !!analysis.deadlineText && !analysis.deadline;
  analysis.requirements = requirements.map(value => value.trim()).filter(Boolean);
  const priorDetails = new Map((original.requirementDetails || []).map(detail => [detail.text.toLowerCase(), detail]));
  analysis.requirementDetails = analysis.requirements.map(text => priorDetails.get(text.toLowerCase()) || { text, category: 'content' });
  analysis.missing = [...(original.missing || [])].filter(field => !(field === 'length' && analysis.length.label) && !(field === 'deadline' && analysis.deadline));
  if (!analysis.length.label && !analysis.missing.includes('length')) analysis.missing.push('length');
  if (!analysis.deadline && !analysis.missing.includes('deadline')) analysis.missing.push('deadline');
  analysis.warnings = [...(original.warnings || [])].filter(warning => !(analysis.length.label && warning.startsWith('No length requirement')) && !(analysis.deadline && warning.startsWith('No deadline found')) && !warning.startsWith('The deadline text is vague'));
  if (analysis.deadlineNeedsConfirmation) analysis.warnings.push('The deadline text is vague — confirm the exact date before relying on the schedule.');
  item.analysis = rebuildAssignmentPlan(analysis);
  item.result = displayAnalysis(item.analysis, item.text);
  item.done = item.result.tasks.map(() => false);
  item.confirmed = true;
  item.editRequirements = [...item.analysis.requirements];
  item.edits = {};
  return true;
}

function render() {
  const root = $('#app');
  if (S.fatal) root.innerHTML = `<p class="boot">${esc(S.fatal)}</p>`;
  else if (!S.ready) root.innerHTML = '<p class="boot">Loading StudyLens…</p>';
  else root.innerHTML = modelBanner() + (S.user ? shell(route()) : authView());
}
const go = () => { S.err = ''; S.msg = ''; S.showUnderstand = false; S.taught = new Set(); S.answers = {}; render(); window.scrollTo(0, 0); };
const friendly = e => (e && e.friendly ? e.message : 'Something went wrong. Please try again.');

async function run(fn) {
  S.busy = true; S.err = ''; S.msg = ''; render();
  try { await fn(); } catch (e) { S.err = friendly(e); if (!e.friendly) console.error(e); }
  S.busy = false; render();
}

document.addEventListener('submit', e => {
  const f = e.target.closest('[data-form]'); if (!f) return; e.preventDefault();
  const formData = new FormData(f), v = Object.fromEntries(formData), kind = f.dataset.form;
  if (kind === 'analyze') {
    S.draft = (v.text || '').trim();
    S.showUnderstand = false; S.taught = new Set(); S.answers = {};
    if (!S.draft) { S.err = 'Please paste an assignment prompt first.'; return render(); }
    return run(async () => {
      const analysis = await analyze(S.draft), result = displayAnalysis(analysis, S.draft);
      S.cur = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), createdAt: Date.now(), text: S.draft,
        analysis, result, done: [], confirmed: false, editRequirements: [...analysis.requirements], edits: {} };
      void logAnalysisEvent(P?.db, {
        userId: S.user?.uid,
        provider: analysis.analysisProvider,
        model: analysis.analysisModel,
        confidence: analysis.analysisConfidence,
        ms: analysis.analysisMs,
        fallbackFrom: analysis.fallbackFrom,
        isAssignment: analysis.isAssignment,
      });
    });
  }
  if (kind === 'confirm-analysis') {
    if (!S.cur?.analysis) return;
    return run(async () => {
      if (!confirmAnalysis(S.cur, v, formData.getAll('requirements'))) return;
      S.hist = [S.cur, ...S.hist.filter(item => item.id !== S.cur.id)].slice(0, MAX_HISTORY);
      try { await P.save(S.user.uid, S.cur); } catch { S.err = 'Could not save to your account. Your plan is shown above.'; }
    });
  }
  if (kind === 'profile') {
    const name = (v.name || '').trim();
    if (!name) { S.err = 'Please complete all required fields.'; return render(); }
    return run(async () => { await P.updateName(S.user.uid, name); S.msg = 'Profile saved.'; });
  }
  if (kind === 'admin') {
    if (!isAdmin()) { location.hash = '#/dashboard'; return; }
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
  else if (a === 'demo') { S.draft = DEMO_PROMPT; render(); }
  else if (a === 'enable-model') loadModelFromConsent();
  else if (a === 'dismiss-model') { saveModelSettings({ choice: 'declined', preference: M.preference, activeModel: M.activeModel, dismissedAt: Date.now() }); M.prompt = false; M.bannerError = false; M.userInitiated = false; render(); }
  else if (a === 'cancel-model') { onDeviceModel.cancel(); saveModelSettings({ choice: 'declined', preference: M.preference, activeModel: null, dismissedAt: Date.now() }); M.status = 'not-installed'; M.bannerError = false; M.userInitiated = false; render(); }
  else if (a === 'remove-model') removeModel(b.dataset.model);
  else if (a === 'refresh-groq') refreshGroqStatus();
  else if (a === 'redownload-model') { const mid = b.dataset.model || M.activeModel || MODEL_CONFIG.id; onDeviceModel.remove(mid).then(() => loadModelFromConsent(mid)).catch(() => { M.error = 'The model could not be cleared for a fresh download.'; render(); }); }
  else if (a === 'download-model') loadModelFromConsent(b.dataset.model);
  else if (a === 'switch-model') loadModelFromConsent(b.dataset.model);
  else if (a === 'add-requirement' && S.cur?.analysis) { S.cur.editRequirements ||= [...S.cur.analysis.requirements]; S.cur.editRequirements.push(''); render(); }
  else if (a === 'remove-requirement' && S.cur?.analysis) { S.cur.editRequirements.splice(+b.dataset.index, 1); render(); }
  else if (a === 'understand') { S.showUnderstand = !S.showUnderstand; render(); if (S.showUnderstand) { const el = $('.factor'); if (el) el.scrollIntoView({ behavior: 'smooth' }); } }
  else if (a === 'teach') { S.taught.add(b.dataset.f); render(); }
  else if (a === 'answer') { S.answers[b.dataset.f] = +b.dataset.v; render(); }
  else if (a === 'choose-image') $('#assignment-image')?.click();
  else if (a === 'focus-prompt') $('textarea[name="text"]')?.focus();
  else if (a === 'extract-image') extractImageText();
  else if (a === 'remove-image') { S.image = null; S.imageMessage = ''; render(); }
});

document.addEventListener('change', e => {
  if (e.target.id === 'assignment-image' && e.target.files?.[0]) loadAssignmentImage(e.target.files[0]);
});
document.addEventListener('dragover', e => {
  if (e.target.closest('[data-dropzone]')) e.preventDefault();
});
document.addEventListener('drop', e => {
  if (!e.target.closest('[data-dropzone]')) return;
  e.preventDefault();
  if (e.dataTransfer?.files?.[0]) loadAssignmentImage(e.dataTransfer.files[0]);
});

document.addEventListener('change', async e => {
  const c = e.target.closest('[data-t]'); if (!c || !S.cur) return;
  const cur = S.cur; cur.done[+c.dataset.t] = c.checked;
  c.closest('li').classList.toggle('done', c.checked);
  $('#pct').textContent = pct(cur) + '%'; $('#bar').style.width = pct(cur) + '%';
  try { await P.save(S.user.uid, cur); } catch { S.err = 'Could not save your progress. Check your connection.'; c.checked = !c.checked; cur.done[+c.dataset.t] = c.checked; render(); }
});
document.addEventListener('change', async e => {
  const sel = e.target.closest('[data-set-pref]'); if (!sel) return;
  M.preference = sel.value;
  saveModelSettings({ choice: 'accepted', preference: M.preference, activeModel: M.activeModel, dismissedAt: Date.now() });
  render();
});
document.addEventListener('change', e => {
  const mode = e.target.closest('[data-ai-mode]');
  const allowGroq = e.target.closest('[data-allow-groq]');
  if (mode) AI.mode = mode.value;
  if (allowGroq) AI.allowGroqFallback = allowGroq.checked;
  if (mode || allowGroq) { saveAISettings(); render(); }
});
document.addEventListener('input', e => {
  if (e.target.name === 'text') S.draft = e.target.value;
  if (e.target.hasAttribute('data-understood-field') && S.cur?.analysis) {
    S.cur.edits ||= {}; S.cur.edits[e.target.name] = e.target.value;
  }
  if (e.target.hasAttribute('data-requirement') && S.cur?.analysis) {
    S.cur.editRequirements[+e.target.dataset.requirement] = e.target.value;
  }
});
window.addEventListener('hashchange', go);

(async function init() {
  loadAISettings();
  try { P = FIREBASE_CONFIG ? await firebaseProvider(FIREBASE_CONFIG) : localProvider(); }
  catch (e) { console.error(e); S.fatal = 'Sign-in service is unavailable. Please try again later.'; return render(); }
  initializeModel();
  let last = null;
  P.onChange(async u => {
    if (u && u.uid !== last) S.hist = await P.list(u.uid).catch(() => []);
    if (!u || u.uid !== last) { S.cur = null; S.draft = ''; }
    if (!u) S.hist = [];
    last = u ? u.uid : null; S.user = u; S.ready = true; S.err = ''; render();
  });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
