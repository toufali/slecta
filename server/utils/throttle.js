// Spaces outbound requests to one host, so a batch arrives as a trickle rather than a burst.

import { setTimeout as delay } from 'node:timers/promises'

const nextSlot = new Map()

/** Claim the next free slot for `key` and wait for it — no concurrency can beat one call per interval. */
export async function space(key, intervalMs) {
  if (!intervalMs) return

  const now = Date.now()
  const slot = Math.max(now, nextSlot.get(key) ?? 0)

  // Claimed before awaiting, so callers queueing together each get their own slot
  nextSlot.set(key, slot + intervalMs)

  if (slot > now) await delay(slot - now)
}
