import type { ReactNode } from 'react';
import { Bell, Sparkles } from 'lucide-react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { goBack } from '@/app/history';
import { PATHS } from '@/app/paths';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { SubScreenHeader } from '@/components/TopBar/TopBar';
import styles from './ComingSoonScreen.module.css';

interface Area {
  title: string;
  icon: ReactNode;
  /** One honest line about what's coming in the next build. */
  body: string;
  action?: { label: string; to: string };
}

const AREAS: Record<string, Area> = {
  reminders: {
    title: 'Reminders',
    icon: <Bell />,
    body: 'Weigh-in and meal nudges, only at times you pick.',
  },
};

function fallbackArea(what: string): Area {
  const words = what.replace(/[-_]+/g, ' ').trim();
  const title = words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Coming soon';
  return { title, icon: <Sparkles />, body: "This part of the app comes in a later build. Everything you've logged is safe." };
}

/** Placeholder for areas planned in later phases (/more/soon/:what). */
export default function ComingSoonScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { what = '' } = useParams();
  const key = what.toLowerCase();
  const area = AREAS[key] ?? fallbackArea(what);

  const back = () => (location.key !== 'default' ? goBack(navigate) : navigate(PATHS.more, { replace: true }));
  const action = area.action;

  // Goals has its screens now (S41–S44); an old link lands on the library.
  if (key === 'goals') return <Navigate to={PATHS.goals} replace />;
  // So does Backups (S39).
  if (key === 'backups') return <Navigate to={PATHS.backups} replace />;
  // So does Search (S49).
  if (key === 'search') return <Navigate to={PATHS.search} replace />;

  return (
    <div className={styles.subScreen}>
      <SubScreenHeader title={area.title} onBack={back} />
      <div className={styles.soon}>
        {/* Keeps the heading levels in order above the EmptyState's h3. */}
        <h2 className="sr-only">What's next</h2>
        <EmptyState
          icon={area.icon}
          headline="Coming in the next build"
          body={area.body}
          actionLabel={action?.label}
          onAction={action ? () => navigate(action.to) : undefined}
        />
      </div>
    </div>
  );
}
