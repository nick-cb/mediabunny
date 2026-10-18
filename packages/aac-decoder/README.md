# @mediabunny/aac-decoder

[![](https://img.shields.io/npm/v/@mediabunny/aac-decoder)](https://www.npmjs.com/package/@mediabunny/aac-decoder)
[![](https://img.shields.io/bundlephobia/minzip/@mediabunny/aac-decoder)](https://bundlephobia.com/package/@mediabunny/aac-decoder)
[![](https://img.shields.io/npm/dm/@mediabunny/aac-decoder)](https://www.npmjs.com/package/@mediabunny/aac-decoder)
[![](https://img.shields.io/discord/1390044844285497344?logo=discord&label=Discord)](https://discord.gg/hmpkyYuS4U)

<div align="center">
    <img src="../../docs/public/mediabunny-logo.svg" width="180" height="180">
</div>

Some environments lack support for AAC decoding in their WebCodecs implementations (such as Tauri's WKWebView on macOS). This extension package provides a reliable AAC decoder for use with [Mediabunny](https://github.com/Vanilagy/mediabunny). It is implemented using Mediabunny's [custom coder API](https://mediabunny.dev/guide/supported-formats-and-codecs#custom-coders) and uses a fast, size-optimized WASM build of [FFmpeg](https://ffmpeg.org/)'s AAC decoder under the hood.

> This package, like the rest of Mediabunny, is enabled by its [sponsors](https://mediabunny.dev/#sponsors) and their donations. If you've derived value from this package, please consider [leaving a donation](https://github.com/sponsors/Vanilagy)! 💘

## Installation

This library peer-depends on Mediabunny. Install both using npm:
```bash
npm install mediabunny @mediabunny/aac-decoder
```

Alternatively, directly include them using a script tag:
```html
<script src="mediabunny.js"></script>
<script src="mediabunny-aac-decoder.js"></script>
```

This will expose the global objects `Mediabunny` and `MediabunnyAacDecoder`. Use `mediabunny-aac-decoder.d.ts` to provide types for these globals. You can download the built distribution files from the [releases page](https://github.com/Vanilagy/mediabunny/releases).

## Usage

```ts
import { registerAacDecoder } from '@mediabunny/aac-decoder';

registerAacDecoder();
```
That's it - Mediabunny now uses the registered AAC decoder automatically.

If you want to be more correct, check for native browser support first:
```ts
import { canDecodeAudio } from 'mediabunny';
import { registerAacDecoder } from '@mediabunny/aac-decoder';

if (!(await canDecodeAudio('aac'))) {
    registerAacDecoder();
}
```

## Example

Here, we play an MP4 with AAC audio in an environment without native WebCodecs support:

```ts
import {
    Input,
    ALL_FORMATS,
    UrlSource,
    AudioBufferSink,
} from 'mediabunny';
import { registerAacDecoder } from '@mediabunny/aac-decoder';

// Register the custom decoder for environments without native support
registerAacDecoder();

const input = new Input({
    source: new UrlSource('https://example.com/video.mp4'),
    formats: ALL_FORMATS,
});

const audioTrack = await input.getPrimaryAudioTrack();
if (audioTrack && await audioTrack.canDecode()) {
    const audioSink = new AudioBufferSink(audioTrack);
    // Use audioSink to retrieve decoded audio buffers
}
```

For more ways of using Mediabunny, refer to its [guide](https://mediabunny.dev/guide/introduction).

## Building and development

For simplicity, all built WASM artifacts are included in the repo, since these rarely change. However, here are the instructions for building them from scratch:

[Install Emscripten](https://emscripten.org/docs/getting_started/downloads.html) and clone [FFmpeg](https://github.com/FFmpeg/FFmpeg). Then, from the Mediabunny root and with Emscripten sourced in:

```bash
export FFMPEG_PATH=/path/to/ffmpeg
export MEDIABUNNY_ROOT=$PWD

# Build FFmpeg
cd $FFMPEG_PATH
emmake make distclean
emconfigure ./configure \
    --target-os=none \
    --arch=x86_32 \
    --enable-cross-compile \
    --disable-asm \
    --disable-x86asm \
    --disable-inline-asm \
    --disable-programs \
    --disable-doc \
    --disable-debug \
    --disable-all \
    --disable-everything \
    --disable-autodetect \
    --disable-pthreads \
    --disable-runtime-cpudetect \
    --enable-avcodec \
    --enable-decoder=aac \
    --cc="emcc" \
    --cxx=em++ \
    --ar=emar \
    --ranlib=emranlib \
    --extra-cflags="-DNDEBUG -Oz -flto -msimd128" \
    --extra-ldflags="-Oz -flto"
emmake make

# Compile the bridge between JavaScript and FFmpeg's API
cd $MEDIABUNNY_ROOT/packages/aac-decoder
emcc src/bridge.c \
    $FFMPEG_PATH/libavcodec/libavcodec.a \
    $FFMPEG_PATH/libavutil/libavutil.a \
    -I$FFMPEG_PATH \
    -s MODULARIZE=1 \
    -s EXPORT_ES6=1 \
    -s SINGLE_FILE=1 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s ENVIRONMENT=web,worker \
    -s FILESYSTEM=0 \
    -s MALLOC=emmalloc \
    -s SUPPORT_LONGJMP=0 \
    -s EXPORTED_RUNTIME_METHODS=cwrap,HEAPU8,HEAPF32,_malloc,_free \
    -s EXPORTED_FUNCTIONS=_malloc,_free \
    -msimd128 \
    -flto \
    -Oz \
    -o build/aac.js
```

This generates `build/aac.js`, which contains both the JavaScript "glue code" as well as the compiled WASM inlined.

### Building the package

Then, the complete JavaScript package can be built alongside the rest of Mediabunny by running `npm run build` in Mediabunny's root.
