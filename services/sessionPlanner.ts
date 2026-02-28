/**
 * Session Planner
 *
 * High-level service that orchestrates session recommendations by combining
 * heuristic (rule-based) logic with the Adaptive Engine.
 */
import { EnergyLevel } from "@/types";
import { FocusRecommendation, getRecommendations } from "./recommendations";
import { getRecommendation, getBreakRecommendation, Context } from "./adaptiveEngine";
import { getAllSessions } from "./database";

/**
 * Get a complete session recommendation, combining
 * rule-based logic with the adaptive learning system.
 *
 * @param energyLevel - User's current energy level
 * @param taskType - Type of task being performed
 * @param dynamicFocusArms - Custom focus durations added by user (unused in new engine but kept for API compat)
 * @param includeShortSessions - Whether to use ADHD mode fast sessions
 * @returns { focusDuration, breakDuration } both in minutes
 */
export async function getSessionRecommendation(
  energyLevel: EnergyLevel,
  taskType: string,
  dynamicFocusArms: number[] = [],
  includeShortSessions: boolean = false,
): Promise<FocusRecommendation> {
  const context: Context = {
    energyLevel,
    taskType: taskType || "default",
  };

  // Get base recommendation from rule-based system
  const baseRecommendation = await getRecommendations(
    energyLevel,
    taskType,
    includeShortSessions,
  );

  // Compute burnout protection metrics from session history
  let todayTotalMinutes = 0;
  let lastSessionEndTime = 0;
  let daysSinceLastSession = 0;

  try {
    const sessions = await getAllSessions();
    if (sessions.length > 0) {
      const todayStr = new Date().toISOString().split("T")[0];
      todayTotalMinutes = sessions
        .filter((s) => s.date === todayStr && s.sessionCompleted)
        .reduce((acc, s) => acc + s.focusedUntilSkipped, 0);

      const lastSession = sessions[0]; // They are sorted DESC by createdAt
      const lastSessionStart = new Date(lastSession.createdAt).getTime();
      lastSessionEndTime = lastSessionStart + (lastSession.focusedUntilSkipped * 60000);
      
      // Calculate midnight-to-midnight days difference, or just simple 24h chunk
      const msPerDay = 1000 * 60 * 60 * 24;
      daysSinceLastSession = Math.floor((Date.now() - lastSessionStart) / msPerDay);
    }
  } catch (error) {
    console.error("Error fetching sessions for planner:", error);
  }

  // Get smart recommendation from Adaptive Engine
  const smartFocus = await getRecommendation(
    context,
    baseRecommendation.focusDuration,
    todayTotalMinutes,
    lastSessionEndTime,
    daysSinceLastSession,
    includeShortSessions
  );

  // Get smart break - deterministic scale of focus duration
  const smartBreakStr = getBreakRecommendation(smartFocus.value);

  return {
    focusDuration: smartFocus.value,
    breakDuration: smartBreakStr,
  };
}
