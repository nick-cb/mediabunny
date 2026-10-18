"use strict";
/*!
 * Copyright (c) 2026-present, Vanilagy and contributors
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAacDecoder = void 0;
const AAC_DECODER_LOADED_SYMBOL = Symbol.for('@mediabunny/aac-decoder loaded');
if (globalThis[AAC_DECODER_LOADED_SYMBOL]) {
    console.error('[WARNING]\n@mediabunny/aac-decoder was loaded twice.'
        + ' This will likely cause the decoder not to work correctly.'
        + ' Check if multiple dependencies are importing different versions of @mediabunny/aac-decoder,'
        + ' or if something is being bundled incorrectly.');
}
globalThis[AAC_DECODER_LOADED_SYMBOL] = true;
var decoder_1 = require("./decoder");
Object.defineProperty(exports, "registerAacDecoder", { enumerable: true, get: function () { return decoder_1.registerAacDecoder; } });
