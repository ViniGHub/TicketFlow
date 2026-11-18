import { type Metadata } from 'next';

import { AccountDetails } from './account-details';

export const metadata: Metadata = { title: 'Minha conta' };

/** Protegida pelo proxy: só com sessão (ADR 0016). */
export default function AccountPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Minha conta</h1>
      <AccountDetails />
    </div>
  );
}
