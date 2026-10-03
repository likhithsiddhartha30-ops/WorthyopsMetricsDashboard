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

  // Demo team members + 120 days of sample data, so the charts aren't empty.
  // Admin can wipe the demo data from Settings -> "Clear all activity".
  seedDemoData: true,
  demoPassword: 'Team@2026',
  demoMembers: [
    { name: 'Aarav Mehta', email: 'aarav@worthyops.com' },
    { name: 'Priya Nair', email: 'priya@worthyops.com' },
    { name: 'Rohan Kapoor', email: 'rohan@worthyops.com' },
    { name: 'Sneha Reddy', email: 'sneha@worthyops.com' }
  ],

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
