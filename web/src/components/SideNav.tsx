"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/lib/nav";

function isActive(pathname: string, href: string): boolean {
  const path = pathname.endsWith("/") ? pathname : `${pathname}/`;
  if (path.startsWith(href)) return true;
  // Investigation pages are reached from Explore.
  return href === "/explore/" && path.startsWith("/investigations/");
}

export function SideNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Sections"
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-surface px-3 py-2 md:w-52 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:px-3 md:py-4"
    >
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium ${
              active ? "bg-accent-soft text-accent" : "text-muted hover:bg-canvas hover:text-ink"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
