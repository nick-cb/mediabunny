#!/bin/bash
set -e

# Ensure Homebrew's Python is used
export PATH="/opt/homebrew/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FFMPEG_DIR="${SCRIPT_DIR}/ffmpeg-src"

# Clone FFmpeg if not exists
if [ ! -d "$FFMPEG_DIR" ]; then
    echo "Cloning FFmpeg..."
    git clone --depth 1 https://github.com/FFmpeg/FFmpeg.git "$FFMPEG_DIR"
fi

cd "$FFMPEG_DIR"

echo "Cleaning previous build..."
make distclean 2>/dev/null || true

echo "Configuring FFmpeg for Emscripten..."
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
    --cxx="em++" \
    --ar="emar" \
    --ranlib="emranlib" \
    --extra-cflags="-DNDEBUG -Oz -flto -msimd128" \
    --extra-ldflags="-Oz -flto"

echo "Building FFmpeg..."
emmake make -j$(sysctl -n hw.ncpu)

echo "Building WASM bridge..."
cd "$SCRIPT_DIR"
emcc src/bridge.c \
    "$FFMPEG_DIR/libavcodec/libavcodec.a" \
    "$FFMPEG_DIR/libavutil/libavutil.a" \
    -I"$FFMPEG_DIR" \
    -s MODULARIZE=1 \
    -s EXPORT_ES6=1 \
    -s SINGLE_FILE=1 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s ENVIRONMENT=web,worker \
    -s FILESYSTEM=0 \
    -s MALLOC=emmalloc \
    -s SUPPORT_LONGJMP=0 \
    -s EXPORTED_RUNTIME_METHODS=cwrap,HEAPU8,HEAPF32 \
    -s EXPORTED_FUNCTIONS=_malloc,_free \
    -msimd128 \
    -flto \
    -Oz \
    -o build/aac.js

echo "Done! WASM module built at build/aac.js"
