import obsidianmd from 'eslint-plugin-obsidianmd';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import globals from 'globals';
import { defineConfig } from 'eslint/config';

export default defineConfig(
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname
      },
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser
      }
    },
    plugins: {
      '@typescript-eslint': tseslint
    }
  },
  ...obsidianmd.configs.recommended
);
