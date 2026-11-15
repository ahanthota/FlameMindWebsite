import Link from "next/link";
import { buttonClass, EmptyState } from "@/components/States";

export default function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      action={
        <Link href="/explore/" className={buttonClass}>
          Go to Explore
        </Link>
      }
    >
      There is no page at this address. Investigation pages use the PSI id, for example /investigations/PSI-26/.
    </EmptyState>
  );
}
