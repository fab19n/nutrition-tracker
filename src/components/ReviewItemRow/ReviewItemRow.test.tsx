import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MealItem, Variant } from '@/domain/types';
import { ReviewItemRow } from './ReviewItemRow';

const kcal = (k: number) => ({ kcal: k, proteinG: 0, carbsG: 0, fatG: 0 });
const KUAH: Variant[] = [
  { id: 'sikit', label: 'Sikit', macros: kcal(60) },
  { id: 'normal', label: 'Normal', macros: kcal(120) },
  { id: 'banjir', label: 'Banjir', macros: kcal(220) },
];

function makeItem(extra: Partial<MealItem> = {}): MealItem {
  return {
    id: 'kuah',
    name: 'Kuah campur',
    variants: KUAH,
    selectedVariant: 1,
    unitMacros: kcal(120),
    quantity: 1,
    uncertainty: 0.15,
    source: 'catalogue',
    ...extra,
  };
}

describe('ReviewItemRow', () => {
  it('shows name, source tag, estimate and portion chips', () => {
    render(<ReviewItemRow item={makeItem()} kcalLabel="~120" />);
    expect(screen.getByText('Kuah campur')).toBeInTheDocument();
    expect(screen.getByText('Catalogue')).toBeInTheDocument();
    expect(screen.getByText('~120')).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Kuah campur portion' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reports the chosen chip', async () => {
    const onSelectVariant = vi.fn();
    render(<ReviewItemRow item={makeItem()} kcalLabel="~120" onSelectVariant={onSelectVariant} />);
    await userEvent.click(screen.getByRole('button', { name: 'Banjir' }));
    expect(onSelectVariant).toHaveBeenCalledWith(2);
  });

  it('shows the item question, and a passed question wins', () => {
    const { rerender } = render(<ReviewItemRow item={makeItem({ question: 'Is there kuah under the rice?' })} kcalLabel="~120" />);
    expect(screen.getByText('Is there kuah under the rice?')).toBeInTheDocument();
    rerender(<ReviewItemRow item={makeItem({ question: 'Is there kuah under the rice?' })} kcalLabel="~120" question="Banjir or normal?" />);
    expect(screen.getByText('Banjir or normal?')).toBeInTheDocument();
  });

  it('hides chips for a fixed item and shows ×quantity', () => {
    render(<ReviewItemRow item={makeItem({ name: 'Ayam masak merah', variants: undefined, quantity: 2 })} kcalLabel="~500" />);
    expect(screen.getByText('Ayam masak merah ×2')).toBeInTheDocument();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('shows a fraction of a unit, such as half a glass', () => {
    render(<ReviewItemRow item={makeItem({ name: 'Kopi ais', quantity: 0.5 })} kcalLabel="~100" />);
    expect(screen.getByText('Kopi ais ×0.5')).toBeInTheDocument();
  });

  it('shows an uncertain item as a softer range', () => {
    render(<ReviewItemRow item={makeItem({ uncertainty: 0.35 })} kcalLabel="~120" />);
    expect(screen.queryByText('~120')).toBeNull();
    expect(screen.getByText(/~80–160/)).toBeInTheDocument();
    expect(screen.getByText('Likely')).toHaveClass('sr-only');
  });

  it('returns focus to the menu button after an action', async () => {
    const onSwap = vi.fn();
    render(<ReviewItemRow item={makeItem()} kcalLabel="~120" onSwap={onSwap} />);
    const trigger = screen.getByRole('button', { name: 'More for Kuah campur' });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Swap item' }));
    expect(onSwap).toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });

  it('shows the pending state while offline', () => {
    render(<ReviewItemRow item={makeItem({ pendingEstimate: true, variants: undefined, source: 'aiGuess' })} kcalLabel="~120" />);
    expect(screen.queryByText('~120')).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText("Estimate will run when you're back online")).toBeInTheDocument();
    expect(screen.getByText('AI guess')).toBeInTheDocument();
  });

  it('has no overflow menu without swap or remove', () => {
    render(<ReviewItemRow item={makeItem()} kcalLabel="~120" />);
    expect(screen.queryByRole('button', { name: 'More for Kuah campur' })).not.toBeInTheDocument();
  });

  describe('overflow menu', () => {
    it('opens with focus on the first action and runs the chosen one', async () => {
      const onSwap = vi.fn();
      const onRemove = vi.fn();
      render(<ReviewItemRow item={makeItem()} kcalLabel="~120" onSwap={onSwap} onRemove={onRemove} />);
      const trigger = screen.getByRole('button', { name: 'More for Kuah campur' });
      expect(trigger).toHaveAttribute('aria-expanded', 'false');

      await userEvent.click(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('menuitem', { name: 'Swap item' })).toHaveFocus();

      await userEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
      expect(onRemove).toHaveBeenCalledOnce();
      expect(onSwap).not.toHaveBeenCalled();
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('moves with arrow keys, wraps, and closes on Escape back to the trigger', async () => {
      render(<ReviewItemRow item={makeItem()} kcalLabel="~120" onSwap={() => {}} onRemove={() => {}} />);
      const trigger = screen.getByRole('button', { name: 'More for Kuah campur' });
      await userEvent.click(trigger);
      await userEvent.keyboard('{ArrowDown}');
      expect(screen.getByRole('menuitem', { name: 'Remove' })).toHaveFocus();
      await userEvent.keyboard('{ArrowDown}');
      expect(screen.getByRole('menuitem', { name: 'Swap item' })).toHaveFocus();
      await userEvent.keyboard('{End}');
      expect(screen.getByRole('menuitem', { name: 'Remove' })).toHaveFocus();

      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });

    it('closes on a tap outside', async () => {
      render(
        <div>
          <ReviewItemRow item={makeItem()} kcalLabel="~120" onRemove={() => {}} />
          <p>Outside</p>
        </div>,
      );
      await userEvent.click(screen.getByRole('button', { name: 'More for Kuah campur' }));
      expect(screen.getByRole('menu')).toBeInTheDocument();
      await userEvent.click(screen.getByText('Outside'));
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('only lists the actions it was given', async () => {
      render(<ReviewItemRow item={makeItem()} kcalLabel="~120" onRemove={() => {}} />);
      await userEvent.click(screen.getByRole('button', { name: 'More for Kuah campur' }));
      expect(screen.getAllByRole('menuitem')).toHaveLength(1);
      expect(screen.queryByRole('menuitem', { name: 'Swap item' })).not.toBeInTheDocument();
    });
  });

  describe('follow-up answer', () => {
    const question = 'How big was the glass?';

    it('sends the trimmed answer, and Skip closes', async () => {
      const onAnswer = vi.fn();
      const onSkip = vi.fn();
      render(<ReviewItemRow item={makeItem({ question })} kcalLabel="~120" onAnswer={onAnswer} onSkip={onSkip} />);
      expect(screen.getByRole('button', { name: 'Update' })).toBeDisabled();
      await userEvent.type(screen.getByRole('textbox', { name: question }), '  large one {Enter}');
      expect(onAnswer).toHaveBeenCalledWith('large one');
      await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
      expect(onSkip).toHaveBeenCalled();
    });

    it('waits while the answer is estimated', () => {
      render(<ReviewItemRow item={makeItem({ question })} kcalLabel="~120" onAnswer={vi.fn()} onSkip={vi.fn()} answering />);
      expect(screen.getByRole('textbox', { name: question })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Updating…' })).toBeDisabled();
    });

    it('has no answer row without a question or while pending', () => {
      const { rerender } = render(<ReviewItemRow item={makeItem()} kcalLabel="~120" onAnswer={vi.fn()} onSkip={vi.fn()} />);
      expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
      rerender(<ReviewItemRow item={makeItem({ question, pendingEstimate: true })} kcalLabel="~120" onAnswer={vi.fn()} onSkip={vi.fn()} />);
      expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
    });
  });
});
