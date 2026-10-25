import { BRAND } from "./brand";

// The parts of the simulated PC: one specific, generic configuration (ATX
// board, Intel-style LGA socket, tower cooler, two DDR5 modules, one PCIe x16
// graphics card, one M.2 NVMe SSD). Real computers differ; the lab says so.

export type RamSlot = "A1" | "A2" | "B1" | "B2";
export const RAM_SLOTS: RamSlot[] = ["A1", "A2", "B1", "B2"];

export type RamId = "ram-1" | "ram-2";
export const RAM_IDS: RamId[] = ["ram-1", "ram-2"];

export type PartId =
  | "power-cord"
  | "esd-strap"
  | "case"
  | "side-panel"
  | "motherboard"
  | "cpu"
  | "cooler"
  | RamId
  | "gpu"
  | "m2"
  | "sata-ssd"
  | "psu"
  | "front-fans"
  | "rear-fan"
  | "atx-24pin"
  | "eps-8pin"
  | "pcie-power"
  | "sata-data"
  | "sata-power"
  | "cpu-fan-header";

export type PartGroup = "Workbench" | "Case" | "Processor" | "Memory" | "Graphics" | "Storage" | "Power" | "Cooling";

export type PartInfo = {
  id: PartId;
  name: string;
  group: PartGroup;
  /** What it does, in a sentence or two. */
  role: string;
  specs: string[];
  /** Shown when relevant: things to be careful of with this part. */
  caution?: string;
};

export const PARTS: Record<PartId, PartInfo> = {
  "power-cord": {
    id: "power-cord",
    name: "Power cord",
    group: "Workbench",
    role: "Brings 220 V AC mains power to the power supply. It must be unplugged before you work inside the computer.",
    specs: ["IEC C13 plug at the PSU end"],
  },
  "esd-strap": {
    id: "esd-strap",
    name: "Anti-static wrist strap",
    group: "Workbench",
    role: "Keeps you at the same electrical potential as the computer so static does not discharge into components.",
    specs: ["Clip to bare, unpainted metal", "Built-in 1 MΩ safety resistor"],
  },
  case: {
    id: "case",
    name: "Case (mid tower)",
    group: "Case",
    role: "Holds and protects the components and guides airflow from front to back.",
    specs: ["Fits ATX, Micro-ATX and Mini-ITX boards", "Bottom-mounted PSU under a shroud"],
  },
  "side-panel": {
    id: "side-panel",
    name: "Side panel (tempered glass)",
    group: "Case",
    role: "Covers the side of the case. It comes off to reach the components.",
    specs: ["Held by thumbscrews at the back"],
    caution: "Glass panels are heavy and can shatter if dropped. Lay them flat on a soft surface.",
  },
  motherboard: {
    id: "motherboard",
    name: "Motherboard (ATX)",
    group: "Case",
    role: "The main circuit board. Every other component plugs into it.",
    specs: [`Model: ${BRAND.maker} ${BRAND.board.model}`, "ATX: 305 × 244 mm", "LGA socket, 4 DDR5 slots", "1 × PCIe x16, 1 × M.2 slot", "UEFI firmware"],
  },
  cpu: {
    id: "cpu",
    name: "CPU (processor)",
    group: "Processor",
    role: "Carries out program instructions. It sits in the socket under the cooler.",
    specs: [`Model: ${BRAND.cpu.series}-${BRAND.cpu.model} (${BRAND.cpu.detail})`, "LGA package: flat contact pads, the pins are in the socket", "Gold triangle marks pin 1"],
    caution: "LGA socket pins are extremely fragile. Never touch them or drop anything into the socket.",
  },
  cooler: {
    id: "cooler",
    name: "CPU cooler (tower)",
    group: "Cooling",
    role: "Draws heat away from the CPU through a heatsink and fan. Thermal paste fills the gap between them.",
    specs: [`Model: ${BRAND.maker} ${BRAND.cooler.series}`, "Single-tower heatsink, 120 mm fan", "Fan cable to the CPU_FAN header"],
    caution: "Mounting kits differ between Intel and AMD sockets and between cooler makers. Follow the cooler's manual.",
  },
  "ram-1": {
    id: "ram-1",
    name: "RAM module 1 (DDR5)",
    group: "Memory",
    role: "Holds the programs and data in use. Its contents are lost when power is off.",
    specs: [`Model: ${BRAND.maker} ${BRAND.ram.series} ${BRAND.ram.spec}`, "DDR5 DIMM, 16 GB, 6000 MT/s", "288 pins, one off-centre key notch"],
    caution: "Only fits DDR5 slots. Hold it by the edges.",
  },
  "ram-2": {
    id: "ram-2",
    name: "RAM module 2 (DDR5)",
    group: "Memory",
    role: "The second module of a matched pair, for dual-channel memory.",
    specs: [`Model: ${BRAND.maker} ${BRAND.ram.series} ${BRAND.ram.spec}`, "DDR5 DIMM, 16 GB, 6000 MT/s", "288 pins, one off-centre key notch"],
    caution: "Only fits DDR5 slots. Hold it by the edges.",
  },
  gpu: {
    id: "gpu",
    name: "Graphics card (GPU)",
    group: "Graphics",
    role: "Creates the image for the monitor. Connect the display to this card, not the motherboard.",
    specs: [`Model: ${BRAND.maker} ${BRAND.gpu.series} ${BRAND.gpu.model}`, "PCIe x16 card, 2 slots thick", "8-pin PCIe power connector", "Held by bracket screws and the slot latch"],
    caution: "Large cards are heavy. Support the card while removing or installing it.",
  },
  m2: {
    id: "m2",
    name: "M.2 NVMe SSD",
    group: "Storage",
    role: "Fast storage for Windows and programs. Keeps data when the power is off.",
    specs: [`Model: ${BRAND.maker} ${BRAND.m2.series} ${BRAND.m2.spec}`, "M.2 2280 (22 × 80 mm)", "NVMe over PCIe", "Held flat by one screw or latch"],
  },
  "sata-ssd": {
    id: "sata-ssd",
    name: "2.5-inch SATA SSD",
    group: "Storage",
    role: "Extra storage, connected with a SATA data cable and a SATA power cable.",
    specs: [`Model: ${BRAND.maker} ${BRAND.sata.series} ${BRAND.sata.spec}`, "2.5-inch, SATA 6 Gb/s", "Held by 4 small M3 screws"],
    caution: "Back up any data before removing a drive that is in use.",
  },
  "sata-data": {
    id: "sata-data",
    name: "SATA data cable",
    group: "Storage",
    role: "Carries data between the SSD and a SATA port on the motherboard.",
    specs: ["7 pins, L-shaped key", "Some have a small metal latch"],
  },
  psu: {
    id: "psu",
    name: "Power supply unit (PSU)",
    group: "Power",
    role: "Converts AC mains power into +12 V, +5 V and +3.3 V DC for the components.",
    specs: [`Model: ${BRAND.maker} ${BRAND.psu.series}`, "ATX, 650 W, 80 PLUS Gold", "Non-modular: its cables are fixed to it", "Held by 4 screws at the back of the case"],
    caution: "Never open a PSU. Its capacitors can hold a dangerous charge even when unplugged.",
  },
  "front-fans": {
    id: "front-fans",
    name: "Front intake fans",
    group: "Cooling",
    role: "Pull cool air into the case through the front.",
    specs: ["3 × 120 mm"],
  },
  "rear-fan": {
    id: "rear-fan",
    name: "Rear exhaust fan",
    group: "Cooling",
    role: "Pushes warm air out of the back of the case.",
    specs: ["1 × 120 mm"],
  },
  "atx-24pin": {
    id: "atx-24pin",
    name: "24-pin ATX power connector",
    group: "Power",
    role: "The main power cable from the PSU to the motherboard.",
    specs: ["24 pins, on the board's front edge", "Has a latch: press it to unplug"],
  },
  "eps-8pin": {
    id: "eps-8pin",
    name: "8-pin EPS (CPU) power connector",
    group: "Power",
    role: "Powers the CPU's voltage regulators. Near the top-left corner of the board.",
    specs: ["4+4 pins, labelled CPU on the PSU cable"],
    caution: "Do not confuse it with the 8-pin PCIe graphics cable: they are keyed differently. Never force either.",
  },
  "pcie-power": {
    id: "pcie-power",
    name: "8-pin PCIe power cable (GPU)",
    group: "Power",
    role: "Extra power for the graphics card, on the card's top edge.",
    specs: ["6+2 pins, labelled PCIe / VGA"],
  },
  "sata-power": {
    id: "sata-power",
    name: "SATA power cable",
    group: "Power",
    role: "Powers SATA drives. It is flat, with an L-shaped key.",
    specs: ["15 pins"],
  },
  "cpu-fan-header": {
    id: "cpu-fan-header",
    name: "CPU_FAN header",
    group: "Cooling",
    role: "The 4-pin connector on the motherboard that powers and controls the CPU cooler's fan.",
    specs: ["4-pin PWM", "Near the top of the board"],
  },
};

export const PART_GROUPS: PartGroup[] = ["Workbench", "Case", "Processor", "Cooling", "Memory", "Graphics", "Storage", "Power"];
