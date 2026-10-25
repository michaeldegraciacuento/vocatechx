import { isRemoved, type SimState } from "./engine";
import type { PartId } from "./parts";

/** A short live status for each part, shown in the parts list. */
export function partStatus(id: PartId, s: SimState): string | null {
  switch (id) {
    case "power-cord":
      return s.power ? "Plugged in" : "Unplugged";
    case "esd-strap":
      return s.esd ? "Worn" : "Not worn";
    case "side-panel":
      return s.sidePanel ? "Fitted" : "Removed";
    case "ram-1":
    case "ram-2":
      return s.ram[id].slot ? `In slot ${s.ram[id].slot}` : s.ram[id].orientation === "aligned" ? "On the mat · notch aligned" : "On the mat · turned around";
    case "cpu":
      return s.cpu.installed ? (s.socketOpen ? "In socket · socket open" : "In socket") : s.cpu.orientation === "aligned" ? "On the mat · aligned" : "On the mat · rotated";
    case "cooler":
      if (!s.cooler.installed) return "On the mat";
      return [!s.cooler.screws && "screws loose", !s.cooler.fan && "fan unplugged"].filter(Boolean).join(" · ") || "Mounted";
    case "gpu":
      if (!s.gpu.installed) return "On the mat";
      return [!s.gpu.power && "power off", !s.gpu.screws && "no screws", !s.pcieLatch && "latch open"].filter(Boolean).join(" · ") || "Installed";
    case "m2":
      return s.m2.installed ? (s.m2.screw ? "Installed" : "Not secured") : "On the mat";
    case "sata-ssd":
      if (!s.sata.installed) return "On the mat";
      return [!s.sata.data && "no data cable", !s.sata.power && "no power", !s.sata.screws && "no screws"].filter(Boolean).join(" · ") || "Installed";
    case "psu":
      if (!s.psu.installed) return "On the mat";
      return s.psu.screws ? "Installed" : "Screws out";
    case "atx-24pin":
      return s.psu.installed ? (s.atx24 ? "Connected" : "Unplugged") : "With the PSU";
    case "eps-8pin":
      return s.psu.installed ? (s.eps8 ? "Connected" : "Unplugged") : "With the PSU";
    case "sata-data":
      return s.sata.installed && s.sata.data ? "Connected" : "Unplugged";
    case "sata-power":
      return s.psu.installed ? (s.sata.installed && s.sata.power ? "Connected" : "Unplugged") : "With the PSU";
    case "pcie-power":
      return s.psu.installed ? (s.gpu.installed && s.gpu.power ? "Connected" : "Unplugged") : "With the PSU";
    default:
      return isRemoved(id, s) ? "Removed" : null;
  }
}
