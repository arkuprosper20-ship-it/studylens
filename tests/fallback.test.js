import test from "node:test";
import assert from "node:assert/strict";
import { analyzeAssignmentWithAI } from "../ai-provider.js";

const NOW = new Date("2026-10-01T12:00:00");

const UNCERTAIN = "my teacher wants a short report about volcanoes, around two pages, due before the weekend";

const VALID_SUGGESTION = {
  isAssignment: true,
  type: "Essay / Paper",
  topic: "volcanoes",
  wordCount: null,
  pages: 2,
  slides: null,
  sources: null,
  citationStyle: null,
  deadlineText: "before the weekend",
  requirements: [],
  formatRules: [],
  otherInstructions: [],
};

const readyModel = {
  getActiveModel: () => "test-model",
  analyze: async () => ({ ...VALID_SUGGESTION, type: "Lab Report" }),
};
const failingModel = {
  getActiveModel: () => "test-model",
  analyze: async () => { throw new Error("WebGPU context lost"); },
};
const noModel = {
  getActiveModel: () => null,
  analyze: async () => { throw new Error("must not run"); },
};

const groqSuccess = {
  getStatus: async () => ({ configured: true }),
  analyze: async () => ({ suggestion: { ...VALID_SUGGESTION, type: "Essay / Paper" }, model: "llama-3.3-70b-versatile" }),
};
const groqFail = {
  getStatus: async () => ({ configured: true }),
  analyze: async () => { throw new Error("Groq network error"); },
};
const groqUnconfigured = {
  getStatus: async () => ({ configured: false }),
  analyze: async () => { throw new Error("must not be called"); },
};
const noToken = {
  getStatus: async () => ({ configured: true }),
  analyze: async () => { throw new Error("must not be called"); },
};

test("Groq fails, WebLLM available — falls back to WebLLM", async () => {
  const result = await analyzeAssignmentWithAI(UNCERTAIN, {
    now: NOW,
    mode: "groq",
    model: readyModel,
    groq: groqFail,
  });
  assert.equal(result.analysisProvider, "webllm");
  assert.equal(result.fallbackFrom, "Groq Cloud AI");
});

test("Groq fails, WebLLM also fails — falls back to Rules", async () => {
  const result = await analyzeAssignmentWithAI(UNCERTAIN, {
    now: NOW,
    mode: "groq",
    model: failingModel,
    groq: groqFail,
  });
  assert.equal(result.analysisProvider, "rules");
  assert.equal(result.fallbackFrom, "Groq Cloud AI");
});

test("Both WebLLM and Groq unavailable — falls back to Rules", async () => {
  const result = await analyzeAssignmentWithAI(UNCERTAIN, {
    now: NOW,
    mode: "groq",
    model: noModel,
    groq: groqUnconfigured,
  });
  assert.equal(result.analysisProvider, "rules");
  assert.equal(result.fallbackFrom, "Groq Cloud AI");
});

test("Groq succeeds in explicit Groq mode — uses Groq", async () => {
  const result = await analyzeAssignmentWithAI(UNCERTAIN, {
    now: NOW,
    mode: "groq",
    model: readyModel,
    groq: groqSuccess,
    getGroqToken: async () => "fake-token",
  });
  assert.equal(result.analysisProvider, "groq");
  assert.equal(result.fallbackFrom, null);
});

test("On-device mode: WebLLM fails — falls back to Rules", async () => {
  const result = await analyzeAssignmentWithAI(UNCERTAIN, {
    now: NOW,
    mode: "on-device",
    model: failingModel,
    groq: noToken,
  });
  assert.equal(result.analysisProvider, "rules");
  assert.equal(result.fallbackFrom, "On-device AI");
});

test("On-device mode: WebLLM succeeds — uses on-device", async () => {
  const result = await analyzeAssignmentWithAI(UNCERTAIN, {
    now: NOW,
    mode: "on-device",
    model: readyModel,
    groq: noToken,
  });
  assert.equal(result.analysisProvider, "webllm");
  assert.equal(result.fallbackFrom, null);
});

test("Automatic mode: prefers ready WebLLM, never calls Groq", async () => {
  let groqCalls = 0;
  const result = await analyzeAssignmentWithAI(UNCERTAIN, {
    now: NOW,
    mode: "automatic",
    groqEnabledInAutomatic: true,
    model: readyModel,
    groq: {
      getStatus: async () => { groqCalls++; return { configured: true }; },
      analyze: async () => { groqCalls++; return { suggestion: VALID_SUGGESTION, model: "groq" }; },
    },
  });
  assert.equal(result.analysisProvider, "webllm");
  assert.equal(groqCalls, 0);
});

test("Automatic mode: no WebLLM, Groq enabled — uses Groq", async () => {
  const result = await analyzeAssignmentWithAI(UNCERTAIN, {
    now: NOW,
    mode: "automatic",
    groqEnabledInAutomatic: true,
    model: noModel,
    groq: groqSuccess,
    getGroqToken: async () => "fake-token",
  });
  assert.equal(result.analysisProvider, "groq");
});

test("Automatic mode: no WebLLM, Groq disabled — Rules only", async () => {
  const result = await analyzeAssignmentWithAI(UNCERTAIN, {
    now: NOW,
    mode: "automatic",
    groqEnabledInAutomatic: false,
    model: noModel,
    groq: groqSuccess,
  });
  assert.equal(result.analysisProvider, "rules");
});

test("Rules-only mode never calls any AI provider", async () => {
  let calls = 0;
  const result = await analyzeAssignmentWithAI(UNCERTAIN, {
    now: NOW,
    mode: "rules",
    model: { getActiveModel: () => { calls++; return "model"; }, analyze: async () => { calls++; } },
    groq: { getStatus: async () => { calls++; return { configured: true }; }, analyze: async () => { calls++; } },
  });
  assert.equal(calls, 0);
  assert.equal(result.analysisProvider, "rules");
});

test("Groq invalid output (bad schema) falls through to next provider", async () => {
  const result = await analyzeAssignmentWithAI(UNCERTAIN, {
    now: NOW,
    mode: "groq",
    model: readyModel,
    groq: {
      getStatus: async () => ({ configured: true }),
      analyze: async () => ({ suggestion: { type: "not-a-real-type" }, model: "groq" }),
    },
  });
  assert.equal(result.analysisProvider, "webllm");
  assert.equal(result.fallbackFrom, "Groq Cloud AI");
});

test("Groq missing token causes fallback to rules when WebLLM unavailable", async () => {
  const result = await analyzeAssignmentWithAI(UNCERTAIN, {
    now: NOW,
    mode: "groq",
    model: noModel,
    groq: {
      getStatus: async () => ({ configured: true }),
      analyze: async () => { throw Object.assign(new Error("auth"), { code: "auth_required" }); },
    },
    getGroqToken: async () => null,
  });
  assert.equal(result.analysisProvider, "rules");
});
