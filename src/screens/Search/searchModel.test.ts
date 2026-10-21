import { NavigationType } from 'react-router';
import { PATHS } from '@/app/paths';
import { SEARCH_QUERY_MAX } from '@/domain/search';
import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_PAGE_SIZE,
  cleanQuery,
  countLabel,
  dayHeading,
  forgetSearchView,
  noResultsCopy,
  parseSearchParams,
  peekSearchView,
  rememberSearchView,
  searchPath,
  shownCaption,
  showMoreLabel,
  withSearchView,
} from './searchModel';

const params = (search: string) => new URLSearchParams(search);

afterEach(() => {
  forgetSearchView();
});

describe('constants', () => {
  it('pages by 30 and waits 200 ms after the last key', () => {
    expect(SEARCH_PAGE_SIZE).toBe(30);
    expect(SEARCH_DEBOUNCE_MS).toBe(200);
  });
});

describe('parseSearchParams', () => {
  it('reads the text, the slot and the Place', () => {
    expect(parseSearchParams(params('q=teh+tarik&slot=dinner&place=place-home'))).toEqual({ q: 'teh tarik', slot: 'dinner', placeId: 'place-home' });
  });

  it('is an empty view without params, with no filter keys set', () => {
    const view = parseSearchParams(params(''));
    expect(view).toEqual({ q: '' });
    expect(view).not.toHaveProperty('slot');
    expect(view).not.toHaveProperty('placeId');
  });

  it('ignores a slot that is not a meal slot', () => {
    expect(parseSearchParams(params('slot=brunch'))).toEqual({ q: '' });
    expect(parseSearchParams(params('slot=DINNER'))).toEqual({ q: '' });
    expect(parseSearchParams(params('slot='))).toEqual({ q: '' });
  });

  it('collapses runs of spaces in the text and clips it to 80 characters', () => {
    expect(parseSearchParams(params('q=%20%20teh%20%20%20tarik%20')).q).toBe('teh tarik');
    const long = parseSearchParams(params(`q=${'a'.repeat(200)}`)).q;
    expect(long).toHaveLength(SEARCH_QUERY_MAX);
    expect(long).toBe('a'.repeat(80));
  });

  it('reads punctuation only as no text', () => {
    expect(parseSearchParams(params('q=%21%21')).q).toBe('');
  });

  it('keeps a Place id of 1 to 100 characters and ignores anything else', () => {
    expect(parseSearchParams(params(`place=${'p'.repeat(100)}`)).placeId).toBe('p'.repeat(100));
    expect(parseSearchParams(params(`place=${'p'.repeat(101)}`))).toEqual({ q: '' });
    expect(parseSearchParams(params('place='))).toEqual({ q: '' });
  });
});

describe('withSearchView', () => {
  it('sets the three params', () => {
    const next = withSearchView(params(''), { q: 'teh tarik', slot: 'supper', placeId: 'p1' });
    expect(next.get('q')).toBe('teh tarik');
    expect(next.get('slot')).toBe('supper');
    expect(next.get('place')).toBe('p1');
  });

  it('removes what is empty or unset', () => {
    const next = withSearchView(params('q=teh&slot=lunch&place=p1'), { q: '' });
    expect(next.toString()).toBe('');
  });

  it('keeps every other param, such as an open sheet', () => {
    const next = withSearchView(params('sheet=log&q=old'), { q: 'new', slot: 'snack' });
    expect(next.get('sheet')).toBe('log');
    expect(next.get('q')).toBe('new');
    expect(next.get('slot')).toBe('snack');
    expect(withSearchView(params('sheet=log&q=old'), { q: '' }).toString()).toBe('sheet=log');
  });

  it('does not change the params it is given', () => {
    const original = params('q=old');
    withSearchView(original, { q: 'new' });
    expect(original.get('q')).toBe('old');
  });
});

describe('searchPath', () => {
  it('is the bare path without a view', () => {
    expect(searchPath()).toBe('/diary/search');
    expect(searchPath()).toBe(PATHS.search);
    expect(searchPath({})).toBe(PATHS.search);
    expect(searchPath({ q: '' })).toBe(PATHS.search);
  });

  it('writes q, slot and place in that order', () => {
    expect(searchPath({ q: 'teh tarik' })).toBe('/diary/search?q=teh+tarik');
    expect(searchPath({ q: 'teh tarik', slot: 'dinner', placeId: 'p1' })).toBe('/diary/search?q=teh+tarik&slot=dinner&place=p1');
    expect(searchPath({ placeId: 'p1', slot: 'dinner' })).toBe('/diary/search?slot=dinner&place=p1');
  });

  it('round-trips through parseSearchParams', () => {
    const view = { q: 'ayam & kari', slot: 'lunch' as const, placeId: 'place-kedai' };
    const url = searchPath(view);
    expect(parseSearchParams(new URLSearchParams(url.split('?')[1]))).toEqual(view);
  });
});

describe('cleanQuery', () => {
  it('trims and collapses whitespace', () => {
    expect(cleanQuery('  teh   tarik ')).toBe('teh tarik');
    expect(cleanQuery('teh\ttarik\n')).toBe('teh tarik');
  });

  it('is empty when there is no letter or digit', () => {
    expect(cleanQuery('!!')).toBe('');
    expect(cleanQuery('  ')).toBe('');
    expect(cleanQuery(' ? ! ')).toBe('');
  });

  it('keeps non-Latin text and digits', () => {
    expect(cleanQuery('叉烧饭')).toBe('叉烧饭');
    expect(cleanQuery('teh 2')).toBe('teh 2');
  });

  it('clips to 80 characters', () => {
    expect(cleanQuery('x'.repeat(200))).toHaveLength(80);
  });
});

describe('dayHeading', () => {
  it('says Today and Yesterday', () => {
    expect(dayHeading('2026-10-16', '2026-10-16')).toBe('Fri 16 Oct · Today');
    expect(dayHeading('2026-10-15', '2026-10-16')).toBe('Thu 15 Oct · Yesterday');
  });

  it('is the plain weekday and date for other days this year', () => {
    expect(dayHeading('2026-10-14', '2026-10-16')).toBe('Wed 14 Oct');
    expect(dayHeading('2026-01-02', '2026-10-16')).toBe('Fri 2 Jan');
  });

  it('adds the year for another year', () => {
    expect(dayHeading('2025-11-03', '2026-10-16')).toBe('Mon 3 Nov 2025');
  });

  it('lets Yesterday win at a year boundary', () => {
    expect(dayHeading('2025-12-31', '2026-01-01')).toBe('Wed 31 Dec · Yesterday');
    expect(dayHeading('2025-12-30', '2026-01-01')).toBe('Tue 30 Dec 2025');
  });
});

describe('labels', () => {
  it('counts meals', () => {
    expect(countLabel(0)).toBe('0 meals');
    expect(countLabel(1)).toBe('1 meal');
    expect(countLabel(12)).toBe('12 meals');
    expect(countLabel(1204)).toBe('1,204 meals');
  });

  it('offers the next page, and only what is left on the last one', () => {
    expect(showMoreLabel(82 - 60)).toBe('Show 22 more');
    expect(showMoreLabel(100)).toBe('Show 30 more');
    expect(showMoreLabel(30)).toBe('Show 30 more');
    expect(showMoreLabel(1)).toBe('Show 1 more');
  });

  it('says how many are shown', () => {
    expect(shownCaption(30, 212)).toBe('Showing 30 of 212');
    expect(shownCaption(1000, 1204)).toBe('Showing 1,000 of 1,204');
  });
});

describe('noResultsCopy', () => {
  it('for text with no filters, asks for fewer words and offers no action', () => {
    expect(noResultsCopy({ q: 'teh tarek' })).toEqual({
      headline: 'No meals match “teh tarek”',
      body: 'Try fewer words, or a dish, drink or Place name.',
    });
  });

  it('for text with a slot or a Place, offers to clear the filters', () => {
    const withSlot = noResultsCopy({ q: 'teh tarek', slot: 'supper' });
    expect(withSlot).toEqual({ headline: 'No meals match “teh tarek”', body: 'Try fewer words, or take off the filters.', actionLabel: 'Clear filters' });
    expect(noResultsCopy({ q: 'teh tarek', placeId: 'p1' })).toEqual(withSlot);
  });

  it('for filters only, says so', () => {
    expect(noResultsCopy({ q: '', slot: 'snack', placeId: 'nope' })).toEqual({
      headline: 'No meals with these filters',
      body: 'Take a filter off to see more.',
      actionLabel: 'Clear filters',
    });
  });

  it('clips a long query in the headline with an ellipsis', () => {
    const copy = noResultsCopy({ q: 'x'.repeat(60) });
    expect(copy.headline).toBe(`No meals match “${'x'.repeat(39)}…”`);
  });

  it('has no apology, blame or exclamation', () => {
    for (const view of [{ q: 'zzzz' }, { q: 'zzzz', slot: 'lunch' as const }, { q: '', placeId: 'p' }]) {
      const copy = noResultsCopy(view);
      expect(`${copy.headline} ${copy.body} ${copy.actionLabel ?? ''}`).not.toMatch(/please|sorry|!|successfully/i);
    }
  });
});

describe('the Back memory', () => {
  const view = { search: '?q=teh+tarik&slot=dinner', shown: 60, scrollY: 640 };

  it('is returned for a POP to the same search', () => {
    rememberSearchView(view);
    expect(peekSearchView('?q=teh+tarik&slot=dinner', NavigationType.Pop)).toEqual(view);
  });

  it('is not returned for a PUSH or a REPLACE', () => {
    rememberSearchView(view);
    expect(peekSearchView(view.search, NavigationType.Push)).toBeUndefined();
    expect(peekSearchView(view.search, NavigationType.Replace)).toBeUndefined();
  });

  it('is not returned for another search', () => {
    rememberSearchView(view);
    expect(peekSearchView('?q=kangkung', NavigationType.Pop)).toBeUndefined();
    expect(peekSearchView('', NavigationType.Pop)).toBeUndefined();
  });

  it('is gone after forgetSearchView, and nothing is remembered to begin with', () => {
    expect(peekSearchView(view.search, NavigationType.Pop)).toBeUndefined();
    rememberSearchView(view);
    forgetSearchView();
    expect(peekSearchView(view.search, NavigationType.Pop)).toBeUndefined();
  });

  it('is not cleared by looking (StrictMode reads twice)', () => {
    rememberSearchView(view);
    expect(peekSearchView(view.search, NavigationType.Pop)).toEqual(view);
    expect(peekSearchView(view.search, NavigationType.Pop)).toEqual(view);
  });

  it('keeps only the latest view', () => {
    rememberSearchView(view);
    rememberSearchView({ search: '?q=medan', shown: 30, scrollY: 0 });
    expect(peekSearchView(view.search, NavigationType.Pop)).toBeUndefined();
    expect(peekSearchView('?q=medan', NavigationType.Pop)).toMatchObject({ shown: 30 });
  });

  it('does not touch any browser storage', () => {
    const before = localStorage.length + sessionStorage.length;
    rememberSearchView(view);
    peekSearchView(view.search, NavigationType.Pop);
    forgetSearchView();
    expect(localStorage.length + sessionStorage.length).toBe(before);
  });
});
