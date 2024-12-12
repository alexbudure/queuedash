import { DesktopIcon, MoonIcon, SunIcon } from "@radix-ui/react-icons";
import { useState } from "react";
import { ToggleButtonGroup, ToggleButton } from "react-aria-components";

export function useLocalStorage<T extends Record<string, unknown>>(
  key: string,
  initialValue: T,
) {
  // State to store our value
  // Pass initial state function to useState so logic is only executed once
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === "undefined") {
      return initialValue;
    }
    try {
      // Get from local storage by key
      const item = window.localStorage.getItem(key);
      const parsedItem = item ? JSON.parse(item) : initialValue;

      for (const [key] of Object.entries(initialValue)) {
        if (typeof parsedItem[key] === "undefined") {
          throw new Error("Missing key in local storage");
        }
      }

      // Parse stored json or if none return initialValue
      return parsedItem;
    } catch (error) {
      console.log(error);
      // If error also return initialValue
      return initialValue;
    }
  });
  // Return a wrapped version of useState's setter function that ...
  // ... persists the new value to localStorage.
  const setValue = (value: T | ((val: T) => T)) => {
    try {
      // Allow value to be a function so we have same API as useState
      const valueToStore =
        value instanceof Function ? value(storedValue) : value;
      // Save state
      setStoredValue(valueToStore);
      // Save to local storage
      if (typeof window !== "undefined") {
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
      }
    } catch (error) {
      console.log(error);
      // A more advanced implementation would handle the error case
    }
  };
  return [storedValue, setValue] as const;
}

export type UserPreferences = {
  theme: "light" | "dark" | "system";
};

export const ThemeSwitcher = () => {
  const [preferences, setPreferences] = useLocalStorage<UserPreferences>(
    "user-preferences",
    {
      theme: "system",
    },
  );

  return (
    <ToggleButtonGroup
      className="flex h-7 space-x-0.5 rounded-md bg-slate-100 p-0.5 dark:bg-slate-700"
      defaultSelectedKeys={["system"]}
      aria-label="Theme"
      selectedKeys={[preferences.theme]}
      onSelectionChange={(value) => {
        if (value.has("system")) {
          setPreferences({ theme: "system" });
        } else if (value.has("light")) {
          document.documentElement.classList.remove("dark");
          setPreferences({ theme: "light" });
        } else if (value.has("dark")) {
          document.documentElement.classList.add("dark");
          setPreferences({ theme: "dark" });
        }
      }}
    >
      {[
        {
          value: "system",
          icon: () => <DesktopIcon />,
          ariaLabel: "System theme",
        },
        {
          value: "light",
          icon: () => <SunIcon />,
          ariaLabel: "Light theme",
        },
        {
          value: "dark",
          icon: () => <MoonIcon />,
          ariaLabel: "Dark theme",
        },
      ].map((item) => {
        return (
          <ToggleButton
            key={item.value}
            className="flex aspect-square h-full items-center justify-center rounded-md text-slate-900 transition duration-150 ease-in-out hover:bg-slate-200 active:bg-slate-300 data-[selected=true]:bg-slate-200 data-[selected=true]:shadow-sm dark:text-slate-50 dark:hover:bg-slate-500 dark:data-[selected=true]:bg-slate-500"
            id={item.value}
            aria-label={item.ariaLabel}
          >
            {item.icon()}
          </ToggleButton>
        );
      })}
    </ToggleButtonGroup>
  );
};
