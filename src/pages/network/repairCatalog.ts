import type { RepairAction } from "../../lib/api";

export type RepairInfo = {
  action: RepairAction;
  title: string;
  /** What it fixes, in plain language. */
  fixes: string;
  /** What it does to the computer. */
  effect: string;
  admin: boolean;
  restart: boolean;
  /** Impactful repairs get an extra warning in the confirmation. */
  impact: "low" | "medium" | "high";
};

export const REPAIRS: RepairInfo[] = [
  {
    action: "flush_dns",
    title: "Flush DNS cache",
    fixes: "Websites that moved or fail to load while others work; outdated or wrong name lookups.",
    effect: "Clears remembered name lookups (ipconfig /flushdns). Nothing else changes.",
    admin: false,
    restart: false,
    impact: "low",
  },
  {
    action: "renew_dhcp",
    title: "Renew DHCP IP address",
    fixes: "A 169.254.x.x address, an IP conflict, or no connection after changing networks.",
    effect: "Asks the router for a fresh IP address (ipconfig /renew). The connection drops for a few seconds.",
    admin: true,
    restart: false,
    impact: "medium",
  },
  {
    action: "reset_winsock",
    title: "Reset Winsock",
    fixes: "Programs cannot connect even though the network is up, often after malware or a broken VPN/proxy install.",
    effect: "Restores the Winsock catalog to defaults (netsh winsock reset). Some VPN or security software may need reinstalling.",
    admin: true,
    restart: true,
    impact: "high",
  },
  {
    action: "reset_tcpip",
    title: "Reset TCP/IP stack",
    fixes: "Persistent connection failures that other repairs did not fix.",
    effect: "Resets TCP/IP settings to defaults (netsh int ip reset). Static IP addresses are cleared and must be re-entered.",
    admin: true,
    restart: true,
    impact: "high",
  },
  {
    action: "start_sharing_services",
    title: "Start file sharing services",
    fixes: "Shared folders cannot be opened or offered because the Workstation or Server service is stopped.",
    effect:
      "Sets the Workstation and Server services to start automatically and starts them now. If the Workstation service's registry registration is damaged (ServiceDll missing), it is restored to the Windows default first.",
    admin: true,
    restart: false,
    impact: "medium",
  },
];

export function repairInfo(action: RepairAction): RepairInfo {
  return REPAIRS.find((r) => r.action === action) ?? REPAIRS[0];
}
