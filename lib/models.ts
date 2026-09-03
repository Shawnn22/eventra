export const advisorModels = [
  {
    id: "openrouter/free",
    provider: "OpenRouter",
    name: "Auto Free",
    short: "∞",
    color: "#d9ff57",
    description: "Automatically routes to an available free model with structured output support.",
    specialty: "Reliable free routing",
  },
  {
    id: "z-ai/glm-5.2:free",
    provider: "OpenRouter · Z.ai",
    name: "GLM 5.2 Free",
    short: "Z",
    color: "#cdd8ff",
    description: "A free reasoning model that challenges probability and risk assumptions.",
    specialty: "Market challenger",
  },
  {
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    provider: "OpenRouter · NVIDIA",
    name: "Nemotron 3 Super",
    short: "N",
    color: "#b9fbd5",
    description: "A large MoE model for reviewing multiple structured market signals.",
    specialty: "Deep risk review",
  },
  {
    id: "openai/gpt-oss-20b:free",
    provider: "OpenRouter · OpenAI OSS",
    name: "GPT-OSS 20B Free",
    short: "O",
    color: "#ffd7b5",
    description: "A compact open-weight model for fast, short-horizon market checks.",
    specialty: "Fast signal check",
  },
  {
    id: "google/gemma-4-26b-a4b-it:free",
    provider: "OpenRouter · Google",
    name: "Gemma 4 26B Free",
    short: "G",
    color: "#ead7ff",
    description: "Google's free model balancing speed with contextual analysis.",
    specialty: "Context reviewer",
  },
] as const;

export const productAiModels = [
  {
    id: "grok",
    apiModel: "x-ai/grok-4.20",
    analysisCredits: 5,
    analysisPriceUsd: 0.05,
    provider: "xAI",
    name: "Grok",
    short: "𝕏",
    color: "#111111",
    specialty: "Social signal analyst",
    description: "Planned for real-time narrative and market sentiment analysis.",
  },
  {
    id: "surf",
    apiModel: null,
    analysisCredits: 5,
    analysisPriceUsd: 0.05,
    provisionalPrice: true,
    provider: "AskSurf",
    name: "Surf",
    short: "S",
    color: "#3d77ff",
    specialty: "Crypto research agent",
    description: "Planned for campaign research and source-backed crypto context.",
  },
  {
    id: "deepseek",
    apiModel: "deepseek/deepseek-chat",
    analysisCredits: 2,
    analysisPriceUsd: 0.02,
    provider: "DeepSeek",
    name: "DeepSeek",
    short: "DS",
    color: "#dbe5ff",
    specialty: "Structured reasoning",
    description: "Planned for counter-thesis generation and scenario analysis.",
  },
  {
    id: "chatgpt",
    apiModel: "openai/gpt-5-mini",
    analysisCredits: 3,
    analysisPriceUsd: 0.03,
    provider: "OpenAI",
    name: "ChatGPT",
    short: "◎",
    color: "#c9f4e5",
    specialty: "Decision copilot",
    description: "Planned for concise trade explanations and risk summaries.",
  },
  {
    id: "claude",
    apiModel: "anthropic/claude-haiku-4.5",
    analysisCredits: 4,
    analysisPriceUsd: 0.04,
    provider: "Anthropic",
    name: "Claude",
    short: "AI",
    color: "#f2d6bd",
    specialty: "Long-context reviewer",
    description: "Planned for detailed market rules and evidence review.",
  },
] as const;

export type AdvisorModelId = (typeof advisorModels)[number]["id"];

export function isAdvisorModel(value: string): value is AdvisorModelId {
  return advisorModels.some((model) => model.id === value);
}

export function getAdvisorModel(id: AdvisorModelId) {
  return advisorModels.find((model) => model.id === id) ?? advisorModels[0];
}
