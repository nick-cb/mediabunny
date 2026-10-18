"use strict";
/*!
 * Copyright (c) 2026-present, Vanilagy and contributors
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const aac_1 = __importDefault(require("../build/aac"));
let module;
let modulePromise = null;
let initDecoderFn;
let getDecodeInputPtr;
let sendPacketFn;
let receiveFrameFn;
let getDecodedData;
let getDecodedChannels;
let getDecodedSampleRate;
let flushDecoderFn;
let closeDecoderFn;
const ensureModule = async () => {
    if (!module) {
        if (modulePromise) {
            return modulePromise;
        }
        modulePromise = (0, aac_1.default)();
        module = await modulePromise;
        modulePromise = null;
        initDecoderFn = module.cwrap('init_decoder', 'number', ['number', 'number', 'number', 'number']);
        getDecodeInputPtr = module.cwrap('get_decode_input_ptr', 'number', ['number', 'number']);
        sendPacketFn = module._send_packet;
        receiveFrameFn = module.cwrap('receive_frame', 'number', ['number']);
        getDecodedData = module.cwrap('get_decoded_data', 'number', ['number']);
        getDecodedChannels = module.cwrap('get_decoded_channels', 'number', ['number']);
        getDecodedSampleRate = module.cwrap('get_decoded_sample_rate', 'number', ['number']);
        flushDecoderFn = module.cwrap('flush_decoder', null, ['number']);
        closeDecoderFn = module.cwrap('close_decoder', null, ['number']);
    }
};
const initDecoder = async (numberOfChannels, sampleRate, description) => {
    await ensureModule();
    let extradataPtr = 0;
    let extradataSize = 0;
    if (description && description.byteLength > 0) {
        extradataSize = description.byteLength;
        extradataPtr = module._malloc(extradataSize);
        module.HEAPU8.set(new Uint8Array(description), extradataPtr);
    }
    const ctx = initDecoderFn(numberOfChannels, sampleRate, extradataPtr, extradataSize);
    if (extradataPtr) {
        module._free(extradataPtr);
    }
    if (ctx === 0) {
        throw new Error('Failed to initialize AAC decoder.');
    }
    return { ctx };
};
const drainFrames = (ctx, baseTimestamp, sampleRate) => {
    const frames = [];
    let samples;
    while ((samples = receiveFrameFn(ctx)) > 0) {
        const ptr = getDecodedData(ctx);
        const channels = getDecodedChannels(ctx);
        const actualSampleRate = getDecodedSampleRate(ctx);
        const totalFloats = samples * channels;
        const decodedData = module.HEAPF32.slice(ptr / 4, ptr / 4 + totalFloats).buffer;
        frames.push({
            decodedData,
            numberOfFrames: samples,
            numberOfChannels: channels,
            sampleRate: actualSampleRate,
            timestamp: baseTimestamp,
        });
        // Update timestamp for next frame (in case multiple frames are decoded from one packet)
        baseTimestamp += samples / sampleRate;
    }
    return frames;
};
const decode = (ctx, encodedData, timestamp, duration, sampleRate) => {
    const encodedBytes = new Uint8Array(encodedData);
    const inputPtr = getDecodeInputPtr(ctx, encodedBytes.length);
    if (inputPtr === 0) {
        throw new Error('Failed to allocate decoder input buffer.');
    }
    module.HEAPU8.set(encodedBytes, inputPtr);
    // Convert timestamp to sample units
    const ptsInSamples = BigInt(Math.round(timestamp * sampleRate));
    const durationInSamples = BigInt(Math.round(duration * sampleRate));
    const ret = sendPacketFn(ctx, ptsInSamples, durationInSamples);
    if (ret < 0) {
        throw new Error(`Decode failed with error code ${ret}.`);
    }
    return drainFrames(ctx, timestamp, sampleRate);
};
const onMessage = (data) => {
    const { id, command } = data;
    const handleCommand = async () => {
        try {
            let result;
            const transferables = [];
            switch (command.type) {
                case 'init':
                    {
                        const { ctx } = await initDecoder(command.data.numberOfChannels, command.data.sampleRate, command.data.description);
                        result = { type: command.type, ctx };
                    }
                    ;
                    break;
                case 'decode':
                    {
                        const frames = decode(command.data.ctx, command.data.encodedData, command.data.timestamp, command.data.duration, 48000);
                        for (const f of frames) {
                            transferables.push(f.decodedData);
                        }
                        result = { type: command.type, frames };
                    }
                    ;
                    break;
                case 'flush':
                    {
                        flushDecoderFn(command.data.ctx);
                        result = { type: command.type, frames: [] };
                    }
                    ;
                    break;
                case 'close':
                    {
                        closeDecoderFn(command.data.ctx);
                        result = { type: command.type };
                    }
                    ;
                    break;
            }
            const response = {
                id,
                success: true,
                data: result,
            };
            sendMessage(response, transferables);
        }
        catch (error) {
            const response = {
                id,
                success: false,
                error,
            };
            sendMessage(response);
        }
    };
    void handleCommand();
};
const sendMessage = (data, transferables) => {
    if (parentPort) {
        parentPort.postMessage(data, transferables ?? []);
    }
    else {
        self.postMessage(data, { transfer: transferables ?? [] });
    }
};
let parentPort = null;
if (typeof self === 'undefined') {
    const workerModule = 'worker_threads';
    // eslint-disable-next-line @stylistic/max-len
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-member-access
    parentPort = require(workerModule).parentPort;
}
if (parentPort) {
    parentPort.on('message', onMessage);
}
else {
    self.addEventListener('message', event => onMessage(event.data));
}
