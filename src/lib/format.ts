/**
 * Formats a file size in bytes to a human-readable string.
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Formats a duration in seconds to a human-readable MM:SS or HH:MM:SS string.
 */
export function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds === null) return '0:00';
  
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  let result = '';

  if (hrs > 0) {
    result += `${hrs}:${mins < 10 ? '0' : ''}`;
  }

  result += `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  return result;
}
