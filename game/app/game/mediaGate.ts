/**
 * Only hold media at the cue currently waiting for hardware.  G01 additionally
 * starts closed because its very first frame is itself the cue boundary.
 */
export function shouldHoldCueMedia({
  hapticGatedMode,
  eventId,
  mediaGateOpen,
  cueHeld,
}: {
  hapticGatedMode: boolean;
  eventId: string;
  mediaGateOpen: boolean;
  cueHeld: boolean;
}) {
  return hapticGatedMode && (cueHeld || (eventId === "G01" && !mediaGateOpen));
}
