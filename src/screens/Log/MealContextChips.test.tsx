import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { slotBaselines, type SlotBaselines } from '@/domain/timing';
import { MealContextChips } from './MealContextChips';
import type { MealContext } from './mealTime';

/** The learned slot times the chips read; each test sets its own. */
const hooks = vi.hoisted(() => ({ baselines: undefined as SlotBaselines | undefined }));

vi.mock('@/db/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db/hooks')>()),
  useSlotBaselines: () => hooks.baselines,
}));

const S = { tz: 'Asia/Kuala_Lumpur', rolloverHour: 5 };
/** Fri 16 Oct 2026, 7:10pm MYT. */
const NOW = new Date('2026-10-16T11:10:00.000Z');

/** Baselines with a learned breakfast at 8:05am from `samples` days of history. */
function learnedBreakfast(samples: number): SlotBaselines {
  return { ...slotBaselines([]), breakfast: { medianMin: 8 * 60 + 5, spreadMin: 10, samples, share: 1 } };
}

function Harness() {
  const [value, setValue] = useState<MealContext>({ timeId: 'now', slot: 'dinner', slotTouched: false });
  return <MealContextChips value={value} onChange={setValue} places={[]} now={NOW} settings={S} />;
}

async function pickSlot(user: ReturnType<typeof userEvent.setup>, slot: string) {
  await user.click(screen.getByRole('button', { name: /^Meal:/ }));
  await user.click(within(await screen.findByRole('dialog', { name: 'Which meal?' })).getByRole('button', { name: slot }));
}

describe('MealContextChips slot times', () => {
  it('shows the clock on the time chip', () => {
    hooks.baselines = undefined;
    render(<Harness />);
    expect(screen.getByRole('button', { name: /^Time:\s*Now · 7:10pm$/ })).toBeInTheDocument();
  });

  it('moves the time to your own usual time for the slot once it has 5 days of history', async () => {
    hooks.baselines = learnedBreakfast(5);
    const user = userEvent.setup();
    render(<Harness />);
    await pickSlot(user, 'Breakfast');
    expect(await screen.findByRole('button', { name: /^Time:\s*8:05am$/ })).toBeInTheDocument();
  });

  it('uses the default time with less history, or before the history loads', async () => {
    hooks.baselines = learnedBreakfast(4);
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);
    await pickSlot(user, 'Breakfast');
    expect(await screen.findByRole('button', { name: /^Time:\s*9:30am$/ })).toBeInTheDocument();
    unmount();

    hooks.baselines = undefined;
    render(<Harness />);
    await pickSlot(user, 'Breakfast');
    expect(await screen.findByRole('button', { name: /^Time:\s*9:30am$/ })).toBeInTheDocument();
  });

  it('keeps the time at now when you re-tap the slot now falls in', async () => {
    hooks.baselines = undefined;
    const user = userEvent.setup();
    render(<Harness />);
    await pickSlot(user, 'Dinner');
    expect(await screen.findByRole('button', { name: /^Meal:\s*Dinner$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Time:\s*Now · 7:10pm$/ })).toBeInTheDocument();
  });

  it('shows a slot time in the time picker, ready to adjust', async () => {
    hooks.baselines = undefined;
    const user = userEvent.setup();
    render(<Harness />);
    await pickSlot(user, 'Lunch');
    await user.click(await screen.findByRole('button', { name: /^Time:\s*1:30pm$/ }));
    const picker = await screen.findByRole('dialog', { name: 'When did you eat?' });
    expect(within(picker).getByLabelText('Pick a time')).toHaveValue('13:30');
    expect(within(picker).getByRole('button', { name: 'Now' })).toHaveAttribute('aria-pressed', 'false');
  });
});
