import {
  Bot,
  BookOpen,
  History,
  LayoutDashboard,
  Network,
  Package,
  Printer,
  Settings,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type PageId =
  | "dashboard"
  | "ai-troubleshooter"
  | "network-center"
  | "printer-devices"
  | "windows-repair"
  | "software-center"
  | "learning-library"
  | "activity-logs"
  | "settings";

export type NavItem = {
  id: PageId;
  label: string;
  icon: LucideIcon;
  /** Shown in the header and on the page's placeholder. */
  description: string;
  /** False for modules that only show a placeholder so far. */
  available: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, description: "Overview of this computer and your recent work.", available: true },
  { id: "ai-troubleshooter", label: "AI Troubleshooter", icon: Bot, description: "Chat with Ralp, your offline AI troubleshooting assistant.", available: true },
  { id: "network-center", label: "Network Center", icon: Network, description: "Diagnose adapters, connectivity, DNS, and IP configuration.", available: true },
  { id: "printer-devices", label: "Printer & Devices", icon: Printer, description: "Inspect printers, drivers, and connected hardware.", available: false },
  { id: "windows-repair", label: "Windows Repair", icon: Wrench, description: "Run guided Windows maintenance and repair operations.", available: false },
  { id: "software-center", label: "Software Center", icon: Package, description: "Manage installers and essential technician software.", available: false },
  { id: "learning-library", label: "CSS Learning Library", icon: BookOpen, description: "Practical computer systems servicing references.", available: false },
  { id: "activity-logs", label: "Activity Logs", icon: History, description: "History of diagnostic and repair operations on this computer.", available: true },
  { id: "settings", label: "Settings", icon: Settings, description: "Application preferences and account options.", available: false },
];

export function navItem(id: PageId): NavItem {
  return NAV_ITEMS.find((item) => item.id === id) ?? NAV_ITEMS[0];
}
