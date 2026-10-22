import type { InstallState, InstallerType } from "../../lib/api";

export const INSTALLER_TYPES: { id: InstallerType; label: string }[] = [
  { id: "msi", label: "Windows Installer (MSI)" },
  { id: "inno", label: "Inno Setup" },
  { id: "nsis", label: "Nullsoft (NSIS)" },
  { id: "burn", label: "WiX Burn bundle" },
  { id: "custom", label: "Other (enter switches)" },
];

/** Whether an app in this state is worth selecting by "Select all". */
export function needsInstall(state: InstallState | undefined): boolean {
  return state !== "up_to_date" && state !== "newer_installed";
}

/** Whether Windows lists the app as installed, so it can be uninstalled. */
export function isInstalled(state: InstallState | undefined): boolean {
  return state !== undefined && state !== "not_installed";
}
