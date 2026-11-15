import Link from "next/link";
import { AccountSlot } from "./AccountSlot";

export function TopBar() {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-4 border-b border-line bg-surface px-4 sm:px-6">
      <Link href="/home/" className="flex items-baseline gap-3">
        <span className="text-lg font-semibold tracking-tight text-accent">FlameMind</span>
        <span className="hidden text-sm text-muted sm:inline">Fire safety insights for living beyond Earth</span>
      </Link>
      <div data-slot="account" className="ml-auto flex min-h-8 items-center">
        <AccountSlot />
      </div>
    </header>
  );
}
