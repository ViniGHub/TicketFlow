import { type Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { isUuid } from '../../../lib/catalog/view';

import { OrderStatusPanel } from './order-status-panel';

export const metadata: Metadata = { title: 'Seu pedido' };

/** Para onde o Stripe devolve o comprador. Protegida pelo proxy: só com sessão (ADR 0016). */
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) {
    notFound();
  }
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <h1 className="text-2xl font-bold">Seu pedido</h1>
      {/* Suspense: o painel lê o ?checkout= da URL (useSearchParams). */}
      <Suspense>
        <OrderStatusPanel orderId={id} />
      </Suspense>
    </div>
  );
}
