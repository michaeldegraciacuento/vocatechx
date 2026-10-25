import { RAM_IDS, RAM_SLOTS, type PartId, type RamId, type RamSlot } from "./parts";

// The simulation's rules. Pure TypeScript with no 3D code: the 3D scene, the
// no-3D mode and the tests all drive this. Every action is checked in the
// same order a technician should think: safety first, then access, then
// whether the part is free to move. Anything that would mean forcing a part is
// refused with an explanation, never quietly accepted.

export type Orientation = "aligned" | "reversed";

export type SimState = {
  /** The power cord is plugged in. */
  power: boolean;
  /** Wearing a grounded wrist strap. */
  esd: boolean;
  /** The side panel is fitted. */
  sidePanel: boolean;
  ram: Record<RamId, { slot: RamSlot | null; orientation: Orientation }>;
  /** Open retention clips, per slot. */
  ramClipsOpen: Record<RamSlot, boolean>;
  gpu: { installed: boolean; screws: boolean; power: boolean };
  /** The PCIe slot's retention latch is locked. */
  pcieLatch: boolean;
  cooler: { installed: boolean; screws: boolean; fan: boolean };
  /** Thermal paste on the CPU: fresh, old (after removing the cooler) or none. */
  paste: "applied" | "old" | "none";
  cpu: { installed: boolean; orientation: Orientation };
  /** The socket's load plate and lever are open. */
  socketOpen: boolean;
  /** The M.2 drive, and the screw that holds it (it sits in the standoff when no drive is fitted). */
  m2: { installed: boolean; screw: boolean };
  /** The PSU's cables plugged into the motherboard: main 24-pin and CPU 8-pin. */
  atx24: boolean;
  eps8: boolean;
  /** The 2.5-inch SATA SSD: its screws and its two cables. */
  sata: { installed: boolean; screws: boolean; data: boolean; power: boolean };
  /** The power supply and the screws holding it to the back of the case. */
  psu: { installed: boolean; screws: boolean };
};

/** A fully assembled, plugged-in computer with the side panel on. */
export const ASSEMBLED: SimState = {
  power: true,
  esd: false,
  sidePanel: true,
  ram: { "ram-1": { slot: "A2", orientation: "aligned" }, "ram-2": { slot: "B2", orientation: "aligned" } },
  ramClipsOpen: { A1: false, A2: false, B1: false, B2: false },
  gpu: { installed: true, screws: true, power: true },
  pcieLatch: true,
  cooler: { installed: true, screws: true, fan: true },
  paste: "applied",
  cpu: { installed: true, orientation: "aligned" },
  socketOpen: false,
  m2: { installed: true, screw: true },
  atx24: true,
  eps8: true,
  sata: { installed: true, screws: true, data: true, power: true },
  psu: { installed: true, screws: true },
};

export type Action =
  | { type: "unplug-power" }
  | { type: "plug-in-power" }
  | { type: "wear-esd" }
  | { type: "remove-esd" }
  | { type: "remove-side-panel" }
  | { type: "install-side-panel" }
  | { type: "open-ram-clips"; slot: RamSlot }
  | { type: "remove-ram"; part: RamId }
  | { type: "insert-ram"; part: RamId; slot: RamSlot }
  | { type: "turn-around"; part: RamId | "cpu" }
  | { type: "disconnect-gpu-power" }
  | { type: "connect-gpu-power" }
  | { type: "remove-gpu-screws" }
  | { type: "install-gpu-screws" }
  | { type: "release-pcie-latch" }
  | { type: "remove-gpu" }
  | { type: "insert-gpu" }
  | { type: "disconnect-cooler-fan" }
  | { type: "connect-cooler-fan" }
  | { type: "loosen-cooler-screws" }
  | { type: "tighten-cooler-screws" }
  | { type: "remove-cooler" }
  | { type: "clean-paste" }
  | { type: "apply-paste" }
  | { type: "install-cooler" }
  | { type: "open-socket" }
  | { type: "close-socket" }
  | { type: "remove-cpu" }
  | { type: "insert-cpu" }
  | { type: "remove-m2-screw" }
  | { type: "install-m2-screw" }
  | { type: "remove-m2" }
  | { type: "insert-m2" }
  | { type: "disconnect-atx24" }
  | { type: "connect-atx24" }
  | { type: "disconnect-eps8" }
  | { type: "connect-eps8" }
  | { type: "disconnect-sata-data" }
  | { type: "connect-sata-data" }
  | { type: "disconnect-sata-power" }
  | { type: "connect-sata-power" }
  | { type: "remove-ssd-screws" }
  | { type: "install-ssd-screws" }
  | { type: "remove-ssd" }
  | { type: "insert-ssd" }
  | { type: "remove-psu-screws" }
  | { type: "install-psu-screws" }
  | { type: "remove-psu" }
  | { type: "install-psu" }
  | { type: "identify"; part: PartId };

export type ActionType = Action["type"];

/** Why an action was refused. "forcing" means the real action would damage something. */
export type ErrorKind = "safety" | "order" | "forcing" | "invalid";

export type Result = { ok: true; state: SimState; message: string } | { ok: false; kind: ErrorKind; message: string };

const ok = (state: SimState, message: string): Result => ({ ok: true, state, message });
const no = (kind: ErrorKind, message: string): Result => ({ ok: false, kind, message });

/** Actions that do not touch anything inside the case. */
const OUTSIDE: ActionType[] = ["unplug-power", "plug-in-power", "wear-esd", "remove-esd", "install-side-panel", "identify"];

export function slotOf(state: SimState, slot: RamSlot): RamId | null {
  return RAM_IDS.find((id) => state.ram[id].slot === slot) ?? null;
}

/** What still needs doing before the computer can safely be powered on. */
export function unfinished(state: SimState): string[] {
  const todo: string[] = [];
  if (!state.sidePanel) todo.push("refit the side panel");
  if (!state.cpu.installed) todo.push("install the CPU");
  else if (state.socketOpen) todo.push("close the CPU socket");
  if (!state.cooler.installed) todo.push("install the CPU cooler");
  else {
    if (!state.cooler.screws) todo.push("tighten the cooler's screws");
    if (!state.cooler.fan) todo.push("reconnect the cooler fan to CPU_FAN");
  }
  if (RAM_IDS.every((id) => state.ram[id].slot === null)) todo.push("install at least one RAM module");
  if (RAM_SLOTS.some((s) => state.ramClipsOpen[s] && slotOf(state, s))) todo.push("seat the RAM until its clips close");
  if (state.gpu.installed && !state.gpu.screws) todo.push("refit the graphics card's bracket screws");
  if (state.gpu.installed && !state.gpu.power) todo.push("reconnect the graphics card's power cable");
  if (state.m2.installed && !state.m2.screw) todo.push("secure the M.2 drive with its screw");
  if (!state.psu.installed) todo.push("install the power supply");
  else {
    if (!state.psu.screws) todo.push("fit the power supply's screws");
    if (!state.atx24) todo.push("connect the 24-pin ATX cable");
    if (!state.eps8) todo.push("connect the 8-pin CPU cable");
  }
  if (state.sata.installed) {
    if (!state.sata.screws) todo.push("fit the SSD's screws");
    if (!state.sata.data) todo.push("connect the SSD's SATA data cable");
    if (!state.sata.power) todo.push("connect the SSD's SATA power cable");
  }
  return todo;
}

const NO_PSU = "Install the power supply first; this cable comes from it.";

export function apply(state: SimState, action: Action): Result {
  if (action.type === "identify") return ok(state, "");

  // Safety first: nothing inside the case while it is plugged in.
  if (!OUTSIDE.includes(action.type) && state.power) {
    return no("safety", "Unplug the power cord first. The power supply still feeds standby power to the motherboard while it is plugged in.");
  }
  const inside = !OUTSIDE.includes(action.type) && action.type !== "remove-side-panel";
  if (inside && state.sidePanel) return no("order", "Remove the side panel first to reach the components.");
  if (inside && !state.esd) {
    return no("safety", "Put on your anti-static wrist strap and clip it to bare metal on the case before touching components.");
  }

  const s = structuredClone(state);
  switch (action.type) {
    case "unplug-power":
      if (!s.power) return no("invalid", "The power cord is already unplugged.");
      s.power = false;
      return ok(s, "Unplugged. Pressing the power button now drains the power left in the motherboard.");

    case "plug-in-power": {
      if (s.power) return no("invalid", "The power cord is already plugged in.");
      const todo = unfinished(s);
      if (todo.length) return no("order", `Not ready to power on yet: ${todo.join(", ")}.`);
      s.power = true;
      return ok(s, "Plugged back in. The computer is ready to start.");
    }

    case "wear-esd":
      if (s.esd) return no("invalid", "You are already wearing the wrist strap.");
      s.esd = true;
      return ok(s, "Wrist strap on and clipped to bare metal. You are now grounded.");

    case "remove-esd":
      if (!s.esd) return no("invalid", "You are not wearing the wrist strap.");
      s.esd = false;
      return ok(s, "Wrist strap removed.");

    case "remove-side-panel":
      if (!s.sidePanel) return no("invalid", "The side panel is already off.");
      s.sidePanel = false;
      return ok(s, "Side panel removed and laid flat. Glass panels can shatter if dropped.");

    case "install-side-panel":
      if (s.sidePanel) return no("invalid", "The side panel is already fitted.");
      s.sidePanel = true;
      return ok(s, "Side panel refitted and its thumbscrews tightened.");

    case "open-ram-clips": {
      if (s.ramClipsOpen[action.slot]) return no("invalid", `Slot ${action.slot}'s clips are already open.`);
      s.ramClipsOpen[action.slot] = true;
      const module = slotOf(s, action.slot);
      return ok(s, module ? `Clips on ${action.slot} pushed open. The module has popped up slightly.` : `Clips on ${action.slot} are open, ready for a module.`);
    }

    case "remove-ram": {
      const slot = s.ram[action.part].slot;
      if (!slot) return no("invalid", "That module is not installed.");
      if (!s.ramClipsOpen[slot]) {
        return no("forcing", `Slot ${slot}'s retention clips are still closed. Pulling the module now can crack the slot. Push the clips open first.`);
      }
      s.ram[action.part] = { slot: null, orientation: "reversed" };
      return ok(s, "Lifted straight out by the edges and set on the anti-static mat. Check the notch before reinstalling.");
    }

    case "turn-around": {
      const item = action.part === "cpu" ? s.cpu : s.ram[action.part];
      const installed = action.part === "cpu" ? s.cpu.installed : s.ram[action.part].slot !== null;
      if (installed) return no("invalid", "Remove it first; installed parts are not turned.");
      item.orientation = item.orientation === "aligned" ? "reversed" : "aligned";
      if (action.part === "cpu") {
        return ok(s, item.orientation === "aligned" ? "The gold triangle now lines up with the socket's mark." : "The gold triangle no longer lines up with the socket's mark.");
      }
      return ok(s, item.orientation === "aligned" ? "The notch now lines up with the slot's key." : "The notch no longer lines up with the slot's key.");
    }

    case "insert-ram": {
      if (s.ram[action.part].slot) return no("invalid", "That module is already installed.");
      const occupant = slotOf(s, action.slot);
      if (occupant) return no("invalid", `Slot ${action.slot} already has a module in it.`);
      if (!s.ramClipsOpen[action.slot]) return no("order", `Open slot ${action.slot}'s retention clips before inserting the module.`);
      if (s.ram[action.part].orientation !== "aligned") {
        return no("forcing", "The notch does not line up with the key in the slot, so the module will not go in. Turn it around. Never force a module.");
      }
      s.ram[action.part].slot = action.slot;
      s.ramClipsOpen[action.slot] = false;
      return ok(s, `Pressed down evenly at both ends until the clips clicked shut. The module is seated in ${action.slot}.`);
    }

    case "disconnect-gpu-power":
      if (!s.gpu.installed || !s.gpu.power) return no("invalid", "The graphics card's power cable is not connected.");
      s.gpu.power = false;
      return ok(s, "Pressed the cable's latch and pulled the 8-pin PCIe plug straight out.");

    case "connect-gpu-power":
      if (!s.gpu.installed) return no("invalid", "Install the graphics card first.");
      if (!s.psu.installed) return no("order", NO_PSU);
      if (s.gpu.power) return no("invalid", "The power cable is already connected.");
      s.gpu.power = true;
      return ok(s, "8-pin PCIe cable pushed in until its latch clicked.");

    case "remove-gpu-screws":
      if (!s.gpu.installed || !s.gpu.screws) return no("invalid", "There are no bracket screws to remove.");
      s.gpu.screws = false;
      return ok(s, "Bracket screws removed and kept safe. Support the card now: nothing holds it at the back.");

    case "install-gpu-screws":
      if (!s.gpu.installed) return no("invalid", "Install the graphics card first.");
      if (s.gpu.screws) return no("invalid", "The bracket screws are already in.");
      s.gpu.screws = true;
      return ok(s, "Bracket screws refitted. The card is held firmly at the back of the case.");

    case "release-pcie-latch":
      if (!s.gpu.installed) return no("invalid", "There is no card in the slot.");
      if (!s.pcieLatch) return no("invalid", "The slot latch is already released.");
      s.pcieLatch = false;
      return ok(s, "Slot latch pressed down and released. Latch designs vary: some push down, some slide sideways.");

    case "remove-gpu":
      if (!s.gpu.installed) return no("invalid", "The graphics card is not installed.");
      if (s.gpu.power) return no("forcing", "The power cable is still connected. Pulling the card would damage the connector. Disconnect it first.");
      if (s.gpu.screws) return no("forcing", "The bracket screws still hold the card to the case. Remove them first.");
      if (s.pcieLatch) return no("forcing", "The PCIe slot latch is still locked. Pulling now can break the slot. Release the latch first.");
      s.gpu.installed = false;
      return ok(s, "Card lifted out evenly, supported along its length, and laid on the mat.");

    case "insert-gpu":
      if (s.gpu.installed) return no("invalid", "The graphics card is already installed.");
      s.gpu = { installed: true, screws: false, power: false };
      s.pcieLatch = true;
      return ok(s, "Card lined up with the slot and pressed in until the latch clicked. Now refit the bracket screws and the power cable.");

    case "disconnect-cooler-fan":
      if (!s.cooler.installed || !s.cooler.fan) return no("invalid", "The cooler fan is not connected.");
      s.cooler.fan = false;
      return ok(s, "Fan cable unplugged from the CPU_FAN header, pulling the plug, not the wires.");

    case "connect-cooler-fan":
      if (!s.cooler.installed) return no("invalid", "Install the cooler first.");
      if (s.cooler.fan) return no("invalid", "The fan is already connected.");
      s.cooler.fan = true;
      return ok(s, "Fan cable connected to CPU_FAN. Without it the motherboard may refuse to start or the CPU may overheat.");

    case "loosen-cooler-screws":
      if (!s.cooler.installed || !s.cooler.screws) return no("invalid", "The cooler's screws are already loose.");
      s.cooler.screws = false;
      return ok(s, "Screws loosened a few turns at a time in a cross (diagonal) pattern, so the cooler lifts evenly.");

    case "tighten-cooler-screws":
      if (!s.cooler.installed) return no("invalid", "Install the cooler first.");
      if (s.cooler.screws) return no("invalid", "The screws are already tight.");
      s.cooler.screws = true;
      return ok(s, "Screws tightened in a cross pattern, a little at a time, until snug. Do not overtighten.");

    case "remove-cooler":
      if (!s.cooler.installed) return no("invalid", "The cooler is not installed.");
      if (s.cooler.fan) return no("order", "The fan cable is still plugged into CPU_FAN. Disconnect it first so it is not pulled loose.");
      if (s.cooler.screws) return no("forcing", "The mounting screws are still tight. Pulling now can crack the board or rip the CPU from its socket.");
      s.cooler.installed = false;
      s.paste = s.paste === "applied" ? "old" : s.paste;
      return ok(s, "Cooler twisted gently to break the paste's grip and lifted straight up. Old paste remains on the CPU.");

    case "clean-paste":
      if (s.cooler.installed) return no("order", "Remove the cooler first to reach the old paste.");
      if (s.paste === "none") return no("invalid", "The CPU is already clean.");
      if (s.paste === "applied") return no("invalid", "That paste is fresh; you only clean off old paste.");
      s.paste = "none";
      return ok(s, "Old paste wiped off the CPU and the cooler base with isopropyl alcohol and a lint-free cloth.");

    case "apply-paste":
      if (s.cooler.installed) return no("order", "Remove the cooler first.");
      if (!s.cpu.installed) return no("order", "Install the CPU first; paste goes on the CPU's top surface.");
      if (s.paste === "old") return no("order", "Clean off the old paste first. Never put new paste on top of old.");
      if (s.paste === "applied") return no("invalid", "Paste is already applied. Too much paste can spill onto the socket.");
      s.paste = "applied";
      return ok(s, "A pea-sized dot of paste placed in the centre of the CPU. The cooler's pressure will spread it.");

    case "install-cooler":
      if (s.cooler.installed) return no("invalid", "The cooler is already installed.");
      if (!s.cpu.installed) return no("order", "Install the CPU first.");
      if (s.socketOpen) return no("order", "Close the socket's load plate and lever first.");
      if (s.paste !== "applied") {
        return no("order", s.paste === "old" ? "Clean off the old paste and apply fresh paste first." : "Apply thermal paste first. Without it the CPU overheats.");
      }
      s.cooler = { installed: true, screws: false, fan: false };
      return ok(s, "Cooler lowered straight down onto the CPU, lined up with the mounting posts. Now tighten its screws.");

    case "open-socket":
      if (s.cooler.installed) return no("order", "Remove the CPU cooler first; it covers the socket.");
      if (s.socketOpen) return no("invalid", "The socket is already open.");
      s.socketOpen = true;
      return ok(s, "Lever pressed down, unhooked and raised; load plate lifted. Do not touch the socket pins.");

    case "close-socket":
      if (!s.socketOpen) return no("invalid", "The socket is already closed.");
      s.socketOpen = false;
      return ok(s, s.cpu.installed ? "Load plate lowered and lever locked under its hook. Firm resistance here is normal." : "Socket closed. Fit the plastic socket cover if no CPU will be installed.");

    case "remove-cpu":
      if (!s.cpu.installed) return no("invalid", "The CPU is not installed.");
      if (s.cooler.installed) return no("order", "Remove the CPU cooler first.");
      if (!s.socketOpen) return no("forcing", "The load plate still clamps the CPU. Open the lever and load plate first, or you will bend the socket pins.");
      s.cpu = { installed: false, orientation: "reversed" };
      s.paste = "none";
      return ok(s, "CPU lifted straight up by its edges and placed in a protective tray, contacts up.");

    case "insert-cpu":
      if (s.cpu.installed) return no("invalid", "The CPU is already installed.");
      if (!s.socketOpen) return no("order", "Open the socket's lever and load plate first.");
      if (s.cpu.orientation !== "aligned") {
        return no("forcing", "The gold triangle and the notches do not line up with the socket. Turn the CPU around. It must drop in without any pressure.");
      }
      s.cpu.installed = true;
      return ok(s, "CPU lowered straight down. It dropped into place on its own, with no pressure.");

    case "remove-m2-screw":
      if (!s.m2.screw) return no("invalid", "The M.2 screw is already out.");
      s.m2.screw = false;
      return ok(s, s.m2.installed ? "Screw removed. The drive springs up at an angle." : "Screw removed from the standoff and kept safe; it is tiny and easy to lose.");

    case "install-m2-screw":
      if (s.m2.screw) return no("invalid", "The M.2 screw is already in.");
      s.m2.screw = true;
      return ok(s, s.m2.installed ? "Drive pressed flat and the screw fitted. Snug is enough." : "Screw returned to the standoff.");

    case "remove-m2":
      if (!s.m2.installed) return no("invalid", "No M.2 drive is installed.");
      if (s.m2.screw) return no("forcing", "The screw still holds the drive down. Remove it first.");
      s.m2.installed = false;
      return ok(s, "Drive pulled out of the slot at its natural angle and set on the mat.");

    case "insert-m2":
      if (s.m2.installed) return no("invalid", "An M.2 drive is already installed.");
      if (s.m2.screw) return no("order", "Remove the screw from the standoff first; the drive must lie flat over it.");
      s.m2.installed = true;
      return ok(s, "Drive inserted into the slot at about 30°, notch matching the key. Press it flat and secure it.");

    case "disconnect-atx24":
      if (!s.atx24) return no("invalid", "The 24-pin cable is already disconnected.");
      s.atx24 = false;
      return ok(s, "Squeezed the latch on the side of the 24-pin plug and pulled it straight out, rocking gently end to end. Never pull by the wires.");

    case "connect-atx24":
      if (s.atx24) return no("invalid", "The 24-pin cable is already connected.");
      if (!s.psu.installed) return no("order", NO_PSU);
      s.atx24 = true;
      return ok(s, "24-pin plug lined up with its latch and pushed in until it clicked. It only fits one way.");

    case "disconnect-eps8":
      if (!s.eps8) return no("invalid", "The 8-pin CPU cable is already disconnected.");
      s.eps8 = false;
      return ok(s, "Pressed the latch and pulled the 8-pin CPU (EPS) plug straight out.");

    case "connect-eps8":
      if (s.eps8) return no("invalid", "The 8-pin CPU cable is already connected.");
      if (!s.psu.installed) return no("order", NO_PSU);
      s.eps8 = true;
      return ok(s, "Cable labelled CPU pushed into the CPU_PWR header until it clicked. A PCIe cable looks similar but is keyed differently. Never force it.");

    case "disconnect-sata-data":
      if (!s.sata.installed || !s.sata.data) return no("invalid", "The SATA data cable is not connected.");
      s.sata.data = false;
      return ok(s, "SATA data cable unplugged from the SSD. Many have a small metal latch: press it first.");

    case "connect-sata-data":
      if (!s.sata.installed) return no("invalid", "Install the SSD first.");
      if (s.sata.data) return no("invalid", "The data cable is already connected.");
      s.sata.data = true;
      return ok(s, "SATA data cable connected; its L-shaped key only fits one way. The other end goes to a SATA port on the motherboard.");

    case "disconnect-sata-power":
      if (!s.sata.installed || !s.sata.power) return no("invalid", "The SATA power cable is not connected.");
      s.sata.power = false;
      return ok(s, "SATA power cable pulled straight out of the SSD.");

    case "connect-sata-power":
      if (!s.sata.installed) return no("invalid", "Install the SSD first.");
      if (s.sata.power) return no("invalid", "The power cable is already connected.");
      if (!s.psu.installed) return no("order", NO_PSU);
      s.sata.power = true;
      return ok(s, "SATA power cable connected, L-shaped key matching the drive.");

    case "remove-ssd-screws":
      if (!s.sata.installed || !s.sata.screws) return no("invalid", "There are no SSD screws to remove.");
      s.sata.screws = false;
      return ok(s, "Small screws removed from the drive mount. 2.5-inch drives use fine M3 screws: keep them in a tray.");

    case "install-ssd-screws":
      if (!s.sata.installed) return no("invalid", "Install the SSD first.");
      if (s.sata.screws) return no("invalid", "The SSD's screws are already in.");
      s.sata.screws = true;
      return ok(s, "SSD screwed into its mount. Snug is enough.");

    case "remove-ssd":
      if (!s.sata.installed) return no("invalid", "The SSD is not installed.");
      if (s.sata.data || s.sata.power) return no("forcing", "Its cables are still connected. Pulling the drive out would strain or break the SATA connectors. Disconnect both first.");
      if (s.sata.screws) return no("forcing", "The screws still hold the drive to its mount. Remove them first.");
      s.sata.installed = false;
      return ok(s, "SSD lifted out and placed on the mat. Before replacing a drive with data on it, make sure the data is backed up.");

    case "insert-ssd":
      if (s.sata.installed) return no("invalid", "The SSD is already installed.");
      s.sata = { installed: true, screws: false, data: false, power: false };
      return ok(s, "SSD placed in its mount with the connectors facing the cable side. Now fit the screws and connect both cables.");

    case "remove-psu-screws":
      if (!s.psu.installed || !s.psu.screws) return no("invalid", "There are no PSU screws to remove.");
      s.psu.screws = false;
      return ok(s, "The 4 screws at the back of the case removed. Support the PSU: it is heavy.");

    case "install-psu-screws":
      if (!s.psu.installed) return no("invalid", "Install the power supply first.");
      if (s.psu.screws) return no("invalid", "The PSU's screws are already in.");
      s.psu.screws = true;
      return ok(s, "PSU fixed to the back of the case with its 4 screws.");

    case "remove-psu": {
      if (!s.psu.installed) return no("invalid", "The power supply is not installed.");
      const attached = [
        s.atx24 && "24-pin ATX",
        s.eps8 && "8-pin CPU",
        s.gpu.installed && s.gpu.power && "PCIe (graphics card)",
        s.sata.installed && s.sata.power && "SATA power",
      ].filter(Boolean);
      if (attached.length) {
        return no("forcing", `Its cables are still connected (${attached.join(", ")}). Pulling the PSU out would rip them from the parts. Disconnect every PSU cable first.`);
      }
      if (s.psu.screws) return no("forcing", "The screws at the back still hold the PSU to the case. Remove them first.");
      s.psu.installed = false;
      return ok(s, "PSU slid out of its bay and set on the mat. Never open a power supply: its capacitors can hold a dangerous charge.");
    }

    case "install-psu":
      if (s.psu.installed) return no("invalid", "The power supply is already installed.");
      s.psu = { installed: true, screws: false };
      return ok(s, "PSU slid into the bay, fan facing the bottom vent. Now fit its screws and connect its cables.");
  }
}

/** The actions offered for a selected part. Some may be refused: the engine
 *  explains why, which is part of the learning. */
export function actionsFor(part: PartId, s: SimState): Action[] {
  switch (part) {
    case "power-cord":
      return [{ type: s.power ? "unplug-power" : "plug-in-power" }];
    case "esd-strap":
      return [{ type: s.esd ? "remove-esd" : "wear-esd" }];
    case "side-panel":
    case "case":
      return [{ type: s.sidePanel ? "remove-side-panel" : "install-side-panel" }];
    case "ram-1":
    case "ram-2": {
      const slot = s.ram[part].slot;
      if (slot) return [...(s.ramClipsOpen[slot] ? [] : [{ type: "open-ram-clips", slot } as Action]), { type: "remove-ram", part }];
      const empty = RAM_SLOTS.filter((x) => !slotOf(s, x));
      return [
        { type: "turn-around", part },
        ...empty.flatMap((x): Action[] => [...(s.ramClipsOpen[x] ? [] : [{ type: "open-ram-clips", slot: x } as Action]), { type: "insert-ram", part, slot: x }]),
      ];
    }
    case "gpu":
      return s.gpu.installed
        ? [
            { type: s.gpu.power ? "disconnect-gpu-power" : "connect-gpu-power" },
            { type: s.gpu.screws ? "remove-gpu-screws" : "install-gpu-screws" },
            ...(s.pcieLatch ? [{ type: "release-pcie-latch" } as Action] : []),
            { type: "remove-gpu" },
          ]
        : [{ type: "insert-gpu" }];
    case "pcie-power":
      return s.gpu.installed ? [{ type: s.gpu.power ? "disconnect-gpu-power" : "connect-gpu-power" }] : [];
    case "cooler":
      return s.cooler.installed
        ? [{ type: s.cooler.fan ? "disconnect-cooler-fan" : "connect-cooler-fan" }, { type: s.cooler.screws ? "loosen-cooler-screws" : "tighten-cooler-screws" }, { type: "remove-cooler" }]
        : [{ type: "install-cooler" }];
    case "cpu-fan-header":
      return s.cooler.installed ? [{ type: s.cooler.fan ? "disconnect-cooler-fan" : "connect-cooler-fan" }] : [];
    case "cpu":
      return [
        ...(s.cooler.installed ? [] : [{ type: s.socketOpen ? "close-socket" : "open-socket" } as Action]),
        ...(s.paste === "old" ? [{ type: "clean-paste" } as Action] : []),
        ...(s.cpu.installed && s.paste === "none" ? [{ type: "apply-paste" } as Action] : []),
        ...(s.cpu.installed ? [{ type: "remove-cpu" } as Action] : [{ type: "turn-around", part: "cpu" } as Action, { type: "insert-cpu" } as Action]),
      ];
    case "m2":
      return s.m2.installed
        ? [{ type: s.m2.screw ? "remove-m2-screw" : "install-m2-screw" }, { type: "remove-m2" }]
        : [{ type: s.m2.screw ? "remove-m2-screw" : "install-m2-screw" }, { type: "insert-m2" }];
    case "atx-24pin":
      return [{ type: s.atx24 ? "disconnect-atx24" : "connect-atx24" }];
    case "eps-8pin":
      return [{ type: s.eps8 ? "disconnect-eps8" : "connect-eps8" }];
    case "sata-data":
      return s.sata.installed ? [{ type: s.sata.data ? "disconnect-sata-data" : "connect-sata-data" }] : [];
    case "sata-power":
      return s.sata.installed ? [{ type: s.sata.power ? "disconnect-sata-power" : "connect-sata-power" }] : [];
    case "sata-ssd":
      return s.sata.installed
        ? [
            { type: s.sata.data ? "disconnect-sata-data" : "connect-sata-data" },
            { type: s.sata.power ? "disconnect-sata-power" : "connect-sata-power" },
            { type: s.sata.screws ? "remove-ssd-screws" : "install-ssd-screws" },
            { type: "remove-ssd" },
          ]
        : [{ type: "insert-ssd" }];
    case "psu":
      return s.psu.installed
        ? [{ type: s.psu.screws ? "remove-psu-screws" : "install-psu-screws" }, { type: "remove-psu" }]
        : [{ type: "install-psu" }];
    default:
      return [];
  }
}

export function actionLabel(a: Action): string {
  switch (a.type) {
    case "unplug-power":
      return "Unplug the power cord";
    case "plug-in-power":
      return "Plug the power cord back in";
    case "wear-esd":
      return "Put on the wrist strap";
    case "remove-esd":
      return "Take off the wrist strap";
    case "remove-side-panel":
      return "Remove the side panel";
    case "install-side-panel":
      return "Refit the side panel";
    case "open-ram-clips":
      return `Open the clips on slot ${a.slot}`;
    case "remove-ram":
      return "Lift the module out";
    case "insert-ram":
      return `Insert into slot ${a.slot}`;
    case "turn-around":
      return a.part === "cpu" ? "Rotate the CPU 180°" : "Turn the module around";
    case "disconnect-gpu-power":
      return "Disconnect the PCIe power cable";
    case "connect-gpu-power":
      return "Connect the PCIe power cable";
    case "remove-gpu-screws":
      return "Remove the bracket screws";
    case "install-gpu-screws":
      return "Refit the bracket screws";
    case "release-pcie-latch":
      return "Release the PCIe slot latch";
    case "remove-gpu":
      return "Lift the card out";
    case "insert-gpu":
      return "Insert into the PCIe x16 slot";
    case "disconnect-cooler-fan":
      return "Unplug the fan from CPU_FAN";
    case "connect-cooler-fan":
      return "Plug the fan into CPU_FAN";
    case "loosen-cooler-screws":
      return "Loosen the mounting screws";
    case "tighten-cooler-screws":
      return "Tighten the mounting screws";
    case "remove-cooler":
      return "Lift the cooler off";
    case "clean-paste":
      return "Clean off the old thermal paste";
    case "apply-paste":
      return "Apply fresh thermal paste";
    case "install-cooler":
      return "Install the cooler";
    case "open-socket":
      return "Open the socket lever and load plate";
    case "close-socket":
      return "Close the load plate and lock the lever";
    case "remove-cpu":
      return "Lift the CPU out";
    case "insert-cpu":
      return "Place the CPU in the socket";
    case "remove-m2-screw":
      return "Remove the M.2 screw";
    case "install-m2-screw":
      return "Fit the M.2 screw";
    case "remove-m2":
      return "Pull the drive out";
    case "insert-m2":
      return "Insert the drive at an angle";
    case "disconnect-atx24":
      return "Unplug the 24-pin ATX cable";
    case "connect-atx24":
      return "Plug in the 24-pin ATX cable";
    case "disconnect-eps8":
      return "Unplug the 8-pin CPU cable";
    case "connect-eps8":
      return "Plug in the 8-pin CPU cable";
    case "disconnect-sata-data":
      return "Unplug the SATA data cable";
    case "connect-sata-data":
      return "Plug in the SATA data cable";
    case "disconnect-sata-power":
      return "Unplug the SATA power cable";
    case "connect-sata-power":
      return "Plug in the SATA power cable";
    case "remove-ssd-screws":
      return "Remove the SSD's screws";
    case "install-ssd-screws":
      return "Fit the SSD's screws";
    case "remove-ssd":
      return "Lift the SSD out";
    case "insert-ssd":
      return "Put the SSD in its mount";
    case "remove-psu-screws":
      return "Remove the PSU's rear screws";
    case "install-psu-screws":
      return "Fit the PSU's rear screws";
    case "remove-psu":
      return "Slide the PSU out";
    case "install-psu":
      return "Slide the PSU into its bay";
    case "identify":
      return "Identify";
  }
}

/** Where each removable part is: in place, or out on the anti-static mat. */
export function isRemoved(part: PartId, s: SimState): boolean {
  switch (part) {
    case "ram-1":
    case "ram-2":
      return s.ram[part].slot === null;
    case "gpu":
      return !s.gpu.installed;
    case "cooler":
      return !s.cooler.installed;
    case "cpu":
      return !s.cpu.installed;
    case "m2":
      return !s.m2.installed;
    case "side-panel":
      return !s.sidePanel;
    case "sata-ssd":
      return !s.sata.installed;
    case "psu":
      return !s.psu.installed;
    default:
      return false;
  }
}
