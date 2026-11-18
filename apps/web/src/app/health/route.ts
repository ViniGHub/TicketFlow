// Saúde do próprio front, para o healthcheck do container: não depende da API nem do banco.
// A página inicial (o catálogo) busca a API a cada visita e não serve para isso: com a API fora,
// o front ficaria "unhealthy" e seria reiniciado sem ter culpa.
export const dynamic = 'force-static';

export function GET(): Response {
  return Response.json({ status: 'ok' });
}
