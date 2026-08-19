import type { ChamberId } from "../core/types";

export const FOUR_ROOM_ROUTE = ["crossing", "traceWeight", "handoff", "lastHold"] as const satisfies readonly ChamberId[];
