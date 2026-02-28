import JSZip from 'jszip';

type EnergyLevel = "low" | "mid" | "high";
type TimeOfDay = "morning" | "afternoon" | "evening";

interface DBSession {
  id: number;
  taskType: string;
  energyLevel: EnergyLevel;
  timeOfDay: TimeOfDay;
  recommendedDuration: number;
  recommendedBreak: number;
  userSelectedDuration: number;
  userSelectedBreak: number;
  acceptedRecommendation: boolean;
  sessionCompleted: boolean;
  focusedUntilSkipped: number;
  reward: number; // legacy
  date: string; // YYYY-MM-DD
  createdAt: string; // ISOstring
  skipReason: string;
}

const getPastDateTimeString = (daysAgo: number, hour: number, minute: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

const getPastDateString = (daysAgo: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, '0') + "-" + String(d.getDate()).padStart(2, '0');
};

const generateMockupSessions = (): DBSession[] => {
  console.log("Generating sessions...");
  const sessions: DBSession[] = [];
  let idCounter = 1;

  const taskProfiles = [
    { type: "Coding", energy: "high" as EnergyLevel, baseDuration: 55, completionRate: 0.8 },
    { type: "Coding", energy: "mid" as EnergyLevel, baseDuration: 35, completionRate: 0.85 },
    { type: "Writing", energy: "mid" as EnergyLevel, baseDuration: 40, completionRate: 0.7 },
    { type: "Research", energy: "low" as EnergyLevel, baseDuration: 20, completionRate: 0.95 },
  ];

  for (let daysAgo = 30; daysAgo >= 0; daysAgo--) {
    if (Math.random() < 0.2) continue; // 20% chance of a rest day

    const sessionsToday = Math.floor(Math.random() * 4) + 1; // 1-4 sessions per day
    let currentHour = 8; // Start around 8 AM

    for (let s = 0; s < sessionsToday; s++) {
      const profile = taskProfiles[Math.floor(Math.random() * taskProfiles.length)];
      
      const isCompleted = Math.random() < profile.completionRate;
      const recommendedDuration = profile.baseDuration;
      
      const actualDuration = isCompleted 
        ? recommendedDuration 
        : Math.max(5, Math.floor(recommendedDuration * (0.3 + Math.random() * 0.5)));

      currentHour += Math.floor(Math.random() * 2) + 1;
      if (currentHour > 22) currentHour = 22;
      
      const timeOfDay = currentHour < 12 ? "morning" : currentHour < 17 ? "afternoon" : "evening";
      
      sessions.push({
        id: idCounter++,
        taskType: profile.type,
        energyLevel: profile.energy,
        timeOfDay,
        recommendedDuration,
        recommendedBreak: Math.floor(recommendedDuration / 3),
        userSelectedDuration: recommendedDuration,
        userSelectedBreak: isCompleted ? Math.floor(recommendedDuration / 3) : 0,
        acceptedRecommendation: true,
        sessionCompleted: isCompleted,
        focusedUntilSkipped: actualDuration,
        reward: 0,
        date: getPastDateString(daysAgo),
        createdAt: getPastDateTimeString(daysAgo, currentHour, Math.floor(Math.random() * 60)),
        skipReason: isCompleted ? "none" : (Math.random() > 0.5 ? "skippedFocus" : "skippedBreak"),
      });
    }
  }

  return sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
};

const generateMockupAdaptiveState = () => {
  const now = Date.now();
  return {
    "Coding|high": { 
      ewma: 52.4, 
      completionRate: 0.8,
      history: [
        { duration: 55, actualFocusTime: 55, completed: true, timestamp: now - 86400000 },
        { duration: 55, actualFocusTime: 55, completed: true, timestamp: now }
      ]
    },
    "Coding|mid": { 
      ewma: 34.1, 
      completionRate: 0.85,
      history: [
        { duration: 35, actualFocusTime: 35, completed: true, timestamp: now - 86400000 },
        { duration: 35, actualFocusTime: 35, completed: true, timestamp: now }
      ]
    },
    "Writing|mid": { 
      ewma: 38.1, 
      completionRate: 0.7,
      history: [
        { duration: 40, actualFocusTime: 40, completed: true, timestamp: now - 86400000 },
        { duration: 40, actualFocusTime: 40, completed: true, timestamp: now }
      ]
    },
    "Research|low": { 
      ewma: 22.0, 
      completionRate: 0.95,
      history: [
        { duration: 20, actualFocusTime: 20, completed: true, timestamp: now - 86400000 },
        { duration: 20, actualFocusTime: 20, completed: true, timestamp: now }
      ]
    }
  };
};

const run = async () => {
  const sessions = generateMockupSessions();
  const adaptiveState = generateMockupAdaptiveState();
  const settings = { state: { theme: 'dark', soundEnabled: true, hapticsEnabled: true }, version: 1 };

  const zip = new JSZip();
  zip.file("sessions.json", JSON.stringify(sessions, null, 2));
  zip.file("adaptive_engine_state.json", JSON.stringify(adaptiveState, null, 2));
  zip.file("settings.json", JSON.stringify(settings, null, 2));

  const content = await zip.generateAsync({ type: "nodebuffer" });
  
  const fs = require('fs');
  const path = require('path');
  const outPath = path.resolve(__dirname, '../assets/kairos_mock_backup.zip');
  
  fs.writeFileSync(outPath, content);
  
  console.log(`Generated ${sessions.length} sessions and state into ${outPath}.`);
};

run();
