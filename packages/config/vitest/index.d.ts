import type { UserConfig } from 'vitest/config';

export interface VitestPresetOptions {
  /** Arquivos de globalSetup executados só no projeto de integração. */
  integrationGlobalSetup?: string[];
}

export declare function defineVitestConfig(
  overrides?: UserConfig,
  options?: VitestPresetOptions,
): UserConfig;

export declare function defineNestVitestConfig(
  overrides?: UserConfig,
  options?: VitestPresetOptions,
): UserConfig;
