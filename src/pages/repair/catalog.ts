// The Windows Repair tools shown on the page. Each entry names the real
// Windows tool the backend runs for it (src-tauri/src/windows_repair).

import type { RepairId } from "../../lib/api";

export type RepairGroup = "system" | "update" | "recovery" | "cleanup";

export type RepairImpact = "safe" | "restart" | "changes";

export type WindowsRepair = {
  id: RepairId;
  group: RepairGroup;
  title: string;
  /** What it does, in plain words. */
  description: string;
  /** The Windows tool or command behind it, for the technician. */
  tool: string;
  duration: string;
  admin: boolean;
  impact: RepairImpact;
  /** Asked before running, for repairs that change settings or restart. */
  confirm?: string;
};

export const REPAIR_GROUPS: { id: RepairGroup; title: string; description: string }[] = [
  { id: "system", title: "System files & disk", description: "Find and replace damaged Windows files, and check the disk and memory." },
  { id: "update", title: "Windows Update", description: "Fix updates that fail, hang or keep reinstalling." },
  { id: "recovery", title: "Startup & recovery", description: "Restore points, System Restore, Safe Mode and the recovery environment." },
  { id: "cleanup", title: "Cleanup", description: "Free space and clear caches that cause slowdowns or display glitches." },
];

export const WINDOWS_REPAIRS: WindowsRepair[] = [
  {
    id: "dism-restore",
    group: "system",
    title: "Repair the Windows image",
    description: "Checks the component store that Windows uses to repair itself and fixes it, downloading clean files from Windows Update if needed.",
    tool: "DISM /Online /Cleanup-Image /RestoreHealth",
    duration: "10–30 min",
    admin: true,
    impact: "safe",
  },
  {
    id: "sfc",
    group: "system",
    title: "Scan and repair system files",
    description: "Checks every protected Windows file and replaces any that are damaged or missing.",
    tool: "sfc /scannow",
    duration: "10–20 min",
    admin: true,
    impact: "safe",
  },
  {
    id: "chkdsk-scan",
    group: "system",
    title: "Check the disk for errors",
    description: "Scans the file system on the Windows drive for errors without taking it offline. Fixes are scheduled for the next restart if needed.",
    tool: "chkdsk C: /scan",
    duration: "5–15 min",
    admin: true,
    impact: "safe",
  },
  {
    id: "memory-test",
    group: "system",
    title: "Test the memory",
    description: "Schedules Windows Memory Diagnostic to run once at the next restart, before Windows starts. You restart when you are ready; the result appears after you sign in.",
    tool: "bcdedit /bootsequence {memdiag}",
    duration: "15–30 min",
    admin: true,
    impact: "restart",
    confirm: "The memory test runs the next time this computer restarts and takes 15–30 minutes before Windows starts. Nothing restarts now.",
  },
  {
    id: "wu-reset",
    group: "update",
    title: "Reset Windows Update components",
    description: "Stops the update services, renames the download and catalog folders so Windows rebuilds them, and starts the services again.",
    tool: "wuauserv, bits, cryptsvc · SoftwareDistribution, catroot2",
    duration: "2–5 min",
    admin: true,
    impact: "changes",
    confirm:
      "Windows Update services stop for a moment and the update folders are renamed (kept, not deleted), so Windows forgets its update history list and checks again from scratch. Don't run this while updates are installing.",
  },
  {
    id: "wu-cache",
    group: "update",
    title: "Clear the update download cache",
    description: "Deletes partly downloaded updates so Windows downloads them again cleanly.",
    tool: "C:\\Windows\\SoftwareDistribution\\Download",
    duration: "1–2 min",
    admin: true,
    impact: "safe",
  },
  {
    id: "wu-services",
    group: "update",
    title: "Restart the update services",
    description: "Restarts Windows Update, Background Intelligent Transfer and Cryptographic services, which often unsticks a frozen update.",
    tool: "wuauserv · bits · cryptsvc",
    duration: "Under 1 min",
    admin: true,
    impact: "safe",
  },
  {
    id: "restore-point",
    group: "recovery",
    title: "Create a restore point",
    description: "Saves the current system settings so you can roll back if a repair or install goes wrong. Do this before other repairs.",
    tool: "System Protection (Checkpoint-Computer)",
    duration: "1–3 min",
    admin: true,
    impact: "safe",
  },
  {
    id: "system-restore",
    group: "recovery",
    title: "Open System Restore",
    description: "Opens Windows' System Restore to return system files and settings to an earlier point. Personal files are kept.",
    tool: "rstrui.exe",
    duration: "15–45 min",
    admin: true,
    impact: "restart",
  },
  {
    id: "advanced-startup",
    group: "recovery",
    title: "Restart to Advanced Startup",
    description: "Restarts into the Windows Recovery Environment for Startup Repair, System Restore, uninstalling updates or Safe Mode.",
    tool: "shutdown /r /o",
    duration: "Restart",
    admin: true,
    impact: "restart",
    confirm: "This computer restarts right away. Save work and close programs first; Windows asks programs to close normally.",
  },
  {
    id: "safe-mode",
    group: "recovery",
    title: "Start in Safe Mode next time",
    description: "Makes Windows start in Safe Mode, with only essential drivers, to remove a bad driver or program. It stays on until you return to normal startup.",
    tool: "bcdedit /set {current} safeboot minimal",
    duration: "Restart",
    admin: true,
    impact: "changes",
    confirm:
      "Every restart goes to Safe Mode until you choose \"Return to normal startup\". Networking is off in Safe Mode. Nothing restarts now. If you use BitLocker, have the recovery key ready.",
  },
  {
    id: "safe-mode-off",
    group: "recovery",
    title: "Return to normal startup",
    description: "Turns Safe Mode off again, so Windows starts normally at the next restart.",
    tool: "bcdedit /deletevalue {current} safeboot",
    duration: "Under 1 min",
    admin: true,
    impact: "safe",
  },
  {
    id: "temp-files",
    group: "cleanup",
    title: "Clear temporary files",
    description: "Removes temporary files older than a day from your temp folder and Windows' own. Newer files and files in use are left alone.",
    tool: "%TEMP% · C:\\Windows\\Temp",
    duration: "1–5 min",
    admin: true,
    impact: "safe",
  },
  {
    id: "optimize-drives",
    group: "cleanup",
    title: "Optimise drives",
    description: "Defragments hard drives and sends TRIM to SSDs: the right method for each drive.",
    tool: "defrag C: /O /U /V",
    duration: "5–60 min",
    admin: true,
    impact: "safe",
  },
  {
    id: "icon-cache",
    group: "cleanup",
    title: "Rebuild the icon cache",
    description: "Fixes blank or wrong icons by asking Windows to refresh its icon cache. No programs are closed.",
    tool: "ie4uinit.exe -show",
    duration: "Under 1 min",
    admin: false,
    impact: "safe",
  },
  {
    id: "store-cache",
    group: "cleanup",
    title: "Reset the Microsoft Store cache",
    description: "Clears the Store's cache when apps will not download or update.",
    tool: "wsreset.exe",
    duration: "Under 1 min",
    admin: false,
    impact: "safe",
  },
];

/** The recommended order for a full repair, from least to most involved. */
export const FULL_REPAIR: { repair: RepairId; why: string }[] = [
  { repair: "restore-point", why: "So every later change can be undone." },
  { repair: "dism-restore", why: "Fixes the store SFC repairs from." },
  { repair: "sfc", why: "Replaces damaged system files using the repaired store." },
  { repair: "chkdsk-scan", why: "Rules out file system errors." },
];

export const FULL_REPAIR_CONFIRM =
  "Creates a restore point, then repairs the Windows image, scans system files and checks the disk. It usually takes 30–60 minutes; keep VocaTechX open and the computer plugged in. Nothing restarts.";
