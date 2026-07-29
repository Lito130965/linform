import js from '@eslint/js'
import globals from 'globals'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import tseslint from 'typescript-eslint'

/**
 * Lint config focused on one thing: accessibility regressions that are cheap
 * to catch mechanically and expensive to notice by hand.
 *
 * This is not a style gate. Formatting and general TypeScript hygiene are
 * already covered by `tsc --noEmit` and review; adding a second opinionated
 * ruleset would mostly generate churn. What tsc cannot see is a control with
 * no accessible name or a click handler on a div — exactly the things that
 * make an editor unusable with a screen reader, and exactly the things that
 * creep back in one component at a time.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'jsx-a11y': jsxA11y },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // --- the accessibility rules this config exists for ---
      'jsx-a11y/control-has-associated-label': [
        'error',
        { controlComponents: [], ignoreElements: ['audio', 'video'], depth: 3 },
      ],
      'jsx-a11y/no-static-element-interactions': 'error',
      'jsx-a11y/click-events-have-key-events': 'error',
      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/anchor-has-content': 'error',
      'jsx-a11y/aria-props': 'error',
      'jsx-a11y/aria-role': 'error',
      'jsx-a11y/label-has-associated-control': 'error',
      'jsx-a11y/role-has-required-aria-props': 'error',

      // --- deliberately relaxed ---
      // The editor stores its own types; `any` shows up in DOM plumbing where
      // the alternative is a cast that asserts the same thing less honestly.
      '@typescript-eslint/no-explicit-any': 'off',
      // tsc already reports unused locals (noUnusedLocals), with better spans.
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    // Tests describe DOM shapes and mock freely; the a11y rules are about the
    // shipped UI, not about fixtures.
    files: ['src/**/*.test.{ts,tsx}'],
    rules: { 'jsx-a11y/control-has-associated-label': 'off' },
  },
)
