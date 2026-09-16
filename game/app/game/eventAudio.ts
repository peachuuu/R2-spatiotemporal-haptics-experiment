/** A reusable audio component must replay when the timeline enters a new event. */
export function shouldStartEventAudio({
  eventId,
  previouslyPlayedEventId,
  hapticGateHeld,
}: {
  eventId: string;
  previouslyPlayedEventId: string | undefined;
  hapticGateHeld: boolean;
}) {
  return !hapticGateHeld && previouslyPlayedEventId !== eventId;
}
