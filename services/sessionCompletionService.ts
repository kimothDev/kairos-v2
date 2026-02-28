/**
 * Session Completion Service
 *
 * Orchestrates the final steps of a focus session, including saving to DB
 * and updating the Adaptive Engine.
 */
import { MIN_SESSION_FOR_SAVE } from "@/constants/timer";
import { recordSession } from "@/services/adaptiveEngine";
import {
    createAndSaveSession,
    loadSessionsFromDB,
} from "@/services/sessionService";
import { EnergyLevel } from "@/types";
import {
    detectTimeOfDay,
    secondsToMinutes,
} from "@/utils/sessionUtils";

export type CompletionType = "completed" | "skippedFocus" | "skippedBreak";

export interface SessionCompletionParams {
  type: CompletionType;
  taskType: string;
  energyLevel: EnergyLevel;
  recommendedFocusDuration: number;
  recommendedBreakDuration: number;
  userAcceptedRecommendation: boolean;
  originalFocusDuration: number; // in seconds
  selectedBreakDuration: number; // in seconds
  focusedTime: number; // actual focused time in seconds (for skips)
}

/**
 * Complete a session - handles all 3 completion types.
 */
export async function completeSession(
  params: SessionCompletionParams,
): Promise<void> {
  const {
    type,
    taskType,
    energyLevel,
    recommendedFocusDuration,
    recommendedBreakDuration,
    userAcceptedRecommendation,
    originalFocusDuration,
    selectedBreakDuration,
    focusedTime,
  } = params;

  const focusTimeInMinutes = secondsToMinutes(focusedTime);
  const totalFocusDuration = secondsToMinutes(originalFocusDuration);
  const breakTimeInMinutes = secondsToMinutes(selectedBreakDuration);

  // LOG SUMMARY: Explanatory view of the session choices
  const choiceStatus = userAcceptedRecommendation
    ? "TRUSTED: User followed the Recommendation."
    : "CUSTOMIZED: User picked their own duration.";

  console.log(`\n--- 📊 Session Summary ---`);
  console.log(
    `Type: ${type.toUpperCase()} | Task: ${taskType} | Energy: ${energyLevel}`,
  );
  console.log(
    `Duration: ${totalFocusDuration}min (Target was ${recommendedFocusDuration}min)`,
  );
  console.log(`Status: ${choiceStatus}`);
  console.log(`--------------------------\n`);

  // Skip saving sessions that are too short (likely accidental starts)
  // Only applies to skipped sessions - completed sessions always get saved
  if (type !== "completed" && focusedTime < MIN_SESSION_FOR_SAVE) {
    console.log(
      `[AdaptiveEngine] Skipping save: Session was only ${focusedTime}s. Too short to be useful.`,
    );
    return;
  }

  const sessionCompleted = type === "completed";
  const skipReason =
    type === "skippedFocus"
      ? "skippedFocus"
      : type === "skippedBreak"
        ? "skippedBreak"
        : undefined;

  // Create and save session to DB
  await createAndSaveSession({
    taskType,
    energyLevel,
    timeOfDay: detectTimeOfDay(),
    recommendedDuration: recommendedFocusDuration,
    recommendedBreak: recommendedBreakDuration,
    userSelectedDuration: totalFocusDuration,
    userSelectedBreak: sessionCompleted ? breakTimeInMinutes : 0,
    acceptedRecommendation: userAcceptedRecommendation,
    sessionCompleted,
    focusedUntilSkipped: focusTimeInMinutes,
    reward: 0, // Legacy DB column
    date: new Date().toISOString().split("T")[0],
    createdAt: new Date().toISOString(),
    skipReason,
  });

  // Update Adaptive Engine
  await recordSession(
    { taskType, energyLevel },
    totalFocusDuration,
    focusTimeInMinutes,
    sessionCompleted
  );
}

/**
 * Load sessions from database.
 */
export async function loadSessions(): Promise<import("@/types").Session[]> {
  return loadSessionsFromDB();
}
