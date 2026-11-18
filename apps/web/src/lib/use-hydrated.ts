import { useSyncExternalStore } from 'react';

const subscribe = () => () => undefined;

/**
 * `false` na renderização do servidor e durante a hidratação; `true` depois. O que depende de
 * estado que só existe no navegador (a sessão, lida de /me) espera por isto: senão o primeiro
 * HTML do navegador pode sair diferente do servidor, e o React descarta a árvore (erro de
 * hidratação). Acontece quando outra parte da página, já hidratada, buscou a sessão antes.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
