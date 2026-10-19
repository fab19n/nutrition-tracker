import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { Navigate, type RouteObject } from 'react-router';
import { AppShell, ShellError } from './AppShell';
import { PATHS, type Tab } from './paths';

/** Route handle read by AppShell: which tab is active, or false to hide the bottom nav (sub-screens). */
export interface RouteHandle {
  tab: Tab | false;
}

const TodayScreen = lazy(() => import('@/screens/Today/TodayScreen'));
const DiaryDayScreen = lazy(() => import('@/screens/Diary/DiaryDayScreen'));
const DiaryWeekScreen = lazy(() => import('@/screens/Diary/DiaryWeekScreen'));
const EntryScreen = lazy(() => import('@/screens/Diary/EntryScreen'));
const InsightsScreen = lazy(() => import('@/screens/Insights/InsightsScreen'));
const WeeklyReviewScreen = lazy(() => import('@/screens/Insights/WeeklyReviewScreen'));
const MoreScreen = lazy(() => import('@/screens/More/MoreScreen'));
const WeightScreen = lazy(() => import('@/screens/More/WeightScreen'));
const SettingsScreen = lazy(() => import('@/screens/More/SettingsScreen'));
const ExportScreen = lazy(() => import('@/screens/More/ExportScreen'));
const ComingSoonScreen = lazy(() => import('@/screens/More/ComingSoonScreen'));
const EstimatingScreen = lazy(() => import('@/screens/Log/EstimatingScreen'));
const ReviewScreen = lazy(() => import('@/screens/Log/ReviewScreen'));
const PlateScreen = lazy(() => import('@/screens/Log/PlateScreen'));
const IdeasScreen = lazy(() => import('@/screens/Ideas/IdeasScreen'));
const SetupFlow = lazy(() => import('@/screens/Setup/SetupFlow'));
const PlacesScreen = lazy(() => import('@/screens/Places/PlacesScreen'));
const PlaceDetailScreen = lazy(() => import('@/screens/Places/PlaceDetailScreen'));
const UsualsScreen = lazy(() => import('@/screens/Usuals/UsualsScreen'));
const PotsScreen = lazy(() => import('@/screens/Pots/PotsScreen'));
const NewPotScreen = lazy(() => import('@/screens/Pots/NewPotScreen'));
const PotDetailScreen = lazy(() => import('@/screens/Pots/PotDetailScreen'));
const ActivityScreen = lazy(() => import('@/screens/Activity/ActivityScreen'));
const LogWorkoutScreen = lazy(() => import('@/screens/Activity/LogWorkoutScreen'));
const GalleryPage = lazy(() => import('@/dev/GalleryPage'));

function page(Component: LazyExoticComponent<ComponentType>) {
  return (
    <Suspense fallback={null}>
      <Component />
    </Suspense>
  );
}

const tab = (t: Tab | false): RouteHandle => ({ tab: t });

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    errorElement: <ShellError />,
    children: [
      { path: '/', element: page(TodayScreen), handle: tab('today') },
      { path: '/diary', element: page(DiaryDayScreen), handle: tab('diary') },
      { path: '/diary/week', element: page(DiaryWeekScreen), handle: tab('diary') },
      { path: '/diary/entry/:id', element: page(EntryScreen), handle: tab(false) },
      { path: '/insights', element: page(InsightsScreen), handle: tab('insights') },
      { path: '/insights/weekly', element: page(WeeklyReviewScreen), handle: tab(false) },
      { path: '/more', element: page(MoreScreen), handle: tab('more') },
      { path: '/more/weight', element: page(WeightScreen), handle: tab(false) },
      { path: '/more/settings', element: page(SettingsScreen), handle: tab(false) },
      { path: '/more/export', element: page(ExportScreen), handle: tab(false) },
      { path: '/more/places', element: page(PlacesScreen), handle: tab(false) },
      { path: '/more/places/:id', element: page(PlaceDetailScreen), handle: tab(false) },
      { path: '/more/usuals', element: page(UsualsScreen), handle: tab(false) },
      { path: '/more/pots', element: page(PotsScreen), handle: tab(false) },
      { path: '/more/pots/new', element: page(NewPotScreen), handle: tab(false) },
      { path: '/more/pots/:id', element: page(PotDetailScreen), handle: tab(false) },
      { path: '/more/activity', element: page(ActivityScreen), handle: tab(false) },
      { path: '/more/activity/new', element: page(LogWorkoutScreen), handle: tab(false) },
      { path: '/more/soon/:what', element: page(ComingSoonScreen), handle: tab(false) },
      { path: '/log/estimating', element: page(EstimatingScreen), handle: tab(false) },
      { path: '/log/review', element: page(ReviewScreen), handle: tab(false) },
      { path: '/log/plate', element: page(PlateScreen), handle: tab(false) },
      { path: '/ideas', element: page(IdeasScreen), handle: tab(false) },
      { path: '/setup/*', element: page(SetupFlow), handle: tab(false) },
      // Unknown paths go to Today (or to setup, via the shell, before the first run).
      { path: '*', element: <Navigate to={PATHS.today} replace />, handle: tab(false) },
    ],
  },
  { path: '/dev', element: page(GalleryPage) },
];
