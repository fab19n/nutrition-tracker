/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GoalPill } from './GoalPill';

/** The declarations of the first `selector { … }` rule in a component stylesheet. */
function rule(file: string, selector: string): string {
  const css = readFileSync(`src/components/${file}`, 'utf8');
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return '';
  return css.slice(start, css.indexOf('}', start));
}

describe('GoalPill (C03)', () => {
  it('names the goal for assistive tech and opens Goals', async () => {
    const onPress = vi.fn();
    render(<GoalPill label="Cut · 1,800" onPress={onPress} />);
    await userEvent.click(screen.getByRole('button', { name: 'Goal: Cut · 1,800' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('keeps a long goal name whole in the text and the aria-label', () => {
    const label = 'Cut before the Raya open houses begin · 1,800';
    render(<GoalPill label={label} onPress={vi.fn()} />);
    expect(screen.getByRole('button', { name: `Goal: ${label}` })).toHaveTextContent(label);
  });

  // jsdom has no layout, so the rules that stop a long name running over the Today title are
  // checked in the stylesheets.
  it('shortens a long label with an ellipsis instead of widening the pill', () => {
    const pill = rule('GoalPill/GoalPill.module.css', '.pill');
    expect(pill).toMatch(/max-width: 100%;/);
    expect(pill).toMatch(/min-width: 0;/);
    const label = rule('GoalPill/GoalPill.module.css', '.label');
    expect(label).toMatch(/overflow: hidden;/);
    expect(label).toMatch(/text-overflow: ellipsis;/);
  });

  it('lets the TopBar right slot shrink, and keeps the title from shrinking', () => {
    const right = rule('TopBar/TopBar.module.css', '.right');
    expect(right).toMatch(/flex: 0 1 auto;/);
    expect(right).toMatch(/min-width: 0;/);
    expect(rule('TopBar/TopBar.module.css', '.titleGroup')).toMatch(/min-width: min-content;/);
  });
});
