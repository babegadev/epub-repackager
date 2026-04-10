import JSZip from "jszip";

const textDecoder = new TextDecoder();
const EPUB_MIME = "application/epub+zip";
const MISSING_SOURCE_ERROR =
  "A requested file or directory could not be found at the time an operation was processed.";

const JUNK_EXACT_NAMES = new Set([
  "iTunesMetadata.plist",
  "iTunesArtwork",
  "META-INF/com.apple.ibooks.display-options.xml",
]);

function isJunkPath(path) {
  const normalized = path.replace(/^\.\//, "").replace(/\\/g, "/");
  if (normalized.startsWith("__MACOSX/")) {
    return true;
  }
  if (normalized.endsWith("/.DS_Store") || normalized === ".DS_Store") {
    return true;
  }
  if (normalized.endsWith("/Thumbs.db") || normalized === "Thumbs.db") {
    return true;
  }
  return JUNK_EXACT_NAMES.has(normalized);
}

function safeZipPath(path) {
  return path.replace(/^\.\//, "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function createEpubZip() {
  const zip = new JSZip();
  zip.file("mimetype", EPUB_MIME, { compression: "STORE" });
  return zip;
}

function getProgressPortion(processed, total, cap = 0.75) {
  return (processed / Math.max(total, 1)) * cap;
}

async function generateEpubBlob(zip, onProgress = () => {}) {
  onProgress(0.85);
  const blob = await zip.generateAsync(
    {
      type: "blob",
      compression: "DEFLATE",
      streamFiles: true,
      mimeType: EPUB_MIME,
    },
    (metadata) => {
      onProgress(0.85 + metadata.percent * 0.0015);
    },
  );
  onProgress(1);
  return blob;
}

function getEntryDate(entry) {
  if (typeof entry.lastModified === "number" && entry.lastModified > 0) {
    return new Date(entry.lastModified);
  }
  return entry.date || undefined;
}

function stripCommonRoot(entries) {
  const candidatePaths = entries
    .map((entry) => safeZipPath(entry.path))
    .filter((path) => path && path !== "mimetype");

  if (candidatePaths.length === 0) {
    return entries;
  }

  const firstSegment = candidatePaths[0].split("/")[0];
  if (!firstSegment) {
    return entries;
  }

  const shouldStrip = candidatePaths.every(
    (path) => path === firstSegment || path.startsWith(`${firstSegment}/`),
  );

  if (!shouldStrip) {
    return entries;
  }

  return entries.map((entry) => {
    const path = safeZipPath(entry.path);
    if (!path || path === "mimetype") {
      return { ...entry, path };
    }

    if (path === firstSegment) {
      return { ...entry, path: "" };
    }

    if (path.startsWith(`${firstSegment}/`)) {
      return { ...entry, path: path.slice(firstSegment.length + 1) };
    }

    return { ...entry, path };
  });
}

export function safeOutputName(name) {
  const cleaned = name
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  if (/\.epub\.zip$/i.test(cleaned)) {
    return cleaned.replace(/\.zip$/i, "");
  }
  if (/\.epub$/i.test(cleaned)) {
    return cleaned;
  }
  if (/\.zip$/i.test(cleaned)) {
    return cleaned.replace(/\.zip$/i, ".epub");
  }
  return `${cleaned || "fixed-ebook"}.epub`;
}

export function inspectZipHeader(arrayBuffer) {
  if (arrayBuffer.byteLength < 30) {
    return { isZip: false };
  }

  const view = new DataView(arrayBuffer);
  if (view.getUint32(0, true) !== 0x04034b50) {
    return { isZip: false };
  }

  const compressionMethod = view.getUint16(8, true);
  const compressedSize = view.getUint32(18, true);
  const fileNameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);
  const firstNameBytes = new Uint8Array(arrayBuffer, 30, fileNameLength);
  const firstName = new TextDecoder("utf-8").decode(firstNameBytes);
  const dataStart = 30 + fileNameLength + extraLength;

  let mimeContent = "";
  if (
    compressionMethod === 0 &&
    dataStart + compressedSize <= arrayBuffer.byteLength
  ) {
    const data = new Uint8Array(arrayBuffer, dataStart, compressedSize);
    mimeContent = textDecoder.decode(data);
  }

  return {
    isZip: true,
    firstName,
    compressionMethod,
    mimeContent,
    valid:
      firstName === "mimetype" &&
      compressionMethod === 0 &&
      mimeContent === EPUB_MIME,
  };
}

export async function repairFolderEntries(entries, onProgress = () => {}) {
  const zip = createEpubZip();

  const filtered = stripCommonRoot(entries)
    .map((entry) => ({
      ...entry,
      path: safeZipPath(entry.path),
    }))
    .filter((entry) => entry.path && !isJunkPath(entry.path));

  let processed = 0;
  for (const entry of filtered) {
    if (entry.path === "mimetype") {
      continue;
    }
    const content =
      entry.bytes || (entry.file ? await entry.file.arrayBuffer() : null);
    if (!content) {
      throw new Error(MISSING_SOURCE_ERROR);
    }
    zip.file(entry.path, content, {
      binary: true,
      compression: "DEFLATE",
      date: getEntryDate(entry.file),
    });
    processed += 1;
    onProgress(getProgressPortion(processed, filtered.length));
  }

  return generateEpubBlob(zip, onProgress);
}

async function rebuildZipFile(arrayBuffer, onProgress = () => {}) {
  const inputZip = await JSZip.loadAsync(arrayBuffer, {
    checkCRC32: false,
    createFolders: true,
  });

  const zip = createEpubZip();

  const names = Object.keys(inputZip.files).sort((left, right) =>
    left.localeCompare(right),
  );
  const files = names
    .map((name) => ({ name, entry: inputZip.files[name] }))
    .filter(({ entry }) => entry && !entry.dir)
    .filter(({ name }) => !isJunkPath(name) && name !== "mimetype");

  const normalizedFiles = stripCommonRoot(
    files.map(({ name, entry }) => ({ path: name, file: entry })),
  ).filter(({ path }) => path);

  let processed = 0;
  for (const { path, file } of normalizedFiles) {
    const content = await file.async("arraybuffer");
    zip.file(path, content, {
      binary: true,
      compression: "DEFLATE",
      date: getEntryDate(file),
    });
    processed += 1;
    onProgress(getProgressPortion(processed, normalizedFiles.length));
  }

  return generateEpubBlob(zip, onProgress);
}

export async function repairEpub(
  { kind, name, file, bytes, entries },
  onProgress = () => {},
) {
  if (kind === "folder") {
    const outputBlob = await repairFolderEntries(entries, onProgress);
    return {
      name: safeOutputName(name),
      blob: outputBlob,
      status: "ready",
      note: "Repacked folder into a proper EPUB archive.",
    };
  }

  const arrayBuffer = bytes || (file ? await file.arrayBuffer() : null);
  if (!arrayBuffer) {
    throw new Error(MISSING_SOURCE_ERROR);
  }
  const header = inspectZipHeader(arrayBuffer);
  if (header.valid) {
    return {
      name: safeOutputName(name),
      blob: new Blob([arrayBuffer], { type: EPUB_MIME }),
      status: "ready",
      note: "Already a valid EPUB archive, copied without changes.",
    };
  }

  const outputBlob = await rebuildZipFile(arrayBuffer, onProgress);
  return {
    name: safeOutputName(name),
    blob: outputBlob,
    status: "ready",
    note: "Repacked broken EPUB archive.",
  };
}

export async function buildBulkZip(items, onProgress = () => {}) {
  const zip = new JSZip();
  const readyItems = items.filter((item) => item.blob);

  let processed = 0;
  for (const item of readyItems) {
    zip.file(item.name, item.blob, { binary: true, date: new Date() });
    processed += 1;
    onProgress((processed / Math.max(readyItems.length, 1)) * 0.9);
  }

  onProgress(0.95);
  const blob = await zip.generateAsync(
    {
      type: "blob",
      compression: "DEFLATE",
      streamFiles: true,
    },
    (metadata) => {
      onProgress(0.95 + metadata.percent * 0.0005);
    },
  );
  onProgress(1);
  return blob;
}
