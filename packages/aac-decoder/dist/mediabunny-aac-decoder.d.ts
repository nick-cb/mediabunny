/**
 * Registers the AAC decoder, which Mediabunny will then use automatically when applicable. Make sure to call this
 * function before starting any decoding task.
 *
 * This is particularly useful in environments where the native WebCodecs AudioDecoder is not available,
 * such as Tauri's WKWebView on macOS.
 *
 * ```ts
 * import { registerAacDecoder } from '@mediabunny/aac-decoder';
 *
 * // Register early in your application
 * registerAacDecoder();
 * ```
 *
 * @group \@mediabunny/aac-decoder
 * @public
 */
export declare const registerAacDecoder: () => void;

export { }
export as namespace MediabunnyAacDecoder;
