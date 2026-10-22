import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { refreshPush } from '@/push';
import { listenToWorker } from '@/push/worker';

/**
 * A notification tapped while the app is open: the worker focuses this window and asks it to open the
 * reminder's screen in place (decision §10.19 D14). Already there (path and query), nothing moves, so
 * Back still leaves the screen in one step. A rotated subscription is checked again.
 */
export function useNotificationOpens(): void {
  const navigate = useNavigate();
  const location = useLocation();
  const here = useRef(`${location.pathname}${location.search}`);
  useEffect(() => {
    here.current = `${location.pathname}${location.search}`;
  });
  useEffect(
    () =>
      listenToWorker({
        onOpen: (path) => {
          if (path !== here.current) void navigate(path);
        },
        onSubscriptionChange: () => void refreshPush(),
      }),
    [navigate],
  );
}
