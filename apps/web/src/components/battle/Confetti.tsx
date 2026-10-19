import { useEffect, useRef } from 'react';

const COLORS = ['#5cb8ff', '#a8dbff', '#2b7fd9', '#f5f5f4', '#8fd0ff', '#34d399'];
const DURATION_MS = 3200;

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rot: number;
  vr: number;
  wobble: number;
  vw: number;
  color: string;
  round: boolean;
}

/**
 * A one-shot confetti burst on a full-screen canvas (no dependency): two cannons from the bottom corners
 * plus a pop from the centre. Skipped entirely under reduced motion; calls `onDone` when the last piece falls.
 */
export function Confetti({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      done.current();
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const pieces: Piece[] = [];
    const burst = (
      x: number,
      y: number,
      angle: number,
      spread: number,
      n: number,
      speed: number,
    ) => {
      for (let i = 0; i < n; i++) {
        const a = angle + rand(-spread, spread);
        const s = speed * rand(0.55, 1.15);
        pieces.push({
          x,
          y,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s,
          w: rand(6, 11),
          h: rand(3, 6),
          rot: rand(0, Math.PI * 2),
          vr: rand(-0.25, 0.25),
          wobble: rand(0, Math.PI * 2),
          vw: rand(0.08, 0.2),
          color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
          round: Math.random() < 0.2,
        });
      }
    };
    const up = -Math.PI / 2;
    const power = Math.max(14, Math.min(22, H / 40));
    burst(0, H, up + 0.55, 0.35, 90, power);
    burst(W, H, up - 0.55, 0.35, 90, power);
    burst(W / 2, H * 0.42, up, Math.PI, 70, power * 0.6);

    let raf = 0;
    const start = performance.now();
    let last = start;
    const frame = (t: number) => {
      const dt = Math.min(2, (t - last) / 16.67); // in 60 fps frames, capped after a stalled tab
      last = t;
      const fade = Math.min(1, Math.max(0, (DURATION_MS - (t - start)) / 600));
      ctx.clearRect(0, 0, W, H);
      let alive = 0;
      for (const p of pieces) {
        p.vx *= 0.985 ** dt;
        p.vy = p.vy * 0.985 ** dt + 0.32 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.wobble += p.vw * dt;
        if (p.y > H + 20) continue;
        alive++;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        // Flutter: squash one axis over time so the paper looks like it's tumbling.
        ctx.scale(1, Math.cos(p.wobble));
        ctx.fillStyle = p.color;
        if (p.round) {
          ctx.beginPath();
          ctx.arc(0, 0, p.h, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        }
        ctx.restore();
      }
      if (alive && fade > 0) raf = requestAnimationFrame(frame);
      else done.current();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[60] h-screen w-screen"
    />
  );
}
