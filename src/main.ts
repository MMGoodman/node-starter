// ============================================================
// main.ts — מחבר את שלוש השכבות ל-UI
// כולל: מחוון חיבור, סרגל התקדמות, toggle להקלטות,
// והזרימה המלאה: הקלטה -> שמירה מקומית -> העלאה ברקע -> מיזוג.
// ============================================================

import { startRecording, stopRecording, getCurrentRecordingId } from './recorder.js';
import { setFailMode, startUploader, uploadPending, notifyComplete } from './uploader.js';
import { getPendingCountForRecording, getStats } from './db.js';
import { log } from './logger.js';

const SERVER_URL = 'http://localhost:4000';

window.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
  const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;
  const failToggle = document.getElementById('failToggle') as HTMLInputElement;
  const showBtn = document.getElementById('showRecordingsBtn') as HTMLButtonElement;
  const recordingsDiv = document.getElementById('recordings') as HTMLDivElement;
  const statusEl = document.getElementById('connectionStatus') as HTMLDivElement;
  const progressText = document.getElementById('progressText') as HTMLDivElement;
  const progressBar = document.getElementById('progressBar') as HTMLDivElement;

  // מפעיל את שכבת ההעלאה ברקע - תמיד רצה
  startUploader();

  // ----- מחוון חיבור: בודק את השרת כל 3 שניות -----
  async function checkConnection(): Promise<void> {
    if (failToggle.checked) {
      statusEl.textContent = '● מנותק (Fail Mode)';
      statusEl.style.background = '#ffcdd2';
      statusEl.style.color = '#c62828';
      return;
    }
    try {
      const res = await fetch(`${SERVER_URL}/health`);
      if (res.ok) {
        statusEl.textContent = '● מחובר לשרת';
        statusEl.style.background = '#c8e6c9';
        statusEl.style.color = '#2e7d32';
      } else {
        throw new Error('not ok');
      }
    } catch (err) {
      statusEl.textContent = '● אין חיבור לשרת';
      statusEl.style.background = '#ffcdd2';
      statusEl.style.color = '#c62828';
    }
  }
  checkConnection();
  setInterval(checkConnection, 3000);

  // ----- סרגל התקדמות: מעדכן כל שנייה -----
  async function updateProgress(): Promise<void> {
    const stats = await getStats();
    progressText.textContent = `📊 נשמרו: ${stats.total} • הועלו: ${stats.uploaded} • ממתינים: ${stats.pending}`;
    const percent = stats.total > 0 ? Math.round((stats.uploaded / stats.total) * 100) : 0;
    progressBar.style.width = percent + '%';
    progressBar.style.background = stats.pending > 0 ? '#ff9800' : '#4caf50';
  }
  updateProgress();
  setInterval(updateProgress, 1000);

  // ----- מתג דימוי כשל -----
  failToggle.addEventListener('change', () => {
    setFailMode(failToggle.checked);
    checkConnection();
  });

  // ----- התחלת הקלטה -----
  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    stopBtn.disabled = false;
    try {
      await startRecording();
    } catch (err) {
      startBtn.disabled = false;
      stopBtn.disabled = true;
    }
  });

  // ----- עצירת הקלטה: מוודא שהכל עלה ואז מאחד -----
  stopBtn.addEventListener('click', async () => {
    stopBtn.disabled = true;
    startBtn.disabled = false;

    const recordingId = getCurrentRecordingId();

    // 1. עוצר את ההקלטה (שומר chunk אחרון ל-IndexedDB)
    await stopRecording();

    // 2. ממתין שה-chunk האחרון יישמר
    await wait(600);

    // 3. מעלה הכל, וממתין עד שכל ה-chunks של ההקלטה עלו
    log('success', 'ensuring all chunks are uploaded before merge...');
    let attempts = 0;
    while (attempts < 60) {
      await uploadPending();
      const stillPending = await getPendingCountForRecording(recordingId);
      if (stillPending === 0) break;
      log('warning', `${stillPending} chunks still pending, waiting...`);
      await wait(1500);
      attempts++;
    }

    // 4. רק עכשיו, כשהכל עלה - השרת מאחד לסרטון אחד
    await notifyComplete(recordingId);
    log('success', `recording ${recordingId} merged into single video ✅`);
  });

  // ----- הצגת/הסתרת ההקלטות (toggle) -----
  showBtn.addEventListener('click', async () => {
    if (recordingsDiv.innerHTML.trim() !== '') {
      recordingsDiv.innerHTML = '';
      showBtn.textContent = 'הצג הקלטות מהשרת';
      return;
    }

    try {
      const response = await fetch(`${SERVER_URL}/recordings`);
      const data = await response.json();

      if (data.count === 0) {
        recordingsDiv.textContent = 'אין הקלטות עדיין';
        showBtn.textContent = 'הסתר הקלטות';
        return;
      }

      data.recordings.forEach((rec: any) => {
        const recBox = document.createElement('div');
        recBox.style.cssText = 'margin-bottom:24px; padding:16px; background:#fff; border:1px solid #ccc; border-radius:8px;';

        const title = document.createElement('div');
        title.textContent = `🎬 ${rec.recordingId} — ${rec.status} — ${rec.chunks.length} chunks`;
        title.style.cssText = 'font-weight:bold; margin-bottom:8px;';
        recBox.appendChild(title);

        if (rec.durationSeconds || rec.totalSize) {
          const meta = document.createElement('div');
          const mins = rec.durationSeconds ? Math.floor(rec.durationSeconds / 60) : 0;
          const secs = rec.durationSeconds ? rec.durationSeconds % 60 : 0;
          const mb = rec.totalSize ? (rec.totalSize / 1024 / 1024).toFixed(1) : '?';
          meta.textContent = `⏱️ ${mins}:${String(secs).padStart(2, '0')} דקות • 💾 ${mb} MB`;
          meta.style.cssText = 'font-size:13px; color:#666; margin-bottom:12px;';
          recBox.appendChild(meta);
        }

        if (rec.fullVideo) {
          const fullTitle = document.createElement('div');
          fullTitle.textContent = '🎥 הקלטה מאוחדת (מלאה):';
          fullTitle.style.cssText = 'font-weight:bold; margin:8px 0 4px; color:#2e7d32;';
          recBox.appendChild(fullTitle);

          const fullVideo = document.createElement('video');
          fullVideo.src = `${SERVER_URL}/completed/${rec.recordingId}`;
          fullVideo.controls = true;
          fullVideo.style.cssText = 'width:100%; max-width:500px; border-radius:6px; display:block;';
          recBox.appendChild(fullVideo);
        }

        recordingsDiv.appendChild(recBox);
      });

      showBtn.textContent = 'הסתר הקלטות';
    } catch (err) {
      recordingsDiv.textContent = 'שגיאה בטעינת ההקלטות';
    }
  });
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}