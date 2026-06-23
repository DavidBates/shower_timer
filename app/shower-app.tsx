"use client";

import { createClient } from "@supabase/supabase-js";
import {
  BarChart3,
  Check,
  CircleStop,
  ClipboardCheck,
  Clock,
  Mars,
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
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

const DEFAULT_SECONDS = 6 * 60;
const WARNING_SECONDS = 60;
const STARTER_CARD_COUNT = 6;
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://gexteohhuehtyvkddtkz.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_SaHEKf81xnxims_RTr-IYg_3nj8UFRz";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  realtime: {
    params: {
      eventsPerSecond: 8,
    },
  },
});

type ParticipantType = "boy" | "girl" | "adult_chaperone";
type ViewMode = "timers" | "admin";
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
  card_number: number;
  workgroup_id: string;
  participant_type: ParticipantType;
  duration_seconds: number;
  started_at: string;
  completed_at: string | null;
  status: SessionStatus;
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

function formatTime(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;

  return `${minutes}:${String(remainder).padStart(2, "0")}`;
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
    return Math.max(0, timer.remaining_seconds);
  }

  const elapsed = Math.floor((nowMs - new Date(timer.started_at).getTime()) / 1000);
  return Math.max(0, timer.remaining_seconds - elapsed);
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
  return `${workgroup?.name ?? "Workgroup"} - ${participantLabels[timer.participant_type]}`;
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
  };
}

export default function ShowerApp() {
  const [view, setView] = useState<ViewMode>("timers");
  const [workgroups, setWorkgroups] = useState<Workgroup[]>([]);
  const [timers, setTimers] = useState<ShowerTimer[]>([]);
  const [sessions, setSessions] = useState<ShowerSession[]>([]);
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

    const [workgroupResult, timerResult, sessionResult] = await Promise.all([
      supabase.from("workgroups").select("*").order("sort_order"),
      supabase
        .from("shower_timers")
        .select("*")
        .order("card_number", { ascending: true }),
      supabase
        .from("shower_sessions")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(3000),
    ]);

    const nextError =
      workgroupResult.error ?? timerResult.error ?? sessionResult.error;

    if (nextError) {
      setError(nextError.message);
      setLoading(false);
      return;
    }

    setWorkgroups((workgroupResult.data ?? []) as Workgroup[]);
    setTimers((timerResult.data ?? []) as ShowerTimer[]);
    setSessions((sessionResult.data ?? []) as ShowerSession[]);
    setLastSynced(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

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
      if (session.status === "completed") stat.completed += 1;
      if (!stat.lastStarted || session.started_at > stat.lastStarted) {
        stat.lastStarted = session.started_at;
      }

      stats.set(session.workgroup_id, stat);
    }

    return stats;
  }, [sessions, workgroups]);

  const sortedTimers = useMemo(() => {
    return [...timers].sort((a, b) => {
      const aStatus = getTimerStatus(a, nowMs);
      const bStatus = getTimerStatus(b, nowMs);
      const byStatus = statusOrder[aStatus] - statusOrder[bStatus];

      if (byStatus !== 0) return byStatus;
      if (aStatus !== "idle") return getRemaining(a, nowMs) - getRemaining(b, nowMs);
      return a.card_number - b.card_number;
    });
  }, [nowMs, timers]);

  const summary = useMemo(() => {
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
  }, [groupStats, nowMs, sessions, timers]);

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
          card_number: timer.card_number,
          workgroup_id: workgroupId,
          participant_type: participantType,
          duration_seconds: durationSeconds,
          started_at: timestamp,
          status: "active",
        })
        .select("id")
        .single();

      if (sessionError) throw sessionError;

      const { error: timerError } = await supabase
        .from("shower_timers")
        .update({
          label: `${workgroup?.name ?? "Workgroup"} - ${participantLabels[participantType]}`,
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

  async function finishCard(timer: ShowerTimer) {
    const timestamp = new Date().toISOString();
    setSavingId(timer.id);
    setError(null);

    try {
      await finishSession(timer, "completed");

      const { error: timerError } = await supabase
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
        .eq("id", timer.id);

      if (timerError) throw timerError;
      await loadData(true);
    } catch (finishError) {
      setError(finishError instanceof Error ? finishError.message : "Unable to finish card.");
    } finally {
      setSavingId(null);
    }
  }

  async function toggleTimer(timer: ShowerTimer) {
    if (!timer.workgroup_id) {
      setNextTarget(timer);
      return;
    }

    const timestamp = new Date().toISOString();
    const remaining = getRemaining(timer, nowMs);
    setSavingId(timer.id);
    setError(null);

    try {
      const { error: timerError } = await supabase
        .from("shower_timers")
        .update(
          timer.running
            ? {
                remaining_seconds: remaining,
                running: false,
                started_at: null,
                updated_at: timestamp,
              }
            : {
                remaining_seconds: remaining || timer.duration_seconds,
                running: true,
                started_at: timestamp,
                updated_at: timestamp,
              },
        )
        .eq("id", timer.id);

      if (timerError) throw timerError;
      await loadData(true);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Unable to update timer.");
    } finally {
      setSavingId(null);
    }
  }

  async function addTimer() {
    const nextCard =
      timers.length === 0 ? 1 : Math.max(...timers.map((timer) => timer.card_number)) + 1;
    const timestamp = new Date().toISOString();

    setBusyAction("add");
    setError(null);

    try {
      const { error: addError } = await supabase.from("shower_timers").insert({
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
      !window.confirm(`Remove Card ${timer.card_number} and clear its active session?`)
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

  async function resetCards() {
    if (!window.confirm("Reset the board to Cards 1-6? Active sessions will be cleared.")) {
      return;
    }

    setBusyAction("reset");
    setError(null);

    try {
      const activeIds = timers
        .map((timer) => timer.active_session_id)
        .filter((id): id is string => Boolean(id));

      if (activeIds.length > 0) {
        const { error: sessionError } = await supabase
          .from("shower_sessions")
          .update({
            completed_at: new Date().toISOString(),
            status: "cleared",
          })
          .in("id", activeIds);

        if (sessionError) throw sessionError;
      }

      const { error: deleteError } = await supabase
        .from("shower_timers")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");

      if (deleteError) throw deleteError;

      const rows = Array.from({ length: STARTER_CARD_COUNT }, (_, index) => ({
        card_number: index + 1,
        label: "Available",
        duration_seconds: DEFAULT_SECONDS,
        remaining_seconds: DEFAULT_SECONDS,
        sort_order: index + 1,
        updated_at: new Date().toISOString(),
      }));

      const { error: insertError } = await supabase.from("shower_timers").insert(rows);
      if (insertError) throw insertError;
      await loadData(true);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Unable to reset cards.");
    } finally {
      setBusyAction(null);
    }
  }

  async function saveCardEdit(timer: ShowerTimer, cardNumber: string, minutes: string) {
    const nextCardNumber = Math.max(1, Math.round(Number(cardNumber) || timer.card_number));
    const durationSeconds = minutesToSeconds(minutes);
    const remaining = timer.running
      ? Math.min(getRemaining(timer, nowMs), durationSeconds)
      : Math.min(timer.remaining_seconds || durationSeconds, durationSeconds);
    const timestamp = new Date().toISOString();

    setSavingId(timer.id);
    setError(null);

    try {
      if (timer.active_session_id) {
        const { error: sessionError } = await supabase
          .from("shower_sessions")
          .update({
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
            <p className="subtle">{workgroups.length} workgroups</p>
          </div>
        </div>

        <div className="top-actions">
          <div className="tabbar" aria-label="View">
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
          </div>
          <button
            className="button ghost"
            onClick={() => void loadData()}
            type="button"
          >
            <RefreshCw size={17} />
            Sync
          </button>
        </div>
      </header>

      <SummaryStrip
        isLive={isLive}
        lastSynced={lastSynced}
        nextTimer={summary.nextTimer}
        summary={summary}
        nowMs={nowMs}
      />

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button className="icon-button" onClick={() => setError(null)} type="button">
            <X size={17} />
          </button>
        </div>
      )}

      {view === "timers" ? (
        <>
          <div className="top-actions" style={{ marginBottom: 10 }}>
            <button
              className="button primary"
              disabled={busyAction === "add"}
              onClick={() => void addTimer()}
              type="button"
            >
              <Plus size={17} />
              Add card
            </button>
            <button
              className="button ghost"
              disabled={busyAction === "reset"}
              onClick={() => void resetCards()}
              type="button"
            >
              <RotateCcw size={17} />
              Reset 1-6
            </button>
          </div>

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
                  onFinish={() => void finishCard(timer)}
                  onNext={() => setNextTarget(timer)}
                  onRemove={() => void removeTimer(timer)}
                  onToggle={() => void toggleTimer(timer)}
                  timer={timer}
                  workgroup={timer.workgroup_id ? workgroupById.get(timer.workgroup_id) : undefined}
                />
              ))}
            </section>
          )}
        </>
      ) : (
        <AdminView
          busyAction={busyAction}
          groupDrafts={groupDrafts}
          groupStats={groupStats}
          onDraftChange={(id, value) =>
            setGroupDrafts((current) => ({ ...current, [id]: value }))
          }
          onSaveWorkgroup={(workgroup) => void saveWorkgroupName(workgroup)}
          sessions={sessions}
          summary={summary}
          workgroups={workgroups}
        />
      )}

      {nextTarget && (
        <NextKidModal
          defaultMinutes={secondsToMinutesInput(nextTarget.duration_seconds)}
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
    </main>
  );
}

function SummaryStrip({
  isLive,
  lastSynced,
  nextTimer,
  nowMs,
  summary,
}: {
  isLive: boolean;
  lastSynced: Date | null;
  nextTimer?: ShowerTimer;
  nowMs: number;
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
      <span className={`sync-state ${isLive ? "live" : ""}`}>
        {isLive ? <Wifi size={16} /> : <WifiOff size={16} />}
        {isLive ? "Live" : "Offline"}
        {lastSynced ? ` - ${formatClock(lastSynced.toISOString())}` : ""}
      </span>
    </section>
  );
}

function TimerCard({
  isSaving,
  nowMs,
  onEdit,
  onFinish,
  onNext,
  onRemove,
  onToggle,
  timer,
  workgroup,
}: {
  isSaving: boolean;
  nowMs: number;
  onEdit: () => void;
  onFinish: () => void;
  onNext: () => void;
  onRemove: () => void;
  onToggle: () => void;
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
      </div>

      <div className="timer-time" aria-label={`${formatTime(remaining)} remaining`}>
        {formatTime(remaining)}
      </div>

      <div className="card-actions">
        <button className="button primary" disabled={isSaving} onClick={onNext} type="button">
          <Plus size={17} />
          Next
        </button>
        <button className="button green" disabled={isSaving} onClick={onToggle} type="button">
          {timer.running ? <Pause size={17} /> : <Play size={17} />}
          {timer.running ? "Pause" : "Start"}
        </button>
        <button className="button amber" disabled={isSaving} onClick={onFinish} type="button">
          <Check size={17} />
          Done
        </button>
        <button className="button red" disabled={isSaving} onClick={onRemove} type="button">
          <Trash2 size={17} />
          Remove
        </button>
      </div>
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
          <h2>Card {timer.card_number} next</h2>
          <button className="icon-button" onClick={onClose} type="button">
            <X size={17} />
          </button>
        </div>
        <div className="modal-body">
          <label className="field-group">
            <span className="field-label">Workgroup</span>
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
          <h2>Edit card</h2>
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
  groupDrafts,
  groupStats,
  onDraftChange,
  onSaveWorkgroup,
  sessions,
  summary,
  workgroups,
}: {
  busyAction: string | null;
  groupDrafts: Record<string, string>;
  groupStats: Map<string, GroupStat>;
  onDraftChange: (id: string, value: string) => void;
  onSaveWorkgroup: (workgroup: Workgroup) => void;
  sessions: ShowerSession[];
  summary: {
    activeSessions: number;
    completedSessions: number;
    groupsLogged: number;
  };
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

      <section className="admin-panel">
        <div className="panel-head">
          <h2>Workgroups</h2>
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
                <th>Last</th>
              </tr>
            </thead>
            <tbody>
              {workgroups.map((workgroup) => {
                const stat = groupStats.get(workgroup.id) ?? emptyGroupStat();
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
                    <td>{formatClock(stat.lastStarted)}</td>
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
