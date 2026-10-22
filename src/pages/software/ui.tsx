import {
  Archive,
  ArrowLeftRight,
  Clapperboard,
  Code,
  Cpu,
  FileText,
  Globe,
  MessageSquare,
  Package,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { SoftwareStatus } from "../../lib/api";
import { Badge } from "../network/ui";

// Shared building blocks (Panel, Dialog, Badge, buttons…) come from
// "../network/ui" so every module looks the same; this file adds only the
// Software Center specifics. Non-component helpers live in ./catalog.

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Browsers: Globe,
  Compression: Archive,
  Media: Clapperboard,
  Documents: FileText,
  Development: Code,
  Utilities: Wrench,
  "File transfer": ArrowLeftRight,
  Communication: MessageSquare,
  Runtimes: Cpu,
  Security: ShieldCheck,
};

export function CategoryIcon({ category, size }: { category: string; size: number }) {
  const Icon = CATEGORY_ICONS[category] ?? Package;
  return <Icon size={size} />;
}

/** The install-state pill on an app tile. Text, not colour alone, carries the meaning. */
export function StateBadge({ status, version }: { status: SoftwareStatus | undefined; version: string | null }) {
  if (!status) return <Badge tone="neutral">Checking…</Badge>;
  const have = status.installedVersion;
  switch (status.state) {
    case "not_installed":
      return <Badge tone="neutral">Not installed</Badge>;
    case "up_to_date":
      return <Badge tone="ok">Installed · up to date</Badge>;
    case "update_available":
      return <Badge tone="info">Update: {have} → {version}</Badge>;
    case "newer_installed":
      return <Badge tone="warn">Newer version installed ({have})</Badge>;
    case "installed":
      return <Badge tone="ok">Installed{have ? ` · ${have}` : ""}</Badge>;
  }
}
