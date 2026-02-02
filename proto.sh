#!/bin/bash

set -e

PROTO_DIR="src"
OUT_DIR="src/generated"
PLUGIN="./node_modules/.bin/protoc-gen-ts_proto"

# ts_proto options
OPTS=(
    "--ts_proto_opt=nestJs=true"
    "--ts_proto_opt=addGrpcMetadata=false"
    "--ts_proto_opt=exportCommonSymbols=false"
    "--ts_proto_opt=useOptionals=messages"
)

generate() {
    echo "Generating TypeScript gRPC code..."
    
    # Find all proto files recursively
    readarray -t proto_files < <(find "$PROTO_DIR" -name "*.proto" 2>/dev/null)
    
    if [ ${#proto_files[@]} -eq 0 ]; then
        echo "No proto files found in $PROTO_DIR"
        return 0
    fi
    
    echo "Found ${#proto_files[@]} proto files:"
    printf '  - %s\n' "${proto_files[@]}"
    
    mkdir -p "$OUT_DIR"
    
    # Generate all files at once (handles cross-file imports correctly)
    protoc \
    --plugin="$PLUGIN" \
    --ts_proto_out="$OUT_DIR" \
    "${OPTS[@]}" \
    --proto_path="$PROTO_DIR" \
    "${proto_files[@]}"
    
    echo "✅ Generated TypeScript files in $OUT_DIR"
}

watch_mode() {
    if command -v inotifywait >/dev/null 2>&1; then
        echo "👁️  Watching $PROTO_DIR for changes..."
        while inotifywait -r -e modify,create,delete,move "$PROTO_DIR" --include=".*\.proto$" 2>/dev/null; do
            sleep 0.5
            generate
        done
        elif command -v fswatch >/dev/null 2>&1; then
        echo "👁️  Watching $PROTO_DIR for changes..."
        fswatch -o "$PROTO_DIR" | while read; do
            generate
        done
    else
        echo "❌ Error: Install inotifywait (Linux: apt install inotify-tools) or fswatch (macOS: brew install fswatch) for watch mode"
        exit 1
    fi
}

# Main
if [ "$1" == "watch" ] || [ "$1" == "-w" ]; then
    watch_mode
else
    generate
fi