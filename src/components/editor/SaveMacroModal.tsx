import { useState, useEffect, useRef } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

interface SaveMacroModalProps {
  open: boolean;
  initialTitle?: string;
  initialDescription?: string;
  onClose: () => void;
  onConfirm: (title: string, description: string) => void;
}

export function SaveMacroModal({ open, initialTitle = '', initialDescription = '', onClose, onConfirm }: SaveMacroModalProps) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTitle(initialTitle);
      setDescription(initialDescription);
      setTimeout(() => titleRef.current?.focus(), 0);
    }
  }, [open, initialTitle, initialDescription]);

  const submit = () => {
    const t = title.trim();
    if (!t) return;
    onConfirm(t, description.trim());
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Save Macro"
      description="Give your macro a name and a short description."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!title.trim()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          ref={titleRef as any}
          label="Title"
          placeholder="My Macro"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this macro do?"
            rows={3}
            className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 outline-none resize-none focus:border-neutral-700"
          />
        </div>
      </div>
    </Modal>
  );
}