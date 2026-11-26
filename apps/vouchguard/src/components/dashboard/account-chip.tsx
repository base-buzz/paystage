"use client";

import { ChevronDown, KeyRound, LogOut, UserRound } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Fake-but-labelled account chip. There is no auth yet, and the label says so in the
 * trigger itself, not only after opening the menu.
 */
export function AccountChip() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-full border border-ink/10 bg-paper py-1 pl-1 pr-2.5 text-left shadow-sm outline-none transition-colors hover:bg-ink/[0.03] focus-visible:ring-2 focus-visible:ring-deep">
        <Avatar className="h-8 w-8">
          <AvatarFallback>D</AvatarFallback>
        </Avatar>
        <span className="hidden flex-col leading-tight sm:flex">
          <span className="text-xs font-semibold text-ink">Demo account</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted">not signed in</span>
        </span>
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 text-muted" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>
          <span className="block text-sm">Demo account</span>
          <span className="block text-xs font-normal text-muted">No authentication is wired up.</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <UserRound className="h-4 w-4" />
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <KeyRound className="h-4 w-4" />
          Sign in — not implemented
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <LogOut className="h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
