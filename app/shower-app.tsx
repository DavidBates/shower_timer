"use client";

import { createClient } from "@supabase/supabase-js";
import {
  Award,
  BarChart3,
  Check,
  CircleStop,
  ClipboardCheck,
  Clock,
  Clapperboard,
  Mars,
  Monitor,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShowerHead,
  Timer,
  Trash2,
  UserRoundCheck,
  Users,
  Venus,
  Wifi,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_SECONDS = 6 * 60;
const WARNING_SECONDS = 60;
const MONITOR_NUMBERS = [1, 2, 3] as const;
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error(
    "Missing Supabase configuration. Please set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY environment variables."
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  realtime: {
    params: {
      eventsPerSecond: 8,
    },
  },
});

type ParticipantType = "boy" | "girl" | "adult_chaperone";
type MonitorNumber = (typeof MONITOR_NUMBERS)[number];
type ViewMode = "timers" | "admin" | "report";
type TimerStatus = "idle" | "active" | "paused" | "warning" | "expired";
type SessionStatus = "active" | "completed" | "replaced" | "cleared";

type Workgroup = {
  id: string;
  sort_order: number;
  name: string;
  created_at: string;
  updated_at: string;
};

type ShowerTimer = {
  id: string;
  monitor_number: number;
  card_number: number;
  label: string;
  workgroup_id: string | null;
  participant_type: ParticipantType | null;
  duration_seconds: number;
  remaining_seconds: number;
  running: boolean;
  started_at: string | null;
  active_session_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type ShowerSession = {
  id: string;
  timer_id: string | null;
  monitor_number: number;
  card_number: number;
  workgroup_id: string;
  participant_type: ParticipantType;
  duration_seconds: number;
  started_at: string;
  completed_at: string | null;
  status: SessionStatus;
  created_at: string;
  day_id: string | null;
};

type ShowerDay = {
  id: string;
  name: string;
  created_at: string;
};

type GroupStat = {
  started: number;
  completed: number;
  active: number;
  boy: number;
  girl: number;
  adult_chaperone: number;
  lastStarted: string | null;
  totalActualSeconds: number;
};

type Summary = {
  active: number;
  warning: number;
  expired: number;
  paused: number;
  idle: number;
  nextTimer?: ShowerTimer;
  groupsLogged: number;
  completedSessions: number;
  activeSessions: number;
};

const participantLabels: Record<ParticipantType, string> = {
  boy: "Boy",
  girl: "Girl",
  adult_chaperone: "Adult chaperone",
};

const participantIcons: Record<ParticipantType, LucideIcon> = {
  boy: Mars,
  girl: Venus,
  adult_chaperone: UserRoundCheck,
};

const statusOrder: Record<TimerStatus, number> = {
  expired: 0,
  warning: 1,
  active: 2,
  paused: 3,
  idle: 4,
};

function stripEmoji(text: string) {
  // Keep only letters, numbers, whitespace, and common punctuation — drops all emoji/symbols
  return text.replace(/[^\p{L}\p{N}\s'.,!?:;-]/gu, "").replace(/\s+/g, " ").trim();
}

function formatTime(seconds: number) {
  const negative = seconds < 0;
  const abs = Math.abs(Math.floor(seconds));
  const minutes = Math.floor(abs / 60);
  const remainder = abs % 60;
  return `${negative ? "-" : ""}${minutes}:${String(remainder).padStart(2, "0")}`;
}

function formatClock(value: string | null) {
  if (!value) return "None";

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function minutesToSeconds(value: string) {
  const minutes = Number(value);

  if (!Number.isFinite(minutes) || minutes <= 0) {
    return DEFAULT_SECONDS;
  }

  return Math.min(60 * 60, Math.max(60, Math.round(minutes * 60)));
}

function secondsToMinutesInput(seconds: number) {
  return String(Math.max(1, Math.round(seconds / 60)));
}

function getRemaining(timer: ShowerTimer, nowMs: number) {
  if (!timer.running || !timer.started_at) {
    return timer.remaining_seconds;
  }

  const elapsed = Math.floor((nowMs - new Date(timer.started_at).getTime()) / 1000);
  return timer.remaining_seconds - elapsed;
}

function getTimerStatus(timer: ShowerTimer, nowMs: number): TimerStatus {
  const remaining = getRemaining(timer, nowMs);

  if (!timer.workgroup_id && !timer.running) return "idle";
  if (remaining <= 0) return "expired";
  if (remaining <= WARNING_SECONDS) return "warning";
  if (timer.running) return "active";
  return "paused";
}

function makeTimerLabel(timer: ShowerTimer, workgroup: Workgroup | undefined) {
  if (!timer.workgroup_id || !timer.participant_type) return "Available";
  return `${workgroup?.name ?? "Crew"} - ${participantLabels[timer.participant_type]}`;
}

function emptyGroupStat(): GroupStat {
  return {
    started: 0,
    completed: 0,
    active: 0,
    boy: 0,
    girl: 0,
    adult_chaperone: 0,
    lastStarted: null,
    totalActualSeconds: 0,
  };
}

function coerceMonitor(value: string | number | null): MonitorNumber | null {
  const monitor = Number(value);
  return MONITOR_NUMBERS.includes(monitor as MonitorNumber)
    ? (monitor as MonitorNumber)
    : null;
}

function getInitialView(): ViewMode {
  if (typeof window === "undefined") return "timers";
  const params = new URL(window.location.href).searchParams;
  if (params.has("admin")) return "admin";
  if (params.has("report")) return "report";
  return "timers";
}


function getInitialMonitor(): MonitorNumber {
  if (typeof window === "undefined") return 1;

  const urlMonitor = coerceMonitor(
    new URL(window.location.href).searchParams.get("monitor"),
  );
  if (urlMonitor) return urlMonitor;

  return coerceMonitor(window.localStorage.getItem("shower-monitor")) ?? 1;
}

function buildSummary(
  timers: ShowerTimer[],
  groupStats: Map<string, GroupStat>,
  sessions: ShowerSession[],
  nowMs: number,
): Summary {
  const counts = {
    active: 0,
    warning: 0,
    expired: 0,
    paused: 0,
    idle: 0,
  };

  for (const timer of timers) {
    counts[getTimerStatus(timer, nowMs)] += 1;
  }

  const activeTimers = timers.filter(
    (timer) => timer.running && getRemaining(timer, nowMs) > 0,
  );
  const nextTimer = activeTimers.sort(
    (a, b) => getRemaining(a, nowMs) - getRemaining(b, nowMs),
  )[0];

  return {
    ...counts,
    nextTimer,
    groupsLogged: [...groupStats.values()].filter((stat) => stat.started > 0)
      .length,
    completedSessions: sessions.filter((session) => session.status === "completed")
      .length,
    activeSessions: sessions.filter((session) => session.status === "active")
      .length,
  };
}

export default function ShowerApp() {
  const [view, setView] = useState<ViewMode>(getInitialView);
  const [selectedMonitor, setSelectedMonitor] = useState<MonitorNumber>(
    getInitialMonitor,
  );
  const [workgroups, setWorkgroups] = useState<Workgroup[]>([]);
  const [timers, setTimers] = useState<ShowerTimer[]>([]);
  const [sessions, setSessions] = useState<ShowerSession[]>([]);
  const [days, setDays] = useState<ShowerDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [savingId, setSavingId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [nextTarget, setNextTarget] = useState<ShowerTimer | null>(null);
  const [editTarget, setEditTarget] = useState<ShowerTimer | null>(null);
  const [groupDrafts, setGroupDrafts] = useState<Record<string, string>>({});

  const workgroupById = useMemo(() => {
    return new Map(workgroups.map((workgroup) => [workgroup.id, workgroup]));
  }, [workgroups]);

  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);

    const [workgroupResult, timerResult, sessionResult, dayResult] = await Promise.all([
      supabase.from("workgroups").select("*").order("sort_order"),
      supabase
        .from("shower_timers")
        .select("*")
        .order("monitor_number", { ascending: true })
        .order("card_number", { ascending: true }),
      supabase
        .from("shower_sessions")
        .select("*")
        .neq("status", "cleared")
        .order("started_at", { ascending: false })
        .limit(3000),
      supabase.from("shower_days").select("*").order("created_at", { ascending: true }),
    ]);

    const nextError =
      workgroupResult.error ?? timerResult.error ?? sessionResult.error ?? dayResult.error;

    if (nextError) {
      setError(nextError.message);
      setLoading(false);
      return;
    }

    setWorkgroups((workgroupResult.data ?? []) as Workgroup[]);
    setTimers((timerResult.data ?? []) as ShowerTimer[]);
    setSessions((sessionResult.data ?? []) as ShowerSession[]);
    setDays((dayResult.data ?? []) as ShowerDay[]);
    setLastSynced(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("admin");
    url.searchParams.delete("report");
    if (view === "admin") url.searchParams.set("admin", "");
    else if (view === "report") url.searchParams.set("report", "");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [view]);

  useEffect(() => {
    window.localStorage.setItem("shower-monitor", String(selectedMonitor));

    const url = new URL(window.location.href);
    if (url.searchParams.get("monitor") !== String(selectedMonitor)) {
      url.searchParams.set("monitor", String(selectedMonitor));
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, [selectedMonitor]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadData(), 0);

    const channel = supabase
      .channel("shower-tracking")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "workgroups" },
        () => void loadData(true),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shower_timers" },
        () => void loadData(true),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shower_sessions" },
        () => void loadData(true),
      )
      .subscribe((status) => {
        setIsLive(status === "SUBSCRIBED");
      });

    return () => {
      window.clearTimeout(initialLoad);
      void supabase.removeChannel(channel);
    };
  }, [loadData]);

  const groupStats = useMemo(() => {
    const stats = new Map<string, GroupStat>();

    for (const workgroup of workgroups) {
      stats.set(workgroup.id, emptyGroupStat());
    }

    for (const session of sessions) {
      const stat = stats.get(session.workgroup_id) ?? emptyGroupStat();
      stat.started += 1;
      stat[session.participant_type] += 1;

      if (session.status === "active") stat.active += 1;
      if (session.status === "completed") {
        stat.completed += 1;
        if (session.completed_at) {
          stat.totalActualSeconds += Math.round(
            (new Date(session.completed_at).getTime() - new Date(session.started_at).getTime()) / 1000,
          );
        }
      }
      if (!stat.lastStarted || session.started_at > stat.lastStarted) {
        stat.lastStarted = session.started_at;
      }

      stats.set(session.workgroup_id, stat);
    }

    return stats;
  }, [sessions, workgroups]);

  const visibleTimers = useMemo(() => {
    return timers.filter((timer) => timer.monitor_number === selectedMonitor);
  }, [selectedMonitor, timers]);

  const monitorCardCounts = useMemo(() => {
    return Object.fromEntries(
      MONITOR_NUMBERS.map((monitorNumber) => [
        monitorNumber,
        timers.filter((timer) => timer.monitor_number === monitorNumber).length,
      ]),
    ) as Record<MonitorNumber, number>;
  }, [timers]);

  const sortedTimers = useMemo(() => {
    return [...visibleTimers].sort((a, b) => {
      const aStatus = getTimerStatus(a, nowMs);
      const bStatus = getTimerStatus(b, nowMs);
      const byStatus = statusOrder[aStatus] - statusOrder[bStatus];

      if (byStatus !== 0) return byStatus;
      if (aStatus !== "idle") return getRemaining(a, nowMs) - getRemaining(b, nowMs);
      return a.card_number - b.card_number;
    });
  }, [nowMs, visibleTimers]);

  const visibleSummary = useMemo(() => {
    return buildSummary(visibleTimers, groupStats, sessions, nowMs);
  }, [groupStats, nowMs, sessions, visibleTimers]);

  const currentDayId = days.length > 0 ? days[days.length - 1].id : null;
  const currentDayName = days.length > 0 ? days[days.length - 1].name : null;

  const currentDaySessions = useMemo(() => {
    if (!currentDayId) return sessions;
    return sessions.filter((s) => s.day_id === currentDayId);
  }, [sessions, currentDayId]);

  const currentDayGroupStats = useMemo(() => {
    const stats = new Map<string, GroupStat>();
    for (const workgroup of workgroups) stats.set(workgroup.id, emptyGroupStat());
    for (const session of currentDaySessions) {
      const stat = stats.get(session.workgroup_id) ?? emptyGroupStat();
      stat.started += 1;
      stat[session.participant_type] += 1;
      if (session.status === "active") stat.active += 1;
      if (session.status === "completed") {
        stat.completed += 1;
        if (session.completed_at) {
          stat.totalActualSeconds += Math.round(
            (new Date(session.completed_at).getTime() - new Date(session.started_at).getTime()) / 1000,
          );
        }
      }
      if (!stat.lastStarted || session.started_at > stat.lastStarted) {
        stat.lastStarted = session.started_at;
      }
      stats.set(session.workgroup_id, stat);
    }
    return stats;
  }, [currentDaySessions, workgroups]);

  const currentDaySummary = useMemo(() => {
    return buildSummary(timers, currentDayGroupStats, currentDaySessions, nowMs);
  }, [timers, currentDayGroupStats, currentDaySessions, nowMs]);

  async function startNewDay() {
    const nextName = `Day ${days.length + 1}`;
    if (
      !window.confirm(
        `Start ${nextName}? This will reset all timer cards. Session history is kept and will appear under "${days.length > 0 ? days[days.length - 1].name : "the current day"}" in the report.`,
      )
    ) return;

    setBusyAction("new-day");
    setError(null);

    try {
      const timestamp = new Date().toISOString();

      // Create the new day record
      const { data: newDay, error: dayError } = await supabase
        .from("shower_days")
        .insert({ name: nextName })
        .select("id")
        .single();

      if (dayError) throw dayError;

      // Clear any still-active sessions
      const activeSessions = sessions.filter((s) => s.status === "active");
      if (activeSessions.length > 0) {
        const { error: clearError } = await supabase
          .from("shower_sessions")
          .update({ completed_at: timestamp, status: "cleared" })
          .in("id", activeSessions.map((s) => s.id));
        if (clearError) throw clearError;
      }

      // Reset all timer cards
      if (timers.length > 0) {
        const results = await Promise.all(
          timers.map((timer) =>
            supabase
              .from("shower_timers")
              .update({
                label: "Available",
                workgroup_id: null,
                participant_type: null,
                remaining_seconds: timer.duration_seconds,
                running: false,
                started_at: null,
                active_session_id: null,
                updated_at: timestamp,
              })
              .eq("id", timer.id),
          ),
        );
        const updateError = results.find((r) => r.error)?.error;
        if (updateError) throw updateError;
      }

      // Suppress unused-variable warning — newDay.id is the next currentDayId
      void newDay;

      await loadData(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start new day.");
    } finally {
      setBusyAction(null);
    }
  }

  async function finishSession(timer: ShowerTimer, status: SessionStatus) {
    if (!timer.active_session_id) return;

    const { error: finishError } = await supabase
      .from("shower_sessions")
      .update({
        completed_at: new Date().toISOString(),
        status,
      })
      .eq("id", timer.active_session_id);

    if (finishError) throw finishError;
  }

  async function startNextKid(
    timer: ShowerTimer,
    workgroupId: string,
    participantType: ParticipantType,
    minutes: string,
  ) {
    const durationSeconds = minutesToSeconds(minutes);
    const workgroup = workgroupById.get(workgroupId);
    const timestamp = new Date().toISOString();

    setSavingId(timer.id);
    setError(null);

    try {
      await finishSession(timer, "completed");

      const { data: session, error: sessionError } = await supabase
        .from("shower_sessions")
        .insert({
          timer_id: timer.id,
          monitor_number: timer.monitor_number,
          card_number: timer.card_number,
          workgroup_id: workgroupId,
          participant_type: participantType,
          duration_seconds: durationSeconds,
          started_at: timestamp,
          status: "active",
          day_id: currentDayId,
        })
        .select("id")
        .single();

      if (sessionError) throw sessionError;

      const { error: timerError } = await supabase
        .from("shower_timers")
        .update({
          label: `${workgroup?.name ?? "Crew"} - ${participantLabels[participantType]}`,
          workgroup_id: workgroupId,
          participant_type: participantType,
          duration_seconds: durationSeconds,
          remaining_seconds: durationSeconds,
          running: true,
          started_at: timestamp,
          active_session_id: session.id,
          updated_at: timestamp,
        })
        .eq("id", timer.id);

      if (timerError) throw timerError;
      setNextTarget(null);
      await loadData(true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to start timer.");
    } finally {
      setSavingId(null);
    }
  }

  async function stopTimer(timer: ShowerTimer) {
    const timestamp = new Date().toISOString();
    const remaining = Math.max(0, getRemaining(timer, nowMs)); // DB requires remaining_seconds >= 0
    setSavingId(timer.id);
    setError(null);
    try {
      await finishSession(timer, "completed");
      const { error: timerError } = await supabase
        .from("shower_timers")
        .update({
          remaining_seconds: remaining,
          running: false,
          started_at: null,
          active_session_id: null,
          updated_at: timestamp,
        })
        .eq("id", timer.id);
      if (timerError) throw timerError;
      await loadData(true);
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : "Unable to stop timer.");
    } finally {
      setSavingId(null);
    }
  }

  async function addTimer() {
    const stationTimers = timers.filter(
      (timer) => timer.monitor_number === selectedMonitor,
    );
    const nextCard =
      stationTimers.length === 0
        ? 1
        : Math.max(...stationTimers.map((timer) => timer.card_number)) + 1;
    const timestamp = new Date().toISOString();

    setBusyAction("add");
    setError(null);

    try {
      const { error: addError } = await supabase.from("shower_timers").insert({
        monitor_number: selectedMonitor,
        card_number: nextCard,
        label: "Available",
        duration_seconds: DEFAULT_SECONDS,
        remaining_seconds: DEFAULT_SECONDS,
        sort_order: nextCard,
        updated_at: timestamp,
      });

      if (addError) throw addError;
      await loadData(true);
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Unable to add card.");
    } finally {
      setBusyAction(null);
    }
  }

  async function removeTimer(timer: ShowerTimer) {
    if (
      timer.workgroup_id &&
      !window.confirm(
        `Remove Monitor ${timer.monitor_number} Card ${timer.card_number} and clear its active session?`,
      )
    ) {
      return;
    }

    setSavingId(timer.id);
    setError(null);

    try {
      await finishSession(timer, "cleared");

      const { error: deleteError } = await supabase
        .from("shower_timers")
        .delete()
        .eq("id", timer.id);

      if (deleteError) throw deleteError;
      await loadData(true);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Unable to remove card.");
    } finally {
      setSavingId(null);
    }
  }

  async function resetTimer(timer: ShowerTimer) {
    const timestamp = new Date().toISOString();
    setSavingId(timer.id);
    setError(null);
    try {
      const { error: timerError } = await supabase
        .from("shower_timers")
        .update({
          remaining_seconds: timer.duration_seconds,
          running: false,
          started_at: null,
          updated_at: timestamp,
        })
        .eq("id", timer.id);
      if (timerError) throw timerError;
      await loadData(true);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Unable to reset timer.");
    } finally {
      setSavingId(null);
    }
  }

  async function saveCardEdit(timer: ShowerTimer, cardNumber: string, minutes: string) {
    const nextCardNumber = Math.max(1, Math.round(Number(cardNumber) || timer.card_number));
    const durationSeconds = minutesToSeconds(minutes);
    const remaining = timer.running
      ? Math.max(0, Math.min(getRemaining(timer, nowMs), durationSeconds))
      : Math.max(0, Math.min(timer.remaining_seconds || durationSeconds, durationSeconds));
    const timestamp = new Date().toISOString();

    setSavingId(timer.id);
    setError(null);

    try {
      if (timer.active_session_id) {
        const { error: sessionError } = await supabase
          .from("shower_sessions")
          .update({
            monitor_number: timer.monitor_number,
            card_number: nextCardNumber,
            duration_seconds: durationSeconds,
          })
          .eq("id", timer.active_session_id);

        if (sessionError) throw sessionError;
      }

      const { error: timerError } = await supabase
        .from("shower_timers")
        .update({
          card_number: nextCardNumber,
          monitor_number: timer.monitor_number,
          duration_seconds: durationSeconds,
          remaining_seconds: remaining,
          started_at: timer.running ? timestamp : null,
          updated_at: timestamp,
        })
        .eq("id", timer.id);

      if (timerError) throw timerError;
      setEditTarget(null);
      await loadData(true);
    } catch (editError) {
      setError(editError instanceof Error ? editError.message : "Unable to save card.");
    } finally {
      setSavingId(null);
    }
  }

  async function resetAll() {
    if (
      !window.confirm(
        "Master reset? This will delete ALL session history and clear every timer. This cannot be undone.",
      )
    ) {
      return;
    }

    setBusyAction("reset-all");
    setError(null);

    try {
      const timestamp = new Date().toISOString();

      if (timers.length > 0) {
        const results = await Promise.all(
          timers.map((timer) =>
            supabase
              .from("shower_timers")
              .update({
                label: "Available",
                workgroup_id: null,
                participant_type: null,
                remaining_seconds: timer.duration_seconds,
                running: false,
                started_at: null,
                active_session_id: null,
                updated_at: timestamp,
              })
              .eq("id", timer.id),
          ),
        );

        const updateError = results.find((r) => r.error)?.error;
        if (updateError) throw updateError;
      }

      if (sessions.length > 0) {
        const { error: sessionError } = await supabase
          .from("shower_sessions")
          .update({ completed_at: timestamp, status: "cleared" })
          .in("id", sessions.map((s) => s.id));

        if (sessionError) throw sessionError;
      }

      await loadData(true);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Unable to reset board.");
    } finally {
      setBusyAction(null);
    }
  }

  async function saveWorkgroupName(workgroup: Workgroup) {
    const name = (groupDrafts[workgroup.id] ?? workgroup.name).trim();
    if (!name || name === workgroup.name) return;

    setBusyAction(`group-${workgroup.id}`);
    setError(null);

    try {
      const { error: groupError } = await supabase
        .from("workgroups")
        .update({
          name,
          updated_at: new Date().toISOString(),
        })
        .eq("id", workgroup.id);

      if (groupError) throw groupError;
      await loadData(true);
    } catch (groupError) {
      setError(groupError instanceof Error ? groupError.message : "Unable to rename group.");
    } finally {
      setBusyAction(null);
    }
  }

  if (loading && !lastSynced) {
    return (
      <main className="app-shell">
        <div className="loading-cover">Loading shower board...</div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <ShowerHead size={21} />
          </span>
          <div>
            <h1>Shower Timers</h1>
            <p className="subtle">
              {view === "timers"
                ? `Monitor ${selectedMonitor} - ${visibleTimers.length} cards`
                : view === "report"
                  ? "Speed leaderboard"
                  : `${workgroups.length} workgroups`}
            </p>
          </div>
        </div>

        <div className="top-actions">
          <div className="tabbar topbar-tabs" aria-label="View">
            <button
              className={`tab-button ${view === "timers" ? "active" : ""}`}
              onClick={() => setView("timers")}
              type="button"
            >
              <Timer size={17} />
              Timers
            </button>
            <button
              className={`tab-button ${view === "admin" ? "active" : ""}`}
              onClick={() => setView("admin")}
              type="button"
            >
              <BarChart3 size={17} />
              Admin
            </button>
            <button
              className={`tab-button ${view === "report" ? "active" : ""}`}
              onClick={() => setView("report")}
              type="button"
            >
              <Award size={17} />
              Report
            </button>
          </div>
        </div>
      </header>

      <SummaryStrip
        isLive={isLive}
        lastSynced={lastSynced}
        nextTimer={visibleSummary.nextTimer}
        onSync={() => void loadData()}
        summary={visibleSummary}
        nowMs={nowMs}
        selectedMonitor={selectedMonitor}
      />

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button className="icon-button" onClick={() => setError(null)} type="button">
            <X size={17} />
          </button>
        </div>
      )}

      {view === "timers" && (
        <>
          <MonitorSelector
            cardCounts={monitorCardCounts}
            onChange={setSelectedMonitor}
            selectedMonitor={selectedMonitor}
          />

          {sortedTimers.length === 0 ? (
            <div className="empty-state">No cards</div>
          ) : (
            <section className="timer-grid" aria-label="Timer cards">
              {sortedTimers.map((timer) => (
                <TimerCard
                  key={timer.id}
                  isSaving={savingId === timer.id}
                  nowMs={nowMs}
                  onEdit={() => setEditTarget(timer)}
                  onNext={() => setNextTarget(timer)}
                  onRemove={() => void removeTimer(timer)}
                  onReset={() => void resetTimer(timer)}
                  onStop={() => void stopTimer(timer)}
                  timer={timer}
                  workgroup={timer.workgroup_id ? workgroupById.get(timer.workgroup_id) : undefined}
                />
              ))}
            </section>
          )}

          <button
            className="button primary add-card-btn"
            disabled={busyAction === "add"}
            onClick={() => void addTimer()}
            style={{ marginTop: 10 }}
            type="button"
          >
            <Plus size={17} />
            Add card
          </button>
        </>
      )}

      {view === "admin" && (
        <AdminView
          busyAction={busyAction}
          currentDayName={currentDayName}
          groupDrafts={groupDrafts}
          groupStats={currentDayGroupStats}
          onDraftChange={(id, value) =>
            setGroupDrafts((current) => ({ ...current, [id]: value }))
          }
          onNewDay={() => void startNewDay()}
          onResetAll={() => void resetAll()}
          onSaveWorkgroup={(workgroup) => void saveWorkgroupName(workgroup)}
          sessions={currentDaySessions}
          summary={currentDaySummary}
          timers={timers}
          nowMs={nowMs}
          workgroups={workgroups}
        />
      )}

      {view === "report" && (
        <ReportView days={days} groupStats={groupStats} sessions={sessions} workgroups={workgroups} />
      )}

      {nextTarget && (
        <NextKidModal
          defaultMinutes={secondsToMinutesInput(DEFAULT_SECONDS)}
          isSaving={savingId === nextTarget.id}
          onClose={() => setNextTarget(null)}
          onSubmit={(workgroupId, participantType, minutes) =>
            void startNextKid(nextTarget, workgroupId, participantType, minutes)
          }
          timer={nextTarget}
          workgroups={workgroups}
        />
      )}

      {editTarget && (
        <EditCardModal
          isSaving={savingId === editTarget.id}
          onClose={() => setEditTarget(null)}
          onSubmit={(cardNumber, minutes) =>
            void saveCardEdit(editTarget, cardNumber, minutes)
          }
          timer={editTarget}
        />
      )}

      <nav className="bottom-nav" aria-label="Navigation">
        <button
          className={`bottom-nav-btn ${view === "timers" ? "active" : ""}`}
          onClick={() => setView("timers")}
          type="button"
        >
          <Timer size={22} />
          <span>Timers</span>
        </button>
        <button
          className={`bottom-nav-btn ${view === "admin" ? "active" : ""}`}
          onClick={() => setView("admin")}
          type="button"
        >
          <BarChart3 size={22} />
          <span>Admin</span>
        </button>
        <button
          className={`bottom-nav-btn ${view === "report" ? "active" : ""}`}
          onClick={() => setView("report")}
          type="button"
        >
          <Award size={22} />
          <span>Report</span>
        </button>
      </nav>
    </main>
  );
}

function SummaryStrip({
  isLive,
  lastSynced,
  nextTimer,
  nowMs,
  onSync,
  selectedMonitor,
  summary,
}: {
  isLive: boolean;
  lastSynced: Date | null;
  nextTimer?: ShowerTimer;
  nowMs: number;
  onSync: () => void;
  selectedMonitor: MonitorNumber;
  summary: {
    active: number;
    warning: number;
    expired: number;
    paused: number;
    idle: number;
    groupsLogged: number;
    completedSessions: number;
    activeSessions: number;
  };
}) {
  return (
    <section className="status-strip" aria-label="Summary">
      <div className="pill-row">
        <span className="pill teal">
          <Monitor size={14} />
          Monitor {selectedMonitor}
        </span>
        <span className="pill teal">
          <Play size={14} />
          {summary.active} active
        </span>
        <span className="pill amber">
          <Clock size={14} />
          {summary.warning} under 1 min
        </span>
        <span className="pill red">
          <CircleStop size={14} />
          {summary.expired} expired
        </span>
        <span className="pill violet">
          <Pause size={14} />
          {summary.paused} paused
        </span>
        <span className="pill">
          <ClipboardCheck size={14} />
          {summary.groupsLogged} groups logged
        </span>
        {nextTimer && (
          <span className="pill green">
            <Timer size={14} />
            Card {nextTimer.card_number} next {formatTime(getRemaining(nextTimer, nowMs))}
          </span>
        )}
      </div>
      <div className="sync-row">
        <span className={`sync-state ${isLive ? "live" : ""}`}>
          {isLive ? <Wifi size={16} /> : <WifiOff size={16} />}
          {isLive ? "Live" : "Offline"}
          {lastSynced ? ` - ${formatClock(lastSynced.toISOString())}` : ""}
        </span>
        <button className="icon-button" onClick={onSync} type="button" aria-label="Sync">
          <RefreshCw size={15} />
        </button>
      </div>
    </section>
  );
}

function MonitorSelector({
  cardCounts,
  onChange,
  selectedMonitor,
}: {
  cardCounts: Record<MonitorNumber, number>;
  onChange: (monitorNumber: MonitorNumber) => void;
  selectedMonitor: MonitorNumber;
}) {
  return (
    <section className="monitor-switcher" aria-label="Monitor selector">
      {MONITOR_NUMBERS.map((monitorNumber) => (
        <button
          className={`monitor-button ${selectedMonitor === monitorNumber ? "active" : ""}`}
          key={monitorNumber}
          onClick={() => onChange(monitorNumber)}
          type="button"
        >
          <Monitor size={18} />
          <span>Monitor {monitorNumber}</span>
          <span className="monitor-count">{cardCounts[monitorNumber]} cards</span>
        </button>
      ))}
    </section>
  );
}

function TimerCard({
  isSaving,
  nowMs,
  onEdit,
  onNext,
  onRemove,
  onReset,
  onStop,
  timer,
  workgroup,
}: {
  isSaving: boolean;
  nowMs: number;
  onEdit: () => void;
  onNext: () => void;
  onRemove: () => void;
  onReset: () => void;
  onStop: () => void;
  timer: ShowerTimer;
  workgroup?: Workgroup;
}) {
  const status = getTimerStatus(timer, nowMs);
  const remaining = getRemaining(timer, nowMs);
  const title = makeTimerLabel(timer, workgroup);
  const ParticipantIcon = timer.participant_type
    ? participantIcons[timer.participant_type]
    : Users;

  return (
    <article className={`timer-card ${status}`}>
      <div className="timer-head">
        <div className="timer-title">
          <h2>{title}</h2>
          <div className="timer-meta">
            <span className="pill">Monitor {timer.monitor_number}</span>
            <span className="pill">Card {timer.card_number}</span>
            {timer.participant_type && (
              <span className="pill teal">
                <ParticipantIcon size={14} />
                {participantLabels[timer.participant_type]}
              </span>
            )}
            <span className={`pill ${status === "expired" ? "red" : status === "warning" ? "amber" : ""}`}>
              {status}
            </span>
          </div>
        </div>
        <div className="timer-head-actions">
          <button
            aria-label={`Stop Card ${timer.card_number}`}
            className="icon-button"
            disabled={isSaving || !timer.active_session_id}
            onClick={onStop}
            title="Stop and log time"
            type="button"
          >
            <CircleStop size={17} />
          </button>
          <button
            aria-label={`Edit Card ${timer.card_number}`}
            className="icon-button"
            disabled={isSaving}
            onClick={onEdit}
            title="Edit card"
            type="button"
          >
            <Pencil size={17} />
          </button>
          <button
            aria-label={`Delete Card ${timer.card_number}`}
            className="icon-button"
            disabled={isSaving}
            onClick={onRemove}
            title="Delete card"
            type="button"
          >
            <Trash2 size={17} />
          </button>
        </div>
      </div>

      <div className="timer-body">
        <div className="timer-time" aria-label={`${formatTime(remaining)} remaining`}>
          {formatTime(remaining)}
        </div>
        <button className="button ghost card-reset" disabled={isSaving} onClick={onReset} type="button">
          <RotateCcw size={15} />
          Reset
        </button>
      </div>

      <button className="button primary card-next" disabled={isSaving} onClick={onNext} type="button">
        <Plus size={17} />
        Next
      </button>
    </article>
  );
}

function NextKidModal({
  defaultMinutes,
  isSaving,
  onClose,
  onSubmit,
  timer,
  workgroups,
}: {
  defaultMinutes: string;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (
    workgroupId: string,
    participantType: ParticipantType,
    minutes: string,
  ) => void;
  timer: ShowerTimer;
  workgroups: Workgroup[];
}) {
  const [workgroupId, setWorkgroupId] = useState(
    timer.workgroup_id ?? workgroups[0]?.id ?? "",
  );
  const [participantType, setParticipantType] = useState<ParticipantType>(
    timer.participant_type ?? "boy",
  );
  const [minutes, setMinutes] = useState(defaultMinutes);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workgroupId) return;
    onSubmit(workgroupId, participantType, minutes);
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <h2>
            Monitor {timer.monitor_number} - Card {timer.card_number} next
          </h2>
          <button className="icon-button" onClick={onClose} type="button">
            <X size={17} />
          </button>
        </div>
        <div className="modal-body">
          <label className="field-group">
            <span className="field-label">Crew</span>
            <select
              className="select"
              disabled={isSaving}
              onChange={(event) => setWorkgroupId(event.target.value)}
              required
              value={workgroupId}
            >
              {workgroups.map((workgroup) => (
                <option key={workgroup.id} value={workgroup.id}>
                  {workgroup.name}
                </option>
              ))}
            </select>
          </label>

          <div className="field-group">
            <span className="field-label">Type</span>
            <div className="segment-grid">
              {(Object.keys(participantLabels) as ParticipantType[]).map((type) => {
                const Icon = participantIcons[type];
                return (
                  <button
                    className={`segment ${participantType === type ? "active" : ""}`}
                    disabled={isSaving}
                    key={type}
                    onClick={() => setParticipantType(type)}
                    type="button"
                  >
                    <Icon size={17} />
                    {participantLabels[type]}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="field-group">
            <span className="field-label">Minutes</span>
            <input
              className="number-input"
              disabled={isSaving}
              min="1"
              max="60"
              onChange={(event) => setMinutes(event.target.value)}
              required
              type="number"
              value={minutes}
            />
          </label>

          <div className="modal-actions">
            <button className="button primary" disabled={isSaving || !workgroupId} type="submit">
              <Play size={17} />
              Start
            </button>
            <button className="button ghost" disabled={isSaving} onClick={onClose} type="button">
              Cancel
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function EditCardModal({
  isSaving,
  onClose,
  onSubmit,
  timer,
}: {
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (cardNumber: string, minutes: string) => void;
  timer: ShowerTimer;
}) {
  const [cardNumber, setCardNumber] = useState(String(timer.card_number));
  const [minutes, setMinutes] = useState(secondsToMinutesInput(timer.duration_seconds));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(cardNumber, minutes);
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <h2>
            Edit Monitor {timer.monitor_number} Card {timer.card_number}
          </h2>
          <button className="icon-button" onClick={onClose} type="button">
            <X size={17} />
          </button>
        </div>
        <div className="modal-body">
          <label className="field-group">
            <span className="field-label">Card number</span>
            <input
              className="number-input"
              disabled={isSaving}
              min="1"
              onChange={(event) => setCardNumber(event.target.value)}
              required
              type="number"
              value={cardNumber}
            />
          </label>
          <label className="field-group">
            <span className="field-label">Default minutes</span>
            <input
              className="number-input"
              disabled={isSaving}
              min="1"
              max="60"
              onChange={(event) => setMinutes(event.target.value)}
              required
              type="number"
              value={minutes}
            />
          </label>
          <div className="modal-actions">
            <button className="button primary" disabled={isSaving} type="submit">
              <Save size={17} />
              Save
            </button>
            <button className="button ghost" disabled={isSaving} onClick={onClose} type="button">
              Cancel
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function AdminView({
  busyAction,
  currentDayName,
  groupDrafts,
  groupStats,
  nowMs,
  onDraftChange,
  onNewDay,
  onResetAll,
  onSaveWorkgroup,
  sessions,
  summary,
  timers,
  workgroups,
}: {
  busyAction: string | null;
  currentDayName: string | null;
  groupDrafts: Record<string, string>;
  groupStats: Map<string, GroupStat>;
  nowMs: number;
  onDraftChange: (id: string, value: string) => void;
  onNewDay: () => void;
  onResetAll: () => void;
  onSaveWorkgroup: (workgroup: Workgroup) => void;
  sessions: ShowerSession[];
  summary: Summary;
  timers: ShowerTimer[];
  workgroups: Workgroup[];
}) {
  const totalBoys = sessions.filter((session) => session.participant_type === "boy").length;
  const totalGirls = sessions.filter((session) => session.participant_type === "girl").length;
  const totalAdults = sessions.filter(
    (session) => session.participant_type === "adult_chaperone",
  ).length;
  const notStarted = workgroups.length - summary.groupsLogged;

  return (
    <section className="admin-grid" aria-label="Admin stats">
      <div className="admin-actions">
        <div className="admin-day-row">
          <button
            className="button green"
            disabled={busyAction === "new-day"}
            onClick={onNewDay}
            type="button"
          >
            <Plus size={17} />
            New Day
          </button>
          {currentDayName && (
            <span className="admin-day-label">{currentDayName}</span>
          )}
        </div>
        <button
          className="button red"
          disabled={busyAction === "reset-all"}
          onClick={onResetAll}
          type="button"
        >
          <RotateCcw size={17} />
          Reset Board
        </button>
      </div>

      <div className="stat-grid">
        <StatCard icon={ClipboardCheck} label="Sessions" value={sessions.length} />
        <StatCard icon={Check} label="Completed" value={summary.completedSessions} />
        <StatCard icon={Timer} label="In showers" value={summary.activeSessions} />
        <StatCard icon={Users} label="Groups logged" value={`${summary.groupsLogged}/${workgroups.length}`} />
        <StatCard icon={Clock} label="Not started" value={notStarted} />
      </div>

      <div className="stat-grid">
        <StatCard icon={Mars} label="Boys" value={totalBoys} />
        <StatCard icon={Venus} label="Girls" value={totalGirls} />
        <StatCard icon={UserRoundCheck} label="Chaperones" value={totalAdults} />
      </div>

      <div className="stat-grid">
        {MONITOR_NUMBERS.map((monitorNumber) => {
          const stationTimers = timers.filter(
            (timer) => timer.monitor_number === monitorNumber,
          );
          const activeCards = stationTimers.filter(
            (timer) => getTimerStatus(timer, nowMs) !== "idle",
          ).length;
          const stationSessionsList = sessions.filter(
            (session) => session.monitor_number === monitorNumber,
          );
          const stationBoys = stationSessionsList.filter(
            (s) => s.participant_type === "boy",
          ).length;
          const stationGirls = stationSessionsList.filter(
            (s) => s.participant_type === "girl",
          ).length;

          return (
            <StatCard
              icon={Monitor}
              key={monitorNumber}
              label={`Monitor ${monitorNumber} · ${stationBoys}b / ${stationGirls}g`}
              value={`${activeCards}/${stationTimers.length}`}
            />
          );
        })}
      </div>

      <section className="admin-panel">
        <div className="panel-head">
          <h2>Crews</h2>
          <span className="pill">{workgroups.length} total</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Group</th>
                <th>Status</th>
                <th>Boys</th>
                <th>Girls</th>
                <th>Chaperones</th>
                <th>Completed</th>
                <th>Avg time</th>
                <th>Last</th>
                <th>Monitors</th>
              </tr>
            </thead>
            <tbody>
              {workgroups.map((workgroup) => {
                const stat = groupStats.get(workgroup.id) ?? emptyGroupStat();
                const crewMonitors = [
                  ...new Set(
                    sessions
                      .filter((s) => s.workgroup_id === workgroup.id && s.monitor_number != null)
                      .map((s) => s.monitor_number),
                  ),
                ].sort();
                const status =
                  stat.active > 0
                    ? "In progress"
                    : stat.started > 0
                      ? "Logged"
                      : "Not started";

                return (
                  <tr key={workgroup.id}>
                    <td>
                      <form
                        className="group-name-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          onSaveWorkgroup(workgroup);
                        }}
                      >
                        <input
                          className="field"
                          onChange={(event) => onDraftChange(workgroup.id, event.target.value)}
                          value={groupDrafts[workgroup.id] ?? workgroup.name}
                        />
                        <button
                          aria-label={`Save ${workgroup.name}`}
                          className="icon-button"
                          disabled={busyAction === `group-${workgroup.id}`}
                          title="Save"
                          type="submit"
                        >
                          <Save size={17} />
                        </button>
                      </form>
                    </td>
                    <td>
                      <span className={`pill ${stat.active > 0 ? "teal" : stat.started > 0 ? "green" : ""}`}>
                        {status}
                      </span>
                    </td>
                    <td>{stat.boy}</td>
                    <td>{stat.girl}</td>
                    <td>{stat.adult_chaperone}</td>
                    <td>{stat.completed}</td>
                    <td>
                      {stat.completed > 0
                        ? formatTime(Math.round(stat.totalActualSeconds / stat.completed))
                        : "—"}
                    </td>
                    <td>{formatClock(stat.lastStarted)}</td>
                    <td>{crewMonitors.length > 0 ? crewMonitors.map((m) => `M${m}`).join(", ") : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
}) {
  return (
    <article className="stat-card">
      <div className="stat-label">
        <Icon size={17} />
        {label}
      </div>
      <div className="stat-value">{value}</div>
    </article>
  );
}

type ReelOverviewRow = {
  name: string;
  avgSeconds: number;
  boyAvgSec: number;
  girlAvgSec: number;
};

type ReelSlide =
  | { kind: "stat"; emoji: string; heading: string; crew: string; stat: string; quip: string; speak: string; accent: string }
  | { kind: "overview"; speak: string; rows: ReelOverviewRow[]; maxSec: number };

function buildReelSlides(
  data: Array<{
    workgroup: Workgroup;
    avgSeconds: number;
    boyAvgSec: number;
    girlAvgSec: number;
  }>,
): ReelSlide[] {
  const slides: ReelSlide[] = [];

  const ranked = [...data].sort((a, b) => a.avgSeconds - b.avgSeconds);
  const withData = ranked.filter((d) => d.avgSeconds > 0);

  const medals = [
    { emoji: "🥇", heading: "Fastest Crew", quip: "Are you sure you got clean? 🧽", accent: "var(--amber)" },
    { emoji: "🥈", heading: "Second Fastest", quip: "Squeaky clean and proud. 🧼", accent: "var(--muted)" },
    { emoji: "🥉", heading: "Third Fastest", quip: "Still impressively quick. 🫧", accent: "#c97c4a" },
  ];

  // Overview slide first
  const maxSec = Math.max(...withData.flatMap((d) => [d.boyAvgSec, d.girlAvgSec]).filter((s) => s > 0), 1);
  slides.push({
    kind: "overview",
    speak: "Here's a look at all the crews. Let's take a closer look.",
    rows: withData.map((d) => ({
      name: d.workgroup.name,
      avgSeconds: d.avgSeconds,
      boyAvgSec: d.boyAvgSec,
      girlAvgSec: d.girlAvgSec,
    })),
    maxSec,
  });

  for (let i = 0; i < Math.min(3, withData.length); i++) {
    const d = withData[i];
    const m = medals[i];
    slides.push({
      kind: "stat",
      emoji: m.emoji,
      heading: m.heading,
      crew: d.workgroup.name,
      stat: formatTime(d.avgSeconds) + " avg",
      quip: m.quip,
      speak: `${m.heading}: ${d.workgroup.name} — ${formatTime(d.avgSeconds)} average. ${m.quip}`,
      accent: m.accent,
    });
  }

  const withBoth = withData.filter((d) => d.boyAvgSec > 0 && d.girlAvgSec > 0);
  if (withBoth.length > 0) {
    const discrepancy = withBoth.reduce((best, d) => {
      const diff = Math.abs(d.boyAvgSec - d.girlAvgSec);
      return diff > Math.abs(best.boyAvgSec - best.girlAvgSec) ? d : best;
    });
    const diff = Math.abs(discrepancy.boyAvgSec - discrepancy.girlAvgSec);
    const longerGender = discrepancy.girlAvgSec > discrepancy.boyAvgSec ? "girls" : "boys";
    const quip = longerGender === "boys"
      ? "Well Boys, I Bet your hair looks real nice 💇‍♀️ Did you do your nails too? 💅"
      : "Girls, that wasn’t a shower, that was a full spa retreat. 🧖‍♀️✨";
    slides.push({
      kind: "stat",
      emoji: "✂️",
      heading: "Biggest Gender Gap",
      crew: discrepancy.workgroup.name,
      stat: formatTime(diff) + " gap",
      quip,
      speak: `Biggest gender gap: ${discrepancy.workgroup.name}, with a ${formatTime(diff)} difference. ${quip}`,
      accent: "var(--violet)",
    });
  }

  const slowest = withData[withData.length - 1];
  if (slowest && withData.length > 1) {
    slides.push({
      kind: "stat",
      emoji: "🛁",
      heading: "Slowest Crew",
      crew: slowest.workgroup.name,
      stat: formatTime(slowest.avgSeconds) + " avg",
      quip: "Were you taking a bath? 🦆",
      speak: `And the slowest crew… ${slowest.workgroup.name}, with a ${formatTime(slowest.avgSeconds)} average. Were you taking a bath?`,
      accent: "var(--red)",
    });
  }

  return slides;
}

function ReelModal({
  slides,
  onClose,
}: {
  slides: ReelSlide[];
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [animKey, setAnimKey] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState<string>(
    () => localStorage.getItem("reel-voice") ?? "",
  );
  const selectedVoiceNameRef = useRef(selectedVoiceName);
  useEffect(() => { selectedVoiceNameRef.current = selectedVoiceName; }, [selectedVoiceName]);

  // Voices load asynchronously — poll until populated
  useEffect(() => {
    if (typeof speechSynthesis === "undefined") return;
    const load = () => {
      const v = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
      if (v.length > 0) setVoices(v);
    };
    load();
    speechSynthesis.addEventListener("voiceschanged", load);
    return () => speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  // Background music: start on mount, stop on unmount
  useEffect(() => {
    const audio = new Audio(`${import.meta.env.BASE_URL}suds_and_squeeqs.mp3`);
    audio.loop = true;
    audio.volume = 0.5;
    audioRef.current = audio;
    audio.play().catch(() => { /* autoplay blocked — silently skip */ });
    return () => {
      audio.pause();
      audio.src = "";
    };
  }, []);

  // Stable refs so `go` doesn't depend on ever-changing prop references.
  // (Parent re-renders every second via the clock tick, which would otherwise
  // reset the timeout on every tick before it fires.)
  const slidesRef = useRef(slides);
  useEffect(() => { slidesRef.current = slides; }, [slides]);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const go = useCallback((next: number) => {
    const s = slidesRef.current;
    if (next >= s.length) {
      onCloseRef.current();
      return;
    }
    setIndex(next);
    setAnimKey((k) => k + 1);
    if (typeof speechSynthesis !== "undefined") {
      speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(stripEmoji(s[next].speak));
      utt.rate = 0.95;
      utt.pitch = 1.1;
      const voice = speechSynthesis.getVoices().find((v) => v.name === selectedVoiceNameRef.current);
      if (voice) utt.voice = voice;
      uttRef.current = utt; // stored so the advance effect can attach onend
      speechSynthesis.speak(utt);
    } else {
      uttRef.current = null;
    }
  }, []); // no prop deps — uses refs

  const uttRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    go(0);
    return () => {
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    };
  }, [go]);

  useEffect(() => {
    let advanced = false;
    const advance = () => {
      if (advanced) return;
      advanced = true;
      go(index + 1);
    };

    // Primary trigger: fire 800ms after narration finishes
    if (uttRef.current) {
      uttRef.current.onend = () => setTimeout(advance, 800);
    }

    // Safety fallback: advance after 10s regardless (also cancels speech
    // to prevent onend firing after the fallback already fired)
    const safety = setTimeout(() => {
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
      advance();
    }, 10000);

    return () => {
      advanced = true; // block any pending advance callbacks from this slide
      clearTimeout(safety);
    };
  }, [index, go]);

  const slide = slides[index];

  return (
    <div className="reel-overlay" onClick={() => go(index + 1)}>
      <div className="reel-stage" key={animKey}>
        {slide.kind === "overview" ? (
          <>
            <div className="reel-ov-label">Let's take a closer look</div>
            <div className="reel-ov-list">
              {slide.rows.map((row, i) => {
                const pct = Math.max(4, (row.avgSeconds / slide.maxSec) * 100);
                const isFirst = i === 0;
                const isLast = i === slide.rows.length - 1 && slide.rows.length > 1;
                return (
                  <div key={row.name} className="reel-ov-row">
                    <div className="reel-ov-name">
                      {isFirst ? "🥇 " : isLast ? "🛁 " : ""}{row.name}
                    </div>
                    <div className="reel-ov-track">
                      <div className="reel-ov-fill" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div className="reel-emoji">{slide.emoji}</div>
            <div className="reel-heading" style={{ color: slide.accent }}>{slide.heading}</div>
            <div className="reel-crew">{slide.crew}</div>
            <div className="reel-stat">{slide.stat}</div>
            <div className="reel-quip">{slide.quip}</div>
          </>
        )}
      </div>
      <div className="reel-dots">
        {slides.map((_, i) => (
          <div key={i} className={`reel-dot${i === index ? " active" : ""}`} />
        ))}
      </div>
      <div className="reel-bottom-bar" onClick={(e) => e.stopPropagation()}>
        <div className="reel-hint">tap anywhere to skip</div>
        {voices.length > 0 && (
          <select
            className="reel-voice-select"
            value={selectedVoiceName}
            onChange={(e) => {
              setSelectedVoiceName(e.target.value);
              localStorage.setItem("reel-voice", e.target.value);
            }}
          >
            <option value="">Default voice</option>
            {voices.map((v) => (
              <option key={v.name} value={v.name}>{v.name}</option>
            ))}
          </select>
        )}
      </div>
      <button className="reel-close" onClick={(e) => { e.stopPropagation(); onClose(); }}>
        <X size={20} />
      </button>
    </div>
  );
}

function ReportView({
  workgroups,
  groupStats: _groupStats,
  sessions,
  days,
}: {
  workgroups: Workgroup[];
  groupStats: Map<string, GroupStat>;
  sessions: ShowerSession[];
  days: ShowerDay[];
}) {
  const [showReel, setShowReel] = useState(false);
  const [selectedDayId, setSelectedDayId] = useState<string | "all">("all");

  const filteredSessions = selectedDayId === "all"
    ? sessions
    : sessions.filter((s) => s.day_id === selectedDayId);

  const secFromSession = (s: ShowerSession) =>
    Math.round((new Date(s.completed_at!).getTime() - new Date(s.started_at).getTime()) / 1000);

  const data = workgroups
    .map((wg) => {
      const done = filteredSessions.filter(
        (s) => s.workgroup_id === wg.id && s.status === "completed" && s.completed_at,
      );
      if (done.length === 0) return null;

      const boySessions = done.filter((s) => s.participant_type === "boy");
      const girlSessions = done.filter((s) => s.participant_type === "girl");

      const totalActualSeconds = done.reduce((n, s) => n + secFromSession(s), 0);
      const boyAvgSec = boySessions.length > 0
        ? Math.round(boySessions.reduce((n, s) => n + secFromSession(s), 0) / boySessions.length)
        : 0;
      const girlAvgSec = girlSessions.length > 0
        ? Math.round(girlSessions.reduce((n, s) => n + secFromSession(s), 0) / girlSessions.length)
        : 0;

      return {
        workgroup: wg,
        avgSeconds: Math.round(totalActualSeconds / done.length),
        completed: done.length,
        totalActualSeconds,
        boys: boySessions.length,
        girls: girlSessions.length,
        boyAvgSec,
        girlAvgSec,
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .sort((a, b) => a.avgSeconds - b.avgSeconds);

  const totalCompleted = data.reduce((n, d) => n + d.completed, 0);
  const totalSeconds = data.reduce((n, d) => n + d.totalActualSeconds, 0);
  const overallAvg = Math.round(totalSeconds / totalCompleted);
  const maxSeconds = Math.max(...data.flatMap((d) => [d.boyAvgSec, d.girlAvgSec]).filter((s) => s > 0), 1);
  const avgLinePct = (overallAvg / maxSeconds) * 100;

  const totalBoys = data.reduce((n, d) => n + d.boys, 0);
  const totalGirls = data.reduce((n, d) => n + d.girls, 0);
  const pieTotal = totalBoys + totalGirls;
  const boysPiePct = pieTotal > 0 ? (totalBoys / pieTotal) * 100 : 50;
  const girlsPiePct = pieTotal > 0 ? (totalGirls / pieTotal) * 100 : 50;

  const completedWithTime = filteredSessions.filter((s) => s.status === "completed" && s.completed_at);
  const boySessions = completedWithTime.filter((s) => s.participant_type === "boy");
  const girlSessions = completedWithTime.filter((s) => s.participant_type === "girl");
  const boyAvg = boySessions.length > 0
    ? Math.round(boySessions.reduce((n, s) => n + Math.round((new Date(s.completed_at!).getTime() - new Date(s.started_at).getTime()) / 1000), 0) / boySessions.length)
    : 0;
  const girlAvg = girlSessions.length > 0
    ? Math.round(girlSessions.reduce((n, s) => n + Math.round((new Date(s.completed_at!).getTime() - new Date(s.started_at).getTime()) / 1000), 0) / girlSessions.length)
    : 0;
  const genderMaxAvg = Math.max(boyAvg, girlAvg, 1);

  const reelSlides = buildReelSlides(data);

  return (
    <section className="report-view">
      {showReel && (
        <ReelModal slides={reelSlides} onClose={() => setShowReel(false)} />
      )}

      {days.length > 0 && (
        <div className="day-tabs">
          <button
            className={`day-tab${selectedDayId === "all" ? " active" : ""}`}
            onClick={() => setSelectedDayId("all")}
            type="button"
          >
            All
          </button>
          {days.map((day) => (
            <button
              key={day.id}
              className={`day-tab${selectedDayId === day.id ? " active" : ""}`}
              onClick={() => setSelectedDayId(day.id)}
              type="button"
            >
              {day.name}
            </button>
          ))}
        </div>
      )}

      {data.length === 0 ? (
        <div className="empty-state">
          {selectedDayId === "all"
            ? "No completed sessions yet — get those showers going! 🚿"
            : "No completed sessions for this day yet."}
        </div>
      ) : (<>
      <div className="report-header">
        <div>
          <h2 className="report-title">Shower Speed Leaderboard</h2>
          <p className="subtle">
            Ranked fastest to slowest. The last group owes everyone a cold shower apology.
          </p>
        </div>
        <button className="button reel-btn" onClick={() => setShowReel(true)}>
          <Clapperboard size={17} />
          Recap Reel
        </button>
      </div>

      <div className="report-cards">
        <div className="report-card">
          <div className="report-card-label">Boys vs Girls</div>
          <div className="pie-container">
            <svg viewBox="0 0 36 36" className="pie-svg">
              <circle
                cx="18" cy="18" r="15.9155"
                fill="none"
                stroke="var(--panel-strong)"
                strokeWidth="4"
              />
              {boysPiePct > 0 && (
                <circle
                  cx="18" cy="18" r="15.9155"
                  fill="none"
                  stroke="var(--teal)"
                  strokeWidth="4"
                  strokeDasharray={`${boysPiePct} ${100 - boysPiePct}`}
                  strokeDashoffset="25"
                />
              )}
              {girlsPiePct > 0 && (
                <circle
                  cx="18" cy="18" r="15.9155"
                  fill="none"
                  stroke="var(--violet)"
                  strokeWidth="4"
                  strokeDasharray={`${girlsPiePct} ${100 - girlsPiePct}`}
                  strokeDashoffset={25 - boysPiePct}
                />
              )}
            </svg>
            <div className="pie-stats">
              <div className="pie-stat-row">
                <span className="pie-dot" style={{ background: "var(--teal)" }} />
                <div>
                  <div className="pie-count">{totalBoys}</div>
                  <div className="pie-label">Boys · {Math.round(boysPiePct)}%</div>
                </div>
              </div>
              <div className="pie-stat-row">
                <span className="pie-dot" style={{ background: "var(--violet)" }} />
                <div>
                  <div className="pie-count">{totalGirls}</div>
                  <div className="pie-label">Girls · {Math.round(girlsPiePct)}%</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="report-card">
          <div className="report-card-label">Avg time by gender</div>
          <div className="gender-bars">
            <div className="gender-bar-row">
              <span className="gender-bar-label"><Mars size={14} /> Boys</span>
              <div className="gender-bar-track">
                <div className="gender-bar-fill" style={{ width: `${(boyAvg / genderMaxAvg) * 100}%`, background: "var(--teal)" }} />
              </div>
              <span className="gender-bar-value">{boyAvg > 0 ? formatTime(boyAvg) : "—"}</span>
            </div>
            <div className="gender-bar-row">
              <span className="gender-bar-label"><Venus size={14} /> Girls</span>
              <div className="gender-bar-track">
                <div className="gender-bar-fill" style={{ width: `${(girlAvg / genderMaxAvg) * 100}%`, background: "var(--violet)" }} />
              </div>
              <span className="gender-bar-value">{girlAvg > 0 ? formatTime(girlAvg) : "—"}</span>
            </div>
          </div>
        </div>

        <div className="report-kpi">
          <span className="report-kpi-label">Overall avg</span>
          <span className="report-kpi-value">{formatTime(overallAvg)}</span>
          <span className="report-kpi-sub">{totalCompleted} showers · {data.length} groups</span>
        </div>
      </div>

      <div className="report-legend">
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: "var(--teal)" }} />
          Boys
        </span>
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: "var(--violet)" }} />
          Girls
        </span>
        <span className="legend-item">
          <span className="legend-swatch legend-swatch-dashed" />
          Avg line
        </span>
      </div>

      <div className="report-chart">
        {data.map((d, i) => {
          const isFirst = i === 0;
          const isLast = i === data.length - 1;
          const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : String(i + 1);

          const boyBarPct = d.boyAvgSec > 0 ? Math.max(2, (d.boyAvgSec / maxSeconds) * 100) : 0;
          const girlBarPct = d.girlAvgSec > 0 ? Math.max(2, (d.girlAvgSec / maxSeconds) * 100) : 0;

          return (
            <div className="chart-row" key={d.workgroup.id}>
              <div className="chart-rank">
                {medal}
                {isFirst && <div className="chart-badge">⚡</div>}
                {isLast && data.length > 1 && <div className="chart-badge">🛁</div>}
              </div>
              <div className="chart-label" title={d.workgroup.name}>
                {d.workgroup.name}
              </div>
              <div className="chart-bars">
                <div className="chart-bar-line">
                  <Mars size={12} className="chart-bar-icon" />
                  <div className="chart-track">
                    <div className="chart-fill seg-boy" style={{ width: `${boyBarPct}%` }}>
                      {d.boyAvgSec > 0 && <span className="chart-bar-time">{formatTime(d.boyAvgSec)}</span>}
                    </div>
                    <div className="chart-avg-line" style={{ left: `${avgLinePct}%` }} />
                  </div>
                </div>
                <div className="chart-bar-line">
                  <Venus size={12} className="chart-bar-icon" />
                  <div className="chart-track">
                    <div className="chart-fill seg-girl" style={{ width: `${girlBarPct}%` }}>
                      {d.girlAvgSec > 0 && <span className="chart-bar-time">{formatTime(d.girlAvgSec)}</span>}
                    </div>
                    <div className="chart-avg-line" style={{ left: `${avgLinePct}%` }} />
                  </div>
                </div>
              </div>
              <div className="chart-crew-avg">
                {formatTime(d.avgSeconds)}
              </div>
            </div>
          );
        })}
      </div>
      </>)}
    </section>
  );
}
