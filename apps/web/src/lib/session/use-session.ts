'use client';

import { type LoginRequest, type MeResponse, type RegisterRequest } from '@ticketflow/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, unwrap } from '../api/client';
import { ApiError } from '../api/errors';

// Sessão no navegador (ROADMAP, etapa 6.1; ADR 0016). Nada fica em localStorage: a sessão
// são os cookies httpOnly, e o front só sabe quem está logado perguntando a /me.

export const SESSION_QUERY_KEY = ['session'] as const;

/** O usuário logado, ou `null` sem sessão (o 401 já passou pela tentativa de renovar). */
export async function fetchSession(): Promise<MeResponse | null> {
  try {
    return await unwrap(api.GET('/me'));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

export function useSession() {
  return useQuery({ queryKey: SESSION_QUERY_KEY, queryFn: fetchSession, staleTime: 60_000 });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginRequest) => unwrap(api.POST('/auth/login', { body })),
    onSuccess: (user) => queryClient.setQueryData(SESSION_QUERY_KEY, user),
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RegisterRequest) => unwrap(api.POST('/auth/register', { body })),
    onSuccess: (user) => queryClient.setQueryData(SESSION_QUERY_KEY, user),
  });
}

/**
 * Tenta renovar a sessão com o cookie de refresh, sem pedir a senha. O login chama isto antes
 * de mostrar o formulário: o proxy manda para lá quem chegou sem access token válido.
 */
export function useSilentRefresh() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST('/auth/refresh')),
    onSuccess: (user) => queryClient.setQueryData(SESSION_QUERY_KEY, user),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST('/auth/logout')),
    // Mesmo com erro (sessão que já tinha acabado), o front esquece o usuário.
    onSettled: () => {
      queryClient.setQueryData(SESSION_QUERY_KEY, null);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
    },
  });
}
