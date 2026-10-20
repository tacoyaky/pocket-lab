const status = document.querySelector("#availability");
const statusLabel = document.querySelector("#status-label");
const support = document.querySelector("#support");
const updatedAt = document.querySelector("#updated-at");
const tagCount = document.querySelector("#tag-count");
const retry = document.querySelector("#retry");
const popup = document.querySelector(".popup");

render();
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.tagData) void render();
});

retry.addEventListener("click", async () => {
  retry.disabled = true;
  retry.textContent = "取得中…";
  try {
    await chrome.runtime.sendMessage({ type: "REFRESH_TAG_DATA" });
    await render();
  } catch {
    support.textContent = "更新に失敗しました。しばらくしてから、もう一度お試しください。";
    support.hidden = false;
    status.className = "status warning";
    statusLabel.textContent = "更新に失敗しました";
  } finally {
    retry.disabled = false;
    await render();
  }
});

async function render() {
  const { tagData } = await chrome.storage.local.get("tagData");
  const count = Array.isArray(tagData?.tags) ? tagData.tags.length : 0;
  const hasData = count > 0;

  status.className = "status";
  support.hidden = true;
  popup.classList.toggle("unavailable", !hasData);

  if (tagData?.status === "available" && hasData) {
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
  tagCount.textContent = String(count);
  retry.textContent = hasData ? "タグ情報を更新" : "再試行";
}
