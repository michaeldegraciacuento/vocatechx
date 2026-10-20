import { useState } from "react";
import { Header } from "../components/Header";
import { Sidebar } from "../components/Sidebar";
import { useAuth } from "../auth/context";
import { navItem, type PageId } from "../navigation";
import ActivityLogsPage from "../pages/ActivityLogsPage";
import AiTroubleshooterPage from "../pages/AiTroubleshooterPage";
import DashboardPage from "../pages/DashboardPage";
import NetworkCenterPage from "../pages/NetworkCenterPage";
import PlaceholderPage from "../pages/PlaceholderPage";
import PrinterDevicesPage from "../pages/PrinterDevicesPage";

/** Shell for every protected page. Only rendered for an active session (see App). */
function AppLayout() {
  const { user, logout } = useAuth();
  const [page, setPage] = useState<PageId>("dashboard");

  if (!user) return null;
  const item = navItem(page);

  let content;
  switch (page) {
    case "dashboard":
      content = <DashboardPage onNavigate={setPage} />;
      break;
    case "ai-troubleshooter":
      content = <AiTroubleshooterPage />;
      break;
    case "network-center":
      content = <NetworkCenterPage />;
      break;
    case "printer-devices":
      content = <PrinterDevicesPage />;
      break;
    case "activity-logs":
      content = <ActivityLogsPage />;
      break;
    default:
      content = <PlaceholderPage item={item} onNavigate={setPage} />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#f7f9fc]">
      <Sidebar activePage={page} onNavigate={setPage} onLogout={() => logout()} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header title={item.label} subtitle={item.description} user={user} />
        <main key={page} className="flex-1 overflow-y-auto px-8 py-7">
          <div className="mx-auto max-w-[1280px]">{content}</div>
        </main>
      </div>
    </div>
  );
}

export default AppLayout;
