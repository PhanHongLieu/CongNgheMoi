import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";

function SystemSettingsPage({ token }) {
  const [settings, setSettings] = useState({
    gpsMaxRadius: 100,
    faceMatchThreshold: 90,
    maxLoginAttempts: 5,
    lockoutDuration: 30,
    sessionTimeout: 60
  });
  const [status, setStatus] = useState("Ready");
  const [saving, setSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const data = await apiRequest("/system/settings", token);
      setSettings(data || settings);
      setStatus("System settings loaded");
    } catch (error) {
      setStatus(`Failed to load settings: ${error.message}`);
    }
  }, [token]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiRequest("/system/settings", token, "PUT", settings);
      setStatus("Settings saved successfully");
    } catch (error) {
      setStatus(`Failed to save settings: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-4">
      {status && status !== "System settings loaded" && status !== "Ready" && (
        <div className="rounded-2xl bg-blue-50 p-4 text-sm text-blue-700 border border-blue-200 flex items-center gap-2">
          <span>{status}</span>
        </div>
      )}

      <div className="rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
        <h3 className="text-lg font-bold text-steel mb-4">System Settings</h3>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-graphite mb-1">
              Maximum GPS radius (meters)
            </label>
            <input
              type="number"
              className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
              value={settings.gpsMaxRadius}
              onChange={(e) => setSettings({...settings, gpsMaxRadius: Number(e.target.value)})}
              min="10"
              max="500"
            />
            <p className="text-xs text-graphite/60 mt-1">Radius allowed for employee check-in at job site</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-graphite mb-1">
              Face match threshold (%)
            </label>
            <input
              type="number"
              className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
              value={settings.faceMatchThreshold}
              onChange={(e) => setSettings({...settings, faceMatchThreshold: Number(e.target.value)})}
              min="50"
              max="100"
            />
            <p className="text-xs text-graphite/60 mt-1">Minimum match ratio for face authentication</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-graphite mb-1">
              Maximum failed login attempts
            </label>
            <input
              type="number"
              className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
              value={settings.maxLoginAttempts}
              onChange={(e) => setSettings({...settings, maxLoginAttempts: Number(e.target.value)})}
              min="3"
              max="10"
            />
            <p className="text-xs text-graphite/60 mt-1">Number of failed logins before account lockout</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-graphite mb-1">
              Account lockout duration (minutes)
            </label>
            <input
              type="number"
              className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
              value={settings.lockoutDuration}
              onChange={(e) => setSettings({...settings, lockoutDuration: Number(e.target.value)})}
              min="5"
              max="120"
            />
            <p className="text-xs text-graphite/60 mt-1">Account lockout duration after too many failed login attempts</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-graphite mb-1">
              Session timeout (minutes)
            </label>
            <input
              type="number"
              className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
              value={settings.sessionTimeout}
              onChange={(e) => setSettings({...settings, sessionTimeout: Number(e.target.value)})}
              min="15"
              max="480"
            />
            <p className="text-xs text-graphite/60 mt-1">Automatic session expiration timeout</p>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={loadSettings}
              className="flex-1 rounded-lg border border-steel/20 px-4 py-2 text-sm font-medium text-graphite hover:bg-steel/5"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex-1 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save settings"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export default SystemSettingsPage;
