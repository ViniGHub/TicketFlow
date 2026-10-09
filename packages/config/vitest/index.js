// Presets do Vitest compartilhados pelos pacotes.
//
// Convenção de nomes:
//   *.spec.ts      -> testes unitários          (pnpm test)
//   *.int-spec.ts  -> testes de integração      (pnpm test:integration, exigem Docker)
import swc from 'unplugin-swc';
import { defineConfig, mergeConfig } from 'vitest/config';

const unitInclude = ['src/**/*.spec.{ts,tsx}'];
const integrationInclude = ['src/**/*.int-spec.{ts,tsx}'];

/**
 * Configuração base com dois projetos: `unit` e `integration`.
 * @param {import('vitest/config').UserConfig} [overrides]
 */
export function defineVitestConfig(overrides = {}) {
  return mergeConfig(
    defineConfig({
      test: {
        passWithNoTests: true,
        projects: [
          { extends: true, test: { name: 'unit', include: unitInclude } },
          {
            extends: true,
            test: {
              name: 'integration',
              include: integrationInclude,
              testTimeout: 60_000,
              hookTimeout: 120_000,
            },
          },
        ],
      },
    }),
    overrides,
  );
}

/**
 * Preset para apps NestJS: o esbuild (padrão do Vite) não emite metadata de decorators,
 * da qual a injeção de dependência do Nest depende. O SWC emite.
 * @param {import('vitest/config').UserConfig} [overrides]
 */
export function defineNestVitestConfig(overrides = {}) {
  return defineVitestConfig(
    mergeConfig(
      {
        oxc: false,
        plugins: [swc.vite({ module: { type: 'es6' } })],
      },
      overrides,
    ),
  );
}
