import { describe, expect, it } from 'vitest';
import { firstFrameSrc } from './first-frame';

// WebKit (the Mac and iPad apps) paints nothing for a video it has only read
// the metadata of. A start time asks it to seek there, which paints the frame.
describe('firstFrameSrc', () => {
  it('asks for the start of the video', () => {
    expect(firstFrameSrc('asset://localhost/v/clip.mp4')).toBe('asset://localhost/v/clip.mp4#t=0.001');
  });

  it('goes after a query', () => {
    expect(firstFrameSrc('asset://localhost/v/clip.mp4?v=3')).toBe('asset://localhost/v/clip.mp4?v=3#t=0.001');
  });

  it('leaves a fragment that is already there', () => {
    expect(firstFrameSrc('https://x.test/clip.mp4#t=10')).toBe('https://x.test/clip.mp4#t=10');
  });

  it('works for blob URLs', () => {
    expect(firstFrameSrc('blob:https://x.test/1234')).toBe('blob:https://x.test/1234#t=0.001');
  });
});
