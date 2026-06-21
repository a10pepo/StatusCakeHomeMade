import { useEffect, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
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

function formatRangeDateTime(value) {
  if (!value) {
    return "--";
  }
  return new Date(value).toLocaleString([], {
    year: "numeric",
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

function formatElapsedTime(elapsedMs) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function formatPercentage(value) {
  if (value === null || value === undefined) {
    return "--";
  }
  return `${value.toFixed(3)}%`;
}

function buildTestUrl(applicationUrl, endpoint) {
  if (!endpoint) {
    return applicationUrl;
  }
  if (/^https?:\/\//i.test(endpoint)) {
    return endpoint;
  }
  try {
    return new URL(endpoint, `${applicationUrl.replace(/\/+$/, "")}/`).toString();
  } catch {
    return endpoint;
  }
}

function sleep(delayMs) {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
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

function sortDashboardEntries(entries) {
  return [...entries].sort(
    (left, right) =>
      compareValues(left.global_score, right.global_score, "desc") ||
      compareValues(left.healthy_score, right.healthy_score, "desc"),
  );
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
  const [dashboardRange, setDashboardRange] = useState({ startAt: "", endAt: "" });
  const [errorCode, setErrorCode] = useState("");
  const [applicationForm, setApplicationForm] = useState(defaultApplicationForm);
  const [testForm, setTestForm] = useState(defaultTestForm);
  const [editingApplicationId, setEditingApplicationId] = useState(null);
  const [editingTestId, setEditingTestId] = useState(null);
  const [showApplicationModal, setShowApplicationModal] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [latestTestsQuery, setLatestTestsQuery] = useState("");
  const [latestTestsStatusFilter, setLatestTestsStatusFilter] = useState("");
  const [latestTestsSort, setLatestTestsSort] = useState({ key: "last_checked_at", direction: "desc" });
  const [recentResultsQuery, setRecentResultsQuery] = useState("");
  const [recentResultsErrorFilter, setRecentResultsErrorFilter] = useState("");
  const [recentResultsSort, setRecentResultsSort] = useState({ key: "started_at", direction: "desc" });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [landingRequestProgress, setLandingRequestProgress] = useState({
    active: false,
    title: "",
    currentStep: "",
    completedSteps: 0,
    totalSteps: 0,
    startedAt: 0,
  });
  const [landingElapsedMs, setLandingElapsedMs] = useState(0);
  const landingSyncInFlightRef = useRef(false);
  const pendingLandingSyncRef = useRef(null);

  useEffect(() => {
    if (!token) {
      return;
    }
    localStorage.setItem("statuscake-token", token);
    void hydrate(token);
  }, [token]);

  useEffect(() => {
    if (!token || currentView.type !== "application" || !currentView.applicationId) {
      return;
    }
    void loadApplicationContext(currentView.applicationId, windowHours, errorCode);
  }, [token, currentView, windowHours, errorCode]);

  useEffect(() => {
    if (!token || !user || currentView.type !== "landing") {
      return;
    }
    enqueueLandingSync({
      activeToken: token,
      applicationList: applications,
      startAt: landingStartAt,
      endAt: landingEndAt,
      includeDashboard: false,
      includeTimeline: true,
    });
  }, [token, user, currentView.type, applications, landingStartAt, landingEndAt]);

  useEffect(() => {
    if (!landingRequestProgress.active || !landingRequestProgress.startedAt) {
      setLandingElapsedMs(0);
      return undefined;
    }
    setLandingElapsedMs(Date.now() - landingRequestProgress.startedAt);
    const intervalId = window.setInterval(() => {
      setLandingElapsedMs(Date.now() - landingRequestProgress.startedAt);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [landingRequestProgress.active, landingRequestProgress.startedAt]);

  async function loadApplicationConfigs(activeToken) {
    const configs = await api.listApplicationConfigs(activeToken);
    setApplications(configs);
    return configs;
  }

  async function hydrate(activeToken) {
    try {
      setLoading(true);
      const [me] = await Promise.all([
        api.me(activeToken),
        loadApplicationConfigs(activeToken),
      ]);
      setUser(me);
      setMessage("");
    } catch (error) {
      setMessage(error.message);
      if (error.status === 401) {
        logout();
      }
    } finally {
      setLoading(false);
    }
  }

  function buildLandingSyncJob(job) {
    return {
      activeToken: job.activeToken ?? token,
      applicationList: job.applicationList ?? applications,
      startAt: job.startAt ?? landingStartAt,
      endAt: job.endAt ?? landingEndAt,
      includeDashboard: Boolean(job.includeDashboard),
      includeTimeline: Boolean(job.includeTimeline),
    };
  }

  function mergeLandingSyncJobs(currentJob, nextJob) {
    if (!currentJob) {
      return nextJob;
    }
    return {
      ...currentJob,
      ...nextJob,
      includeDashboard: currentJob.includeDashboard || nextJob.includeDashboard,
      includeTimeline: currentJob.includeTimeline || nextJob.includeTimeline,
    };
  }

  function updateLandingRequestProgress(progress) {
    setLandingRequestProgress((current) => ({
      ...current,
      ...progress,
    }));
  }

  function enqueueLandingSync(job) {
    const normalizedJob = buildLandingSyncJob(job);
    const totalSteps =
      (normalizedJob.includeDashboard ? normalizedJob.applicationList.length : 0) +
      (normalizedJob.includeTimeline ? normalizedJob.applicationList.length : 0);

    if (totalSteps === 0) {
      if (normalizedJob.includeDashboard) {
        setDashboard([]);
        setDashboardRange({ startAt: normalizedJob.startAt, endAt: normalizedJob.endAt });
      }
      if (normalizedJob.includeTimeline) {
        setGlobalTimeline([]);
      }
      return;
    }

    pendingLandingSyncRef.current = mergeLandingSyncJobs(pendingLandingSyncRef.current, normalizedJob);
    if (!landingSyncInFlightRef.current) {
      void drainLandingSyncQueue();
    }
  }

  async function drainLandingSyncQueue() {
    if (landingSyncInFlightRef.current) {
      return;
    }

    landingSyncInFlightRef.current = true;
    try {
      while (pendingLandingSyncRef.current) {
        const job = pendingLandingSyncRef.current;
        pendingLandingSyncRef.current = null;
        await runLandingSync(job);
      }
    } finally {
      landingSyncInFlightRef.current = false;
      setLandingRequestProgress({
        active: false,
        title: "",
        currentStep: "",
        completedSteps: 0,
        totalSteps: 0,
        startedAt: 0,
      });
      setLandingElapsedMs(0);
      setLoading(false);
      setHealthLoading(false);
    }
  }

  async function runLandingSync(job) {
    const totalSteps =
      (job.includeDashboard ? job.applicationList.length : 0) +
      (job.includeTimeline ? job.applicationList.length : 0);
    let completedSteps = 0;
    const historiesByApplication = {};
    const progressTitle =
      job.includeDashboard && job.includeTimeline
        ? "Refreshing landing data"
        : job.includeDashboard
          ? "Refreshing health ranking"
          : "Refreshing application timeline";

    setLoading(job.includeTimeline);
    setHealthLoading(job.includeDashboard);
    setLandingRequestProgress({
      active: true,
      title: progressTitle,
      currentStep: totalSteps > 0 ? "Preparing requests" : "",
      completedSteps: 0,
      totalSteps,
      startedAt: Date.now(),
    });

    try {
      setMessage("");

      if (job.includeDashboard) {
        const dashboardById = new Map(
          dashboardRange.startAt === job.startAt && dashboardRange.endAt === job.endAt
            ? dashboard.map((entry) => [entry.application_id, entry])
            : [],
        );

        if (job.applicationList.length === 0) {
          setDashboard([]);
          setDashboardRange({ startAt: job.startAt, endAt: job.endAt });
        } else {
          for (const [index, application] of job.applicationList.entries()) {
            updateLandingRequestProgress({
              currentStep: `Loading health ${index + 1}/${job.applicationList.length}: ${application.name}`,
            });
            const dashboardEntry = await api.dashboardApplication(
              job.activeToken,
              application.id,
              job.startAt,
              job.endAt,
            );
            dashboardById.set(application.id, dashboardEntry);
            setDashboard(sortDashboardEntries([...dashboardById.values()]));
            setDashboardRange({ startAt: job.startAt, endAt: job.endAt });
            completedSteps += 1;
            updateLandingRequestProgress({ completedSteps });
            if (index < job.applicationList.length - 1) {
              await sleep(300);
            }
          }
        }
      }

      if (job.includeTimeline) {
        if (job.applicationList.length === 0) {
          setGlobalTimeline([]);
        } else {
          for (const [index, application] of job.applicationList.entries()) {
            updateLandingRequestProgress({
              currentStep: `Loading timeline ${index + 1}/${job.applicationList.length}: ${application.name}`,
            });
            historiesByApplication[application.id] = await api.historyRange(
              job.activeToken,
              application.id,
              job.startAt,
              job.endAt,
              "",
            );
            completedSteps += 1;
            updateLandingRequestProgress({ completedSteps });
            if (index < job.applicationList.length - 1) {
              await sleep(300);
            }
          }
          setGlobalTimeline(buildGlobalTimeline(job.applicationList, historiesByApplication));
        }
      }
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
      setHealthLoading(false);
    }
  }

  async function refreshLanding(startAt = landingStartAt, endAt = landingEndAt) {
    enqueueLandingSync({
      activeToken: token,
      applicationList: applications,
      startAt,
      endAt,
      includeDashboard: false,
      includeTimeline: true,
    });
  }

  async function refreshLandingHealth(startAt = landingStartAt, endAt = landingEndAt) {
    enqueueLandingSync({
      activeToken: token,
      applicationList: applications,
      startAt,
      endAt,
      includeDashboard: true,
      includeTimeline: false,
    });
  }

  async function refreshApplicationView(applicationId, withLoader = true) {
    try {
      if (withLoader) {
        setLoading(true);
      }
      await loadApplicationConfigs(token);
      const [testList, historySeries, results] = await Promise.all([
        api.listTests(token, applicationId),
        api.history(token, applicationId, windowHours, errorCode),
        api.results(token, applicationId),
      ]);
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

  async function loadApplicationContext(applicationId, currentWindowHours, currentErrorCode) {
    try {
      setLoading(true);
      const [testList, historySeries, results] = await Promise.all([
        api.listTests(token, applicationId),
        api.history(token, applicationId, currentWindowHours, currentErrorCode),
        api.results(token, applicationId),
      ]);
      setTests(testList);
      setApplicationHistory(buildApplicationTimeline(historySeries, testList));
      setRecentResults(results);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
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
    setDashboardRange({ startAt: "", endAt: "" });
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
    const appConfigs = await loadApplicationConfigs(token);
    setDashboard([]);
    if (currentView.type === "landing") {
      enqueueLandingSync({
        activeToken: token,
        applicationList: appConfigs,
        startAt: landingStartAt,
        endAt: landingEndAt,
        includeDashboard: false,
        includeTimeline: true,
      });
    }
    if (currentView.type === "application" && currentView.applicationId) {
      await refreshApplicationView(currentView.applicationId, false);
    }
  }

  async function submitApplication(event) {
    event.preventDefault();
    try {
      setLoading(true);
      if (editingApplicationId) {
        const applicationId = editingApplicationId;
        await api.updateApplication(token, applicationId, applicationForm);
        setEditingApplicationId(null);
        setApplicationForm(defaultApplicationForm);
        setShowApplicationModal(false);
        await refreshAll();
        setCurrentView({ type: "application", applicationId });
      } else {
        const created = await api.createApplication(token, applicationForm);
        setApplicationForm(defaultApplicationForm);
        setShowApplicationModal(false);
        await refreshAll();
        setCurrentView({ type: "application", applicationId: created.id });
      }
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

  async function resetGlobalScore(applicationId) {
    try {
      setLoading(true);
      await api.resetGlobalScore(token, applicationId);
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
  const dashboardByApplicationId = new Map(
    dashboard.map((entry) => [entry.application_id, entry]),
  );
  const landingApplications = applications.map((application) => ({
    application,
    health: dashboardByApplicationId.get(application.id) || null,
  }));
  const selectedDashboard = selectedApplication
    ? dashboardByApplicationId.get(selectedApplication.id)
    : null;
  const isHealthRangeStale =
    Boolean(dashboardRange.startAt && dashboardRange.endAt) &&
    (dashboardRange.startAt !== landingStartAt || dashboardRange.endAt !== landingEndAt);
  const landingProgressPercent =
    landingRequestProgress.totalSteps > 0
      ? Math.min(100, (landingRequestProgress.completedSteps / landingRequestProgress.totalSteps) * 100)
      : 0;
  const landingTimelineChartKey = [
    landingStartAt,
    landingEndAt,
    globalTimeline[0]?.timestamp ?? "empty",
    globalTimeline[globalTimeline.length - 1]?.timestamp ?? "empty",
    globalTimeline.length,
  ].join(":");
  const applicationTimelineChartKey = [
    currentView.applicationId ?? "none",
    windowHours,
    errorCode || "all",
    applicationHistory[0]?.timestamp ?? "empty",
    applicationHistory[applicationHistory.length - 1]?.timestamp ?? "empty",
    applicationHistory.length,
  ].join(":");
  const selectedHealthScore = selectedDashboard?.healthy_score;
  const selectedCurrentHealth = selectedDashboard?.current_health;
  const isReadonlyUser = user?.role === "readonly";
  const canManageProjects = user && (user.is_admin || user.role === "owner");
  const canManageSelected =
    selectedApplication && user && (user.is_admin || (user.role === "owner" && selectedApplication.owner_id === user.id));
  const canEditSelected = selectedApplication && user && (isReadonlyUser || canManageSelected);
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

  function openCreateApplicationModal() {
    setEditingApplicationId(null);
    setApplicationForm(defaultApplicationForm);
    setShowApplicationModal(true);
  }

  function openEditApplicationModal() {
    if (!selectedApplication) {
      return;
    }
    setEditingApplicationId(selectedApplication.id);
    setApplicationForm({
      name: selectedApplication.name,
      url: selectedApplication.url,
    });
    setShowApplicationModal(true);
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

  if (!token) {
    return (
      <div className="page auth-page">
        <section className="auth-card">
          <p className="eyebrow">Status monitoring, sparse storage</p>
          <h1>StatusCake Home Made</h1>
          <p className="subdued">
            Use the backend credentials from startup logs or deployment configuration, or register a new owner account.
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
            <span>{user?.username || "Signed in"}</span>
            <strong>{user ? (user.is_admin ? "Admin" : user.role === "readonly" ? "Readonly" : "Owner") : "Session active"}</strong>
          </div>
          {currentView.type === "application" ? (
            <button className="ghost-button" onClick={() => setCurrentView({ type: "landing", applicationId: null })}>
              Back to landing
            </button>
          ) : (
            canManageProjects ? <button className="ghost-button" onClick={openCreateApplicationModal}>
              New application
            </button> : null
          )}
          <button className="ghost-button" onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      {message ? <p className="message error">{message}</p> : null}

      {currentView.type === "landing" && landingRequestProgress.active ? (
        <section className="request-progress" aria-live="polite">
          <div className="request-progress-copy">
            <strong>{landingRequestProgress.title}</strong>
            <span>
              {landingRequestProgress.completedSteps}/{landingRequestProgress.totalSteps} requests completed
            </span>
            <span>{formatElapsedTime(landingElapsedMs)} elapsed</span>
          </div>
          <p className="subdued request-progress-step">{landingRequestProgress.currentStep}</p>
          <div className="request-progress-track" role="progressbar" aria-valuenow={landingProgressPercent} aria-valuemin="0" aria-valuemax="100">
            <span className="request-progress-fill" style={{ width: `${landingProgressPercent}%` }} />
          </div>
        </section>
      ) : null}

      {currentView.type === "landing" ? (
        <main className="grid landing-grid">
          <section className="panel span-3">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Timeline</p>
                <h2>Application evolution</h2>
              </div>
              <div className="filters">
                <button className="ghost-button" disabled={loading || landingRequestProgress.active} onClick={() => void refreshLanding()}>
                  Refresh chart
                </button>
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
              </div>
            </div>
            <div className="chart-shell timeline-chart">
              <ResponsiveContainer width="100%" height={380}>
                <LineChart key={landingTimelineChartKey} data={globalTimeline}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#294048" />
                  <XAxis dataKey="label" minTickGap={36} stroke="#9ab0b7" />
                  <YAxis domain={[0, 100]} stroke="#9ab0b7" />
                  <Tooltip formatter={(value) => formatPercentage(value)} />
                  <Legend />
                  {applications.map((application, index) => (
                    <Line
                      key={application.id}
                      name={application.name}
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
                <p className="subdued panel-meta">
                  Calculated from {formatRangeDateTime(dashboardRange.startAt)} to {formatRangeDateTime(dashboardRange.endAt)}
                </p>
                {isHealthRangeStale ? (
                  <p className="panel-meta panel-meta-alert">
                    Top range changed. Refresh health to realign this ranking.
                  </p>
                ) : null}
              </div>
              <div className="filters">
                <button className="ghost-button" disabled={healthLoading} onClick={() => void refreshLandingHealth()}>
                  {healthLoading ? "Refreshing health..." : "Refresh health"}
                </button>
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
                  {landingApplications.map(({ application, health }) => (
                    <tr key={application.id}>
                      <td>{application.name}</td>
                      <td className={health ? (health.healthy_score > 99 ? "good" : "bad") : ""}>
                        {health ? `${health.healthy_score.toFixed(3)}%` : "--"}
                      </td>
                      <td className={health ? (health.current_health > 50 ? "good" : "bad") : ""}>
                        {health ? `${health.current_health.toFixed(3)}%` : "--"}
                      </td>
                      <td>{health ? health.global_score.toFixed(3) : "--"}</td>
                      <td>
                        {health ? (
                          <span className={`trend trend-${health.score_trend}`}>
                            {health.score_trend === "up" ? "↑ Increasing" : health.score_trend === "down" ? "↓ Decreasing" : "→ Stable"}
                          </span>
                        ) : (
                          <span className="subdued">Click refresh health</span>
                        )}
                      </td>
                      <td>
                        <div className="inline-actions">
                          <button onClick={() => setCurrentView({ type: "application", applicationId: application.id })}>
                            Open application
                          </button>
                          {(user.is_admin || (user.role === "owner" && application.owner_id === user.id)) ? (
                            <button className="ghost-button" onClick={() => deleteApplication(application.id)}>
                              Delete
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {landingApplications.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="subdued">No applications configured.</td>
                    </tr>
                  ) : null}
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
            {canEditSelected ? (
              <div className="inline-actions">
                <button className="ghost-button" onClick={openEditApplicationModal}>
                  {isReadonlyUser ? "Update host" : "Edit application"}
                </button>
                {user?.is_admin ? (
                  <button
                    className="ghost-button"
                    disabled={loading}
                    onClick={() => resetGlobalScore(selectedApplication.id)}
                  >
                    Reset global score to 999
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="stat-grid">
              <div className="stat-card">
                <span className="subdued">Health score</span>
                <strong className={selectedHealthScore > 99 ? "good" : "bad"}>
                  {formatPercentage(selectedHealthScore)}
                </strong>
              </div>
              <div className="stat-card">
                <span className="subdued">Current health</span>
                <strong className={selectedCurrentHealth > 50 ? "good" : "bad"}>
                  {formatPercentage(selectedCurrentHealth)}
                </strong>
              </div>
              <div className="stat-card">
                <span className="subdued">Global score</span>
                <strong>{selectedDashboard?.global_score?.toFixed(3) ?? "999.000"}</strong>
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
                <button
                  className="ghost-button"
                  disabled={loading}
                  onClick={() => void refreshApplicationView(currentView.applicationId)}
                >
                  Refresh chart
                </button>
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
                <LineChart key={applicationTimelineChartKey} data={applicationHistory}>
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
              {canManageSelected ? <button onClick={openCreateTestModal}>Add test</button> : null}
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
                            <a
                              className="ghost-button"
                              href={buildTestUrl(selectedApplication?.url || "", test.endpoint)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open
                            </a>
                            <button className="ghost-button" onClick={() => openEditTestModal(test)}>
                              Edit
                            </button>
                            {canManageSelected ? (
                              <button className="ghost-button" onClick={() => deleteTest(test.id)}>
                                Delete
                              </button>
                            ) : null}
                          </div>
                        ) : (
                          <span className="subdued">View only</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredLatestTests.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="subdued">No tests match the current filters.</td>
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
        <div className="modal-backdrop" onClick={() => {
          setShowApplicationModal(false);
          setEditingApplicationId(null);
          setApplicationForm(defaultApplicationForm);
        }}>
          <section className="modal-card" onClick={(event) => event.stopPropagation()}>
            <p className="eyebrow">{editingApplicationId ? (isReadonlyUser ? "Update host" : "Edit application") : "New application"}</p>
            <h2>{editingApplicationId ? (isReadonlyUser ? "Update application host" : "Edit monitored app") : "Create monitored app"}</h2>
            <form className="stack" onSubmit={submitApplication}>
              <input
                placeholder="Application name"
                value={applicationForm.name}
                onChange={(event) => setApplicationForm({ ...applicationForm, name: event.target.value })}
                disabled={isReadonlyUser && Boolean(editingApplicationId)}
              />
              <input
                placeholder="Base URL"
                value={applicationForm.url}
                onChange={(event) => setApplicationForm({ ...applicationForm, url: event.target.value })}
              />
              <div className="modal-actions">
                <button className="ghost-button" type="button" onClick={() => {
                  setShowApplicationModal(false);
                  setEditingApplicationId(null);
                  setApplicationForm(defaultApplicationForm);
                }}>
                  Cancel
                </button>
                <button disabled={loading} type="submit">
                  {editingApplicationId ? "Save application" : "Create application"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {showTestModal ? (
        <div className="modal-backdrop" onClick={() => {
          setShowTestModal(false);
          setEditingTestId(null);
          setTestForm(defaultTestForm);
        }}>
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
                  disabled={!canEditSelected || isReadonlyUser}
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
                  disabled={!canEditSelected || isReadonlyUser}
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
                  disabled={!canEditSelected || isReadonlyUser || testForm.method !== "POST"}
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
                  disabled={!canEditSelected || isReadonlyUser}
                />
              </label>
              <div className="modal-actions">
                <button className="ghost-button" type="button" onClick={() => {
                  setShowTestModal(false);
                  setEditingTestId(null);
                  setTestForm(defaultTestForm);
                }}>
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
