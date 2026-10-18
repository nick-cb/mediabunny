/*!
 * Copyright (c) 2026-present, Vanilagy and contributors
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

#include <emscripten.h>
#include <stdlib.h>
#include <string.h>
#include "libavcodec/avcodec.h"
#include "libavutil/opt.h"
#include "libavutil/channel_layout.h"
#include "libavutil/log.h"

typedef struct {
	AVCodecContext *codec_ctx;
	AVPacket *packet;
	AVFrame *frame;
	float *output_buffer;
	int output_buffer_size;
	int decoded_samples;
	int decoded_channels;
	int decoded_sample_rate;
} DecoderContext;

EMSCRIPTEN_KEEPALIVE
DecoderContext *init_decoder(int channels, int sample_rate, uint8_t *extradata, int extradata_size) {
	av_log_set_level(AV_LOG_ERROR);

	const AVCodec *codec = avcodec_find_decoder(AV_CODEC_ID_AAC);
	if (!codec) {
		return NULL;
	}

	AVCodecContext *codec_ctx = avcodec_alloc_context3(codec);
	if (!codec_ctx) {
		return NULL;
	}

	codec_ctx->sample_rate = sample_rate;

	AVChannelLayout layout;
	av_channel_layout_default(&layout, channels);
	av_channel_layout_copy(&codec_ctx->ch_layout, &layout);
	av_channel_layout_uninit(&layout);

	// Set extradata (AudioSpecificConfig) if provided
	if (extradata && extradata_size > 0) {
		codec_ctx->extradata = av_malloc(extradata_size + AV_INPUT_BUFFER_PADDING_SIZE);
		if (!codec_ctx->extradata) {
			avcodec_free_context(&codec_ctx);
			return NULL;
		}
		memcpy(codec_ctx->extradata, extradata, extradata_size);
		memset(codec_ctx->extradata + extradata_size, 0, AV_INPUT_BUFFER_PADDING_SIZE);
		codec_ctx->extradata_size = extradata_size;
	}

	if (avcodec_open2(codec_ctx, codec, NULL) < 0) {
		avcodec_free_context(&codec_ctx);
		return NULL;
	}

	AVPacket *packet = av_packet_alloc();
	if (!packet) {
		avcodec_free_context(&codec_ctx);
		return NULL;
	}

	AVFrame *frame = av_frame_alloc();
	if (!frame) {
		av_packet_free(&packet);
		avcodec_free_context(&codec_ctx);
		return NULL;
	}

	DecoderContext *ctx = malloc(sizeof(DecoderContext));
	if (!ctx) {
		av_frame_free(&frame);
		av_packet_free(&packet);
		avcodec_free_context(&codec_ctx);
		return NULL;
	}

	ctx->codec_ctx = codec_ctx;
	ctx->packet = packet;
	ctx->frame = frame;
	ctx->output_buffer = NULL;
	ctx->output_buffer_size = 0;
	ctx->decoded_samples = 0;
	ctx->decoded_channels = channels;
	ctx->decoded_sample_rate = sample_rate;

	return ctx;
}

EMSCRIPTEN_KEEPALIVE
uint8_t *get_decode_input_ptr(DecoderContext *ctx, int size) {
	av_packet_unref(ctx->packet);

	if (av_new_packet(ctx->packet, size) < 0) {
		return NULL;
	}

	return ctx->packet->data;
}

EMSCRIPTEN_KEEPALIVE
int send_packet(DecoderContext *ctx, int64_t pts, int64_t duration) {
	ctx->packet->pts = pts;
	ctx->packet->dts = pts;
	ctx->packet->duration = duration;

	return avcodec_send_packet(ctx->codec_ctx, ctx->packet);
}

EMSCRIPTEN_KEEPALIVE
int receive_frame(DecoderContext *ctx) {
	av_frame_unref(ctx->frame);

	int ret = avcodec_receive_frame(ctx->codec_ctx, ctx->frame);
	if (ret == AVERROR(EAGAIN) || ret == AVERROR_EOF) {
		return 0;
	}
	if (ret < 0) {
		return ret;
	}

	int nb_samples = ctx->frame->nb_samples;
	int channels = ctx->frame->ch_layout.nb_channels;
	int total_samples = nb_samples * channels;

	// Ensure output buffer is large enough
	int required_size = total_samples * sizeof(float);
	if (ctx->output_buffer_size < required_size) {
		free(ctx->output_buffer);
		ctx->output_buffer = malloc(required_size);
		if (!ctx->output_buffer) {
			ctx->output_buffer_size = 0;
			return -1;
		}
		ctx->output_buffer_size = required_size;
	}

	// Convert to interleaved f32
	// FFmpeg AAC decoder outputs in FLTP (float planar) format
	if (ctx->frame->format == AV_SAMPLE_FMT_FLTP) {
		for (int i = 0; i < nb_samples; i++) {
			for (int ch = 0; ch < channels; ch++) {
				float *plane = (float *)ctx->frame->data[ch];
				ctx->output_buffer[i * channels + ch] = plane[i];
			}
		}
	} else if (ctx->frame->format == AV_SAMPLE_FMT_FLT) {
		// Already interleaved float
		memcpy(ctx->output_buffer, ctx->frame->data[0], total_samples * sizeof(float));
	} else if (ctx->frame->format == AV_SAMPLE_FMT_S16P) {
		// Planar s16 - convert to interleaved f32
		for (int i = 0; i < nb_samples; i++) {
			for (int ch = 0; ch < channels; ch++) {
				int16_t *plane = (int16_t *)ctx->frame->data[ch];
				ctx->output_buffer[i * channels + ch] = plane[i] / 32768.0f;
			}
		}
	} else if (ctx->frame->format == AV_SAMPLE_FMT_S16) {
		// Interleaved s16 - convert to interleaved f32
		int16_t *data = (int16_t *)ctx->frame->data[0];
		for (int i = 0; i < total_samples; i++) {
			ctx->output_buffer[i] = data[i] / 32768.0f;
		}
	} else {
		// Unsupported format
		return -1;
	}

	ctx->decoded_samples = nb_samples;
	ctx->decoded_channels = channels;
	ctx->decoded_sample_rate = ctx->frame->sample_rate;

	return nb_samples;
}

EMSCRIPTEN_KEEPALIVE
float *get_decoded_data(DecoderContext *ctx) {
	return ctx->output_buffer;
}

EMSCRIPTEN_KEEPALIVE
int get_decoded_samples(DecoderContext *ctx) {
	return ctx->decoded_samples;
}

EMSCRIPTEN_KEEPALIVE
int get_decoded_channels(DecoderContext *ctx) {
	return ctx->decoded_channels;
}

EMSCRIPTEN_KEEPALIVE
int get_decoded_sample_rate(DecoderContext *ctx) {
	return ctx->decoded_sample_rate;
}

EMSCRIPTEN_KEEPALIVE
int64_t get_decoded_pts(DecoderContext *ctx) {
	return ctx->frame->pts;
}

EMSCRIPTEN_KEEPALIVE
void flush_decoder(DecoderContext *ctx) {
	avcodec_flush_buffers(ctx->codec_ctx);
}

EMSCRIPTEN_KEEPALIVE
void close_decoder(DecoderContext *ctx) {
	free(ctx->output_buffer);
	av_frame_free(&ctx->frame);
	av_packet_free(&ctx->packet);
	avcodec_free_context(&ctx->codec_ctx);
	free(ctx);
}
