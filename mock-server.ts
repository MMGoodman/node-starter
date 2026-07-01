import express, { Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import ffmpegPath from "ffmpeg-static";

const app = express();
const PORT = 4000;

// נתיב ל-ffmpeg - יורד אוטומטית עם npm install, עובד בכל מערכת הפעלה
const FFMPEG = ffmpegPath as string;
app.use(express.json({ limit: "50mb" }));

const STORAGE_DIR = path.join(process.cwd(), "storage");
const COMPLETED_DIR = path.join(process.cwd(), "completed");
if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR);
if (!fs.existsSync(COMPLETED_DIR)) fs.mkdirSync(COMPLETED_DIR);

interface Chunk {
  chunkId: number;
  size: number;
  fileName: string;
  receivedAt: string;
}

interface Recording {
  recordingId: string;
  status: "recording" | "completed";
  chunks: Chunk[];
  createdAt: string;
  fullVideo?: string;
  totalSize?: number;
  durationSeconds?: number;
}

const recordings: Record<string, Recording> = {};

function getOrCreate(recordingId: string): Recording {
  if (!recordings[recordingId]) {
    recordings[recordingId] = {
      recordingId,
      status: "recording",
      chunks: [],
      createdAt: new Date().toISOString(),
    };
  }
  return recordings[recordingId];
}

function loadExistingFiles(): void {
  const files = fs.readdirSync(STORAGE_DIR);
  for (const file of files) {
    const match = file.match(/^(rec_\d+)_chunk_(\d+)\.webm$/);
    if (match) {
      const recordingId = match[1];
      const chunkId = Number(match[2]);
      const size = fs.statSync(path.join(STORAGE_DIR, file)).size;
      const rec = getOrCreate(recordingId);
      if (!rec.chunks.find((c) => c.chunkId === chunkId)) {
        rec.chunks.push({ chunkId, size, fileName: file, receivedAt: new Date().toISOString() });
      }
    }
  }
  for (const id in recordings) {
    recordings[id].chunks.sort((a, b) => a.chunkId - b.chunkId);
    const fullPath = path.join(COMPLETED_DIR, id + ".webm");
    if (fs.existsSync(fullPath)) {
      recordings[id].fullVideo = id + ".webm";
      recordings[id].status = "completed";
      recordings[id].totalSize = fs.statSync(fullPath).size;
    }
  }
  console.log("[server] loaded " + Object.keys(recordings).length + " recordings from disk");
}

loadExistingFiles();

function mergeRecording(recordingId: string): void {
  const rec = recordings[recordingId];
  if (!rec || rec.chunks.length === 0) return;

  const sorted = [...rec.chunks].sort((a, b) => a.chunkId - b.chunkId);

  const listContent = sorted
    .map((c) => "file '" + path.join(STORAGE_DIR, c.fileName).replace(/\\/g, "/") + "'")
    .join("\n");
  const listPath = path.join(STORAGE_DIR, recordingId + "_list.txt");
  fs.writeFileSync(listPath, listContent);

  const outputPath = path.join(COMPLETED_DIR, recordingId + ".webm");
  const args = ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath];

  execFile(FFMPEG, args, (error) => {
    if (error) {
      console.error("[server] ffmpeg error:", error.message);
      return;
    }
    rec.fullVideo = recordingId + ".webm";
    const size = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
    rec.totalSize = size;
    rec.durationSeconds = sorted.length * 30;
    console.log("[server] MERGED (ffmpeg) " + recordingId + " -> completed/" + recordingId + ".webm (" + sorted.length + " chunks, " + size + " bytes)");

    // שומרים את ה-chunks הבודדים (לא מוחקים) - כגיבוי ולשחזור
    try { fs.unlinkSync(listPath); } catch (e) {}
  });
}

app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.post("/upload", express.raw({ type: () => true, limit: "50mb" }), (req: Request, res: Response) => {
  try {
    const recordingId = req.header("x-recording-id") || "unknown";
    const chunkId = Number(req.header("x-chunk-id") || "0");
    const data = req.body as Buffer;

    if (!data || !Buffer.isBuffer(data) || data.length === 0) {
      return res.status(400).json({ error: "empty body" });
    }

    const fileName = recordingId + "_chunk_" + chunkId + ".webm";
    fs.writeFileSync(path.join(STORAGE_DIR, fileName), data);

    const rec = getOrCreate(recordingId);
    if (!rec.chunks.find((c) => c.chunkId === chunkId)) {
      rec.chunks.push({ chunkId, size: data.length, fileName, receivedAt: new Date().toISOString() });
    }

    console.log("[server] saved " + fileName + " (" + data.length + " bytes)");
    res.json({ status: "ok", recordingId, chunkId, fileName });
  } catch (err) {
    console.error("[server] upload error:", err);
    res.status(500).json({ error: "upload failed" });
  }
});

app.post("/complete", (req: Request, res: Response) => {
  const recordingId = req.header("x-recording-id") || "unknown";
  const rec = getOrCreate(recordingId);
  rec.status = "completed";
  mergeRecording(recordingId);
  console.log("[server] recording " + recordingId + " completed - merging with ffmpeg");
  res.json({ status: "completed", recordingId, totalChunks: rec.chunks.length });
});

app.get("/recordings", (req: Request, res: Response) => {
  res.json({ count: Object.keys(recordings).length, recordings: Object.values(recordings) });
});

app.get("/completed/:id", (req: Request, res: Response) => {
  const id = req.params.id as string;
  const filePath = path.join(COMPLETED_DIR, id + ".webm");
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Full video not found" } });
  }
  res.setHeader("Content-Type", "video/webm");
  res.sendFile(filePath);
});

app.get("/chunk/:fileName", (req: Request, res: Response) => {
  const fileName = req.params.fileName as string;
  const filePath = path.join(STORAGE_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Chunk not found" } });
  }
  res.setHeader("Content-Type", "video/webm");
  res.sendFile(filePath);
});

app.get("/recordings/:id", (req: Request, res: Response) => {
  const id = req.params.id as string;
  const rec = recordings[id];
  if (!rec) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Recording not found" } });
  }
  res.json(rec);
});

app.use(express.static("."));

app.listen(PORT, () => {
  console.log("Mock server listening on http://localhost:" + PORT);
});
