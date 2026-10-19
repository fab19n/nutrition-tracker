/**
 * Aliases that name one of the item's chips: "garlic naan" is the Garlic naan, "coke zero" the
 * zero-sugar can. Keyed by catalogue id, then by the normalised alias (see normaliseName), with
 * the chip label it picks. Typing the alias picks that chip as if the label had been typed.
 */
export const ALIAS_CHIPS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  naan: {
    'garlic naan': 'Garlic',
    'naan bawang putih': 'Garlic',
    'naan garlic': 'Garlic',
    'cheese naan': 'Cheese',
    'naan keju': 'Cheese',
    'naan cheese': 'Cheese',
  },
  'chicken-rice': {
    'nasi ayam panggang': 'Roasted',
    'roast chicken rice': 'Roasted',
    'roasted chicken rice': 'Roasted',
    'nasi ayam roast': 'Roasted',
    'nasi ayam stim': 'Steamed',
  },
  susu: {
    'low fat milk': 'Low fat',
    'susu rendah lemak': 'Low fat',
    'full cream milk': 'Full cream',
  },
  omelette: {
    '3 egg omelette': '3 eggs',
    'three egg omelette': '3 eggs',
    '2 egg omelette': '2 eggs',
    'two egg omelette': '2 eggs',
  },
  'soft-drink': {
    'coke zero': 'Zero sugar',
    'coca cola zero': 'Zero sugar',
    'pepsi zero': 'Zero sugar',
    'pepsi black': 'Zero sugar',
    'diet coke': 'Zero sugar',
    'sprite zero': 'Zero sugar',
  },
  'bubble-tea': {
    'brown sugar boba': '100% sugar',
    'tealive brown sugar': '100% sugar',
    'brown sugar milk tea': '100% sugar',
  },
};

/** The chip an alias names, if it names one. */
export function aliasChip(catalogueId: string, alias: string): string | undefined {
  return ALIAS_CHIPS[catalogueId]?.[alias];
}
