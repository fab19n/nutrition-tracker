import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UsualCard, UsualSuggestionCard, usesLabel } from './UsualCard';

const card = {
  name: 'Roti canai + teh tarik',
  itemsLabel: 'Roti canai + dhal · Teh tarik',
  kcalLabel: '~560 kcal',
  placeName: 'Nasi kandar near home',
  useCount: 9,
};

function handlers() {
  return { onLog: vi.fn(), onEdit: vi.fn(), onMoveUp: vi.fn(), onMoveDown: vi.fn(), onDelete: vi.fn() };
}

async function openMenu(name = card.name) {
  await userEvent.click(screen.getByRole('button', { name: `More for ${name}` }));
  return screen.getByRole('menu', { name: `More for ${name}` });
}

describe('usesLabel', () => {
  it('counts uses in words', () => {
    expect(usesLabel(0)).toBe('Not used yet');
    expect(usesLabel(1)).toBe('Used once');
    expect(usesLabel(9)).toBe('Used 9 times');
    expect(usesLabel(1200)).toBe('Used 1,200 times');
  });
});

describe('UsualCard', () => {
  it('shows name, items, kcal, Place and use count, and logs in one tap', async () => {
    const h = handlers();
    render(<UsualCard {...card} {...h} />);
    const article = screen.getByRole('article', { name: card.name });
    expect(within(article).getByRole('heading', { level: 3, name: card.name })).toBeInTheDocument();
    expect(within(article).getByText('Roti canai + dhal · Teh tarik')).toBeInTheDocument();
    expect(within(article).getByText('~560 kcal')).toBeInTheDocument();
    expect(within(article).getByText(/· Nasi kandar near home · Used 9 times/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: `Log ${card.name}` }));
    expect(h.onLog).toHaveBeenCalledOnce();
  });

  it('offers Edit, Move up, Move down and Delete in the menu', async () => {
    const h = handlers();
    render(<UsualCard {...card} {...h} />);
    const menu = await openMenu();
    expect(within(menu).getAllByRole('menuitem').map((el) => el.textContent)).toEqual(['Edit', 'Move up', 'Move down', 'Delete']);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Move down' }));
    expect(h.onMoveDown).toHaveBeenCalledOnce();

    await userEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Edit' }));
    expect(h.onEdit).toHaveBeenCalledOnce();
    await userEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Delete' }));
    expect(h.onDelete).toHaveBeenCalledOnce();
  });

  it('leaves out moves that would go past either end', async () => {
    const { onMoveUp: _up, onMoveDown: _down, ...h } = handlers();
    render(<UsualCard {...card} {...h} onMoveDown={vi.fn()} />);
    const menu = await openMenu();
    expect(within(menu).queryByRole('menuitem', { name: 'Move up' })).not.toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Move down' })).toBeInTheDocument();
  });

  it('reorders from the keyboard', async () => {
    const h = handlers();
    render(<UsualCard {...card} {...h} />);
    screen.getByRole('button', { name: `More for ${card.name}` }).focus();
    await userEvent.keyboard('{Enter}');
    // Focus lands on Edit; two steps down is Move down.
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(h.onMoveDown).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: `More for ${card.name}` })).toHaveFocus();
  });

  it('shows an unused Usual without a Place, and disables Log while busy', () => {
    render(<UsualCard {...card} placeName={undefined} useCount={0} busy {...handlers()} />);
    expect(screen.getByText(/· Not used yet/)).toBeInTheDocument();
    expect(screen.queryByText(/Nasi kandar near home/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Log ${card.name}` })).toBeDisabled();
  });

  it('leaves out the items line when it is empty', () => {
    render(<UsualCard {...card} name="Teh o ais kurang" itemsLabel="" {...handlers()} />);
    const article = screen.getByRole('article', { name: 'Teh o ais kurang' });
    expect(within(article).getAllByText('Teh o ais kurang')).toHaveLength(1);
    expect(article.querySelectorAll('p')).toHaveLength(1);
  });
});

describe('UsualSuggestionCard', () => {
  it('asks, saves and dismisses', async () => {
    const onSave = vi.fn();
    const onDismiss = vi.fn();
    render(<UsualSuggestionCard name="Bread, kaya, kopi" times={4} kcalLabel="~380 kcal" placeName="Home" onSave={onSave} onDismiss={onDismiss} />);
    const article = screen.getByRole('article', { name: "You've logged Bread, kaya, kopi 4 times. Save as a Usual?" });
    expect(within(article).getByText('~380 kcal · Home')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save Bread, kaya, kopi as a Usual' }));
    expect(onSave).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Not now: Bread, kaya, kopi' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
