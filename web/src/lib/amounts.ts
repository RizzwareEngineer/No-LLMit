// Amounts on the table screen, in chips or in big blinds: the Chips/BB switch in the header's status row (UnitToggle),
// kept in localStorage like the sound setting. One format for both: chips whole, big blinds with one decimal under
// 100 BB and whole from 100 up, with " BB" (a column of them, Profits & Losses, carries the unit in its header).
import { useSyncExternalStore } from "react";

const STORAGE_KEY = 'nollmit:amounts';
let inBB: boolean | null = null; // null until read from storage
let bigBlind = 10; // the table's, from its stakes (the status row hands it over)
const listeners = new Set<() => void>();

export function subscribeAmounts(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// The stored choice. Pure, so it can be a useSyncExternalStore snapshot.
export function isBB(): boolean {
  if (inBB === null) {
    try {
      inBB = localStorage.getItem(STORAGE_KEY) === 'bb';
    } catch {
      inBB = false;
    }
  }
  return inBB;
}

export function setBB(on: boolean) {
  inBB = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'bb' : 'chips');
  } catch {}
  listeners.forEach(l => l());
}

export function setBigBlind(chips: number) {
  if (chips > 0 && chips !== bigBlind) {
    bigBlind = chips;
    listeners.forEach(l => l());
  }
}

// The big blind amounts are shown in, or null while they are in chips. The server renders chips.
export function useBigBlind(): number | null {
  return useSyncExternalStore(subscribeAmounts, () => (isBB() ? bigBlind : null), () => null);
}

// An amount in the unit shown, as NumberFlow takes it (the pot rolls in either unit).
export function amountParts(chips: number, bb: number | null) {
  const value = bb ? chips / bb : chips;
  return { value, format: { maximumFractionDigits: bb && Math.abs(value) < 100 ? 1 : 0 }, suffix: bb ? ' BB' : '' };
}

export function formatAmount(chips: number, bb: number | null, unit = true): string {
  const { value, format, suffix } = amountParts(chips, bb);
  return value.toLocaleString(undefined, format) + (unit ? suffix : '');
}

// Dev self-check of the format.
