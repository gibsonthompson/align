'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, NotebookText } from 'lucide-react';
import { addNote, removeNote, updateNote } from '@/app/actions';
import { timeAgo } from '@/lib/format';
import type { Note, ObjectType } from '@/lib/types';
import EmptyState from '@/components/EmptyState';

// Notes on any page. Newest first. Each note can be edited or removed.
export default function NotesSection({ attached, notes }: { attached: { type: ObjectType; id: string }; notes: Note[] }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  function save() {
    if (!text.trim()) return;
    setError(null);
    startSave(async () => {
      const res = await addNote(attached.type, attached.id, text);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setText('');
      router.refresh();
    });
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">
          Notes
          <span className="count">{notes.length}</span>
        </h2>
      </div>
      <div style={{ padding: '4px 18px 14px' }}>
        <textarea
          className="textarea"
          style={{ minHeight: 84 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a note, a thought, a reflection"
          aria-label="New note"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              save();
            }
          }}
        />
        {text.trim() && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <button type="button" className="btn primary" onClick={save} disabled={saving}>
              {saving && <Loader2 size={16} className="spin" />} Save Note
            </button>
          </div>
        )}
        {error && (
          <div className="form-error" role="alert" style={{ marginTop: 10 }}>
            {error}
          </div>
        )}
      </div>
      {notes.length === 0 ? (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <EmptyState Icon={NotebookText} title="No Notes Yet" body="Anything you jot here stays with this page and shows up in search." />
        </div>
      ) : (
        notes.map((n) => <NoteItem key={n.id} note={n} />)
      )}
    </section>
  );
}

function NoteItem({ note }: { note: Note }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.body);
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function save() {
    setError(null);
    startBusy(async () => {
      const res = await updateNote(note.id, text);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function remove() {
    setError(null);
    startBusy(async () => {
      const res = await removeNote(note.id);
      if (!res.ok) {
        setError(res.error);
        setConfirming(false);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="note">
      {editing ? (
        <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} aria-label="Edit note" autoFocus />
      ) : (
        <p className="note-body">{note.body}</p>
      )}
      <div className="note-foot">
        <span className="mono">
          {timeAgo(note.created_at)}
          {note.updated_at !== note.created_at && new Date(note.updated_at).getTime() - new Date(note.created_at).getTime() > 60_000 ? ', edited' : ''}
        </span>
        <span style={{ display: 'flex', gap: 6 }}>
          {busy && <Loader2 size={16} className="spin" />}
          {editing ? (
            <>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setEditing(false);
                  setText(note.body);
                }}
              >
                Cancel
              </button>
              <button type="button" className="btn" onClick={save} disabled={busy}>
                Save
              </button>
            </>
          ) : confirming ? (
            <>
              <button type="button" className="btn ghost" onClick={() => setConfirming(false)}>
                Keep
              </button>
              <button type="button" className="btn" style={{ color: 'var(--red)' }} onClick={remove} disabled={busy}>
                Remove Note
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn ghost" onClick={() => setEditing(true)}>
                Edit
              </button>
              <button type="button" className="btn ghost" onClick={() => setConfirming(true)}>
                Remove
              </button>
            </>
          )}
        </span>
      </div>
      {error && (
        <div className="form-error" role="alert" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
    </div>
  );
}
