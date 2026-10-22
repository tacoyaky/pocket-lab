const status = document.querySelector("#availability");
const statusLabel = document.querySelector("#status-label");
const support = document.querySelector("#support");
const updatedAt = document.querySelector("#updated-at");
const tagCount = document.querySelector("#tag-count");
const retry = document.querySelector("#retry");
const popup = document.querySelector(".popup");

let manualRefresh = false;
let backgroundRefreshing = false;
let refreshStateRevision = 0;
let renderRevision = 0;

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.tagData) void render();
});
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "TAG_DATA_REFRESH_STATE") return;
  refreshStateRevision += 1;
  backgroundRefreshing = Boolean(message.refreshing);
  void render();
});

void render();

retry.addEventListener("click", async () => {
  manualRefresh = true;
  retry.disabled = true;
  retry.textContent = "取得中…";
  void render();
  let requestFailed = false;
  try {
    await chrome.runtime.sendMessage({ type: "REFRESH_TAG_DATA" });
  } catch {
    requestFailed = true;
  } finally {
    manualRefresh = false;
    await render();
    if (requestFailed) {
      support.textContent = "更新に失敗しました。しばらくしてから、もう一度お試しください。";
      support.hidden = false;
      status.className = "status warning";
      statusLabel.textContent = "更新に失敗しました";
    }
  }
});

async function render() {
  const currentRender = ++renderRevision;
  const stateRevision = refreshStateRevision;
  let response;
  try {
    response = await chrome.runtime.sendMessage({ type: "GET_TAG_DATA" });
  } catch {
    response = null;
  }
  const tagData = response?.tagData ?? (await chrome.storage.local.get("tagData")).tagData;
  if (currentRender !== renderRevision) return;
  if (stateRevision === refreshStateRevision && typeof response?.refreshing === "boolean") {
    backgroundRefreshing = response.refreshing;
  }

  const count = Array.isArray(tagData?.tags) ? tagData.tags.length : 0;
  const hasData = count > 0;
  const refreshing = manualRefresh || backgroundRefreshing;

  status.className = "status";
  support.hidden = true;
  popup.classList.toggle("unavailable", !hasData);

  if (refreshing) {
    status.classList.add("loading");
    statusLabel.textContent = hasData ? "タグ情報を更新中です" : "タグ情報を取得中です";
    support.textContent = hasData
      ? "前回取得したタグ情報でハイライトしています"
      : "初回のタグ情報を取得しています。";
    support.hidden = false;
  } else if (tagData?.status === "available" && hasData) {
    status.classList.add("success");
    statusLabel.textContent = "タグ情報は最新です";
  } else if (tagData?.status === "stale" && hasData) {
    status.classList.add("warning");
    statusLabel.textContent = "更新に失敗しました";
    support.textContent = "前回取得したタグ情報でハイライトしています";
    support.hidden = false;
  } else {
    status.classList.add("danger");
    statusLabel.textContent = "タグ情報を取得できません";
    support.textContent = "通信を確認して、もう一度お試しください。";
    support.hidden = false;
  }

  updatedAt.textContent = tagData?.updatedAt
    ? new Date(tagData.updatedAt).toLocaleString("ja-JP", {
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit"
      })
    : "未取得";
  tagCount.textContent = refreshing && !hasData ? "—" : String(count);
  retry.disabled = refreshing;
  retry.textContent = refreshing ? "取得中…" : hasData ? "タグ情報を更新" : "再試行";
}
