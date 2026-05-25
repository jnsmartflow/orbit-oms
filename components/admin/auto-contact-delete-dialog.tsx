// components/admin/auto-contact-delete-dialog.tsx
// Phase 3b — confirmation modal shown when user clicks ✕ on an auto-contact.
// Confirming flips customer_sales_officers.contactDismissed = true for that
// SO link and removes the auto-contact from the local UI. Cancel = no-op.

"use client";

import { AlertCircle, Link2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface AutoContactDeleteDialogProps {
  open:         boolean;
  contactName:  string;
  onConfirm:    () => void;
  onCancel:     () => void;
}

export function AutoContactDeleteDialog({
  open, contactName, onConfirm, onCancel,
}: AutoContactDeleteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-[420px] p-0">
        <DialogHeader className="px-5 py-4 border-b border-gray-100">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-amber-50 text-amber-700 flex items-center justify-center flex-shrink-0">
              <AlertCircle size={18} />
            </div>
            <div className="flex-1 text-left">
              <DialogTitle className="text-[14px] font-semibold text-gray-900">
                Delete auto-contact?
              </DialogTitle>
              <p className="text-[12.5px] text-gray-600 mt-1.5 leading-relaxed">
                <strong>{contactName || "This contact"}</strong> was auto-created from the linked Sales Officer.
                Deleting it also marks the SO link as <em>dismissed</em> — it won&apos;t come back unless you re-add the SO above.
              </p>
            </div>
          </div>
        </DialogHeader>
        <div className="px-5 py-2.5 bg-gray-50 border-b border-gray-100">
          <div className="text-[11px] text-gray-500 flex items-center gap-2">
            <Link2 size={12} />
            Sets <code className="font-mono text-[10.5px]">customer_sales_officers.contactDismissed = true</code>
          </div>
        </div>
        <DialogFooter className="px-5 py-3.5 gap-2.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 px-4 text-[12.5px] font-medium border-gray-200 text-gray-700 hover:bg-gray-50"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-9 px-4 text-[12.5px] font-semibold bg-gray-900 hover:bg-gray-800 text-white"
            onClick={onConfirm}
          >
            Delete contact
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
