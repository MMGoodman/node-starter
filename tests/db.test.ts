// ============================================================
// db.test.ts — טסטים מקיפים לשכבת האחסון (IndexedDB)
// בודק: שמירה, שליפה, pending, markUploaded, ספירה,
// הפרדה בין הקלטות, שרידות, וסדר chunks.
// ============================================================

import 'fake-indexeddb/auto';

import {
  saveChunk,
  getPendingChunks,
  markUploaded,
  getPendingCountForRecording,
  getAllChunks,
  getStats,
  StoredChunk,
} from '../src/db';

function makeChunk(recordingId: string, chunkId: number): StoredChunk {
  return {
    id: `${recordingId}_${chunkId}`,
    recordingId,
    chunkId,
    data: new Blob(['fake video data'], { type: 'video/webm' }),
    uploaded: false,
    createdAt: Date.now(),
  };
}

describe('db (IndexedDB storage)', () => {

  test('שומר chunk ואפשר לשלוף אותו', async () => {
    await saveChunk(makeChunk('rec_1', 1));
    const all = await getAllChunks();
    expect(all.some((c) => c.id === 'rec_1_1')).toBe(true);
  });

  test('chunk חדש מופיע כ-pending (לא הועלה)', async () => {
    await saveChunk(makeChunk('rec_2', 1));
    const pending = await getPendingChunks();
    expect(pending.some((c) => c.id === 'rec_2_1')).toBe(true);
  });

  test('markUploaded מסמן chunk כמועלה ומוריד אותו מ-pending', async () => {
    await saveChunk(makeChunk('rec_3', 1));
    await markUploaded('rec_3_1');
    const pending = await getPendingChunks();
    expect(pending.some((c) => c.id === 'rec_3_1')).toBe(false);
  });

  test('getPendingCountForRecording סופר רק chunks לא-מועלים של הקלטה מסוימת', async () => {
    await saveChunk(makeChunk('rec_4', 1));
    await saveChunk(makeChunk('rec_4', 2));
    await saveChunk(makeChunk('rec_4', 3));
    await markUploaded('rec_4_1');

    const count = await getPendingCountForRecording('rec_4');
    expect(count).toBe(2);
  });

  test('chunks של הקלטות שונות לא מתערבבים בספירה', async () => {
    await saveChunk(makeChunk('rec_5', 1));
    await saveChunk(makeChunk('rec_6', 1));

    expect(await getPendingCountForRecording('rec_5')).toBe(1);
    expect(await getPendingCountForRecording('rec_6')).toBe(1);
  });

  // ===== שרידות: ה-chunks נשמרים ואפשר לשלוף אותם שוב =====
  test('שרידות: chunk שנשמר עדיין קיים בשליפה חוזרת (מדמה ריענון)', async () => {
    await saveChunk(makeChunk('rec_persist', 1));

    // שליפה "חדשה" - כמו אחרי ריענון דף. הנתונים עדיין שם.
    const all = await getAllChunks();
    const found = all.find((c) => c.id === 'rec_persist_1');
    expect(found).toBeDefined();
    expect(found?.recordingId).toBe('rec_persist');
    expect(found?.uploaded).toBe(false);
  });

  // ===== סדר: ה-chunks נשמרים עם chunkId שאפשר למיין =====
  test('סדר: אפשר למיין chunks לפי chunkId', async () => {
    await saveChunk(makeChunk('rec_order', 3));
    await saveChunk(makeChunk('rec_order', 1));
    await saveChunk(makeChunk('rec_order', 2));

    const all = await getAllChunks();
    const forRec = all
      .filter((c) => c.recordingId === 'rec_order')
      .sort((a, b) => a.chunkId - b.chunkId);

    expect(forRec.map((c) => c.chunkId)).toEqual([1, 2, 3]);
  });

  test('שמירה חוזרת של אותו id מעדכנת ולא מכפילה', async () => {
    const chunk = makeChunk('rec_dup', 1);
    await saveChunk(chunk);
    await saveChunk(chunk); // שמירה שנייה של אותו id

    const all = await getAllChunks();
    const matches = all.filter((c) => c.id === 'rec_dup_1');
    expect(matches.length).toBe(1); // רק אחד, לא כפול
  });

});

test('getStats מחזיר ספירה נכונה של total, uploaded, ו-pending', async () => {
    // שומרים 3 chunks חדשים תחת הקלטה ייחודית
    await saveChunk(makeChunk('stats_rec', 1));
    await saveChunk(makeChunk('stats_rec', 2));
    await saveChunk(makeChunk('stats_rec', 3));

    // מסמנים אחד כמועלה
    await markUploaded('stats_rec_1');

    const stats = await getStats();

    // total כולל את כל ה-chunks במסד (כולל מטסטים קודמים),
    // אז נבדוק את היחס: uploaded + pending = total
    expect(stats.uploaded + stats.pending).toBe(stats.total);
    // ויש לפחות chunk אחד מועלה ולפחות 2 ממתינים (מהטסט הזה)
    expect(stats.uploaded).toBeGreaterThanOrEqual(1);
    expect(stats.pending).toBeGreaterThanOrEqual(2);
  });