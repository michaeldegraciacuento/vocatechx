import type { CategoryId } from "./schema";

export type Category = { id: CategoryId; title: string; description: string };

/** The library's categories, in the order they are shown. */
export const CATEGORIES: Category[] = [
  { id: "electrical-safety", title: "Electrical safety & ESD", description: "Protect yourself and the hardware before you touch anything." },
  { id: "hardware-fundamentals", title: "Hardware fundamentals", description: "What each part of a computer does and how they fit together." },
  { id: "assembly-disassembly", title: "PC assembly & disassembly", description: "Removing and installing components the right way." },
  { id: "pc-troubleshooting", title: "Basic PC troubleshooting", description: "A methodical way to find and fix common faults." },
  { id: "windows-maintenance", title: "Windows installation & recovery", description: "Installing, maintaining and recovering Windows." },
  { id: "networking", title: "Networking", description: "Network basics, cabling, IP addressing and troubleshooting." },
  { id: "printers-peripherals", title: "Printers & peripherals", description: "Setting up and fixing printers and other devices." },
  { id: "preventive-maintenance", title: "Preventive maintenance", description: "Keeping computers clean, cool and reliable." },
  { id: "tools-diagnostics", title: "Tools & diagnostics", description: "The technician's toolkit and diagnostic procedures." },
  { id: "practical-assessment", title: "Practical activities & assessments", description: "Hands-on activities and review assessments." },
];

export function categoryTitle(id: CategoryId): string {
  return CATEGORIES.find((c) => c.id === id)?.title ?? id;
}
