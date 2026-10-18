/*!
 * Copyright (c) 2026-present, Vanilagy and contributors
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
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
//# sourceMappingURL=decoder.d.ts.map