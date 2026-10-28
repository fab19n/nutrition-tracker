import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PATHS } from '@/app/paths';
import { byId } from '@/data/catalogue';
import { loadDemoData, resetAll } from '@/db/actions';
import { now } from '@/domain/clock';
import { itemFromCatalogue } from '@/domain/meal';
import type { MealItem } from '@/domain/types';
import type { EstimateMealOptions } from '@/estimate/service';
import type { EstimateContext, EstimateRequest, EstimateResult } from '@/estimate/types';
import { resetUiState, useUiStore } from '@/state/ui';
import { textDraft } from './drafts';
import { initialContext, timeSettings } from './mealTime';
import { ANSWER_FAILED_TOAST } from './ReviewScreen';
import { renderLogRoutes } from './testHarness';

type EstimateFn = (req: EstimateRequest, ctx: EstimateContext, opts?: EstimateMealOptions) => Promise<EstimateResult>;

const fake = vi.hoisted(() => ({ estimate: vi.fn<EstimateFn>() }));

vi.mock('@/estimate/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/estimate/service')>()),
  estimateMeal: (req: EstimateRequest, ctx: EstimateContext, opts?: EstimateMealOptions) => fake.estimate(req, ctx, opts),
}));

const QUESTION = 'How big was the glass?';

const COCONUT: MealItem = {
  id: 'ai-1',
  name: 'Iced coconut white coffee',
  unitMacros: { kcal: 430, proteinG: 4, carbsG: 50, fatG: 24 },
  quantity: 1,
  uncertainty: 0.3,
  source: 'aiGuess',
  question: 'Was it the large glass?',
};

function draftWithQuestion() {
  const kopi = { ...itemFromCatalogue(byId('kopi-ais')!, { id: 'kopi' }), question: QUESTION };
  useUiStore.getState().setReviewDraft({ ...textDraft('kopi ais', initialContext(now(), timeSettings(undefined))), items: [kopi] });
}

beforeEach(async () => {
  await resetAll();
  await loadDemoData();
  resetUiState();
  fake.estimate.mockReset();
  vi.stubEnv('VITE_ESTIMATE_URL', 'https://estimate.test/estimate');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('S11 follow-up answers', () => {
  it('estimates the item again from the typed answer and swaps in the result', async () => {
    const user = userEvent.setup();
    fake.estimate.mockResolvedValue({ items: [COCONUT], questions: [], unmatched: [], method: 'ai' });
    draftWithQuestion();
    renderLogRoutes(PATHS.review);

    await user.type(await screen.findByRole('textbox', { name: QUESTION }), 'Old Town, coconut milk, full glass');
    await user.click(screen.getByRole('button', { name: 'Update' }));

    expect(await screen.findByText('Iced coconut white coffee')).toBeInTheDocument();
    expect(screen.queryByText('Kopi ais')).not.toBeInTheDocument();
    // The answer closed the question; the AI's new one isn't asked.
    expect(screen.queryByText('Was it the large glass?')).not.toBeInTheDocument();
    expect(fake.estimate).toHaveBeenCalledWith(
      expect.objectContaining({ text: `Kopi ais (Normal). Asked: ${QUESTION} Answer: Old Town, coconut milk, full glass` }),
      expect.anything(),
      { mode: 'always' },
    );
  });

  it('keeps the item and its question when the AI could not use the answer', async () => {
    const user = userEvent.setup();
    fake.estimate.mockResolvedValue({ items: [], questions: [], unmatched: [], method: 'local', aiSkipped: 'timeout' });
    draftWithQuestion();
    renderLogRoutes(PATHS.review);

    await user.type(await screen.findByRole('textbox', { name: QUESTION }), 'large');
    await user.click(screen.getByRole('button', { name: 'Update' }));

    expect(await screen.findByText(ANSWER_FAILED_TOAST)).toBeInTheDocument();
    expect(screen.getByText('Kopi ais')).toBeInTheDocument();
    expect(screen.getByText(QUESTION)).toBeInTheDocument();
  });

  it('Skip closes the question without estimating', async () => {
    const user = userEvent.setup();
    draftWithQuestion();
    renderLogRoutes(PATHS.review);

    await user.click(await screen.findByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(screen.queryByText(QUESTION)).not.toBeInTheDocument());
    expect(useUiStore.getState().reviewDraft?.items[0]?.question).toBeUndefined();
    expect(fake.estimate).not.toHaveBeenCalled();
  });

  it('offers only Skip with no AI to answer', async () => {
    vi.stubEnv('VITE_ESTIMATE_URL', '');
    draftWithQuestion();
    renderLogRoutes(PATHS.review);

    expect(await screen.findByRole('button', { name: 'Skip' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: QUESTION })).not.toBeInTheDocument();
  });
});
