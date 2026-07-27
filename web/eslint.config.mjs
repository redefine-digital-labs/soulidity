import nextPlugin from '@next/eslint-plugin-next'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'public/**',
    ],
  },
  {
    ...tseslint.configs.base,
    files: ['**/*.{ts,tsx}'],
  },
  nextPlugin.configs['core-web-vitals'],
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
  },
]

export default config
