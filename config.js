// Site-wide settings. Everything here is public by design (it ships to every visitor).
// See DEPLOY.md for where each value comes from.
export const APP_VERSION = "2026.10.04";
export const SITE_URL = "https://calebsamuel1026-blip.github.io/lockedin/";

// Supabase: the publishable key is meant to be public. Row level security in the database decides what it can do.
export const SUPABASE_URL = "https://fmtgteqakfdjmhvnzvtm.supabase.co";
export const SUPABASE_KEY = "sb_publishable_CRhpFbHddZlwsjz_JrDkdw_OMrr90Zm";

// Google Analytics 4 Measurement ID ("G-XXXXXXX"). Empty = GA is skipped entirely.
export const GA_ID = "";
// Search Console HTML-tag token. Google checks the raw HTML, so also paste it into the commented tag in index.html.
export const GSC_VERIFICATION = "";
// Turn on after the Google provider is set up in Supabase (DEPLOY.md step 6).
export const GOOGLE_AUTH_ENABLED = false;
