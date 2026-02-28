/**
 * Adaptive Engine
 *
 * A simplified, robust learning system that replaces the Thompson Sampling RL engine.
 * Instead of exploration/exploitation, it uses an Exponentially Weighted Moving Average (EWMA)
 * of successfully completed sessions, layered with deterministic burnout protection rules.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { EnergyLevel } from "@/types";
import { getRecommendations } from "./recommendations";
import { roundToNearest5 } from "@/utils/time";

export const ADAPTIVE_STORAGE_KEY = "adaptive_engine_state_v1";
export const EWMA_ALPHA = 0.3; // Recent sessions carry ~30% weight
export const MIN_COMPLETION_RATE = 0.6; // Below this, blend in actual durations
export const HISTORY_LIMIT = 20; // Keep last 20 sessions per context

// ============================================================================
// TYPES
// ============================================================================

export interface Context {
  taskType: string;
  energyLevel: EnergyLevel;
}

export interface SessionRecord {
  duration: number; // The target duration
  actualFocusTime: number; // How long they actually lasted
  completed: boolean; // Did they finish the target?
  timestamp: number;
}

export interface ContextStats {
  history: SessionRecord[];
  ewma: number; // The current learned baseline
  completionRate: number; // Over the history window
}

export interface AdaptiveState {
  [contextKey: string]: ContextStats;
}

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

export async function loadAdaptiveState(): Promise<AdaptiveState> {
  try {
    const data = await AsyncStorage.getItem(ADAPTIVE_STORAGE_KEY);
    return data ? JSON.parse(data) : {};
  } catch (error) {
    console.error("[AdaptiveEngine] Failed to load state", error);
    return {};
  }
}

export async function saveAdaptiveState(state: AdaptiveState): Promise<void> {
  try {
    await AsyncStorage.setItem(ADAPTIVE_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("[AdaptiveEngine] Failed to save state", error);
  }
}

export function createContextKey(context: Context): string {
  return `${context.taskType}|${context.energyLevel}`;
}

// ============================================================================
// CORE LEARNING ENGINE
// ============================================================================

/**
 * Record a session and update the learned EWMA.
 */
export async function recordSession(
  context: Context,
  duration: number,
  actualFocusTime: number,
  completed: boolean
): Promise<void> {
  const state = await loadAdaptiveState();
  const key = createContextKey(context);

  if (!state[key]) {
    state[key] = { history: [], ewma: 0, completionRate: 0 };
  }

  const stats = state[key];

  // Add new record
  stats.history.push({ duration, actualFocusTime, completed, timestamp: Date.now() });
  
  // Keep window size fixed
  if (stats.history.length > HISTORY_LIMIT) {
    stats.history = stats.history.slice(-HISTORY_LIMIT);
  }

  // Calculate completion rate
  const completedCount = stats.history.filter((s) => s.completed).length;
  stats.completionRate = completedCount / stats.history.length;

  // Calculate new EWMA
  // If completion rate < 60%, they are struggling. Use actualFocusTime for ALL sessions to pull the average down to reality.
  // If playing normally (>= 60%), only use completed durations so occasional failures don't drop the baseline.
  const useActualTimes = stats.completionRate < MIN_COMPLETION_RATE;
  
  const relevantSessions = useActualTimes 
    ? stats.history 
    : stats.history.filter(s => s.completed);

  if (relevantSessions.length > 0) {
    const values = relevantSessions.map(s => useActualTimes ? s.actualFocusTime : s.duration);
    
    // Calculate EWMA array-style
    let ewma = values[0];
    for (let i = 1; i < values.length; i++) {
      ewma = (EWMA_ALPHA * values[i]) + ((1 - EWMA_ALPHA) * ewma);
    }
    stats.ewma = ewma;
  }

  console.log(`[AdaptiveEngine] Updated ${key}: EWMA=${stats.ewma.toFixed(1)}, CR=${(stats.completionRate*100).toFixed(0)}%`);
  await saveAdaptiveState(state);
}

// ============================================================================
// BURNOUT PROTECTION RULES
// ============================================================================

/**
 * Calculate fatigue multiplier based on today's total focus minutes.
 * Starts dropping after 120 minutes. Floor at 0.6x.
 */
export function getDailyFatigueMultiplier(todayTotalMinutes: number): number {
  if (todayTotalMinutes <= 120) return 1.0;
  // Linearly scale from 1.0 at 120m down to 0.6 at 300+m
  const maxDrop = 0.4;
  const minutesOverThreshold = Math.max(0, todayTotalMinutes - 120);
  const drop = Math.min(maxDrop, (minutesOverThreshold / 180) * maxDrop);
  return 1.0 - drop;
}

/**
 * Applies a penalty if the user starts a new session too soon after the last one.
 */
export function getConsecutiveSessionPenalty(lastSessionEndTime: number, recommendedBreak: number): number {
  if (!lastSessionEndTime) return 1.0;
  
  const minutesSinceLast = Math.max(0, (Date.now() - lastSessionEndTime) / 60000);
  if (minutesSinceLast >= recommendedBreak) return 1.0; // Rested enough

  // Penalty grows as the gap approaches 0
  const restRatio = minutesSinceLast / recommendedBreak;
  return 0.8 + (0.2 * restRatio); // 0.8x if instant restart, up to 1.0x if taken full break
}

/**
 * Ramp-up multiplier for returning users (days off rest).
 */
export function getRestDayMultiplier(daysSinceLastSession: number): number {
  if (daysSinceLastSession >= 3) return 0.8; // Ease back in after 3+ days off
  return 1.0;
}

/**
 * If the user has completed many sessions at the exact same duration, nudge them.
 */
export function getStretchNudge(stats: ContextStats): number {
  if (stats.history.length < 5 || stats.completionRate < 0.8) return 0;
  
  const recent = stats.history.slice(-5);
  const baseline = recent[0].duration;
  
  // Are they plateauing?
  const isPlateau = recent.every(s => s.completed && Math.abs(s.duration - baseline) <= 5);
  
  if (isPlateau) {
    if (recent.length >= 10 && stats.completionRate > 0.9) return 10;
    return 5;
  }
  return 0;
}

// ============================================================================
// RECOMMENDATION API
// ============================================================================

export interface RecommendationResult {
  value: number;
  source: "heuristic" | "learned" | "fatigue-adjusted" | "stretch";
}

export async function getRecommendation(
  context: Context,
  heuristicRecommendation: number,
  todayTotalMinutes: number = 0,
  lastSessionEndTime: number = 0,
  daysSinceLastSession: number = 0,
  includeShortSessions: boolean = false
): Promise<RecommendationResult> {
  const state = await loadAdaptiveState();
  const key = createContextKey(context);
  const stats = state[key];

  console.log(`\n=== Adaptive Recommendation ===`);
  console.log(`Context: ${key} | Heuristic: ${heuristicRecommendation}m`);

  // 1. BASELINE: Heuristic or Learned
  let baseValue = heuristicRecommendation;
  let source: RecommendationResult["source"] = "heuristic";

  const hasEnoughHistory = stats && stats.history.length >= 2;
  
  if (hasEnoughHistory && stats.ewma > 0) {
    baseValue = stats.ewma;
    source = "learned";
    console.log(`[AdaptiveEngine] Baseline: Learned EWMA (${baseValue.toFixed(1)}m)`);
  } else {
    console.log(`[AdaptiveEngine] Baseline: Heuristic (${baseValue.toFixed(1)}m) - Not enough history or no EWMA`);
  }

  // 2. STRETCH NUDGE
  if (hasEnoughHistory) {
    const nudge = getStretchNudge(stats);
    if (nudge > 0) {
      baseValue += nudge;
      source = "stretch";
      console.log(`[AdaptiveEngine] Applied stretch nudge +${nudge}m`);
    }
  }

  // 3. BURNOUT PROTECTION (Fatigue, Cooldown, Ramp-up)
  const fatigueMult = getDailyFatigueMultiplier(todayTotalMinutes);
  const cooldownMult = getConsecutiveSessionPenalty(lastSessionEndTime, Math.max(5, baseValue / 3));
  const restMult = getRestDayMultiplier(daysSinceLastSession);

  const aggregateMultiplier = fatigueMult * cooldownMult * restMult;
  
  console.log(`[AdaptiveEngine] Multipliers -> Fatigue: ${fatigueMult.toFixed(2)}x, Cooldown: ${cooldownMult.toFixed(2)}x, Rest: ${restMult.toFixed(2)}x`);

  if (aggregateMultiplier < 1.0) {
    const original = baseValue;
    baseValue *= aggregateMultiplier;
    source = "fatigue-adjusted";
    console.log(`[AdaptiveEngine] Protection triggered: ${original.toFixed(1)}m * ${(aggregateMultiplier).toFixed(2)}x (aggregate) = ${baseValue.toFixed(1)}m`);
  }

  // 4. CLAMP AND ROUND
  // Cap between 5m and 120m, round to 5s. If ADHD mode, cap at 30m.
  let finalValue = roundToNearest5(baseValue);
  const maxCap = includeShortSessions ? 30 : 120;
  finalValue = Math.max(5, Math.min(maxCap, finalValue));

  console.log(`[AdaptiveEngine] Rounding & Clamping -> Rounded: ${roundToNearest5(baseValue)}m, ADHD Mode: ${includeShortSessions}, Cap: ${maxCap}m`);
  console.log(`Result: ${finalValue}m (${source})\n`);
  return { value: finalValue, source };
}

export function getBreakRecommendation(focusDuration: number): number {
  // Same logic as before: max break is focus ÷ 3, min 5
  return Math.max(5, roundToNearest5(focusDuration / 3));
}

// ============================================================================
// EXPORT / IMPORT
// ============================================================================

export async function exportAdaptiveState(): Promise<AdaptiveState> {
  return await loadAdaptiveState();
}

export async function importAdaptiveState(data: AdaptiveState): Promise<void> {
  if (data) {
    await saveAdaptiveState(data);
    console.log("[AdaptiveEngine] Imported state backup");
  }
}
