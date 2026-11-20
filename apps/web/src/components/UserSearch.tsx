import { useQuery } from '@tanstack/react-query';
import type { UserSearchHit } from '@thegrave/shared';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../lib/api';
import { Avatar } from './Avatar';
import { SearchIcon } from './play/icons';

/** Navbar player search (decision.md D-073): prefix match on usernames, keyboard-driven, opens a profile. */
export function UserSearch() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Debounced: one request per pause in typing, not per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 200);
    return () => clearTimeout(t);
  }, [text]);
  const { data: hits = [], isFetching } = useQuery({
    queryKey: ['user-search', q],
    queryFn: () => api<UserSearchHit[]>(`/search/users?q=${encodeURIComponent(q)}`),
    enabled: q.length > 0,
    staleTime: 30_000,
  });
  useEffect(() => setCursor(0), [q]);

  // Click outside closes the list.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const go = (username: string) => {
    setOpen(false);
    setText('');
    navigate(`/u/${username}`);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setCursor((c) => Math.min(c + 1, Math.max(0, hits.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter' && hits[cursor]) {
      e.preventDefault();
      go(hits[cursor].username);
    } else if (e.key === 'Escape') {
      setOpen(false);
      (e.target as HTMLInputElement).blur();
    }
  };

  const showList = open && q.length > 0 && q === text.trim();
  return (
    <div ref={box} className="relative w-full md:w-72 xl:w-52 2xl:w-64">
      <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ash-400" />
      <input
        type="search"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search players"
        aria-label="Search players"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && hits[cursor] ? `${listId}-${cursor}` : undefined}
        autoComplete="off"
        spellCheck={false}
        maxLength={20}
        className="h-9 w-full rounded-full bg-white/[0.05] pl-10 pr-4 text-sm text-ink outline-none transition-colors placeholder:text-ash-400 hover:bg-white/[0.08] focus:bg-white/[0.08] focus:shadow-[inset_0_0_0_1px_rgb(92_184_255/0.5)]"
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Players"
          className="absolute right-0 top-full z-50 mt-2 w-full min-w-64 overflow-hidden rounded-xl bg-[#121212] py-1.5 shadow-[0_20px_50px_-12px_rgb(0_0_0/0.9),inset_0_1px_0_rgb(255_255_255/0.06)]"
        >
          {hits.length === 0 ? (
            <li className="px-4 py-3 text-sm text-ash-400">
              {isFetching ? 'Searching…' : 'No players found'}
            </li>
          ) : (
            hits.map((h, i) => (
              <li
                key={h.username}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === cursor}
                onMouseEnter={() => setCursor(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  go(h.username);
                }}
                className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm ${i === cursor ? 'bg-white/[0.06]' : ''}`}
              >
                <Avatar username={h.username} url={h.avatarUrl} size={28} />
                <span className="min-w-0 flex-1 truncate text-ink">{h.username}</span>
                <span className="font-mono text-xs tabular-nums text-ash-400">{h.rating}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
