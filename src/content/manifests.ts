import type { ChamberId } from "../core/types";

/** Play order. One new idea per chamber; later sectors combine earlier ones. */
export const CHAMBER_ROUTE = [
  "awakening",
  "secondSelf",
  "crossing",
  "handNotBody",
  "traceWeight",
  "handoff",
  "lastHold",
] as const satisfies readonly ChamberId[];

export interface ChamberSector {
  id: string;
  /** Placeholder names — W3 owns the final copy. */
  name: { ko: string; en: string };
  chambers: readonly ChamberId[];
}

/** How the archive is filed, and how the chamber select groups it. */
export const CHAMBER_SECTORS: readonly ChamberSector[] = [
  { id: "prologue", name: { ko: "서장", en: "PROLOGUE" }, chambers: ["awakening", "secondSelf", "crossing"] },
  { id: "sector-1", name: { ko: "1구역", en: "SECTOR 1" }, chambers: ["handNotBody"] },
  { id: "sector-2", name: { ko: "2구역", en: "SECTOR 2" }, chambers: ["traceWeight"] },
  { id: "sector-3", name: { ko: "3구역", en: "SECTOR 3" }, chambers: ["handoff"] },
  { id: "sector-4", name: { ko: "4구역", en: "SECTOR 4" }, chambers: ["lastHold"] },
];

/**
 * Tape budget per sector. The prologue rooms are short by design; later rooms
 * may run up to twenty seconds as their routes grow.
 */
export const PROLOGUE_TAPE_CAP_TICKS = 8 * 30;
export const CHAMBER_TAPE_CAP_TICKS = 20 * 30;
