import { defineVitestConfig } from '@ticketflow/config/vitest';

export default defineVitestConfig({
  test: {
    // `pnpm test` roda com --coverage: o CI falha se a máquina de estados do pedido perder
    // cobertura (ROADMAP, etapa 3.1).
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/**/*.int-spec.ts'],
      reporter: ['text'],
      thresholds: {
        'src/order-status.ts': { 100: true },
      },
    },
  },
});
