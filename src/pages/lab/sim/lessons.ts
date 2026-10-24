import { ASSEMBLED, type Action, type ActionType, type SimState } from "./engine";
import type { PartId, RamSlot } from "./parts";

// Guided 3D lab lessons. Each step names the one action it expects. Actions
// that do something else are refused: with the step's own mistake message when
// one matches, with the engine's explanation when the action itself is unsafe
// or impossible, or with a reminder of the current step otherwise.

export type CameraView = "overview" | "angled" | "front" | "cpu" | "ram" | "gpu" | "m2" | "power" | "bench";

export type ActionMatch = { type: ActionType; part?: PartId | PartId[]; slot?: RamSlot };

export type LabStep = {
  instruction: string;
  expect: ActionMatch;
  /** Parts to glow so the learner knows where to look. */
  highlight: PartId[];
  hint: string;
  mistakes?: { match: ActionMatch; message: string }[];
  /** Shown after the step succeeds. */
  explain?: string;
  camera?: CameraView;
};

export type LabLesson = {
  id: string;
  title: string;
  summary: string;
  /** Library lessons worth reading first. */
  prerequisites: string[];
  safety: string[];
  start: SimState;
  steps: LabStep[];
};

export function matches(m: ActionMatch, a: Action): boolean {
  if (m.type !== a.type) return false;
  if (m.part !== undefined) {
    const part = "part" in a ? a.part : undefined;
    if (part === undefined || !(Array.isArray(m.part) ? m.part.includes(part) : m.part === part)) return false;
  }
  if (m.slot !== undefined && (!("slot" in a) || a.slot !== m.slot)) return false;
  return true;
}

const SAFETY_BASICS = [
  "This is a simulation. On a real computer, always unplug it, drain remaining power and wear a grounded wrist strap first.",
  "Never force a part. If it does not move or fit, something is still holding it or it is the wrong way round.",
];

/** Every hands-on lesson starts the same way: power off, ground yourself, open up. */
const PREPARE: LabStep[] = [
  {
    instruction: "Unplug the power cord from the back of the computer.",
    expect: { type: "unplug-power" },
    highlight: ["power-cord"],
    hint: "Select the power cord in the parts list (Workbench) and choose \"Unplug the power cord\".",
    explain: "On a real PC, now press the power button for about 5 seconds to drain the remaining power.",
    camera: "overview",
  },
  {
    instruction: "Put on the anti-static wrist strap and clip it to bare metal on the case.",
    expect: { type: "wear-esd" },
    highlight: ["esd-strap"],
    hint: "Select the wrist strap under Workbench.",
  },
  {
    instruction: "Remove the side panel.",
    expect: { type: "remove-side-panel" },
    highlight: ["side-panel"],
    hint: "Select the side panel (or the case) and choose \"Remove the side panel\".",
  },
];

const CLOSE_UP: LabStep[] = [
  {
    instruction: "Refit the side panel.",
    expect: { type: "install-side-panel" },
    highlight: ["side-panel"],
    hint: "Select the side panel and choose \"Refit the side panel\".",
    camera: "overview",
  },
  {
    instruction: "Plug the power cord back in.",
    expect: { type: "plug-in-power" },
    highlight: ["power-cord"],
    hint: "Select the power cord. VocaTechX checks that everything is secured first.",
  },
];

const identify = (part: PartId | PartId[], name: string, hint: string, explain: string, camera: CameraView): LabStep => ({
  instruction: `Find and select the ${name}.`,
  expect: { type: "identify", part },
  highlight: [],
  hint,
  explain,
  camera,
});

export const LAB_LESSONS: LabLesson[] = [
  {
    id: "lab-identify-components",
    title: "Identify the major PC components",
    summary: "Find each main component in the case by clicking it, without removing anything.",
    prerequisites: ["pc-major-components"],
    safety: ["Looking through the glass panel is safe. Unplug and ground yourself before touching anything inside a real PC."],
    start: ASSEMBLED,
    steps: [
      identify("motherboard", "motherboard", "It is the large board that covers most of the back wall of the case.", "Every other component plugs into the motherboard.", "overview"),
      identify("cooler", "CPU cooler", "Look for the tall heatsink with a fan near the top of the motherboard.", "The CPU itself is hidden underneath the cooler.", "cpu"),
      identify(["ram-1", "ram-2"], "RAM", "The long thin modules standing in slots to the right of the cooler.", "These two DDR5 modules sit in slots A2 and B2 for dual-channel memory.", "ram"),
      identify("gpu", "graphics card", "The long card lying across the middle of the case, in the PCIe x16 slot.", "Monitors plug into this card's ports at the back of the case.", "gpu"),
      identify("m2", "M.2 SSD", "A small flat card between the CPU and the graphics card.", "M.2 NVMe drives are the fastest common storage.", "m2"),
      identify("psu", "power supply", "It sits at the bottom of the case, under the shroud.", "The PSU turns 220 V AC into the DC voltages the parts need.", "power"),
      identify("front-fans", "front intake fans", "The three large fans at the front of the case.", "They pull cool air in; the rear fan pushes warm air out.", "front"),
    ],
  },
  {
    id: "lab-ram",
    title: "Remove and reinstall RAM",
    summary: "Release the clips, remove both modules, then reinstall them in the dual-channel slots.",
    prerequisites: ["esd-safety-basics", "ram-remove-install"],
    safety: [...SAFETY_BASICS, "Hold modules by their edges. Never touch the gold contacts."],
    start: ASSEMBLED,
    steps: [
      ...PREPARE,
      {
        instruction: "Open the retention clips on slot A2.",
        expect: { type: "open-ram-clips", slot: "A2" },
        highlight: ["ram-1"],
        hint: "Select RAM module 1 and open the clips on its slot.",
        mistakes: [{ match: { type: "remove-ram" }, message: "The clips are still closed. Pulling the module now can crack the slot. Open the clips first." }],
        camera: "ram",
      },
      {
        instruction: "Lift module 1 straight out of slot A2.",
        expect: { type: "remove-ram", part: "ram-1" },
        highlight: ["ram-1"],
        hint: "Select RAM module 1 and choose \"Lift the module out\".",
      },
      {
        instruction: "Open the clips on slot B2.",
        expect: { type: "open-ram-clips", slot: "B2" },
        highlight: ["ram-2"],
        hint: "Select RAM module 2.",
        mistakes: [{ match: { type: "remove-ram" }, message: "Open slot B2's clips before pulling the module." }],
      },
      {
        instruction: "Lift module 2 out of slot B2.",
        expect: { type: "remove-ram", part: "ram-2" },
        highlight: ["ram-2"],
        hint: "Select RAM module 2 and lift it out.",
        explain: "Both modules are on the anti-static mat. Now reinstall them.",
        camera: "bench",
      },
      {
        instruction: "Check module 1's notch: turn it so the notch lines up with the slot's key.",
        expect: { type: "turn-around", part: "ram-1" },
        highlight: ["ram-1"],
        hint: "Module 1 was set down the other way round. Select it and turn it around.",
        mistakes: [{ match: { type: "insert-ram" }, message: "Check the notch first: module 1 is facing the wrong way and will not go in." }],
      },
      {
        instruction: "Insert module 1 back into slot A2. Its clips are still open from removing it.",
        expect: { type: "insert-ram", part: "ram-1", slot: "A2" },
        highlight: ["ram-1"],
        hint: "Select module 1 and choose \"Insert into slot A2\".",
        mistakes: [
          { match: { type: "insert-ram", slot: "A1" }, message: "Use A2, not A1. With two modules, the manual's dual-channel slots are usually A2 and B2." },
          { match: { type: "insert-ram", slot: "B1" }, message: "Module 1 goes back in A2. Using B1 would not match the manual's dual-channel pair." },
          { match: { type: "open-ram-clips", slot: "A1" }, message: "Module 1 goes in A2, whose clips are already open. Leave A1 empty." },
          { match: { type: "open-ram-clips", slot: "B1" }, message: "Module 1 goes in A2, whose clips are already open. Leave B1 empty." },
        ],
        camera: "ram",
      },
      {
        instruction: "Turn module 2 so its notch lines up.",
        expect: { type: "turn-around", part: "ram-2" },
        highlight: ["ram-2"],
        hint: "Select module 2 and turn it around.",
        mistakes: [{ match: { type: "insert-ram" }, message: "Check module 2's notch first: it is facing the wrong way." }],
        camera: "bench",
      },
      {
        instruction: "Insert module 2 back into slot B2.",
        expect: { type: "insert-ram", part: "ram-2", slot: "B2" },
        highlight: ["ram-2"],
        hint: "Select module 2 and insert it into B2.",
        mistakes: [
          { match: { type: "insert-ram", slot: "A1" }, message: "A1 and A2 are on the same channel. Use B2 for dual-channel." },
          { match: { type: "open-ram-clips", slot: "A1" }, message: "Module 2 goes in B2, whose clips are already open." },
          { match: { type: "open-ram-clips", slot: "B1" }, message: "Module 2 goes in B2, whose clips are already open." },
        ],
        explain: "Both modules are seated in A2 and B2: dual-channel mode.",
        camera: "ram",
      },
      ...CLOSE_UP,
    ],
  },
  {
    id: "lab-gpu",
    title: "Remove a graphics card",
    summary: "Disconnect the power cable, remove the bracket screws, release the slot latch and lift the card out.",
    prerequisites: ["esd-safety-basics", "pc-major-components"],
    safety: [...SAFETY_BASICS, "Large graphics cards are heavy. Support the card so it does not drop onto the motherboard."],
    start: ASSEMBLED,
    steps: [
      ...PREPARE,
      {
        instruction: "Disconnect the 8-pin PCIe power cable from the card.",
        expect: { type: "disconnect-gpu-power" },
        highlight: ["gpu", "pcie-power"],
        hint: "Select the graphics card or its PCIe power cable.",
        mistakes: [{ match: { type: "remove-gpu" }, message: "The power cable is still attached. Disconnect it first." }],
        camera: "gpu",
      },
      {
        instruction: "Remove the screws holding the card's bracket to the case.",
        expect: { type: "remove-gpu-screws" },
        highlight: ["gpu"],
        hint: "Select the graphics card and remove the bracket screws.",
        mistakes: [{ match: { type: "remove-gpu" }, message: "The bracket screws still hold the card. Remove them first." }],
      },
      {
        instruction: "Release the latch at the end of the PCIe x16 slot.",
        expect: { type: "release-pcie-latch" },
        highlight: ["gpu"],
        hint: "Select the graphics card and release the slot latch.",
        mistakes: [{ match: { type: "remove-gpu" }, message: "The slot latch still holds the card. Pulling now can break the slot." }],
      },
      {
        instruction: "Lift the card straight out of the slot, supporting it along its length.",
        expect: { type: "remove-gpu" },
        highlight: ["gpu"],
        hint: "Select the graphics card and lift it out.",
        explain: "The card is on the anti-static mat. To reinstall: insert, refit the screws, then reconnect power.",
        camera: "bench",
      },
    ],
  },
  {
    id: "lab-cooler",
    title: "Remove and reinstall a CPU cooler",
    summary: "Unplug the fan, loosen the screws, lift the cooler, replace the thermal paste and reinstall it.",
    prerequisites: ["esd-safety-basics", "pc-major-components"],
    safety: [
      ...SAFETY_BASICS,
      "Coolers can be hot after use. Let the computer cool down first.",
      "Mounting hardware differs between Intel and AMD sockets and between cooler brands. Always follow the cooler's manual.",
    ],
    start: ASSEMBLED,
    steps: [
      ...PREPARE,
      {
        instruction: "Unplug the cooler's fan cable from the CPU_FAN header.",
        expect: { type: "disconnect-cooler-fan" },
        highlight: ["cooler", "cpu-fan-header"],
        hint: "Select the cooler or the CPU_FAN header.",
        mistakes: [{ match: { type: "remove-cooler" }, message: "The fan cable is still plugged in. Lifting the cooler would pull on it." }],
        camera: "cpu",
      },
      {
        instruction: "Loosen the cooler's mounting screws in a cross pattern.",
        expect: { type: "loosen-cooler-screws" },
        highlight: ["cooler"],
        hint: "Select the cooler and loosen the screws.",
        mistakes: [{ match: { type: "remove-cooler" }, message: "The screws are still tight. Never pull a cooler that is still mounted." }],
      },
      {
        instruction: "Lift the cooler off the CPU.",
        expect: { type: "remove-cooler" },
        highlight: ["cooler"],
        hint: "Select the cooler and lift it off. On a real PC, twist it gently first to break the paste's grip.",
        explain: "Old paste is left on the CPU. It must be replaced, never reused.",
      },
      {
        instruction: "Clean the old thermal paste off the CPU.",
        expect: { type: "clean-paste" },
        highlight: ["cpu"],
        hint: "Select the CPU and clean off the old paste.",
        mistakes: [{ match: { type: "apply-paste" }, message: "Clean the old paste off first. New paste never goes on top of old." }],
      },
      {
        instruction: "Apply fresh thermal paste.",
        expect: { type: "apply-paste" },
        highlight: ["cpu"],
        hint: "Select the CPU and apply fresh paste.",
        mistakes: [{ match: { type: "install-cooler" }, message: "Apply fresh paste before installing the cooler. Without it the CPU overheats." }],
      },
      {
        instruction: "Install the cooler on the CPU.",
        expect: { type: "install-cooler" },
        highlight: ["cooler"],
        hint: "Select the cooler (on the mat) and install it.",
      },
      {
        instruction: "Tighten the mounting screws in a cross pattern.",
        expect: { type: "tighten-cooler-screws" },
        highlight: ["cooler"],
        hint: "Select the cooler and tighten the screws.",
      },
      {
        instruction: "Plug the fan back into CPU_FAN.",
        expect: { type: "connect-cooler-fan" },
        highlight: ["cooler", "cpu-fan-header"],
        hint: "Select the cooler and connect the fan.",
      },
      ...CLOSE_UP,
    ],
  },
  {
    id: "lab-cpu",
    title: "Remove and reinstall a CPU (LGA socket)",
    summary: "Take off the cooler, open the socket, lift the CPU out, and reinstall it correctly oriented.",
    prerequisites: ["esd-safety-basics", "pc-major-components"],
    safety: [
      ...SAFETY_BASICS,
      "LGA socket pins are extremely fragile and bend if touched. Bent pins can ruin the motherboard.",
      "This is an LGA socket (pins in the socket). On a PGA CPU (pins on the CPU, e.g. AMD AM4) you lift a lever and the CPU's own pins are the fragile part.",
    ],
    start: ASSEMBLED,
    steps: [
      ...PREPARE,
      {
        instruction: "Unplug the cooler fan from CPU_FAN.",
        expect: { type: "disconnect-cooler-fan" },
        highlight: ["cooler", "cpu-fan-header"],
        hint: "Select the cooler.",
        camera: "cpu",
      },
      { instruction: "Loosen the cooler's screws.", expect: { type: "loosen-cooler-screws" }, highlight: ["cooler"], hint: "Select the cooler." },
      {
        instruction: "Lift the cooler off.",
        expect: { type: "remove-cooler" },
        highlight: ["cooler"],
        hint: "Select the cooler.",
        mistakes: [{ match: { type: "remove-cpu" }, message: "The cooler covers the CPU. Remove the cooler first." }],
      },
      { instruction: "Clean the old paste off the CPU.", expect: { type: "clean-paste" }, highlight: ["cpu"], hint: "Select the CPU." },
      {
        instruction: "Open the socket: release the lever and lift the load plate.",
        expect: { type: "open-socket" },
        highlight: ["cpu"],
        hint: "Select the CPU and open the socket.",
        mistakes: [{ match: { type: "remove-cpu" }, message: "The load plate still clamps the CPU. Open the lever and plate first, or you will bend pins." }],
      },
      {
        instruction: "Lift the CPU straight up by its edges.",
        expect: { type: "remove-cpu" },
        highlight: ["cpu"],
        hint: "Select the CPU and lift it out.",
        explain: "Never touch the socket pins or the CPU's contacts. Keep the CPU in a tray, contacts up.",
      },
      {
        instruction: "Line up the CPU: rotate it so its gold triangle matches the socket's mark.",
        expect: { type: "turn-around", part: "cpu" },
        highlight: ["cpu"],
        hint: "The CPU was set down rotated. Select it and rotate it 180°.",
        mistakes: [{ match: { type: "insert-cpu" }, message: "Check the orientation first: the triangle and notches must line up with the socket." }],
        camera: "bench",
      },
      {
        instruction: "Place the CPU in the socket. It must drop in without pressure.",
        expect: { type: "insert-cpu" },
        highlight: ["cpu"],
        hint: "Select the CPU and place it in the socket.",
        camera: "cpu",
      },
      {
        instruction: "Close the load plate and lock the lever.",
        expect: { type: "close-socket" },
        highlight: ["cpu"],
        hint: "Select the CPU and close the socket.",
        mistakes: [{ match: { type: "install-cooler" }, message: "Close and lock the socket before installing the cooler." }],
      },
      { instruction: "Apply fresh thermal paste.", expect: { type: "apply-paste" }, highlight: ["cpu"], hint: "Select the CPU." },
      { instruction: "Install the cooler.", expect: { type: "install-cooler" }, highlight: ["cooler"], hint: "Select the cooler." },
      { instruction: "Tighten its screws in a cross pattern.", expect: { type: "tighten-cooler-screws" }, highlight: ["cooler"], hint: "Select the cooler." },
      { instruction: "Plug the fan back into CPU_FAN.", expect: { type: "connect-cooler-fan" }, highlight: ["cooler"], hint: "Select the cooler." },
      ...CLOSE_UP,
    ],
  },
  {
    id: "lab-m2",
    title: "Install an M.2 SSD",
    summary: "Remove the standoff screw, insert the drive at an angle, and secure it flat.",
    prerequisites: ["esd-safety-basics", "pc-major-components"],
    safety: [...SAFETY_BASICS, "M.2 screws are tiny and easy to lose. Keep them in a parts tray.", "Some boards use a tool-free latch instead of a screw, or have a heatsink cover over the slot. Check the manual."],
    start: { ...ASSEMBLED, m2: { installed: false, screw: true } },
    steps: [
      ...PREPARE,
      {
        instruction: "Remove the screw from the M.2 standoff.",
        expect: { type: "remove-m2-screw" },
        highlight: ["m2"],
        hint: "Select the M.2 SSD (on the mat) and remove the screw.",
        mistakes: [{ match: { type: "insert-m2" }, message: "The screw is still in the standoff, so the drive cannot lie flat. Remove it first." }],
        camera: "m2",
      },
      {
        instruction: "Insert the drive into the slot at about 30°.",
        expect: { type: "insert-m2" },
        highlight: ["m2"],
        hint: "Select the M.2 SSD and insert it.",
      },
      {
        instruction: "Press the drive flat and fit the screw.",
        expect: { type: "install-m2-screw" },
        highlight: ["m2"],
        hint: "Select the M.2 SSD and fit the screw. Snug is enough.",
        explain: "In Windows, a new drive must be initialised and formatted in Disk Management before it appears in File Explorer.",
      },
      ...CLOSE_UP,
    ],
  },
  {
    id: "lab-power-connectors",
    title: "Identify the motherboard power connectors",
    summary: "Find the main power cables and headers that every technician must recognise.",
    prerequisites: ["pc-major-components"],
    safety: ["Only connect or disconnect power cables with the computer unplugged."],
    start: ASSEMBLED,
    steps: [
      identify("atx-24pin", "24-pin ATX power connector", "The widest connector, on the front edge of the motherboard next to the RAM.", "It powers the motherboard itself.", "power"),
      identify("eps-8pin", "8-pin EPS (CPU) power connector", "Look at the top-left corner of the motherboard, above the CPU area.", "It powers the CPU. It looks like the PCIe 8-pin but is keyed differently: never force it.", "cpu"),
      identify("pcie-power", "PCIe power cable", "It plugs into the top edge of the graphics card.", "Labelled PCIe or VGA on the PSU cable.", "gpu"),
      identify("sata-power", "SATA power cable", "Follow the flat cable to the 2.5-inch SSD.", "SATA power is flat with an L-shaped key.", "power"),
      identify("cpu-fan-header", "CPU_FAN header", "A small 4-pin header near the top of the board, where the cooler's fan cable plugs in.", "The motherboard may refuse to start without a fan on CPU_FAN.", "cpu"),
    ],
  },
];
