/*!
 * Copyright (c) 2026-present, Vanilagy and contributors
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
export type WorkerCommand = {
    type: 'init';
    data: {
        numberOfChannels: number;
        sampleRate: number;
        description: ArrayBuffer | null;
    };
} | {
    type: 'decode';
    data: {
        ctx: number;
        encodedData: ArrayBuffer;
        timestamp: number;
        duration: number;
    };
} | {
    type: 'flush';
    data: {
        ctx: number;
    };
} | {
    type: 'close';
    data: {
        ctx: number;
    };
};
export type FrameInfo = {
    decodedData: ArrayBuffer;
    numberOfFrames: number;
    numberOfChannels: number;
    sampleRate: number;
    timestamp: number;
};
export type WorkerResponseData = {
    type: 'init';
    ctx: number;
} | {
    type: 'decode';
    frames: FrameInfo[];
} | {
    type: 'flush';
    frames: FrameInfo[];
} | {
    type: 'close';
};
export type WorkerResponse = {
    id: number;
} & ({
    success: true;
    data: WorkerResponseData;
} | {
    success: false;
    error: unknown;
});
//# sourceMappingURL=shared.d.ts.map