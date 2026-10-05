// Tiny IndexedDB store for files kept only on this device (the custom background photo).
const open = () => new Promise((resolve, reject) => {
  const req = indexedDB.open("lockedin", 1);
  req.onupgradeneeded = () => req.result.createObjectStore("files");
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    // Close the connection when done: an open one per call piles up and blocks "Delete all data" (deleteDatabase).
    const tx = db.transaction("files", mode), req = fn(tx.objectStore("files"));
    tx.oncomplete = () => { db.close(); resolve(req?.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
  });
}
export const getFile = key => run("readonly", s => s.get(key)).catch(() => null);
export const putFile = (key, blob) => run("readwrite", s => s.put(blob, key));
export const deleteFile = key => run("readwrite", s => s.delete(key)).catch(() => {});

// Shrink a photo to a sensible wallpaper size so it loads fast and stays small.
export async function shrinkImage(file, maxSide = 2048) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return new Promise(r => c.toBlob(r, "image/jpeg", 0.85));
}
