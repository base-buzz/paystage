/**
 * A small, deterministic ZIP writer for the `.pkpass` container.
 *
 * A pass is a ZIP, and Node has no ZIP writer in its standard library. The archive is small and stored
 * uncompressed (method 0): Apple accepts STORE entries, PNGs are already compressed, and a hand-written
 * writer is less code than the dependency it would replace. No ZIP64, no encryption, no comments — the
 * only inputs are the six files a pass needs.
 */

/** CRC-32 (IEEE 802.3), the checksum ZIP requires. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 1980-01-01 00:00:00, the earliest DOS timestamp. Fixed so the same inputs produce the same bytes. */
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

export interface ZipEntry {
  /** Archive path. The writer refuses traversal and absolute paths. */
  name: string;
  data: Uint8Array;
}

interface CentralRecord {
  name: Buffer;
  crc: number;
  size: number;
  offset: number;
}

/**
 * Build a ZIP archive. Entries are written in the order supplied; callers pass the Apple-required
 * order so a reader sees the manifest before the signature.
 */
export function createZip(entries: readonly ZipEntry[]): Buffer {
  const names = new Set<string>();
  const central: CentralRecord[] = [];
  const localParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    if (entry.name.length === 0) throw new Error("createZip: entry name is empty");
    if (entry.name.startsWith("/") || entry.name.includes("..") || entry.name.includes("\\")) {
      throw new Error(`createZip: unsafe entry name ${JSON.stringify(entry.name)}`);
    }
    if (names.has(entry.name)) throw new Error(`createZip: duplicate entry ${JSON.stringify(entry.name)}`);
    names.add(entry.name);

    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data);
    const crc = crc32(data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0); // local file header
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // STORE
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    name.copy(local, 30);

    localParts.push(local, data);
    central.push({ name, crc, size: data.length, offset });
    offset += local.length + data.length;
  }

  const centralParts: Buffer[] = [];
  let centralSize = 0;
  for (const record of central) {
    const header = Buffer.alloc(46 + record.name.length);
    header.writeUInt32LE(0x02014b50, 0); // central directory header
    header.writeUInt16LE(20, 4); // version made by
    header.writeUInt16LE(20, 6); // version needed
    header.writeUInt16LE(0x0800, 8); // UTF-8 names
    header.writeUInt16LE(0, 10); // STORE
    header.writeUInt16LE(DOS_TIME, 12);
    header.writeUInt16LE(DOS_DATE, 14);
    header.writeUInt32LE(record.crc, 16);
    header.writeUInt32LE(record.size, 20);
    header.writeUInt32LE(record.size, 24);
    header.writeUInt16LE(record.name.length, 28);
    header.writeUInt16LE(0, 30); // extra
    header.writeUInt16LE(0, 32); // comment
    header.writeUInt16LE(0, 34); // disk number
    header.writeUInt16LE(0, 36); // internal attributes
    header.writeUInt32LE(0, 38); // external attributes
    header.writeUInt32LE(record.offset, 42);
    record.name.copy(header, 46);
    centralParts.push(header);
    centralSize += header.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with central directory
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, ...centralParts, end]);
}

export interface ZipListing {
  name: string;
  size: number;
  crc: number;
  offset: number;
}

/** Read the central directory without trusting the file's own manifest. Used by the tests. */
export function listZip(buffer: Buffer): ZipListing[] {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("listZip: no end of central directory");
  const count = buffer.readUInt16LE(eocd + 10);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  const entries: ZipListing[] = [];
  let cursor = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("listZip: bad central header");
    const crc = buffer.readUInt32LE(cursor + 16);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const offset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    entries.push({ name, size, crc, offset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Extract one entry's bytes by reading its local header. Used by the tests. */
export function readZipEntry(buffer: Buffer, name: string): Buffer {
  const entry = listZip(buffer).find((item) => item.name === name);
  if (!entry) throw new Error(`readZipEntry: ${name} is not in the archive`);
  if (buffer.readUInt32LE(entry.offset) !== 0x04034b50) throw new Error("readZipEntry: bad local header");
  const nameLength = buffer.readUInt16LE(entry.offset + 26);
  const extraLength = buffer.readUInt16LE(entry.offset + 28);
  const start = entry.offset + 30 + nameLength + extraLength;
  return buffer.subarray(start, start + entry.size);
}
