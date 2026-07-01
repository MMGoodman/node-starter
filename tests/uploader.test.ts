// ============================================================
// uploader.test.ts — טסטים מקיפים לשכבת ההעלאה
// בודק: העלאה מוצלחת, כשל ששומר, fail mode,
// ו-retry לאורך זמן (נכשל ואז מצליח בסבב הבא).
// ============================================================

import 'fake-indexeddb/auto';

import { setFailMode, uploadPending } from '../src/uploader';
import { saveChunk, getPendingChunks, StoredChunk } from '../src/db';

function makeChunk(recordingId: string, chunkId: number): StoredChunk {
  return {
    id: `${recordingId}_${chunkId}`,
    recordingId,
    chunkId,
    data: new Blob(['fake'], { type: 'video/webm' }),
    uploaded: false,
    createdAt: Date.now(),
  };
}

global.fetch = jest.fn();

describe('uploader', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    setFailMode(false);
  });

  test('uploadPending מעלה chunk ומסמן אותו כמועלה', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

    await saveChunk(makeChunk('up_1', 1));
    await uploadPending();

    const pending = await getPendingChunks();
    expect(pending.some((c) => c.id === 'up_1_1')).toBe(false);
    expect(global.fetch).toHaveBeenCalled();
  });

  test('כשההעלאה נכשלת, ה-chunk נשאר ממתין (לא אובד)', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });

    await saveChunk(makeChunk('up_2', 1));
    await uploadPending();

    const pending = await getPendingChunks();
    expect(pending.some((c) => c.id === 'up_2_1')).toBe(true);
  });

  test('fail mode גורם לכשל בהעלאה - ה-chunk נשמר', async () => {
    setFailMode(true);

    await saveChunk(makeChunk('up_3', 1));
    await uploadPending();

    const pending = await getPendingChunks();
    expect(pending.some((c) => c.id === 'up_3_1')).toBe(true);
  });

  // ===== הטסט החשוב: התאוששות לאורך זמן =====
  test('retry: chunk שנכשל בסבב ראשון מצליח כשהרשת חוזרת', async () => {
    await saveChunk(makeChunk('up_4', 1));

    // סבב 1: הרשת נפולה (כשל) - ה-chunk נשאר ממתין
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });
    await uploadPending();

    let pending = await getPendingChunks();
    expect(pending.some((c) => c.id === 'up_4_1')).toBe(true); // עדיין ממתין

    // סבב 2: הרשת חזרה (הצלחה) - ה-chunk עכשיו עולה
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    await uploadPending();

    pending = await getPendingChunks();
    expect(pending.some((c) => c.id === 'up_4_1')).toBe(false); // הצליח, לא ממתין
  });

  test('retry: מספר chunks שנכשלו - כולם עולים כשהרשת חוזרת', async () => {
    await saveChunk(makeChunk('up_5', 1));
    await saveChunk(makeChunk('up_5', 2));
    await saveChunk(makeChunk('up_5', 3));

    // סבב כושל
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });
    await uploadPending();
    let pending = await getPendingChunks();
    const stillWaiting = pending.filter((c) => c.recordingId === 'up_5');
    expect(stillWaiting.length).toBe(3); // כולם ממתינים

    // סבב מוצלח
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    await uploadPending();
    pending = await getPendingChunks();
    const afterRetry = pending.filter((c) => c.recordingId === 'up_5');
    expect(afterRetry.length).toBe(0); // כולם עלו
  });

});