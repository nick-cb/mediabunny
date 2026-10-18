/*!
 * Copyright (c) 2026-present, Vanilagy and contributors
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import {
	CustomAudioDecoder,
	AudioCodec,
	AudioSample,
	EncodedPacket,
	registerDecoder,
} from 'mediabunny';
import type { FrameInfo, WorkerCommand, WorkerResponse, WorkerResponseData } from './shared';
// @ts-expect-error An esbuild plugin handles this, TypeScript doesn't need to understand
import createWorker from './decode.worker';

class AacDecoder extends CustomAudioDecoder {
	private worker: Worker | null = null;
	private nextMessageId = 0;
	private pendingMessages = new Map<number, {
		resolve: (value: WorkerResponseData) => void;
		reject: (reason?: unknown) => void;
	}>();

	private ctx = 0;
	private sampleRate = 0;
	private numberOfChannels = 0;

	static override supports(codec: AudioCodec, config: AudioDecoderConfig): boolean {
		// Support AAC codec strings
		return codec === 'aac'
			&& config.codec.startsWith('mp4a.40');
	}

	async init() {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-call
		this.worker = (await createWorker()) as Worker;

		const onMessage = (data: WorkerResponse) => {
			const pending = this.pendingMessages.get(data.id);
			assert(pending !== undefined);

			this.pendingMessages.delete(data.id);
			if (data.success) {
				pending.resolve(data.data);
			} else {
				pending.reject(data.error);
			}
		};

		if (this.worker.addEventListener) {
			this.worker.addEventListener('message', event => onMessage(event.data as WorkerResponse));
		} else {
			const nodeWorker = this.worker as unknown as {
				on: (event: string, listener: (data: never) => void) => void;
			};
			nodeWorker.on('message', onMessage);
		}

		this.sampleRate = this.config.sampleRate;
		this.numberOfChannels = this.config.numberOfChannels;

		// Get description (AudioSpecificConfig) from the decoder config
		let description: ArrayBuffer | null = null;
		if (this.config.description) {
			if (this.config.description instanceof ArrayBuffer) {
				description = this.config.description;
			} else {
				const view = this.config.description as ArrayBufferView;
				description = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
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

	async decode(packet: EncodedPacket) {
		const encodedData = packet.data.buffer.slice(
			packet.data.byteOffset,
			packet.data.byteOffset + packet.data.byteLength,
		) as ArrayBuffer;

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

	private emitFrames(frames: FrameInfo[]) {
		for (const frame of frames) {
			const floatData = new Float32Array(frame.decodedData);

			// Create AudioData-compatible init object
			const audioSample = new AudioSample({
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

	private sendCommand<T extends string>(
		command: WorkerCommand & { type: T },
		transferables?: Transferable[],
	) {
		return new Promise<WorkerResponseData & { type: T }>((resolve, reject) => {
			const id = this.nextMessageId++;
			this.pendingMessages.set(id, {
				resolve: resolve as (value: WorkerResponseData) => void,
				reject,
			});

			assert(this.worker);

			if (transferables) {
				this.worker.postMessage({ id, command }, transferables);
			} else {
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
export const registerAacDecoder = () => {
	registerDecoder(AacDecoder);
};

function assert(x: unknown): asserts x {
	if (!x) {
		throw new Error('Assertion failed.');
	}
}
