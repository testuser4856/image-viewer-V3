// image-viewer V4.5 fixes
// 1) iOS file picker must be opened synchronously from the user's tap.
// 2) fitHeight really uses the available screen height and allows horizontal scrolling.
// 3) split view supports V4 splitScale and splitSide.

function requestArchive(mode, bookId = null) {
  pendingPicker = { mode, bookId };
  const picker = $("#archivePicker");
  if (!picker) return;

  picker.value = "";

  // Keep this click synchronous.
  // Do not await IndexedDB before this point on iOS.
  picker.click();
}

async function openRegisteredBook(bookId) {
  const session = sessionBooks.get(bookId);

  if (session) {
    const book = await get("books", bookId);
    if (!book) return;
    await openWithSession(book, session.entries);
    return;
  }

  // Important for iPhone:
  // open the native file picker immediately inside the original tap event.
  requestArchive("open", bookId);
}

function centerHeightFit() {
  if (current.fit !== "fitHeight" || current.viewMode !== "normal") return;

  const stage = $("#readerStage");
  if (!stage) return;

  requestAnimationFrame(() => {
    stage.scrollLeft = Math.max(
      0,
      (stage.scrollWidth - stage.clientWidth) / 2
    );
  });
}

function applyFit() {
  const img = $("#readerImg");
  const stage = $("#readerStage");

  if (!img || !stage) return;

  const margin = `${Number(current.margin) || 0}px`;

  // =========================
  // RESET
  // =========================

  img.style.maxWidth = "100%";
  img.style.maxHeight = "100%";
  img.style.width = "auto";
  img.style.height = "auto";
  img.style.objectFit = "contain";
  img.style.objectPosition = "center center";
  img.style.flex = "0 0 auto";

  img.style.position = "";
  img.style.top = "";
  img.style.bottom = "";
  img.style.left = "";
  img.style.right = "";
  img.style.transform = "";
  img.style.transformOrigin = "";

  stage.style.padding = margin;
  stage.style.overflowX = "hidden";
  stage.style.overflowY = "hidden";
  stage.style.justifyContent = "center";
  stage.style.alignItems = "center";
  stage.style.webkitOverflowScrolling = "auto";

  // =========================
  // FULL
  // =========================

  if (current.viewMode === "full") {
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "contain";

    stage.style.padding = "0px";
    return;
  }

  // =========================
  // SPLIT VIEW
  // =========================

  if (
    current.viewMode === "split-left" ||
    current.viewMode === "split-right"
  ) {
    const scale = Math.min(
      100,
      Math.max(
        60,
        Number(current.splitScale) || DEFAULT_SPLIT_SCALE
      )
    );
const debug = $("#splitScaleValue");
if (debug) {
  debug.textContent =
    `D:${DEFAULT_SPLIT_SCALE} C:${current.splitScale} S:${scale}`;
}
    // 現在表示する側
    // app.js側でsplitSideがある場合はそちらを優先
    const side =
      current.splitSide ||
      (current.viewMode === "split-right"
        ? "right"
        : "left");

    // 実際の表示領域の高さを取得
    const stageHeight =
      stage.clientHeight ||
      window.innerHeight;

    // スライダー値から実ピクセルで画像高さを決定
    const imageHeight = Math.floor(
      stageHeight * scale / 100
    );

    img.style.maxWidth = "none";
    img.style.maxHeight = "none";

    img.style.width = "auto";
    img.style.height = `${imageHeight}px`;

    img.style.objectFit = "contain";

    // 上下中央
    img.style.position = "absolute";
    img.style.top = "50%";
    img.style.transform = "translateY(-50%)";

    // 左右どちらを表示するか
    if (side === "left") {
      img.style.left = "0";
      img.style.right = "auto";
      img.style.objectPosition = "left center";
    } else {
      img.style.left = "auto";
      img.style.right = "0";
      img.style.objectPosition = "right center";
    }

    stage.style.padding = "0px";
    stage.style.overflowX = "hidden";
    stage.style.overflowY = "hidden";

    return;
  }

  // =========================
  // FIT WIDTH
  // =========================

  if (current.fit === "fitWidth") {
    img.style.width = "100%";
    img.style.height = "auto";
    return;
  }

  // =========================
  // FIT HEIGHT
  // =========================

  if (current.fit === "fitHeight") {
    // The stage itself covers the full viewport.
    // Reserve iPhone's notch / status bar / home indicator.

    const safeTop = "env(safe-area-inset-top)";
    const safeBottom = "env(safe-area-inset-bottom)";

    stage.style.padding =
      `${safeTop} 0 ${safeBottom} 0`;

    stage.style.overflowX = "auto";
    stage.style.overflowY = "hidden";

    stage.style.justifyContent = "flex-start";
    stage.style.alignItems = "center";

    stage.style.webkitOverflowScrolling = "touch";

    img.style.maxWidth = "none";
    img.style.maxHeight = "none";

    img.style.width = "auto";

    img.style.height =
      `calc(100dvh - ${safeTop} - ${safeBottom})`;

    img.style.objectFit = "contain";

    centerHeightFit();
    return;
  }

  // =========================
  // CONTAIN
  // =========================

  img.style.width = "auto";
  img.style.height = "auto";
}


// 画像読み込み後
$("#readerImg")?.addEventListener(
  "load",
  () => {
    if (
      current.viewMode === "split-left" ||
      current.viewMode === "split-right"
    ) {
      applyFit();
    } else {
      centerHeightFit();
    }
  }
);


// 画面回転・リサイズ対応
window.addEventListener("resize", () => {
  if (
    current.fit === "fitHeight" ||
    current.viewMode === "split-left" ||
    current.viewMode === "split-right"
  ) {
    applyFit();
  }
});
