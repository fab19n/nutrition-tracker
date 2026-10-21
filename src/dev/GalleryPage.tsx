import { useEffect, useState } from 'react';
import { StructureGallery } from './gallery/StructureGallery';
import { LoggingGallery } from './gallery/LoggingGallery';
import { LedgerGallery } from './gallery/LedgerGallery';
import { InsightsGallery } from './gallery/InsightsGallery';
import { PlacesGallery } from './gallery/PlacesGallery';
import { UsualsGallery } from './gallery/UsualsGallery';
import { PotsGallery } from './gallery/PotsGallery';
import { ActivityGallery } from './gallery/ActivityGallery';
import { GoalsGallery } from './gallery/GoalsGallery';
import { Segmented } from '@/components/ui/Segmented';
import styles from './GalleryPage.module.css';

type Theme = 'light' | 'dark';

/** /dev — every component in every state, for visual QA against design/README.md. */
export default function GalleryPage() {
  const [theme, setTheme] = useState<Theme>('light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className="t-title">Component gallery</h1>
        <Segmented
          label="Theme"
          tone="inset"
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </header>
      <StructureGallery />
      <LoggingGallery />
      <LedgerGallery />
      <InsightsGallery />
      <PlacesGallery />
      <UsualsGallery />
      <PotsGallery />
      <ActivityGallery />
      <GoalsGallery />
    </div>
  );
}
