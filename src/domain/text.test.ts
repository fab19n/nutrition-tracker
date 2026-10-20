import { clipText } from './text';

/** A UTF-16 surrogate without its partner: what a cut by code unit leaves of an emoji. */
const LONE_SURROGATE = /\p{Cs}/u;

describe('clipText', () => {
  it('leaves text that fits as it is', () => {
    expect(clipText('Teh tarik', 60)).toBe('Teh tarik');
    expect(clipText('Teh tarik ', 10)).toBe('Teh tarik ');
    expect(clipText('', 5, '…')).toBe('');
  });

  it('cuts to the length, ellipsis included, and drops the spaces the cut leaves', () => {
    expect(clipText('a'.repeat(60), 48, '…')).toBe(`${'a'.repeat(47)}…`);
    expect(clipText('nasi lemak bungkus', 11)).toBe('nasi lemak');
    expect(clipText('nasi lemak bungkus', 12, '…')).toBe('nasi lemak…');
  });

  it('counts an emoji as one character and never cuts one in half', () => {
    expect(clipText(`${'a'.repeat(59)}🍜🍜 kopi`, 60)).toBe(`${'a'.repeat(59)}🍜`);
    expect(clipText(`${'a'.repeat(46)}🍜🍜🍜`, 48, '…')).toBe(`${'a'.repeat(46)}🍜…`);
    // 30 emoji are 60 code units but 30 characters: they fit.
    expect(clipText('🍜'.repeat(30), 30)).toBe('🍜'.repeat(30));
    expect(clipText('🍜'.repeat(31), 30)).toBe('🍜'.repeat(30));
    for (let max = 1; max < 12; max += 1) expect(clipText('🍜x🍜🍜y🍜🍜', max, '…')).not.toMatch(LONE_SURROGATE);
  });
});
