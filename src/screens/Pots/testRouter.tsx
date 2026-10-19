import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import NewPotScreen from './NewPotScreen';
import PotDetailScreen from './PotDetailScreen';
import PotsScreen from './PotsScreen';

/** Test only: shows where the router is. */
function Probe({ name }: { name: string }) {
  const location = useLocation();
  return (
    <div>
      {name} at {location.pathname}
      {location.search}
    </div>
  );
}

/** Test only: the Pots screens on their real paths, starting at `entries` (the last one shown). */
export function renderPots(...entries: string[]) {
  const router = createMemoryRouter(
    [
      { path: '/more', element: <Probe name="More" /> },
      { path: '/more/pots', element: <PotsScreen /> },
      { path: '/more/pots/new', element: <NewPotScreen /> },
      { path: '/more/pots/:id', element: <PotDetailScreen /> },
    ],
    { initialEntries: entries, initialIndex: entries.length - 1 },
  );
  render(<RouterProvider router={router} />);
  return router;
}

export const SLOW = { timeout: 4000 };
