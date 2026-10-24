import { CanvasTexture, SRGBColorSpace } from "three";
import { BRAND } from "../sim/brand";

// Printed artwork for the parts (stickers, heatsink graphics, PCB silkscreen,
// RGB gradients), painted once on a canvas. Nothing is downloaded, so the lab
// stays offline and the security policy stays strict.

const cache = new Map<string, CanvasTexture>();
const FONT = '"Segoe UI", "Arial", sans-serif';

function paint(key: string, width: number, height: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d")!;
  draw(g, width, height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  cache.set(key, texture);
  return texture;
}

function text(g: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, color: string, weight = 700, align: CanvasTextAlign = "left", spacing = 0) {
  g.font = `${weight} ${size}px ${FONT}`;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = "middle";
  g.letterSpacing = `${spacing}px`;
  g.fillText(value, x, y);
}

/** A sticker-style barcode made of thin bars. */
function barcode(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number) {
  g.fillStyle = "#111";
  let cx = x;
  let s = seed;
  while (cx < x + w) {
    s = (s * 9301 + 49297) % 233280;
    const bar = 1 + (s % 4);
    g.fillRect(cx, y, bar, h);
    cx += bar + 1 + (s % 3);
  }
}

// ---- RAM -------------------------------------------------------------------

/** The heat spreader's side: black aluminium with red angular accents. */
export const ramSide = () =>
  paint("ram-side", 1024, 224, (g, w, h) => {
    const base = g.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, "#22252b");
    base.addColorStop(1, "#0d0f12");
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#c81e3a";
    g.beginPath();
    g.moveTo(0, h * 0.62);
    g.lineTo(w * 0.34, h * 0.62);
    g.lineTo(w * 0.4, h);
    g.lineTo(0, h);
    g.fill();
    g.fillStyle = "#8f1328";
    g.beginPath();
    g.moveTo(w * 0.36, h * 0.62);
    g.lineTo(w * 0.42, h * 0.62);
    g.lineTo(w * 0.48, h);
    g.lineTo(w * 0.42, h);
    g.fill();
    g.strokeStyle = "rgba(255,255,255,0.08)";
    g.lineWidth = 2;
    for (let x = w * 0.55; x < w; x += 18) {
      g.beginPath();
      g.moveTo(x, h * 0.2);
      g.lineTo(x - 30, h * 0.85);
      g.stroke();
    }
    text(g, BRAND.maker, 36, h * 0.3, 70, "#ffffff", 900, "left", 4);
    text(g, BRAND.ram.series, 210, h * 0.3, 44, "#e5e7eb", 700, "left", 6);
    text(g, BRAND.ram.spec, w - 36, h * 0.82, 30, "#9ca3af", 600, "right", 3);
  });

/** The spec sticker on the other side of the module. */
export const ramSticker = () =>
  paint("ram-sticker", 1024, 224, (g, w, h) => {
    g.fillStyle = "#16181d";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#f4f4f5";
    g.fillRect(w * 0.08, h * 0.16, w * 0.62, h * 0.68);
    text(g, `${BRAND.maker} ${BRAND.ram.series}`, w * 0.1, h * 0.3, 34, "#111827", 800);
    text(g, BRAND.ram.spec, w * 0.1, h * 0.5, 30, "#111827", 700);
    text(g, BRAND.ram.detail, w * 0.1, h * 0.68, 22, "#374151", 600);
    barcode(g, w * 0.5, h * 0.26, w * 0.17, h * 0.4, 7);
    text(g, "WARRANTY VOID IF REMOVED", w * 0.39, h * 0.78, 14, "#6b7280", 600, "center");
    text(g, BRAND.maker, w * 0.86, h * 0.5, 64, "#c81e3a", 900, "center");
  });

/** A horizontal rainbow for RGB light bars. */
export const rgbGradient = () =>
  paint("rgb", 512, 16, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, 0);
    ["#ff2d55", "#ff9f0a", "#ffd60a", "#30d158", "#0ac8ff", "#5e5ce6", "#bf5af2", "#ff2d55"].forEach((c, i, all) =>
      grad.addColorStop(i / (all.length - 1), c),
    );
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });

// ---- CPU -------------------------------------------------------------------

/** The CPU lid: brushed nickel with laser-etched markings. */
export const cpuLid = () =>
  paint("cpu-lid", 740, 600, (g, w, h) => {
    const base = g.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, "#dfe3e8");
    base.addColorStop(0.5, "#c3c8cf");
    base.addColorStop(1, "#d6dae0");
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(255,255,255,0.12)";
    for (let y = 0; y < h; y += 3) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y + 6);
      g.stroke();
    }
    const etch = "#6b7280";
    text(g, BRAND.maker, w * 0.12, h * 0.22, 64, etch, 900, "left", 6);
    text(g, BRAND.cpu.series, w * 0.12, h * 0.4, 48, etch, 700, "left", 2);
    text(g, BRAND.cpu.model, w * 0.12, h * 0.54, 56, etch, 800, "left", 3);
    text(g, BRAND.cpu.detail, w * 0.12, h * 0.68, 30, etch, 600);
    text(g, BRAND.cpu.batch, w * 0.12, h * 0.8, 26, etch, 600);
    g.fillStyle = etch;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x * 7 + y * 3) % 5 < 3) g.fillRect(w * 0.74 + x * 14, h * 0.62 + y * 14, 12, 12);
  });

// ---- Graphics card ---------------------------------------------------------

/** The shroud's visible side: black with red flashes and the model name. */
export const gpuSide = () =>
  paint("gpu-side", 1400, 220, (g, w, h) => {
    const base = g.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, "#26292f");
    base.addColorStop(1, "#0c0d10");
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#c81e3a";
    g.beginPath();
    g.moveTo(w * 0.04, h);
    g.lineTo(w * 0.1, 0);
    g.lineTo(w * 0.13, 0);
    g.lineTo(w * 0.07, h);
    g.fill();
    g.fillStyle = "#3a3f47";
    g.fillRect(w * 0.18, h * 0.82, w * 0.78, h * 0.06);
    text(g, BRAND.maker, w * 0.17, h * 0.42, 86, "#ffffff", 900, "left", 6);
    text(g, BRAND.gpu.series, w * 0.32, h * 0.42, 62, "#d1d5db", 700, "left", 12);
    text(g, BRAND.gpu.model, w * 0.74, h * 0.42, 54, "#c81e3a", 800, "right", 4);
  });

/** The backplate on top of the card. */
export const gpuBackplate = () =>
  paint("gpu-backplate", 1400, 560, (g, w, h) => {
    g.fillStyle = "#1a1d22";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(255,255,255,0.06)";
    g.lineWidth = 3;
    for (let x = -h; x < w; x += 28) {
      g.beginPath();
      g.moveTo(x, h);
      g.lineTo(x + h, 0);
      g.stroke();
    }
    g.fillStyle = "#0b0c0f";
    for (let i = 0; i < 9; i++) g.fillRect(w * 0.08 + i * 32, h * 0.25, 14, h * 0.5);
    text(g, `${BRAND.maker} ${BRAND.gpu.series}`, w * 0.55, h * 0.5, 96, "#e5e7eb", 900, "center", 10);
    text(g, BRAND.gpu.detail, w * 0.55, h * 0.72, 36, "#9ca3af", 600, "center", 4);
  });

// ---- Motherboard -----------------------------------------------------------

/** Board coordinates (cm, origin at the board centre) → canvas pixels. */
const PX = 40;
const bx = (x: number) => (x + 12.2) * PX;
const by = (y: number) => (15.25 - y) * PX;

/** The PCB: matte black, copper traces and white silkscreen labels at the real connector positions. */
export const boardPcb = () =>
  paint("board", 976, 1220, (g, w, h) => {
    g.fillStyle = "#14171c";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(120,130,145,0.18)";
    g.lineWidth = 2;
    let s = 11;
    for (let i = 0; i < 170; i++) {
      s = (s * 9301 + 49297) % 233280;
      const x = s % w;
      const y = (s * 7) % h;
      const len = 30 + (s % 140);
      g.beginPath();
      g.moveTo(x, y);
      if (i % 2) g.lineTo(x + len, y);
      else g.lineTo(x, y + len);
      g.lineTo(x + len * 0.3 * (i % 3 ? 1 : -1), y + len);
      g.stroke();
    }
    // Standoff screw holes: a gold ring with a dark centre.
    const holes = [
      [-11.4, 14.4],
      [11.4, 14.4],
      [-11.4, -14.4],
      [11.4, -14.4],
      [-2.5, -14.4],
      [3.4, 2],
    ];
    for (const [radius, color] of [
      [12, "#c7a14a"],
      [6, "#14171c"],
    ] as const) {
      g.fillStyle = color;
      for (const [x, y] of holes) {
        g.beginPath();
        g.arc(bx(x), by(y), radius, 0, Math.PI * 2);
        g.fill();
      }
    }
    const silk = "#e5e7eb";
    text(g, "CPU_FAN", bx(1.8), by(15.1), 20, silk, 700, "center");
    text(g, "CPU_PWR1", bx(-10), by(12.4), 20, silk, 700, "center");
    text(g, "ATX_PWR", bx(9.8), by(7.4), 20, silk, 700, "center");
    text(g, "LGA1700", bx(-2.5), by(2.6), 22, silk, 700, "center");
    ["DDR5_A1", "DDR5_A2", "DDR5_B1", "DDR5_B2"].forEach((label, i) => {
      g.save();
      g.translate(bx(4.3 + i * 0.9), by(0.1));
      g.rotate(-Math.PI / 2);
      text(g, label, 0, 0, 15, silk, 700, "right");
      g.restore();
    });
    text(g, "M.2_1 (PCIe 4.0 x4)", bx(-3), by(-2.9), 20, silk, 700, "center");
    text(g, "PCIEX16_1", bx(-6.5), by(-5.6), 20, silk, 700, "center");
    text(g, "SATA6G", bx(11.4), by(-8.2), 18, silk, 700, "center");
    text(g, `${BRAND.maker} ${BRAND.board.model}`, bx(2), by(-12.4), 34, "#f1f5f9", 900, "center", 4);
    text(g, BRAND.board.detail, bx(2), by(-13.6), 20, "#9ca3af", 600, "center", 3);
  });

/** A small brand plate for heatsinks and covers. */
export const brandPlate = (label: string, accent = "#c81e3a") =>
  paint(`plate-${label}-${accent}`, 512, 128, (g, w, h) => {
    const base = g.createLinearGradient(0, 0, w, 0);
    base.addColorStop(0, "#2a2e35");
    base.addColorStop(1, "#16181c");
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    g.fillStyle = accent;
    g.fillRect(0, h - 10, w, 10);
    text(g, label, w / 2, h * 0.45, 56, "#f3f4f6", 900, "center", 8);
  });

// ---- Cooler, PSU, storage --------------------------------------------------

export const coolerCap = () =>
  paint("cooler-cap", 1024, 440, (g, w, h) => {
    g.fillStyle = "#111317";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#c81e3a";
    g.lineWidth = 8;
    g.strokeRect(24, 24, w - 48, h - 48);
    text(g, BRAND.maker, w / 2, h * 0.4, 130, "#ffffff", 900, "center", 12);
    text(g, BRAND.cooler.series, w / 2, h * 0.68, 60, "#d1d5db", 700, "center", 10);
  });

export const psuLabel = () =>
  paint("psu-label", 900, 760, (g, w, h) => {
    g.fillStyle = "#1c1f24";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#e5e7eb";
    g.fillRect(40, 40, w - 80, h - 80);
    text(g, BRAND.maker, 80, 120, 80, "#111827", 900, "left", 6);
    text(g, BRAND.psu.series, 80, 210, 52, "#111827", 800, "left", 2);
    text(g, BRAND.psu.detail, 80, 290, 30, "#374151", 600);
    g.strokeStyle = "#111827";
    g.lineWidth = 3;
    const rows = [
      ["DC OUTPUT", "+3.3V", "+5V", "+12V", "-12V", "+5Vsb"],
      ["MAX LOAD", "20A", "20A", "54A", "0.3A", "3A"],
    ];
    rows.forEach((row, r) =>
      row.forEach((cell, c) => {
        const x = 80 + c * 125;
        const y = 360 + r * 70;
        g.strokeRect(x, y, 125, 70);
        text(g, cell, x + 62, y + 35, c === 0 ? 20 : 26, "#111827", 700, "center");
      }),
    );
    text(g, "INPUT: 200-240V~ 60Hz 5A", 80, 560, 28, "#374151", 600);
    text(g, "⚠ HIGH VOLTAGE · DO NOT OPEN", 80, 620, 30, "#b91c1c", 800);
    barcode(g, 560, 520, 220, 120, 3);
  });

export const m2Label = () =>
  paint("m2-label", 1080, 340, (g, w, h) => {
    g.fillStyle = "#101216";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#c81e3a";
    g.fillRect(0, 0, 18, h);
    text(g, BRAND.maker, 56, h * 0.36, 110, "#ffffff", 900, "left", 8);
    text(g, BRAND.m2.series, 340, h * 0.36, 90, "#d1d5db", 800, "left", 6);
    text(g, BRAND.m2.spec, 56, h * 0.7, 52, "#e5e7eb", 700);
    text(g, BRAND.m2.detail, w - 40, h * 0.7, 36, "#9ca3af", 600, "right");
  });

export const sataLabel = () =>
  paint("sata-label", 1000, 700, (g, w, h) => {
    g.fillStyle = "#24272d";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#c81e3a";
    g.fillRect(0, h * 0.78, w, h * 0.06);
    text(g, BRAND.maker, 70, h * 0.3, 140, "#ffffff", 900, "left", 10);
    text(g, BRAND.sata.series, 400, h * 0.3, 110, "#d1d5db", 800, "left", 6);
    text(g, BRAND.sata.spec, 70, h * 0.55, 64, "#e5e7eb", 700);
    text(g, BRAND.sata.detail, 70, h * 0.68, 40, "#9ca3af", 600);
  });
