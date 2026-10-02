import { GgufMetadata } from '../types';

enum GgufType {
  UINT8 = 0,
  INT8 = 1,
  UINT16 = 2,
  INT16 = 3,
  UINT32 = 4,
  INT32 = 5,
  FLOAT32 = 6,
  BOOL = 7,
  STRING = 8,
  ARRAY = 9,
  UINT64 = 10,
  INT64 = 11,
  FLOAT64 = 12,
}

export async function parseGgufHeader(file: File): Promise<GgufMetadata> {
  // Read first 1MB to grab all header metadata
  const sliceSize = Math.min(file.size, 1024 * 1024);
  const slice = file.slice(0, sliceSize);
  const buffer = await slice.arrayBuffer();
  const view = new DataView(buffer);
  const decoder = new TextDecoder('utf-8');

  let offset = 0;

  // Check Magic
  if (buffer.byteLength < 16) {
    throw new Error('File too small to be a valid GGUF binary.');
  }

  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );

  if (magic !== 'GGUF') {
    throw new Error(`Invalid magic header: "${magic}". Expected "GGUF".`);
  }

  offset += 4;
  const version = view.getUint32(offset, true);
  offset += 4;

  const tensorCount = Number(view.getBigUint64(offset, true));
  offset += 8;

  const kvCount = Number(view.getBigUint64(offset, true));
  offset += 8;

  const rawKv: Record<string, string | number> = {};

  const readString = (): string => {
    if (offset + 8 > buffer.byteLength) return '';
    const len = Number(view.getBigUint64(offset, true));
    offset += 8;
    if (offset + len > buffer.byteLength) return '';
    const bytes = new Uint8Array(buffer, offset, len);
    offset += len;
    return decoder.decode(bytes);
  };

  const readValue = (type: GgufType): any => {
    switch (type) {
      case GgufType.UINT8: {
        const v = view.getUint8(offset);
        offset += 1;
        return v;
      }
      case GgufType.INT8: {
        const v = view.getInt8(offset);
        offset += 1;
        return v;
      }
      case GgufType.UINT16: {
        const v = view.getUint16(offset, true);
        offset += 2;
        return v;
      }
      case GgufType.INT16: {
        const v = view.getInt16(offset, true);
        offset += 2;
        return v;
      }
      case GgufType.UINT32: {
        const v = view.getUint32(offset, true);
        offset += 4;
        return v;
      }
      case GgufType.INT32: {
        const v = view.getInt32(offset, true);
        offset += 4;
        return v;
      }
      case GgufType.FLOAT32: {
        const v = view.getFloat32(offset, true);
        offset += 4;
        return v;
      }
      case GgufType.BOOL: {
        const v = view.getUint8(offset) !== 0;
        offset += 1;
        return v;
      }
      case GgufType.STRING: {
        return readString();
      }
      case GgufType.UINT64: {
        const v = Number(view.getBigUint64(offset, true));
        offset += 8;
        return v;
      }
      case GgufType.INT64: {
        const v = Number(view.getBigInt64(offset, true));
        offset += 8;
        return v;
      }
      case GgufType.FLOAT64: {
        const v = view.getFloat64(offset, true);
        offset += 8;
        return v;
      }
      case GgufType.ARRAY: {
        if (offset + 12 > buffer.byteLength) return [];
        const itemType = view.getUint32(offset, true) as GgufType;
        offset += 4;
        const arrayLen = Number(view.getBigUint64(offset, true));
        offset += 8;
        
        // Skip or read simple items if small
        if (arrayLen > 200) {
          // Skip large arrays like token vocab to keep parser instantaneous
          // Fast-forward calculation if fixed size
          if (itemType === GgufType.UINT32 || itemType === GgufType.INT32 || itemType === GgufType.FLOAT32) {
            offset += arrayLen * 4;
          }
          return `[Array of ${arrayLen} items]`;
        }
        const items = [];
        for (let i = 0; i < arrayLen && offset < buffer.byteLength; i++) {
          items.push(readValue(itemType));
        }
        return items;
      }
      default:
        return null;
    }
  };

  // Read KV metadata pairs
  for (let i = 0; i < kvCount && offset < buffer.byteLength - 8; i++) {
    try {
      const key = readString();
      if (!key) break;
      const type = view.getUint32(offset, true) as GgufType;
      offset += 4;
      const val = readValue(type);
      if (typeof val === 'string' || typeof val === 'number') {
        rawKv[key] = val;
      }
    } catch {
      break;
    }
  }

  // Extract common metadata
  const architecture = (rawKv['general.architecture'] as string) || 'llama';
  const contextLength =
    (rawKv[`${architecture}.context_length`] as number) ||
    (rawKv['llama.context_length'] as number) ||
    (rawKv['general.context_length'] as number) ||
    4096;
  const embeddingLength =
    (rawKv[`${architecture}.embedding_length`] as number) ||
    (rawKv['llama.embedding_length'] as number);
  const blockCount =
    (rawKv[`${architecture}.block_count`] as number) ||
    (rawKv['llama.block_count'] as number);
  const fileTypeNum = rawKv['general.file_type'] as number;

  const fileTypeMap: Record<number, string> = {
    0: 'ALL_F32',
    1: 'MOSTLY_F16',
    2: 'MOSTLY_Q4_0',
    3: 'MOSTLY_Q4_1',
    7: 'MOSTLY_Q8_0',
    8: 'MOSTLY_Q5_0',
    9: 'MOSTLY_Q5_1',
    10: 'MOSTLY_Q2_K',
    11: 'MOSTLY_Q3_K_S',
    12: 'MOSTLY_Q3_K_M',
    13: 'MOSTLY_Q3_K_L',
    14: 'MOSTLY_Q4_K_S',
    15: 'MOSTLY_Q4_K_M',
    16: 'MOSTLY_Q5_K_S',
    17: 'MOSTLY_Q5_K_M',
    18: 'MOSTLY_Q6_K',
  };

  const detectedQuant = fileTypeNum !== undefined ? fileTypeMap[fileTypeNum] || `Type_${fileTypeNum}` : 'Q4_K_M';

  return {
    magic,
    version,
    tensorCount,
    kvCount,
    architecture,
    contextLength,
    embeddingLength,
    blockCount,
    fileType: detectedQuant,
    quantization: detectedQuant,
    fileSizeMb: Math.round((file.size / (1024 * 1024)) * 10) / 10,
    fileName: file.name,
    rawKv,
  };
}
