// Swap emoji characters in the page for lockedin's own icons (icons.js), so no emoji ever shows.
import {EMOJI, LABELS, RE, mountSprite} from "./icons.js";
const NS = "http://www.w3.org/2000/svg";
const TEST = new RegExp(RE.source, "u");
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "OPTION", "TITLE", "CANVAS"]);

function icon(name) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "emoji ico");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", LABELS[name] || name);
  const use = document.createElementNS(NS, "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

function swap(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (TEST.test(n.nodeValue) && !SKIP.has(n.parentNode?.nodeName) && !n.parentNode?.closest?.("option, select, svg, [data-noemoji]")) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    RE.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0, m;
    const text = node.nodeValue;
    while ((m = RE.exec(text))) {
      frag.append(text.slice(last, m.index), icon(EMOJI[m[1]]));
      last = m.index + m[0].length;
    }
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
  RE.lastIndex = 0;
}

export function start() {
  mountSprite();
  swap(document.body);
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; swap(document.body); });
  }).observe(document.body, {childList: true, subtree: true, characterData: true});
}
