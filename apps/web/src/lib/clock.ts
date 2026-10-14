import { create } from 'zustand';
import type { GraveSocket } from './socket';

/** serverTime ≈ Date.now() + offset. The server is the only authority on time (decision.md D-009). */
export const useClock = create<{ offset: number }>(() => ({ offset: 0 }));
export const serverNow = () => Date.now() + useClock.getState().offset;

/**
 * NTP-style sync: offset = serverNow − midpoint(send, receive). Keeps the sample with the
 * smallest round trip, because that one bounds the error best (±RTT/2).
 */
export async function syncClock(socket: GraveSocket, samples = 5) {
  let best: { rtt: number; offset: number } | null = null;
  for (let i = 0; i < samples; i++) {
    const t0 = Date.now();
    const { serverNow: s } = await new Promise<{ serverNow: number }>((resolve) =>
      socket.emit('time:sync', resolve),
    );
    const t1 = Date.now();
    const sample = { rtt: t1 - t0, offset: s - (t0 + t1) / 2 };
    if (!best || sample.rtt < best.rtt) best = sample;
  }
  if (best) useClock.setState({ offset: best.offset });
}
