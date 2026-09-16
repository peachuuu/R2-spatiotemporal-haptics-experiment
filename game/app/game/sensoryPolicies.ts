import type { ConditionId, HapticBinding, SensoryPolicy } from "./types";

export const sensoryPolicies: Record<ConditionId, SensoryPolicy> = {
  NH: {
    conditionId: "NH",
    hapticDelivery: "disabled",
    hapticVariant: "none",
    futurePatternKey: "none",
  },
  BH: {
    conditionId: "BH",
    hapticDelivery: "adapter-reserved",
    hapticVariant: "basic",
    futurePatternKey: "body-generic",
  },
  STH: {
    conditionId: "STH",
    hapticDelivery: "adapter-reserved",
    hapticVariant: "spatiotemporal",
    futurePatternKey: "spatiotemporal",
  },
};

export function resolveHapticBinding(
  conditionId: ConditionId,
  sampleKey: string,
): HapticBinding {
  const policy = sensoryPolicies[conditionId];
  return {
    conditionId,
    variant: policy.hapticVariant,
    sampleKey,
    adapterKey: `${conditionId}:${sampleKey}`,
    enabled: false,
  };
}
