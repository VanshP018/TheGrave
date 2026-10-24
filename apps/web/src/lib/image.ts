import { AVATAR_MAX_BYTES } from '@thegrave/shared';

/**
 * Turns any picture the browser can decode into a small square avatar (decision.md D-071): centre-cropped,
 * 256×256, WebP where the browser can encode it, else JPEG. Re-encoding also strips metadata (EXIF, GPS).
 */
export async function toAvatarDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That file isn’t an image the browser can read'));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      img,
      (img.naturalWidth - side) / 2,
      (img.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      256,
      256,
    );
    for (const [type, quality] of [
      ['image/webp', 0.86],
      ['image/jpeg', 0.86],
      ['image/jpeg', 0.7],
    ] as const) {
      const data = canvas.toDataURL(type, quality);
      // Browsers that can't encode a type silently return PNG; only accept what we asked for.
      if (data.startsWith(`data:${type}`) && (data.length * 3) / 4 < AVATAR_MAX_BYTES) return data;
    }
    throw new Error('Could not shrink that image enough, try another one');
  } finally {
    URL.revokeObjectURL(url);
  }
}
