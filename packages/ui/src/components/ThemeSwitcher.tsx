import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
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

const THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export const getStoredUserPreferences = (): UserPreferences | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem("user-preferences");
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed.theme === "light" ||
        parsed.theme === "dark" ||
        parsed.theme === "system")
    ) {
      return parsed as UserPreferences;
    }
  } catch (error) {
    console.log(error);
  }

  return null;
};

export const applyThemePreference = (theme: UserPreferences["theme"]) => {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return;
  }

  const shouldUseDark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia(THEME_MEDIA_QUERY).matches);

  document.documentElement.classList.toggle("dark", shouldUseDark);
};

export const ThemeSwitcher = () => {
  const [preferences, setPreferences] = useLocalStorage<UserPreferences>(
    "user-preferences",
    {
      theme: "system",
    },
  );

  useEffect(() => {
    if (preferences.theme !== "system" || typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia(THEME_MEDIA_QUERY);
    const handleMediaChange = () => applyThemePreference("system");

    handleMediaChange();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleMediaChange);
      return () => mediaQuery.removeEventListener("change", handleMediaChange);
    }

    mediaQuery.addListener(handleMediaChange);
    return () => mediaQuery.removeListener(handleMediaChange);
  }, [preferences.theme]);

  return (
    <ToggleButtonGroup
      className="flex gap-0.5 rounded-lg bg-gray-100/80 p-1 dark:bg-slate-800/60"
      defaultSelectedKeys={["system"]}
      aria-label="Theme"
      selectedKeys={[preferences.theme]}
      onSelectionChange={(value) => {
        const nextTheme = value.has("system")
          ? "system"
          : value.has("light")
            ? "light"
            : value.has("dark")
              ? "dark"
              : preferences.theme;

        applyThemePreference(nextTheme);
        setPreferences({ theme: nextTheme });
      }}
    >
      {[
        {
          value: "system",
          icon: () => <Monitor className="size-3" />,
          ariaLabel: "System theme",
        },
        {
          value: "light",
          icon: () => <Sun className="size-3" />,
          ariaLabel: "Light theme",
        },
        {
          value: "dark",
          icon: () => <Moon className="size-3" />,
          ariaLabel: "Dark theme",
        },
      ].map((item) => {
        return (
          <ToggleButton
            key={item.value}
            className="flex size-6 items-center justify-center rounded-md text-gray-400 transition-all duration-150 hover:text-gray-600 data-[selected=true]:bg-white data-[selected=true]:text-gray-900 data-[selected=true]:shadow-sm dark:text-slate-500 dark:hover:text-slate-400 dark:data-[selected=true]:bg-slate-700 dark:data-[selected=true]:text-slate-200 dark:data-[selected=true]:shadow-none"
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
