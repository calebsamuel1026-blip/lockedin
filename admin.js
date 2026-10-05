// Admin dashboard: one call to admin_overview(), which the database only answers for users in the admins table.
// Not linked from the app and marked noindex. Charts are tiny hand-made SVGs, so there's nothing extra to load.
import {createClient} from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import {SUPABASE_URL, SUPABASE_KEY} from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {auth: {persistSession: true, autoRefreshToken: true, storageKey: "lockedin.auth"}});
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const num = v => v == null ? "--" : (+v).toLocaleString();
const pct = (a, b) => b ? Math.round(a / b * 100) + "%" : "--";

// Fill in missing days so charts show gaps as zeros.
function series(rows, key, days) {
  const by = Object.fromEntries((rows || []).map(r => [r.day, +r[key] || 0]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10); out.push({day: d, v: by[d] || 0}); }
  return out;
}
function bars(el, data) {
  const W = 600, H = 160, pad = 18, max = Math.max(1, ...data.map(d => d.v)), bw = (W - pad) / data.length;
  const label = d => d.day.slice(5);
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(data.map(d => `${label(d)}: ${d.v}`).join(", "))}"><g class="bars">${data.map((d, i) => {
    const h = (H - pad - 14) * d.v / max;
    return `<rect x="${pad + i * bw + 1}" y="${H - pad - h}" width="${Math.max(1, bw - 2)}" height="${h}" rx="2"><title>${label(d)}: ${d.v}</title></rect>`;
  }).join("")}</g><text class="axis" x="0" y="10">${max}</text><text class="axis" x="${pad}" y="${H - 4}">${label(data[0])}</text>
  <text class="axis" x="${W}" y="${H - 4}" text-anchor="end">${label(data[data.length - 1])}</text></svg>`;
}
const table = (head, rows) => rows.length
  ? `<table><thead><tr>${head.map((h, i) => `<th${i ? ' class="n"' : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${i ? ' class="n"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
  : `<p class="muted">No data yet.</p>`;
const kpi = (label, value, sub = "") => `<div class="kpi"><span class="k-label" style="color:var(--brand-text)">${esc(label)}</span><b>${esc(value)}</b><span class="sub">${esc(sub)}</span></div>`;

async function load() {
  const days = +$("#days").value;
  $("#msg").textContent = "Loading…";
  const {data: o, error} = await sb.rpc("admin_overview", {days});
  if (error) {
    $("#dash").hidden = true;
    $("#msg").textContent = /admins only|42501/.test(error.message + error.code) ? "This account isn't an admin. Add it to the admins table (DEPLOY.md step 4)." : `Couldn't load: ${error.message}`;
    return;
  }
  $("#msg").textContent = ""; $("#dash").hidden = false;
  $("#kpis").innerHTML = kpi("DAU", num(o.dau)) + kpi("WAU", num(o.wau)) + kpi("MAU", num(o.mau)) + kpi("Accounts", num(o.users_total), `+${num(o.signups_in_range)} in range`);
  const acct = o.account_sessions || {};
  $("#kpis2").innerHTML = kpi("Sessions", num(o.sessions_total), `${num(acct.count)} from accounts`)
    + kpi("Focus hours", num(o.focus_hours), `${num(o.tracked_hours)}h tracked`)
    + kpi("Median session", o.median_session_min == null ? "--" : `${o.median_session_min}m`, acct.median_min != null ? `${acct.median_min}m for accounts` : "")
    + kpi("Account focus", `${num(acct.focus_hours)}h`, "from synced sessions");
  bars($("#cActive"), series(o.active_per_day, "users", days));
  bars($("#cSignups"), series(o.signups_per_day, "signups", days));
  bars($("#cSessions"), series(o.sessions_per_day, "sessions", days));
  const ret = o.retention || [];
  const tot = ret.reduce((a, r) => ({u: a.u + r.users, d1: a.d1 + r.d1, d7: a.d7 + r.d7}), {u: 0, d1: 0, d7: 0});
  $("#retention").innerHTML = `<p class="muted">All cohorts: D1 ${pct(tot.d1, tot.u)}, D7 ${pct(tot.d7, tot.u)} of ${num(tot.u)} new visitors (recent cohorts can't have D7 yet).</p>`
    + table(["First day", "New", "D1", "D7"], ret.slice(-14).reverse().map(r => [r.day, r.users, `${r.d1} (${pct(r.d1, r.users)})`, `${r.d7} (${pct(r.d7, r.users)})`]));
  $("#events").innerHTML = table(["Event", "Count"], (o.top_events || []).map(e => [e.name, num(e.count)]));
  const mix = Object.entries(o.state_mix || {}).filter(([k]) => k !== "collab"), mixTotal = mix.reduce((a, [, v]) => a + +v, 0);
  $("#mix").innerHTML = table(["State", "Hours", "Share"], mix.sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, (v / 3600).toFixed(1), pct(+v, mixTotal)]));
  const kinds = new Set([...Object.keys(o.alerts_by_kind || {}), ...Object.keys(o.feedback || {})]);
  $("#feedback").innerHTML = table(["State", "Alerts", "Not right"], [...kinds].map(k => [k, num(o.alerts_by_kind?.[k] || 0), num(o.feedback?.[k] || 0)]));
  $("#stamp").textContent = `Generated ${new Date(o.generated_at).toLocaleString()} · days are UTC`;
}

async function show() {
  const {data} = await sb.auth.getSession();
  const signedIn = !!data.session;
  $("#login").hidden = signedIn; $("#controls").hidden = !signedIn;
  if (signedIn) load(); else $("#dash").hidden = true;
}
$("#login").onsubmit = async e => {
  e.preventDefault();
  const {error} = await sb.auth.signInWithPassword({email: $("#email").value.trim(), password: $("#pass").value});
  $("#loginMsg").innerHTML = error ? `<div class="notice err">${esc(error.message)}</div>` : "";
  if (!error) show();
};
$("#refresh").onclick = load;
$("#days").onchange = load;
$("#out").onclick = async () => { await sb.auth.signOut(); show(); };
show();
