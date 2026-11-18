import Link from 'next/link';

import { type EventCardView } from '../../lib/catalog/view';

export function EventCard({ event }: { event: EventCardView }) {
  return (
    <Link
      href={`/eventos/${event.id}`}
      className="group flex flex-1 flex-col gap-2 rounded-card border border-line bg-surface p-5 shadow-sm transition-colors hover:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <span className="text-sm font-medium text-brand">{event.dateLabel}</span>
      <span className="text-lg font-semibold leading-snug group-hover:text-brand">
        {event.title}
      </span>
      <span className="text-sm text-muted">{event.venue}</span>
    </Link>
  );
}
