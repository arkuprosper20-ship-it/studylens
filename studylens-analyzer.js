// StudyLens local analysis engine v2 — no API key, no network, no dependencies.
// Rules + scoring + a little date/number intelligence.
//
// analyzeAssignment(text, { now }) returns:
//   type, typeConfidence, topic,
//   length   { words, minWords, maxWords, pages, slides, minutes, label }
//   wordCount (= length.words, kept for v1 compatibility)
//   sources (number|null), sourceInfo { kinds[], restrictions[] }
//   citationStyle, formatRules[]
//   deadline { raw, iso, label, daysLeft, time, approx } | null
//   requirements[]          plain strings (same as v1)
//   requirementDetails[]    { text, category: content|sources|format|delivery|constraint }
//   tasks[]                 { label, detail, minutes, dueISO, done }
//   effort { totalMinutes, totalHours, hoursPerDay, urgency }
//   warnings[], missing[], confidence (0-1), summary

// ───────────────────────── small helpers ─────────────────────────
const DAYIDX = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const DAYNAMES = Object.keys(DAYIDX).join("|");
const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const MON_ABBR = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const diffDays = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / 86400000);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dateLabel = (d) => `${DN[d.getDay()]}, ${MN[d.getMonth()]} ${d.getDate()}`;
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const SMALL = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const NUMWORD_RE = [...Object.keys(SMALL), ...Object.keys(TENS)].join("|");

/** "fifteen hundred" → 1500, "two thousand five hundred" → 2500, "1,200" → 1200, "a thousand" → 1000 */
function toNumber(str) {
  const s = String(str).trim().toLowerCase().replace(/,/g, "");
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const toks = s.replace(/-/g, " ").split(/\s+/).filter((t) => t && t !== "and");
  let total = 0, cur = 0, seen = false;
  for (const t of toks) {
    if (t === "a" || t === "an") { cur = cur || 1; continue; }
    if (t in SMALL) { cur += SMALL[t]; seen = true; }
    else if (t in TENS) { cur += TENS[t]; seen = true; }
    else if (t === "hundred") { cur = (cur || 1) * 100; seen = true; }
    else if (t === "thousand") { total += (cur || 1) * 1000; cur = 0; seen = true; }
    else return null;
  }
  return seen ? total + cur : null;
}
/** Read a (possibly spelled-out) number from the tokens right before `idx`. */
function numberBefore(text, idx) {
  const toks = text.slice(0, idx).replace(/-/g, " ").trim().split(/\s+/).slice(-5);
  for (let k = toks.length; k >= 1; k--) {
    const v = toNumber(toks.slice(-k).join(" "));
    if (v !== null) return v;
  }
  return null;
}

// ───────────────────────── type detection (scored) ─────────────────────────
const TYPE_RULES = {
  "Coding Project": { re: /\b(code|coding|programs?|programming|app|application|software|algorithm|function|api|database|repo|github|git|python|java(?:script)?|typescript|c\+\+|html|css|sql|react|debug|compile|unit tests?)\b/gi, w: 1.5, max: 4 },
  "Presentation": { re: /\b(presentation|slides?|slideshow|powerpoint|keynote|pitch|speech)\b/gi, w: 2, max: 3 },
  "Lab Report": { re: /\b(lab report|experiment|hypothesis|methodology|procedure|observations?)\b/gi, w: 2, max: 3 },
  "Essay / Paper": { re: /\b(essay|paper|thesis|argue|argument|discuss|analy[sz]e|report|article|reflection|critique|review|words)\b/gi, w: 1.5, max: 4 },
};
function detectType(text) {
  const scores = {};
  for (const [name, r] of Object.entries(TYPE_RULES)) scores[name] = Math.min((text.match(r.re) || []).length, r.max) * r.w;
  scores["Essay / Paper"] += 0.5;
  const sum = Object.values(scores).reduce((a, b) => a + b, 0);
  const [type, top] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return { type, confidence: Math.round((top / sum) * 100) / 100 };
}

// ───────────────────────── length ─────────────────────────
function qualifierBefore(text, idx) {
  const pre = text.slice(Math.max(0, idx - 22), idx);
  if (/(at least|minimum(?: of)?|min\.?|no (?:less|fewer) than|more than|over)\s*$/i.test(pre)) return "min";
  if (/(no more than|maximum(?: of)?|max\.?|up to|under|at most|less than|fewer than|not exceed(?:ing)?)\s*$/i.test(pre)) return "max";
  if (/(about|around|approximately|roughly|~)\s*$/i.test(pre)) return "approx";
  return null;
}
function detectLength(text) {
  const n = (s, k) => parseFloat(s.replace(/,/g, "")) * (k ? 1000 : 1);
  const L = { words: null, minWords: null, maxWords: null, pages: null, slides: null, minutes: null };
  let m = text.match(/(\d[\d,]*(?:\.\d+)?)\s*(k)?\s*(?:-|–|—|to|and)\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?\s*-?\s*words?\b/i);
  if (m) {
    const a = n(m[1], m[2]), b = n(m[3], m[4]);
    L.minWords = Math.min(a, b); L.maxWords = Math.max(a, b); L.words = L.maxWords; L.target = (a + b) / 2;
  } else if ((m = text.match(/(\d[\d,]*(?:\.\d+)?)\s*(k)?\s*-?\s*words?\b/i))) {
    const v = n(m[1], m[2]), q = qualifierBefore(text, m.index);
    L.words = v; L.target = v; L.qualifier = q;
    if (q === "min") L.minWords = v;
    if (q === "max") L.maxWords = v;
  } else {
    const re = /\bwords?\b/gi; let w;
    while ((w = re.exec(text))) {
      if (/own\s*$/i.test(text.slice(0, w.index))) continue;
      const v = numberBefore(text, w.index);
      if (v && v >= 50) { L.words = v; L.target = v; L.qualifier = qualifierBefore(text, w.index - 20); break; }
    }
  }
  const spacedSingle = /single[- ]spaced/i.test(text);
  if ((m = text.match(/(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*-?\s*pages?\b/i))) {
    const lo = parseFloat(m[1]), hi = m[2] ? parseFloat(m[2]) : lo;
    L.pages = m[2] ? `${lo}–${hi}` : lo;
    if (!L.words) { const per = spacedSingle ? 500 : 275; L.words = Math.round(hi * per); L.target = Math.round(((lo + hi) / 2) * per); L.estimatedFromPages = true; }
  }
  if ((m = text.match(/(\d+)\s*-?\s*slides?\b/i))) L.slides = parseInt(m[1], 10);
  if ((m = text.match(/(\d+)(?:\s*(?:-|to)\s*(\d+))?\s*-?\s*minutes?\b/i))) L.minutes = parseInt(m[2] || m[1], 10);
  const parts = [];
  if (L.minWords && L.maxWords && L.minWords !== L.maxWords) parts.push(`${fmt(L.minWords)}–${fmt(L.maxWords)} words`);
  else if (L.words && !L.estimatedFromPages) {
    parts.push(L.qualifier === "min" ? `${fmt(L.words)}+ words` : L.qualifier === "max" ? `up to ${fmt(L.words)} words` : L.qualifier === "approx" ? `~${fmt(L.words)} words` : `${fmt(L.words)} words`);
  }
  if (L.pages) parts.push(`${L.pages} pages${L.estimatedFromPages ? ` (~${fmt(L.words)} words)` : ""}`);
  if (L.slides) parts.push(`${L.slides} slides`);
  if (L.minutes) parts.push(`${L.minutes} min`);
  L.label = parts.join(" · ") || null;
  return L;
}

// ───────────────────────── sources, citation, format ─────────────────────────
function detectSources(text) {
  const re = new RegExp(`(?:(at least|minimum of|minimum|min\\.?|no (?:fewer|less) than|a minimum of|up to|maximum of|at most)\\s+)?(\\d+|${NUMWORD_RE})\\+?\\s+(?:[\\w-]+,?\\s+){0,3}?(?:sources?|references?|citations?|articles?|books?|journals?)\\b`, "i");
  const m = text.match(re);
  const kinds = [];
  for (const [k, r] of [["peer-reviewed", /peer[- ]reviewed/i], ["scholarly", /scholarly|academic/i], ["primary", /primary sources?/i], ["credible", /credible|reliable|reputable/i]]) if (r.test(text)) kinds.push(k);
  const restrictions = [];
  const rr = /\b(?:no|not|avoid|don'?t use|do not use|without)\s+(?:\w+\s+){0,2}?(wikipedia|blogs?|social media|websites?)\b/gi;
  let x; while ((x = rr.exec(text))) restrictions.push(`No ${cap(x[1].toLowerCase())}`);
  return { count: m ? toNumber(m[2]) : null, qualifier: m && m[1] ? (/up to|max|at most/i.test(m[1]) ? "max" : "min") : null, kinds, restrictions };
}
function detectCitationStyle(text) {
  let m = text.match(/\b(APA|MLA|IEEE)\b/);
  if (m) return m[1];
  m = text.match(/\b(chicago|harvard|turabian|vancouver)(?:[- ](?:style|format|citations?|referencing))\b/i) || text.match(/\b(?:in|use|using|cite(?:d)? in)\s+(chicago|harvard|turabian)\b/i);
  return m ? cap(m[1].toLowerCase()) : null;
}
function detectFormat(text) {
  const out = []; let m;
  if (/double[- ]spaced/i.test(text)) out.push("Double-spaced");
  if (/single[- ]spaced/i.test(text)) out.push("Single-spaced");
  if ((m = text.match(/(\d{1,2})\s*-?\s*(?:pt|point)\b/i))) out.push(`${m[1]}-pt font`);
  if ((m = text.match(/\b(times new roman|arial|calibri|helvetica|garamond)\b/i))) out.push(m[1].replace(/\b\w/g, (c) => c.toUpperCase()));
  if ((m = text.match(/(\d(?:\.\d+)?)[- ]?(?:inch|in\.?|")\s+margins?/i))) out.push(`${m[1]}" margins`);
  if (/title page|cover page/i.test(text)) out.push("Title page");
  if (/\babstract\b/i.test(text)) out.push("Abstract");
  if (/works cited|bibliography|reference list|references page/i.test(text)) out.push("Bibliography / works cited");
  if (/in-text (?:citations?|references?)|parenthetical/i.test(text)) out.push("In-text citations");
  if ((m = text.match(/\b(?:as|in)\s+(?:a\s+)?(pdf|docx?|word document)\b/i))) out.push(`Submit as ${m[1].toUpperCase().replace("WORD DOCUMENT", "Word document")}`);
  return out;
}

// ───────────────────────── deadline ─────────────────────────
const LEAD = "(?:due(?: date)?(?: is)?|submit(?:ted)?|hand(?:ed)? in|turn(?:ed)? in|deadline(?: is)?|by|before|no later than|until)[:\\s]+";
function parseDeadline(text, now) {
  const today = startOfDay(now); let date = null, raw = null, approx = false, m;
  const monthIdx = (s) => MON_ABBR.indexOf(s.slice(0, 3).toLowerCase());
  if ((m = text.match(new RegExp(`\\b${LEAD}(?:on\\s+)?(?:the\\s+)?(${MONTHS})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, "i")))) {
    const y = m[3] ? +m[3] : today.getFullYear(); date = new Date(y, monthIdx(m[1]), +m[2]);
    if (!m[3] && date < today) date = new Date(y + 1, monthIdx(m[1]), +m[2]);
    raw = `${cap(m[1])} ${m[2]}`;
  } else if ((m = text.match(new RegExp(`\\b${LEAD}(?:on\\s+)?(\\d{1,2})[\\/.-](\\d{1,2})(?:[\\/.-](\\d{2,4}))?\\b`, "i")))) {
    let a = +m[1], b = +m[2]; if (a > 12) [a, b] = [b, a];
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : today.getFullYear(); date = new Date(y, a - 1, b);
    if (!m[3] && date < today) date = new Date(y + 1, a - 1, b);
    raw = m[0].replace(new RegExp(`^${LEAD}`, "i"), "");
  } else if ((m = text.match(new RegExp(`\\b${LEAD}(?:on\\s+)?(?:the\\s+)?(next\\s+|this\\s+)?(${DAYNAMES})\\b`, "i")))) {
    const t = DAYIDX[m[2].toLowerCase()], mod = (m[1] || "").trim().toLowerCase();
    const monday = addDays(today, -((today.getDay() + 6) % 7));
    if (mod === "next") date = addDays(monday, 7 + ((t + 6) % 7));
    else if (mod === "this") { date = addDays(monday, (t + 6) % 7); if (date < today) date = addDays(date, 7); }
    else date = addDays(today, (t - today.getDay() + 7) % 7);
    raw = cap((m[1] || "") + m[2]);
  } else if ((m = text.match(new RegExp(`\\b${LEAD}(?:on\\s+)?(tomorrow|tonight|today|end of (?:the )?(?:week|month)|next week)\\b`, "i")))) {
    const k = m[1].toLowerCase();
    if (k === "tomorrow") date = addDays(today, 1);
    else if (k === "today" || k === "tonight") date = today;
    else if (k === "next week") { date = addDays(today, 7); approx = true; }
    else if (/week/.test(k)) date = addDays(today, (5 - today.getDay() + 7) % 7);
    else date = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    raw = cap(k);
  } else if ((m = text.match(new RegExp(`\\b${LEAD}in\\s+(\\d+|${NUMWORD_RE})\\s+(day|week)s?\\b`, "i")))) {
    const k = toNumber(m[1]);
    date = addDays(today, k * (m[2].toLowerCase() === "week" ? 7 : 1)); raw = `In ${m[1]} ${m[2].toLowerCase()}${k === 1 ? "" : "s"}`;
  }
  if (!date) return null;
  const tm = text.match(/\b(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|midnight|noon)\b/i);
  const daysLeft = diffDays(date, today);
  const rel = daysLeft === 0 ? "today" : daysLeft === 1 ? "tomorrow" : daysLeft > 1 ? `in ${daysLeft} days` : `${-daysLeft} day${daysLeft === -1 ? "" : "s"} overdue`;
  return { raw, iso: iso(date), label: `${dateLabel(date)} (${rel})`, daysLeft, time: tm ? tm[1] : null, approx };
}

// ───────────────────────── requirements ─────────────────────────
const VERBS = "write|discuss|explain|describe|analy[sz]e|compare|contrast|evaluate|propose|suggest|recommend|include|use|cite|support|argue|outline|summari[sz]e|define|identify|present|submit|create|build|implement|design|test|document|reference|provide|explore|examine|address|demonstrate|apply|reflect|conclude|format|proofread|review|consider|justify|develop|research|choose|select|make|ensure|keep|limit|avoid|do not|don't|never|turn in|hand in|upload|email|send|add|show|give|list|name";
const ACTION = new RegExp(`^(?:${VERBS})\\b`, "i");
const SPLIT = new RegExp(`(?:,(?!\\d)\\s*(?:and\\s+|then\\s+)?|\\s+(?:and|then)\\s+)(?=(?:${VERBS})\\b)`, "i");
const SUBJ = "(?:(?:you|students?|(?:your|the)\\s+(?:essay|paper|report|presentation|project|submission|assignment|work|program|app))\\s+)?";
const MODAL = new RegExp(`^${SUBJ}(?:must|should|need to|needs to|have to|has to|will need to|are required to|are expected to|shall|will)\\s+`, "i");
const PREFIX = /^(?:make sure (?:to|that you|you)|be sure to|don'?t forget to|remember to|please|also|then|and)\s+/i;
const DEADLINE_HINT = new RegExp(`\\b(by|before|on|due|until|tomorrow|tonight|today|next|this|${DAYNAMES}|${MONTHS})\\b|\\d{1,2}[/.-]\\d{1,2}`, "i");

function extractRequirements(text) {
  const out = [];
  const lines = text.split(/\n+/).map((l) => l.replace(/^\s*(?:[-*•▪]|\d+[.)])\s+/, "").trim()).filter(Boolean);
  for (const line of lines) for (const sent of line.split(/(?<=[.!?;])\s+/)) {
    const clauses = sent.replace(/[.!?;]+$/, "").split(SPLIT).map((c) => c.trim()).filter(Boolean);
    for (let i = 0; i < clauses.length - 1; i++) {           // "Analyze" + "compare the two…" → "Analyze and compare the two…"
      if (!/\s/.test(clauses[i])) { clauses[i + 1] = `${clauses[i]} and ${clauses[i + 1]}`; clauses[i] = ""; }
    }
    for (let c of clauses) {
      for (let k = 0; k < 3; k++) c = c.replace(PREFIX, "").replace(MODAL, "");
      c = c.trim(); if (!c || !ACTION.test(c)) continue;
      if (/^(write|create|prepare|produce|give|deliver)\b/i.test(c) && /\b(words?|pages?|slides?|minutes?)\b/i.test(c) && !/own words/i.test(c)) continue;
      if (/^(submit|turn in|hand in|upload|email|send)\b/i.test(c) && DEADLINE_HINT.test(c)) continue;
      let category = "content";
      if (/^(do not|don't|never|avoid)\b/i.test(c)) category = "constraint";
      else if (/^(submit|turn in|hand in|upload|email|send)\b/i.test(c)) category = "delivery";
      else if (/\b(sources?|references?|cite|citations?|bibliograph|works cited)\b/i.test(c)) category = "sources";
      else if (/\b(spaced|font|margins?|pt|title page|formatted?|APA|MLA|Chicago)\b|\b\d+\s*(?:words|pages|slides|minutes)\b/i.test(c)) category = "format";
      out.push({ text: cap(c), category });
    }
  }
  const seen = new Set();
  return out.filter((r) => (seen.has(r.text.toLowerCase()) ? false : seen.add(r.text.toLowerCase())));
}

// ───────────────────────── topic ─────────────────────────
function detectTopic(text) {
  const first = text.split(/(?<=[.!?])\s+/)[0] || text;
  const m = first.match(/\b(?:about|on|regarding|concerning|analysis of|analy[sz]ing|examining|exploring|discussing|the topic of|focus(?:ed|ing) on)\s+(.+?)(?=\s*(?:[.,;:!?]|\bwith\b|\busing\b|\bthat\b|\bwhich\b|\bdue\b|\bby\b|$))/i)
    || first.match(/\b(?:build|create|develop|design|implement|make)\s+(?:a|an|the)\s+(.+?)(?=\s*(?:[.,;:!?]|\bwith\b|\busing\b|\bthat\b|\bwhich\b|$))/i);
  if (!m) return null;
  const t = m[1].replace(/^the\s+/i, "").trim();
  return t.length > 0 && t.length <= 70 ? t : null;
}

// ───────────────────────── plan + schedule ─────────────────────────
function buildPlan(type, ctx) {
  const { L, sources, topic, requirements, citationStyle } = ctx;
  const words = L.target || L.words || 1000;
  const T = (label, minutes, detail) => ({ label, detail: detail || null, minutes: Math.round(minutes), dueISO: null, done: false });
  const on = topic ? ` on ${topic}` : "";
  if (type === "Presentation") {
    const slides = L.slides || 10;
    return [T("Understand the requirements", 15), T("Research the topic", 60 + 25 * (sources || 0), sources ? `Find ${sources} sources${on}` : `Research${on}`),
      T("Outline the slides", 30, `Plan about ${slides} slides`), T("Design the slides", slides * 12), T("Practice the delivery", L.minutes ? L.minutes * 3 : 40, L.minutes ? `Run through it a few times to hit ${L.minutes} minutes` : null)];
  }
  if (type === "Coding Project") {
    return [T("Understand the requirements", 20), T("Plan the structure", 40), T("Set up the project", 30), T("Build core features", Math.max(180, requirements.length * 45), requirements.length ? `Cover ${requirements.length} stated requirements` : null),
      T("Test and fix bugs", 90), T("Write documentation", 40), T("Submit", 15)];
  }
  if (type === "Lab Report") {
    return [T("Understand the requirements", 15), T("Organize your data", 60), T("Write methods and results", 90), T("Write the discussion", 75), T("Proofread and submit", 40, citationStyle ? `Check ${citationStyle} citations` : null)];
  }
  return [
    T("Understand the requirements", 15),
    T("Gather sources", 30 + 25 * (sources || 3), sources ? `Find ${sources === 1 ? "a" : `at least ${sources}`} credible source${sources === 1 ? "" : "s"}${on}` : `Find a few credible sources${on}`),
    T("Create an outline", words > 2500 ? 45 : 30, "Thesis, main points, and order of evidence"),
    T("Write the first draft", (words / 350) * 60, `Aim for about ${fmt(words)} words`),
    T("Review the requirements", 20, "Tick off every requirement against your draft"),
    T("Proofread and submit", 20 + words * 0.015, citationStyle ? `Check ${citationStyle} citations and formatting` : "Read aloud, fix typos, check formatting"),
  ];
}
function schedule(tasks, deadline, now) {
  const total = tasks.reduce((s, t) => s + t.minutes, 0);
  const res = { totalMinutes: total, totalHours: Math.round((total / 60) * 10) / 10, hoursPerDay: null, urgency: null };
  if (!deadline) return res;
  const d = deadline.daysLeft;
  if (d < 0) { res.urgency = "overdue"; return res; }
  const usable = d >= 3 ? d - 1 : Math.max(1, d);                          // keep a buffer day when there is room
  res.hoursPerDay = Math.round((total / 60 / usable) * 10) / 10;
  res.urgency = res.hoursPerDay > 5 ? "very tight" : res.hoursPerDay > 3 ? "tight" : res.hoursPerDay > 1.5 ? "moderate" : "comfortable";
  let cum = 0; const today = startOfDay(now);
  for (const t of tasks) { cum += t.minutes; t.dueISO = iso(addDays(today, Math.max(1, Math.ceil((cum / total) * usable)) - 1)); }
  return res;
}

// ───────────────────────── main ─────────────────────────
export function analyzeAssignment(rawText, { now = new Date() } = {}) {
  const text = String(rawText || "").replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[ \t]+/g, " ").trim();
  const { type, confidence: typeConfidence } = detectType(text);
  const length = detectLength(text);
  const src = detectSources(text);
  const citationStyle = detectCitationStyle(text);
  const formatRules = detectFormat(text);
  const deadline = parseDeadline(text, now);
  const topic = detectTopic(text);
  const reqDetails = extractRequirements(text);
  if (src.count && !reqDetails.some((r) => r.category === "sources"))
    reqDetails.push({ text: `Include ${src.count} ${src.kinds[0] ? src.kinds[0] + " " : "credible "}sources`, category: "sources" });
  const requirements = reqDetails.map((r) => r.text);
  const tasks = buildPlan(type, { L: length, sources: src.count, topic, requirements, citationStyle });
  const effort = schedule(tasks, deadline, now);

  const warnings = [], missing = [];
  if (!deadline) { missing.push("deadline"); warnings.push("No deadline found — add one so StudyLens can schedule your tasks."); }
  else if (deadline.daysLeft < 0) warnings.push("This deadline looks like it has already passed.");
  else if (deadline.approx) warnings.push("The deadline is vague — double-check the exact date.");
  if (!length.label && (type === "Essay / Paper" || type === "Lab Report")) { missing.push("length"); warnings.push("No length requirement found (words or pages)."); }
  if (src.count && !citationStyle) warnings.push("Sources are required but no citation style was mentioned — ask your teacher (APA, MLA, etc.).");
  if (effort.urgency === "tight" || effort.urgency === "very tight") warnings.push(`This needs about ${effort.hoursPerDay} hours a day to finish on time — start today.`);
  if (typeConfidence < 0.45) warnings.push("The assignment type is a best guess — check the plan matches your task.");
  if (reqDetails.length < 2) warnings.push("Few requirements were detected — paste the full instructions for a better plan.");

  const found = [typeConfidence, deadline ? 1 : 0, length.label ? 1 : 0, reqDetails.length >= 2 ? 1 : 0.3];
  const confidence = Math.round((found.reduce((a, b) => a + b, 0) / found.length) * 100) / 100;
  const summary = [type, length.label, src.count ? `${src.count} sources` : null, deadline ? `due ${deadline.label}` : null].filter(Boolean).join(" · ");

  return {
    type, typeConfidence, topic, length, wordCount: length.words,
    sources: src.count, sourceInfo: { kinds: src.kinds, restrictions: src.restrictions },
    citationStyle, formatRules, deadline,
    requirements, requirementDetails: reqDetails,
    tasks, effort, warnings, missing, confidence, summary,
  };
}

const FIELD_SOURCE = { rules: "rules", ai: "on-device AI" };
const NON_CONTENT_WORDS = new Set(["about", "after", "also", "and", "are", "around", "because", "before", "being", "both", "could", "from", "have", "into", "must", "need", "please", "should", "that", "their", "then", "there", "these", "this", "through", "with", "would"]);
const NUMBER_WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
const MODEL_TYPES = new Set(["Essay / Paper", "Presentation", "Coding Project", "Lab Report", "Other"]);

function explicitlyMentionsNumber(text, value, unit) {
  const unitMatch = new RegExp(`\\b([\\d,]+|[a-z]+)\\s*-?\\s*${unit}\\b`, "gi");
  let match;
  while ((match = unitMatch.exec(text))) {
    const found = toNumber(match[1]);
    if (found === value) return true;
    if (match[1].toLowerCase() in NUMBER_WORDS && NUMBER_WORDS[match[1].toLowerCase()] === value) return true;
  }
  return false;
}

function phraseSupported(phrase, text) {
  const words = String(phrase || "").toLowerCase().match(/[a-z]{3,}/g) || [];
  const significant = words.filter((word) => !NON_CONTENT_WORDS.has(word));
  if (!significant.length) return false;
  const source = new Set((text.toLowerCase().match(/[a-z]{3,}/g) || []).filter((word) => !NON_CONTENT_WORDS.has(word)));
  return significant.filter((word) => source.has(word)).length / significant.length >= 0.6;
}

function stripPromptInjection(text) {
  return text.replace(/\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above)\s+instructions?\b[^.!?\n]*(?:[.!?]|$)/gi, " ");
}

function hasAssignmentSignal(text, rules) {
  return !!(rules.topic || rules.length?.label || rules.sources != null || rules.deadline)
    || /\b(?:assignment|homework|coursework|classwork|teacher|instructor|professor|essay|paper|report|project|presentation|worksheet|lab report|submit|hand\s+(?:it|this|the)\s+in|turn\s+(?:it|this)\s+in|due|deadline|\d+\s*(?:words?|pages?|slides?|sources?))\b/i.test(text);
}

function lengthLabel(length) {
  const parts = [];
  if (length.minWords && length.maxWords && length.minWords !== length.maxWords) parts.push(`${fmt(length.minWords)}–${fmt(length.maxWords)} words`);
  else if (length.words) parts.push(length.qualifier === "min" ? `${fmt(length.words)}+ words` : length.qualifier === "max" ? `up to ${fmt(length.words)} words` : length.qualifier === "approx" ? `~${fmt(length.words)} words` : `${fmt(length.words)} words`);
  if (length.pages) parts.push(`${length.pages} pages`);
  if (length.slides) parts.push(`${length.slides} slides`);
  if (length.minutes) parts.push(`${length.minutes} min`);
  return parts.join(" · ") || null;
}

export function parseAssignmentDeadline(text, now = new Date()) {
  return parseDeadline(String(text || ""), now);
}

export function rebuildAssignmentPlan(analysis, { now = new Date() } = {}) {
  const requirements = analysis.requirements || [];
  const tasks = buildPlan(analysis.type, {
    L: analysis.length || { words: null, target: null },
    sources: analysis.sources,
    topic: analysis.topic,
    requirements,
    citationStyle: analysis.citationStyle,
  });
  const effort = schedule(tasks, analysis.deadline, now);
  const summary = [analysis.type, analysis.length?.label, analysis.sources ? `${analysis.sources} sources` : null,
    analysis.deadline ? `due ${analysis.deadline.label}` : null].filter(Boolean).join(" · ");
  return { ...analysis, tasks, effort, summary };
}

export function mergeAssignmentSuggestions(rawText, rules, suggestion, { now = new Date() } = {}) {
  const text = String(rawText || "");
  const supportedText = stripPromptInjection(text);
  const result = {
    ...rules,
    length: { ...rules.length },
    sourceInfo: { ...rules.sourceInfo, kinds: [...(rules.sourceInfo?.kinds || [])], restrictions: [...(rules.sourceInfo?.restrictions || [])] },
    formatRules: [...(rules.formatRules || [])],
    requirements: (rules.requirements || []).filter((item) => phraseSupported(item, supportedText)),
    requirementDetails: (rules.requirementDetails || []).filter((item) => phraseSupported(item.text, supportedText)),
    otherInstructions: [],
    fieldSources: Object.fromEntries(["type", "topic", "length", "sources", "citationStyle", "deadline", "requirements", "formatRules"].map((field) => [field, FIELD_SOURCE.rules])),
    deadlineText: rules.deadline?.raw || null,
    deadlineNeedsConfirmation: false,
    isAssignment: true,
  };

  if (!suggestion || typeof suggestion !== "object") return rebuildAssignmentPlan(result, { now });
  if (suggestion.isAssignment === false) {
    if (!hasAssignmentSignal(supportedText, rules)) {
      result.isAssignment = false;
      return rebuildAssignmentPlan(result, { now });
    }
  }

  if (rules.typeConfidence < 0.7 && MODEL_TYPES.has(suggestion.type)) {
    result.type = suggestion.type;
    result.fieldSources.type = FIELD_SOURCE.ai;
  }
  if (!result.topic && phraseSupported(suggestion.topic, supportedText)) {
    result.topic = String(suggestion.topic).trim().slice(0, 100);
    result.fieldSources.topic = FIELD_SOURCE.ai;
  }

  const wordCount = suggestion.wordCount;
  if (!result.length.words && Number.isInteger(wordCount) && wordCount >= 50 && wordCount <= 50000 && explicitlyMentionsNumber(text, wordCount, "words?")) {
    result.length.words = wordCount;
    result.length.target = wordCount;
    result.fieldSources.length = FIELD_SOURCE.ai;
  }
  if (!result.length.pages && Number.isInteger(suggestion.pages) && suggestion.pages > 0 && suggestion.pages <= 200 && explicitlyMentionsNumber(text, suggestion.pages, "pages?")) {
    result.length.pages = suggestion.pages;
    result.fieldSources.length = FIELD_SOURCE.ai;
  }
  if (!result.length.slides && Number.isInteger(suggestion.slides) && suggestion.slides > 0 && suggestion.slides <= 200 && explicitlyMentionsNumber(text, suggestion.slides, "slides?")) {
    result.length.slides = suggestion.slides;
    result.fieldSources.length = FIELD_SOURCE.ai;
  }
  result.length.label = lengthLabel(result.length);

  if (result.sources == null && Number.isInteger(suggestion.sources) && suggestion.sources >= 0 && suggestion.sources <= 50 && explicitlyMentionsNumber(text, suggestion.sources, "sources?|references?|citations?")) {
    result.sources = suggestion.sources;
    result.fieldSources.sources = FIELD_SOURCE.ai;
  }
  if (!result.citationStyle && typeof suggestion.citationStyle === "string" && phraseSupported(suggestion.citationStyle, supportedText)) {
    result.citationStyle = suggestion.citationStyle.trim().slice(0, 40);
    result.fieldSources.citationStyle = FIELD_SOURCE.ai;
  }

  if (!result.deadline && typeof suggestion.deadlineText === "string" && suggestion.deadlineText.trim() && text.toLowerCase().includes(suggestion.deadlineText.trim().toLowerCase())) {
    result.deadlineText = suggestion.deadlineText.trim();
    result.deadline = parseDeadline(result.deadlineText, now);
    result.deadlineNeedsConfirmation = !result.deadline;
    result.fieldSources.deadline = FIELD_SOURCE.ai;
  }
  if (!result.deadline && !result.deadlineText) {
    const vagueDeadline = supportedText.match(/\b(?:before|by|due|submit|hand\s+(?:it\s+)?in|turn\s+(?:it\s+)?in)\s+(?:on\s+)?(?:the\s+)?(?:weekend|end\s+of\s+(?:the\s+)?week)\b/i);
    if (vagueDeadline) {
      result.deadlineText = vagueDeadline[0].trim();
      result.deadlineNeedsConfirmation = true;
    }
  }

  const knownRequirements = new Set(result.requirements.map((item) => item.toLowerCase()));
  for (const requirement of Array.isArray(suggestion.requirements) ? suggestion.requirements : []) {
    if (typeof requirement !== "string" || requirement.length > 180 || !phraseSupported(requirement, supportedText)) continue;
    if (!knownRequirements.has(requirement.toLowerCase())) {
      result.requirements.push(requirement.trim());
      result.requirementDetails.push({ text: requirement.trim(), category: "content" });
      knownRequirements.add(requirement.toLowerCase());
      result.fieldSources.requirements = FIELD_SOURCE.ai;
    }
  }
  for (const rule of Array.isArray(suggestion.formatRules) ? suggestion.formatRules : []) {
    if (typeof rule === "string" && rule.length <= 100 && phraseSupported(rule, supportedText) && !result.formatRules.includes(rule)) {
      result.formatRules.push(rule);
      result.fieldSources.formatRules = FIELD_SOURCE.ai;
    }
  }
  result.otherInstructions = (Array.isArray(suggestion.otherInstructions) ? suggestion.otherInstructions : [])
    .filter((item) => typeof item === "string" && item.length <= 300 && supportedText.toLowerCase().includes(item.trim().toLowerCase()))
    .map((item) => item.trim());

  result.missing = [...(rules.missing || [])].filter((field) => !(field === "length" && result.length.label) && !(field === "deadline" && result.deadline));
  result.warnings = [...(rules.warnings || [])].filter((warning) => !(result.length.label && warning.startsWith("No length requirement")) && !(result.deadline && warning.startsWith("No deadline found")));
  if (result.deadlineNeedsConfirmation) result.warnings.push("The deadline text is vague — confirm the exact date before relying on the schedule.");
  return rebuildAssignmentPlan(result, { now });
}

// ───────────────────────── progress + history (browser storage) ─────────────────────────
const KEY = "studylens.history.v1";
const mem = {};
const store = (typeof localStorage !== "undefined" && localStorage) || { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
export const loadHistory = () => { try { return JSON.parse(store.getItem(KEY) || "[]"); } catch { return []; } };
const save = (list) => store.setItem(KEY, JSON.stringify(list));

export function saveAssignment(text, analysis) {
  const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), createdAt: new Date().toISOString(), text, ...analysis };
  save([item, ...loadHistory()]); return item;
}
export function toggleTask(id, index) {
  const list = loadHistory(); const item = list.find((a) => a.id === id);
  if (!item) return null; item.tasks[index].done = !item.tasks[index].done; save(list); return item;
}
export function deleteAssignment(id) { save(loadHistory().filter((a) => a.id !== id)); }
export const progress = (a) => {
  const done = a.tasks.filter((t) => t.done).length;
  return { done, total: a.tasks.length, percent: Math.round((done / a.tasks.length) * 100) };
};
/** The next unfinished task, plus whether it is behind its suggested due date. */
export function nextUp(a, now = new Date()) {
  const i = a.tasks.findIndex((t) => !t.done); if (i < 0) return null;
  const t = a.tasks[i];
  return { index: i, ...t, overdue: !!t.dueISO && t.dueISO < iso(startOfDay(now)) };
}
