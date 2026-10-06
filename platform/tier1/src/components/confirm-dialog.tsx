'use client';
import { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type Request = { title: string; message: string; confirmLabel?: string };

/** Portal-styled replacement for window.confirm: `if (!(await confirm({...}))) return;` and render `dialog`. */
export function useConfirm() {
  const [request, setRequest] = useState<Request | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const close = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setRequest(null);
  };
  const confirm = useCallback(
    (next: Request) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false);
        resolver.current = resolve;
        setRequest(next);
      }),
    [],
  );
  const dialog = (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) close(false);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{request?.title}</DialogTitle>
          <DialogDescription>{request?.message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Annullér
          </Button>
          <Button onClick={() => close(true)}>
            {request?.confirmLabel || 'Fortsæt'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { confirm, dialog };
}
