import { ArrowLeft, Construction } from "lucide-react";
import type { NavItem, PageId } from "../navigation";
import { cardClass } from "../styles";

type PlaceholderPageProps = {
  item: NavItem;
  onNavigate: (page: PageId) => void;
};

/** Shown for modules that are not built yet, so nothing pretends to work. */
function PlaceholderPage({ item, onNavigate }: PlaceholderPageProps) {
  const Icon = item.icon;
  return (
    <div className={`${cardClass} flex flex-col items-center justify-center gap-4 px-8 py-16 text-center`}>
      <div className="relative">
        <span className="grid h-16 w-16 place-items-center rounded-2xl bg-[#101827] text-[#7db5ff]">
          <Icon size={30} />
        </span>
        <span className="absolute -right-2 -bottom-2 grid h-7 w-7 place-items-center rounded-full border-2 border-white bg-[#fef3c7] text-[#b45309]">
          <Construction size={14} />
        </span>
      </div>

      <div className="grid max-w-[440px] gap-2">
        <span className="mx-auto rounded-full bg-[#fef3c7] px-2.5 py-0.5 text-[10px] font-bold tracking-[1px] text-[#b45309]">
          IN DEVELOPMENT
        </span>
        <h2 className="m-0 text-xl font-bold tracking-[-0.4px] text-[#172033]">{item.label}</h2>
        <p className="m-0 text-[13px] leading-[1.7] text-[#788397]">{item.description}</p>
        <p className="m-0 text-xs leading-[1.7] text-[#8b95a6]">
          This module is not available yet. It will be enabled in a future VocaTechX update.
        </p>
      </div>

      <button
        type="button"
        onClick={() => onNavigate("dashboard")}
        className="mt-2 flex cursor-pointer items-center gap-2 rounded-[9px] border border-[#dce2eb] bg-white px-4 py-2.5 text-xs font-semibold text-[#344054] hover:bg-[#f7f9fc]"
      >
        <ArrowLeft size={14} /> Back to dashboard
      </button>
    </div>
  );
}

export default PlaceholderPage;
