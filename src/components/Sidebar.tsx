import { LogOut } from "lucide-react";
import vocatechxLogo from "../assets/vocatechx-app-icon.png";
import { NAV_ITEMS, type PageId } from "../navigation";

type SidebarProps = {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
  onLogout: () => void;
};

export function Sidebar({ activePage, onNavigate, onLogout }: SidebarProps) {
  return (
    <aside className="flex h-screen w-[248px] flex-shrink-0 flex-col bg-[#101827] text-white">
      <div className="flex items-center gap-3 border-b border-[#1f2b3d] px-6 py-6">
        <div className="grid h-9 w-9 place-items-center rounded-[10px] bg-[#1b2a40]">
          <img src={vocatechxLogo} alt="" className="h-6 w-6 object-contain" />
        </div>
        <div className="leading-tight">
          <p className="m-0 text-base font-extrabold tracking-[1px]">VocaTechX</p>
          <p className="m-0 text-[9px] font-semibold tracking-[1.2px] text-[#94a3b8]">CSS TOOLKIT</p>
        </div>
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-5">
        <p className="mb-2 px-3 text-[9px] font-bold tracking-[1.5px] text-[#5f6f87]">MENU</p>
        <ul className="m-0 grid list-none gap-1 p-0">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
            const active = id === activePage;
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => onNavigate(id)}
                  aria-current={active ? "page" : undefined}
                  className={`flex w-full cursor-pointer items-center gap-3 rounded-[9px] border-none px-3 py-2.5 text-left text-[13px] font-medium transition-colors ${
                    active
                      ? "bg-[#1d3557] text-white shadow-[inset_3px_0_0_#3b82f6]"
                      : "bg-transparent text-[#aab7ca] hover:bg-[#162235] hover:text-white"
                  }`}
                >
                  <Icon size={18} className={active ? "text-[#60a5fa]" : ""} />
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-[#1f2b3d] p-3">
        <button
          type="button"
          onClick={onLogout}
          className="flex w-full cursor-pointer items-center gap-3 rounded-[9px] border-none bg-transparent px-3 py-2.5 text-[13px] font-medium text-[#aab7ca] transition-colors hover:bg-[#2a1a22] hover:text-[#fca5a5]"
        >
          <LogOut size={18} />
          Log out
        </button>
      </div>
    </aside>
  );
}
