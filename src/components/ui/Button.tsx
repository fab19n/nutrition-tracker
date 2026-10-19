import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'onNav';
/**
 * lg   — 52px full-width sheet/flow button ("Done", "Confirm", "Next · top 3")
 * md   — 48px button ("Save weigh-in")
 * pill — compact pill, 14px/600, padding 10px 16px ("Meal ideas")
 * sm   — small pill, 13px/700, padding 9px 14px ("Log this", "Log")
 * footer — the big Save/Review pill inside the dark RangeTotal footer (16px/700, padding 16px 22px)
 */
export type ButtonSize = 'lg' | 'md' | 'pill' | 'sm' | 'footer';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'lg',
  fullWidth,
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const cls = [
    styles.button,
    styles[variant],
    styles[size],
    fullWidth || size === 'lg' || size === 'md' ? styles.full : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={cls} {...rest}>
      {icon ? <span className={styles.icon} aria-hidden="true">{icon}</span> : null}
      {children}
    </button>
  );
}
