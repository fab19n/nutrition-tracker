import { useCallback } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { goBack } from './history';
import { SHEET_NAMES, type SheetName } from './paths';

interface SheetHistoryState {
  sheet?: boolean;
}

/** Params that belong to a sheet (?sheet=evidence&rule=…, ?sheet=log&at=…), cleared with it. */
const SHEET_PARAMS = ['sheet', 'rule', 'at'] as const;

function withoutSheet(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of SHEET_PARAMS) next.delete(key);
  return next;
}

function isSheetName(value: string | null): value is SheetName {
  return value !== null && (SHEET_NAMES as readonly string[]).includes(value);
}

/**
 * Open and close sheets through the ?sheet= search param, so the phone's back button closes a sheet.
 * Opening pushes a history entry; closing pops it when we pushed it, or clears the params otherwise
 * (e.g. a sheet opened from a deep link).
 */
export function useSheet() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const raw = params.get('sheet');
  const sheet = isSheetName(raw) ? raw : null;

  const open = useCallback(
    (name: SheetName, extra?: Record<string, string>) => {
      // The page's own params stay (Diary's ?day=); a previous sheet's extras go.
      const next = withoutSheet(params);
      next.set('sheet', name);
      for (const [k, v] of Object.entries(extra ?? {})) next.set(k, v);
      // preventScrollReset: the page under the sheet keeps its scroll position (ScrollRestoration).
      if (sheet) {
        // One sheet handing over to another (budget → makan) replaces the entry and keeps its state:
        // a sheet opened from a link has no entry of ours to pop, so close() must still clear params.
        const current = location.state as SheetHistoryState | null;
        const state: SheetHistoryState = current?.sheet ? { sheet: true } : {};
        setParams(next, { replace: true, state, preventScrollReset: true });
      } else {
        const state: SheetHistoryState = { sheet: true };
        setParams(next, { state, preventScrollReset: true });
      }
    },
    [location.state, params, setParams, sheet],
  );

  const close = useCallback(() => {
    const state = location.state as SheetHistoryState | null;
    if (state?.sheet) {
      goBack(navigate);
      return;
    }
    setParams(withoutSheet(params), { replace: true, preventScrollReset: true });
  }, [location.state, navigate, params, setParams]);

  return { sheet, params, open, close };
}
