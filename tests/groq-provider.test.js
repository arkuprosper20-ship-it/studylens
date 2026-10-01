import test from "node:test";
import assert from "node:assert/strict";
import { groqProvider } from "../groq-provider.js";

const VALID_SUGGESTION = {
  isAssignment: true,
  type: "Essay / Paper",
  topic: "climate change",
  wordCount: 1500,
  pages: null,
  slides: null,
  sources: 3,
  citationStyle: "APA",
  deadlineText: "Friday",
  requirements: ["Discuss causes", "Explain effects", "Propose solutions"],
  formatRules: ["Double-spaced"],
  otherInstructions: [],
};

const VALID_MODEL = "llama-3.3-70b-versatile";

const SMALL_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function mockFetch(response, status = 200, options = {}) {
  return (url, init) => {
    options.calls = options.calls || [];
    options.calls.push({ url, init });
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(response),
    });
  };
}

test("getStatus returns configured status when server responds 200", async () => {
  const fetchImpl = mockFetch(
    { configured: true, textModel: "llama-3.3-70b-versatile", visionModel: "qwen/qwen3.6-27b", visionSupported: true },
    200
  );
  const status = await groqProvider.getStatus({ fetchImpl });
  assert.equal(status.configured, true);
  assert.equal(status.textModel, "llama-3.3-70b-versatile");
  assert.equal(status.visionModel, "qwen/qwen3.6-27b");
  assert.equal(status.visionSupported, true);
});

test("getStatus returns not-configured when GROQ_API_KEY is missing", async () => {
  const fetchImpl = mockFetch(
    { configured: false, textModel: "llama-3.3-70b-versatile", visionModel: "qwen/qwen3.6-27b", visionSupported: true },
    200
  );
  const status = await groqProvider.getStatus({ fetchImpl });
  assert.equal(status.configured, false);
});

test("getStatus returns an error when the server is unreachable", async () => {
  const fetchImpl = (url) => Promise.reject(new TypeError("Failed to fetch"));
  let threw = false;
  try {
    await groqProvider.getStatus({ fetchImpl });
  } catch {
    threw = true;
  }
  assert.equal(threw, true);
});

test("analyze throws auth_required when no token is provided", async () => {
  const fetchImpl = mockFetch({}, 200);
  let threw = false;
  try {
    await groqProvider.analyze("test text", { fetchImpl });
  } catch (e) {
    threw = true;
    assert.equal(e.code, "auth_required");
  }
  assert.equal(threw, true);
});

test("analyze returns a validated suggestion on success", async () => {
  const fetchImpl = mockFetch({ result: VALID_SUGGESTION, model: VALID_MODEL }, 200);
  const result = await groqProvider.analyze("Write a 1,500-word essay about climate change.", {
    fetchImpl,
    token: "fake-firebase-token",
  });
  assert.deepEqual(result.suggestion, VALID_SUGGESTION);
  assert.equal(result.model, VALID_MODEL);
});

test("analyze throws when the API key is missing (server returns 503)", async () => {
  const fetchImpl = mockFetch({ error: "Groq is not configured.", code: "not_configured" }, 503);
  let threw = false;
  let errorCode;
  try {
    await groqProvider.analyze("test", { fetchImpl, token: "fake-token" });
  } catch (e) {
    threw = true;
    errorCode = e.code;
  }
  assert.equal(threw, true);
  assert.equal(errorCode, "not_configured");
});

test("analyze throws on API timeout (504)", async () => {
  const fetchImpl = mockFetch({ error: "Groq request timed out.", code: "timeout" }, 504);
  let threw = false;
  let errorCode;
  try {
    await groqProvider.analyze("test", { fetchImpl, token: "fake-token" });
  } catch (e) {
    threw = true;
    errorCode = e.code;
  }
  assert.equal(threw, true);
  assert.equal(errorCode, "timeout");
});

test("analyze throws on rate limiting (429)", async () => {
  const fetchImpl = mockFetch({ error: "Groq is rate-limited.", code: "rate_limited" }, 429);
  let threw = false;
  let errorCode;
  try {
    await groqProvider.analyze("test", { fetchImpl, token: "fake-token" });
  } catch (e) {
    threw = true;
    errorCode = e.code;
  }
  assert.equal(threw, true);
  assert.equal(errorCode, "rate_limited");
});

test("analyze throws on malformed response (502)", async () => {
  const fetchImpl = mockFetch({ error: "Groq returned invalid assignment data.", code: "invalid_response" }, 502);
  let threw = false;
  let errorCode;
  try {
    await groqProvider.analyze("test", { fetchImpl, token: "fake-token" });
  } catch (e) {
    threw = true;
    errorCode = e.code;
  }
  assert.equal(threw, true);
  assert.equal(errorCode, "invalid_response");
});

test("extractImageText throws auth_required when no token", async () => {
  const fetchImpl = mockFetch({}, 200);
  let threw = false;
  try {
    await groqProvider.extractImageText(SMALL_PNG, { fetchImpl });
  } catch (e) {
    threw = true;
    assert.equal(e.code, "auth_required");
  }
  assert.equal(threw, true);
});

test("extractImageText returns extractedText on success", async () => {
  const fetchImpl = mockFetch(
    { extractedText: "Write a 500-word essay about photosynthesis.", model: "qwen/qwen3.6-27b" },
    200
  );
  const result = await groqProvider.extractImageText(SMALL_PNG, {
    fetchImpl,
    token: "test-token",
  });
  assert.equal(result.extractedText, "Write a 500-word essay about photosynthesis.");
  assert.equal(result.model, "qwen/qwen3.6-27b");
});

test("extractImageText throws when server finds no text (502)", async () => {
  const fetchImpl = mockFetch(
    { error: "No readable assignment text was found.", code: "no_text" },
    502
  );
  let threw = false;
  let errorCode;
  try {
    await groqProvider.extractImageText(SMALL_PNG, {
      fetchImpl,
      token: "test-token",
    });
  } catch (e) {
    threw = true;
    errorCode = e.code;
  }
  assert.equal(threw, true);
  assert.equal(errorCode, "no_text");
});

test("extractImageText throws auth_required when no token provided", async () => {
  const fetchImpl = mockFetch({}, 200);
  let threw = false;
  try {
    await groqProvider.extractImageText(SMALL_PNG, { fetchImpl });
  } catch (e) {
    threw = true;
    assert.equal(e.code, "auth_required");
  }
  assert.equal(threw, true);
});

test("extractImageText returns model info on success", async () => {
  const fetchImpl = mockFetch(
    { extractedText: "Assignment text extracted from image.", model: "qwen/qwen3.6-27b" },
    200
  );
  const result = await groqProvider.extractImageText(SMALL_PNG, {
    fetchImpl,
    token: "test-token",
  });
  assert.equal(result.extractedText, "Assignment text extracted from image.");
  assert.equal(result.model, "qwen/qwen3.6-27b");
});
