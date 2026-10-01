// StudyLens model registry — verified WebLLM model IDs.
//
// Each entry's `id` is a model_id from webllm.prebuiltAppConfig.model_list
// for the pinned @mlc-ai/web-llm version. To swap the default model, change
// the priority values below. To add a model, add an entry with a verified
// WebLLM model_id.
//
// sizeMB = approximate download size visible to the user (model weights only).
// vramMB  = approximate VRAM required by the model library (from WebLLM config).

export const MODEL_REGISTRY = [
  {
    id: "Qwen2.5-0.5B-Instruct-q4f32_1-MLC",
    name: "StudyLens Small",
    sizeMB: 266,
    vramMB: 1061,
    tier: "small",
    priority: 1,
    lowResource: true,
  },
  {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    name: "StudyLens Medium",
    sizeMB: 766,
    vramMB: 1630,
    tier: "medium",
    priority: 2,
    lowResource: true,
  },
  {
    id: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
    name: "StudyLens Advanced",
    sizeMB: 1540,
    vramMB: 2505,
    tier: "large",
    priority: 3,
    lowResource: true,
  },
];

// Backward-compatible default model config (points to the smallest recommended
// model so existing code that imports MODEL_CONFIG keeps working).
export const MODEL_CONFIG = MODEL_REGISTRY[0];

export const getModelById = (id) => MODEL_REGISTRY.find((m) => m.id === id);

export const MODELS_BY_TIER = {
  small: MODEL_REGISTRY.filter((m) => m.tier === "small"),
  medium: MODEL_REGISTRY.filter((m) => m.tier === "medium"),
  large: MODEL_REGISTRY.filter((m) => m.tier === "large"),
};
