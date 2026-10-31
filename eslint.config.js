import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  { languageOptions: { globals: globals.browser } },
  {
    // core/ and sim/ must stay renderer- and DOM-agnostic so they can run in a
    // Web Worker and in Vitest (DESIGN.md §4), and must be deterministic.
    files: ['src/core/**/*.ts', 'src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['three', 'three/*', '**/render/**', '**/ui/**', '**/input/**'],
              message: 'core/ and sim/ must not depend on rendering, UI or input code.',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', 'window', 'document'],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use a seeded Rng from core/rng.' },
      ],
    },
  },
  prettier,
);
