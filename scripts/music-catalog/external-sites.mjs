export const MUSIC_CATALOGS = Object.freeze({
  'local-licensed': { label: '本地授权音乐', mode: 'results', requires_login: false, attribution_varies: true },
  pixabay: { label: 'Pixabay Music', mode: 'browser', requires_login: false, attribution_varies: false, buildUrl: (query) => `https://pixabay.com/music/search/${encodeURIComponent(query)}/` },
  'youtube-audio-library': { label: 'YouTube Audio Library', mode: 'browser', requires_login: true, attribution_varies: true, buildUrl: () => 'https://www.youtube.com/audiolibrary' },
  uppbeat: { label: 'Uppbeat', mode: 'browser', requires_login: true, attribution_varies: true, buildUrl: (query) => `https://uppbeat.io/browse/music/${encodeURIComponent(query)}` },
})
