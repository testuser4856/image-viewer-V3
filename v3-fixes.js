// image-viewer V3.1 fixes
// 1) iOS file picker must be opened synchronously from the user's tap.
// 2) fitHeight really uses the available screen height and allows horizontal scrolling.

function requestArchive(mode, bookId = null) {
  pendingPicker = { mode, bookId };
  const picker = $("#archivePicker");
  if (!picker) return;

  picker.value = "";

  // Keep this click synchronous. Do not await IndexedDB before this point on iOS.
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
    stage.scrollLeft = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2);
  });
}

function applyFit() {
  const img = $("#readerImg");
  const stage = $("#readerStage");
  if (!img || !stage) return;

  const margin = `${Number(current.margin) || 0}px`;

  // Reset everything first.
  img.style.maxWidth = "100%";
  img.style.maxHeight = "100%";
  img.style.width = "auto";
  img.style.height = "auto";
  img.style.objectFit = "contain";
  img.style.objectPosition = "center center";
  img.style.flex = "0 0 auto";

  stage.style.padding = margin;
  stage.style.overflowX = "hidden";
  stage.style.overflowY = "hidden";
  stage.style.justifyContent = "center";
  stage.style.alignItems = "center";
  stage.style.webkitOverflowScrolling = "auto";

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
    return;
  }

  if (current.fit === "fitHeight") {
    // The stage itself covers the full viewport because of position:fixed; inset:0.
    // Reserve iPhone's status-bar/notch and home-indicator areas explicitly.
    const safeTop = "env(safe-area-inset-top)";
    const safeBottom = "env(safe-area-inset-bottom)";

    stage.style.padding = `${safeTop} 0 ${safeBottom} 0`;
    stage.style.overflowX = "auto";
    stage.style.overflowY = "hidden";
    stage.style.justifyContent = "flex-start";
    stage.style.alignItems = "center";
    stage.style.webkitOverflowScrolling = "touch";

    img.style.maxWidth = "none";
    img.style.maxHeight = "none";
    img.style.width = "auto";
    img.style.height = `calc(100dvh - ${safeTop} - ${safeBottom})`;
    img.style.objectFit = "contain";

    centerHeightFit();
    return;
  }

  // contain
  img.style.width = "auto";
  img.style.height = "auto";
}

$("#readerImg")?.addEventListener("load", centerHeightFit);
window.addEventListener("resize", () => {
  if (current.fit === "fitHeight") {
    applyFit();
  }
});
