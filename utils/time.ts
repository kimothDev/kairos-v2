//utility to round minutes to the nearest 5
export function roundToNearest5(minutes: number): number {
  return Math.round(minutes / 5) * 5;
} 