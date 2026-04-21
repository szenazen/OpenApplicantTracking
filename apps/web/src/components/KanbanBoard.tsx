'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DragStart,
  type DropResult,
} from '@hello-pangea/dnd';
import { io, Socket } from 'socket.io-client';
import { Briefcase, Clock, Eye, MoreVertical } from 'lucide-react';
import { api, ApplicationCard, Pipeline, PipelineStatus } from '@/lib/api';
import { useAuth } from '@/lib/store';
import { avatarColor, formatRelativeDuration, formatYearsExperience, getInitials } from '@/lib/format';

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
export function KanbanBoard({ jobId, pipeline, initialCards, onCardsChange, onOpenCard }: Props) {
  const { token, activeAccountId } = useAuth();
  const [cards, setCards] = useState<ApplicationCard[]>(initialCards);
  const [error, setError] = useState<string | null>(null);
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

  // Group cards by status id (position-sorted) for the columns.
  const columns = useMemo(() => {
    const byStatus = new Map<string, ApplicationCard[]>();
    for (const s of pipeline.statuses) byStatus.set(s.id, []);
    for (const c of cards) {
      const list = byStatus.get(c.currentStatusId);
      if (list) list.push(c);
    }
    for (const list of byStatus.values()) list.sort((a, b) => a.position - b.position);
    return byStatus;
  }, [cards, pipeline.statuses]);

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

    // Optimistic update
    setCards((prev) =>
      reconcileMove(prev, {
        applicationId: draggableId,
        fromStatusId: source.droppableId,
        toStatusId: destination.droppableId,
        toPosition: destination.index,
      }),
    );

    try {
      await api(`/applications/${draggableId}/move`, {
        method: 'PATCH',
        body: { toStatusId: destination.droppableId, toPosition: destination.index },
      });
    } catch (err: any) {
      setError(err.message ?? 'Move failed — refresh to reconcile');
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

  return (
    <div className="flex h-full flex-col" data-testid="kanban-board">
      {error && (
        <div role="alert" className="mx-6 mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700">
          {error}
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
                  <ColumnHeader status={s} count={columns.get(s.id)?.length ?? 0} />
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
                            <CandidateCardBody card={card} />
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
    </div>
  );
}

/** Column header with a status-color dot, name, count pill, and a kebab menu placeholder. */
function ColumnHeader({ status, count }: { status: PipelineStatus; count: number }) {
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
        >
          {count}
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
function CandidateCardBody({ card }: { card: ApplicationCard }) {
  const { candidate } = card;
  const initials = getInitials(candidate.firstName, candidate.lastName);
  const palette = avatarColor(candidate.id || `${candidate.firstName}${candidate.lastName}`);
  const roleLine = buildRoleLine(candidate);
  const yoe = formatYearsExperience(candidate.yearsExperience);
  const timeInStage = formatRelativeDuration(card.lastTransitionAt);

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
        {(yoe || timeInStage) && (
          <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-500">
            {yoe && (
              <span className="inline-flex items-center gap-1" data-testid="kanban-card-yoe" title="Years of experience">
                <Briefcase size={11} /> {yoe}
              </span>
            )}
            {timeInStage && (
              <span
                className="inline-flex items-center gap-1"
                data-testid="kanban-card-time-in-stage"
                title="Time in current stage"
              >
                <Clock size={11} /> {timeInStage}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
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
