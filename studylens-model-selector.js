// StudyLens model selector.
//
// Determines which WebLLM models are compatible with the device's capability
// tier and selects the best one based on tier, installed models, and user
// preference. The rules engine always wins — AI only fills gaps.

import { MODEL_REGISTRY, getModelById } from "./studylens-model-registry.js";

const TIER_RANK = { small: 1, medium: 2, large: 3 };

const TIER_BY_DEVICE_TIER = {
  basic: "small",
  standard: "medium",
  advanced: "large",
};

export function getCompatibleModels(capabilities) {
  if (!capabilities || !capabilities.webgpu || capabilities.tier === "unsupported") {
    return [];
  }
  const maxTier = TIER_BY_DEVICE_TIER[capabilities.tier] || "small";
  const maxRank = TIER_RANK[maxTier];
  return MODEL_REGISTRY.filter((m) => (TIER_RANK[m.tier] || 0) <= maxRank);
}

export function selectBestModel(capabilities, { installed = [], preference = "automatic", previousModel = null } = {}) {
  const compatible = getCompatibleModels(capabilities);
  if (!compatible.length) return null;

  // Respect previous choice if it is compatible and still installed
  if (previousModel) {
    const prev = getModelById(previousModel);
    if (prev && compatible.includes(prev) && installed.includes(previousModel)) {
      return prev;
    }
  }

  // Try installed models first (highest tier wins)
  const installedCompatible = compatible.filter((m) => installed.includes(m.id));
  if (installedCompatible.length) {
    return installedCompatible.sort((a, b) => (b.priority || 0) - (a.priority || 0))[0];
  }

  // Prefer user's tier preference among compatible models (even if not installed)
  if (preference !== "automatic" && TIER_RANK[preference]) {
    const prefMatch = compatible.find((m) => m.tier === preference);
    if (prefMatch) return prefMatch;
  }

  // Default: highest-tier compatible model (user must explicitly download it)
  return compatible.sort((a, b) => (b.priority || 0) - (a.priority || 0))[0];
}
