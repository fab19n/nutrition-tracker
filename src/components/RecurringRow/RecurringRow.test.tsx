import { render, screen } from '@testing-library/react';
import { RecurringList } from './RecurringRow';

describe('RecurringList', () => {
  it('lists item, frequency and kcal a week', () => {
    render(
      <RecurringList
        label="Recurring calories"
        items={[
          { name: 'Teh tarik', frequencyLabel: '~8 a week', kcalLabel: '≈ 1,420' },
          { name: 'Milo ais', frequencyLabel: '~3 a week', kcalLabel: '≈ 750' },
        ]}
      />,
    );
    const list = screen.getByRole('list', { name: 'Recurring calories' });
    expect(list.querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByText('· ~8 a week')).toBeInTheDocument();
    expect(screen.getByText('≈ 1,420')).toBeInTheDocument();
  });
});
