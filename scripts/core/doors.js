/**
 * Shared access to Foundry's door icons (V14: foundry.canvas.containers.DoorControl).
 * Used by Door Icon Size, Secret Door Highlight and Locked Door Alert.
 */

export function doorControlClass() {
  return foundry.canvas?.containers?.DoorControl ?? globalThis.DoorControl ?? null;
}

/** Every door icon on the current canvas. */
export function doorControls() {
  return [...(canvas?.controls?.doors?.children ?? [])].filter(c => c?.wall);
}

/** The door icon of a wall on the current canvas, or null. */
export function doorControlOf(wallId) {
  return canvas?.walls?.get?.(wallId)?.doorControl ?? doorControls().find(c => c.wall?.id === wallId) ?? null;
}
