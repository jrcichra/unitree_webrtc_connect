import * as LZ4 from "lz4js"

function decompress(compressed_data: Uint8Array, decomp_size: number): Uint8Array {
    return LZ4.decompress(compressed_data, decomp_size)
}

function bits_to_points(buf: Uint8Array, origin: number[], resolution: number = 0.05): Float64Array {
    const nonzero_indices: number[] = []
    for (let i = 0; i < buf.length; i++) {
        if (buf[i] !== 0) {
            nonzero_indices.push(i)
        }
    }

    if (nonzero_indices.length === 0) {
        return new Float64Array(0)
    }

    const points: number[] = []

    for (const idx of nonzero_indices) {
        const byte_value = buf[idx]
        const bits = []
        for (let b = 7; b >= 0; b--) {
            bits.push((byte_value >> b) & 1)
        }

        const z = Math.floor(idx / 0x800)
        const n_slice = idx % 0x800
        const y = Math.floor(n_slice / 0x10)
        const x_base = (n_slice % 0x10) * 8

        for (let bit = 0; bit < 8; bit++) {
            if (bits[bit] === 1) {
                const x = x_base + bit
                points.push(x * resolution + origin[0], y * resolution + origin[1], z * resolution + origin[2])
            }
        }
    }

    return new Float64Array(points)
}

export class NativeLidarDecoder {
    decode(compressed_data: Uint8Array, data: any): any {
        const decompressed = decompress(compressed_data, data.src_size)
        const points = bits_to_points(decompressed, data.origin, data.resolution)

        return {
            points: points,
        }
    }

    get_decoder_name(): string {
        return "NativeLidarDecoder"
    }
}

export class LibVoxelLidarDecoder {
    private wasmInstance: WebAssembly.Instance | null = null
    private memory: WebAssembly.Memory | null = null
    private malloc: ((size: number) => number) | null = null
    private free: ((ptr: number) => void) | null = null
    private generate:
        | ((
              input: number,
              compressedLength: number,
              decompressBufferSize: number,
              decompressBuffer: number,
              decompressedSize: number,
              positions: number,
              uvs: number,
              indices: number,
              faceCount: number,
              pointCount: number,
              someV: number
          ) => void)
        | null = null

    private input: number = 0
    private decompressBuffer: number = 0
    private positions: number = 0
    private uvs: number = 0
    private indices: number = 0
    private decompressedSize: number = 0
    private faceCount: number = 0
    private pointCount: number = 0

    async init(): Promise<void> {
        const response = await fetch("/src/libvoxel.wasm")
        const wasmBuffer = await response.arrayBuffer()

        const importObject = {
            env: {
                adjust_memory_size: (t: number) => this.adjust_memory_size(t),
                copy_memory_region: (t: number, n: number, a: number) => this.copy_memory_region(t, n, a),
            },
        }

        const result = await WebAssembly.instantiate(wasmBuffer, importObject)
        this.wasmInstance = result.instance
        this.memory = this.wasmInstance.exports.memory as WebAssembly.Memory

        this.generate = this.wasmInstance.exports.e as (
            input: number,
            compressedLength: number,
            decompressBufferSize: number,
            decompressBuffer: number,
            decompressedSize: number,
            positions: number,
            uvs: number,
            indices: number,
            faceCount: number,
            pointCount: number,
            someV: number
        ) => void
        this.malloc = this.wasmInstance.exports.f as (size: number) => number
        this.free = this.wasmInstance.exports.g as (ptr: number) => void

        // Allocate buffers
        if (!this.malloc) throw new Error("malloc function not available")
        this.input = this.malloc(61440)
        this.decompressBuffer = this.malloc(80000)
        this.positions = this.malloc(2880000)
        this.uvs = this.malloc(1920000)
        this.indices = this.malloc(5760000)
        this.decompressedSize = this.malloc(4)
        this.faceCount = this.malloc(4)
        this.pointCount = this.malloc(4)
    }

    private adjust_memory_size(_t: number): number {
        if (!this.memory) return 0
        return this.memory.buffer.byteLength
    }

    private copy_memory_region(target: number, start: number, length: number): void {
        if (!this.memory) return
        new Uint8Array(this.memory.buffer).copyWithin(target, start, start + length)
    }

    private get_value(ptr: number, type: string = "i8"): number {
        if (!this.memory) return 0
        const view = new DataView(this.memory.buffer)

        switch (type) {
            case "i8":
                return view.getInt8(ptr)
            case "i16":
                return view.getInt16(ptr, true)
            case "i32":
                return view.getInt32(ptr, true)
            case "float":
                return view.getFloat32(ptr, true)
            case "double":
                return view.getFloat64(ptr, true)
            default:
                return 0
        }
    }

    private set_value_arr(start: number, value: Uint8Array): void {
        if (!this.memory) return
        const buffer = new Uint8Array(this.memory.buffer)
        buffer.set(value, start)
    }

    async decode(compressed_data: Uint8Array, data: any): Promise<any> {
        if (!this.wasmInstance || !this.generate) {
            await this.init()
        }

        this.set_value_arr(this.input, compressed_data)

        const some_v = Math.floor(data.origin[2] / data.resolution)

        if (!this.generate) throw new Error("generate function not available")
        this.generate(
            this.input,
            compressed_data.length,
            80000, // decompressBufferSize
            this.decompressBuffer,
            this.decompressedSize,
            this.positions,
            this.uvs,
            this.indices,
            this.faceCount,
            this.pointCount,
            some_v
        )

        const c = this.get_value(this.pointCount, "i32")
        const u = this.get_value(this.faceCount, "i32")

        if (!this.memory) throw new Error("Memory not initialized")

        const buffer = new Uint8Array(this.memory.buffer)

        const positions_slice = buffer.slice(this.positions, this.positions + u * 12)
        const uvs_slice = buffer.slice(this.uvs, this.uvs + u * 8)
        const indices_slice = buffer.slice(this.indices, this.indices + u * 24)

        return {
            point_count: c,
            face_count: u,
            positions: positions_slice,
            uvs: uvs_slice,
            indices: new Uint32Array(indices_slice.buffer, indices_slice.byteOffset, indices_slice.length / 4),
        }
    }

    get_decoder_name(): string {
        return "LibVoxelLidarDecoder"
    }
}

export class UnifiedLidarDecoder {
    private decoder: NativeLidarDecoder | LibVoxelLidarDecoder
    private decoder_name: string

    constructor(decoder_type: string = "libvoxel") {
        if (decoder_type === "libvoxel") {
            this.decoder = new LibVoxelLidarDecoder()
            this.decoder_name = "LibVoxelLidarDecoder"
        } else if (decoder_type === "native") {
            this.decoder = new NativeLidarDecoder()
            this.decoder_name = "NativeLidarDecoder"
        } else {
            throw new Error("Invalid decoder type. Choose 'libvoxel' or 'native'.")
        }
    }

    async decode(binary_data: ArrayBuffer, data: any): Promise<any> {
        const compressed_data = new Uint8Array(binary_data)
        return await this.decoder.decode(compressed_data, data)
    }

    get_decoder_name(): string {
        return this.decoder_name
    }
}
