/**
 * Recommendation Service
 *
 * Contains logic for heuristic recommendations used as baselines
 * by the Adaptive Engine.
 */
import { EnergyLevel } from "@/types";
import { normalizeTask } from "@/utils/task";
import { roundToNearest5 } from "@/utils/time";

export interface FocusRecommendation {
  focusDuration: number;
  breakDuration: number;
}

const baseRecommendationsByEnergy: Record<EnergyLevel, FocusRecommendation> = {
  low: { focusDuration: 15, breakDuration: 5 },
  mid: { focusDuration: 25, breakDuration: 5 },
  high: { focusDuration: 35, breakDuration: 10 },
  "": { focusDuration: 25, breakDuration: 5 },
};

const shortSessionTasks = ["meditating", "planning"];

/**
 * Get heuristic recommendations based on energy level and task type.
 * Used as a starting point before the adaptive engine has enough data.
 */
export async function getRecommendations(
  energyLevel: EnergyLevel,
  taskType?: string,
  includeShortSessions: boolean = false,
): Promise<FocusRecommendation> {
  const recommendation = { ...baseRecommendationsByEnergy[energyLevel] };

  if (includeShortSessions) {
    recommendation.focusDuration = Math.min(30, recommendation.focusDuration);
    recommendation.breakDuration = Math.min(5, recommendation.breakDuration);
  }

  if (taskType) {
    const normalizedTask = normalizeTask(taskType);
    if (shortSessionTasks.includes(normalizedTask)) {
      recommendation.focusDuration = roundToNearest5(
        recommendation.focusDuration * 0.8,
      );
    }
  }

  recommendation.focusDuration = Math.min(
    120,
    Math.max(5, roundToNearest5(recommendation.focusDuration)),
  );

  recommendation.breakDuration =
    recommendation.breakDuration <= 1
      ? 5
      : Math.min(
          20,
          Math.max(5, roundToNearest5(recommendation.breakDuration)),
        );

  return recommendation;
}
