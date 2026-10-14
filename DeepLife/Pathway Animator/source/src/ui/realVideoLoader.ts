import { registerRealVideo } from '../core/realVideo';

/**
 * Open a real cell video for this session: an object URL for the file and a
 * muted, inline video element on it, ready to draw from once it has data.
 */
export async function loadRealVideo(file: File): Promise<string> {
  const src = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.loop = true;
  video.crossOrigin = 'anonymous';
  await new Promise<void>((res, rej) => {
    video.onloadeddata = () => res();
    video.onerror = () => rej(new Error('This video could not be opened in the browser. Try MP4 (H.264) or WebM.'));
    video.src = src;
  });
  if (!video.videoWidth || !video.videoHeight) throw new Error('This video has no picture.');
  registerRealVideo(src, { video, width: video.videoWidth, height: video.videoHeight, duration: video.duration || 0 });
  return src;
}
