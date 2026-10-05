// lockedin's own icon set: hand-drawn SVGs in the brand palette, used everywhere instead of emoji.
// The source keeps emoji characters as short markers (they read well in code); emoji.js swaps each one for the
// matching icon in the page, and canvases (clips, wrapped image) draw the icons as images.
const GRADS = {
  lime: ["#e6ff8f", "#9ad600"], gold: ["#ffe486", "#f0a000"], fire: ["#ffc84f", "#ff3b2f"], ice: ["#eefbff", "#62c6ff"],
  red: ["#ff8f8f", "#e5263e"], purple: ["#d3bcff", "#7656ff"], steel: ["#ffffff", "#b6bdc9"],
  green: ["#a3f2b5", "#1aa64f"], brown: ["#d29a60", "#774520"], pink: ["#ffc6dc", "#ff5f9e"], blue: ["#a6dbff", "#2a86ff"],
  orange: ["#ffc477", "#ff8418"], ink: ["#535b6b", "#1b1f26"], bronze: ["#f4c294", "#b0612a"],
};
const medal = (grad, n) => `<path d="M6.5 2.5h4.2l2.3 6.5H8.7zM17.5 2.5h-4.2L11 9h4.3z" fill="url(#g-blue)"/><circle cx="12" cy="15" r="6.6" fill="url(#g-${grad})"/><circle cx="12" cy="15" r="4.7" fill="none" stroke="#fff" stroke-opacity=".5"/><text x="12" y="17.7" text-anchor="middle" font-size="7.6" font-weight="800" font-family="system-ui,sans-serif" fill="#4a2e00">${n}</text>`;

export const ICONS = {
  key: `<g transform="rotate(-45 12 12)"><circle cx="12" cy="6.6" r="4.7" fill="url(#g-gold)"/><circle cx="12" cy="6.6" r="1.8" fill="#7a4b00" opacity=".55"/><path d="M10.6 10.6h2.8v10.1L12 22.3l-1.4-1.6z" fill="url(#g-gold)"/><path d="M13.4 14.8h2.3v1.9h-2.3zM13.4 18h1.7v1.7h-1.7z" fill="url(#g-gold)"/></g>`,
  lock: `<path d="M7.5 10.5V7.6a4.5 4.5 0 0 1 9 0v2.9" fill="none" stroke="url(#g-steel)" stroke-width="2.5" stroke-linecap="round"/><rect x="4.5" y="10" width="15" height="11.5" rx="3.6" fill="url(#g-lime)"/><circle cx="12" cy="14.9" r="1.8" fill="#1f2a00"/><path d="M11.2 15.4h1.6v2.8h-1.6z" fill="#1f2a00"/>`,
  phoneoff: `<rect x="7" y="2.5" width="10" height="19" rx="2.6" fill="url(#g-steel)"/><rect x="8.4" y="4.6" width="7.2" height="13.8" rx="1" fill="#2a2f38"/><circle cx="12" cy="12" r="9.4" fill="none" stroke="url(#g-red)" stroke-width="2.3"/><path d="M5.4 5.4l13.2 13.2" stroke="url(#g-red)" stroke-width="2.3" stroke-linecap="round"/>`,
  flame: `<path d="M12 2.5c.6 3.2 3 4.6 4.6 7 1.4 2 2 3.6 2 5.4A6.6 6.6 0 0 1 12 21.5a6.6 6.6 0 0 1-6.6-6.6c0-2.4 1.2-4.2 2.6-5.6.2 1.6.9 2.7 2 3.2-.3-3.6.6-6.8 2-10z" fill="url(#g-fire)"/><path d="M12 12.2c.4 1.6 1.6 2.4 2.2 3.6a2.6 2.6 0 0 1-2.2 4 2.6 2.6 0 0 1-2.4-3.4c.4-1.4 1.6-2.4 2.4-4.2z" fill="#ffe28a"/>`,
  party: `<path d="M3.5 20.5l4.2-11.2 7 7z" fill="url(#g-gold)"/><path d="M5.6 15l3.4 3.4M6.8 11.8l5.4 5.4" stroke="#b86e00" stroke-width="1.1" opacity=".55"/><circle cx="15.5" cy="5" r="1.4" fill="#ff5f9e"/><circle cx="19.5" cy="10" r="1.3" fill="#2a86ff"/><path d="M11 3.5l1 2.4M17.5 13.6l2.6.6M14 8.6l3.6-3.6" stroke="url(#g-lime)" stroke-width="1.9" stroke-linecap="round"/><rect x="19" y="2.8" width="2.3" height="2.3" rx=".5" fill="#9ad600" transform="rotate(20 20 4)"/>`,
  tomato: `<path d="M12 7c5 0 8.5 2.8 8.5 7S17 21.5 12 21.5 3.5 18.2 3.5 14 7 7 12 7z" fill="url(#g-red)"/><path d="M12 8.6L9.2 6.3l1.4 2.9-3.6-.6 3.4 1.6L12 8.6l1.6 1.6 3.4-1.6-3.6.6 1.4-2.9z" fill="url(#g-green)"/><path d="M12 8.6V4.6" stroke="#2f7d2a" stroke-width="1.6" stroke-linecap="round"/><ellipse cx="8.4" cy="12.2" rx="2" ry="1.2" fill="#fff" opacity=".35"/>`,
  link: `<path d="M10 14l4-4" stroke="url(#g-lime)" stroke-width="2.5" stroke-linecap="round"/><path d="M9 11.4L6.8 13.6a3.6 3.6 0 0 0 5.1 5.1l2.2-2.2M15 12.6l2.2-2.2a3.6 3.6 0 0 0-5.1-5.1L9.9 7.5" fill="none" stroke="url(#g-lime)" stroke-width="2.5" stroke-linecap="round"/>`,
  sparkle: `<path d="M10 2.8l1.8 5.4 5.4 1.8-5.4 1.8L10 17.2l-1.8-5.4L2.8 10l5.4-1.8z" fill="url(#g-lime)"/><path d="M18 13.4l.9 2.7 2.7.9-2.7.9-.9 2.7-.9-2.7-2.7-.9 2.7-.9z" fill="url(#g-gold)"/>`,
  chat: `<path d="M4 5.6A2.6 2.6 0 0 1 6.6 3h10.8A2.6 2.6 0 0 1 20 5.6v7.8a2.6 2.6 0 0 1-2.6 2.6H11l-4.5 4v-4A2.6 2.6 0 0 1 4 13.4z" fill="url(#g-blue)"/><circle cx="8.5" cy="9.5" r="1.25" fill="#fff"/><circle cx="12" cy="9.5" r="1.25" fill="#fff"/><circle cx="15.5" cy="9.5" r="1.25" fill="#fff"/>`,
  clapper: `<rect x="3" y="9.5" width="18" height="11" rx="2.2" fill="url(#g-ink)"/><path d="M3.1 9.4l-.5-3.3 16.9-2.6.5 3.3z" fill="url(#g-ink)"/><path d="M6.4 5.6l2.6 3.2M10.9 4.9l2.6 3.2M15.3 4.2l2.6 3.2" stroke="#fff" stroke-width="1.6"/><path d="M3 13.2h18" stroke="url(#g-lime)" stroke-width="1.5"/>`,
  sleep: `<rect x="3" y="3" width="18" height="18" rx="6" fill="url(#g-purple)"/><path d="M7.5 9h5l-5 6.5h5" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 6.5h3l-3 3.8h3" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/>`,
  yawn: `<rect x="2.5" y="7" width="17" height="10" rx="3" fill="none" stroke="url(#g-steel)" stroke-width="2"/><rect x="20" y="10" width="2" height="4" rx="1" fill="url(#g-steel)"/><rect x="4.6" y="9.1" width="3.6" height="5.8" rx="1.2" fill="url(#g-red)"/>`,
  laugh: `<path d="M12 2.5l2.1 3.4 3.9-1-.6 4 3.6 1.8-3 2.7 1.7 3.6-4 .2-1.2 3.9L12 19l-2.5 3.1-1.2-3.9-4-.2 1.7-3.6-3-2.7 3.6-1.8-.6-4 3.9 1z" fill="url(#g-orange)"/><text x="12" y="14.6" text-anchor="middle" font-size="7.2" font-weight="900" font-family="system-ui,sans-serif" fill="#fff">HA!</text>`,
  shock: `<path d="M12 2.5l2.1 3.4 3.9-1-.6 4 3.6 1.8-3 2.7 1.7 3.6-4 .2-1.2 3.9L12 19l-2.5 3.1-1.2-3.9-4-.2 1.7-3.6-3-2.7 3.6-1.8-.6-4 3.9 1z" fill="url(#g-red)"/><path d="M12 7.5v5.5" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="16.3" r="1.5" fill="#fff"/>`,
  cry: `<path d="M12 2.8c3.4 4.6 6.2 8.2 6.2 11.6a6.2 6.2 0 0 1-12.4 0C5.8 11 8.6 7.4 12 2.8z" fill="url(#g-blue)"/><path d="M9.2 14.6a3 3 0 0 0 2.6 2.9" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".8"/>`,
  melt: `<path d="M3 5.5A2.5 2.5 0 0 1 5.5 3h13A2.5 2.5 0 0 1 21 5.5V11c0 1.6-1.3 1.8-1.3 3.4v3.1a1.6 1.6 0 0 1-3.2 0v-2.3c0-1-1.5-1-1.5 0v4.6a1.7 1.7 0 0 1-3.4 0v-5.4c0-1-1.5-1-1.5 0v1.4a1.6 1.6 0 0 1-3.2 0v-2.2C6.9 13 3 12.8 3 11z" fill="url(#g-lime)"/><path d="M6.5 6.8h6" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>`,
  cool: `<path d="M2.5 9h19v1.6c0 2.3-1.8 4.2-4.1 4.2h-1.2a4 4 0 0 1-3.8-2.8h-.8a4 4 0 0 1-3.8 2.8H6.6c-2.3 0-4.1-1.9-4.1-4.2z" fill="url(#g-ink)"/><path d="M5 10.5l2.5 2.5M15.5 10.5l2.5 2.5" stroke="#fff" stroke-width="1.2" stroke-linecap="round" opacity=".55"/>`,
  grin: `<path d="M12 2.8l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.6l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" fill="url(#g-gold)"/><path d="M9.5 9.6l1.6 1.6" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".7"/>`,
  hourglass: `<rect x="5" y="2.5" width="14" height="2.6" rx="1.3" fill="url(#g-brown)"/><rect x="5" y="18.9" width="14" height="2.6" rx="1.3" fill="url(#g-brown)"/><path d="M7 5.1h10c0 4-4 5.4-4 6.9s4 2.9 4 6.9H7c0-4 4-5.4 4-6.9S7 9.1 7 5.1z" fill="#dff4ff" opacity=".9"/><path d="M9 7.6h6c-.8 1.6-3 2.6-3 3.4-.1-.8-2.2-1.8-3-3.4zM8.4 18.4c.6-2 3.6-3 3.6-4.6 0 1.6 3 2.6 3.6 4.6z" fill="url(#g-gold)"/>`,
  ice: `<path d="M12 2.8l8 4.4v9.6l-8 4.4-8-4.4V7.2z" fill="url(#g-ice)"/><path d="M12 12l8-4.8M12 12L4 7.2M12 12v9.2" stroke="#fff" stroke-width="1.2" opacity=".75"/><path d="M7 8.4l3 1.7" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>`,
  group: `<circle cx="15.6" cy="8" r="3.2" fill="url(#g-purple)"/><path d="M10 20c0-3.6 2.5-6 5.6-6s5.4 2.4 5.4 6z" fill="url(#g-purple)"/><circle cx="9" cy="8.5" r="3.5" fill="url(#g-blue)"/><path d="M2.5 21c0-4 2.9-6.5 6.5-6.5s6.5 2.5 6.5 6.5z" fill="url(#g-blue)"/>`,
  target: `<circle cx="11" cy="13" r="8.5" fill="url(#g-red)"/><circle cx="11" cy="13" r="5.8" fill="#fff"/><circle cx="11" cy="13" r="3.1" fill="url(#g-red)"/><path d="M11 13l8.6-8.6" stroke="url(#g-ink)" stroke-width="1.8" stroke-linecap="round"/><path d="M17.4 3.4l3.2.1-.1 3.1-2.5.2z" fill="url(#g-lime)"/>`,
  gift: `<rect x="3.5" y="9" width="17" height="4.2" rx="1.2" fill="url(#g-red)"/><rect x="5" y="13" width="14" height="8.5" rx="1.6" fill="url(#g-red)"/><rect x="10.6" y="9" width="2.8" height="12.5" fill="url(#g-lime)"/><path d="M12 9c-1.5-3.5-5.5-4.5-5.5-2.2C6.5 8.5 9.5 9 12 9zm0 0c1.5-3.5 5.5-4.5 5.5-2.2C17.5 8.5 14.5 9 12 9z" fill="url(#g-lime)"/>`,
  chart: `<rect x="3" y="3" width="18" height="18" rx="4.5" fill="url(#g-steel)"/><path d="M6.5 16l3.6-4 3 2.5 4.6-6" fill="none" stroke="url(#g-green)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M14.6 8.5h3.1v3.1" fill="none" stroke="url(#g-green)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  rocket: `<path d="M12 2.5c3.5 2.5 5 6.2 5 10.2l-2 3.3H9l-2-3.3c0-4 1.5-7.7 5-10.2z" fill="url(#g-steel)"/><circle cx="12" cy="9.5" r="2" fill="url(#g-blue)"/><path d="M7 12.5l-3 3.6 3.5.5zM17 12.5l3 3.6-3.5.5z" fill="url(#g-red)"/><path d="M10 16.5h4l-2 5z" fill="url(#g-fire)"/>`,
  brain: `<path d="M11.4 4.2A3.6 3.6 0 0 0 5 6.5a3.5 3.5 0 0 0-1.5 6 3.6 3.6 0 0 0 2.7 5.8 3.4 3.4 0 0 0 5.2 1.2zM12.6 4.2A3.6 3.6 0 0 1 19 6.5a3.5 3.5 0 0 1 1.5 6 3.6 3.6 0 0 1-2.7 5.8 3.4 3.4 0 0 1-5.2 1.2z" fill="url(#g-pink)"/><path d="M8 9.5c1 .3 1.6 1 1.6 2M16 9.5c-1 .3-1.6 1-1.6 2M7.5 15c1-.6 2-.5 2.6.2M16.5 15c-1-.6-2-.5-2.6.2" stroke="#b23a6b" stroke-width="1.1" fill="none" stroke-linecap="round" opacity=".7"/>`,
  books: `<rect x="3.5" y="5" width="4.5" height="15.5" rx="1" fill="url(#g-red)"/><rect x="8.5" y="3.5" width="4.5" height="17" rx="1" fill="url(#g-blue)"/><path d="M14 6.2l3.9-1.1 3.4 14.1-3.9 1.1z" fill="url(#g-lime)"/><path d="M3.5 8h4.5M8.5 7h4.5M3.5 17h4.5M8.5 17.5h4.5" stroke="#fff" stroke-width="1" opacity=".55"/>`,
  coffee: `<path d="M4.5 9.5h12v6a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5z" fill="url(#g-steel)"/><path d="M16.5 11h1.2a2.6 2.6 0 0 1 0 5.2h-1.6" fill="none" stroke="url(#g-steel)" stroke-width="1.8"/><ellipse cx="10.5" cy="9.7" rx="5.6" ry="1.2" fill="url(#g-brown)"/><path d="M8.5 3.5c-.8 1 .8 1.8 0 3M12.5 3.5c-.8 1 .8 1.8 0 3" stroke="#9aa3b2" stroke-width="1.3" fill="none" stroke-linecap="round"/>`,
  cap: `<path d="M12 4l10 4.5-10 4.5L2 8.5z" fill="url(#g-ink)"/><path d="M6.5 10.8v4.4c0 1.6 2.5 3 5.5 3s5.5-1.4 5.5-3v-4.4L12 13.3z" fill="url(#g-ink)"/><path d="M20 9.4v5.2" stroke="url(#g-gold)" stroke-width="1.4"/><circle cx="20" cy="15.2" r="1.2" fill="url(#g-gold)"/>`,
  medal1: medal("gold", 1), medal2: medal("steel", 2), medal3: medal("bronze", 3),
  bolt: `<path d="M13.5 2.5L5 13.5h6l-1.5 8 8.5-11h-6z" fill="url(#g-gold)"/>`,
  headphones: `<path d="M4 14v-2a8 8 0 0 1 16 0v2" fill="none" stroke="url(#g-ink)" stroke-width="2.3"/><rect x="3" y="13" width="5" height="8" rx="2.3" fill="url(#g-lime)"/><rect x="16" y="13" width="5" height="8" rx="2.3" fill="url(#g-lime)"/>`,
  owl: `<path d="M5 9c0-3 1-5.5 2-6.5L9.5 5h5L17 2.5c1 1 2 3.5 2 6.5v6a7 7 0 0 1-14 0z" fill="url(#g-brown)"/><circle cx="9" cy="10" r="2.8" fill="#fff"/><circle cx="15" cy="10" r="2.8" fill="#fff"/><circle cx="9" cy="10" r="1.3" fill="#1b1f26"/><circle cx="15" cy="10" r="1.3" fill="#1b1f26"/><path d="M12 12l-1.2 1.7h2.4z" fill="url(#g-orange)"/><path d="M9 17q3 2 6 0" stroke="#fff" stroke-opacity=".45" fill="none"/>`,
  wolf: `<path d="M4 3l4.5 4h7L20 3l-.5 8c0 2-1 3.5-2.5 5L12 21l-5-5c-1.5-1.5-2.5-3-2.5-5z" fill="url(#g-steel)"/><path d="M12 21l-3-4h6z" fill="#eef0f4"/><circle cx="9" cy="11" r="1.1" fill="#1b1f26"/><circle cx="15" cy="11" r="1.1" fill="#1b1f26"/><path d="M10.8 15h2.4L12 16.6z" fill="#1b1f26"/>`,
  frog: `<circle cx="7.5" cy="7.5" r="3.5" fill="url(#g-green)"/><circle cx="16.5" cy="7.5" r="3.5" fill="url(#g-green)"/><ellipse cx="12" cy="14" rx="9" ry="7" fill="url(#g-green)"/><circle cx="7.5" cy="7.5" r="1.6" fill="#fff"/><circle cx="16.5" cy="7.5" r="1.6" fill="#fff"/><circle cx="7.5" cy="7.8" r=".8" fill="#1b1f26"/><circle cx="16.5" cy="7.8" r=".8" fill="#1b1f26"/><path d="M7 15q5 3.5 10 0" stroke="#145c2a" stroke-width="1.4" fill="none" stroke-linecap="round"/>`,
  moon: `<path d="M15.5 3a8.5 8.5 0 1 0 5.5 14.2A7 7 0 0 1 15.5 3z" fill="url(#g-gold)"/>`,
  sprout: `<path d="M12 21v-8" stroke="url(#g-green)" stroke-width="2.2" stroke-linecap="round"/><path d="M12 13C12 8 8.5 5.5 4 5.5c0 4.5 3 7.5 8 7.5zM12 11c0-4 2.5-6.5 7.5-6.5 0 4-2.5 6.5-7.5 6.5z" fill="url(#g-lime)"/><path d="M7 21h10" stroke="url(#g-brown)" stroke-width="2.4" stroke-linecap="round"/>`,
  gem: `<path d="M7 3.5h10l4 5.5-9 11.5L3 9z" fill="url(#g-ice)"/><path d="M3 9h18M9 3.5L7.5 9l4.5 11.5L16.5 9 15 3.5" stroke="#fff" stroke-width="1" fill="none" opacity=".75"/>`,
  cat: `<path d="M4 4l4.5 3.5h7L20 4v9a8 8 0 0 1-16 0z" fill="url(#g-orange)"/><circle cx="9" cy="12" r="1.2" fill="#1b1f26"/><circle cx="15" cy="12" r="1.2" fill="#1b1f26"/><path d="M11 14.5h2l-1 1.2z" fill="#ff7aa8"/><path d="M12 15.7q-1 1.3-2.2.6M12 15.7q1 1.3 2.2.6M3 14l3.5.5M3 16.5l3.5-.5M21 14l-3.5.5M21 16.5l-3.5-.5" stroke="#7a3b00" stroke-width=".9" fill="none" stroke-linecap="round"/>`,
  cloud: `<path d="M7 19a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 17.8 9 4.6 4.6 0 0 1 17.5 19z" fill="url(#g-steel)"/><path d="M9.2 14.4l2 2 3.8-4" stroke="url(#g-green)" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
};

// Emoji character → icon. Anything not listed stays as plain text.
export const EMOJI = {
  "🔑": "key", "🔒": "lock", "📵": "phoneoff", "🔥": "flame", "🎉": "party", "🍅": "tomato", "🔗": "link", "✨": "sparkle",
  "💬": "chat", "🎬": "clapper", "😴": "sleep", "🥱": "yawn", "😂": "laugh", "😱": "shock", "😭": "cry", "🫠": "melt",
  "😎": "cool", "😁": "grin", "⌛": "hourglass", "🧊": "ice", "👥": "group", "🎯": "target", "🎁": "gift", "📈": "chart",
  "🚀": "rocket", "🧠": "brain", "📚": "books", "☕": "coffee", "🎓": "cap", "🥇": "medal1", "🥈": "medal2", "🥉": "medal3",
  "⚡": "bolt", "🎧": "headphones", "🦉": "owl", "🐺": "wolf", "🐸": "frog", "🌙": "moon", "🌱": "sprout", "💎": "gem",
  "🐱": "cat", "☁": "cloud",
};
export const LABELS = {sleep: "dozing", yawn: "tired", laugh: "laughing", shock: "surprised", cry: "crying", melt: "zoned out", cool: "cool", grin: "star", key: "keys", lock: "lock", phoneoff: "phone", flame: "streak", tomato: "pomodoro", ice: "streak freeze", hourglass: "time"};
export const RE = new RegExp(`(${Object.keys(EMOJI).join("|")})\\uFE0F?`, "gu");

const defs = names => `<defs>${names.map(n => `<linearGradient id="g-${n}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${GRADS[n][0]}"/><stop offset="1" stop-color="${GRADS[n][1]}"/></linearGradient>`).join("")}</defs>`;

// One hidden sprite per page; icons reference it with <use href="#i-name">.
export function mountSprite() {
  if (document.getElementById("lockedin-icons")) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = `<svg id="lockedin-icons" width="0" height="0" style="position:absolute" aria-hidden="true">${defs(Object.keys(GRADS))}${
    Object.entries(ICONS).map(([n, body]) => `<symbol id="i-${n}" viewBox="0 0 24 24">${body}</symbol>`).join("")}</svg>`;
  document.body.prepend(wrap.firstChild);
}

// A standalone SVG (its own gradients) for drawing on canvas or using as an <img>.
export function svgText(name) {
  const body = ICONS[name] || "";
  const used = [...new Set([...body.matchAll(/#g-([a-z]+)/g)].map(m => m[1]))];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="96" height="96">${defs(used)}${body}</svg>`;
}
const cache = new Map();
export function image(name) {
  if (!cache.has(name)) cache.set(name, new Promise(res => {
    const img = new Image(); img.onload = () => res(img); img.onerror = () => res(null);
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText(name));
  }));
  return cache.get(name);
}
// Text for places that can't show images (tab titles, notifications, the share sheet).
export const strip = s => String(s).replace(RE, "").replace(/\s{2,}/g, " ").trim();
// Leading icon of a caption like "📵 caught lacking" → {icon: "phoneoff", text: "caught lacking"}.
export function lead(s) {
  RE.lastIndex = 0;
  const m = /^\s*(\S+?)️?\s+(.*)$/u.exec(String(s));
  return m && EMOJI[m[1]] ? {icon: EMOJI[m[1]], text: m[2]} : {icon: null, text: strip(s)};
}
