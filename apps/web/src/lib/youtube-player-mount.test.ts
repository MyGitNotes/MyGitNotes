// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activateYouTubeEmbed, stopYouTubePlayback } from './youtube-embed.js';

afterEach(() => {
  stopYouTubePlayback();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** A video embed with its poster, as the note renderer writes it, inside `container`. */
function embedIn(container: HTMLElement): HTMLElement {
  const embed = document.createElement('div');
  embed.className = 'note-youtube-embed';
  embed.dataset.videoId = 'dQw4w9WgXcQ';
  embed.dataset.youtubeSession = 'deck:0';
  const poster = document.createElement('button');
  poster.className = 'note-youtube-poster';
  embed.append(poster);
  container.append(embed);
  return poster;
}

describe('the player of a video that plays', () => {
  it('mounts inside a playing deck, which is a modal dialog over an inert app', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    const shell = document.createElement('div');
    shell.className = 'app-shell';
    const deck = document.createElement('dialog');
    deck.className = 'slide-deck';
    document.body.append(shell, deck);
    activateYouTubeEmbed(embedIn(deck));
    expect(document.querySelector('.note-youtube-persistent-player')?.parentElement).toBe(deck);
  });
});
