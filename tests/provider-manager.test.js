import test from "node:test";
import assert from "node:assert/strict";
import { analyzeAssignmentWithAI } from "../ai-provider.js";

const NOW = new Date("2026-10-01T12:00:00");
const HIGH_CONFIDENCE = "Write a 1,500-word essay about climate change. Use at least 3 credible sources. Discuss two causes, explain the effects, propose solutions, and submit Friday.";
const UNCERTAIN = "my teacher wants a short report about volcanoes, around two pages, due before the weekend";
const VALID = { isAssignment: true, type: "Essay / Paper", topic: "volcanoes", wordCount: null, pages: 2, slides: null, sources: null, citationStyle: null, deadlineText: "before the weekend", requirements: [], formatRules: [], otherInstructions: [] };
const readyModel = { getActiveModel: () => "local-model", analyze: async () => VALID };
const noModel = { getActiveModel: () => null, analyze: async () => { throw new Error("must not run"); } };
const groq = (overrides = {}) => ({ getStatus: async () => ({ configured: true }), analyze: async () => ({ suggestion: VALID, model: "test-groq" }), ...overrides });

test("high confidence skips every AI provider", async () => {
  let calls = 0;
  const result = await analyzeAssignmentWithAI(HIGH_CONFIDENCE, { now: NOW, mode: "automatic", model: { getActiveModel: () => { calls++; return "local"; } }, groq: { getStatus: async () => { calls++; return { configured: true }; }, analyze: async () => { calls++; } } });
  assert.equal(calls, 0);
  assert.equal(result.analysisProvider, "rules");
});

test("automatic prefers ready WebLLM without checking Groq", async () => {
  let groqChecks = 0;
  const result = await analyzeAssignmentWithAI(UNCERTAIN, { now: NOW, model: readyModel, groq: groq({ getStatus: async () => { groqChecks++; return { configured: true }; } }), groqEnabledInAutomatic: true });
  assert.equal(result.analysisProvider, "webllm");
  assert.equal(groqChecks, 0);
});

test("automatic never calls Groq unless explicitly enabled", async () => {
  let calls = 0;
  const result = await analyzeAssignmentWithAI(UNCERTAIN, { now: NOW, model: noModel, groq: groq({ analyze: async () => { calls++; return { suggestion: VALID, model: "test-groq" }; } }), groqEnabledInAutomatic: false });
  assert.equal(calls, 0);
  assert.equal(result.analysisProvider, "rules");
});

test("selected Groq falls back to WebLLM on provider failure", async () => {
  const result = await analyzeAssignmentWithAI(UNCERTAIN, { now: NOW, mode: "groq", model: readyModel, groq: groq({ analyze: async () => { throw new Error("network"); } }) });
  assert.equal(result.analysisProvider, "webllm");
  assert.equal(result.fallbackFrom, "Groq Cloud AI");
});

test("invalid Groq output falls through to rules when WebLLM is unavailable", async () => {
  const result = await analyzeAssignmentWithAI(UNCERTAIN, { now: NOW, mode: "groq", model: noModel, groq: groq({ analyze: async () => ({ suggestion: { type: "invalid" } }) }) });
  assert.equal(result.analysisProvider, "rules");
  assert.equal(result.fallbackFrom, "Groq Cloud AI");
});
