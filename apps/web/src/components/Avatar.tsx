import { useState } from 'react';

/**
 * A user's picture (decision.md D-071), or their initial when there is none (or it fails to load).
 * `glow` is the blue ring that marks you, as in the battle bar (D-068).
 */
export function Avatar(props: {
  username: string;
  url: string | null | undefined;
  size: number;
  glow?: boolean;
  /** The glow's colour; azure unless the surrounding card is green. */
  tone?: 'azure' | 'emerald';
  className?: string;
}) {
  const { username, url, size, glow, tone = 'azure', className = '' } = props;
  const [broken, setBroken] = useState<string | null>(null);
  const showImage = !!url && broken !== url;
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.4) }}
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold uppercase ${
        glow
          ? tone === 'emerald'
            ? 'bg-emerald-400/15 text-emerald-300 ring-2 ring-emerald-400/70 shadow-[0_0_14px_0_rgb(52_211_153/0.32)]'
            : 'bg-azure/15 text-azure ring-2 ring-azure/70 shadow-[0_0_14px_0_rgb(92_184_255/0.32)]'
          : 'bg-white/[0.07] text-ash-300 ring-1 ring-white/10'
      } ${className}`}
    >
      {showImage ? (
        <img
          src={url}
          alt=""
          width={size}
          height={size}
          onError={() => setBroken(url)}
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        username[0]
      )}
    </span>
  );
}
