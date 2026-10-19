import type { CatalogueItem } from '@/domain/types';
import { dish, macros, scaled } from '../define';

/** Nasi lemak: the bungkus, plated variants and the add-ons people order on top. */
export const NASI_LEMAK: CatalogueItem[] = [
  dish({
    id: 'nasi-lemak-bungkus',
    name: 'Nasi lemak bungkus',
    aliases: ['nasi lemak', 'nasi lemak biasa', 'nasi lemak kosong', 'nlb', 'nasi lemak daun pisang'],
    category: 'rice',
    unit: 'a bungkus',
    variants: scaled(macros(490, 13, 60, 22), [
      ['1 bungkus', 490, 200],
      ['2 bungkus', 980, 400],
    ]),
    uncertainty: 0.2,
    note: 'Small wrapped pack: coconut rice, sambal, ikan bilis, kacang, half an egg and timun.',
  }),
  dish({
    id: 'nasi-lemak-ayam-goreng',
    name: 'Nasi lemak ayam goreng',
    aliases: ['nasi lemak ayam', 'nasi lemak ayam berempah', 'nasi lemak with fried chicken'],
    category: 'rice',
    unit: 'a plate',
    variants: scaled(macros(800, 35, 80, 38), [
      ['Normal', 800],
      ['Tambah nasi', 930],
    ]),
    uncertainty: 0.25,
    note: 'Coconut rice, sambal, egg, ikan bilis, kacang and a fried chicken piece.',
    swaps: ['nasi-lemak-bungkus'],
  }),
  dish({
    id: 'nasi-lemak-rendang',
    name: 'Nasi lemak rendang',
    aliases: ['nasi lemak rendang daging', 'nasi lemak rendang ayam'],
    category: 'rice',
    unit: 'a plate',
    variants: scaled(macros(720, 28, 78, 33), [
      ['Normal', 720],
      ['Tambah nasi', 850],
    ]),
    uncertainty: 0.25,
    note: 'Coconut rice and sides with a scoop of rendang.',
    swaps: ['nasi-lemak-bungkus'],
  }),
  dish({
    id: 'nasi-lemak-sotong',
    name: 'Nasi lemak sotong',
    aliases: ['nasi lemak sambal sotong', 'nasi lemak squid'],
    category: 'rice',
    unit: 'a plate',
    variants: scaled(macros(640, 25, 75, 26.5), [
      ['Normal', 640],
      ['Tambah nasi', 770],
    ]),
    uncertainty: 0.25,
    note: 'Coconut rice and sides with sambal sotong.',
    swaps: ['nasi-lemak-bungkus'],
  }),
  dish({
    id: 'nasi-lemak-telur',
    name: 'Nasi lemak telur mata',
    aliases: ['nasi lemak telur', 'nasi lemak telur goreng', 'nasi lemak fried egg'],
    category: 'rice',
    unit: 'a plate',
    variants: scaled(macros(580, 17, 66, 27.5), [
      ['Normal', 580],
      ['Tambah nasi', 710],
    ]),
    uncertainty: 0.2,
    note: 'Coconut rice and sides with a fried egg.',
    swaps: ['nasi-lemak-bungkus'],
  }),
  dish({
    id: 'sambal',
    name: 'Sambal',
    aliases: ['extra sambal', 'tambah sambal', 'sambal tumis', 'sambal nasi lemak'],
    category: 'gravy',
    unit: 'a scoop',
    variants: scaled(macros(90, 1, 8, 6), [
      ['Sikit', 45, 20],
      ['1 scoop', 90, 40],
    ]),
    defaultVariant: 1,
    uncertainty: 0.25,
    note: 'Sweet chilli sambal cooked in oil, about 2 tbsp a scoop.',
  }),
  dish({
    id: 'ikan-bilis-kacang',
    name: 'Ikan bilis + kacang',
    aliases: ['ikan bilis', 'ikan bilis goreng', 'kacang ikan bilis', 'anchovies and peanuts'],
    category: 'snack',
    unit: 'a scoop',
    variants: scaled(macros(150, 8, 5, 11), [['1 scoop', 150, 30]]),
    uncertainty: 0.2,
    note: 'Fried anchovies with peanuts, about 30 g.',
  }),
];
