/**
 * Adaptive Engine Tests
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getRecommendation,
  recordSession,
  getBreakRecommendation,
} from "../adaptiveEngine";

// Mock AsyncStorage
const mockStorage: Record<string, string> = {};
jest.mock("@react-native-async-storage/async-storage", () => ({
  setItem: jest.fn((key, value) => {
    mockStorage[key] = value;
    return Promise.resolve();
  }),
  getItem: jest.fn((key) => Promise.resolve(mockStorage[key] || null)),
  clear: jest.fn(() => {
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
    return Promise.resolve();
  }),
  removeItem: jest.fn((key) => {
    delete mockStorage[key];
    return Promise.resolve();
  }),
}));

describe("Adaptive Engine", () => {
  const context = { taskType: "coding", energyLevel: "mid" as const };

  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  describe("Core Learning (EWMA)", () => {
    it("returns heuristic when there is no data", async () => {
      const rec = await getRecommendation(context, 25);
      expect(rec.value).toBe(25);
      expect(rec.source).toBe("heuristic");
    });

    it("learns from completed sessions using EWMA", async () => {
      // User does 50m
      await recordSession(context, 50, 50, true);
      
      // Need at least 2 sessions to switch to 'learned'
      let rec = await getRecommendation(context, 25);
      expect(rec.source).toBe("heuristic");

      // User does 50m again
      await recordSession(context, 50, 50, true);
      rec = await getRecommendation(context, 25);
      expect(rec.source).toBe("learned");
      expect(rec.value).toBe(50); // Floor/ceil logic rounds to 50

      // User does 60m
      await recordSession(context, 60, 60, true);
      rec = await getRecommendation(context, 25);
      
      // EWMA: 0.3 * 60 + 0.7 * 50 = 18 + 35 = 53 -> rounded to 55
      expect(rec.value).toBe(55);
    });

    it("defaults to actual focus time if completion rate is low", async () => {
      // 3 failed sessions at 60m, but they only focused for 20m
      await recordSession(context, 60, 20, false);
      await recordSession(context, 60, 20, false);
      await recordSession(context, 60, 20, false);

      const rec = await getRecommendation(context, 25);
      // Since completion rate is 0%, it should use the actual times (20m)
      expect(rec.source).toBe("learned");
      expect(rec.value).toBe(20);
    });
  });

  describe("Burnout Protection", () => {
    it("scales down when daily fatigue is high", async () => {
      // Establish baseline of 60m
      for (let i = 0; i < 3; i++) await recordSession(context, 60, 60, true);

      // Normal day (120m) - no penalty
      const normalRec = await getRecommendation(context, 25, 120);
      expect(normalRec.value).toBe(60);
      expect(normalRec.source).toBe("learned");

      // Fatigued day (300m) - max penalty (0.6x)
      // 60 * 0.6 = 36 -> rounded to 35
      const fatigueRec = await getRecommendation(context, 25, 300);
      expect(fatigueRec.value).toBe(35);
      expect(fatigueRec.source).toBe("fatigue-adjusted");
    });

    it("applies cooldown penalty for back-to-back sessions", async () => {
      for (let i = 0; i < 3; i++) await recordSession(context, 60, 60, true);

      // Gap of 20 minutes (recommended break is 20m for 60m focus)
      let rec = await getRecommendation(context, 25, 0, Date.now() - 20 * 60000);
      expect(rec.value).toBe(60);

      // Instant restart (0 minutes break) -> 0.8x penalty
      // 60 * 0.8 = 48 -> rounded to 50
      rec = await getRecommendation(context, 25, 0, Date.now() - 1000); // 1 sec ago
      expect(rec.value).toBe(50);
      expect(rec.source).toBe("fatigue-adjusted");
    });

    it("ramps up slowly after rest days", async () => {
      for (let i = 0; i < 3; i++) await recordSession(context, 60, 60, true);

      // 4 days since last session -> 0.8x penalty
      // 60 * 0.8 = 48 -> 50
      const rec = await getRecommendation(context, 25, 0, 0, 4);
      expect(rec.value).toBe(50);
      expect(rec.source).toBe("fatigue-adjusted");
    });
  });

  describe("Stretch Nudge", () => {
    it("applies a stretch nudge when plateauing", async () => {
      // 5 successful sessions at exactly 40m
      for (let i = 0; i < 5; i++) await recordSession(context, 40, 40, true);

      const rec = await getRecommendation(context, 25);
      // Nudge is +5 -> 45
      expect(rec.value).toBe(45);
      expect(rec.source).toBe("stretch");
    });

    it("applies a larger stretch nudge when plateauing for 10 sessions", async () => {
      for (let i = 0; i < 10; i++) await recordSession(context, 40, 40, true);

      const rec = await getRecommendation(context, 25);
      // Nudge is +10 -> 50
      expect(rec.value).toBe(50);
      expect(rec.source).toBe("stretch");
    });

    it("does not nudge if they recently failed a session", async () => {
      for (let i = 0; i < 4; i++) await recordSession(context, 40, 40, true);
      // One failure at 40
      await recordSession(context, 40, 20, false);

      const rec = await getRecommendation(context, 25);
      // Completion rate is too low for a stretch nudge
      expect(rec.source).not.toBe("stretch");
    });
  });

  describe("Break Recommendations", () => {
    it("scales break to roughly focus / 3", () => {
      expect(getBreakRecommendation(15)).toBe(5);
      expect(getBreakRecommendation(25)).toBe(10); // 25/3 = 8.33 -> 10
      expect(getBreakRecommendation(45)).toBe(15);
      expect(getBreakRecommendation(60)).toBe(20);
    });

    it("clamps minimum break to 5 minutes", () => {
      expect(getBreakRecommendation(5)).toBe(5);
      expect(getBreakRecommendation(10)).toBe(5);
    });
  });
});
