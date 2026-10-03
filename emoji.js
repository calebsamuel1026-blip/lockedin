// Swap emoji characters for 3D images (Microsoft Fluent Emoji, MIT licensed) everywhere in the page.
const CDN = "https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@main/assets/";
const NAMES = {
  "🔥": "Fire", "🔑": "Key", "🍅": "Tomato", "🎬": "Clapper board", "👥": "Busts in silhouette", "📵": "Mobile phone off",
  "💬": "Speech balloon", "😴": "Sleeping face", "🥱": "Yawning face", "🫠": "Melting face", "🎉": "Party popper",
  "🎁": "Wrapped gift", "📈": "Chart increasing", "🧊": "Ice", "⌛": "Hourglass done", "✨": "Sparkles", "🎓": "Graduation cap",
  "🔒": "Locked", "🥇": "1st place medal", "🥈": "2nd place medal", "🥉": "3rd place medal", "😂": "Face with tears of joy",
  "😱": "Face screaming in fear", "🚀": "Rocket", "🧠": "Brain", "📚": "Books", "☕": "Hot beverage",
};
const url = name => `${CDN}${encodeURIComponent(name)}/3D/${name.toLowerCase().replace(/ /g, "_")}_3d.png`;
const RE = new RegExp(`(${Object.keys(NAMES).join("|")})\\uFE0F?`, "gu");
const TEST = new RegExp(RE.source, "u");
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "OPTION", "TITLE", "CANVAS"]);

function swap(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (TEST.test(n.nodeValue) && !SKIP.has(n.parentNode?.nodeName) && !n.parentNode?.closest?.("option, select, [data-noemoji]")) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    RE.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0, m;
    const text = node.nodeValue;
    while ((m = RE.exec(text))) {
      frag.append(text.slice(last, m.index));
      const img = document.createElement("img");
      img.className = "emoji"; img.alt = m[1]; img.src = url(NAMES[m[1]]); img.draggable = false; img.decoding = "async";
      frag.append(img);
      last = m.index + m[0].length;
    }
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
  RE.lastIndex = 0;
}

export function start() {
  swap(document.body);
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; swap(document.body); });
  }).observe(document.body, {childList: true, subtree: true, characterData: true});
}
