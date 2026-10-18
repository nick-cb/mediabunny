/*!
 * Copyright (c) 2026-present, Vanilagy and contributors
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import createModule from '../build/aac';
import type { FrameInfo, WorkerCommand, WorkerResponse, WorkerResponseData } from './shared';

type ExtendedEmscriptenModule = EmscriptenModule & {
	cwrap: typeof cwrap;
	_send_packet: (ctx: number, pts: bigint, duration: bigint) => number;
};

let module: ExtendedEmscriptenModule;
let modulePromise: Promise<ExtendedEmscriptenModule> | null = null;

let initDecoderFn: (channels: number, sampleRate: number, extradata: number, extradataSize: number) => number;
let getDecodeInputPtr: (ctx: number, size: number) => number;
let sendPacketFn: (ctx: number, pts: bigint, duration: bigint) => number;
let receiveFrameFn: (ctx: number) => number;
let getDecodedData: (ctx: number) => number;
let getDecodedChannels: (ctx: number) => number;
let getDecodedSampleRate: (ctx: number) => number;
let flushDecoderFn: (ctx: number) => void;
let closeDecoderFn: (ctx: number) => void;

const ensureModule = async () => {
	if (!module) {
		if (modulePromise) {
			return modulePromise;
		}

		modulePromise = createModule() as Promise<ExtendedEmscriptenModule>;
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

const initDecoder = async (
	numberOfChannels: number,
	sampleRate: number,
	description: ArrayBuffer | null,
) => {
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

const drainFrames = (ctx: number, baseTimestamp: number, sampleRate: number) => {
	const frames: FrameInfo[] = [];

	let samples: number;
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

const decode = (ctx: number, encodedData: ArrayBuffer, timestamp: number, duration: number, sampleRate: number) => {
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

const onMessage = (data: { id: number; command: WorkerCommand }) => {
	const { id, command } = data;

	const handleCommand = async (): Promise<void> => {
		try {
			let result: WorkerResponseData;
			const transferables: Transferable[] = [];

			switch (command.type) {
				case 'init': {
					const { ctx } = await initDecoder(
						command.data.numberOfChannels,
						command.data.sampleRate,
						command.data.description,
					);
					result = { type: command.type, ctx };
				}; break;

				case 'decode': {
					const frames = decode(
						command.data.ctx,
						command.data.encodedData,
						command.data.timestamp,
						command.data.duration,
						48000, // This will be updated based on actual decoded sample rate
					);
					for (const f of frames) {
						transferables.push(f.decodedData);
					}
					result = { type: command.type, frames };
				}; break;

				case 'flush': {
					flushDecoderFn(command.data.ctx);
					result = { type: command.type, frames: [] };
				}; break;

				case 'close': {
					closeDecoderFn(command.data.ctx);
					result = { type: command.type };
				}; break;
			}

			const response: WorkerResponse = {
				id,
				success: true,
				data: result,
			};
			sendMessage(response, transferables);
		} catch (error: unknown) {
			const response: WorkerResponse = {
				id,
				success: false,
				error,
			};
			sendMessage(response);
		}
	};

	void handleCommand();
};

const sendMessage = (data: unknown, transferables?: Transferable[]) => {
	if (parentPort) {
		parentPort.postMessage(data, transferables ?? []);
	} else {
		self.postMessage(data, { transfer: transferables ?? [] });
	}
};

let parentPort: {
	postMessage: (data: unknown, transferables?: Transferable[]) => void;
	on: (event: string, listener: (data: never) => void) => void;
} | null = null;

if (typeof self === 'undefined') {
	const workerModule = 'worker_threads';
	// eslint-disable-next-line @stylistic/max-len
	// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-member-access
	parentPort = require(workerModule).parentPort;
}

if (parentPort) {
	parentPort.on('message', onMessage);
} else {
	self.addEventListener('message', event => onMessage(event.data as { id: number; command: WorkerCommand }));
}
