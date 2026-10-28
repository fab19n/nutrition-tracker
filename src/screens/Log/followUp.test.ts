import { byId } from '@/data/catalogue';
import { itemFromCatalogue, selectVariant } from '@/domain/meal';
import type { MealItem } from '@/domain/types';
import type { EstimateResult } from '@/estimate/types';
import { answeredItems, answerRequest, answerText } from './followUp';

const kopiAis = () => itemFromCatalogue(byId('kopi-ais')!, { id: 'kopi' });

function guess(extra: Partial<MealItem> = {}): MealItem {
  return {
    id: 'g',
    name: 'Coconut white coffee',
    unitMacros: { kcal: 435, proteinG: 4, carbsG: 50, fatG: 24 },
    quantity: 1,
    uncertainty: 0.3,
    source: 'aiGuess',
    ...extra,
  };
}

function result(items: MealItem[], method: EstimateResult['method'] = 'ai'): EstimateResult {
  return { items, questions: [], unmatched: [], method };
}

describe('answerText', () => {
  it('names the item with its chip and quantity, then the question and answer', () => {
    const item = { ...selectVariant(kopiAis(), 1), quantity: 2 };
    expect(answerText(item, 'How big was the glass? ', ' Old Town, large ')).toBe(
      'Kopi ais (Kurang ×2). Asked: How big was the glass? Answer: Old Town, large',
    );
  });

  it('is just the name for an item without chips', () => {
    expect(answerText(guess(), 'Coconut milk?', 'yes')).toBe('Coconut white coffee. Asked: Coconut milk? Answer: yes');
  });
});

describe('answerRequest', () => {
  it('is text only, at the Place and slot of the meal', () => {
    expect(answerRequest(guess(), 'Q?', 'A', { method: 'photo', placeId: 'p1', slot: 'lunch', photoId: 'ph' })).toEqual({
      text: 'Coconut white coffee. Asked: Q? Answer: A',
      placeId: 'p1',
      slot: 'lunch',
    });
  });
});

describe('answeredItems', () => {
  it('takes the AI items without asking again', () => {
    expect(answeredItems(result([guess({ question: 'Was it iced?' })]))).toEqual([guess()]);
  });

  it('is null when the AI did not run or found nothing', () => {
    expect(answeredItems(result([guess()], 'local'))).toBeNull();
    expect(answeredItems(result([]))).toBeNull();
  });
});
