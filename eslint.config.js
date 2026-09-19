import js from '@eslint/js'
import globals from 'globals'
import { defineConfig } from 'eslint/config'

export default defineConfig([
    {
        rules: {
            curly: ['error', 'all'],
            'brace-style': ['error', 'stroustrup', { allowSingleLine: false }],
            'max-len': ['warn', {
                code: 80,
                tabWidth: 4,
                ignoreUrls: true,
                ignoreStrings: true,
                ignoreTemplateLiterals: true,
                ignoreRegExpLiterals: true
            }]
        }
    },
    {
        files: ['**/*.{js,mjs,cjs}'],
        plugins: { js },
        extends: ['js/recommended'],
        languageOptions: { globals: globals.browser }
    }
])
