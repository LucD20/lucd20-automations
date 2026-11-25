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

/**
 * Local-space box of a DoorControl's icon sprite (handles top-left or centered
 * anchors, non-zero offsets, and any base icon size).
 */
export function doorIconBox(control, fallback = 40) {
  const icon = control?.icon;
  const w = icon?.width > 0 ? icon.width : fallback;
  const h = icon?.height > 0 ? icon.height : fallback;
  const ax = icon?.anchor?.x ?? 0;
  const ay = icon?.anchor?.y ?? 0;
  const x = (icon?.x ?? 0) - ax * w;
  const y = (icon?.y ?? 0) - ay * h;
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

