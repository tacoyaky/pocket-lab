const availability = document.querySelector("#availability");
const updatedAt = document.querySelector("#updated-at");
const tagCount = document.querySelector("#tag-count");
const error = document.querySelector("#error");
const retry = document.querySelector("#retry");

render();
chrome.storage.onChanged.addListener(render);
retry.addEventListener("click", async () => {
  retry.disabled = true;
  retry.textContent = "取得中…";
  await chrome.runtime.sendMessage({ type: "REFRESH_TAG_DATA" });
  await render();
  retry.disabled = false;
  retry.textContent = "今すぐ再取得";
});

async function render() {
  const { tagData } = await chrome.storage.local.get("tagData");
  const count = Array.isArray(tagData?.tags) ? tagData.tags.length : 0;
  if (tagData?.status === "available" && count > 0) {
    availability.textContent = "データを利用できます";
  } else if (tagData?.status === "stale" && count > 0) {
    availability.textContent = "保存済みデータを利用中（更新に失敗）";
  } else {
    availability.textContent = "データを利用できません";
  }
  updatedAt.textContent = tagData?.updatedAt ? new Date(tagData.updatedAt).toLocaleString() : "未取得";
  tagCount.textContent = `${count} 件`;
  error.hidden = !tagData?.error;
  error.textContent = tagData?.error ? `取得エラー: ${tagData.error}` : "";
}
