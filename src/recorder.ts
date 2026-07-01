// ============================================================
// recorder.ts — שכבת ההקלטה בלבד
// מקליט מסך, כל 30 שניות יוצר chunk עצמאי, ושומר ל-IndexedDB.
// לא מכיר את השרת - ההקלטה ממשיכה גם בלי חיבור.
// ============================================================

import { log } from './logger.js';
import { saveChunk } from './db.js';

const CHUNK_DURATION_MS = 30000;

let stream: MediaStream | null = null;
let mediaRecorder: MediaRecorder | null = null;
let chunkCounter = 0;
let currentRecordingId = '';
let intervalId: number | null = null;
let isRecording = false;

export function getCurrentRecordingId(): string {
  return currentRecordingId;
}

export async function startRecording(): Promise<void> {
  stream = await navigator.mediaDevices.getDisplayMedia({ video: true });

  chunkCounter = 0;
  currentRecordingId = 'rec_' + Date.now();
  isRecording = true;

  log('success', `recording started (id: ${currentRecordingId})`);

  startChunk();

  intervalId = window.setInterval(() => {
    if (isRecording) restartChunk();
  }, CHUNK_DURATION_MS);
}

function startChunk(): void {
  if (!stream) return;
  mediaRecorder = new MediaRecorder(stream);

  mediaRecorder.ondataavailable = async (event: BlobEvent) => {
    if (event.data.size > 0) {
      chunkCounter++;
      const id = chunkCounter;
      await saveChunk({
        id: `${currentRecordingId}_${id}`,
        recordingId: currentRecordingId,
        chunkId: id,
        data: event.data,
        uploaded: false,
        createdAt: Date.now(),
      });
      log('success', `chunk #${id} recorded & saved locally`);
    }
  };

  mediaRecorder.start();
}

function restartChunk(): void {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
  setTimeout(() => {
    if (isRecording) startChunk();
  }, 100);
}

export async function stopRecording(): Promise<void> {
  if (!isRecording) {
    log('warning', 'no active recording to stop');
    return;
  }
  isRecording = false;

  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  mediaRecorder = null;
  log('success', 'recording stopped');
}