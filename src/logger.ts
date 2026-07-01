// ============================================================
// logger.ts — לוגים בשלוש רמות: success / warning / error
// ============================================================

export type LogLevel = 'success' | 'warning' | 'error';

export function log(level: LogLevel, message: string): void {
  const time = new Date().toLocaleTimeString();
  const icon =
    level === 'success' ? '✅' :
    level === 'warning' ? '⚠️' :
    '❌';

  const line = `[${time}] ${icon} ${message}`;
  console.log(line);

  if (typeof document !== 'undefined') {
    const logsDiv = document.getElementById('logs');
    if (logsDiv) {
      const entry = document.createElement('div');
      entry.textContent = line;
      logsDiv.appendChild(entry);
      logsDiv.scrollTop = logsDiv.scrollHeight;
    }
  }
}