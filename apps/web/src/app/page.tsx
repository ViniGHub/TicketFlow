export default function HomePage() {
  return (
    <section className="flex flex-col gap-4 py-10">
      <h1 className="text-4xl font-bold tracking-tight">
        Ticket<span className="text-brand">Flow</span>
      </h1>
      <p className="max-w-2xl text-lg text-muted">
        Venda de ingressos para eventos pequenos, com pagamento seguro e check-in por QR code.
      </p>
      <p className="text-sm text-muted">O catálogo de eventos chega na próxima etapa.</p>
    </section>
  );
}
