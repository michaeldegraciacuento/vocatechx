/** IPv4 subnet arithmetic for the IP Configuration tab and calculator. */

export type SubnetInfo = {
  address: string;
  prefix: number;
  mask: string;
  wildcard: string;
  network: string;
  broadcast: string;
  firstHost: string;
  lastHost: string;
  /** Usable host addresses (/31 and /32 are point-to-point / single host). */
  usableHosts: number;
  totalAddresses: number;
  ipClass: "A" | "B" | "C" | "D (multicast)" | "E (reserved)";
  scope: string;
  binaryAddress: string;
  binaryMask: string;
};

export function parseIpv4(text: string): number | null {
  const parts = text.trim().split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

export function formatIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");
}

export function prefixToMask(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

/** Prefix length of a contiguous mask such as 255.255.255.0, else null. */
export function maskToPrefix(text: string): number | null {
  const mask = parseIpv4(text);
  if (mask === null) return null;
  const inverted = ~mask >>> 0;
  if ((inverted & (inverted + 1)) !== 0) return null;
  return 32 - Math.log2(inverted + 1);
}

/** Dotted binary, e.g. 11000000.10101000.00000001.00001010. */
function binary(value: number): string {
  const bits = value.toString(2).padStart(32, "0");
  return [0, 8, 16, 24].map((i) => bits.slice(i, i + 8)).join(".");
}

function scopeOf(ip: number): string {
  const a = ip >>> 24;
  const b = (ip >>> 16) & 255;
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "Private (RFC 1918)";
  if (a === 127) return "Loopback";
  if (a === 169 && b === 254) return "Link-local (APIPA)";
  if (a === 100 && b >= 64 && b <= 127) return "Carrier-grade NAT";
  if (a >= 224 && a <= 239) return "Multicast";
  if (a >= 240) return "Reserved";
  if (a === 0) return "This network";
  return "Public";
}

function classOf(ip: number): SubnetInfo["ipClass"] {
  const a = ip >>> 24;
  if (a < 128) return "A";
  if (a < 192) return "B";
  if (a < 224) return "C";
  if (a < 240) return "D (multicast)";
  return "E (reserved)";
}

export function calculateSubnet(ip: number, prefix: number): SubnetInfo {
  const mask = prefixToMask(prefix);
  const network = (ip & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const total = 2 ** (32 - prefix);
  const pointToPoint = prefix >= 31;
  return {
    address: formatIpv4(ip),
    prefix,
    mask: formatIpv4(mask),
    wildcard: formatIpv4(~mask >>> 0),
    network: formatIpv4(network),
    broadcast: formatIpv4(broadcast),
    firstHost: formatIpv4(pointToPoint ? network : network + 1),
    lastHost: formatIpv4(pointToPoint ? broadcast : broadcast - 1),
    usableHosts: prefix === 32 ? 1 : prefix === 31 ? 2 : total - 2,
    totalAddresses: total,
    ipClass: classOf(ip),
    scope: scopeOf(ip),
    binaryAddress: binary(ip),
    binaryMask: binary(mask),
  };
}

/**
 * Parses "192.168.1.10/24", "192.168.1.10 255.255.255.0" or an address plus a
 * separate mask/prefix field.
 */
export function parseSubnetInput(addressText: string, maskText: string): { ip: number; prefix: number } | string {
  let address = addressText.trim();
  let mask = maskText.trim();
  const slash = address.indexOf("/");
  if (slash >= 0) {
    mask = address.slice(slash + 1);
    address = address.slice(0, slash);
  } else if (address.includes(" ")) {
    [address, mask] = address.split(/\s+/, 2);
  }
  const ip = parseIpv4(address);
  if (ip === null) return "Enter a valid IPv4 address, such as 192.168.1.10.";
  if (!mask) return "Enter a prefix length (such as 24) or a subnet mask (such as 255.255.255.0).";
  const prefix = /^\/?\d{1,2}$/.test(mask) ? Number(mask.replace("/", "")) : maskToPrefix(mask);
  if (prefix === null || prefix > 32) return "The subnet mask must be contiguous, such as 255.255.255.0, or a prefix from 0 to 32.";
  return { ip, prefix };
}
