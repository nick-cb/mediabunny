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
exports.registerAacDecoder = void 0;
const mediabunny_1 = require("mediabunny");
// @ts-expect-error An esbuild plugin handles this, TypeScript doesn't need to understand
const decode_worker_1 = __importDefault(require("./decode.worker"));
class AacDecoder extends mediabunny_1.CustomAudioDecoder {
    constructor() {
        super(...arguments);
        this.worker = null;
        this.nextMessageId = 0;
        this.pendingMessages = new Map();
        this.ctx = 0;
        this.sampleRate = 0;
        this.numberOfChannels = 0;
    }
    static supports(codec, config) {
        // Support AAC codec strings
        return codec === 'aac'
            && config.codec.startsWith('mp4a.40');
    }
    async init() {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        this.worker = (await (0, decode_worker_1.default)());
        const onMessage = (data) => {
            const pending = this.pendingMessages.get(data.id);
            assert(pending !== undefined);
            this.pendingMessages.delete(data.id);
            if (data.success) {
                pending.resolve(data.data);
            }
            else {
                pending.reject(data.error);
            }
        };
        if (this.worker.addEventListener) {
            this.worker.addEventListener('message', event => onMessage(event.data));
        }
        else {
            const nodeWorker = this.worker;
            nodeWorker.on('message', onMessage);
        }
        this.sampleRate = this.config.sampleRate;
        this.numberOfChannels = this.config.numberOfChannels;
        // Get description (AudioSpecificConfig) from the decoder config
        let description = null;
        if (this.config.description) {
            if (this.config.description instanceof ArrayBuffer) {
                description = this.config.description;
            }
            else {
                const view = this.config.description;
                description = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
            }
        }
        const result = await this.sendCommand({
            type: 'init',
            data: {
                numberOfChannels: this.config.numberOfChannels,
                sampleRate: this.config.sampleRate,
                description,
            },
        });
        this.ctx = result.ctx;
    }
    async decode(packet) {
        const encodedData = packet.data.buffer.slice(packet.data.byteOffset, packet.data.byteOffset + packet.data.byteLength);
        const result = await this.sendCommand({
            type: 'decode',
            data: {
                ctx: this.ctx,
                encodedData,
                timestamp: packet.timestamp,
                duration: packet.duration,
            },
        }, [encodedData]);
        this.emitFrames(result.frames);
    }
    async flush() {
        const result = await this.sendCommand({ type: 'flush', data: { ctx: this.ctx } });
        this.emitFrames(result.frames);
    }
    close() {
        if (this.ctx) {
            void this.sendCommand({ type: 'close', data: { ctx: this.ctx } });
        }
        this.worker?.terminate();
    }
    emitFrames(frames) {
        for (const frame of frames) {
            const floatData = new Float32Array(frame.decodedData);
            // Create AudioData-compatible init object
            const audioSample = new mediabunny_1.AudioSample({
                format: 'f32',
                sampleRate: frame.sampleRate || this.sampleRate,
                numberOfChannels: frame.numberOfChannels || this.numberOfChannels,
                numberOfFrames: frame.numberOfFrames,
                timestamp: frame.timestamp,
                data: floatData,
            });
            this.onSample(audioSample);
        }
    }
    sendCommand(command, transferables) {
        return new Promise((resolve, reject) => {
            const id = this.nextMessageId++;
            this.pendingMessages.set(id, {
                resolve: resolve,
                reject,
            });
            assert(this.worker);
            if (transferables) {
                this.worker.postMessage({ id, command }, transferables);
            }
            else {
                this.worker.postMessage({ id, command });
            }
        });
    }
}
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
const registerAacDecoder = () => {
    (0, mediabunny_1.registerDecoder)(AacDecoder);
};
exports.registerAacDecoder = registerAacDecoder;
function assert(x) {
    if (!x) {
        throw new Error('Assertion failed.');
    }
}
