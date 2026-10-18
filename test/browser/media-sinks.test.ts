import { expect, test } from 'vitest';
import { Input } from '../../src/input.js';
import { BufferSource, UrlSource } from '../../src/source.js';
import { ALL_FORMATS } from '../../src/input-format.js';
import { assert, isWebKit } from '../../src/misc.js';
import { AudioSampleSink, VideoSampleSink } from '../../src/media-sink.js';
import { Output } from '../../src/output.js';
import { MpegTsOutputFormat } from '../../src/output-format.js';
import { BufferTarget } from '../../src/target.js';
import { Conversion } from '../../src/conversion.js';

// https://github.com/Vanilagy/mediabunny/issues/370
test('Negative audio timestamps are preserved', async () => {
	using input = new Input({
		source: new UrlSource('/edts.mp4'),
		formats: ALL_FORMATS,
	});

	const track = await input.getPrimaryAudioTrack();
	assert(track);

	expect(await track.getFirstTimestamp()).toBeLessThan(0);

	const sink = new AudioSampleSink(track);

	for await (using sample of sink.samples()) {
		expect(sample.timestamp).toBe(await track.getFirstTimestamp());
		break;
	}
});

test('No B-frames are skipped when software-decoding AVC', async () => {
	using input = new Input({
		source: new UrlSource('/missing-reorder-metadata-v1.mp4'),
		formats: ALL_FORMATS,
	});

	const track = await input.getPrimaryVideoTrack();
	assert(track);

	const sink = new VideoSampleSink(track, {
		hardwareAcceleration: 'prefer-software',
	});
	let count = 0;

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	for await (using sample of sink.samples()) {
		count++;
	}

	expect(count).toBe(48);
});

test('No B-frames are skipped when software-decoding AVC, Annex B edition', async () => {
	using input = new Input({
		source: new UrlSource('/missing-reorder-metadata-v1.mp4'),
		formats: ALL_FORMATS,
	});

	// Force Annex B by converting to MPEG-TS
	const output = new Output({
		format: new MpegTsOutputFormat(),
		target: new BufferTarget(),
	});

	const conversion = await Conversion.init({ input, output, copy: { mode: 'forced' } });
	await conversion.execute();

	using newInput = new Input({
		source: new BufferSource(output.target.buffer!),
		formats: ALL_FORMATS,
	});

	const track = await newInput.getPrimaryVideoTrack();
	assert(track);

	const sink = new VideoSampleSink(track, {
		hardwareAcceleration: 'prefer-software',
	});
	let count = 0;

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	for await (using sample of sink.samples()) {
		count++;
	}

	expect(count).toBe(48);
});

test('Fallback sample past the end survives iterator return', async () => {
	using input = new Input({
		source: new UrlSource('/video.mp4'),
		formats: ALL_FORMATS,
	});

	const track = await input.getPrimaryVideoTrack();
	assert(track);

	const sink = new VideoSampleSink(track);
	const iterator = sink.samples(await track.computeDuration() + 0.5);

	const { value: sample } = await iterator.next();
	assert(sample);
	await iterator.return();

	expect(sample._closed).toBe(false);
	sample.close();
});

// Both files contain the same x264-encoded testsrc2 frames. The second has decode-time timestamps
// in place of composition timestamps, as can happen when an MP4 omits ctts.
test('AVC with missing composition timestamps displays the same pictures as a valid MP4', async () => {
	const read = async (path: string, seeks?: number[]) => {
		using input = new Input({ source: new UrlSource(path), formats: ALL_FORMATS });
		const track = await input.getPrimaryVideoTrack();
		assert(track);
		const sink = new VideoSampleSink(track);
		const canvas = new OffscreenCanvas(48, 27);
		const context = canvas.getContext('2d')!;
		const frames: { timestamp: number; hash: number }[] = [];
		const samples = seeks ? sink.samplesAtTimestamps(seeks) : sink.samples();
		for await (const sample of samples) {
			assert(sample);
			sample.draw(context, 0, 0, 48, 27);
			const pixels = context.getImageData(0, 0, 48, 27).data;
			let hash = 2166136261;
			for (let i = 0; i < pixels.length; i++) {
				hash = Math.imul(hash ^ pixels[i]!, 16777619);
			}
			frames.push({ timestamp: sample.timestamp, hash: hash >>> 0 });
			sample.close();
		}
		return frames;
	};

	const valid = await read('/avc-ctts.mp4');
	expect(valid).toHaveLength(60);
	expect(valid.map(x => x.timestamp)).toEqual(Array.from({ length: 60 }, (_, i) => i / 30));
	expect(await read('/avc-no-ctts.mp4')).toEqual(valid);

	// The lookahead for sparse requests repairs WebKit's decoder path; other browsers already
	// assign output timestamps in display order but do not look ahead on malformed sparse seeks.
	if (isWebKit()) {
		const seeks = [0.1, 0.5, 1.1, 1.5];
		expect(await read('/avc-no-ctts.mp4', seeks)).toEqual(await read('/avc-ctts.mp4', seeks));
	}
});
