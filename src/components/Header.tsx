import { WifiOff } from "lucide-react";
import type { SessionUser } from "../lib/api";

type HeaderProps = {
  title: string;
  subtitle: string;
  user: SessionUser;
};

export function Header({ title, subtitle, user }: HeaderProps) {
  const initials = user.username.slice(0, 2).toUpperCase();
  const roleLabel = user.role === "admin" ? "Administrator" : "Technician";

  return (
    <header className="flex items-center justify-between gap-6 border-b border-[#e3e8ef] bg-white px-8 py-4">
      <div className="min-w-0">
        <h1 className="m-0 truncate text-xl font-bold tracking-[-0.5px] text-[#172033]">{title}</h1>
        <p className="m-0 mt-0.5 truncate text-xs text-[#788397]">
          Welcome back, <span className="font-semibold text-[#344054]">{user.username}</span> · {subtitle}
        </p>
      </div>

      <div className="flex flex-shrink-0 items-center gap-4">
        <span
          className="flex items-center gap-2 rounded-full border border-[#d1fadf] bg-[#ecfdf3] px-3 py-1.5 text-[11px] font-semibold text-[#067647]"
          title="VocaTechX features run on this computer and do not require an internet connection."
        >
          <WifiOff size={13} />
          Works offline
        </span>

        <div className="flex items-center gap-3 border-l border-[#e3e8ef] pl-4">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-[#e7efff] text-xs font-bold text-[#2563eb]">
            {initials}
          </div>
          <div className="leading-tight">
            <p className="m-0 text-[13px] font-semibold text-[#172033]">{user.username}</p>
            <p className="m-0 text-[11px] text-[#788397]">{roleLabel}</p>
          </div>
        </div>
      </div>
    </header>
  );
}
