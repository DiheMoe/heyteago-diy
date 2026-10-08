// 自动保存的存取：本机 IndexedDB 里只存一份「上次的编辑」。
const DB_NAME = "heyteago-diy";
const STORE = "autosave";
const KEY = "draft";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// 在一次事务里执行请求，事务完成后返回结果
async function transact<T>(mode: IDBTransactionMode, request: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = request(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

// 读出的是未经校验的原始数据，交给 parseSavedDraft；写入的是 serializeDraft 的结果
export const readSaved = (): Promise<unknown> => transact("readonly", (store) => store.get(KEY));
export const writeSaved = (record: Record<string, unknown>): Promise<unknown> =>
  transact("readwrite", (store) => store.put(record, KEY));
export const deleteSaved = (): Promise<unknown> => transact("readwrite", (store) => store.delete(KEY));
