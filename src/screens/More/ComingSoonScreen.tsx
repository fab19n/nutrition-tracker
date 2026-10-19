import type { ReactNode } from 'react';
import { Bell, CloudUpload, Search, Sparkles, Target } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { goBack } from '@/app/history';
import { PATHS } from '@/app/paths';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { SubScreenHeader } from '@/components/TopBar/TopBar';
import { useActiveGoal } from '@/db/hooks';
import styles from './ComingSoonScreen.module.css';

interface Area {
  title: string;
  icon: ReactNode;
  /** One honest line about what's coming in the next build. */
  body: string;
  action?: { label: string; to: string };
}

const AREAS: Record<string, Area> = {
  goals: {
    title: 'Goals',
    icon: <Target />,
    body: 'Your goal library, switching goals from the next rollover and editing targets. Your current goal keeps running until then.',
  },
  search: {
    title: 'Search',
    icon: <Search />,
    body: 'Search every meal you have logged, by name or Place. Until then, the Diary has each day.',
  },
  reminders: {
    title: 'Reminders',
    icon: <Bell />,
    body: 'Weigh-in and meal nudges, only at times you pick.',
  },
  backups: {
    title: 'Backups',
    icon: <CloudUpload />,
    body: 'A weekly copy to your Google Drive. Until then, Export makes a full backup.',
    action: { label: 'Export now', to: PATHS.export },
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
  const active = useActiveGoal();
  const key = what.toLowerCase();
  const found = AREAS[key] ?? fallbackArea(what);
  // Goals names the goal that is actually running ("Your Lean bulk goal keeps running…").
  const area: Area =
    key === 'goals' && active ? { ...found, body: found.body.replace('Your current goal', `Your ${active.goal.name} goal`) } : found;

  const back = () => (location.key !== 'default' ? goBack(navigate) : navigate(PATHS.more, { replace: true }));
  const action = area.action;

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
