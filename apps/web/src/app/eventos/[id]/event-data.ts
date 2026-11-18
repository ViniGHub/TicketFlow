import { type EventResponse } from '@ticketflow/contracts';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { isUuid } from '../../../lib/catalog/view';
import { serverApi } from '../../../lib/server/api';

/**
 * O evento publicado, uma busca por requisição (o `cache` do React serve a página e os
 * metadados). Inexistente, em rascunho ou cancelado: 404, como na API.
 */
export const loadEvent = cache(async (id: string): Promise<EventResponse> => {
  if (!isUuid(id)) {
    notFound();
  }
  const { data, response } = await serverApi().GET('/events/{id}', {
    params: { path: { id } },
  });
  if (response.status === 404) {
    notFound();
  }
  if (!data) {
    throw new Error(`Evento indisponível (HTTP ${response.status}).`);
  }
  return data;
});
