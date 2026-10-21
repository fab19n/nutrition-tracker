import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import GoalDetailScreen from './GoalDetailScreen';
import GoalsScreen from './GoalsScreen';
import NewGoalScreen from './NewGoalScreen';

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

/** Test only: the Goals screens on their real paths, starting at `entries` (the last one shown). */
export function renderGoals(...entries: string[]) {
  const router = createMemoryRouter(
    [
      { path: '/more', element: <Probe name="More" /> },
      { path: '/insights/target', element: <Probe name="Target" /> },
      { path: '/more/goals', element: <GoalsScreen /> },
      { path: '/more/goals/new', element: <NewGoalScreen /> },
      { path: '/more/goals/:id', element: <GoalDetailScreen /> },
    ],
    { initialEntries: entries, initialIndex: entries.length - 1 },
  );
  render(<RouterProvider router={router} />);
  return router;
}

export const SLOW = { timeout: 4000 };
