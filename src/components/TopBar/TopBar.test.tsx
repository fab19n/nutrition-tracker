import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DateSwitcher, SubScreenHeader, TopBar } from './TopBar';

describe('TopBar', () => {
  it('renders the screen title as the page heading', () => {
    render(<TopBar title="Today" subtitle="Fri 16 Oct" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
    expect(screen.getByText('Fri 16 Oct')).toBeInTheDocument();
  });

  it('shows named search and overflow buttons when asked', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    const onMore = vi.fn();
    render(<TopBar title="Diary" onSearch={onSearch} searchLabel="Search meals" onMore={onMore} />);
    await user.click(screen.getByRole('button', { name: 'Search meals' }));
    await user.click(screen.getByRole('button', { name: 'More options' }));
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onMore).toHaveBeenCalledTimes(1);
  });
});

describe('SubScreenHeader', () => {
  it('has a named back button', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<SubScreenHeader title="Weight" onBack={onBack} backLabel="Back to More" />);
    await user.click(screen.getByRole('button', { name: 'Back to More' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Weight' })).toBeInTheDocument();
  });
});

describe('DateSwitcher', () => {
  it('steps both ways when both handlers are given', async () => {
    const user = userEvent.setup();
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(<DateSwitcher prevLabel="Thu" label="Fri 16 Oct · Today" nextLabel="Sat" onPrev={onPrev} onNext={onNext} />);
    await user.click(screen.getByRole('button', { name: 'Previous: Thu' }));
    await user.click(screen.getByRole('button', { name: 'Next: Sat' }));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('disables a side without a handler', () => {
    render(<DateSwitcher prevLabel="Last week" label="12–18 Oct · This week" onPrev={() => {}} />);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous: Last week' })).toBeEnabled();
  });
});
