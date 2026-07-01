// ============================================================
// db.ts — שכבת אחסון מקומי (IndexedDB)
// שומר chunks בדפדפן כדי שההקלטה לא תאבד גם בריענון/קריסה.
// ============================================================

const DB_NAME = 'recordingsDB';
const STORE_NAME = 'chunks';
const DB_VERSION = 1;

export interface StoredChunk {
  id: string;
  recordingId: string;
  chunkId: number;
  data: Blob;
  uploaded: boolean;
  createdAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('uploaded', 'uploaded', { unique: false });
        store.createIndex('recordingId', 'recordingId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveChunk(chunk: StoredChunk): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(chunk);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPendingChunks(): Promise<StoredChunk[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => {
      const all = request.result as StoredChunk[];
      resolve(all.filter((c) => !c.uploaded));
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getPendingCountForRecording(recordingId: string): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => {
      const all = request.result as StoredChunk[];
      const pending = all.filter((c) => c.recordingId === recordingId && !c.uploaded);
      resolve(pending.length);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function markUploaded(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const chunk = getReq.result as StoredChunk;
      if (chunk) {
        chunk.uploaded = true;
        store.put(chunk);
      }
      resolve();
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function getAllChunks(): Promise<StoredChunk[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as StoredChunk[]);
    request.onerror = () => reject(request.error);
  });
}

export async function getStats(): Promise<{ total: number; uploaded: number; pending: number }> {
  const all = await getAllChunks();
  const uploaded = all.filter((c) => c.uploaded).length;
  return { total: all.length, uploaded, pending: all.length - uploaded };
}