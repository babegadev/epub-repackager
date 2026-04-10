import "./styles.css";
import { buildBulkZip, repairEpub, safeOutputName } from "./epub.js";

const GITHUB_URL = "https://github.com/babegadev/epub-repackager";

const app = document.querySelector("#app");

app.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">EPUB Fixer Repackager</p>
        <h1>EPUB Fixer Repackager</h1>
      </div>
      <div class="lede">
        <p class="lede-intro">
          If Calibre detects your EPUB as a folder, Kindle rejects it, or cover and author metadata disappear, EPUB Fixer Repackager is built for that exact problem.
        </p>
        <ul class="lede-list" aria-label="EPUB problems and solution summary">
          <li>Fixes Apple Books exploded EPUB folders and broken .epub.zip packaging that cause invalid EPUB import errors.</li>
          <li>Rebuilds EPUB ZIP container structure and mimetype placement so EPUB files import correctly in Calibre.</li>
          <li>Produces a clean repaired .epub for Kindle and other EPUB readers while preserving metadata and cover data.</li>
        </ul>
      </div>
    </header>

    <section class="dropzone" id="dropzone" tabindex="0" role="button" aria-label="Drop EPUB files here or click to upload">
      <input id="file-input" type="file" accept=".epub,.zip" multiple hidden />
      <div class="dropzone-copy">
        <div class="upload-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 16V5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M8.5 8.5L12 5L15.5 8.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M5 15.5V17.5C5 18.6046 5.89543 19.5 7 19.5H17C18.1046 19.5 19 18.6046 19 17.5V15.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <p class="dropzone-title">Click to upload EPUB files</p>
        <p class="dropzone-text">Drag-and-drop is disabled. Only files or folder roots ending in .epub or .epub.zip are allowed.</p>
      </div>
    </section>

    <section class="toolbar">
      <div class="toolbar-left">
        <button class="button button-secondary" id="process-all" disabled>Fix all</button>
        <button class="button button-secondary" id="download-bulk" disabled>Download zip</button>
      </div>
      <button class="button button-link" id="clear-all" disabled>Clear</button>
    </section>

    <section class="list-section">
      <div class="list-header">
        <p>Queue</p>
        <div class="summary-meta" id="summary"></div>
      </div>
      <div class="job-list" id="job-list"></div>
      <div class="empty-state" id="empty-state">
        Add EPUBs above. Each file is repaired locally, then you can download it individually or as a bulk zip.
      </div>

      <div class="bottom-actions">
        <button class="button button-secondary" id="download-bulk-bottom" disabled>Download zip</button>
      </div>
    </section>

    <footer class="page-meta">
      <p>All data is processed locally in your browser. Nothing is uploaded.</p>
      <a class="github-link" href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer">
        <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.009-.866-.014-1.699-2.782.605-3.369-1.345-3.369-1.345-.455-1.158-1.11-1.466-1.11-1.466-.908-.621.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.091-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.254-.446-1.272.098-2.651 0 0 .84-.269 2.75 1.027A9.564 9.564 0 0 1 12 6.844a9.56 9.56 0 0 1 2.504.337c1.909-1.296 2.748-1.027 2.748-1.027.546 1.379.203 2.397.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.744 0 .268.18.579.688.481A10.02 10.02 0 0 0 22 12.017C22 6.484 17.523 2 12 2z"/>
        </svg>
        <span>View Source Code</span>
      </a>
    </footer>
  </main>
`;

const state = {
  jobs: [],
  nextId: 1,
  processing: false,
  bulkZipBlob: null,
  bulkZipName: "fixed-epubs.zip",
};

const els = {
  summary: document.querySelector("#summary"),
  jobList: document.querySelector("#job-list"),
  emptyState: document.querySelector("#empty-state"),
  dropzone: document.querySelector("#dropzone"),
  fileInput: document.querySelector("#file-input"),
  processAll: document.querySelector("#process-all"),
  downloadBulk: document.querySelector("#download-bulk"),
  downloadBulkBottom: document.querySelector("#download-bulk-bottom"),
  clearAll: document.querySelector("#clear-all"),
};

function getReadyJobs() {
  return state.jobs.filter((job) => job.status === "ready");
}

function setBulkButtonsDisabled(disabled) {
  els.downloadBulk.disabled = disabled;
  els.downloadBulkBottom.disabled = disabled;
}

function setBulkButtonsText(top, bottom = top) {
  els.downloadBulk.textContent = top;
  els.downloadBulkBottom.textContent = bottom;
}

function isEpubName(name) {
  return /\.epub(\.zip)?$/i.test((name || "").trim());
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function outputFileName(name) {
  return safeOutputName(name);
}

let descriptorId = 1;

function createDescriptor(
  file,
  path = file.name,
  fromFolder = false,
  groupKey = null,
  bytes = null,
) {
  const normalizedPath = path
    .replace(/^\.\//, "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  const inferredGroupKey =
    groupKey ||
    (fromFolder || normalizedPath.includes("/")
      ? normalizedPath.split("/")[0]
      : `file-${descriptorId++}`);

  return {
    file,
    path: normalizedPath,
    fromFolder,
    groupKey: inferredGroupKey,
    bytes,
  };
}

function updateSummary() {
  const total = state.jobs.length;
  const ready = getReadyJobs().length;
  const failed = state.jobs.filter(
    (job) => job.status === "error" || job.status === "rejected",
  ).length;
  const processing = state.jobs.filter(
    (job) => job.status === "processing",
  ).length;
  const queued = state.jobs.filter((job) => job.status === "queued").length;

  els.summary.innerHTML = `
    <div class="summary-card"><strong>${total}</strong><span>items queued</span></div>
    <div class="summary-card"><strong>${ready}</strong><span>ready to download</span></div>
    <div class="summary-card"><strong>${processing}</strong><span>processing</span></div>
    <div class="summary-card"><strong>${failed}</strong><span>failed</span></div>
    <div class="summary-card"><strong>${queued}</strong><span>waiting</span></div>
  `;

  setBulkButtonsDisabled(ready === 0);
  els.processAll.disabled = total === 0 || state.processing;
  els.clearAll.disabled = total === 0;
  els.emptyState.style.display = total === 0 ? "grid" : "none";
}

function renderJobs() {
  if (state.jobs.length === 0) {
    els.jobList.innerHTML = "";
    updateSummary();
    return;
  }

  els.jobList.innerHTML = state.jobs
    .map((job) => {
      const statusClass = `status-${job.status}`;
      const percent = Math.max(
        0,
        Math.min(100, Math.round((job.progress || 0) * 100)),
      );
      const metaBits = [
        job.kind === "folder" ? "folder upload" : "file upload",
        job.sourceSize ? formatBytes(job.sourceSize) : null,
        job.note || null,
      ].filter(Boolean);

      return `
        <article class="job-card ${statusClass}">
          <div class="job-main">
            <div>
              <div class="job-title">${escapeHtml(job.name)}</div>
              <div class="job-meta">${metaBits.map(escapeHtml).join(" · ")}</div>
            </div>
            <div class="job-status">${escapeHtml(job.statusLabel)}</div>
          </div>
          <div class="progress-track" aria-hidden="true">
            <span style="width: ${percent}%"></span>
          </div>
          <div class="job-footer">
            <span>${escapeHtml(job.outputName || outputFileName(job.name))}</span>
            <div class="job-actions">
              <button class="button button-small button-secondary" data-action="retry" data-id="${job.id}">Retry</button>
              <button class="button button-small button-primary" data-action="download" data-id="${job.id}" ${job.status !== "ready" ? "disabled" : ""}>Download</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  updateSummary();
}

function addJob(job) {
  state.jobs.push({
    id: state.nextId++,
    progress: 0,
    status: "queued",
    statusLabel: "Queued",
    note: "",
    outputBlob: null,
    outputName: null,
    sourceSize: 0,
    ...job,
  });
  renderJobs();
}

function groupDescriptors(items) {
  const grouped = new Map();

  for (const item of items) {
    const key = item.groupKey;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push({
      file: item.file,
      path: item.path || item.file.name,
      fromFolder: item.fromFolder,
    });
  }

  return grouped;
}

function descriptorsFromFiles(files) {
  return Promise.all(
    files.map(async (file) =>
      createDescriptor(
        file,
        file.webkitRelativePath || file.name,
        Boolean(file.webkitRelativePath),
        null,
        await file.arrayBuffer(),
      ),
    ),
  );
}

async function processJob(job) {
  if (job.status === "processing") {
    return;
  }

  job.status = "processing";
  job.statusLabel = "Processing";
  job.progress = 0.02;
  job.note = "Reading source files";
  renderJobs();

  try {
    const result = await repairEpub(job, (progress) => {
      job.progress = progress;
      renderJobs();
    });

    job.outputBlob = result.blob;
    job.outputName = result.name;
    job.note = result.note;
    job.status = "ready";
    job.statusLabel = "Ready";
    job.progress = 1;
  } catch (error) {
    job.outputBlob = null;
    job.outputName = null;
    job.status = "error";
    job.statusLabel = "Failed";
    job.note = error?.message || "Unable to repair this EPUB.";
    job.progress = 1;
  }

  renderJobs();
}

async function processQueue() {
  if (state.processing) return;

  state.processing = true;
  renderJobs();

  const pending = state.jobs.filter(
    (job) => job.status === "queued" || job.status === "error",
  );
  for (const job of pending) {
    await processJob(job);
  }

  state.processing = false;
  state.bulkZipBlob = null;
  setBulkButtonsDisabled(getReadyJobs().length === 0);
  renderJobs();
}

function createRejectedJob(displayName, entries) {
  return {
    name: displayName,
    kind: "file",
    entries: [],
    file: null,
    sourceSize: entries.reduce((total, entry) => total + entry.file.size, 0),
    status: "rejected",
    statusLabel: "Rejected",
    note: "Only files or folder roots ending in .epub or .epub.zip are allowed.",
    progress: 1,
  };
}

function createQueuedJob(displayName, entries) {
  const kind = entries.some(
    (entry) => entry.fromFolder || entry.path.includes("/"),
  )
    ? "folder"
    : "file";
  const sourceSize = entries.reduce(
    (total, entry) => total + entry.file.size,
    0,
  );

  return {
    name: displayName,
    kind,
    entries,
    file: entries[0]?.file || null,
    sourceSize,
  };
}

async function handleFileList(items) {
  const normalizedItems = items.map((item) =>
    item.file
      ? item
      : createDescriptor(
          item,
          item.webkitRelativePath || item.name,
          Boolean(item.webkitRelativePath),
        ),
  );

  const grouped = groupDescriptors(normalizedItems);

  for (const [name, entries] of grouped.entries()) {
    const displayName = entries.some((entry) => entry.fromFolder)
      ? name
      : entries[0]?.path || name;

    if (!isEpubName(displayName)) {
      addJob(createRejectedJob(displayName, entries));
      continue;
    }

    addJob(createQueuedJob(displayName, entries));
  }

  await processQueue();
}

async function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadBulkZip() {
  const readyItems = getReadyJobs()
    .filter((job) => job.outputBlob)
    .map((job) => ({
      name: job.outputName || outputFileName(job.name),
      blob: job.outputBlob,
    }));

  if (readyItems.length === 0) {
    return;
  }

  if (!state.bulkZipBlob) {
    setBulkButtonsDisabled(true);
    setBulkButtonsText("Building zip...");
    try {
      state.bulkZipBlob = await buildBulkZip(readyItems, (progress) => {
        const label = `Building zip... ${Math.round(progress * 100)}%`;
        setBulkButtonsText(label);
      });
    } finally {
      setBulkButtonsText("Download bulk zip", "Download zip");
      setBulkButtonsDisabled(false);
    }
  }

  await downloadBlob(state.bulkZipBlob, state.bulkZipName);
}

async function handleDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  els.dropzone.classList.remove("is-dragging");
}

function openFilePicker() {
  els.fileInput.click();
}

function handleDropzoneKeyDown(event) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openFilePicker();
  }
}

function queueFullRepair() {
  void processQueue();
}

function queueBulkDownload() {
  void downloadBulkZip();
}

els.dropzone.addEventListener("click", openFilePicker);
els.dropzone.addEventListener("keydown", handleDropzoneKeyDown);
els.processAll.addEventListener("click", queueFullRepair);
els.downloadBulk.addEventListener("click", queueBulkDownload);
els.downloadBulkBottom.addEventListener("click", queueBulkDownload);
els.clearAll.addEventListener("click", () => {
  state.jobs = [];
  state.bulkZipBlob = null;
  renderJobs();
});

els.fileInput.addEventListener("change", async (event) => {
  const { files } = event.target;
  if (files && files.length > 0) {
    await handleFileList(await descriptorsFromFiles(Array.from(files)));
  }
  event.target.value = "";
});

els.jobList.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const action = target.dataset.action;
  const id = Number(target.dataset.id);
  const job = state.jobs.find((item) => item.id === id);
  if (!job) {
    return;
  }

  if (action === "download" && job.outputBlob) {
    await downloadBlob(
      job.outputBlob,
      job.outputName || outputFileName(job.name),
    );
  }

  if (action === "retry") {
    job.status = "queued";
    job.statusLabel = "Queued";
    job.progress = 0;
    job.note = "Requeued for repair";
    renderJobs();
    void processQueue();
  }
});

els.dropzone.addEventListener("dragenter", (event) => {
  event.preventDefault();
});
els.dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
});
els.dropzone.addEventListener("dragleave", (event) => {
  event.preventDefault();
});
els.dropzone.addEventListener("drop", handleDrop);

renderJobs();
