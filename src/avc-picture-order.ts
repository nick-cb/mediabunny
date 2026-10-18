/*!
 * Copyright (c) 2026-present, Vanilagy and contributors
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import {
	AvcNalUnitType,
	deserializeAvcDecoderConfigurationRecord,
	extractNalUnitTypeForAvc,
	iterateAvcNalUnits,
	parseAvcSps,
} from './codec-data';
import { readExpGolomb, readSignedExpGolomb, toUint8Array } from './misc';
import { Bitstream } from '../shared/bitstream';
import { EncodedPacket } from './packet';

// Only progressive, frame-coded AVC with type-0 POC is supported. POC alone is not a clock;
// AvcTimestampRepair also checks packet cadence before using it to derive timestamps.
export class AvcPictureOrder {
	private sps = new Map<number, NonNullable<ReturnType<typeof parseAvcSps>>>();
	private pps = new Map<number, { spsId: number; bottomFieldPocPresent: boolean }>();
	private previousMsb = 0;
	private previousLsb = 0;

	constructor(private config: VideoDecoderConfig) {
		if (config.description) {
			const record = deserializeAvcDecoderConfigurationRecord(toUint8Array(config.description));
			for (const sps of record?.sequenceParameterSets ?? []) this.addSps(sps);
			for (const pps of record?.pictureParameterSets ?? []) this.addPps(pps);
		}
	}

	reset() {
		this.previousMsb = 0;
		this.previousLsb = 0;
	}

	private addSps(data: Uint8Array) {
		const info = parseAvcSps(data);
		if (info) this.sps.set(info.seqParameterSetId, info);
	}

	private addPps(data: Uint8Array) {
		const bits = new Bitstream(unescapeNal(data));
		bits.skipBits(8); // NAL header
		const id = readExpGolomb(bits);
		const spsId = readExpGolomb(bits);
		bits.skipBits(1); // entropy_coding_mode_flag
		const bottomFieldPocPresent = !!bits.readBits(1);
		this.pps.set(id, { spsId, bottomFieldPocPresent });
	}

	read(packet: Uint8Array): { poc: number; idr: boolean } | null {
		try {
			for (const loc of iterateAvcNalUnits(packet, this.config)) {
				if (loc.offset + loc.length > packet.length) return null;
				const nal = packet.subarray(loc.offset, loc.offset + loc.length);
				const type = extractNalUnitTypeForAvc(nal[0]!);
				if (type === AvcNalUnitType.SPS) this.addSps(nal);
				if (type === AvcNalUnitType.PPS) this.addPps(nal);
				if (type !== AvcNalUnitType.IDR && type !== AvcNalUnitType.NON_IDR_SLICE) continue;

				const bits = new Bitstream(unescapeNal(nal));
				const reference = (bits.readBits(8) & 0x60) !== 0;
				readExpGolomb(bits); // first_mb_in_slice
				readExpGolomb(bits); // slice_type
				const pps = this.pps.get(readExpGolomb(bits));
				const sps = pps && this.sps.get(pps.spsId);
				if (!sps || sps.picOrderCntType !== 0 || !sps.frameMbsOnlyFlag
					|| sps.separateColourPlaneFlag || !sps.log2MaxPicOrderCntLsb
					|| sps.log2MaxPicOrderCntLsb > 30 || sps.log2MaxFrameNum > 30) return null;

				bits.skipBits(sps.log2MaxFrameNum); // frame_num
				const idr = type === AvcNalUnitType.IDR;
				if (idr) readExpGolomb(bits); // idr_pic_id
				const lsb = bits.readBits(sps.log2MaxPicOrderCntLsb);
				const bottomDelta = pps.bottomFieldPocPresent ? readSignedExpGolomb(bits) : 0;
				if (bits.getBitsLeft() < 0) return null;

				if (idr) this.reset();
				const maxLsb = 2 ** sps.log2MaxPicOrderCntLsb;
				let msb = this.previousMsb;
				if (!idr && lsb < this.previousLsb && this.previousLsb - lsb >= maxLsb / 2) msb += maxLsb;
				if (!idr && lsb > this.previousLsb && lsb - this.previousLsb > maxLsb / 2) msb -= maxLsb;
				if (reference) {
					this.previousMsb = msb;
					this.previousLsb = lsb;
				}
				const top = msb + lsb;
				return { poc: Math.min(top, top + bottomDelta), idr };
			}
		} catch {
			return null;
		}
		return null;
	}
}

const unescapeNal = (data: Uint8Array) => {
	const bytes: number[] = [];
	for (let i = 0; i < data.length; i++) {
		if (i >= 2 && data[i] === 3 && data[i - 1] === 0 && data[i - 2] === 0) continue;
		bytes.push(data[i]!);
	}
	return new Uint8Array(bytes);
};

/** Restores composition timestamps only for constant-rate, type-0 AVC with decode-time timestamps. */
export class AvcTimestampRepair {
	private order: AvcPictureOrder;
	private base = 0;
	private duration = 0;
	private decodeIndex = 0;
	private enabled = false;
	private eligible = false;

	constructor(config: VideoDecoderConfig) {
		this.order = new AvcPictureOrder(config);
	}

	get needed() {
		return this.enabled && this.eligible;
	}

	reset() {
		this.order.reset();
		this.eligible = false;
		this.enabled = false;
		this.decodeIndex = 0;
	}

	repair(packet: EncodedPacket): EncodedPacket {
		if (packet.sideData.alpha) {
			// Color and alpha must share their timestamps; do not repair only the color track.
			this.eligible = false;
			return packet;
		}
		const picture = this.order.read(packet.data);
		if (!picture || picture.poc < 0 || picture.poc % 2 !== 0) {
			this.eligible = false;
			return packet;
		}
		if (picture.idr) {
			this.base = packet.timestamp;
			this.duration = packet.duration;
			this.decodeIndex = 0;
			this.enabled = false;
			this.eligible = picture.poc === 0 && this.duration > 0;
		}
		if (!this.eligible) return packet;

		const expectedDecodeTime = this.base + this.decodeIndex * this.duration;
		const tolerance = Math.max(1e-6, this.duration * 0.01);
		if (Math.abs(packet.timestamp - expectedDecodeTime) > tolerance
			|| Math.abs(packet.duration - this.duration) > tolerance) {
			// Actual composition timestamps or variable cadence: leave them untouched.
			this.eligible = false;
			return packet;
		}

		if (picture.poc / 2 > this.decodeIndex) this.enabled = true;
		this.decodeIndex++;
		if (!this.enabled) return packet;

		return packet.clone({ timestamp: this.base + picture.poc / 2 * this.duration });
	}
}
