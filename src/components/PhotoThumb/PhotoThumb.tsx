import type { CSSProperties } from 'react';
import type { Finished } from '@/domain/types';
import styles from './PhotoThumb.module.css';

/**
 * The handoff's label is "Half finished", but at 11px/600 that is ~72px wide, more than the
 * 52px thumb. The visible word is shortened; screen readers still hear "Half finished".
 */
const FINISHED_LABEL: Record<Exclude<Finished, 'all'>, string> = { most: 'Most', half: 'Half' };

export interface PhotoThumbProps {
  /** Object URL or remote URL of the thumbnail. Without it a hatched placeholder shows. */
  url?: string;
  /** Shows a small "Half" / "Most" label when the meal wasn't finished. */
  finished?: Finished;
  /** Square size in px (52 on MealRow). */
  size?: number;
  /** Opens the full-size photo. */
  onPress?: () => void;
  /** Describes the photo, e.g. the meal name. */
  alt?: string;
  className?: string;
}

/** @design C33 PhotoThumb — 52px square, 16px radius, hatched --thumb1/--thumb2 placeholder, optional finished label. */
export function PhotoThumb({ url, finished, size = 52, onPress, alt = '', className }: PhotoThumbProps) {
  const style = { '--thumb-size': `${size}px` } as CSSProperties;
  const label = finished && finished !== 'all' ? FINISHED_LABEL[finished] : null;
  const content = (
    <>
      {url ? <img className={styles.img} src={url} alt={onPress ? '' : alt} draggable={false} /> : null}
      {label ? (
        <span className={styles.label}>
          {label}
          <span className="sr-only"> finished</span>
        </span>
      ) : null}
    </>
  );
  const cls = [styles.thumb, url ? '' : styles.placeholder, className].filter(Boolean).join(' ');

  if (onPress) {
    const name = alt ? `View photo: ${alt}` : 'View photo';
    return (
      <button type="button" className={[cls, styles.button].join(' ')} style={style} onClick={onPress} aria-label={name}>
        {content}
      </button>
    );
  }
  return (
    <span className={cls} style={style} aria-hidden={!url && !label ? true : undefined}>
      {content}
    </span>
  );
}
