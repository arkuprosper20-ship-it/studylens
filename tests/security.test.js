import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\//, "").replace(/%20/g, " ");
const ROOT_DIR = process.cwd().replace(/\\/g, "/");

const FRONTEND_FILES = [
  "app.js", "admin.js", "on-device-ai.js", "groq-provider.js", "ai-provider.js",
  "assignment-schema.js", "studylens-analyzer.js", "studylens-model-registry.js",
  "studylens-device.js", "studylens-model-selector.js", "admin-service.js", "webllm-worker.js",
  "firebase-config.js", "index.html", "admin.html",
];

const GROQ_KEY_PATTERN = /gsk_[A-Za-z0-9]{16,}/;

function readRootFile(name) {
  try {
    return readFileSync(join(ROOT_DIR, name), "utf8");
  } catch {
    return null;
  }
}

function findGitignoreViolations() {
  const gitignore = readRootFile(".gitignore") || "";
  const violations = [];
  if (!/\.env(?![a-z.])/i.test(gitignore) && !/^\.env\s*$/m.test(gitignore)) {
    if (!gitignore.includes(".env\n") && !/^\.env\s*$/m.test(gitignore)) {
      violations.push(".env is not explicitly listed in .gitignore");
    }
  }
  if (gitIgnoreAllowsEnvFile(gitignore)) {
    if (!/\.env\.example/.test(gitignore) || gitignore.includes("!.env.example") === false) {
      if (!/!\\\?\.env\.example/.test(gitignore) && !/!\\.env\\.example/.test(gitignore)) {
        violations.push(".env.example is ignored by .gitignore without a negation rule");
      }
    }
  }
  return violations;
}

function gitIgnoreAllowsEnvFile(content) {
  return content.includes(".env");
}

test("no Groq API key pattern appears in any frontend source file", () => {
  const offenders = [];
  for (const file of FRONTEND_FILES) {
    const src = readRootFile(file);
    if (src === null) continue;
    if (GROQ_KEY_PATTERN.test(src)) {
      offenders.push(file);
    }
  }
  assert.equal(offenders.length, 0, `API key pattern found in: ${offenders.join(", ")}`);
});

test("GROQ_API_KEY is never assigned a literal value in frontend code", () => {
  const offenders = [];
  for (const file of FRONTEND_FILES) {
    const src = readRootFile(file);
    if (src === null) continue;
    if (/GROQ_API_KEY\s*=\s*["']/.test(src) || /GROQ_API_KEY\s*=\s*process\.env/.test(src)) {
      if (!file.startsWith("api/")) {
        offenders.push(file);
      }
    }
  }
  assert.equal(offenders.length, 0, `Literal GROQ_API_KEY assignment found in: ${offenders.join(", ")}`);
});

test("the Groq provider sends the API key only to the server endpoint, never to Groq directly", () => {
  const src = readRootFile("groq-provider.js");
  assert.ok(src, "groq-provider.js not found");
  assert.equal(src.includes("api.groq.com"), false, "groq-provider.js calls Groq directly");
  assert.ok(src.includes("/api/groq"), "groq-provider.js proxies through /api/groq");
});

test("the API handler (api/groq.js) only reads the key from process.env", () => {
  const src = readRootFile("api/groq.js");
  assert.ok(src, "api/groq.js not found");
  assert.ok(/process\.env\.GROQ_API_KEY/.test(src), "api/groq.js must read GROQ_API_KEY from process.env");
  assert.equal(/GROQ_API_KEY\s*=\s*["'A-Za-z]/.test(src), false, "api/groq.js must not hardcode the key");
});

test(".gitignore excludes .env but keeps .env.example", () => {
  const gitignore = readRootFile(".gitignore") || "";
  assert.ok(/\.env\b/.test(gitignore) || /^\.env$/m.test(gitignore), ".gitignore should list .env");
  assert.ok(
    gitignore.includes("!.env.example") || /!\.env\.example/.test(gitignore),
    ".gitignore should have negation rule for .env.example"
  );
});

test(".env.example exists and does not contain a real key", () => {
  const src = readRootFile(".env.example");
  assert.ok(src !== null, ".env.example must exist");
  assert.ok(!GROQ_KEY_PATTERN.test(src), ".env.example must not contain a real Groq API key");
  assert.ok(src.includes("GROQ_API_KEY"), ".env.example must contain GROQ_API_KEY");
});

test("admin-service.js does not expose the API key", () => {
  const src = readRootFile("admin-service.js");
  assert.ok(src, "admin-service.js not found");
  assert.equal(GROQ_KEY_PATTERN.test(src), false, "admin-service.js must not contain a Groq API key");
  assert.equal(/GROQ_API_KEY\s*=\s*["'A-Za-z]/.test(src), false, "admin-service.js must not hardcode the key");
});

test("README.md does not contain a real Groq API key", () => {
  const src = readRootFile("README.md") || "";
  assert.equal(GROQ_KEY_PATTERN.test(src), false, "README.md must not contain a real Groq API key");
});
