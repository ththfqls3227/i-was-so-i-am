// Types for the gate server helper, so playwright.config.ts can import the port
// from the one place that defines it rather than restating the number.
export declare const E2E_OUT_DIR: string;
export declare const E2E_PORT: number;
export declare function startGameServer(options?: { label?: string }): Promise<{
  url: string;
  stop: () => Promise<void>;
}>;
