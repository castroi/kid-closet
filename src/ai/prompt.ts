/**
 * The instruction sent with the three pictures: 1 = the doll, 2 = the upper garment
 * (the shirt, or the layer when there is one), 3 = the trousers. The parent can replace
 * it in the parent area; null in the settings means this one.
 */
export const DEFAULT_PROMPT =
  "Dress the doll from image 1 in the upper garment from image 2 and the bottom from image 3. Keep the doll exactly unchanged: same face, hair, body, pose, hands, feet, background, lighting, camera angle and framing as image 1. Copy both garments faithfully from their photos: exact colors, fabric texture, pattern, print, logo position, sleeve length, leg length, waistband and drawstrings. Do not change any garment's color, length or cut. Show the fabric smooth, without the wrinkles from the photos. The doll's grey base clothing must be completely hidden. Output only the dressed doll, no text.";

export function effectivePrompt(prompt: string | null): string {
  return prompt?.trim() ? prompt : DEFAULT_PROMPT;
}
