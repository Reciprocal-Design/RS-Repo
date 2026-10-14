// Real cell videos (the real-cell view), held for the session they are
// added in: the browser decodes them, so this registry only keeps the
// playing element and its size for rendering. Keyed by the video's object URL.

export interface RealVideoInfo {
  video: HTMLVideoElement;
  width: number;
  height: number;
  duration: number;
}

const registry = new Map<string, RealVideoInfo>();
export const realVideoInfo = (src: string) => (src ? registry.get(src) : undefined);
export const registerRealVideo = (src: string, info: RealVideoInfo) => registry.set(src, info);
