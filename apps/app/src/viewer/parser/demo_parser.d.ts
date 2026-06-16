/* tslint:disable */
/* eslint-disable */

/**
 * Parser output for the worker: the `Replay` (JSON) and the voice blob (bytes,
 * `CLV2` layout). Exposed with getters because `String`/`Vec<u8>` become
 * `string`/`Uint8Array` in JS.
 */
export class ParseOutput {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * `Replay` serialized as JSON (`replay-schema 2D` contract).
     */
    readonly replay: string;
    /**
     * Voice blob in the `CLV2` layout. Empty (no players) when the demo has no
     * recorded voice.
     */
    readonly voice: Uint8Array;
}

/**
 * Initializes readable panic hooks in the browser console. Idempotent.
 */
export function init(): void;

/**
 * Worker entry point: takes the `.dem` bytes and returns the `Replay` (JSON)
 * together with the voice blob. Throws an error string on failure.
 */
export function parse_demo(bytes: Uint8Array, frame_rate: number): ParseOutput;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_parseoutput_free: (a: number, b: number) => void;
    readonly parse_demo: (a: number, b: number, c: number) => [number, number, number];
    readonly parseoutput_replay: (a: number) => [number, number];
    readonly parseoutput_voice: (a: number) => [number, number];
    readonly init: () => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
