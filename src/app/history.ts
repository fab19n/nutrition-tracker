import type { NavigateFunction } from 'react-router';

/*
 * The phone's back button closes the newest local sheet (AppShell blocks that POP and closes the
 * sheet instead). A back the app asks for itself must still go through, so it is marked first.
 */
const PROGRAMMATIC_BACK_MS = 1000;
let programmaticBackAt = Number.NEGATIVE_INFINITY;

/** Goes back one history entry on the app's own behalf (Back buttons, closing a ?sheet= sheet). */
export function goBack(navigate: NavigateFunction): void {
  programmaticBackAt = Date.now();
  void navigate(-1);
}

/** True (once) when the POP being handled was asked for by goBack(). */
export function takeProgrammaticBack(): boolean {
  const marked = Date.now() - programmaticBackAt < PROGRAMMATIC_BACK_MS;
  programmaticBackAt = Number.NEGATIVE_INFINITY;
  return marked;
}
