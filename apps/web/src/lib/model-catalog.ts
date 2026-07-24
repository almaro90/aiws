import type { ModelCatalog } from "./types.ts";

export function catalogSelection(
  models: ModelCatalog["models"],
  modelId: string,
  reasoningEffort: string,
): { readonly modelId: string; readonly reasoningEffort: string } | null {
  const model =
    models.find((candidate) => candidate.id === modelId) ??
    models.find((candidate) => candidate.isDefault) ??
    models[0];
  if (model === undefined) return null;
  return {
    modelId: model.id,
    reasoningEffort: model.supportedReasoningEfforts.includes(reasoningEffort)
      ? reasoningEffort
      : model.defaultReasoningEffort,
  };
}
