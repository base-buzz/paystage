import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * VouchGuard's own mark. It is the pass icon from the shared artwork (a rounded square with
 * a gold rule), deliberately not the PayStage mark: this is a sibling brand, not a sub-brand.
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
        <span className="text-[17px] font-bold tracking-tight">VouchGuard</span>
        {showIssuer ? (
          <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
            vouched by PayStage
          </span>
        ) : null}
      </span>
    </Link>
  );
}
