import type { Rng } from '../../core/rng';

const ONSETS = ['', 'b', 'd', 'k', 'l', 'm', 'n', 'r', 's', 't', 'v', 'th', 'br', 'gr', 'st', 'h'];
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'a', 'o', 'ae', 'ei'];
const CODAS = ['', '', 'n', 'r', 'l', 's', 'th', 'nd', 'rk', 'm'];
const SUFFIXES = ['', '', '', 'holt', 'ford', 'mar', 'heim', 'ia', 'grad', 'port', 'vale'];

/** Generates unique, pronounceable place names. */
export function createNameGenerator(rng: Rng): () => string {
  const used = new Set<string>();
  return () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const syllables = rng.int(1, 2);
      let name = '';
      for (let s = 0; s < syllables; s++) {
        name += rng.pick(ONSETS) + rng.pick(VOWELS) + rng.pick(CODAS);
      }
      name += rng.pick(SUFFIXES);
      if (name.length < 4 || name.length > 11 || used.has(name)) continue;
      used.add(name);
      return name[0]!.toUpperCase() + name.slice(1);
    }
    const fallback = `Site ${used.size + 1}`;
    used.add(fallback);
    return fallback;
  };
}
