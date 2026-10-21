import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { goBack } from '@/app/history';
import { PATHS } from '@/app/paths';
import { OptionGroup, type OptionItem } from '@/components/OptionRow/OptionRow';
import { SubScreenHeader } from '@/components/TopBar/TopBar';
import { Button } from '@/components/ui/Button';
import { Pill } from '@/components/ui/Pill';
import { db } from '@/db/db';
import { exportCsv } from '@/db/export';
import { useProfile, useToday } from '@/db/hooks';
import { readLastExport, writeLastExport, type ExportKind, type LastExport } from '@/db/settings';
import { now } from '@/domain/clock';
import { logicalDayOf } from '@/domain/day';
import { fmtDayShort, fmtInt, fmtTime } from '@/domain/format';
import { useUiStore } from '@/state/ui';
import { downloadFile, saveFullBackup } from './exportFiles';
import styles from './ExportScreen.module.css';

const OPTIONS: readonly (OptionItem & { id: ExportKind })[] = [
  { id: 'json', label: 'Full backup (JSON)', sub: 'Everything, in one file that can be imported back' },
  { id: 'csv', label: 'Spreadsheet files (CSV)', sub: 'Meals, meal items, weights and workouts' },
];

const KIND_LABEL: Record<ExportKind, string> = { json: 'Full backup', csv: 'Spreadsheet files' };

function isExportKind(id: string): id is ExportKind {
  return id === 'json' || id === 'csv';
}

function lastExportLine(last: LastExport | null, tz: string | undefined): string {
  if (!last) return 'No export yet';
  return `Last export: ${KIND_LABEL[last.kind]} · ${fmtDayShort(logicalDayOf(last.at, tz, 0))}, ${fmtTime(last.at, tz)}`;
}

/** S20 Export: full backup (JSON), spreadsheet files (CSV), photos (zip, later); remembers the last export. */
export default function ExportScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const profile = useProfile();
  const today = useToday();
  const showToast = useUiStore((s) => s.showToast);
  const [kind, setKind] = useState<ExportKind>('json');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(readLastExport);

  const back = () => (location.key !== 'default' ? goBack(navigate) : navigate(PATHS.settings, { replace: true }));

  const runExport = async () => {
    setBusy(true);
    try {
      let record: LastExport;
      if (kind === 'json') {
        const saved = await saveFullBackup(db, today);
        record = saved.record;
        showToast(`Backup done · ${saved.filename}`);
      } else {
        const files = await exportCsv(db);
        for (const file of files) downloadFile(file.blob, file.filename);
        showToast(`${fmtInt(files.length)} spreadsheet files ready`);
        record = { at: now().toISOString(), kind };
        writeLastExport(record);
      }
      setLast(record);
    } catch {
      showToast("Couldn't export right now. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.subScreen}>
      <SubScreenHeader title="Export" onBack={back} />
      <p className={styles.intro}>A copy of your data for safekeeping or a spreadsheet. Files go to your downloads.</p>

      <div className={styles.exportBody}>
        <OptionGroup
          label="What to export"
          size="lg"
          options={OPTIONS}
          value={kind}
          onChange={(id) => {
            if (isExportKind(id)) setKind(id);
          }}
        />
        <div className={styles.laterRow}>
          <span className={styles.laterText}>
            <span className={styles.laterLabel}>Photos (zip)</span>
            <span className={styles.laterSub}>Your meal photos, separately</span>
          </span>
          <Pill tone="neutral">Coming later</Pill>
        </div>
      </div>

      <div className={styles.exportAction}>
        <Button onClick={() => void runExport()} disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Exporting…' : 'Export'}
        </Button>
      </div>
      <p className={styles.lastExport} aria-live="polite">
        {lastExportLine(last, profile?.timeZone)}
      </p>
    </div>
  );
}
