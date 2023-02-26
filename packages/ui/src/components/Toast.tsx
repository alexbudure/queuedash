import * as RadixToast from "@radix-ui/react-toast";
import { useState } from "react";
import { CheckCircledIcon, CrossCircledIcon } from "@radix-ui/react-icons";
import { clsx } from "clsx";

type ToastProps = {
  message: string;
  variant: "success" | "error";
  onDismiss?: () => void;
};
export const Toast = ({ variant, message, onDismiss }: ToastProps) => {
  const [open, setOpen] = useState(true);

  const icon =
    variant === "success" ? (
      <CheckCircledIcon className="rounded-full bg-green-50" />
    ) : (
      <CrossCircledIcon className="rounded-full bg-red-50" />
    );
  return (
    <RadixToast.Root
      className={clsx(
        "flex items-center space-x-1 rounded-md border bg-white/75 py-2 px-3 text-sm shadow-lg backdrop-blur-md",
        {
          "border-red-50 text-red-900": variant === "error",
          "border-green-50 text-green-900": variant === "success",
        }
      )}
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onDismiss?.();
        }
        setOpen(isOpen);
      }}
    >
      {icon}
      <RadixToast.Description asChild>
        <p>{message}</p>
      </RadixToast.Description>
    </RadixToast.Root>
  );
};
