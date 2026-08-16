import { useState } from 'react';

interface ReorderItem {
  readonly id: string;
  readonly name: string;
}

interface ReorderSheetProps {
  readonly items: readonly ReorderItem[];
  readonly onConfirm: (orderedIds: readonly string[]) => void;
  readonly onClose: () => void;
}

// Full-screen reorder sheet: drag handle rows + single confirm button.
export function ReorderSheet({ items, onConfirm, onClose }: ReorderSheetProps) {
  const [order, setOrder] = useState<ReorderItem[]>([...items]);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const move = (from: number, to: number) => {
    setOrder(prev => {
      const next = [...prev];
      const item = next[from];
      if (item == null) return prev;
      next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/60"
      data-testid="reorder-sheet"
      onClick={onClose}
    >
      <div
        className="mx-auto mb-24 flex w-full max-w-md flex-col gap-2 px-3"
        onClick={e => { e.stopPropagation(); }}
      >
        {/* Draggable list */}
        <ul className="overflow-hidden rounded-[20px] bg-[#1a1a1a]">
          {order.map((item, i) => (
            <li
              key={item.id}
              draggable
              onDragStart={() => { setDragging(i); }}
              onDragEnd={() => { setDragging(null); setDragOver(null); }}
              onDragOver={e => { e.preventDefault(); setDragOver(i); }}
              onDrop={() => {
                if (dragging !== null && dragging !== i) move(dragging, i);
                setDragging(null); setDragOver(null);
              }}
              className={[
                'flex h-14 cursor-grab items-center gap-4 px-4',
                i > 0 ? 'border-t-2 border-seam' : '',
                dragging === i ? 'opacity-40' : '',
                dragOver === i && dragging !== i ? 'bg-seam/30' : '',
              ].join(' ')}
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden className="shrink-0 text-ash">
                <rect x="3" y="5" width="14" height="2" rx="1" fill="currentColor" />
                <rect x="3" y="9" width="14" height="2" rx="1" fill="currentColor" />
                <rect x="3" y="13" width="14" height="2" rx="1" fill="currentColor" />
              </svg>
              <span className="min-w-0 truncate font-display text-base uppercase tracking-normal text-chalk">
                {item.name}
              </span>
            </li>
          ))}
        </ul>

        {/* Confirm */}
        <button
          type="button"
          className="tap-target w-full rounded-[20px] bg-plate-red font-display text-base uppercase tracking-normal text-white active:bg-plate-red-pressed"
          onClick={() => { onConfirm(order.map(x => x.id)); onClose(); }}
        >
          Confirm
        </button>
      </div>
    </div>
  );
}
