import { analyzeAssignment, mergeAssignmentSuggestions } from "./studylens-analyzer.js";
import { isValidAssignmentSuggestion } from "./assignment-schema.js";
import { groqProvider } from "./groq-provider.js";
import { onDeviceModel, shouldUseModel } from "./on-device-ai.js";

export const AI_MODES = ["automatic", "on-device", "groq", "rules"];

function rulesResult(text, rules, now, metadata = {}) {
  const result = mergeAssignmentSuggestions(text, rules, null, { now });
  return {
    ...result,
    analysisProvider: "rules",
    analysisModel: null,
    analysisMs: metadata.elapsedMs ?? 0,
    analysisConfidence: rules.confidence,
    fallbackFrom: metadata.fallbackFrom || null,
  };
}

export async function analyzeAssignmentWithAI(text, {
  mode = "automatic",
  groqEnabledInAutomatic = false,
  model = onDeviceModel,
  groq = groqProvider,
  getGroqToken = async () => null,
  now = new Date(),
} = {}) {
  const startedAt = Date.now();
  const rules = analyzeAssignment(text, { now });
  if (!shouldUseModel(rules) || mode === "rules" || !AI_MODES.includes(mode)) {
    return rulesResult(text, rules, now, { elapsedMs: Date.now() - startedAt });
  }

  const activeModelId = model?.getActiveModel?.();
  const providers = [];
  if (mode === "on-device") {
    if (activeModelId) providers.push({ id: "webllm", name: "On-device AI", model: activeModelId, provider: model });
  } else if (mode === "groq") {
    providers.push({ id: "groq", name: "Groq Cloud AI", provider: groq });
    if (activeModelId) providers.push({ id: "webllm", name: "On-device AI", model: activeModelId, provider: model });
  } else {
    if (activeModelId) providers.push({ id: "webllm", name: "On-device AI", model: activeModelId, provider: model });
    if (groqEnabledInAutomatic) providers.push({ id: "groq", name: "Groq Cloud AI", provider: groq });
  }

  let fallbackFrom = null;
  for (const candidate of providers) {
    try {
      if (candidate.id === "groq") {
        const status = await candidate.provider.getStatus();
        if (!status.configured) {
          fallbackFrom ||= "Groq Cloud AI";
          continue;
        }
        const token = await getGroqToken();
        if (!token) {
          fallbackFrom ||= "Groq Cloud AI";
          continue;
        }
        candidate.token = token;
      }
      const response = await candidate.provider.analyze(text, candidate.id === "groq" ? { token: candidate.token } : undefined);
      const suggestion = response?.suggestion ?? response;
      if (!isValidAssignmentSuggestion(suggestion)) throw new Error("The AI response did not match the assignment schema.");
      const result = mergeAssignmentSuggestions(text, rules, suggestion, {
        now,
        source: candidate.name,
      });
      return {
        ...result,
        analysisProvider: candidate.id,
        analysisModel: response?.model || candidate.model || null,
        analysisMs: Date.now() - startedAt,
        analysisConfidence: rules.confidence,
        fallbackFrom,
      };
    } catch (error) {
      fallbackFrom ||= candidate.name;
    }
  }
  return rulesResult(text, rules, now, { elapsedMs: Date.now() - startedAt, fallbackFrom });
}
