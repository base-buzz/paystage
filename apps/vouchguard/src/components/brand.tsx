import Link from "next/link";

import { brand } from "@/lib/brand-config";
import { cn } from "@/lib/utils";

/**
 * The mark is the pass icon from the shared artwork (a rounded square with a gold rule),
 * deliberately not the PayStage mark: this is a sibling brand, not a sub-brand. The text
 * beside it comes from `brand.json` (`wordmark`), so a fork renames without a component edit.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/pass/icon@2x.png"
      alt=""
      width={58}
      height={58}
      className={cn("h-8 w-8 rounded-md", className)}
    />
  );
}

export function Brand({
  href = "/",
  showIssuer = false,
  className,
}: {
  href?: string;
  showIssuer?: boolean;
  className?: string;
}) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2.5 text-ink no-underline", className)}>
      <BrandMark />
      <span className="flex flex-col leading-none">
        <span className="text-[17px] font-bold tracking-tight">{brand.wordmark}</span>
        {showIssuer ? (
          <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
            vouched by PayStage
          </span>
        ) : null}
      </span>
    </Link>
  );
}
