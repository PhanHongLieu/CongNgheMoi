import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";

function DiaryPage({ token, projects }) {
  const [diaries, setDiaries] = useState([]);
  const [status, setStatus] = useState("Ready");
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState("");
  const [formData, setFormData] = useState({
    diaryCode: "",
    diaryDate: new Date().toISOString().split('T')[0],
    title: "",
    workContent: "",
    issues: "",
    weather: "",
    weatherMorning: "",
    weatherAfternoon: "",
    weatherEvening: "",
    weatherNight: "",
    siteCondition: "",
    temperature: "",
    incidentReport: "",
    safetyRating: "",
    qualityRating: "",
    progressRating: "",
    hygieneRating: "",
    proposal: "",
    note: ""
  });

  const load = useCallback(async () => {
    try {
      const data = await apiRequest("/construction-diaries", token);
      setDiaries(Array.isArray(data) ? data : []);
      setStatus("Diary loaded successfully");
    } catch (error) {
      setStatus(`Failed to load diary: ${error.message}`);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...formData,
        projectId: Number(selectedProject)
      };

      await apiRequest("/construction-diaries", token, "POST", payload);
      setModalOpen(false);
      setFormData({
        diaryCode: "",
        diaryDate: new Date().toISOString().split('T')[0],
        title: "",
        workContent: "",
        issues: "",
        weather: "",
        weatherMorning: "",
        weatherAfternoon: "",
        weatherEvening: "",
        weatherNight: "",
        siteCondition: "",
        temperature: "",
        incidentReport: "",
        safetyRating: "",
        qualityRating: "",
        progressRating: "",
        hygieneRating: "",
        proposal: "",
        note: ""
      });
      load();
    } catch (error) {
      setStatus(`Failed to create diary entry: ${error.message}`);
    }
  };

  return (
    <section className="space-y-4">
      {status && status !== "Diary loaded successfully" && status !== "Ready" && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 border border-red-200 flex items-center gap-2">
          <span className="text-lg">⚠️</span><span>{status}</span>
        </div>
      )}

      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold text-steel">Construction Diary</h3>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="rounded-xl bg-blue-500 hover:bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition"
        >
          + Create New Diary
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {diaries.map((diary) => (
          <div key={diary.id} className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft hover:shadow-md transition">
            <div className="flex items-start justify-between mb-3">
              <div className="rounded-lg bg-blue-50 p-2">
                <span className="text-lg">�</span>
              </div>
              <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
                diary.status === 'OPEN' ? 'bg-green-100 text-green-700' :
                diary.status === 'CLOSED' ? 'bg-gray-100 text-gray-700' :
                'bg-amber-100 text-amber-700'
              }`}>
                {diary.status === 'OPEN' ? 'Open' : diary.status === 'CLOSED' ? 'Closed' : diary.status}
              </span>
            </div>
            <h3 className="font-bold text-steel mb-1">{diary.title}</h3>
            <p className="text-xs text-graphite/70 mb-2">
              {diary.diary_code && `Code: ${diary.diary_code} | `}
              {diary.diary_date && `Date: ${new Date(diary.diary_date).toLocaleDateString('en-US')}`}
            </p>
            {diary.work_content && (
              <p className="text-xs text-graphite/60 line-clamp-2">{diary.work_content}</p>
            )}
            {diary.weather && (
              <p className="text-xs text-graphite/60 mt-2">Weather: {diary.weather}</p>
            )}
          </div>
        ))}
      </div>

      {diaries.length === 0 && (
        <div className="rounded-2xl border border-dashed border-steel/20 bg-white p-12 text-center">
          <div className="text-4xl mb-3">�</div>
          <p className="text-graphite/60">No construction diaries yet</p>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="w-full max-w-4xl rounded-2xl bg-white p-6 shadow-2xl my-8">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-steel">Create New Construction Diary</h3>
              <button type="button" onClick={() => setModalOpen(false)} className="text-graphite hover:text-black">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-graphite mb-1">Project</label>
                  <select
                    className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                    value={selectedProject}
                    onChange={(e) => setSelectedProject(e.target.value)}
                    required
                  >
                    <option value="">-- Select Project --</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.project_code} - {project.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-graphite mb-1">Date</label>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                    value={formData.diaryDate}
                    onChange={(e) => setFormData({...formData, diaryDate: e.target.value})}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-graphite mb-1">Diary Code</label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                    value={formData.diaryCode}
                    onChange={(e) => setFormData({...formData, diaryCode: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-graphite mb-1">Title</label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                    value={formData.title}
                    onChange={(e) => setFormData({...formData, title: e.target.value})}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-graphite mb-1">Work Content</label>
                <textarea
                  className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                  rows={3}
                  value={formData.workContent}
                  onChange={(e) => setFormData({...formData, workContent: e.target.value})}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-graphite mb-1">Issues Encountered</label>
                <textarea
                  className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                  rows={2}
                  value={formData.issues}
                  onChange={(e) => setFormData({...formData, issues: e.target.value})}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-graphite mb-1">General Weather</label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                  value={formData.weather}
                  onChange={(e) => setFormData({...formData, weather: e.target.value})}
                  placeholder="Sunny, rainy, cloudy..."
                />
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="block text-sm font-medium text-graphite mb-1">Morning</label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                    value={formData.weatherMorning}
                    onChange={(e) => setFormData({...formData, weatherMorning: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-graphite mb-1">Afternoon</label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                    value={formData.weatherAfternoon}
                    onChange={(e) => setFormData({...formData, weatherAfternoon: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-graphite mb-1">Evening</label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                    value={formData.weatherEvening}
                    onChange={(e) => setFormData({...formData, weatherEvening: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-graphite mb-1">Night</label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                    value={formData.weatherNight}
                    onChange={(e) => setFormData({...formData, weatherNight: e.target.value})}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-graphite mb-1">Site Condition</label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                    value={formData.siteCondition}
                    onChange={(e) => setFormData({...formData, siteCondition: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-graphite mb-1">Temperature (°C)</label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                    value={formData.temperature}
                    onChange={(e) => setFormData({...formData, temperature: e.target.value})}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-graphite mb-1">Incident Report</label>
                <textarea
                  className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                  rows={2}
                  value={formData.incidentReport}
                  onChange={(e) => setFormData({...formData, incidentReport: e.target.value})}
                />
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="block text-sm font-medium text-graphite mb-1">Safety (1-5)</label>
                  <select
                    className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                    value={formData.safetyRating}
                    onChange={(e) => setFormData({...formData, safetyRating: e.target.value})}
                  >
                    <option value="">--</option>
                    {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-graphite mb-1">Quality (1-5)</label>
                  <select
                    className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                    value={formData.qualityRating}
                    onChange={(e) => setFormData({...formData, qualityRating: e.target.value})}
                  >
                    <option value="">--</option>
                    {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-graphite mb-1">Progress (1-5)</label>
                  <select
                    className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                    value={formData.progressRating}
                    onChange={(e) => setFormData({...formData, progressRating: e.target.value})}
                  >
                    <option value="">--</option>
                    {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-graphite mb-1">Hygiene (1-5)</label>
                  <select
                    className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                    value={formData.hygieneRating}
                    onChange={(e) => setFormData({...formData, hygieneRating: e.target.value})}
                  >
                    <option value="">--</option>
                    {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-graphite mb-1">Proposal</label>
                <textarea
                  className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                  rows={2}
                  value={formData.proposal}
                  onChange={(e) => setFormData({...formData, proposal: e.target.value})}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-graphite mb-1">Notes</label>
                <textarea
                  className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                  rows={2}
                  value={formData.note}
                  onChange={(e) => setFormData({...formData, note: e.target.value})}
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="flex-1 rounded-lg border border-steel/20 px-4 py-2 text-sm font-medium text-graphite hover:bg-steel/5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
                >
                  Save Diary
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

export default DiaryPage;
