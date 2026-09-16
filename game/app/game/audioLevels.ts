export const AUDIO_VOLUME = {
  g01Unlock: 1,
  g01Enter: 1,
  g02Hero: 1,
  g02Boss: 1,
  g02Rubble: 1,
  g03Cast: 1,
  g03Fire: 1,
  g04Ghost: 1,
  chestCue: 1,
  ridgeTrace: 1,
  chestOpen: 1,
  projectileFast: 1,
  projectileSlow: 1,
  areaFast: 1,
  areaSlow: 1,
  areaImpact: 1,
  rain: 1,
  fireworks: 1,
} as const;

export function setAudioVolume(node: HTMLAudioElement | null, volume: number) {
  if (node) node.volume = Math.max(0, Math.min(1, volume));
}
