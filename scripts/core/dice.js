/**
 * Waiting for 3D dice (Dice So Nice): nothing that follows a roll should show before the dice land.
 * Resolves at once when the module is not active or the message has no animation.
 */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function waitForDice(messageId, { timeout = 12000 } = {}) {
  const dice3d = game.modules.get("dice-so-nice")?.active ? game.dice3d : null;
  if (!dice3d || typeof dice3d.waitFor3DAnimationByMessageID !== "function" || !messageId) return;
  try {
    await Promise.race([dice3d.waitFor3DAnimationByMessageID(messageId), sleep(timeout)]);
  } catch (err) {
    // No animation for this message: carry on.
  }
}
