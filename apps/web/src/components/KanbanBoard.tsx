'use client';

import { useEffect, useMemo, useState } from 'react';
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd';
import { io, Socket } from 'socket.io-client';
import { api, ApplicationCard, Pipeline } from '@/lib/api';
import { useAuth } from '@/lib/store';

interface Props {
  jobId: string;
  pipeline: Pipeline;
  initialCards: ApplicationCard[];
}

/**
 * Live Kanban board:
 *   - hello-pangea/dnd for drag & drop between columns
 *   - optimistic local state update, then PATCH /applications/:id/move
 *   - socket.io subscription to application.moved so other tabs/browsers
 *     watching the same job see moves in real time.
 */
export function KanbanBoard({ jobId, pipeline, initialCards }: Props) {
  const { token, activeAccountId } = useAuth();
  const [cards, setCards] = useState<ApplicationCard[]>(initialCards);
  const [error, setError] = useState<string | null>(null);

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
    const socket: Socket = io('/', {
      path: '/realtime',
      auth: { token, accountId: activeAccountId },
      transports: ['websocket', 'polling'],
    });
    socket.emit('job.subscribe', { jobId });
    socket.on('application.moved', (evt: {
      applicationId: string;
      fromStatusId: string;
      toStatusId: string;
      toPosition: number;
    }) => {
      setCards((prev) => reconcileMove(prev, evt));
    });
    return () => {
      socket.emit('job.unsubscribe', { jobId });
      socket.disconnect();
    };
  }, [token, activeAccountId, jobId]);

  async function onDragEnd(result: DropResult) {
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

  return (
    <div className="flex h-full flex-col" data-testid="kanban-board">
      {error && (
        <div role="alert" className="mx-6 mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex flex-1 gap-3 overflow-x-auto p-6">
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
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-700">{s.name}</h3>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                      {columns.get(s.id)?.length ?? 0}
                    </span>
                  </div>
                  <ul className="flex flex-1 flex-col gap-2">
                    {columns.get(s.id)?.map((card, idx) => (
                      <Draggable draggableId={card.id} index={idx} key={card.id}>
                        {(drag) => (
                          <li
                            ref={drag.innerRef}
                            {...drag.draggableProps}
                            {...drag.dragHandleProps}
                            className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm hover:border-brand-500"
                            data-testid="kanban-card"
                            data-card-id={card.id}
                          >
                            <div className="text-sm font-medium">
                              {card.candidate.firstName} {card.candidate.lastName}
                            </div>
                            {card.candidate.headline && (
                              <div className="mt-1 text-xs text-slate-500">{card.candidate.headline}</div>
                            )}
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
