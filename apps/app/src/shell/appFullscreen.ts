import type { InjectionKey, Ref } from "vue";

/**
 * Fullscreen control shared from the app shell (PublicShell) down to the player.
 * The whole shell goes fullscreen, so the top bar can be hidden and the active
 * view fills the screen. Provided by PublicShell, consumed by the viewer.
 */
export interface AppFullscreen {
    isFullscreen: Ref<boolean>;
    toggle: () => Promise<void>;
}

export const appFullscreenKey: InjectionKey<AppFullscreen> =
    Symbol("appFullscreen");
