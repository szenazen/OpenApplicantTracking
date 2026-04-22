'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DragStart,
  type DropResult,
} from '@hello-pangea/dnd';
import { io, Socket } from 'socket.io-client';
import {
  AlertTriangle,
  Briefcase,
  Clock,
  Eye,
  MessageSquare,
  MoreVertical,
  Search,
  Star,
  ThumbsDown,
  ThumbsUp,
  X,
} from 'lucide-react';
import { api, ApplicationCard, Pipeline, PipelineStatus } from '@/lib/api';
import { useAuth } from '@/lib/store';
import {
  avatarColor,
  daysSince,
  formatRelativeDuration,
  formatYearsExperience,
  getInitials,
} from '@/lib/format';
import { PendingTransition, StageTransitionDialog } from './StageTransitionDialog';

/**
 * A card is "stuck" if it has sat in the same pipeline stage for at least
 * this many days without moving. The threshold matches the home dashboard's
 * `stuckThresholdDays` default — if either changes, we want both to
 * surface the same signal to recruiters so the home feed and the board
 * don't contradict each other.
 */
const STUCK_THRESHOLD_DAYS = 7;

interface Props {
  jobId: string;
  pipeline: Pipeline;
  initialCards: ApplicationCard[];
  /** Optional observer fired whenever the local card list changes (used by the header). */
  onCardsChange?: (cards: ApplicationCard[]) => void;
  /**
   * Called when a card is clicked (not dragged). Wire this to open the
   * candidate drawer in the parent page. A quick click-without-movement is
   * distinguished from a drag by the library's own threshold.
   */
  onOpenCard?: (applicationId: string) => void;
  /**
   * Keyed per-card partial updates from outside the board — e.g. the candidate
   * drawer mutates commentCount / reactionSummary and we want the Kanban
   * badges to reflect that without a full re-fetch. Changes to this map cause
   * matching cards to be patched in place.
   */
  cardOverrides?: Record<string, Partial<ApplicationCard>>;
}

/** Pixels from the horizontal edge where auto-scroll should engage during a drag. */
const AUTOSCROLL_EDGE_PX = 80;
/** Max auto-scroll velocity in px/frame (applied when the cursor is at the very edge). */
const AUTOSCROLL_MAX_PX_PER_FRAME = 18;

/**
 * Live Kanban board:
 *   - hello-pangea/dnd for drag & drop between columns
 *   - optimistic local state update, then PATCH /applications/:id/move
 *   - socket.io subscription to application.moved so other tabs/browsers
 *     watching the same job see moves in real time.
 */
export function KanbanBoard({
  jobId,
  pipeline,
  initialCards,
  onCardsChange,
  onOpenCard,
  cardOverrides,
}: Props) {
  const { token, activeAccountId } = useAuth();
  const [cards, setCards] = useState<ApplicationCard[]>(initialCards);
  const [error, setError] = useState<string | null>(null);
  // Set when a drag lands on a HIRED/DROPPED column and we want a
  // confirmation modal before committing the move (with a reason).
  const [pendingTransition, setPendingTransition] = useState<PendingTransition | null>(null);

  // Reset when the parent loads a different job or replaces the application
  // list from the server (layout briefly clears while fetching, then hydrates).
  useEffect(() => {
    setCards(initialCards);
  }, [jobId, initialCards]);

  // Merge external card overrides (e.g. comment / reaction counts from the
  // drawer) into our local list. We only patch when the incoming snapshot
  // actually differs to avoid render churn.
  useEffect(() => {
    if (!cardOverrides) return;
    setCards((prev) =>
      prev.map((c) => {
        const patch = cardOverrides[c.id];
        if (!patch) return c;
        return { ...c, ...patch };
      }),
    );
  }, [cardOverrides]);
  // Horizontal scroll container ref (for autoscroll-during-drag).
  const scrollRef = useRef<HTMLDivElement>(null);
  // State flags used to drive scroll-on-drag; refs avoid re-renders during drag.
  const draggingRef = useRef(false);
  const pointerXRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  // Notify the parent (e.g. JobHeader) about card-list changes after render
  // so pipeline summary tiles stay in sync with drags + socket events.
  useEffect(() => {
    onCardsChange?.(cards);
  }, [cards, onCardsChange]);

  // -------------------- In-board search --------------------
  //
  // `query` drives a cheap client-side filter across the currently-loaded
  // cards. We don't go to the server for this — the board already holds
  // every active card for the job and server-side search would add an
  // unnecessary round-trip for a small dataset. Pressing `/` focuses the
  // input; Escape clears it. Matching is case-insensitive substring
  // against candidate name / current title / current company / headline.
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      // Don't hijack `/` inside existing form controls or editable surfaces.
      if (target && (target.isContentEditable || isFormField(target))) return;
      if (searchRef.current) {
        e.preventDefault();
        searchRef.current.focus();
        searchRef.current.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredCards = useMemo(() => {
    if (!normalizedQuery) return cards;
    return cards.filter((c) => matchesQuery(c, normalizedQuery));
  }, [cards, normalizedQuery]);

  // Group (filtered) cards by status id (position-sorted) for the columns.
  const columns = useMemo(() => {
    const byStatus = new Map<string, ApplicationCard[]>();
    for (const s of pipeline.statuses) byStatus.set(s.id, []);
    for (const c of filteredCards) {
      const list = byStatus.get(c.currentStatusId);
      if (list) list.push(c);
    }
    for (const list of byStatus.values()) list.sort((a, b) => a.position - b.position);
    return byStatus;
  }, [filteredCards, pipeline.statuses]);

  // Per-status full counts (ignore the search) so the column count pill
  // stays a stable "how many live cards are in this stage?" signal even
  // when the visible list is narrowed by a query.
  const totalCountsByStatus = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of pipeline.statuses) counts.set(s.id, 0);
    for (const c of cards) counts.set(c.currentStatusId, (counts.get(c.currentStatusId) ?? 0) + 1);
    return counts;
  }, [cards, pipeline.statuses]);

  // A flat "no results" sentinel so we don't render an empty-but-intentional
  // board as if it were a fresh job.
  const visibleCount = filteredCards.length;
  const totalCount = cards.length;
  const hasNoMatches = normalizedQuery !== '' && visibleCount === 0;

  // Socket.IO subscription.
  useEffect(() => {
    if (!token || !activeAccountId) return;
    // Connect directly to the API origin (Next.js rewrites don't proxy WebSocket upgrades).
    const apiOrigin = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const socket: Socket = io(apiOrigin, {
      path: '/realtime',
      auth: { token, accountId: activeAccountId },
      transports: ['websocket', 'polling'],
    });
    socket.emit('subscribe', { accountId: activeAccountId, jobId });
    socket.on('application.change', (evt: {
      type: 'moved' | 'created';
      application: ApplicationCard;
      fromStatusId?: string;
      toStatusId?: string;
      toPosition?: number;
    }) => {
      if (evt.type === 'moved' && evt.fromStatusId && evt.toStatusId && typeof evt.toPosition === 'number') {
        setCards((prev) =>
          reconcileMove(prev, {
            applicationId: evt.application.id,
            fromStatusId: evt.fromStatusId!,
            toStatusId: evt.toStatusId!,
            toPosition: evt.toPosition!,
          }),
        );
      } else if (evt.type === 'created') {
        setCards((prev) => (prev.some((c) => c.id === evt.application.id) ? prev : [...prev, evt.application]));
      }
    });
    return () => {
      socket.emit('unsubscribe', { accountId: activeAccountId, jobId });
      socket.disconnect();
    };
  }, [token, activeAccountId, jobId]);

  async function onDragEnd(result: DropResult) {
    stopAutoscroll();
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    const moving = cards.find((c) => c.id === draggableId);
    const fromStatus = pipeline.statuses.find((s) => s.id === source.droppableId);
    const toStatus = pipeline.statuses.find((s) => s.id === destination.droppableId);

    // For terminal categories (HIRED / DROPPED) we want to capture the
    // recruiter's reason before committing — both for audit and for the
    // candidate-side timeline. The board snaps back to the source column
    // until the user confirms in the modal.
    if (
      moving &&
      fromStatus &&
      toStatus &&
      source.droppableId !== destination.droppableId &&
      (toStatus.category === 'HIRED' || toStatus.category === 'DROPPED')
    ) {
      setPendingTransition({
        card: moving,
        fromStatus,
        toStatus,
        toPosition: destination.index,
      });
      return;
    }

    await commitMove({
      applicationId: draggableId,
      fromStatusId: source.droppableId,
      toStatusId: destination.droppableId,
      toPosition: destination.index,
      expectedVersion: moving?.version,
    });
  }

  /**
   * Apply a move: optimistic local mutation → API call → rollback-on-error
   * handled by surface-level error message (the websocket replay will
   * eventually correct the optimistic state if the API rejected us).
   */
  async function commitMove(opts: {
    applicationId: string;
    fromStatusId: string;
    toStatusId: string;
    toPosition: number;
    expectedVersion?: number;
    reason?: string;
  }) {
    setCards((prev) =>
      reconcileMove(prev, {
        applicationId: opts.applicationId,
        fromStatusId: opts.fromStatusId,
        toStatusId: opts.toStatusId,
        toPosition: opts.toPosition,
      }),
    );
    try {
      const idempotencyKey =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${opts.applicationId}-${Date.now()}`;
      await api(`/applications/${opts.applicationId}/move`, {
        method: 'PATCH',
        body: {
          toStatusId: opts.toStatusId,
          toPosition: opts.toPosition,
          ...(opts.expectedVersion !== undefined ? { expectedVersion: opts.expectedVersion } : {}),
          ...(opts.reason ? { reason: opts.reason } : {}),
        },
        headers: { 'Idempotency-Key': idempotencyKey },
      });
    } catch (err: any) {
      if (err?.status === 409) {
        setError('This card was just updated by someone else — reloading to reconcile.');
      } else {
        setError(err?.message ?? 'Move failed — refresh to reconcile');
      }
      // Re-throw so any caller (e.g. the dialog) can surface it inline.
      throw err;
    }
  }

  // -------------------- Auto-scroll during drag --------------------
  //
  // @hello-pangea/dnd supplies its own autoscroll for window scroll, but our
  // columns live inside a horizontally-overflowing flex container, which the
  // library doesn't know about. We track the pointer while a drag is active
  // and scroll the container when the cursor approaches either edge.
  function onDragStart(_start: DragStart) {
    draggingRef.current = true;
    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    rafRef.current = window.requestAnimationFrame(autoscrollTick);
  }

  function stopAutoscroll() {
    draggingRef.current = false;
    pointerXRef.current = null;
    window.removeEventListener('mousemove', handlePointerMove);
    window.removeEventListener('touchmove', handleTouchMove);
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }

  function handlePointerMove(e: MouseEvent) {
    pointerXRef.current = e.clientX;
  }
  function handleTouchMove(e: TouchEvent) {
    if (e.touches.length) pointerXRef.current = e.touches[0]!.clientX;
  }

  function autoscrollTick() {
    const el = scrollRef.current;
    const x = pointerXRef.current;
    if (draggingRef.current && el && x !== null) {
      const rect = el.getBoundingClientRect();
      const distLeft = x - rect.left;
      const distRight = rect.right - x;
      let delta = 0;
      if (distLeft < AUTOSCROLL_EDGE_PX) {
        const strength = Math.max(0, (AUTOSCROLL_EDGE_PX - distLeft) / AUTOSCROLL_EDGE_PX);
        delta = -Math.ceil(strength * AUTOSCROLL_MAX_PX_PER_FRAME);
      } else if (distRight < AUTOSCROLL_EDGE_PX) {
        const strength = Math.max(0, (AUTOSCROLL_EDGE_PX - distRight) / AUTOSCROLL_EDGE_PX);
        delta = Math.ceil(strength * AUTOSCROLL_MAX_PX_PER_FRAME);
      }
      if (delta !== 0) el.scrollLeft += delta;
    }
    if (draggingRef.current) {
      rafRef.current = window.requestAnimationFrame(autoscrollTick);
    }
  }

  // Safety net: always release listeners on unmount.
  // `stopAutoscroll` only reads refs + window, so it's stable enough to not
  // list as a dep; we deliberately want this to run exactly once on unmount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => stopAutoscroll(), []);

  // -------------------- Card click --------------------
  //
  // A mousedown+mouseup with no significant movement is treated as a click
  // by @hello-pangea/dnd, so a vanilla onClick here fires on click but not
  // on drag. We still swallow clicks that come from within obvious
  // interactive areas (links etc.) to avoid double navigation.
  function handleCardClick(applicationId: string) {
    onOpenCard?.(applicationId);
  }

  const clearQuery = useCallback(() => setQuery(''), []);

  return (
    <div className="flex h-full flex-col" data-testid="kanban-board">
      {error && (
        <div role="alert" className="mx-6 mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="flex items-center gap-3 px-6 pt-4" data-testid="kanban-toolbar">
        <div className="relative w-full max-w-xs">
          <Search
            size={14}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                if (query) {
                  clearQuery();
                } else {
                  (e.target as HTMLInputElement).blur();
                }
              }
            }}
            placeholder="Search candidates…  (/)"
            className="block w-full rounded-md border border-slate-300 bg-white pl-7 pr-7 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            data-testid="kanban-search"
            aria-label="Search candidates in this board"
          />
          {query && (
            <button
              type="button"
              onClick={clearQuery}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              data-testid="kanban-search-clear"
            >
              <X size={12} />
            </button>
          )}
        </div>
        {normalizedQuery && (
          <span className="text-xs text-slate-500" data-testid="kanban-search-count">
            {visibleCount} of {totalCount} {totalCount === 1 ? 'candidate' : 'candidates'}
          </span>
        )}
      </div>
      {hasNoMatches && (
        <div
          role="status"
          className="mx-6 mt-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500"
          data-testid="kanban-search-empty"
        >
          No candidates match &quot;{query}&quot;.{' '}
          <button
            type="button"
            className="font-medium text-brand-600 hover:underline"
            onClick={clearQuery}
          >
            Clear search
          </button>
        </div>
      )}
      <DragDropContext onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div ref={scrollRef} className="flex flex-1 gap-3 overflow-x-auto p-6" data-testid="kanban-scroll">
          {pipeline.statuses.map((s) => (
            <Droppable droppableId={s.id} key={s.id}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={
                    'flex w-72 shrink-0 flex-col rounded-xl border p-3 ' +
                    (snapshot.isDraggingOver ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white')
                  }
                  data-testid={`column-${s.id}`}
                  data-column-name={s.name}
                >
                  <ColumnHeader
                    status={s}
                    count={totalCountsByStatus.get(s.id) ?? 0}
                    visibleCount={columns.get(s.id)?.length ?? 0}
                    filtered={normalizedQuery !== ''}
                  />
                  <ul className="flex flex-1 flex-col gap-2">
                    {columns.get(s.id)?.map((card, idx) => (
                      <Draggable draggableId={card.id} index={idx} key={card.id}>
                        {(drag, dragSnapshot) => (
                          <li
                            ref={drag.innerRef}
                            {...drag.draggableProps}
                            {...drag.dragHandleProps}
                            className={
                              'group cursor-pointer rounded-lg border bg-white p-3 shadow-sm transition-shadow ' +
                              (dragSnapshot.isDragging
                                ? 'border-brand-500 shadow-md'
                                : 'border-slate-200 hover:border-brand-500 hover:shadow')
                            }
                            data-testid="kanban-card"
                            data-card-id={card.id}
                            onClick={() => handleCardClick(card.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleCardClick(card.id);
                              }
                            }}
                          >
                            <CandidateCardBody card={card} status={s} />
                          </li>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </ul>
                </div>
              )}
            </Droppable>
          ))}
        </div>
      </DragDropContext>

      <StageTransitionDialog
        pending={pendingTransition}
        onCancel={() => setPendingTransition(null)}
        onConfirm={async (reason) => {
          if (!pendingTransition) return;
          const p = pendingTransition;
          await commitMove({
            applicationId: p.card.id,
            fromStatusId: p.fromStatus.id,
            toStatusId: p.toStatus.id,
            toPosition: p.toPosition,
            expectedVersion: p.card.version,
            reason,
          });
          setPendingTransition(null);
        }}
      />
    </div>
  );
}

/**
 * Column header with a status-color dot, name, count pill, and a kebab
 * menu placeholder. While a search filter is active we surface a
 * "visible / total" pair so recruiters can tell at a glance how many of
 * the column's real cards matched the query.
 */
function ColumnHeader({
  status,
  count,
  visibleCount,
  filtered,
}: {
  status: PipelineStatus;
  count: number;
  visibleCount: number;
  filtered: boolean;
}) {
  const dotColor = status.color || categoryColor(status.category);
  return (
    <div className="mb-2 flex items-center justify-between">
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: dotColor }}
        />
        <h3 className="truncate text-sm font-semibold text-slate-700">{status.name}</h3>
        <span
          className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500"
          data-testid={`col-count-${status.id}`}
          title={filtered ? `${visibleCount} visible of ${count} total` : undefined}
        >
          {filtered ? `${visibleCount}/${count}` : count}
        </span>
      </div>
      <span className="text-slate-300" aria-hidden>
        <MoreVertical size={14} />
      </span>
    </div>
  );
}

/**
 * Candidate card body — matches the reference Kanban UI:
 *   avatar + name (bold brand) / role @ company / meta row (yoe, time in status) / actions.
 *
 * All text is gracefully optional: if a candidate has no current title we fall
 * back to their headline; if no company, we just show the title.
 */
function CandidateCardBody({ card, status }: { card: ApplicationCard; status: PipelineStatus }) {
  const { candidate } = card;
  const initials = getInitials(candidate.firstName, candidate.lastName);
  const palette = avatarColor(candidate.id || `${candidate.firstName}${candidate.lastName}`);
  const roleLine = buildRoleLine(candidate);
  const yoe = formatYearsExperience(candidate.yearsExperience);
  const timeInStage = formatRelativeDuration(card.lastTransitionAt);
  // We treat HIRED / DROPPED as terminal — a hire sitting in "Hired" for
  // weeks is expected, not a problem. Only active pipeline stages get the
  // stuck signal so the amber pill stays a real action prompt.
  const isTerminal = status.category === 'HIRED' || status.category === 'DROPPED';
  const stageDays = isTerminal ? null : daysSince(card.lastTransitionAt);
  const isStuck = stageDays !== null && stageDays >= STUCK_THRESHOLD_DAYS;

  return (
    <div className="flex items-start gap-3">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${palette.bg} ${palette.fg}`}
        aria-hidden
      >
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div
              className="truncate text-sm font-semibold text-brand-700"
              data-testid="kanban-card-name"
              title={`${candidate.firstName} ${candidate.lastName}`}
            >
              {candidate.firstName} {candidate.lastName}
            </div>
            {roleLine && (
              <div className="mt-0.5 truncate text-xs text-slate-500" data-testid="kanban-card-role">
                {roleLine}
              </div>
            )}
          </div>
          {/*
           * Render action affordances as non-interactive icons (spans) rather
           * than <button>s. Nested buttons inside a @hello-pangea/dnd draggable
           * (which itself gets role="button") break mouse event propagation to
           * the drag handle and cause drops to silently cancel. When we wire
           * up real click handlers, swap these for keyboard-accessible menu
           * triggers outside the drag handle.
           */}
          <div
            className="flex shrink-0 items-center gap-1 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden
          >
            <Eye size={14} />
            <MoreVertical size={14} />
          </div>
        </div>
        {(yoe || timeInStage || isStuck) && (
          <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-500">
            {yoe && (
              <span className="inline-flex items-center gap-1" data-testid="kanban-card-yoe" title="Years of experience">
                <Briefcase size={11} /> {yoe}
              </span>
            )}
            {timeInStage && (
              <span
                className={
                  'inline-flex items-center gap-1 ' +
                  (isStuck ? 'text-amber-700' : '')
                }
                data-testid="kanban-card-time-in-stage"
                title={
                  isStuck
                    ? `Stuck in ${status.name} for ${stageDays} day${stageDays === 1 ? '' : 's'}`
                    : 'Time in current stage'
                }
              >
                <Clock size={11} /> {timeInStage}
              </span>
            )}
            {isStuck && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
                data-testid="kanban-card-stuck"
                title={`No stage change in ${stageDays} day${stageDays === 1 ? '' : 's'} — review`}
                aria-label={`Stuck for ${stageDays} day${stageDays === 1 ? '' : 's'}`}
              >
                <AlertTriangle size={10} /> Stuck
              </span>
            )}
          </div>
        )}
        <CardBadges card={card} />
      </div>
    </div>
  );
}

/**
 * Bottom row showing comment + reaction badges. Hidden entirely when the card
 * has no activity — keeps unexplored cards visually quiet.
 */
function CardBadges({ card }: { card: ApplicationCard }) {
  const comments = card.commentCount ?? 0;
  const counts = card.reactionSummary?.counts ?? { THUMBS_UP: 0, THUMBS_DOWN: 0, STAR: 0 };
  const mine = new Set(card.reactionSummary?.myReactions ?? []);
  const hasAny = comments > 0 || counts.THUMBS_UP > 0 || counts.THUMBS_DOWN > 0 || counts.STAR > 0;
  if (!hasAny) return null;
  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500"
      data-testid="kanban-card-badges"
    >
      {comments > 0 && (
        <span
          className="inline-flex items-center gap-1"
          data-testid="kanban-card-comments"
          title={`${comments} comment${comments === 1 ? '' : 's'}`}
        >
          <MessageSquare size={11} /> {comments}
        </span>
      )}
      {counts.STAR > 0 && (
        <span
          className={`inline-flex items-center gap-1 ${mine.has('STAR') ? 'text-amber-600' : ''}`}
          data-testid="kanban-card-star"
          title={`${counts.STAR} star${counts.STAR === 1 ? '' : 's'}`}
        >
          <Star size={11} className={mine.has('STAR') ? 'fill-current' : ''} /> {counts.STAR}
        </span>
      )}
      {counts.THUMBS_UP > 0 && (
        <span
          className={`inline-flex items-center gap-1 ${mine.has('THUMBS_UP') ? 'text-emerald-600' : ''}`}
          data-testid="kanban-card-thumbs-up"
          title={`${counts.THUMBS_UP} thumbs up`}
        >
          <ThumbsUp size={11} className={mine.has('THUMBS_UP') ? 'fill-current' : ''} /> {counts.THUMBS_UP}
        </span>
      )}
      {counts.THUMBS_DOWN > 0 && (
        <span
          className={`inline-flex items-center gap-1 ${mine.has('THUMBS_DOWN') ? 'text-rose-600' : ''}`}
          data-testid="kanban-card-thumbs-down"
          title={`${counts.THUMBS_DOWN} thumbs down`}
        >
          <ThumbsDown size={11} className={mine.has('THUMBS_DOWN') ? 'fill-current' : ''} /> {counts.THUMBS_DOWN}
        </span>
      )}
    </div>
  );
}

/**
 * Returns true if an element is a form field (input / textarea / select)
 * where the `/` shortcut MUST NOT be hijacked. Using `tagName` keeps this
 * allocation-free in the hot keydown path.
 */
function isFormField(el: HTMLElement): boolean {
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Case-insensitive substring match across candidate name / current role /
 * current company / headline. Kept intentionally narrow so search results
 * stay predictable — we don't index notes, comments, or skills here.
 */
function matchesQuery(card: ApplicationCard, needle: string): boolean {
  const c = card.candidate;
  const haystack = [
    c.firstName,
    c.lastName,
    `${c.firstName ?? ''} ${c.lastName ?? ''}`,
    c.currentTitle,
    c.currentCompany,
    c.headline,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

/** Best-effort "Role @ Company" / "Role" / "Headline" line. */
function buildRoleLine(c: ApplicationCard['candidate']): string {
  const title = c.currentTitle?.trim() || c.headline?.trim() || '';
  const company = c.currentCompany?.trim();
  if (title && company) return `${title} @ ${company}`;
  if (title) return title;
  if (company) return `@ ${company}`;
  return '';
}

/** Fallback dot color when a status has no explicit color — mapped to category. */
function categoryColor(category: string): string {
  switch (category) {
    case 'NEW':
      return '#60a5fa';
    case 'HIRED':
      return '#22c55e';
    case 'DROPPED':
      return '#ef4444';
    case 'IN_PROGRESS':
    default:
      return '#94a3b8';
  }
}

/**
 * Pure function: given the current card list and a move event, produce the
 * new densely-packed card list. Used both for optimistic local updates AND
 * for applying server-pushed socket events. Mirrors the server-side logic.
 */
function reconcileMove(
  cards: ApplicationCard[],
  evt: { applicationId: string; fromStatusId: string; toStatusId: string; toPosition: number },
): ApplicationCard[] {
  const moving = cards.find((c) => c.id === evt.applicationId);
  if (!moving) return cards;

  // Remove from source, repack source column.
  const source = cards
    .filter((c) => c.currentStatusId === evt.fromStatusId && c.id !== moving.id)
    .sort((a, b) => a.position - b.position)
    .map((c, i) => ({ ...c, position: i }));

  // Insert into target, repack.
  const targetPrev = cards
    .filter((c) => c.currentStatusId === evt.toStatusId && c.id !== moving.id)
    .sort((a, b) => a.position - b.position);
  const target = [...targetPrev];
  target.splice(Math.min(evt.toPosition, target.length), 0, {
    ...moving,
    currentStatusId: evt.toStatusId,
    position: evt.toPosition,
  });
  const targetPacked = target.map((c, i) => ({ ...c, position: i }));

  const others = cards.filter(
    (c) => c.currentStatusId !== evt.fromStatusId && c.currentStatusId !== evt.toStatusId,
  );
  return [...others, ...source, ...targetPacked];
}
