"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./dialog";

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn("command-root", className)}
      {...props}
    />
  );
}
function CommandDialog({
  title,
  inputLabel,
  description,
  decoration,
  children,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title: string;
  inputLabel?: string;
  description: string;
  decoration?: React.ReactNode;
  onCloseAutoFocus?: React.ComponentProps<
    typeof DialogContent
  >["onCloseAutoFocus"];
}) {
  return (
    <Dialog {...props}>
      <DialogContent
        className="yuzu-command-dialog"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        {decoration}
        <header className="yuzu-command-heading">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </header>
        <Command shouldFilter={false} loop label={inputLabel ?? title}>
          {children}
        </Command>
        <DialogClose className="pause-close" aria-label="Close search">
          <X size={16} />
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="command-input-wrap">
      <Search size={19} aria-hidden="true" />
      <CommandPrimitive.Input
        className={cn("command-input", className)}
        {...props}
      />
    </div>
  );
}
function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      className={cn("command-list", className)}
      {...props}
    />
  );
}
function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn("command-group", className)}
      {...props}
    />
  );
}
function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn("command-item", className)}
      {...props}
    />
  );
}
function CommandEmpty(
  props: React.ComponentProps<typeof CommandPrimitive.Empty>,
) {
  return <CommandPrimitive.Empty className="command-message" {...props} />;
}
function CommandSeparator(
  props: React.ComponentProps<typeof CommandPrimitive.Separator>,
) {
  return (
    <CommandPrimitive.Separator className="command-separator" {...props} />
  );
}
export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandEmpty,
  CommandSeparator,
};
