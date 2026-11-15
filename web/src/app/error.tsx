"use client"; // Error boundaries must be Client Components.

import { useEffect } from "react";
import { buttonClass, ErrorState } from "@/components/States";

export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <ErrorState
      title="This page could not be shown"
      action={
        <button type="button" className={buttonClass} onClick={() => retry()}>
          Try again
        </button>
      }
    >
      Something went wrong while showing this page. The science data is unchanged.
    </ErrorState>
  );
}
