const $ = (s) => document.querySelector(s);

const DB_NAME = "viewerDBV3";
const DB_VER = 1;
const IMAGE_RE = /\.(jpe?g|png|webp|gif|avif)$/i;
const CACHE_RADIUS = 2;

let db;
let pendingPicker = { mode: null, bookId: null };
let hudTimer = null;
let renderToken = 0;
let lastObjectURL = null;

const sessionBooks = new Map();
const pageBlobCache = new Map();

let current = {
  bookId: null,
  book: null,
  entries: [],
  index: 0,
  fit: "fitWidth",
  margin: 8,
  viewMode: "normal",
};

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);

    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("books")) {
        d.createObjectStore("books", { keyPath: "id" });
      }
      if (!d.objectStoreNames.contains("bookmarks")) {
        const b = d.createObjectStore("bookmarks", { keyPath: "id" });
        b.createIndex("byBook", "bookId");
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function store(name, mode = "readonly") {
  return db.transaction(name, mode).objectStore(name);
}

function put(name, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, "readwrite");
    tx.objectStore(name).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function del(name, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, "readwrite");
    tx.objectStore(name).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function get(name, key) {
  return new Promise((resolve, reject) => {
    const req = store(name).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAll(name) {
  return new Promise((resolve, reject) => {
    const req = store(name).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAllByIndex(name, indexName, key) {
  return new Promise((resolve, reject) => {
    const req = store(name).index(indexName).getAll(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function fmtDate(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${dd} ${hh}:${mm}`;
}

function setBusy(message = "処理中...") {
  $("#busyText").textContent = message;
  $("#busyOverlay").classList.remove("hidden");
}

function clearBusy() {
  $("#busyOverlay").classList.add("hidden");
}

function showLibrary() {
  $("#readerView")?.classList.add("hidden");
  $("#libraryView")?.classList.remove("hidden");
  $("#readerHud")?.classList.add("hidden");
}

function showReader() {
  $("#libraryView")?.classList.add("hidden");
  $("#readerView")?.classList.remove("hidden");
  $("#readerHud")?.classList.remove("hidden");
}

function showHudTemporarily() {
  const hud = $("#readerHud");
  if (!hud) return;
  hud.classList.remove("hidden");
  if (hudTimer) clearTimeout(hudTimer);
  hudTimer = setTimeout(() => hud.classList.add("hidden"), 2500);
}

function toggleHud() {
  const hud = $("#readerHud");
  if (!hud) return;
  if (hud.classList.contains("hidden")) showHudTemporarily();
  else hud.classList.add("hidden");
}

function applyFit() {
  const img = $("#readerImg");
  const stage = $("#readerStage");
  if (!img || !stage) return;

  const margin = `${Number(current.margin) || 0}px`;

  img.style.maxWidth = "100%";
  img.style.maxHeight = "100%";
  img.style.width = "auto";
  img.style.height = "auto";
  img.style.objectFit = "contain";
  img.style.objectPosition = "center center";
  stage.style.overflow = "hidden";

  if (current.viewMode === "full") {
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "contain";
    stage.style.padding = "0px";
    return;
  }

  if (current.viewMode === "split-left") {
    img.style.width = "200%";
    img.style.height = "100%";
    img.style.objectFit = "cover";
    img.style.objectPosition = "left center";
    stage.style.padding = "0px";
    return;
  }

  if (current.viewMode === "split-right") {
    img.style.width = "200%";
    img.style.height = "100%";
    img.style.objectFit = "cover";
    img.style.objectPosition = "right center";
    stage.style.padding = "0px";
    return;
  }

  if (current.fit === "fitWidth") {
    img.style.width = "100%";
    img.style.height = "auto";
  } else if (current.fit === "fitHeight") {
    img.style.width = "auto";
    img.style.height = "100%";
  }

  stage.style.padding = margin;
}

function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function mimeFromName(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".avif")) return "image/avif";
  return "image/jpeg";
}

async function readArchive(file) {
  if (!window.zip) throw new Error("zip.js を読み込めませんでした。通信状態を確認して一度再読み込みしてください。");

  const reader = new zip.ZipReader(new zip.BlobReader(file));
  let allEntries;
  try {
    allEntries = await reader.getEntries();
  } finally {
    await reader.close().catch(() => {});
  }

  const entries = allEntries
    .filter((e) => !e.directory && IMAGE_RE.test(e.filename))
    .sort((a, b) => naturalCompare(a.filename, b.filename));

  if (!entries.length) throw new Error("CBZ/ZIP内に画像が見つかりませんでした。");
  return entries;
}

function clearPageCache() {
  pageBlobCache.clear();
}

async function getPageBlob(index) {
  if (pageBlobCache.has(index)) return pageBlobCache.get(index);
  const entry = current.entries[index];
  if (!entry) return null;

  const blob = await entry.getData(new zip.BlobWriter(mimeFromName(entry.filename)));
  pageBlobCache.set(index, blob);
  return blob;
}

function trimPageCache(centerIndex) {
  for (const index of [...pageBlobCache.keys()]) {
    if (Math.abs(index - centerIndex) > CACHE_RADIUS) pageBlobCache.delete(index);
  }
}

function prefetchAround(index) {
  const candidates = [index + 1, index - 1, index + 2];
  for (const i of candidates) {
    if (i < 0 || i >= current.entries.length || pageBlobCache.has(i)) continue;
    getPageBlob(i).catch(() => {});
  }
}

async function saveProgress() {
  if (!current.book) return;
  current.book.lastIndex = current.index;
  current.book.updatedAt = Date.now();
  await put("books", current.book);
}

async function renderPage() {
  const img = $("#readerImg");
  if (!img || !current.entries.length) return;

  const token = ++renderToken;
  const index = current.index;
  const entry = current.entries[index];
  if (!entry) return;

  $("#pageInfo").textContent = `${index + 1}/${current.entries.length}`;
  const range = $("#rangePage");
  range.max = String(current.entries.length);
  range.value = String(index + 1);
  applyFit();

  try {
    const blob = await getPageBlob(index);
    if (token !== renderToken || index !== current.index || !blob) return;

    if (lastObjectURL) URL.revokeObjectURL(lastObjectURL);
    lastObjectURL = URL.createObjectURL(blob);
    img.src = lastObjectURL;

    trimPageCache(index);
    prefetchAround(index);
    saveProgress().catch(() => {});
    showHudTemporarily();
  } catch (e) {
    console.error(e);
    alert(`ページを開けませんでした。\n${e?.message || e}`);
  }
}

function nextPage() {
  if (current.index < current.entries.length - 1) {
    current.index += 1;
    renderPage();
  }
}

function prevPage() {
  if (current.index > 0) {
    current.index -= 1;
    renderPage();
  }
}

function sortBooks(books) {
  const mode = $("#selSort")?.value ?? "updatedDesc";
  if (mode === "titleAsc") {
    books.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  } else {
    books.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }
  return books;
}

async function renderLibrary() {
  const grid = $("#libraryGrid");
  if (!grid) return;

  let books = sortBooks(await getAll("books"));
  grid.innerHTML = "";

  if (!books.length) {
    const empty = document.createElement("div");
    empty.className = "card";
    empty.textContent = "CBZ追加から本を登録してください。画像本体は保存しません。";
    grid.appendChild(empty);
    return;
  }

  for (const b of books) {
    const card = document.createElement("div");
    card.className = "card";

    const title = document.createElement("div");
    title.className = "cardTitle";
    title.textContent = b.title || "(no title)";

    const meta = document.createElement("div");
    meta.className = "cardMeta";
    const resume = Number.isInteger(b.lastIndex) ? `${b.lastIndex + 1}p` : "1p";
    meta.innerHTML = `<span>${b.pageCount ?? "?"} pages</span><span>続き: ${resume}</span><span>更新: ${fmtDate(b.updatedAt)}</span>`;

    const actions = document.createElement("div");
    actions.className = "cardActions";

    const btnOpen = document.createElement("button");
    btnOpen.className = "btn";
    btnOpen.textContent = sessionBooks.has(b.id) ? "開く" : "CBZ選択";
    btnOpen.onclick = () => openRegisteredBook(b.id);

    const btnRename = document.createElement("button");
    btnRename.className = "btn";
    btnRename.textContent = "名前";
    btnRename.onclick = async () => {
      const v = prompt("新しいタイトル", b.title || "");
      if (v == null) return;
      b.title = v.trim() || b.title;
      await put("books", b);
      await renderLibrary();
    };

    const btnDelete = document.createElement("button");
    btnDelete.className = "btn";
    btnDelete.textContent = "削除";
    btnDelete.onclick = async () => {
      if (!confirm(`「${b.title}」を本棚から削除しますか？\n元のCBZファイルは削除されません。`)) return;
      await deleteBookAll(b.id);
      await renderLibrary();
    };

    actions.append(btnOpen, btnRename, btnDelete);
    card.append(title, meta, actions);
    grid.appendChild(card);
  }
}

async function deleteBookAll(bookId) {
  const bms = await getAllByIndex("bookmarks", "byBook", bookId);
  for (const bm of bms) await del("bookmarks", bm.id);
  await del("books", bookId);
  sessionBooks.delete(bookId);
  if (current.bookId === bookId) resetReaderSession();
}

function requestArchive(mode, bookId = null) {
  pendingPicker = { mode, bookId };
  const picker = $("#archivePicker");
  picker.value = "";
  picker.click();
}

async function registerArchive(file) {
  setBusy("CBZの目次を読んでいます...");
  try {
    const entries = await readArchive(file);
    const titleDefault = file.name.replace(/\.(cbz|zip)$/i, "");
    const title = prompt("本のタイトル", titleDefault) || titleDefault;
    const id = crypto.randomUUID();
    const now = Date.now();

    const book = {
      id,
      title,
      archiveName: file.name,
      archiveSize: file.size,
      archiveLastModified: file.lastModified || 0,
      pageCount: entries.length,
      firstEntry: entries[0].filename,
      lastEntry: entries[entries.length - 1].filename,
      lastIndex: 0,
      createdAt: now,
      updatedAt: now,
    };

    await put("books", book);
    sessionBooks.set(id, { file, entries });
    await openWithSession(book, entries);
  } finally {
    clearBusy();
  }
}

async function attachArchiveToBook(bookId, file) {
  const book = await get("books", bookId);
  if (!book) return;

  setBusy("CBZを確認しています...");
  try {
    const entries = await readArchive(file);
    const first = entries[0]?.filename || "";
    const last = entries[entries.length - 1]?.filename || "";

    const likelySame =
      file.name === book.archiveName ||
      (entries.length === book.pageCount && first === book.firstEntry && last === book.lastEntry);

    if (!likelySame) {
      const ok = confirm(
        `登録時と違うCBZの可能性があります。\n\n登録: ${book.archiveName} (${book.pageCount}p)\n選択: ${file.name} (${entries.length}p)\n\nこのファイルで開きますか？`
      );
      if (!ok) return;
    }

    book.archiveName = file.name;
    book.archiveSize = file.size;
    book.archiveLastModified = file.lastModified || 0;
    book.pageCount = entries.length;
    book.firstEntry = first;
    book.lastEntry = last;
    book.lastIndex = Math.min(Math.max(book.lastIndex ?? 0, 0), entries.length - 1);
    await put("books", book);

    sessionBooks.set(bookId, { file, entries });
    await openWithSession(book, entries);
  } finally {
    clearBusy();
  }
}

async function openRegisteredBook(bookId) {
  const book = await get("books", bookId);
  if (!book) return;

  const session = sessionBooks.get(bookId);
  if (session) {
    await openWithSession(book, session.entries);
    return;
  }

  requestArchive("open", bookId);
}

async function openWithSession(book, entries) {
  current.bookId = book.id;
  current.book = book;
  current.entries = entries;
  current.index = Math.min(Math.max(book.lastIndex ?? 0, 0), entries.length - 1);
  current.viewMode = "normal";
  current.fit = $("#selFit")?.value || "fitWidth";
  current.margin = Number($("#rangeMargin")?.value ?? 8);

  const selViewMode = $("#selViewMode");
  if (selViewMode) selViewMode.value = "normal";

  clearPageCache();
  showReader();
  await renderPage();
}

function resetReaderSession() {
  renderToken += 1;
  clearPageCache();
  if (lastObjectURL) {
    URL.revokeObjectURL(lastObjectURL);
    lastObjectURL = null;
  }
  $("#readerImg").removeAttribute("src");
  current.bookId = null;
  current.book = null;
  current.entries = [];
  current.index = 0;
}

async function addBookmark() {
  if (!current.bookId) return;
  const note = prompt("しおりメモ（任意）", "") ?? "";
  await put("bookmarks", {
    id: crypto.randomUUID(),
    bookId: current.bookId,
    index: current.index,
    note,
    createdAt: Date.now(),
  });
}

async function renderBookmarksList() {
  const list = $("#bmList");
  list.innerHTML = "";

  const bms = await getAllByIndex("bookmarks", "byBook", current.bookId);
  bms.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  if (!bms.length) {
    const empty = document.createElement("div");
    empty.style.padding = "8px";
    empty.textContent = "しおりがありません";
    list.appendChild(empty);
    return;
  }

  for (const bm of bms) {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.justifyContent = "space-between";
    row.style.alignItems = "center";
    row.style.gap = "10px";
    row.style.padding = "8px";
    row.style.borderBottom = "1px solid rgba(255,255,255,0.1)";

    const left = document.createElement("div");
    left.style.cursor = "pointer";
    left.style.flex = "1";
    left.innerHTML = `<div><strong>${bm.index + 1}p</strong> <span style="color:var(--muted);font-size:12px">${fmtDate(bm.createdAt)}</span></div><div style="color:var(--muted);font-size:12px">${bm.note || "（メモなし）"}</div>`;
    left.onclick = () => {
      current.index = Math.min(Math.max(bm.index, 0), current.entries.length - 1);
      renderPage();
      closeBookmarksModal();
    };

    const btnDel = document.createElement("button");
    btnDel.className = "btn";
    btnDel.textContent = "削除";
    btnDel.onclick = async () => {
      await del("bookmarks", bm.id);
      await renderBookmarksList();
    };

    row.append(left, btnDel);
    list.appendChild(row);
  }
}

async function openBookmarksModal() {
  if (!current.bookId) return;
  document.body.classList.add("modal-open");
  await renderBookmarksList();
  $("#bmModal").classList.remove("hidden");
}

function closeBookmarksModal() {
  $("#bmModal").classList.add("hidden");
  document.body.classList.remove("modal-open");
}

async function backupToJsonDownload() {
  const dump = {
    version: 2,
    exportedAt: Date.now(),
    books: await getAll("books"),
    bookmarks: await getAll("bookmarks"),
  };

  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `image-viewer-v3-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function restoreFromJson(file) {
  const text = await file.text();
  const dump = JSON.parse(text);
  if (!dump || !Array.isArray(dump.books)) throw new Error("V2バックアップとして読み込めません。");

  if (!confirm("本棚・しおり情報を復元しますか？\nCBZ画像本体はバックアップに含まれません。")) return;

  const oldBooks = await getAll("books");
  for (const b of oldBooks) await del("books", b.id);
  const oldBms = await getAll("bookmarks");
  for (const bm of oldBms) await del("bookmarks", bm.id);

  for (const b of dump.books) await put("books", b);
  for (const bm of dump.bookmarks || []) await put("bookmarks", bm);
  sessionBooks.clear();
  await renderLibrary();
}

function wireEvents() {
  $("#btnImport")?.addEventListener("click", () => requestArchive("register"));

  $("#archivePicker")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      if (pendingPicker.mode === "open" && pendingPicker.bookId) {
        await attachArchiveToBook(pendingPicker.bookId, file);
      } else {
        await registerArchive(file);
      }
    } catch (err) {
      console.error(err);
      alert(`CBZを開けませんでした。\n${err?.message || err}`);
    } finally {
      pendingPicker = { mode: null, bookId: null };
      e.target.value = "";
    }
  });

  $("#btnBack")?.addEventListener("click", async () => {
    await saveProgress().catch(() => {});
    showLibrary();
    await renderLibrary();
  });

  $("#btnBookmarkAdd")?.addEventListener("click", addBookmark);
  $("#btnBookmarks")?.addEventListener("click", openBookmarksModal);
  $("#btnBmClose")?.addEventListener("click", closeBookmarksModal);

  $("#selSort")?.addEventListener("change", renderLibrary);

  $("#readerStage")?.addEventListener("click", (e) => {
    const w = window.innerWidth;

    if (current.viewMode === "split-left" || current.viewMode === "split-right") {
      current.viewMode = current.viewMode === "split-left" ? "split-right" : "split-left";
      const sel = $("#selViewMode");
      if (sel) sel.value = current.viewMode;
      applyFit();
      return;
    }

    if (e.clientX < w * 0.3) prevPage();
    else if (e.clientX > w * 0.7) nextPage();
    else toggleHud();
  });

  $("#rangePage")?.addEventListener("input", (e) => {
    const next = Number(e.target.value) - 1;
    $("#pageInfo").textContent = `${next + 1}/${current.entries.length}`;
  });

  $("#rangePage")?.addEventListener("change", (e) => {
    current.index = Number(e.target.value) - 1;
    renderPage();
  });

  $("#selFit")?.addEventListener("change", (e) => {
    current.fit = e.target.value;
    applyFit();
  });

  $("#rangeMargin")?.addEventListener("input", (e) => {
    current.margin = Number(e.target.value);
    applyFit();
  });

  $("#selViewMode")?.addEventListener("change", (e) => {
    current.viewMode = e.target.value;
    applyFit();
  });

  $("#btnBackup")?.addEventListener("click", backupToJsonDownload);
  $("#btnRestore")?.addEventListener("click", () => {
    const picker = $("#restorePicker");
    picker.value = "";
    picker.click();
  });

  $("#restorePicker")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await restoreFromJson(file);
    } catch (err) {
      console.error(err);
      alert(`復元に失敗しました。\n${err?.message || err}`);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") nextPage();
    if (e.key === "ArrowLeft") prevPage();
  });
}

(async () => {
  try {
    db = await openDB();
    wireEvents();
    await renderLibrary();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("SW register failed", e));
    }
  } catch (e) {
    console.error(e);
    alert(`起動に失敗しました。\n${e?.message || e}`);
  }
})();
