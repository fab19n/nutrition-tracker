import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EvidenceList, type EvidenceItem } from './EvidenceList';

const items: EvidenceItem[] = [
  { id: 'a', dayLabel: 'Mon 5 Oct', slotLabel: 'Breakfast', timeLabel: '9:30am', name: 'Teh tarik · Kurang', kcalLabel: '~140' },
  { id: 'b', dayLabel: 'Sat 10 Oct', slotLabel: 'Breakfast', timeLabel: '10:30am', name: 'Milo ais · Normal', kcalLabel: '~250' },
  {
    id: 'c',
    dayLabel: 'Sat 10 Oct',
    slotLabel: 'Dinner',
    timeLabel: '7:45pm',
    placeName: 'Medan selera nearby',
    name: 'Milo ais · Normal',
    kcalLabel: '~250',
  },
];

const bars = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, i) => ({ label, kcal: i === 0 ? 140 : i === 5 ? 500 : 0 }));

describe('EvidenceList', () => {
  it('shows the summary, bars and rows grouped by day', async () => {
    const onOpen = vi.fn();
    render(<EvidenceList summary="11 drinks last week · ~2,170 kcal" bars={bars} barsLabel="Drinks by day" items={items} onOpen={onOpen} />);
    expect(screen.getByText('11 drinks last week · ~2,170 kcal')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Drinks by day' })).toBeInTheDocument();
    const saturday = screen.getByRole('region', { name: 'Sat 10 Oct' });
    expect(within(saturday).getAllByRole('button')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: /Teh tarik · Kurang/ }));
    expect(onOpen).toHaveBeenCalledWith('a');
  });

  it('says so when there is nothing', () => {
    render(<EvidenceList summary="Nothing yet" items={[]} />);
    expect(screen.getByText('No meals behind this one yet.')).toBeInTheDocument();
  });
});
