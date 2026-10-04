/* ==========================================================================
   App configuration
   Edit these values before you share the dashboard with your team.
   The default accounts below are only used the FIRST time the app loads
   in a browser (when no data exists yet). Change the admin password from
   Settings after your first login.
   ========================================================================== */

window.APP_CONFIG = {
  appName: 'WorthyOps',
  storageKey: 'worthyops_metrics_v1',
  sessionKey: 'worthyops_session_v1',

  // Default admin account (created on first load)
  defaultAdmin: {
    name: 'Admin',
    email: 'admin@worthyops.com',
    password: 'Admin@2026'
  },

  // Demo team members + sample data (for trying the dashboard out).
  // Off: real data comes from the Google Sheet. Existing demo data is removed
  // automatically on the first sheet sync, or via Settings → "Remove demo data".
  seedDemoData: false,
  demoPassword: 'Team@2026',
  demoMembers: [
    { name: 'Aarav Mehta', email: 'aarav@worthyops.com' },
    { name: 'Priya Nair', email: 'priya@worthyops.com' },
    { name: 'Rohan Kapoor', email: 'rohan@worthyops.com' },
    { name: 'Sneha Reddy', email: 'sneha@worthyops.com' }
  ],

  // Supabase (database + logins). When url + anonKey are set, Supabase is the
  // single source of truth: logins use Supabase Auth and all data is stored
  // there. Put the real values in js/config.local.js (git-ignored).
  // The anon key is safe in the browser - row-level security protects the data.
  // NEVER put the service_role key here.
  supabase: {
    url: '',
    anonKey: ''
  },

  // Google Sheet sync (Apps Script web app). Ignored when Supabase is set. Leave empty to keep data in the
  // browser only. Can also be set per-browser in Admin → Settings.
  // Anyone with the URL + key can read and write the sheet - keep them private.
  sheetSync: {
    url: '', // set in js/config.local.js (git-ignored) or Admin → Settings
    key: ''
  },

  // Lead pipeline stages, in order. Keep keys stable - they will be used
  // to map the "Status" column when we connect the Google Sheet.
  leadStages: [
    { key: 'new', label: 'New lead' },
    { key: 'contacted', label: 'Contacted' },
    { key: 'replied', label: 'Replied' },
    { key: 'booked', label: 'Call booked' },
    { key: 'attended', label: 'Call attended' },
    { key: 'won', label: 'Converted' },
    { key: 'paid', label: 'Paid' },
    { key: 'lost', label: 'Lost' }
  ],
  leadSources: ['Instagram', 'LinkedIn', 'Cold email', 'Cold call', 'Facebook', 'Twitter / X', 'YouTube', 'Referral', 'Website', 'Other'],

  // Where a lead came from. Outbound = setters reached out first.
  // Inbound leads come from organic content or paid ads, and can be linked
  // to the exact piece of content (Content section).
  leadOrigins: [
    { key: 'outbound', label: 'Outbound' },
    { key: 'organic', label: 'Inbound · Organic content' },
    { key: 'paid', label: 'Inbound · Paid ads' }
  ],
  contentPlatforms: ['Instagram', 'YouTube', 'LinkedIn', 'Facebook', 'TikTok', 'Twitter / X', 'Website / Blog', 'Newsletter', 'Other'],
  contentFormats: ['Reel', 'Carousel', 'Post', 'Story', 'Long-form video', 'Short', 'Live / Webinar', 'Ad - Video', 'Ad - Image', 'Ad - Carousel', 'Lead form', 'Other'],

  // Defaults the admin can change later from Settings
  defaultSettings: {
    currency: 'USD',
    locale: 'en-US',
    showLeaderboardToTeam: true,
    // Monthly TEAM targets. Each member's personal target defaults to an
    // equal share of these unless the admin sets one for that member.
    targets: {
      outreach: 7000,
      callsBooked: 200,
      dealsClosed: 45,
      revenue: 80000
    }
  }
};
