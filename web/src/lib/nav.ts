export interface NavItem {
  href: string;
  label: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/scenario/", label: "Scenario" },
  { href: "/explore/", label: "Explore" },
  { href: "/compare/", label: "Compare" },
  { href: "/gaps/", label: "Gaps" },
  { href: "/earth/", label: "Earth applications" },
  { href: "/about/", label: "About" },
];
