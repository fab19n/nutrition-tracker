/**
 * The only place in the engine that reads the real time.
 *
 * Demo mode pins "now" to the design's sample moment so every screen can be compared
 * with the prototype (ARCHITECTURE §9).
 */

/** Fri 16 Oct 2026, 7:10pm in Kuala Lumpur (UTC+8). */
export const DEMO_NOW_ISO = '2026-10-16T11:10:00.000Z';

let demoClock = false;

export function setDemoClock(enabled: boolean): void {
  demoClock = enabled;
}

export function isDemoClock(): boolean {
  return demoClock;
}

/** The current moment: the demo instant while demo mode is on, otherwise the real time. */
export function now(): Date {
  return demoClock ? new Date(DEMO_NOW_ISO) : new Date();
}
