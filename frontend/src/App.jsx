import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "./api";

const defaultApplicationForm = { name: "", url: "" };
const defaultTestForm = {
  name: "",
  endpoint: "",
  method: "GET",
  expected_result: "OK",
  payload: "",
  frequency_seconds: 15,
};

const landingPalette = ["#2ad28b", "#f7c65c", "#50b8ff", "#ff9f68", "#d4ff72", "#ff7aa2"];
const testPalette = ["#6dd3fb", "#f9a66c", "#f4e06d", "#9bde7e", "#ff8fab", "#c0a1ff", "#7ee8c8", "#ffd166"];
const landingRangeOptions = [
  { value: "0.1667", label: "Last 10 min", minutes: 10 },
  { value: "0.5", label: "Last 30 min", minutes: 30 },
  { value: "1", label: "Last 1h", hours: 1 },
  { value: "3", label: "Last 3h", hours: 3 },
  { value: "6", label: "Last 6h", hours: 6 },
  { value: "12", label: "Last 12h", hours: 12 },
  { value: "24", label: "Last 1d", hours: 24 },
  { value: "72", label: "Last 3d", hours: 72 },
  { value: "168", label: "Last 1w", hours: 168 },
];

function toDateTimeLocalInput(date) {
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60000);
  return localDate.toISOString().slice(0, 16);
}

function compareValues(left, right, direction = "asc") {
  if (left === right) {
    return 0;
  }
  if (left === null || left === undefined) {
    return 1;
  }
  if (right === null || right === undefined) {
    return -1;
  }
  if (left < right) {
    return direction === "asc" ? -1 : 1;
  }
  return direction === "asc" ? 1 : -1;
}

function formatTimelineLabel(timestamp) {
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatResponseTime(value) {
  if (value === null || value === undefined) {
    return "N/A";
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} s`;
  }
  return `${value.toFixed(1)} ms`;
}

function buildGlobalTimeline(applications, historiesByApplication) {
  if (applications.length === 0) {
    return [];
  }

  const timestamps = historiesByApplication[applications[0]?.id]?.map((point) => point.timestamp) || [];
  return timestamps.map((timestamp, index) => {
    const row = { timestamp, label: formatTimelineLabel(timestamp) };
    applications.forEach((application) => {
      const point = historiesByApplication[application.id]?.[index];
      row[`app_${application.id}`] =
        point?.score === null || point?.score === undefined ? null : point.score;
    });
    return row;
  });
}

function buildApplicationTimeline(history, tests) {
  return [...history]
    .sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp))
    .map((point) => ({
      ...point,
      label: formatTimelineLabel(point.timestamp),
      health: point.score === null || point.score === undefined ? null : point.score,
      ...Object.fromEntries(
        tests.map((test) => [
          `response_${test.id}`,
          point.response_times?.[String(test.id)] ?? null,
        ]),
      ),
    }));
}

function App() {
  const [token, setToken] = useState(localStorage.getItem("statuscake-token") || "");
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ username: "", password: "" });
  const [applications, setApplications] = useState([]);
  const [dashboard, setDashboard] = useState([]);
  const [currentView, setCurrentView] = useState({ type: "landing", applicationId: null });
  const [tests, setTests] = useState([]);
  const [recentResults, setRecentResults] = useState([]);
  const [applicationHistory, setApplicationHistory] = useState([]);
  const [globalTimeline, setGlobalTimeline] = useState([]);
  const [windowHours, setWindowHours] = useState(24);
  const [landingWindowHours, setLandingWindowHours] = useState("24");
  const [landingEndAt, setLandingEndAt] = useState(() => toDateTimeLocalInput(new Date()));
  const [landingStartAt, setLandingStartAt] = useState(() => toDateTimeLocalInput(new Date(Date.now() - (24 * 60 * 60 * 1000))));
  const [errorCode, setErrorCode] = useState("");
  const [applicationForm, setApplicationForm] = useState(defaultApplicationForm);
  const [testForm, setTestForm] = useState(defaultTestForm);
  const [editingTestId, setEditingTestId] = useState(null);
  const [showApplicationModal, setShowApplicationModal] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [sampleState, setSampleState] = useState({ loaded: false, loaded_at: null });
  const [latestTestsQuery, setLatestTestsQuery] = useState("");
  const [latestTestsStatusFilter, setLatestTestsStatusFilter] = useState("");
  const [latestTestsSort, setLatestTestsSort] = useState({ key: "last_checked_at", direction: "desc" });
  const [recentResultsQuery, setRecentResultsQuery] = useState("");
  const [recentResultsErrorFilter, setRecentResultsErrorFilter] = useState("");
  const [recentResultsSort, setRecentResultsSort] = useState({ key: "started_at", direction: "desc" });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      return;
    }
    localStorage.setItem("statuscake-token", token);
    hydrate(token);
  }, [token]);

  useEffect(() => {
    if (!token || applications.length === 0) {
      return;
    }
    loadGlobalTimeline();
  }, [token, applications, landingWindowHours, landingStartAt, landingEndAt]);

  useEffect(() => {
    if (!token) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (currentView.type === "landing") {
        refreshLanding();
      } else if (currentView.applicationId) {
        refreshApplicationView(currentView.applicationId, false);
      }
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [token, currentView, applications, landingWindowHours, landingStartAt, landingEndAt, windowHours, errorCode]);

  useEffect(() => {
    if (!token || currentView.type !== "application" || !currentView.applicationId) {
      return;
    }
    loadApplicationContext(currentView.applicationId, windowHours, errorCode);
  }, [token, currentView, windowHours, errorCode]);

  async function hydrate(activeToken) {
    try {
      setLoading(true);
      const [me, apps, dashboardData, sample] = await Promise.all([
        api.me(activeToken),
        api.listApplications(activeToken),
        api.dashboard(activeToken, landingStartAt, landingEndAt),
        api.sampleStatus(activeToken),
      ]);
      setUser(me);
      setApplications(apps);
      setDashboard(dashboardData);
      setSampleState(sample);
      setMessage("");
    } catch (error) {
      setMessage(error.message);
      logout();
    } finally {
      setLoading(false);
    }
  }

  async function refreshLanding() {
    const [apps, dashboardData, sample] = await Promise.all([
      api.listApplications(token),
      api.dashboard(token, landingStartAt, landingEndAt),
      api.sampleStatus(token),
    ]);
    setApplications(apps);
    setDashboard(dashboardData);
    setSampleState(sample);

    if (apps.length > 0) {
      const histories = await Promise.all(
        apps.map((application) => api.historyRange(token, application.id, landingStartAt, landingEndAt, "")),
      );
      const byApplication = Object.fromEntries(apps.map((application, index) => [application.id, histories[index]]));
      setGlobalTimeline(buildGlobalTimeline(apps, byApplication));
    } else {
      setGlobalTimeline([]);
    }
  }

  async function loadGlobalTimeline() {
    const histories = await Promise.all(
      applications.map((application) => api.historyRange(token, application.id, landingStartAt, landingEndAt, "")),
    );
    const byApplication = Object.fromEntries(
      applications.map((application, index) => [application.id, histories[index]]),
    );
    setGlobalTimeline(buildGlobalTimeline(applications, byApplication));
  }

  async function loadApplicationContext(applicationId, currentWindowHours, currentErrorCode) {
    const [testList, historySeries, results] = await Promise.all([
      api.listTests(token, applicationId),
      api.history(token, applicationId, currentWindowHours, currentErrorCode),
      api.results(token, applicationId),
    ]);
    setTests(testList);
    setApplicationHistory(buildApplicationTimeline(historySeries, testList));
    setRecentResults(results);
  }

  async function refreshApplicationView(applicationId, withLoader = true) {
    try {
      if (withLoader) {
        setLoading(true);
      }
      const [apps, dashboardData, testList, historySeries, results] = await Promise.all([
        api.listApplications(token),
        api.dashboard(token, landingStartAt, landingEndAt),
        api.listTests(token, applicationId),
        api.history(token, applicationId, windowHours, errorCode),
        api.results(token, applicationId),
      ]);
      setApplications(apps);
      setDashboard(dashboardData);
      setTests(testList);
      setApplicationHistory(buildApplicationTimeline(historySeries, testList));
      setRecentResults(results);
    } catch (error) {
      setMessage(error.message);
    } finally {
      if (withLoader) {
        setLoading(false);
      }
    }
  }

  function logout() {
    localStorage.removeItem("statuscake-token");
    setToken("");
    setUser(null);
    setApplications([]);
    setDashboard([]);
    setTests([]);
    setRecentResults([]);
    setApplicationHistory([]);
    setGlobalTimeline([]);
    setCurrentView({ type: "landing", applicationId: null });
  }

  async function submitAuth(event) {
    event.preventDefault();
    try {
      setLoading(true);
      if (authMode === "register") {
        await api.register(authForm.username, authForm.password);
        setMessage("User created. You can now log in.");
        setAuthMode("login");
      } else {
        const result = await api.login(authForm.username, authForm.password);
        setToken(result.access_token);
      }
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function refreshAll() {
    await hydrate(token);
    if (currentView.type === "application" && currentView.applicationId) {
      await refreshApplicationView(currentView.applicationId, false);
    }
  }

  async function submitApplication(event) {
    event.preventDefault();
    try {
      setLoading(true);
      const created = await api.createApplication(token, applicationForm);
      setApplicationForm(defaultApplicationForm);
      setShowApplicationModal(false);
      await refreshAll();
      setCurrentView({ type: "application", applicationId: created.id });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function submitTest(event) {
    event.preventDefault();
    try {
      setLoading(true);
      const payload = {
        ...testForm,
        payload: testForm.method === "POST" ? testForm.payload : null,
        frequency_seconds: Number(testForm.frequency_seconds),
      };

      if (editingTestId) {
        await api.updateTest(token, editingTestId, payload);
      } else {
        await api.createTest(token, currentView.applicationId, payload);
      }

      setEditingTestId(null);
      setTestForm(defaultTestForm);
      setShowTestModal(false);
      await refreshAll();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function deleteApplication(id) {
    try {
      setLoading(true);
      await api.deleteApplication(token, id);
      await refreshAll();
      setCurrentView({ type: "landing", applicationId: null });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function deleteTest(id) {
    try {
      setLoading(true);
      await api.deleteTest(token, id);
      await refreshAll();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSampleDataLoad() {
    setLoading(true);
    try {
      await api.loadSampleData(token);
      await refreshAll();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSampleDataClear() {
    setLoading(true);
    try {
      await api.clearSampleData(token);
      await refreshAll();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  const selectedApplication =
    currentView.type === "application"
      ? applications.find((application) => application.id === currentView.applicationId)
      : null;
  const selectedDashboard = selectedApplication
    ? dashboard.find((entry) => entry.application_id === selectedApplication.id)
    : null;
  const canEditSelected =
    selectedApplication && user && (user.is_admin || selectedApplication.owner_id === user.id);
  const filteredLatestTests = tests
    .filter((test) => {
      const matchesQuery =
        latestTestsQuery.trim() === "" ||
        test.name.toLowerCase().includes(latestTestsQuery.toLowerCase()) ||
        test.endpoint.toLowerCase().includes(latestTestsQuery.toLowerCase());
      const matchesStatus =
        latestTestsStatusFilter === "" || (test.last_result_status || "pending") === latestTestsStatusFilter;
      return matchesQuery && matchesStatus;
    })
    .sort((left, right) => compareValues(left[latestTestsSort.key], right[latestTestsSort.key], latestTestsSort.direction));
  const filteredRecentResults = recentResults
    .filter((result) => {
      const matchesQuery =
        recentResultsQuery.trim() === "" ||
        result.test_name.toLowerCase().includes(recentResultsQuery.toLowerCase()) ||
        result.detail.toLowerCase().includes(recentResultsQuery.toLowerCase());
      const matchesError = recentResultsErrorFilter === "" || result.error_code === recentResultsErrorFilter;
      return matchesQuery && matchesError;
    })
    .sort((left, right) => compareValues(left[recentResultsSort.key], right[recentResultsSort.key], recentResultsSort.direction));

  function toggleSort(sortState, setSortState, key) {
    if (sortState.key === key) {
      setSortState({ key, direction: sortState.direction === "asc" ? "desc" : "asc" });
      return;
    }
    setSortState({ key, direction: "asc" });
  }

  function applyLandingRange(optionValue) {
    const option = landingRangeOptions.find((entry) => entry.value === optionValue);
    if (!option) {
      return;
    }
    const end = new Date();
    const durationMs = option.minutes
      ? option.minutes * 60 * 1000
      : option.hours * 60 * 60 * 1000;
    const start = new Date(end.getTime() - durationMs);
    setLandingWindowHours(optionValue);
    setLandingEndAt(toDateTimeLocalInput(end));
    setLandingStartAt(toDateTimeLocalInput(start));
  }

  function openCreateTestModal() {
    setEditingTestId(null);
    setTestForm(defaultTestForm);
    setShowTestModal(true);
  }

  function openEditTestModal(test) {
    setEditingTestId(test.id);
    setTestForm({
      name: test.name,
      endpoint: test.endpoint,
      method: test.method,
      expected_result: test.expected_result,
      payload: test.payload || "",
      frequency_seconds: test.frequency_seconds,
    });
    setShowTestModal(true);
  }

  if (!token || !user) {
    return (
      <div className="page auth-page">
        <section className="auth-card">
          <p className="eyebrow">Status monitoring, sparse storage</p>
          <h1>StatusCake Home Made</h1>
          <p className="subdued">
            Use the generated admin credentials from backend startup logs, or register a new owner account.
          </p>
          <form onSubmit={submitAuth} className="stack">
            <input
              placeholder="Username"
              value={authForm.username}
              onChange={(event) => setAuthForm({ ...authForm, username: event.target.value })}
            />
            <input
              type="password"
              placeholder="Password"
              value={authForm.password}
              onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })}
            />
            <button disabled={loading} type="submit">
              {authMode === "login" ? "Log In" : "Register"}
            </button>
          </form>
          <button className="ghost-button" onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}>
            {authMode === "login" ? "Need an account?" : "Already registered?"}
          </button>
          {message ? <p className="message error">{message}</p> : null}
        </section>
      </div>
    );
  }

  return (
    <div className="page app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">
            {currentView.type === "landing" ? "Global monitoring view" : "Application control center"}
          </p>
          <h1>
            {currentView.type === "landing"
              ? "Operational health evolves over time"
              : selectedApplication?.name || "Application details"}
          </h1>
          <p className="subdued">
            {currentView.type === "landing"
              ? "Landing stays focused on timelines, summary signals, and cross-application comparison."
              : "Application details, test creation, and failure history live here."}
          </p>
        </div>
        <div className="hero-actions">
          <div className="user-card">
            <span>{user.username}</span>
            <strong>{user.is_admin ? "Admin" : "Owner"}</strong>
          </div>
          {currentView.type === "application" ? (
            <button className="ghost-button" onClick={() => setCurrentView({ type: "landing", applicationId: null })}>
              Back to landing
            </button>
          ) : (
            <button className="ghost-button" onClick={() => setShowApplicationModal(true)}>
              New application
            </button>
          )}
          <button className="ghost-button" onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      {message ? <p className="message error">{message}</p> : null}

      {currentView.type === "landing" ? (
        <main className="grid landing-grid">
          <section className="panel span-3">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Timeline</p>
                <h2>Application evolution</h2>
              </div>
              <div className="filters">
                <select value={landingWindowHours} onChange={(event) => applyLandingRange(event.target.value)}>
                  <option value="">Custom range</option>
                  {landingRangeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  type="datetime-local"
                  value={landingStartAt}
                  onChange={(event) => {
                    setLandingWindowHours("");
                    setLandingStartAt(event.target.value);
                  }}
                />
                <input
                  type="datetime-local"
                  value={landingEndAt}
                  onChange={(event) => {
                    setLandingWindowHours("");
                    setLandingEndAt(event.target.value);
                  }}
                />
                <div className="sample-actions">
                  <button disabled={loading || sampleState.loaded} onClick={handleSampleDataLoad}>
                    {sampleState.loaded ? "Sample data loaded" : "Load sample data"}
                  </button>
                  <button className="ghost-button" disabled={loading || !sampleState.loaded} onClick={handleSampleDataClear}>
                    Clear sample data
                  </button>
                </div>
              </div>
            </div>
            <div className="chart-shell timeline-chart">
              <ResponsiveContainer width="100%" height={380}>
                <LineChart data={globalTimeline}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#294048" />
                  <XAxis dataKey="label" minTickGap={36} stroke="#9ab0b7" />
                  <YAxis domain={[0, 100]} stroke="#9ab0b7" />
                  <Tooltip />
                  {applications.map((application, index) => (
                    <Line
                      key={application.id}
                      type="monotone"
                      dataKey={`app_${application.id}`}
                      stroke={landingPalette[index % landingPalette.length]}
                      strokeWidth={2}
                      dot={({ cx, cy, value }) => (
                        value === null || value === undefined ? null : (
                        <circle
                          cx={cx}
                          cy={cy}
                          r={value === 0 ? 4.5 : 2.5}
                          fill={value === 0 ? "#f05b6e" : landingPalette[index % landingPalette.length]}
                          stroke={value === 0 ? "#ffd0d6" : "none"}
                          strokeWidth={value === 0 ? 2 : 0}
                        />
                        )
                      )}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="panel span-3">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Applications</p>
                <h2>Health score ranking</h2>
              </div>
            </div>
            <div className="table-shell">
              <table className="results-table">
                <thead>
                  <tr>
                    <th>App name</th>
                    <th>Current app score</th>
                    <th>Current health</th>
                    <th>Global score</th>
                    <th>Score trend</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.map((application) => (
                    <tr key={application.application_id}>
                      <td>{application.application_name}</td>
                      <td className={application.healthy_score > 99 ? "good" : "bad"}>
                        {application.healthy_score.toFixed(3)}%
                      </td>
                      <td className={application.current_health > 50 ? "good" : "bad"}>
                        {application.current_health.toFixed(3)}%
                      </td>
                      <td>{application.global_score.toFixed(3)}</td>
                      <td>
                        <span className={`trend trend-${application.score_trend}`}>
                          {application.score_trend === "up" ? "↑ Increasing" : application.score_trend === "down" ? "↓ Decreasing" : "→ Stable"}
                        </span>
                      </td>
                      <td>
                        <div className="inline-actions">
                          <button onClick={() => setCurrentView({ type: "application", applicationId: application.application_id })}>
                            Open application
                          </button>
                          {(user.is_admin || applications.find((item) => item.id === application.application_id)?.owner_id === user.id) ? (
                            <button className="ghost-button" onClick={() => deleteApplication(application.application_id)}>
                              Delete
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      ) : (
        <main className="grid detail-grid">
          <section className="panel detail-summary">
            <p className="eyebrow">Application</p>
            <h2>{selectedApplication?.name}</h2>
            <p className="subdued mono">{selectedApplication?.url}</p>
            <div className="stat-grid">
              <div className="stat-card">
                <span className="subdued">Health score</span>
                <strong className={selectedApplication?.healthy_score > 99 ? "good" : "bad"}>
                  {selectedApplication?.healthy_score?.toFixed(3)}%
                </strong>
              </div>
              <div className="stat-card">
                <span className="subdued">Current health</span>
                <strong className={selectedApplication?.current_health > 50 ? "good" : "bad"}>
                  {selectedApplication?.current_health?.toFixed(3)}%
                </strong>
              </div>
              <div className="stat-card">
                <span className="subdued">Tests</span>
                <strong>{selectedApplication?.tests_count ?? 0}</strong>
              </div>
              <div className="stat-card">
                <span className="subdued">Failures 24h</span>
                <strong>{selectedDashboard?.failures_last_24h ?? 0}</strong>
              </div>
            </div>
          </section>

          <section className="panel span-2">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Historical chart</p>
                <h2>Health and error points</h2>
              </div>
              <div className="filters">
                <select value={windowHours} onChange={(event) => setWindowHours(Number(event.target.value))}>
                  <option value={0.5}>30 minutes</option>
                  <option value={1}>1 hour</option>
                  <option value={6}>6 hours</option>
                  <option value={12}>12 hours</option>
                  <option value={24}>24 hours</option>
                  <option value={72}>72 hours</option>
                  <option value={168}>7 days</option>
                </select>
                <select value={errorCode} onChange={(event) => setErrorCode(event.target.value)}>
                  <option value="">All errors</option>
                  <option value="HTTP_ERROR">HTTP errors</option>
                  <option value="TIMEOUT">Timeouts</option>
                  <option value="BODY_MISMATCH">Body mismatch</option>
                  <option value="REQUEST_ERROR">Request errors</option>
                </select>
              </div>
            </div>
            <div className="chart-shell">
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={applicationHistory}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#294048" />
                  <XAxis dataKey="label" minTickGap={36} stroke="#9ab0b7" />
                  <YAxis domain={[0, 100]} stroke="#9ab0b7" />
                  <YAxis yAxisId="response-time" orientation="right" stroke="#6dd3fb" />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="health"
                    stroke="#2ad28b"
                    strokeWidth={2}
                    dot={({ cx, cy, payload }) => {
                      if (!payload || payload.health === null || payload.health === undefined) {
                        return null;
                      }
                      return (
                        <circle
                          cx={cx}
                          cy={cy}
                          r={payload.healthy ? 3 : 5}
                          fill={payload.healthy ? "#2ad28b" : "#f05b6e"}
                          stroke={payload.healthy ? "none" : "#ffd0d6"}
                          strokeWidth={payload.healthy ? 0 : 2}
                        />
                      );
                    }}
                  />
                  {tests.map((test, index) => (
                    <Line
                      key={test.id}
                      yAxisId="response-time"
                      type="monotone"
                      dataKey={`response_${test.id}`}
                      stroke={testPalette[index % testPalette.length]}
                      strokeWidth={1.5}
                      dot={false}
                      connectNulls={false}
                      name={`${test.name} response time`}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-legend">
              <span className="legend-item">
                <span className="legend-swatch legend-health" />
                Health score
              </span>
              {tests.map((test, index) => (
                <span key={test.id} className="legend-item">
                  <span
                    className="legend-swatch"
                    style={{ background: testPalette[index % testPalette.length] }}
                  />
                  {test.name} response time
                </span>
              ))}
            </div>
          </section>

          <section className="panel span-2">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Latest test results</p>
                <h2>Checks and latest execution snapshot</h2>
              </div>
              {canEditSelected ? <button onClick={openCreateTestModal}>Add test</button> : null}
            </div>
            <div className="filters table-filters">
              <input
                placeholder="Filter by test name or endpoint"
                value={latestTestsQuery}
                onChange={(event) => setLatestTestsQuery(event.target.value)}
              />
              <select value={latestTestsStatusFilter} onChange={(event) => setLatestTestsStatusFilter(event.target.value)}>
                <option value="">All statuses</option>
                <option value="success">Success</option>
                <option value="failure">Failure</option>
                <option value="pending">Pending</option>
              </select>
            </div>
            <div className="table-shell">
              <table className="results-table">
                <thead>
                  <tr>
                    <th>
                      <button className="table-sort" onClick={() => toggleSort(latestTestsSort, setLatestTestsSort, "name")}>Name</button>
                    </th>
                    <th>
                      <button className="table-sort" onClick={() => toggleSort(latestTestsSort, setLatestTestsSort, "endpoint")}>Request</button>
                    </th>
                    <th className="result-column">
                      <button className="table-sort" onClick={() => toggleSort(latestTestsSort, setLatestTestsSort, "last_result_status")}>Latest result</button>
                    </th>
                    <th>
                      <button className="table-sort" onClick={() => toggleSort(latestTestsSort, setLatestTestsSort, "last_response_time_ms")}>Response time</button>
                    </th>
                    <th>
                      <button className="table-sort" onClick={() => toggleSort(latestTestsSort, setLatestTestsSort, "last_checked_at")}>Timestamp</button>
                    </th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLatestTests.map((test) => (
                    <tr key={test.id}>
                      <td>{test.name}</td>
                      <td className="mono">
                        {test.method} {test.endpoint}
                      </td>
                      <td className="result-cell">
                        <span className={test.last_result_status === "success" ? "status-pill good-pill" : "status-pill bad-pill"}>
                          {test.last_result_status || "Pending"}
                        </span>
                        {test.last_error_code ? <span className="table-subdetail">{test.last_error_code}</span> : null}
                        {test.last_result_detail ? <span className="table-subdetail">{test.last_result_detail}</span> : null}
                      </td>
                      <td className="result-cell">
                        <span>{formatResponseTime(test.last_response_time_ms)}</span>
                        {test.previous_response_time_ms !== null && test.previous_response_time_ms !== undefined ? (
                          <span className="table-subdetail">Previous {formatResponseTime(test.previous_response_time_ms)}</span>
                        ) : null}
                        {test.average_response_time_ms !== null && test.average_response_time_ms !== undefined ? (
                          <span className="table-subdetail">Average {formatResponseTime(test.average_response_time_ms)}</span>
                        ) : null}
                      </td>
                      <td>{test.last_checked_at ? new Date(test.last_checked_at).toLocaleString() : "Not checked yet"}</td>
                      <td>
                        {canEditSelected ? (
                          <div className="inline-actions">
                            <button className="ghost-button" onClick={() => openEditTestModal(test)}>
                              Edit
                            </button>
                            <button className="ghost-button" onClick={() => deleteTest(test.id)}>
                              Delete
                            </button>
                          </div>
                        ) : (
                          <span className="subdued">View only</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredLatestTests.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="subdued">No tests match the current filters.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel span-3">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Test results</p>
                <h2>Recent stored failures</h2>
              </div>
            </div>
            <div className="filters table-filters">
              <input
                placeholder="Filter by test name or detail"
                value={recentResultsQuery}
                onChange={(event) => setRecentResultsQuery(event.target.value)}
              />
              <select value={recentResultsErrorFilter} onChange={(event) => setRecentResultsErrorFilter(event.target.value)}>
                <option value="">All error codes</option>
                <option value="HTTP_ERROR">HTTP errors</option>
                <option value="TIMEOUT">Timeouts</option>
                <option value="BODY_MISMATCH">Body mismatch</option>
                <option value="REQUEST_ERROR">Request errors</option>
              </select>
            </div>
            <div className="table-shell">
              <table className="results-table">
                <thead>
                  <tr>
                    <th>
                      <button className="table-sort" onClick={() => toggleSort(recentResultsSort, setRecentResultsSort, "started_at")}>Timestamp</button>
                    </th>
                    <th>
                      <button className="table-sort" onClick={() => toggleSort(recentResultsSort, setRecentResultsSort, "test_name")}>Test</button>
                    </th>
                    <th>
                      <button className="table-sort" onClick={() => toggleSort(recentResultsSort, setRecentResultsSort, "status")}>Status</button>
                    </th>
                    <th>
                      <button className="table-sort" onClick={() => toggleSort(recentResultsSort, setRecentResultsSort, "error_code")}>Error code</button>
                    </th>
                    <th>
                      <button className="table-sort" onClick={() => toggleSort(recentResultsSort, setRecentResultsSort, "http_status_code")}>HTTP code</button>
                    </th>
                    <th>
                      <button className="table-sort" onClick={() => toggleSort(recentResultsSort, setRecentResultsSort, "detail")}>Detail</button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecentResults.map((result) => (
                    <tr key={result.id}>
                      <td>{new Date(result.started_at).toLocaleString()}</td>
                      <td>{result.test_name}</td>
                      <td>
                        <span className="status-pill bad-pill">{result.status}</span>
                      </td>
                      <td>{result.error_code}</td>
                      <td>{result.http_status_code ?? "-"}</td>
                      <td className="result-cell">{result.detail}</td>
                    </tr>
                  ))}
                  {filteredRecentResults.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="subdued">
                        No test results match the current filters.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      )}

      {showApplicationModal ? (
        <div className="modal-backdrop" onClick={() => setShowApplicationModal(false)}>
          <section className="modal-card" onClick={(event) => event.stopPropagation()}>
            <p className="eyebrow">New application</p>
            <h2>Create monitored app</h2>
            <form className="stack" onSubmit={submitApplication}>
              <input
                placeholder="Application name"
                value={applicationForm.name}
                onChange={(event) => setApplicationForm({ ...applicationForm, name: event.target.value })}
              />
              <input
                placeholder="Base URL"
                value={applicationForm.url}
                onChange={(event) => setApplicationForm({ ...applicationForm, url: event.target.value })}
              />
              <div className="modal-actions">
                <button className="ghost-button" type="button" onClick={() => setShowApplicationModal(false)}>
                  Cancel
                </button>
                <button disabled={loading} type="submit">
                  Create application
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {showTestModal ? (
        <div className="modal-backdrop" onClick={() => setShowTestModal(false)}>
          <section className="modal-card" onClick={(event) => event.stopPropagation()}>
            <p className="eyebrow">{editingTestId ? "Edit test" : "New test"}</p>
            <h2>{editingTestId ? "Update application test" : "Create application test"}</h2>
            <form className="stack" onSubmit={submitTest}>
              <label className="field-group">
                <span>Test name</span>
                <small className="field-legend">Human-readable label used to identify this check in the table and charts.</small>
                <input
                  placeholder="Homepage health"
                  value={testForm.name}
                  onChange={(event) => setTestForm({ ...testForm, name: event.target.value })}
                  disabled={!canEditSelected}
                />
              </label>
              <label className="field-group">
                <span>Endpoint</span>
                <small className="field-legend">Relative path or full URL that the checker will call every 30 seconds.</small>
                <input
                  placeholder="/health"
                  value={testForm.endpoint}
                  onChange={(event) => setTestForm({ ...testForm, endpoint: event.target.value })}
                  disabled={!canEditSelected}
                />
              </label>
              <label className="field-group">
                <span>HTTP operation</span>
                <small className="field-legend">Choose `GET` for read-only checks or `POST` when the endpoint expects a body.</small>
                <select
                  value={testForm.method}
                  onChange={(event) => setTestForm({ ...testForm, method: event.target.value })}
                  disabled={!canEditSelected}
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                </select>
              </label>
              <label className="field-group">
                <span>Expected result</span>
                <small className="field-legend">Literal response body expected from the endpoint. Any mismatch is stored as a failure.</small>
                <textarea
                  placeholder="OK"
                  value={testForm.expected_result}
                  onChange={(event) => setTestForm({ ...testForm, expected_result: event.target.value })}
                  disabled={!canEditSelected}
                />
              </label>
              <label className="field-group">
                <span>Payload</span>
                <small className="field-legend">Optional request body sent only when the operation is `POST`.</small>
                <textarea
                  placeholder='{"ping":true}'
                  value={testForm.payload}
                  onChange={(event) => setTestForm({ ...testForm, payload: event.target.value })}
                  disabled={!canEditSelected || testForm.method !== "POST"}
                />
              </label>
              <label className="field-group">
                <span>Frequency in seconds</span>
                <small className="field-legend">Monitoring interval. The minimum allowed check interval is 15 seconds.</small>
                <input
                  type="number"
                  min="15"
                  step="15"
                  value={testForm.frequency_seconds}
                  onChange={(event) => setTestForm({ ...testForm, frequency_seconds: event.target.value })}
                  disabled={!canEditSelected}
                />
              </label>
              <div className="modal-actions">
                <button className="ghost-button" type="button" onClick={() => setShowTestModal(false)}>
                  Cancel
                </button>
                <button disabled={loading || !canEditSelected} type="submit">
                  {editingTestId ? "Save test" : "Create test"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default App;
