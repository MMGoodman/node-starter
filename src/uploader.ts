// ============================================================
// uploader.ts — שכבת ההעלאה בלבד
// רצה ברקע, מושכת chunks לא-מועלים מ-IndexedDB,
// מעלה כשיש חיבור. אם נכשל - נשאר ב-DB לניסיון הבא.
// ============================================================

import { log } from './logger.js';
import { getPendingChunks, markUploaded } from './db.js';

const SERVER_URL = 'http://localhost:4000';
const UPLOAD_INTERVAL_MS = 5000;

let failMode = false;
let uploaderRunning = false;

export function setFailMode(value: boolean): void {
  failMode = value;
}

export function startUploader(): void {
  if (uploaderRunning) return;
  uploaderRunning = true;
  log('success', 'uploader started (background)');
  uploadLoop();
}

async function uploadLoop(): Promise<void> {
  while (uploaderRunning) {
    await uploadPending();
    await wait(UPLOAD_INTERVAL_MS);
  }
}

export async function uploadPending(): Promise<void> {
  const pending = await getPendingChunks();
  if (pending.length === 0) return;

  for (const chunk of pending) {
    try {
      await sendToServer(chunk.recordingId, chunk.chunkId, chunk.data);
      await markUploaded(chunk.id);
      log('success', `chunk #${chunk.chunkId} uploaded ✅`);
    } catch (err) {
      log('warning', `chunk #${chunk.chunkId} upload failed - will retry later`);
    }
  }
}

async function sendToServer(recordingId: string, chunkId: number, data: Blob): Promise<void> {
  if (failMode) {
    throw new Error('simulated network failure');
  }
  const response = await fetch(`${SERVER_URL}/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'x-recording-id': recordingId,
      'x-chunk-id': String(chunkId),
    },
    body: data,
  });
  if (!response.ok) {
    throw new Error(`server responded with ${response.status}`);
  }
}

export async function notifyComplete(recordingId: string): Promise<void> {
  try {
    await fetch(`${SERVER_URL}/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-recording-id': recordingId,
      },
      body: JSON.stringify({ recordingId }),
    });
    log('success', `recording ${recordingId} complete - server notified`);
  } catch (err) {
    log('warning', 'could not notify complete - no connection');
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}