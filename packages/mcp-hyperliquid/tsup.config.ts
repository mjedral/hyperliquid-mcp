import { defineConfig } from 'tsup';

export default defineConfig([
    // Library build
    {
        entry: ['src/index.ts'],
        format: ['cjs', 'esm'],
        dts: true,
        splitting: false,
        sourcemap: true,
        clean: true,
        minify: false,
        target: 'es2022',
        outDir: 'dist',
        tsconfig: './tsconfig.build.json',
    },
    // CLI build
    {
        entry: ['src/bin/hl-mcp.ts'],
        format: ['cjs'],
        dts: false,
        splitting: false,
        sourcemap: true,
        clean: false,
        minify: false,
        target: 'es2022',
        outDir: 'dist/bin',
        tsconfig: './tsconfig.build.json',
        banner: {
            js: '#!/usr/bin/env node',
        },
    },
]);