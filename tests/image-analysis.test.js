import test from "node:test";
import assert from "node:assert/strict";
import { groqProvider } from "../groq-provider.js";

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

test("extractImageText sends image to /api/groq with bearer token", async () => {
  const opts = {};
  const fetchImpl = mockFetch(
    { extractedText: "Write a 500-word essay about photosynthesis.", model: "qwen/qwen3.6-27b" },
    200,
    opts
  );
  await groqProvider.extractImageText(SMALL_PNG, { fetchImpl, token: "test-token" });
  assert.equal(opts.calls.length, 1);
  const call = opts.calls[0];
  assert.equal(call.url, "/api/groq");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers.Authorization, "Bearer test-token");
  const body = JSON.parse(call.init.body);
  assert.equal(body.operation, "extract-image-text");
  assert.equal(body.imageDataUrl, SMALL_PNG);
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

test("extractImageText propagates server errors (unsupported image)", async () => {
  const fetchImpl = mockFetch(
    { error: "Upload a PNG, JPEG, or WebP image under 4 MB.", code: "invalid_image" },
    400
  );
  let threw = false;
  let errorCode;
  try {
    await groqProvider.extractImageText(SMALL_PNG, { fetchImpl, token: "test-token" });
  } catch (e) {
    threw = true;
    errorCode = e.code;
  }
  assert.equal(threw, true);
  assert.equal(errorCode, "invalid_image");
});

test("extractImageText returns extractedText on successful vision analysis", async () => {
  const fetchImpl = mockFetch(
    { extractedText: "Assignment: Write a 500-word essay about photosynthesis due next Monday.", model: "qwen/qwen3.6-27b" },
    200
  );
  const result = await groqProvider.extractImageText(SMALL_PNG, {
    fetchImpl,
    token: "test-token",
  });
  assert.equal(result.extractedText, "Assignment: Write a 500-word essay about photosynthesis due next Monday.");
  assert.equal(result.model, "qwen/qwen3.6-27b");
});
