"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, ArrowLeft, Settings, WalletCards } from "lucide-react";

import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/dashboard", label: "Passes", icon: WalletCards, exact: true },
  { href: "/dashboard/activity", label: "Activity", icon: Activity, exact: false },
  { href: "/dashboard/settings", label: "Settings", icon: Settings, exact: false },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Dashboard" className="flex gap-1 overflow-x-auto md:flex-col hide-scrollbar">
      {ITEMS.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium no-underline transition-colors",
              active ? "bg-deep text-paper" : "text-ink/75 hover:bg-ink/5 hover:text-ink",
            )}
          >
            <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
      <Link
        href="/"
        className="mt-1 hidden items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted no-underline transition-colors hover:bg-ink/5 hover:text-ink md:inline-flex"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4 shrink-0" />
        Public site
      </Link>
    </nav>
  );
}
