const b = document.getElementById("copy-btn") as HTMLButtonElement | null;
b?.addEventListener("click", async () => {
  await navigator.clipboard.writeText(b.dataset.copy!);
  b.textContent = "Copied";
  setTimeout(() => (b.textContent = "Copy address"), 2000);
});
